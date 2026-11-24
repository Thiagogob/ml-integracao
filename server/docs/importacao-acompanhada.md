# Importação acompanhada do relatório de estoque

Envio do PDF do fornecedor pela interface, com conferência antes de alterar
qualquer coisa e acompanhamento anúncio por anúncio.

## Por que não é uma tela de upload

Os números vêm das execuções reais gravadas em `server/logs/sync-*.json`,
não de estimativa:

| Grandeza | Valor medido |
|---|---|
| Linhas no relatório | 1.613 |
| SKUs com cadastro | ~795 |
| **Anúncios tocados por execução** | **980** |
| Rodas sem SKU no cadastro | 771 a 823, cerca de metade |
| Rejeitados pelo ML (400 ou 409) | 24 |
| `DELAY_MS` entre chamadas ao ML | 500 ms |
| Piso de duração só em espera deliberada | **490 segundos** |
| `timeout` do cliente em `api.ts` | 10 segundos |

Duas descobertas nos mesmos arquivos motivaram decisões de projeto:

1. **Os 23 pares sku/anúncio rejeitados são os mesmos nas quatro execuções
   de abril.** Conjuntos idênticos. São anúncios que o Mercado Livre recusa
   toda vez, e ninguém via, porque o relatório morria num arquivo em disco.
   Daí a tabela de eventos e o filtro "Recusados pelo ML" na tela.

2. **As execuções de 24/04 às 21:19 e de 25/04 às 13:03 produziram relatórios
   idênticos byte a byte**, exceto o timestamp: o mesmo PDF foi reprocessado
   16 horas depois, repetindo 980 chamadas ao ML à toa. Daí a idempotência por
   SHA-256 do conteúdo.

## Máquina de estados

```
analisando ──► aguardando_confirmacao ──► processando ──► concluida
     │                   │                     │
     │                   │                     ├──► falhou
     │                   │                     ├──► cancelada
     │                   │                     └──► interrompida ──┐
     └──► falhou         └──► cancelada                            │
                                      retomar() volta a processando┘
```

Garantias:

- Entre `analisando` e `aguardando_confirmacao` **nada é gravado e nenhum
  anúncio é tocado**. A fase de análise não usa nem o token do Mercado Livre.
- `interrompida` é estado honesto, não erro. O Railway manda SIGTERM a cada
  deploy e uma execução de vinte minutos vai ser morta no meio. O que foi feito
  está nos eventos; a retomada pula o que tem evento gravado.
- Os contadores sobem por `UPDATE col = col + 1` na mesma instrução que grava o
  evento, dentro de uma transação. O `CHECK` da migração exige
  `processados = atualizados + ja_atualizados + erros + ignorados`.

## Aplicar a migração

Não há executor de migração no projeto: os arquivos em `server/migrations` são
SQL aplicado à mão, como o `add_store_id_up.sql`. `syncDb()` apenas autentica,
nunca cria tabela.

```bash
psql "$DATABASE_URL" -f server/migrations/importacoes_estoque_up.sql
```

Para desfazer:

```bash
psql "$DATABASE_URL" -f server/migrations/importacoes_estoque_down.sql
```

A migração é idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`), então reaplicar não quebra.

## Rotas

Todas exigem token. As rotas legadas em `/api/stock` seguem intactas e sem
token, para não quebrar quem as chama hoje por fora da interface.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/importacoes` | recebe o PDF (campo `arquivo`), analisa, responde **202** com o diagnóstico |
| `GET` | `/api/importacoes` | histórico |
| `GET` | `/api/importacoes/:id` | estado, contadores, percentual, vazão medida e estimativa |
| `GET` | `/api/importacoes/:id/eventos?desde_seq=N&resultado=erro` | busca incremental dos anúncios |
| `POST` | `/api/importacoes/:id/confirmar` | autoriza; grava o estoque e começa a sincronizar |
| `POST` | `/api/importacoes/:id/retomar` | retoma uma interrompida |
| `POST` | `/api/importacoes/:id/cancelar` | cancelamento cooperativo |

Códigos que valem conhecer: **409** no envio significa que o mesmo arquivo já
tem importação viva, com a importação existente no corpo da resposta; **413**
arquivo acima de 25 MB; **415** extensão diferente de `.pdf`; **422** nenhuma
linha de roda reconhecida.

## Tela

`/importar-estoque`, ligada ao botão "Enviar estoque atualizado" do painel.
Esse botão já existia, mas o `onClick` era `handleListarVendas` e levava para
`/vendas`: a tela prometia a função e fazia outra coisa.

A página consulta a cada 2 segundos, busca apenas os eventos novos por
`desde_seq`, e mantém 120 eventos no DOM, porque segurar 980 travaria a página.
A estimativa de término vem da vazão medida na própria execução, não de
constante.

## Rodar os testes

```bash
cd server && npm test
```

21 testes, `node:test` nativo, sqlite em memória, dublê do `fetch` global. Sem
Postgres, sem credencial do Mercado Livre, cerca de 3 segundos.

O último é um teste de regressão contra a execução real de 24/04/2026, cuja
fixtura está em `server/test/fixturas/execucao-real-2026-04-24.json`: exige que
a contabilidade do novo caminho reproduza os mesmos 980 anúncios, 956
atualizados e 24 rejeitados, e que os 24 sejam exatamente os mesmos pares.

## Conferir contra o Mercado Livre

Os testes provam a máquina de estados contra um dublê. Se a quantidade chegou
de fato no anúncio, só a API do Mercado Livre pode dizer. O conferidor é
somente leitura:

```bash
cd server && node scripts/conferir-importacao-no-ml.js <id-da-importacao> [amostra]
```

Ele relê cada anúncio da amostra no ML, recalcula a quantidade esperada pelo
mesmo caminho da sincronização e compara. Sai com código 1 se houver
divergência. Atenção a um falso positivo legítimo: se houve venda entre a
importação e a conferência, a baixa por venda já alterou a quantidade.

## Onde cada coisa mora

| Arquivo | Papel |
|---|---|
| `migrations/importacoes_estoque_up.sql` | esquema, com os dois `CHECK` e o índice único parcial |
| `src/config/models/importacoes.js` | fábrica dos modelos, para a suíte poder criá-los em sqlite |
| `src/services/importacoes.repo.js` | persistência: transições por comparação e troca, contadores atômicos, reconciliador |
| `src/services/importacoes.service.js` | orquestrador: máquina de estados e o laço, com portas injetadas |
| `src/services/importacoes.wiring.js` | liga as portas aos serviços reais |
| `src/controllers/ImportacoesController.js` | camada HTTP |
| `src/routes/importacoes.routes.js` | rotas, multer com limite, tudo autenticado |
| `client/src/pages/ImportacaoEstoquePage.tsx` | a tela |
| `client/src/services/importacoesService.ts` | cliente, com timeout por requisição |

## Alterações em código existente

Todas aditivas, por parâmetro opcional, para não mudar o comportamento de quem
já chamava:

- `stock.service.js`: `saveStock` ganhou `opcoes.dryRun`, que faz a
  normalização, o cruzamento e o diagnóstico e para antes de gravar. O retorno
  passou a vir de uma fábrica compartilhada pelos dois caminhos, e ganhou o
  campo `planoML`.
- `meli.service.js`: o laço interno de `processCriticalUpdates` foi extraído
  para `sincronizarAnuncio`, que trata um anúncio e não captura exceção, de
  modo que cada chamador escolhe a granularidade do erro.
  `processCriticalUpdates` passou a usá-la e manteve o `catch` por SKU que
  sempre teve. Um `listaMLIDs` sem declaração, que criava global implícita a
  cada SKU, ganhou `const`.
- `anuncios.service.js`: `expandirAnunciosPorSkus`, uma consulta só, que
  reproduz deliberadamente a semântica e a ordem de `getAnunciosBySku` para o
  teste de regressão fechar.
- `server.js`: reconciliação na subida e a cada 60 segundos, e desligamento
  ordenado tratando **SIGTERM**, que antes não era tratado.

## Limites conhecidos

- **Só a origem `upload_pdf`.** Não é limitação, é precisão: das três rotas de
  envio, só a de São Paulo toca o Mercado Livre. As outras duas carregam
  entidade de estágio e planilha local, não chamam
  `processCriticalUpdates` e terminam em segundos.
- **A quantidade anterior do anúncio não é registrada.** Exigiria um `GET`
  extra por anúncio no ML, dobrando a duração da execução. O evento guarda a
  quantidade enviada.
- **As rotas legadas de `/api/stock` continuam sem token.** Mudar isso quebraria
  quem as chama por fora hoje, e é decisão do dono do sistema, não deste
  trabalho.
- **`entrada_rodas` e `plano_anuncios` custam cerca de 260 KB por importação.**
  São anulados quando o job encerra em `concluida` ou `cancelada`. Em
  `interrompida` ficam, porque é deles que a retomada vive.

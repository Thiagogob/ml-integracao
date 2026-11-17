// client/serve.js
//
// Servidor de producao do frontend. Serve o dist e repassa /api ao backend.
//
// POR QUE EXISTE E POR QUE FAZ PROXY
//
// O cliente chama a API por caminho relativo: api.ts tem BASE_URL = '/api'.
// Em desenvolvimento o proxy do Vite resolve isso. Em producao, se o frontend
// fosse servido de um dominio e a API de outro, duas coisas quebrariam: o
// caminho relativo apontaria para o proprio frontend, e o navegador barraria a
// chamada por falta de CORS, que nao esta montado em nenhum lugar do servidor.
//
// Repassando /api daqui, o navegador fala com uma unica origem. O resultado e
// que nada precisou mudar no cliente e nada precisou mudar na API: nem
// BASE_URL, nem CORS, nem os servicos ml-integracao e ml-conta-secundaria, que
// tem rootDirectory /server e deployam da main.
//
// Usa apenas modulos nativos, sem dependencia nova. O repasse e feito com
// http.request e pipe, nao com fetch, porque o envio do relatorio de estoque e
// multipart de ate 25 MB: pipe encaminha em fluxo, fetch exigiria carregar o
// corpo inteiro em memoria.
//
// Variaveis de ambiente:
//   PORT        porta de escuta (o Railway define)
//   API_ORIGIN  origem do backend; o padrao aponta para o ml-integracao

import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, 'dist');

const PORTA = parseInt(process.env.PORT, 10) || 8080;
const API_ORIGIN = process.env.API_ORIGIN
    || 'https://ml-integracao-production.up.railway.app';

// A analise do relatorio de estoque le 1.613 linhas e cruza com o cadastro: o
// cliente espera ate 300 s nessa requisicao. O proxy precisa de folga sobre
// isso, senao corta antes de quem esta esperando.
const TIMEOUT_PROXY_MS = 330000;

const TIPOS = new Map(Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json'
}));

const registrar = (req, status, nota = '') => {
    console.log(`${req.method} ${req.url} -> ${status}${nota ? ` ${nota}` : ''}`);
};

// --------------------------------------------------------------------- proxy

const encaminhar = (req, res) => {
    let destino;
    try {
        destino = new URL(req.url, API_ORIGIN);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('URL invalida');
        return;
    }

    const modulo = destino.protocol === 'https:' ? https : http;

    // Repassa os cabecalhos do cliente, inclusive Authorization e
    // Content-Type do multipart, trocando apenas o Host pelo do destino.
    const cabecalhos = { ...req.headers, host: destino.host };
    delete cabecalhos.connection;

    const requisicao = modulo.request(
        destino,
        { method: req.method, headers: cabecalhos },
        (resposta) => {
            res.writeHead(resposta.statusCode || 502, resposta.headers);
            resposta.pipe(res);
        }
    );

    requisicao.setTimeout(TIMEOUT_PROXY_MS, () => {
        requisicao.destroy(new Error('tempo esgotado no repasse ao backend'));
    });

    requisicao.on('error', (erro) => {
        registrar(req, 502, erro.message);
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            error: 'Nao foi possivel falar com a API.',
            detalhe: erro.message
        }));
    });

    // Se o cliente desistir no meio de um envio, aborta o repasse em lugar de
    // deixar a requisicao pendurada no backend.
    req.on('aborted', () => requisicao.destroy());

    req.pipe(requisicao);
};

// -------------------------------------------------------------- arquivos

const servirArquivo = async (req, res, caminhoRelativo, status = 200) => {
    const absoluto = path.join(RAIZ, caminhoRelativo);

    // Guarda contra travessia de caminho: nada fora de dist/
    if (!absoluto.startsWith(RAIZ + path.sep) && absoluto !== RAIZ) {
        res.writeHead(403).end();
        return false;
    }

    try {
        const info = await stat(absoluto);
        if (!info.isFile()) return false;

        const extensao = path.extname(absoluto).toLowerCase();
        const cabecalhos = {
            'Content-Type': TIPOS.get(extensao) || 'application/octet-stream',
            'Content-Length': info.size,
            // O Vite poe hash no nome dos arquivos de assets, logo eles podem
            // ser guardados para sempre. O index.html, nunca, senao o
            // navegador continua carregando a versao velha depois do deploy.
            'Cache-Control': caminhoRelativo.startsWith('assets/')
                ? 'public, max-age=31536000, immutable'
                : 'no-cache'
        };

        res.writeHead(status, cabecalhos);
        createReadStream(absoluto).pipe(res);
        return true;
    } catch {
        return false;
    }
};

// ------------------------------------------------------------------ servidor

const servidor = http.createServer(async (req, res) => {
    const caminho = (req.url || '/').split('?')[0];

    if (caminho === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, api: API_ORIGIN }));
        return;
    }

    if (caminho === '/api' || caminho.startsWith('/api/')) {
        encaminhar(req, res);
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }

    const decodificado = decodeURIComponent(caminho).replace(/^\/+/, '');

    if (decodificado !== '' && await servirArquivo(req, res, decodificado)) return;

    // Devolver o index.html em qualquer outra rota e o que faz /importar-estoque
    // funcionar quando o operador recarrega a pagina ou abre o link direto:
    // o roteamento e do React, o servidor nao conhece essas rotas.
    if (await servirArquivo(req, res, 'index.html')) return;

    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist/index.html ausente: rode npm run build antes de iniciar');
});

servidor.listen(PORTA, () => {
    console.log(`frontend servindo ${RAIZ} na porta ${PORTA}`);
    console.log(`/api repassado para ${API_ORIGIN}`);
});

const desligar = (sinal) => {
    console.log(`${sinal} recebido, encerrando o frontend`);
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
};

process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT', () => desligar('SIGINT'));

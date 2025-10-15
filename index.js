const express = require('express');
const app = express();
const path = require('path');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const pdfParse = require('pdf-parse');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const archiver = require('archiver');
const fsAsync = require('fs').promises;
require('dotenv').config();


const APP_ID = process.env.APP_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const SELLER_ID = process.env.SELLER_ID;



// -------------------------------------------------------------------------------------------------------------------------

app.use(cors({
    origin: ['http://localhost:3001', 'https://wheel-finder-front.onrender.com','http://127.0.0.1:5500'], 
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
}));

// Middleware to accept file uploads
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));




//// Nome do arquivo do banco de dados
const DB_PATH = './mercado_livre_estoque.db';

    //Dados de exemplo para a atualização
const idDoRegistro = 1;
const novoValorA = 'APP_USR-1880450643389565-100812-67c6657a8687d75c8e6b37660bea8652-206609581';
const novoValorB = 'TG-68e68cc315931a0001075774-206609581'
    //Abre a conexão com o banco de dados
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    // Se houver um erro, mostra no console
    console.error('Erro ao abrir o banco de dados:', err.message);
  } else {
    console.log('Conexão com o banco de dados estabelecida.');

    // SQL para a atualização da tabela
    // As ? são placeholders para evitar injeção de SQL e garantem mais segurança
    const sql = `UPDATE tokens_ml SET access_token = ?, refresh_token = ? WHERE id = ?`;
    //const sql = `DELETE FROM estoque_rodas_distribuidora`
    // Executa a query de atualização
     //O array de valores [novoValorA, novoValorB, idDoRegistro] preenche os placeholders na ordem correta
    db.run(sql, [novoValorA, novoValorB, idDoRegistro], function(err) {
    //db.run(sql, function(err) {
      if (err) {
        console.error('Erro ao executar a atualização:', err.message);
      } else {
        // 'this.changes' retorna o número de linhas afetadas pela query
        console.log(`Sucesso! ${this.changes} linha(s) atualizada(s).`);
      }

      // Fecha a conexão com o banco de dados
      db.close((err) => {
        if (err) {
          console.error('Erro ao fechar o banco de dados:', err.message);
        } else {
          console.log('Conexão com o banco de dados fechada.');
        }
      });
    });
  }
});




// Função para iniciar a conexão com o banco de dados SQLite
function iniciarConexaoDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('mercado_livre_estoque.db', (err) => {
            if (err) {
                console.error('Erro ao abrir o banco de dados:', err.message);
                return reject(err); // Rejeita a Promise em caso de erro
            }
            console.log('Banco de dados aberto com sucesso.');
            resolve(db); // Resolve a Promise com o objeto do banco de dados
        });
    });
}
    



function fecharConexaoDb(db) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.warn('Tentativa de fechar uma conexão nula.');
            return resolve(); // Resolve sem erro se a conexão for nula
        }
        
        db.close((err) => {
            if (err) {
                console.error('Erro ao fechar o banco de dados:', err.message);
                return reject(err); // Rejeita a Promise em caso de erro
            }
            console.log('Banco de dados fechado com sucesso.');
            resolve(); // Resolve a Promise
        });
    });
}

async function authTest() {
    const db = await iniciarConexaoDb();

    try {
        const resultado = await new Promise((resolve, reject) => {
            db.all('SELECT access_token FROM tokens_ml WHERE id = 1', [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });

        const access_token = resultado[0].access_token;

        const url_teste = "https://api.mercadolibre.com/users/me";

        const headers = {
            "Authorization": `Bearer ${access_token}`
        };

        const resposta = await fetch(url_teste, {
        method: 'GET',
        headers: headers,
        });

    // const resposta_json = await resposta.json();
    // console.log(resposta.status);

        if (resposta.status === 200) {
            console.log("Token ainda válido: ", access_token);
            return access_token;
        } else if (resposta.status === 401) {
            console.log("Token inválido");
            return false;
        } else {
            return null;
        }

    } catch (err) {
        console.error('Erro ao executar a consulta:', err.message);
    } 
    finally 
    {
        fecharConexaoDb(db);
    }
}


// Função que obtém o Access Token da API do Mercado Livre
async function getAuth() {
    // Variáveis 'fixas' que vamos precisar enviar à API do Mercado Livre
    //const app_id = "1880450643389565";
    //const client_secret = "SaX6HssKeWECWyLkoA4ql1FKWldkFIwU";

    // Chama a função que cria a conexão com o SQLite
    const db = await iniciarConexaoDb();

    try {
        const resultado = await new Promise((resolve, reject) => {
            db.all('SELECT refresh_token FROM tokens_ml WHERE id = 1', [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });

        const refresh_token_antigo = resultado[0].refresh_token;

        console.log("Refresh Token Antigo = ", refresh_token_antigo);

        const url_principal = "https://api.mercadolibre.com/oauth/token";

        const headers = {
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded"
        };

        const dados = `grant_type=refresh_token&client_id=${APP_ID}&client_secret=${SECRET_KEY}&refresh_token=${refresh_token_antigo}`;

        const resposta = await fetch(url_principal, {
            method: 'POST', // O método HTTP da requisição.
            headers: headers, // Os cabeçalhos da requisição.
            body: dados // O corpo da requisição, contendo os dados.
        });

        const resposta_json = await resposta.json();

        console.log("Refresh token novo = ", resposta_json.refresh_token)

        db.run(`UPDATE tokens_ml SET refresh_token = '${resposta_json.refresh_token}', access_token = '${resposta_json.access_token}' WHERE id = 1`, [], (err) => {
            if (err) {
                console.error('Erro ao atualizar os tokens no banco de dados:', err.message);
            } else {
                console.log('Tokens atualizados com sucesso.');
            }
        });

        return resposta_json.access_token
    } catch (err){
        console.error('Erro ao executar consulta', err.message);
    } finally{
        fecharConexaoDb(db);
    }
        
};




async function getVendas(access_token){
    
    // Array para armazenar todas as vendas de todas as páginas
    let todasAsVendas = [];
    let offset = 0;
    const limit = 50; // O limite máximo por requisição na API do Mercado Livre

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const formattedStart = startOfToday.toISOString();
    const formattedEnd = endOfToday.toISOString();

    const headers = {
        "Authorization": `Bearer ${access_token}`
    };

    let maisVendasDisponiveis = true;

    // Loop principal para a paginação
    while (maisVendasDisponiveis) {
        
        // Constrói a URL com os parâmetros de paginação
        const url = `https://api.mercadolibre.com/orders/search?seller=${SELLER_ID}&order.date_created.from=${formattedStart}&order.date_created.to=${formattedEnd}&offset=${offset}`;

        try {
            const resposta = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!resposta.ok) {
                // Lidar com erros de requisição, como 401 (não autorizado)
                throw new Error(`Erro na requisição: ${resposta.status}`);
            }

            const resposta_json = await resposta.json();
            console.log(resposta_json.paging);
            const vendasDaPagina = resposta_json.results;

            // Adiciona as vendas da página atual ao array principal
            if (vendasDaPagina && vendasDaPagina.length > 0) {
                todasAsVendas = todasAsVendas.concat(vendasDaPagina);
                
                // Se o número de vendas na página for menor que o limite, chegamos ao final
                if (vendasDaPagina.length < limit) {
                    maisVendasDisponiveis = false;
                } else {
                    // Incrementa o offset para a próxima página
                    offset += limit;
                }
            } else {
                // Se o array de vendas estiver vazio, não há mais vendas
                maisVendasDisponiveis = false;
            }

        } catch (error) {
            console.error('Erro ao buscar vendas:', error);
            // Interrompe o loop em caso de erro para evitar repetição infinita
            maisVendasDisponiveis = false;
        }
    }

    // Retorna o objeto com todas as vendas para a rota /getVendas
    return { results: todasAsVendas };
}

//function salvarVendas(dados){
//    const vendas = dados.results;
//    const db =  iniciarConexaoDb();
//
//    for (let venda of vendas){
//        const data = venda.date_closed;
//        console.log(data);
//        const id = venda.id;
//        console.log(id);
//        const sku = venda.order_items[0].item.seller_sku;
//        console.log(sku);
//        const valor = venda.order_items[0].unit_price;
//        console.log(valor);
//        const comissao = venda.order_items[0].sale_fee;
//        console.log(comissao);
//
//        db.run(`INSERT INTO vendas_ml (data, id_ml, sku, valor, comissao) VALUES ('${data}', '${id}', '${sku}', ${valor}, ${comissao})`, [], (err) => {
//            if (err){
//                console.error('Erro ao inserir valores na tabela: ', err.message);
//            } else {
//                console.log('Valores inseridos na tabela com sucesso');
//            }
//        });
//    }
//
//    fecharConexaoDb(db);
//};

async function salvarVendas(dados) {
    const vendas = dados.results;
    let db;
    try {
        // Inicia a conexão de forma assíncrona
        db = await iniciarConexaoDb();

        for (let venda of vendas) {
            const data = venda.date_closed;
            const id = venda.id;
            const sku = venda.order_items[0].item.seller_sku;
            const valor = venda.order_items[0].unit_price;
            const comissao = venda.order_items[0].sale_fee;

            // Insere os dados de forma assíncrona, esperando cada inserção
            await new Promise((resolve, reject) => {
                const sql = `INSERT INTO vendas_ml (data, id_ml, sku, valor, comissao) VALUES (?, ?, ?, ?, ?)`;
                // Usando placeholders para segurança
                const params = [data, id, sku, valor, comissao]; 

                db.run(sql, params, function (err) {
                    if (err) {
                        console.error(`Erro ao inserir ID ${id}`, err.message);
                        reject(err);
                    } else {
                        console.log(`Valores inseridos para o ID: ${id}`);
                        resolve();
                    }
                });
            });
        }
        
        console.log('Todas as vendas foram salvas com sucesso.');
    } catch (error) {
        console.error('Erro geral na função salvarVendas: ', error);
    } finally {
        // Garante que a conexão será fechada no final
        if (db) {
            fecharConexaoDb(db);
        }
    }
}



// Route: Upload + Parse PDF
// Função de parsing
function parseTxtToWheels(text) {
    const lines = text.trim().split('\n');
    const results = [];

    // O novo regex completo, projetado para ser mais robusto
    //const pattern = /(\S+)\s+(\d{1,2}[Xx]\d{1,2}(?:,\d{1})?)\s+(\d{1,2}[Xx]\d{1,3}(?:\/\d{1,3})?)\s+(-?\d{1,3})\s+(.*?)\s+(\d+)\s+(\d+)$/;
    const pattern = /(\S+)\s+([\dXx,\.]+)\s+([\dXx\/-]+)\s+(-?\d{1,3})\s+(.*?)\s+(\d+)\s+(\d+)$/;

    for (const line of lines) {
        if (!line.trim()) continue;

        const match = line.match(pattern);
        
        if (match) {
            const [
                _, 
                modelo, 
                aro, 
                pcd, 
                offset, 
                acabamento, 
                qtde_sp, 
                qtde_sc
            ] = match;

            results.push({
                MODELO: modelo.trim(),
                ARO: aro.trim(),
                PCD: pcd.trim(),
                OFFSET: offset.trim(),
                ACABAMENTO: acabamento.trim(),
                QTDE_SP: parseInt(qtde_sp),
                QTDE_SC: parseInt(qtde_sc)
            });
        } else {
            console.warn(`Linha ignorada (não corresponde ao padrão): "${line}"`);
        }
    }

    return results;
}


async function atualizarEstoque(estoque) {
    let db;
    try {
        // Iniciar a conexão com o banco de dados
        db = await iniciarConexaoDb();
        
        // Limpar a tabela antes de inserir novos dados
        // Use db.run para comandos que não retornam dados
        await new Promise((resolve, reject) => {
            // Alterado o nome da tabela para estoque_rodas_distribuidora
            db.run('DELETE FROM estoque_rodas_distribuidora', function(err) {
                if (err) return reject(err);
                console.log('Tabela estoque_rodas_distribuidora limpa com sucesso.');
                resolve();
            });
        });

        // Iterar sobre o array de rodas e inserir cada uma
        for (const roda of estoque) {
            const sql = `
                INSERT INTO estoque_rodas_distribuidora (
                    modelo,
                    aro,
                    pcd,
                    offset,
                    acabamento,
                    qtde_sp,
                    qtde_sc
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [
                roda.MODELO,
                roda.ARO,
                roda.PCD,
                roda.OFFSET,
                roda.ACABAMENTO,
                roda.QTDE_SP,
                roda.QTDE_SC
            ];

            // Use db.run para a inserção e trate os erros
            await new Promise((resolve, reject) => {
                db.run(sql, values, function(err) {
                    if (err) {
                        console.error(`Erro ao inserir a roda ${roda.MODELO}:`, err);
                        // Você pode decidir se quer rejeitar a Promise aqui ou apenas logar
                        return reject(err); 
                    }
                    console.log(`Roda ${roda.MODELO} inserida com sucesso.`);
                    resolve();
                });
            });
        }

        console.log('Estoque de rodas atualizado com sucesso!');

    } catch (error) {
        console.error('Erro fatal ao atualizar o estoque:', error);
    } finally {
        // Fechar a conexão
        if (db) {
            await fecharConexaoDb(db);
        }
    }
}


const stockJsonPath = path.join(__dirname, 'stock-data.json');

// Importa o módulo de sistema de arquivos para ler o JSON
//const fs = require('fs').promises;


async function processarAtualizacaoDoEstoque() {
    let db = null; // Inicializa a variável do banco de dados

    try {
        console.log('Iniciando o processo de atualização do estoque...');

        // 1. Lê o arquivo JSON
        const fileContent = await fsAsync.readFile(stockJsonPath, 'utf8');
        const estoque = JSON.parse(fileContent);
        
        console.log(`Lidos ${estoque.length} itens do arquivo JSON.`);

        // 2. Chama a função de atualização de estoque
        // A função atualizarEstoque já lida com a conexão e inserção
        await atualizarEstoque(estoque);

        console.log('Processo de atualização do estoque concluído com sucesso!');

    } catch (err) {
        console.error('Erro durante o processo de atualização:', err);
    } finally {
        // 3. Garante que o banco de dados seja fechado no final
        if (db) {
            await fecharConexaoDb(db);
        }
    }
}


// =====================ROTAS =================================


// 
// Define uma rota de teste. Quando alguém acessar 'http://localhost:3000/test',
// a função de callback será executada.
app.post('/test', async (req, res) => {

    const app_id = "1880450643389565";
    const client_secret = "SaX6HssKeWECWyLkoA4ql1FKWldkFIwU";
    const code = "TG-68e119ff4d4cb900015180d4-206609581";
    const redirect_uri = "https://diegogoya.adv.br/";

    const url_principal = "https://api.mercadolibre.com/oauth/token";

    // Informações que vão ser enviadas junto da URL principal da requisição/chamada
    const headers = {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded"
    };

    // Dados que serão enviados no corpo da requisição (payload).
    // Eles são formatados como uma string de URL.
    const dados = `grant_type=authorization_code&client_id=${app_id}&client_secret=${client_secret}&code=${code}&redirect_uri=${redirect_uri}`;

    // Faz a requisição POST para a API
    const resposta = await fetch(url_principal, {
        method: 'POST', // O método HTTP da requisição.
        headers: headers, // Os cabeçalhos da requisição.
        body: dados // O corpo da requisição, contendo os dados.
    });

    const resposta_json = await resposta.json();

    console.log(resposta_json);
    // Envia uma resposta simples. Você pode enviar JSON, HTML, ou qualquer outra coisa aqui.
    res.send('OK');
});


app.post('/getAccessToken', async (req, res) => {
  // Variáveis necessárias para enviar à API do Mercado Livre
  // Substitua os valores abaixo pelos seus
  const app_id = "1880450643389565";
  const client_secret = "SaX6HssKeWECWyLkoA4ql1FKWldkFIwU";
  const refresh_token = "TG-68e68cc315931a0001075774-206609581"
  //"TG-68e630f28b426000017b7776-206609581"
  //"TG-68e5600f3c71a50001babdbc-206609581"
  //"TG-68e11a984463e500013f9dc6-206609581"; // Este token é obtido na primeira autorização
  //TG-68e1860c12fc490001491d38-206609581
  //TG-68e5600f3c71a50001babdbc-206609581

  // URL principal da API do Mercado Livre
  const url_principal = "https://api.mercadolibre.com/oauth/token";

  // Cabeçalhos para a requisição
  const headers = {
    "accept": "application/json",
    "content-type": "application/x-www-form-urlencoded"
  };

  // Dados que serão enviados no corpo da requisição (payload).
    const dados = `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`;

      // Faz a requisição POST para a API
    const resposta = await fetch(url_principal, {
        method: 'POST', // O método HTTP da requisição.
        headers: headers, // Os cabeçalhos da requisição.
        body: dados // O corpo da requisição, contendo os dados.
    });

    const resposta_json = await resposta.json();

    console.log(resposta_json);

    res.send('OK');  
});

app.get('/getInfoVenda', async (req, res) => {

  //const authentication = await authTest();
  //let access_token
  //if (!authentication){
  //  access_token = await getAuth();
  //}
  //const access_token = "APP_USR-1880450643389565-100714-76ce4cafe5de6c146d34665719a7c3ea-206609581"
  const id_venda = "2000013319810100";

  const headers = {
    "Authorization": `Bearer ${ACCESS_TOKEN}`
  };

  const url = `https://api.mercadolibre.com/orders/${id_venda}`;

  const resposta = await fetch(url, {
    method: 'GET',
    headers: headers
  });

  const resposta_json = await resposta.json();

  console.log(resposta_json);

  res.send(resposta_json);
});


app.get('/getVendas', async(req, res) => {

    const resposta = await authTest();

    if(resposta){
        console.log("Token válido!");
        const resultado = await getVendas(resposta);
        //console.log(resultado.results.order_items[0]);
        salvarVendas(resultado);
        res.send("OK");
    } else {
        console.log("Token inválido!");
        const access_token = await getAuth();
        const resultado = await getVendas(access_token);
        salvarVendas(resultado);
        res.send("OK");
    }

})



app.get('/getDados', async(req, res) => {

    //const resposta = await authTest();
    const access_token = "APP_USR-1880450643389565-100812-67c6657a8687d75c8e6b37660bea8652-206609581"

        const headers = {
        "Authorization": `Bearer ${access_token}`
    };

    const url = `https://api.mercadolibre.com/users/${SELLER_ID}`;

                const resposta = await fetch(url, {
                method: 'GET',
                headers: headers
            });
    
    const resposta_json = await resposta.json();

    console.log(resposta_json);

    res.send('OK');  

//     if(resposta){
//         // faz requisicao
//         const headers = {
//             "Authorization": `Bearer ${ACCESS_TOKEN}`
//         };
//     } else {
//         //pega token e daí faz a requisição
//         const access_token = await getAuth();
//    }


    

})









// ---
// Rota de upload do estoque em formato pdf

app.post('/upload-pdf', upload.single('stock'), async (req, res) => {


  ;;const formData = new FormData();
  //const pdfFile = document.getElementById()
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(fileBuffer);
    const rawText = data.text;

    fs.writeFileSync('parsed-pdf-output.txt', rawText, 'utf8');
    console.log('PDF text saved to parsed-pdf-output.txt');

    // Limpeza do texto antes do parsing
    const cleanText = rawText
      //.replace(/Pag\/\s*/g, '')
      .replace(/MODELOFOTOS ARO PCD ACABAMENTO[\s\S]*?@mkrrodas \| mkrrodas/g, '')
      .replace(/^\s*.*?\.jasper\)?\s*Pag\s*\/\s*$/gmi, '')
      .replace(/[^\S\r\n]+/g, ' ')
      .replace(/E F G M L B BRW KLinha:[\s\S]*$/, '');
      //.replace(/\d{2}\/\d{2}\/\d{4}.*?\.(jasper)?/g, '')
      //.replace(/[^\S\r\n]+/g, ' ');


    const rodas = parseTxtToWheels(cleanText);


    fs.writeFileSync('stock-data.json', JSON.stringify(rodas, null, 2), 'utf8');


    res.setHeader('Content-Type', 'application/json');


    return res.json(rodas);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to parse file' });
  }
});


// Executa a função principal
//processarAtualizacaoDoEstoque();

// ---

// Define a porta do servidor. Ele tenta usar a variável de ambiente 'PORT' primeiro,
// útil para ambientes de produção, e usa a porta 3000 como padrão.
const PORT = process.env.PORT || 3001;

// Inicia o servidor e o faz "escutar" por requisições na porta especificada.
app.listen(PORT, () => {
  // Exibe uma mensagem no console quando o servidor estiver pronto.
  console.log(`Servidor ativo na porta ${PORT} - http://localhost:${PORT}`);
});


/* Servidor do PDV Sudam.
 *
 * Sobe em http://0.0.0.0:8787 e faz duas coisas ao mesmo tempo:
 *   1. serve o proprio app (html/css/js) e a API, na MESMA origem
 *   2. guarda os dados no SQLite
 *
 * Servir o app pela mesma origem e obrigatorio, nao uma preferencia: uma
 * pagina aberta em file:// tem origem null e o navegador bloqueia qualquer
 * chamada a um servidor de rede. Os 5 caixas abrem http://IP-DO-MINI-PC:8787.
 */
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import * as banco from './banco.mjs';
import { gerarHash, conferir, hashAntigo, criarSessao, usuarioDaSessao, encerrarSessao, iniciarSessoes, renovarSessao } from './auth.mjs';
import { registrarVenda, estornarVenda, proximoSeq } from './venda.mjs';
import { iniciarBackup, fazerBackupAgora } from './backup.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = join(aqui, '..');
const PORTA = Number(process.env.SUDAM_PORTA || 8787);

const db = banco.abrir();
iniciarBackup(db);
iniciarSessoes(db);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.bat': 'text/plain; charset=utf-8',
};

/* ---------------- utilidades ---------------- */

/* ---------------- limite de tentativas ----------------
 *
 * O /api/login e scrypt: cada tentativa custa ~50 ms de CPU no mini PC.
 * Sem limite, alguem na rede pode tentar admin/1230 vezes por segundo e
 * derrubar o caixa — ou so descobrir a senha. A conta e por IP+usuario e
 * volta sozinha depois da janela.
 */
const TENTATIVAS = new Map();
const JANELA_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 8;

function chaveTentativa(req, usuario) {
  const ip = (req.socket && req.socket.remoteAddress) || 'desconhecido';
  return `${ip}|${String(usuario || '').toLowerCase()}`;
}

function excedeu(req, usuario) {
  const k = chaveTentativa(req, usuario);
  const agora = Date.now();
  const reg = TENTATIVAS.get(k);
  if (!reg || agora > reg.ate) {
    TENTATIVAS.set(k, { n: 1, ate: agora + JANELA_MS });
    return false;
  }
  reg.n++;
  return reg.n > MAX_TENTATIVAS;
}

function limparTentativa(req, usuario) {
  TENTATIVAS.delete(chaveTentativa(req, usuario));
}

/* O mapa cresce sem teto se ninguem limpar: cada par IP+usuario novo numa
 * rede com varios IPs dinamicos (celular no Wi-Fi da loja) deixa uma entrada
 * parada. A janela de 5 min expiraria na logica, mas a entrada continua na
 * memoria ate la passar — e um atacante so precisa variar o IP. */
setInterval(() => {
  const agora = Date.now();
  for (const [k, reg] of TENTATIVAS) if (agora > reg.ate) TENTATIVAS.delete(k);
}, 60 * 1000).unref?.();

function json(res, dados, codigo = 200) {
  const corpo = JSON.stringify(dados);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

/* Erro 500 nao pode vazar o motivo interno para a rede: `e.message` de uma
 * excecao do SQLite traz caminho de arquivo, nome de tabela e sometimes o
 * SQL — informacao que ajuda quem esta sondando a porta. O log no console
 * continua completo; o cliente recebe so um texto generico e o `codigo`,
 * que e controlado pelo servidor. */
function erro(res, e) {
  const codigo = e && e.status ? e.status : 500;
  /* Handler pode ter morrido DEPOIS de comecar a resposta (ex.: o cliente
     fecha a conexao no meio do JSON.stringify). Chamar writeHead de novo
     lanca ERR_HTTP_HEADERS_SENT, e essa excecao sai do catch do `tratar`
     como promessa rejeitada sem tratamento — o processo inteiro cai e o PDV
     dos 5 caixas para. Checar antes e o que impede isso. */
  if (res.headersSent || res.writableEnded) {
    try { res.destroy(); } catch {}
    return;
  }
  if (codigo >= 500) console.error('[erro]', e);
  const mensagem =
    codigo >= 500 ? 'Erro interno do servidor. Tente novamente.' : (e && e.message) || 'Erro interno';
  json(res, { erro: mensagem, codigo: e && e.codigo }, codigo);
}

/* Teto do corpo da requisicao. Sem isto, qualquer coisa da rede local pode
 * mandar um POST de 2 GB e o servidor acumula tudo em memoria ate o mini PC
 * trocar os 5 caixas -- que e exatamente o downtime que o backup automatico
 * nao cobre, porque o processo morre antes de fechar o banco. A migracao
 * e a unica rota legitimamente grande (sobe o localStorage inteiro), por isso
 * o limite dela e maior. */
const CORPO_PADRAO = 2 * 1024 * 1024;
const CORPO_MIGRACAO = 64 * 1024 * 1024;

async function corpo(req, limite = CORPO_PADRAO) {
  const pedacos = [];
  let tamanho = 0;
  let estourou = false;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > limite) {
      /* Estourou: continua consumindo o resto em vez de sair na hora. Se o
       * handler responder e fechar com o corpo pela metade no socket, o
       * Node descarta a conexao keep-alive e o proximo pedido do mesmo
       * cliente morre com ECONNRESET — o "erro" que o caixa ve seria o
       * limite de corpo, e nao a proxima venda. Esvaziar o stream mantem a
       * conexao saudavel e o 413 chega como resposta normal. */
      estourou = true;
      pedacos.length = 0;
      continue;
    }
    pedacos.push(p);
  }
  if (estourou) {
    throw Object.assign(new Error('Corpo grande demais.'), { status: 413, codigo: 'corpo_grande' });
  }
  if (!pedacos.length) return {};
  try { return JSON.parse(Buffer.concat(pedacos).toString('utf8')); }
  catch { throw Object.assign(new Error('Corpo invalido.'), { status: 400 }); }
}

function semente() {
  return {
    storeName: 'Mercadinho Sudam II',
    paymentMethods: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Crediário'],
    maxDiscount: 100,
    allowNegativeStock: false,
    requireCustomerOnCredit: true,
    cashOpening: 50,
    printWidth: 80,
    theme: 'dark',
    blocksale: { enabled: false, minMarginPct: 0 },
    loyalty: { enabled: true, pointsPerReal: 1, redeemRate: 0.01 },
  };
}

/* ---------------- papeis ----------------
 *
 * Antes o papel so servia para o teto de desconto do /api/venda. Todo o resto
 * aceitava qualquer sessao valida: um usuario "caixa" podia reescrever a
 * config global da loja (destravar venda sem cliente no crediario, zerar o
 * desconto maximo) e estornar a venda de outro caixa, sem registro de quem.
 * A config e o estorno mexem no dinheiro e nas regras da loja — nao sao do
 * dia a dia do operador de balcao.
 */
const GERENTES = new Set(['admin', 'gerente']);

function ehGerente(usuario) {
  return !!usuario && GERENTES.has(String(usuario.role || '').toLowerCase());
}

function exigeGerente(res, oQue) {
  json(res, { erro: `Seu perfil nao pode ${oQue}.` }, 403);
  return null;
}

/* ---------------- autenticacao ----------------
 *
 * Todo /api exige senao o token do /api/login. Antes disso qualquer
 * dispositivo da rede local lia e alterava clientes, estoque e vendas. Sao
 * duas rotas publicas: o login (que emite o token) e o /api/status (a
 * sondagem que o app faz para saber se o mini PC esta de pe -- nao devolve
 * dado de loja alem de contagens).
 */

const ROTAS_PUBLICAS = new Set(['POST /api/login', 'GET /api/status', 'POST /api/logout']);

function tokenDoRequisicao(req, url) {
  const cab = req.headers['authorization'] || '';
  if (/^Bearer\s+/i.test(cab)) return cab.replace(/^Bearer\s+/i, '').trim();
  /* Fallback para query string, SO em GET/HEAD: e o caminho que o <img> de
   * export usa (nao ha como mandar cabecalho customizado numa tag de imagem).
   * Restringir a GET e HEAD e o que importa: token na URL vaza em log de
   * acesso, em proxy e no historico do navegador, e num POST ele viraria
   * "estado que muda dinheiro pela URL" — basta um linklogado para virar
   * venda nao autorizada. Leitura nao mexe em nada. */
  if (req.method === 'GET' || req.method === 'HEAD') {
    return url.searchParams.get('token') || null;
  }
  return null;
}

/* A migracao e a unica rota de escrita liberada sem sessao, e apenas
 * enquanto o banco nao tiver nenhum usuario: e o primeiro acesso, quando
 * ainda nao existe conta para fazer login. Depois do primeiro usuario, a
 * rota passa a exigir token como todas as outras. Sem essa regra o sistema
 * nao inicializaria -- e sem o "count == 0" a rota ficaria aberta para
 * qualquer um da rede reescrever o banco. */
function migracaoLiberada(chave) {
  if (chave !== 'POST /api/migrar') return false;
  return db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0;
}

function exigeSessao(req, res, url, chave) {
  const token = tokenDoRequisicao(req, url);
  const usuario = usuarioDaSessao(db, token);
  if (!usuario) {
    json(res, { erro: 'Sessao expirada ou ausente. Entre novamente.', codigo: 'sem_sessao' }, 401);
    return null;
  }
  /* A rota precisa saber quem e o operador: o teto de desconto e o papel
     que o servidor le daqui, e nao o que o corpo da venda diz. */
  req.usuario = usuario;
  /* Janela deslizante: cada requisicao autenticada empurra o vencimento.
     E o que evita o logout involuntario no meio do expediente -- o caixa
     que opera o dia inteiro praticamente nunca ve a sessao morrer. */
  req.token = token;
  const novaExpira = renovarSessao(db, token);
  if (novaExpira) res.setHeader('X-Sessao-Expira', novaExpira);
  return usuario;
}

/* ---------------- rotas ---------------- */

const rotas = new Map();
const rota = (metodo, caminho, fn) => rotas.set(`${metodo} ${caminho}`, fn);

/* Descoberta: os caixas chamam isso para saber se o mini PC esta de pe. */
rota('GET', '/api/status', async (req, res) => {
  json(res, {
    ok: true,
    nome: 'Sudam Gestao PDV',
    versao: banco.lerMeta(db, 'versao') || '1.0.0',
    migrado: banco.lerMeta(db, 'migrado') === 'sim',
    produtos: db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n,
    vendas: db.prepare('SELECT COUNT(*) AS n FROM vendas').get().n,
    agora: new Date().toISOString(),
  });
});

rota('POST', '/api/login', async (req, res) => {
  const { usuario, senha } = await corpo(req);
  if (excedeu(req, usuario)) {
    return json(res, { erro: 'Muitas tentativas. Espere 5 minutos e tente de novo.' }, 429);
  }
  const u = db.prepare('SELECT json FROM usuarios WHERE lower(username) = lower(?)').get(String(usuario || '').trim());
  if (!u) return json(res, { erro: 'Usuario ou senha invalidos.' }, 401);
  const reg = JSON.parse(u.json);
  if (reg.active === false) return json(res, { erro: 'Usuario desativado.' }, 403);

  let ok = conferir(senha, reg.sal, reg.senhaHash);
  /* Migracao transparente: se o usuario ainda tem o hash antigo do app, aceita
     esta senha e regrava em scrypt. */
  if (!ok && reg.passHash && reg.passHash === hashAntigo(senha)) {
    const { sal, hash } = gerarHash(senha);
    delete reg.passHash;
    reg.sal = sal;
    reg.senhaHash = hash;
    banco.gravar(db, 'usuarios', reg);
    ok = true;
  }
  if (!ok) return json(res, { erro: 'Usuario ou senha invalidos.' }, 401);

  limparTentativa(req, usuario);
  const sessao = criarSessao(db, reg.username);
  delete reg.senhaHash;
  delete reg.sal;
  delete reg.passHash;
  json(res, { usuario: reg, token: sessao.token, expiraEm: sessao.expiraEm });
});

rota('POST', '/api/logout', async (req, res, url) => {
  encerrarSessao(db, tokenDoRequisicao(req, url));
  json(res, { ok: true });
});

/* O cliente mantem o objeto db em memoria com a mesma forma; este endpoint e
   a fonte da verdade para tudo que muda com pouca frequencia. */
rota('GET', '/api/base', async (req, res) => {
  json(res, {
    config: { ...semente(), ...banco.lerConfig(db) },
    produtos: banco.listar(db, 'produtos'),
    clientes: banco.listar(db, 'clientes'),
    fornecedores: banco.listar(db, 'fornecedores'),
    usuarios: banco
      .listar(db, 'usuarios')
      .map(({ passHash, senhaHash, sal, ...u }) => u),
    proximoSeq: proximoSeq(db),
    /* Turnos entram aqui porque e o unico lugar onde o servidor tem o
     * `cashExpected` — o numero que a conferencia cebra compara com a
     * contagem do gaveteiro. Sem voltar ele, o caixa que recarrega a pagina
     * (ou o mini PC que reinicia) abre o turno com R$ 0 esperado e a
     * conferencia nao tem contra o que conferir. */
    turnos: banco.listar(db, 'turnos'),
  });
});

/* Historico nao vem inteiro: 5 mil vendas nao cabem na memoria de um caixa.
   O cliente pede a janela de que precisa. */
rota('GET', '/api/vendas', async (req, res, url) => {
  /* `Math.min(Number(limite) || 500, 2000)`: com limite negativo o Math.min
   * devolvia o proprio negativo e o SQLite tratava `LIMIT -5` como "sem
   * limite" — a rota que existe para nao carregar 5 mil vendas na memoria do
   * caixa passava a carregar tudo. */
  const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 500, 1), 2000);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const de = url.searchParams.get('de');
  const ate = url.searchParams.get('ate');
  let sql = 'SELECT json, divergencia FROM vendas';
  const where = [];
  const args = [];
  if (de) { where.push('date >= ?'); args.push(de); }
  if (ate) { where.push('date <= ?'); args.push(ate + 'T23:59:59.999Z'); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY seq DESC LIMIT ? OFFSET ?';
  args.push(limite, offset);
  const linhas = db.prepare(sql).all(...args);
  const total = db.prepare('SELECT COUNT(*) AS n FROM vendas').get().n;
  json(res, {
    total,
    vendas: linhas.map((l) => {
      const v = JSON.parse(l.json);
      v.divergencia = !!l.divergencia;
      return v;
    }),
  });
});

/* O coracao do sistema: estoque decidido aqui, em transacao. */
rota('POST', '/api/venda', async (req, res) => {
  const venda = await corpo(req);
  if (!venda || !venda.id) throw Object.assign(new Error('Venda sem id.'), { status: 400 });

  /* Idempotencia: a mesma venda reenviada (reconexao) nao pode duplicar. */
  const jaExiste = db.prepare('SELECT json FROM vendas WHERE id = ?').get(String(venda.id));
  if (jaExiste) {
    const anterior = JSON.parse(jaExiste.json);
    return json(res, { venda: anterior, repetida: true, divergentes: anterior.divergentes || [] });
  }

  const cfg = { ...semente(), ...banco.lerConfig(db) };
  /* O teto de desconto e decidido pelo servidor a partir do perfil, nao
     pelo que o caixa digitou. Um `discount: 99999` num corpo adulterado
     zeraria a venda — o preco unitario estar correto nao impede isso. */
  const TETO = { admin: Infinity, gerente: 50, caixa: 0, estoque: 0 };
  const perfil = (req.usuario && req.usuario.role) || 'caixa';
  const teto = TETO[perfil] === undefined ? 0 : TETO[perfil];
    const r = registrarVenda(db, venda, { loyalty: cfg.loyalty, tetoDesconto: teto, operador: req.usuario });
  json(res, r);
});

/* Estorno: devolve estoque, baixa a divida, tira do turno. Idempotente —
   chamar duas vezes devolve o estoque uma vez so. */
rota('POST', '/api/venda/estornar', async (req, res) => {
  /* O corpo e lido UMA vez: `req` e um stream, e uma segunda leitura volta
   * vazia. */
  const { id, motivo } = await corpo(req);
  const usuario = req.usuario || {};
  if (!id) throw Object.assign(new Error('Informe o id da venda.'), { status: 400 });
  if (!motivo || !String(motivo).trim()) {
    throw Object.assign(new Error('O motivo do estorno e obrigatorio.'), { status: 400 });
  }
  /* Estorno de venda alheia: gerente livre, operador so a propria venda.
   * Um caixa que derruba a venda do colega apaga a venda sem o colleague
   * saber — e o `motivo` nao impede, porque o motivo e texto livre. */
  if (!ehGerente(usuario)) {
    const alvo = banco.obter(db, 'vendas', String(id));
    const minha = alvo && String(alvo.operatorId || '') === String(usuario.id || '');
    if (!minha) return exigeGerente(res, 'estornar venda de outro caixa');
  }
  const r = estornarVenda(db, String(id), String(motivo).trim(), { por: usuario });
  json(res, r);
});

/* Estas duas rotas usavam req.lista em vez do corpo ja lido: req e o objeto
   cru do Node, entao `Array.isArray(req.lista)` era sempre false e caia em
   [undefined], quebrando no gravar(). Toda rota de escrita passa por
   `corpo(req)`.

   A validacao do produto (preco/estoque sem negativo) fica em banco.mjs, e
   nao aqui: `POST /api/produtos` e `POST /api/products` sao rotas diferentes
   que terminam no mesmo upsert, e uma regra escrita aqui era furada pela
   outra. */

rota('POST', '/api/produtos', async (req, res) => {
  const d = await corpo(req);
  const lista = Array.isArray(d.lista) ? d.lista : (d.lista ? [d.lista] : [d]);
  let n = 0;
  for (const p of lista) {
    if (!p || typeof p !== 'object' || !p.id) continue;
    banco.gravar(db, 'produtos', p);
    n++;
  }
  json(res, { gravados: n });
});

rota('GET', '/api/produtos', async (req, res, url) => {
  const busca = (url.searchParams.get('busca') || '').trim();
  if (busca) {
    const linhas = db
      .prepare('SELECT json FROM produtos WHERE name LIKE ? OR code LIKE ? OR category LIKE ? ORDER BY name LIMIT 300')
      .all(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    return json(res, { produtos: linhas.map((l) => JSON.parse(l.json)) });
  }
  json(res, { produtos: banco.listar(db, 'produtos') });
});

rota('POST', '/api/clientes', async (req, res) => {
  const d = await corpo(req);
  const lista = Array.isArray(d.lista) ? d.lista : (d.lista ? [d.lista] : [d]);
  let n = 0;
  for (const c of lista) {
    if (!c || typeof c !== 'object' || !c.id) continue;
    banco.gravar(db, 'clientes', c);
    n++;
  }
  json(res, { gravados: n });
});

rota('POST', '/api/caixa/abrir', async (req, res) => {
  const t = await corpo(req);
  /* Abertura guarda QUEM abriu. O estorno compara este campo para saber se o
   * operador pode derrubar a venda. Sem ele, todo mundo pode derrubar tudo. */
  const turno = {
    id: t.id || 'T' + Date.now(),
    operatorId: t.operatorId || (req.usuario && req.usuario.id) || null,
    operator: t.operator || (req.usuario && req.usuario.name) || null,
    openedAt: new Date().toISOString(),
    closedAt: null,
    opening: Number(t.opening) || 0,
    cashExpected: Number(t.opening) || 0,
    sales: [],
    movements: [],
    counted: null,
    difference: null,
    blind: false,
  };
  banco.gravar(db, 'turnos', turno);
  json(res, { turno });
});

rota('POST', '/api/caixa/fechar', async (req, res) => {
  const { id, contado, cego } = await corpo(req);
  const t = banco.obter(db, 'turnos', id);
  if (!t) throw Object.assign(new Error('Turno nao encontrado.'), { status: 404 });
  t.closedAt = new Date().toISOString();
  t.counted = Number(contado);
  t.blind = !!cego;
  t.difference = Math.round(((Number(contado) || 0) - (Number(t.cashExpected) || 0)) * 100) / 100;
  banco.gravar(db, 'turnos', t);
  json(res, { turno: t });
});

/* Migracao do que ja existe no localStorage dos caixas.
 * Publica apenas enquanto o banco nao tiver nenhum usuario (primeira
 * instalacao); depois disso ela exige sessao, como todo o resto. */
rota('POST', '/api/migrar', async (req, res) => {
  const d = await corpo(req, CORPO_MIGRACAO);
  const contagem = {};
  db.exec('BEGIN');
  try {
    banco.gravarVarios(db, 'produtos', d.products || []);
    banco.gravarVarios(db, 'clientes', d.customers || []);
    banco.gravarVarios(db, 'fornecedores', d.suppliers || []);
    banco.gravarVarios(db, 'vendas', d.sales || []);
    banco.gravarVarios(db, 'lancamentos', d.entries || []);
    banco.gravarVarios(db, 'turnos', d.shifts || []);
    banco.gravarVarios(db, 'compras', d.purchases || []);
    banco.gravarVarios(db, 'contas_pagar', d.payables || []);
    /* A senha sobe como esta; o hash antigo (FNV-1a) e convertido em scrypt
       no primeiro login, sem obrigar o gerente a recriar senha. */
    for (const u of (d.auth && d.auth.users) || []) {
      banco.gravar(db, 'usuarios', { ...u, passHash: u.passHash });
    }
    if (d.config) banco.gravarConfig(db, d.config);
    if (d.loyalty) banco.gravarConfig(db, { loyalty: d.loyalty });
    banco.gravarMeta(db, 'migrado', 'sim');
    banco.gravarMeta(db, 'migradoEm', new Date().toISOString());
    contagem.produtos = (d.products || []).length;
    contagem.clientes = (d.customers || []).length;
    contagem.vendas = (d.sales || []).length;
    contagem.lancamentos = (d.entries || []).length;
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
  json(res, { ok: true, contagem });
});

/* ---------------- colecoes genericas ----------------
 *
 * Antes so existiam rotas soltas para produtos e clientes. Qualquer outra
 * colecao que o app edita (lancamentos, compras, contas a pagar, turnos,
 * fornecedores) nao tinha endpoint, entao esses dados nunca chegavam ao
 * servidor. Uma unica rota por colecao cobre a lista inteira e a escrita
 * usa o mesmo upsert do banco.
 */
/* `quotes` saiu da lista: nao ha tabela `quotes` no schema nem uso no app
   (nenhuma referencia a db.quotes em js/). Deixar o nome aqui era inerte —
   tabelaDe devolvia null e o laco pulava. */
const COLECOES = ['products', 'customers', 'suppliers', 'entries', 'purchases', 'payables', 'heldSales'];

/* Alias em portugues. O app fala `produtos` e `clientes` (e sao as duas
   colecoes mais usadas), enquanto o resto do vocabulario interno e anglais.
 * Sem estes alias, o POST /api/products respondia "Rota inexistente" e o
   cadastro de produto nunca chegava ao servidor — que era exatamente o
 * caminho que o `marcarCadastro` usa. */
const ALIAS = { produtos: 'products', clientes: 'customers', fornecedores: 'suppliers' };

for (const nome of COLECOES) {
  const tabela = banco.tabelaDe(nome);
  if (!tabela) continue;

  rota('GET', `/api/${nome}`, async (req, res) => {
    json(res, { [nome]: banco.listar(db, tabela) });
  });

  rota('POST', `/api/${nome}`, async (req, res) => {
    const d = await corpo(req);
    const lista = Array.isArray(d) ? d : Array.isArray(d.lista) ? d.lista : [d.lista || d];
    const validos = lista.filter((o) => o && typeof o === 'object' && o.id);
    const n = banco.gravarVarios(db, tabela, validos);
    json(res, { gravados: n });
  });

  /* Alias so no POST, e SEMPRE sem sobrescrever: as rotas dedicadas de
   * /api/produtos e /api/clientes ja foram declaradas acima e sao as
   * verdadeiras. Antes o `rotas.set` apagava a rota dedicada e deixava a
   * generica no lugar — invisivel para quem lia o codigo, e a razao de uma
   * validacao em uma rota ser furada pela outra. */
  const pt = Object.keys(ALIAS).find((k) => ALIAS[k] === nome);
  if (pt && pt !== nome) {
    const chavePt = `POST /api/${pt}`;
    if (!rotas.has(chavePt)) rotas.set(chavePt, rotas.get(`POST /api/${nome}`));
  }
}

/* Turnos e usuarios ficam de fora de proposito: os dois tem regra propria
   (abrir/fechar com conferencia cega, e hash de senha). Gravar por cima
   deixaria um turno sem cashExpected, que e exatamente o numero que a
   conferencia do caixa compara. */

/* Sondagem autenticada e leve. Existe separada do /api/status (que e
   publico) porque e ela que o cliente usa para manter a sessao viva: tem de
   devolver 401 quando o token morreu, e o status publico nunca devolve. */
rota('GET', '/api/sessao', async (req, res) => {
  json(res, { usuario: { id: req.usuario.id, name: req.usuario.name, username: req.usuario.username, role: req.usuario.role } });
});

rota('GET', '/api/config', async (req, res) => {
  json(res, { config: { ...semente(), ...banco.lerConfig(db) } });
});

rota('POST', '/api/config', async (req, res) => {
  /* Config e regra da loja (desconto maximo, exigir cliente no crediario,
   * modo de balcao). Mudar isso nao e tarefa de quem esta no balcao. */
  if (!ehGerente(req.usuario)) return exigeGerente(res, 'alterar a configuracao da loja');
  const d = await corpo(req);
  const cfg = d.config && typeof d.config === 'object' ? d.config : d;
  delete cfg.pix; // segredo do Pix nunca sobe cru pelo corpo da config
  banco.gravarConfig(db, cfg);
  json(res, { ok: true, config: { ...semente(), ...banco.lerConfig(db) } });
});

/* ---------------- arquivos estaticos ---------------- */

/* Pastas e extensoes que nunca podem sair por HTTP.
 *
 * A versao anterior servia qualquer arquivo sob RAIZ_APP, e RAIZ_APP contem
 * servidor/dados/sudam.db. Um GET /servidor/dados/sudam.db baixava o banco
 * inteiro -- clientes, CPF, dividas e hashes de senha -- sem digitar senha
 * nenhuma. A lista abaixo e uma defesa em profundidade: mesmo que a
 * checagem de caminho escape, o arquivo nao e servido. */
const BLOQUEADOS_DIR = ['servidor', '_backup', 'ANUNCIO-MERCADO-LIVRE', 'icone', 'dist', '.git', 'node_modules'];
const BLOQUEADOS_EXT = ['.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.bak', '.log', '.key', '.pem', '.env', '.iss'];

function bloqueado(rel) {
  const partes = rel.split('/').filter(Boolean);
  if (!partes.length) return false;
  // Qualquer segmento da lista bloqueia o arquivo inteiro.
  if (partes.some((s) => BLOQUEADOS_DIR.includes(s) || BLOQUEADOS_DIR.includes(s.toLowerCase()))) return true;
  const ext = extname(partes[partes.length - 1]).toLowerCase();
  if (BLOQUEADOS_EXT.includes(ext)) return true;
  // .db seguido de qualquer coisa (sudam.db.2026-09-28_1900) tambem e backup.
  if (/\.db(\.|$)/i.test(partes[partes.length - 1])) return true;
  return false;
}

/* O app nao usa nenhum recurso externo, entao a CSP fecha tudo que nao for
   a propria origem. 'unsafe-inline' no style e necessario porque o app
   escreve style= no HTML; o script segue restrito a 'self'. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

async function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (bloqueado(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECALHOS_SEGURANCA });
    res.end('Proibido');
    return;
  }
  /* Impede sair da pasta do app por "../".
     A checagem precisa de separador: startsWith(RAIZ_APP) sozinho aceitaria
     uma pasta irma chamada "proximo PDV MERCADO-SECRETO", porque o prefixo
     bate e o arquivo e de outra pasta. */
  const alvo = normalize(join(RAIZ_APP, rel));
  if (alvo !== RAIZ_APP && !alvo.startsWith(RAIZ_APP + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECALHOS_SEGURANCA });
    res.end('Proibido');
    return;
  }
  try {
    const s = await stat(alvo);
    if (s.isDirectory()) throw new Error('dir');
    const dados = await readFile(alvo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(alvo).toLowerCase()] || 'application/octet-stream',
      'Content-Length': dados.length,
      'Cache-Control': 'no-cache',
      ...CABECALHOS_SEGURANCA,
    });
    res.end(dados);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECALHOS_SEGURANCA });
    res.end('Nao encontrado');
  }
}

/* ---------------- HTTPS opcional ----------------
 *
 * Num PDV de LAN isolada, HTTP e aceitavel. Mas se a maquina estiver
 * atras de um roteador com port forwarding, ou se alguem acessar por
 * VPN, o token de sessao e a senha do admin trafegam em texto puro.
 *
 * Ligar e opcional e por ambiente: SUDAM_TLS=1 com SUDAM_CERT e
 * SUDAM_KEY apontando para um .pem. Sem essas duas, o servidor avisa e
 * sobe em HTTP mesmo assim -- recusar outright deixaria o PDV sem
 * funcionar num micro que o usuario ainda nao configurou.
 */
function opcoesTls() {
  if (process.env.SUDAM_TLS !== '1') return null;
  const cert = process.env.SUDAM_CERT;
  const key = process.env.SUDAM_KEY;
  if (!cert || !key) {
    console.warn('  AVISO: SUDAM_TLS=1 mas SUDAM_CERT/SUDAM_KEY nao definidos.');
    console.warn('  Subindo em HTTP mesmo assim (so e seguro em rede isolada).');
    return null;
  }
  try {
    return { cert: readFileSync(cert), key: readFileSync(key) };
  } catch (e) {
    console.warn('  AVISO: nao consegui ler o certificado (' + e.message + ').');
    console.warn('  Subindo em HTTP mesmo assim.');
    return null;
  }
}

/* Onde escutar. 0.0.0.0 e o certo numa loja (os 5 caixas precisam
 * entrar), mas e tambem o que expoe o servidor para a internet se
 * alguem redirigir a porta no roteador. SUDAM_HOST permite prender numa
 * interface especifica quando so a rede local importa. */
const HOST = process.env.SUDAM_HOST || '0.0.0.0';
const tls = opcoesTls();
const PROTOCOLO = tls ? 'https' : 'http';

async function tratar(req, res) {
  const url = new URL(req.url, `${PROTOCOLO}://${req.headers.host || 'localhost'}`);
  const chave = `${req.method} ${url.pathname}`;
  const fn = rotas.get(chave);
  try {
    if (fn) {
      /* Toda /api exige sessao, exceto as publicas declaradas acima. */
      if (chave.includes(' /api/') && !ROTAS_PUBLICAS.has(chave) && !migracaoLiberada(chave)) {
        if (!exigeSessao(req, res, url, chave)) return; // ja respondeu 401
      }
      return await fn(req, res, url);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await servirEstatico(req, res, url);
    json(res, { erro: 'Rota inexistente' }, 404);
  } catch (e) {
    erro(res, e);
  }
}

const servidor = tls
  ? createHttpsServer(tls, tratar)
  : createServer(tratar);

/* Isto aqui e SO decoracao do terminal: mostra os IPs para o gerente digitar
 * nos caixas. Nao tem nenhuma funcao no sistema -- e o servidor ja esta
 * escutando e vendendo quando isto roda. E mesmo assim `os.networkInterfaces()`
 * pode lancar: no WSL, em container restrito e com alguns drivers de VPN ele
 * falha com uv_interface_addresses. Como a chamada estava solta, uma
 * enumeracao de placa de rede derrubava a loja inteira depois de subir.
 * Falhar bonito e melhor do que derrubar o caixa. */
function ipsLocais() {
  const out = [];
  let mapa;
  try {
    mapa = networkInterfaces();
  } catch (e) {
    console.log('  (nao deu para listar os enderecos de rede: ' + e.message + ')');
    return out;
  }
  for (const lista of Object.values(mapa || {})) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

servidor.listen(PORTA, HOST, () => {
  banco.gravarMeta(db, 'versao', '1.0.0');
  /* Nada do que vem a seguir pode derrubar o processo: e informacao de
   * diagnostico, escrita depois do "no ar". */
  try {
    const ips = ipsLocais();
    console.log('Sudam Gestao PDV - servidor no ar');
    console.log('  neste PC:  ' + PROTOCOLO + '://localhost:' + PORTA);
    for (const ip of ips) console.log('  na rede:   ' + PROTOCOLO + '://' + ip + ':' + PORTA);
    console.log('  escutando: ' + HOST + ':' + PORTA + (tls ? ' (TLS)' : ' (sem TLS)'));
    console.log('  dados em: ' + banco.caminhoBanco());
    console.log('  ' + ips.length + ' endereco(s) de rede -- anote o que aparece em "na rede".');
    if (!tls) {
      console.log('');
      console.log('  ATENCAO: sem HTTPS. Numa rede isolada da loja isso e aceitavel.');
      console.log('  Se a maquina estiver acessivel pela internet, gere um certificado');
      console.log('  e ligue SUDAM_TLS=1 + SUDAM_CERT + SUDAM_KEY (ver README).');
    }
  } catch (e) {
    console.error('  (falha ao escrever o resumo de rede: ' + e.message + ')');
  }
});

/* ---------------- sobreviver a falha ----------------
 *
 * Este processo e a loja inteira: se ele cai, os 5 caixas param de vender ate
 * alguem notar e religar o mini PC. O padrao do Node 22+ e encerrar o
 * processo em `uncaughtException`/`unhandledRejection` — bom para um servidor
 * na nuvem que alguem monitora, ruim para o PDV de um mercadinho. Aqui a
 * falha e registrada e o servidor continua de pe; o que nao da para recuperar
 * (estado corrompido em memoria) e no caso raro de nao dar para seguir.
 */
process.on('unhandledRejection', (motivo) => {
  console.error('[promessa rejeitada]', motivo);
});
/* Uma excecao nao tratada nao significa "so um log": o estado em memoria pode
 * ja estar inconsistente (meio de gravacao begun, transacao aberta, sequencia
 * lida fora de ordem). Continuar vendendo sobre esse estado e a forma de
 * transformar um erro em dados corrompidos. O Node tambem avisa disso na
 * documentacao. Entao: registra, fecha o banco com o que da, e sai com codigo
 * de erro. Quem reergue e o systemd (Restart=always), e ai o processo novo
 * comeca do banco em disco, que esta integro. */
process.on('uncaughtException', (e) => {
  console.error('[excecao na tratada]', e);
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); } catch {}
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[promessa rejeitada sem tratamento]', e);
});

/* Desligar com Ctrl+C ou pelo "Encerrar" do Windows precisa fechar o banco:
 * sem isso o WAL fica pela metade e o proximo boot pode ter que recuperar —
 * o que funciona, mas em outro processo que nao pode falhar. */
let encerrando = false;
function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log('\n' + sinal + ' recebido. Fechando o banco...');
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  try { fazerBackupAgora(db); } catch (e) { console.error('[backup] falhou no desligamento:', e.message); }
  servidor.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  /* Nao espera conexao pendurada para sempre: um caixa ainda com a tela
   * aberta perde a venda, mas o banco ja foi fechado acima. */
  setTimeout(() => {
    try { db.close(); } catch {}
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

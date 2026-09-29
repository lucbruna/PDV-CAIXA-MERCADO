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
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import * as banco from './banco.mjs';
import { gerarHash, conferir, hashAntigo, criarSessao, usuarioDaSessao, encerrarSessao, iniciarSessoes } from './auth.mjs';
import { registrarVenda, proximoSeq } from './venda.mjs';
import { iniciarBackup } from './backup.mjs';

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

function json(res, dados, codigo = 200) {
  const corpo = JSON.stringify(dados);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

function erro(res, e) {
  const codigo = e && e.status ? e.status : 500;
  if (codigo >= 500) console.error('[erro]', e);
  json(res, { erro: (e && e.message) || 'Erro interno', codigo: e && e.codigo }, codigo);
}

async function corpo(req) {
  const pedacos = [];
  for await (const p of req) pedacos.push(p);
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
  // Fallback para query string: usar o token no cabecalho e o certo, mas
  // alguns clientes de rede (e o <img> de export) nao enviam custom header.
  return url.searchParams.get('token') || null;
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
  });
});

/* Historico nao vem inteiro: 5 mil vendas nao cabem na memoria de um caixa.
   O cliente pede a janela de que precisa. */
rota('GET', '/api/vendas', async (req, res, url) => {
  const limite = Math.min(Number(url.searchParams.get('limite')) || 500, 2000);
  const offset = Number(url.searchParams.get('offset')) || 0;
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
  const r = registrarVenda(db, venda, { loyalty: cfg.loyalty, tetoDesconto: teto });
  json(res, r);
});

/* Estas duas rotas usavam req.lista em vez do corpo ja lido: req e o objeto
   cru do Node, entao `Array.isArray(req.lista)` era sempre false e caia em
   [undefined], quebrando no gravar(). Toda rota de escrita passa por
   `corpo(req)`. */
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
  const turno = {
    id: t.id || 'T' + Date.now(),
    operatorId: t.operatorId || null,
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
  const d = await corpo(req);
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
const COLECOES = ['products', 'customers', 'suppliers', 'entries', 'purchases', 'payables', 'quotes', 'heldSales'];

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
}

/* Turnos e usuarios ficam de fora de proposito: os dois tem regra propria
   (abrir/fechar com conferencia cega, e hash de senha). Gravar por cima
   deixaria um turno sem cashExpected, que e exatamente o numero que a
   conferencia do caixa compara. */

rota('GET', '/api/config', async (req, res) => {
  json(res, { config: { ...semente(), ...banco.lerConfig(db) } });
});

rota('POST', '/api/config', async (req, res) => {
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

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
});

function ipsLocais() {
  const out = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

servidor.listen(PORTA, '0.0.0.0', () => {
  banco.gravarMeta(db, 'versao', '1.0.0');
  console.log('Sudam Gestao PDV - servidor no ar');
  console.log('  neste PC:  http://localhost:' + PORTA);
  for (const ip of ipsLocais()) console.log('  na rede:   http://' + ip + ':' + PORTA);
  console.log('  dados em: ' + banco.caminhoBanco());
  console.log('  ' + ipsLocais().length + ' endereco(s) de rede -- anote o que aparece em "na rede".');
});

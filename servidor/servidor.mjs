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
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import * as banco from './banco.mjs';
import { gerarHash, conferir, hashAntigo } from './auth.mjs';
import { registrarVenda, proximoSeq } from './venda.mjs';
import { iniciarBackup } from './backup.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = join(aqui, '..');
const PORTA = Number(process.env.SUDAM_PORTA || 8787);

const db = banco.abrir();
iniciarBackup(db);

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

  delete reg.senhaHash;
  delete reg.sal;
  json(res, { usuario: reg });
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
  const r = registrarVenda(db, venda, { loyalty: cfg.loyalty });
  json(res, r);
});

rota('POST', '/api/produtos', async (req, res) => {
  const lista = Array.isArray(req.lista) ? req.lista : [req.lista];
  let n = 0;
  for (const p of lista) { banco.gravar(db, 'produtos', p); n++; }
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
  const lista = Array.isArray(req.lista) ? req.lista : [req.lista];
  for (const c of lista) banco.gravar(db, 'clientes', c);
  json(res, { gravados: lista.length });
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

/* Migracao do que ja existe no localStorage dos caixas. */
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

/* ---------------- arquivos estaticos ---------------- */

async function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  /* Impede sair da pasta do app por "../". */
  const alvo = normalize(join(RAIZ_APP, rel));
  if (!alvo.startsWith(RAIZ_APP)) {
    res.writeHead(403).end('Proibido');
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
    });
    res.end(dados);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nao encontrado');
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const chave = `${req.method} ${url.pathname}`;
  const fn = rotas.get(chave);
  try {
    if (fn) return await fn(req, res, url);
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

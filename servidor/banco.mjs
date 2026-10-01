/* Banco do servidor.
 *
 * Decisao importante: cada colecao guarda o objeto JSON do app exatamente como
 * ele ja e, mais colunas so onde o servidor precisa consultar (data, total,
 * codigo de barras). Isso evita mapear 18 colecoes campo a campo -- o
 * formato do cliente continua identico ao de hoje, entao nenhuma das 101
 * leituras de Store.db no cliente precisa mudar.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centavos, arred2 } from './dinheiro.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));

/* Onde o banco morava ate agora: `servidor/dados`, DENTRO da pasta do
   programa. No Windows (instalacao por usuario em %LOCALAPPDATA%\Programs\...)
   isso significa que apagar ou reinstalar a pasta leva junto o historico de
   vendas. Este e o caminho antigo, mantido para migrar quem ja tem dados. */
const LEGADO = join(aqui, 'dados', 'sudam.db');

/* Resolve o caminho uma vez e guarda. A pasta de backup acompanha este
   resultado (ver caminhoBackup), entao a copia nunca cai num disco diferente
   do banco sem querer. */
let _arquivo = null;

/* A pasta de backup acompanha o banco. Se SUDAM_DB aponta para outro disco,
   o backup precisa ir para o lado daquele banco -- senao o .db fica em
   C:\dados e as copias em C:\programa\servidor\dados\backup, que e
   exatamente o que a documentacao promete proteger contra ("pasta
   separada"). */
export function caminhoBackup() {
  return process.env.SUDAM_BACKUP || join(dirname(caminhoBanco()), 'backup');
}

/* Na primeira vez que o servidor sobe numa instalacao Windows antiga, copia o
   banco de dentro da pasta do programa para o novo local persistente. A copia
   (e nao o movimento) deixa o arquivo antigo no lugar: se algo der errado, os
   dados continuam onde estavam. Se a copia falhar, seguimos usando o banco
   antigo em vez de comecar um vazio -- perder venda e o pior resultado. */
function adotarBancoLegado(destino) {
  if (destino === LEGADO) return LEGADO;
  if (existsSync(destino) || !existsSync(LEGADO)) return destino;
  try {
    mkdirSync(dirname(destino), { recursive: true });
    for (const sufixo of ['', '-wal', '-shm']) {
      if (existsSync(LEGADO + sufixo)) copyFileSync(LEGADO + sufixo, destino + sufixo);
    }
    console.log('  banco da instalacao anterior copiado para: ' + destino);
    return destino;
  } catch (e) {
    console.error('  (nao deu para copiar o banco antigo: ' + e.message + ')');
    console.error('  continuando a usar o banco em: ' + LEGADO);
    return LEGADO;
  }
}

export function caminhoBanco() {
  if (_arquivo) return _arquivo;
  if (process.env.SUDAM_DB) {
    _arquivo = process.env.SUDAM_DB;
    return _arquivo;
  }
  /* Windows: %ProgramData% e gravavel por usuario comum e vive fora da pasta
     do programa, entao reinstalar o PDV nao apaga mais o historico. */
  if (process.platform === 'win32' && process.env.ProgramData) {
    _arquivo = adotarBancoLegado(join(process.env.ProgramData, 'Sudam Gestao PDV', 'dados', 'sudam.db'));
    return _arquivo;
  }
  _arquivo = LEGADO;
  return _arquivo;
}

export function abrir() {
  const arquivo = caminhoBanco();
  mkdirSync(dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);

  // WAL: o servidor continua lendo enquanto o backup copia o arquivo.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  /* As colunas de dinheiro (price, debt, total, amount) sao INTEGER em
     CENTAVOS inteiros -- ver dinheiro.mjs. O JSON ao lado continua em reais,
     que e o contrato do cliente; a coluna e so um espelho tipado. `stock` e
     quantidade, nao dinheiro, e mantem os decimais. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      category TEXT,
      price INTEGER,
      stock REAL,
      divergencia INTEGER DEFAULT 0,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_prod_code ON produtos(code);
    CREATE INDEX IF NOT EXISTS ix_prod_name ON produtos(name);
    CREATE INDEX IF NOT EXISTS ix_prod_cat  ON produtos(category);

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      name TEXT,
      cpf TEXT,
      debt INTEGER,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_cli_name ON clientes(name);

    CREATE TABLE IF NOT EXISTS fornecedores (
      id TEXT PRIMARY KEY,
      name TEXT,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendas (
      id TEXT PRIMARY KEY,
      seq INTEGER,
      date TEXT,
      shiftId TEXT,
      operatorId TEXT,
      customerId TEXT,
      total INTEGER,
      forma TEXT,
      divergencia INTEGER DEFAULT 0,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_venda_date ON vendas(date);
    CREATE INDEX IF NOT EXISTS ix_venda_seq  ON vendas(seq);
    CREATE INDEX IF NOT EXISTS ix_venda_cli  ON vendas(customerId);
    CREATE INDEX IF NOT EXISTS ix_venda_turno ON vendas(shiftId);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_venda_seq ON vendas(seq) WHERE seq IS NOT NULL;

    CREATE TABLE IF NOT EXISTS lancamentos (
      id TEXT PRIMARY KEY,
      date TEXT,
      type TEXT,
      category TEXT,
      amount INTEGER,
      customerId TEXT,
      source TEXT,
      settled INTEGER DEFAULT 0,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_lanc_date ON lancamentos(date);
    CREATE INDEX IF NOT EXISTS ix_lanc_cli  ON lancamentos(customerId);

    CREATE TABLE IF NOT EXISTS turnos (
      id TEXT PRIMARY KEY,
      operatorId TEXT,
      openedAt TEXT,
      closedAt TEXT,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compras (
      id TEXT PRIMARY KEY,
      date TEXT,
      supplierId TEXT,
      total INTEGER,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id TEXT PRIMARY KEY,
      date TEXT,
      dueDate TEXT,
      amount INTEGER,
      paid INTEGER DEFAULT 0,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      name TEXT,
      role TEXT,
      active INTEGER DEFAULT 1,
      json TEXT NOT NULL
    );

    /* Config e categorias sao poucos e lidos o tempo todo: cabem inteiros. */
    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    /* Venda suspensa (parked sale) fica so no terminal que prendeu. */
    CREATE TABLE IF NOT EXISTS vendas_suspensas (
      id TEXT PRIMARY KEY,
      terminal TEXT,
      json TEXT NOT NULL
    );

    /* Controle de migracao e de schema. */
    CREATE TABLE IF NOT EXISTS meta (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    /* Sessoes: o token do login vive aqui, nao em memoria, para que um
       reinicio do mini PC nao desconecte os 5 caixas no meio do expediente. */
    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario TEXT NOT NULL,
      criadoEm TEXT,
      expiraEm TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_sessao_expira ON sessoes(expiraEm);
  `);

  /* Bancos criados antes desta coluna existem em maquinas ja instaladas.
     CREATE TABLE IF NOT EXISTS nao altera tabela existente, entao a coluna
     nova e adicionada aqui, de forma idempotente. */
  const colProdutos = db.prepare('PRAGMA table_info(produtos)').all();
  if (colProdutos.length && !colProdutos.some((c) => c.name === 'divergencia')) {
    db.exec('ALTER TABLE produtos ADD COLUMN divergencia INTEGER DEFAULT 0');
  }

  migrarParaCentavos(db);
  return db;
}

/* ---------- dinheiro em centavos ----------
 *
 * Bancos criados antes desta mudanca guardavam reais em ponto flutuante nas
 * colunas de dinheiro. A conversao roda UMA vez e grava a flag em `meta`; sem
 * ela o valor seria multiplicado por 100 a cada boot (5000 -> 500000 -> ...).
 *
 * O JSON nao e tocado: ele sempre esteve, e continua, em reais. */
function migrarParaCentavos(db) {
  if (lerMeta(db, 'centavos') === 'sim') return;
  const alvos = [
    ['produtos', 'price'],
    ['clientes', 'debt'],
    ['vendas', 'total'],
    ['compras', 'total'],
    ['lancamentos', 'amount'],
    ['contas_pagar', 'amount'],
  ];
  for (const [tabela, coluna] of alvos) {
    try {
      db.exec(`UPDATE ${tabela} SET ${coluna} = ROUND(${coluna} * 100) WHERE ${coluna} IS NOT NULL`);
    } catch { /* tabela ausente em banco exotico: nada a converter */ }
  }
  gravarMeta(db, 'centavos', 'sim');
}

/* ---------- acesso generico por colecao ---------- */

const MAPA = {
  /* `products` faltava aqui: o laco de rotas genericas em servidor.mjs
     consulta tabelaDe('products') e recebia null, entao /api/products nunca
     era registrada. Isso derrubava o cadastro de produto no servidor. */
  products: 'produtos',
  produtos: 'produtos',
  customers: 'clientes',
  clientes: 'clientes',
  suppliers: 'fornecedores',
  fornecedores: 'fornecedores',
  sales: 'vendas',
  vendas: 'vendas',
  entries: 'lancamentos',
  lancamentos: 'lancamentos',
  shifts: 'turnos',
  turnos: 'turnos',
  purchases: 'compras',
  compras: 'compras',
  payables: 'contas_pagar',
  contas_pagar: 'contas_pagar',
  users: 'usuarios',
  heldSales: 'vendas_suspensas',
};

export function tabelaDe(colecao) {
  return MAPA[colecao] || null;
}

export function listar(db, tabela) {
  const linhas = db.prepare(`SELECT json FROM ${tabela}`).all();
  return linhas.map((l) => JSON.parse(l.json));
}

export function obter(db, tabela, id) {
  const l = db.prepare(`SELECT json FROM ${tabela} WHERE id = ?`).get(id);
  return l ? JSON.parse(l.json) : null;
}

export function gravar(db, tabela, obj, opcoes = {}) {
  const { sql, args } = sqlDoUpsert(tabela, opcoes.interno ? obj : sanear(tabela, obj));
  db.prepare(sql).run(...args);
  return obj;
}

/* ---------- saneamento por tabela ----------
 *
 * A validacao mora AQUI, e nao nas rotas, por um motivo concreto: `POST
 * /api/produtos` (rota dedicada) e `POST /api/products` (rota gerica, com
 * alias em portugues) passam pelo mesmo upsert. Uma regra escrita na rota
 * dedicada era ignorada pela generica — foi assim que `price: -500` e
 * `stock: -999` entraram no banco mesmo com a rota dedicada validando.
 *
 * Preco negativo faz a venda virar devolucao de dinheiro no gaveteiro;
 * estoque negativo some do produto na busca. O sistema aceita vender abaixo
 * do estoque DE PROPITO (divergencia, conferida depois pelo gerente), mas
 * isso e o resultado da venda, nunca um valor digitado no cadastro.
 *
 * `gravarVarios` (usado pela migracao do localStorage) tambem valida, e no
 * mesmo lugar: `POST /api/produtos` e `POST /api/products` sao rotas
 * diferentes que terminam no mesmo upsert, e uma regra escrita na rota
 * dedicada era furada pela outra. Os dados legados passam por `sanear`
 * assim como o cadastro novo.
 *
 * A venda em si NAO valida: e ela que produz o estoque negativo ao vender
 * mais do que tem, e grava com `{ interno: true }`. Sem essa distincao a
 * validacao defenderia o cadastro e quebraria a regra da casa.
 */
function sanear(tabela, obj) {
  if (tabela !== 'produtos') return obj;
  const saida = { ...obj };
  if (saida.stockDeposit == null && saida.stockSales == null) {
    const stock = Number(saida.stock) || 0;
    saida.stockDeposit = saida.stockArea === 'venda' ? 0 : stock;
    saida.stockSales = saida.stockArea === 'venda' ? stock : 0;
  }
  const preco = Number(saida.price);
  if (Number.isFinite(preco)) {
    saida.price = arred2(preco);
    if (saida.price < 0) throw Object.assign(new Error('Preco nao pode ser negativo.'), { status: 400 });
  }
  const estoque = Number(saida.stock);
  if (Number.isFinite(estoque)) {
    saida.stock = arred2(estoque);
    if (saida.stock < 0) throw Object.assign(new Error('Estoque nao pode ser negativo no cadastro.'), { status: 400 });
  }
  /* Texto sem teto vira peso morto: o .db inteiro e copiado a cada hora. */
  for (const campo of ['name', 'code', 'category', 'barcode', 'supplier']) {
    if (typeof saida[campo] === 'string' && saida[campo].length > 500) saida[campo] = saida[campo].slice(0, 500);
  }
  return saida;
}

/* ---------- acesso generico por colecao ---------- */

/* SQLite nao permite BEGIN dentro de BEGIN. /api/migrar involve varias
   colecoes numa transacao so, e cada gravarVarios abria a sua propria --
   o resultado era "cannot start a transaction within a transaction" e a
   migracao inteira devolvia 500. Estes dois helpers prestam conta de uma
   transacao que ja esteja aberta. */
function emTransacao(db) {
  try { return db.isTransaction; } catch { return false; }
}

export function gravarVarios(db, tabela, lista) {
  if (!lista.length) return 0;
  const cols = colunas(tabela);
  /* `json` entra como coluna do INSERT -- ver nota em sqlDoUpsert. Sem ela
     toda gravacao batia em NOT NULL e nada era persistido. */
  const nomes = ['id', ...cols, 'json'];
  const marcadores = nomes.map(() => '?').join(', ');
  const atualiza = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  const sql = `INSERT INTO ${tabela} (${nomes.join(', ')}) VALUES (${marcadores})
               ON CONFLICT(id) DO UPDATE SET json = excluded.json${atualiza ? ', ' + atualiza : ''}`;
  const st = db.prepare(sql);
  const propria = !emTransacao(db);
  if (propria) db.exec('BEGIN');
  try {
    for (const obj of lista) st.run(...linhaDe(tabela, obj));
    if (propria) db.exec('COMMIT');
  } catch (e) {
    if (propria) db.exec('ROLLBACK');
    throw e;
  }
  return lista.length;
}

function linhaDe(tabela, obj) {
  const limpo = sanear(tabela, obj);
  const cols = colunas(tabela);
  return [limpo.id, ...cols.map((c) => valorColuna(c, limpo)), JSON.stringify(limpo)];
}

export function remover(db, tabela, id) {
  db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
}

function colunas(t) {
  switch (t) {
    case 'produtos': return ['code', 'name', 'category', 'price', 'stock', 'divergencia'];
    case 'clientes': return ['name', 'cpf', 'debt'];
    case 'fornecedores': return ['name'];
    case 'vendas': return ['seq', 'date', 'shiftId', 'operatorId', 'customerId', 'total', 'forma', 'divergencia'];
    case 'lancamentos': return ['date', 'type', 'category', 'amount', 'customerId', 'source', 'settled'];
    case 'turnos': return ['operatorId', 'openedAt', 'closedAt'];
    case 'compras': return ['date', 'supplierId', 'total'];
    case 'contas_pagar': return ['date', 'dueDate', 'amount', 'paid'];
    case 'usuarios': return ['username', 'name', 'role', 'active'];
    case 'vendas_suspensas': return ['terminal'];
    default: return [];
  }
}

/* Colunas que guardam dinheiro, e por isso vao para o banco em CENTAVOS
 * inteiros. O valor no JSON continua em reais. */
const COLUNAS_CENTAVOS = new Set(['price', 'debt', 'total', 'amount']);

function valorColuna(col, obj) {
  if (!col) return null;
  if (col === 'forma') {
    const p = Array.isArray(obj.payments) ? obj.payments : [];
    return p.length ? p.map((x) => x.method).join('+') : null;
  }
  if (col === 'divergencia') return obj.divergencia ? 1 : 0;
  if (col === 'settled') return obj.settled ? 1 : 0;
  if (col === 'paid') return obj.paid ? 1 : 0;
  if (col === 'active') return obj.active === false ? 0 : 1;
  if (COLUNAS_CENTAVOS.has(col)) {
    return obj[col] === undefined || obj[col] === null ? null : centavos(obj[col]);
  }
  return obj[col] === undefined ? null : obj[col];
}

function sqlDoUpsert(t, obj) {
  const cols = colunas(t);
  /* A coluna `json` precisa entrar na lista de colunas do INSERT. A versao
     anterior montava a lista como ['id', ...cols] e o ON CONFLICT repetia
     `json = excluded.json` -- mas json nunca era inserido, e a coluna e
     NOT NULL. Resultado: "NOT NULL constraint failed: produtos.json" na
     primeira gravacao, ou seja, o servidor nunca gravou nada mesmo. */
  const nomes = ['id', ...cols, 'json'];
  const vals = [obj.id, ...cols.map((c) => valorColuna(c, obj)), JSON.stringify(obj)];
  const marcadores = nomes.map(() => '?').join(', ');
  const atualiza = cols.map((c) => `${c} = excluded.${c}`).join(', ');
  return {
    sql: `INSERT INTO ${t} (${nomes.join(', ')}) VALUES (${marcadores})
          ON CONFLICT(id) DO UPDATE SET json = excluded.json${atualiza ? ', ' + atualiza : ''}`,
    args: vals,
  };
}

/* ---------- config e meta ---------- */

export function lerConfig(db) {
  const linhas = db.prepare('SELECT chave, json FROM config').all();
  const out = {};
  for (const l of linhas) out[l.chave] = JSON.parse(l.json);
  return out;
}

export function gravarConfig(db, objeto) {
  const st = db.prepare(
    'INSERT INTO config (chave, json) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET json = excluded.json'
  );
  const propria = !emTransacao(db);
  if (propria) db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(objeto)) st.run(k, JSON.stringify(v ?? null));
    if (propria) db.exec('COMMIT');
  } catch (e) {
    if (propria) db.exec('ROLLBACK');
    throw e;
  }
}

export function lerMeta(db, chave) {
  const l = db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave);
  return l ? l.valor : null;
}

export function gravarMeta(db, chave, valor) {
  db.prepare(
    'INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  ).run(chave, String(valor));
}

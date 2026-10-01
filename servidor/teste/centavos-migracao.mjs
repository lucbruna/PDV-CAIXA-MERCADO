/* Teste da migracao de dinheiro: REAL (reais) -> INTEGER (centavos).
 *
 * Cria um banco no formato ANTIGO (colunas REAL, sem a flag `centavos` em
 * meta), abre pelo banco.mjs real e confere que:
 *   - as colunas de dinheiro passaram para centavos inteiros;
 *   - o JSON (o contrato do cliente) continua em reais, intocado;
 *   - a flag impede converter duas vezes (5000 -> 500000 -> ...);
 *   - uma gravacao nova grava centavos na coluna e reais no JSON.
 *
 * Uso: node servidor/teste/centavos-migracao.mjs <pasta-temporaria> <raiz-servidor>
 */
import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = process.argv[2];
const RAIZ = process.argv[3];
const DB = join(W, 'migracao.db');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

mkdirSync(W, { recursive: true });
for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch {} }

/* --- 1. Banco no formato antigo, com reais em ponto flutuante --- */
const antigo = new DatabaseSync(DB);
antigo.exec(`
  CREATE TABLE produtos (id TEXT PRIMARY KEY, code TEXT, name TEXT, category TEXT, price REAL, stock REAL, json TEXT NOT NULL);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, name TEXT, cpf TEXT, debt REAL, json TEXT NOT NULL);
  CREATE TABLE vendas (id TEXT PRIMARY KEY, seq INTEGER, date TEXT, shiftId TEXT, operatorId TEXT, customerId TEXT, total REAL, forma TEXT, divergencia INTEGER DEFAULT 0, json TEXT NOT NULL);
  CREATE TABLE lancamentos (id TEXT PRIMARY KEY, date TEXT, type TEXT, category TEXT, amount REAL, customerId TEXT, source TEXT, settled INTEGER, json TEXT NOT NULL);
  CREATE TABLE compras (id TEXT PRIMARY KEY, date TEXT, supplierId TEXT, total REAL, json TEXT NOT NULL);
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, date TEXT, dueDate TEXT, amount REAL, paid INTEGER, json TEXT NOT NULL);
  CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT);
`);
const jsonProduto = JSON.stringify({ id: 'p1', name: 'Arroz', price: 4.5, stock: 10 });
antigo.prepare('INSERT INTO produtos VALUES (?,?,?,?,?,?,?)').run('p1', 'c1', 'Arroz', 'x', 4.5, 10, jsonProduto);
antigo.prepare('INSERT INTO clientes VALUES (?,?,?,?,?)').run('cli1', 'Maria', '', 12.34, JSON.stringify({ id: 'cli1', name: 'Maria', debt: 12.34 }));
antigo.prepare('INSERT INTO vendas VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run('v1', 1, '2026-01-01', 's', null, 'cli1', 9.99, 'Dinheiro', 0, JSON.stringify({ id: 'v1', total: 9.99 }));
antigo.close();

/* --- 2. Abre pelo banco real (dispara a migracao) --- */
process.env.SUDAM_DB = DB;
const banco = await import(pathToFileURL(join(RAIZ, 'banco.mjs')).href);

console.log('\n1. Primeira abertura converte reais -> centavos');
let db = banco.abrir();
check('price 4.5 -> 450', db.prepare('SELECT price FROM produtos').get().price === 450,
  'price=' + db.prepare('SELECT price FROM produtos').get().price);
check('debt 12.34 -> 1234', db.prepare('SELECT debt FROM clientes').get().debt === 1234);
check('total 9.99 -> 999', db.prepare('SELECT total FROM vendas').get().total === 999);
check('flag `centavos` gravada', banco.lerMeta(db, 'centavos') === 'sim');

console.log('\n2. O JSON continua em reais (contrato do cliente)');
const jsonDepois = JSON.parse(db.prepare('SELECT json FROM produtos WHERE id = ?').get('p1').json);
check('JSON do produto intacto (price 4.5)', jsonDepois.price === 4.5, 'price=' + jsonDepois.price);
const jsonVenda = JSON.parse(db.prepare('SELECT json FROM vendas WHERE id = ?').get('v1').json);
check('JSON da venda intacto (total 9.99)', jsonVenda.total === 9.99);

console.log('\n3. Gravacao nova: coluna em centavos, JSON em reais');
banco.gravar(db, 'produtos', { id: 'p2', name: 'Feijao', price: 7.35, stock: 3 });
check('coluna price = 735', db.prepare('SELECT price FROM produtos WHERE id = ?').get('p2').price === 735);
const jsonP2 = JSON.parse(db.prepare('SELECT json FROM produtos WHERE id = ?').get('p2').json);
check('JSON do p2 em reais (7.35)', jsonP2.price === 7.35, 'price=' + jsonP2.price);
db.close();

console.log('\n4. Reabrir nao multiplica de novo');
db = banco.abrir();
check('price segue 450 (nao virou 45000)', db.prepare('SELECT price FROM produtos').get().price === 450);
check('total segue 999', db.prepare('SELECT total FROM vendas').get().total === 999);
db.close();

console.log('\n' + '='.repeat(46));
console.log(`  ${ok} passaram, ${fail} falharam`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);

/* Teste de restauracao de backup.
 *
 * Um backup que ninguem restaurou nao e backup -- e so um arquivo ocupando
 * espaco. Este teste faz o caminho inteiro: popula um banco, deixa o servidor
 * gravar o backup no desligamento, copia o par .db/-wal para outra pasta,
 * sobe um servidor novo apontado para essa copia e confere que os dados
 * voltaram inteiros (login, produtos, estoque e venda).
 *
 * Uso: node servidor/teste/backup-restaura.mjs <pasta-temporaria> <raiz-servidor>
 */
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes } from 'node:crypto';

const W = process.argv[2];
const RAIZ = process.argv[3];
const PORTA_A = 8796;
const PORTA_B = 8797;
const ORIGINAL = join(W, 'origem.db');
const PASTA_BACKUP = join(W, 'backup');
const RESTAURADO = join(W, 'restaurado');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

function sobe(porta, db, backup) {
  const s = spawn(process.execPath, ['servidor.mjs'], {
    cwd: RAIZ,
    env: { ...process.env, SUDAM_DB: db, SUDAM_PORTA: String(porta), SUDAM_BACKUP: backup },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stdout.on('data', () => {});
  s.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  return s;
}

async function req(base, metodo, caminho, corpo, token) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(base + caminho, {
    method: metodo, headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados = null;
  try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}

/* Desliga de verdade: e o SIGTERM que dispara o backup final. */
function desliga(s) {
  return new Promise((r) => {
    s.on('exit', () => setTimeout(r, 300));
    s.kill('SIGTERM');
    setTimeout(() => { try { s.kill('SIGKILL'); } catch {} }, 6000).unref();
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

for (const s of ['', '-wal', '-shm']) { try { rmSync(ORIGINAL + s); } catch {} }
rmSync(PASTA_BACKUP, { recursive: true, force: true });
rmSync(RESTAURADO, { recursive: true, force: true });
mkdirSync(RESTAURADO, { recursive: true });

let A, B;
try {
  console.log('\n1. Popula o banco de origem');
  A = sobe(PORTA_A, ORIGINAL, PASTA_BACKUP);
  await espera(1800);
  const baseA = `http://127.0.0.1:${PORTA_A}`;

  await req(baseA, 'POST', '/api/migrar', {
    products: [{ id: 'p1', code: '111', name: 'Arroz', price: 20, cost: 14, stock: 50 }],
    customers: [{ id: 'c1', name: 'Maria', debt: 0, points: 0 }],
    auth: { users: [{ id: 'u1', name: 'Admin', username: 'admin', passHash: 'legado', role: 'admin', active: true }] },
    config: { storeName: 'Teste Backup' },
  });

  /* O `passHash: 'legado'` acima e um hash FNV que o app antigo usava. Para
     este teste nao importar a conversao, gravamos direto o scrypt de '1234'
     no usuario -- assim o login de antes e o de depois do restauro usam
     exatamente a mesma credencial, que e o que a gente precisa provar. */
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync('1234', sal, 64, { N: 16384 }).toString('hex');
  const bd = new DatabaseSync(ORIGINAL);
  const u = JSON.parse(bd.prepare('SELECT json FROM usuarios WHERE id=?').get('u1').json);
  u.sal = sal; u.senhaHash = hash; delete u.passHash;
  bd.prepare('UPDATE usuarios SET json=? WHERE id=?').run(JSON.stringify(u), 'u1');
  bd.close();

  const login = await req(baseA, 'POST', '/api/login', { usuario: 'admin', senha: '1234' });
  const token = login.dados?.token;
  check('login no banco de origem', login.status === 200 && !!token);

  const v = await req(baseA, 'POST', '/api/venda', {
    id: 'venda-restauro', seq: 7001,
    items: [{ id: 'p1', name: 'Arroz', qty: 3, price: 20 }],
    total: 60, change: 0, payments: [{ method: 'Dinheiro', amount: 60 }],
    customerId: 'c1',
  }, token);
  check('venda gravada na origem', v.status === 200, JSON.stringify(v.dados));

  console.log('\n2. Dispara o backup e fecha o servidor de origem');
  /* Nao dependemos de SIGTERM aqui. No Windows o `process.kill(pid,'SIGTERM')`
     NAO entrega o sinal: o Node simplesmente mata o processo, sem rodar os
     listeners de SIGTERM, entao o backup de desligamento nunca aconteceria e
     o teste mediria o comportamento do Windows, nao o do backup. (O caminho do
     SIGTERM e verificado no Linux, onde o sinal existe de verdade -- ver
     `instalar-linux.sh` e o teste manual em README.) Chamamos o backup
     diretamente, que e o mesmo codigo de producao. */
  await desliga(A); A = null;
  process.env.SUDAM_DB = ORIGINAL;
  process.env.SUDAM_BACKUP = PASTA_BACKUP;
  const { fazerBackupAgora } = await import('../backup.mjs');
  fazerBackupAgora();
  await espera(300);

  console.log('\n3. O backup existe e tem o par .db + -wal');
  const arquivos = existsSync(PASTA_BACKUP) ? readdirSync(PASTA_BACKUP) : [];
  check('a pasta de backup tem arquivos', arquivos.length > 0, arquivos.join(', '));
  const stamp = arquivos
    .filter((f) => f.startsWith('sudam.') && !f.startsWith('sudam-wal.'))
    .map((f) => f.slice('sudam.'.length))
    .sort()
    .pop();
  check('existe um sudam.<carimbo>', !!stamp, arquivos.join(', '));
  check('existe o -wal do mesmo carimbo', !!stamp && existsSync(join(PASTA_BACKUP, 'sudam-wal.' + stamp)),
    arquivos.join(', '));
  if (!stamp) throw new Error('sem backup para restaurar');

  console.log('\n4. Copia o backup para uma pasta nova (como numa maquina nova)');
  copyFileSync(join(PASTA_BACKUP, 'sudam.' + stamp), join(RESTAURADO, 'sudam.db'));
  const temWal = existsSync(join(PASTA_BACKUP, 'sudam-wal.' + stamp));
  if (temWal) copyFileSync(join(PASTA_BACKUP, 'sudam-wal.' + stamp), join(RESTAURADO, 'sudam.db-wal'));
  check('copia do .db restaurado', existsSync(join(RESTAURADO, 'sudam.db')));
  check('copia do -wal restaurado', !temWal || existsSync(join(RESTAURADO, 'sudam.db-wal')));

  console.log('\n5. Sobe um servidor novo so com o backup restaurado');
  B = sobe(PORTA_B, join(RESTAURADO, 'sudam.db'), join(RESTAURADO, 'backup-novo'));
  await espera(1800);
  const baseB = `http://127.0.0.1:${PORTA_B}`;

  const st = await req(baseB, 'GET', '/api/status');
  check('banco restaurado abre', st.status === 200, JSON.stringify(st.dados));
  /* /api/status e publica e de proposito devolve so contagens, nunca dado de
     loja -- por isso o "nome" la e fixo e nao vem do config. As contagens, ao
     contrario, sao a prova mais direta de que os dados voltaram. */
  check('contagem de produtos voltou (1)', st.dados?.produtos === 1, 'produtos=' + st.dados?.produtos);
  check('contagem de vendas voltou (1)', st.dados?.vendas === 1, 'vendas=' + st.dados?.vendas);
  check('versao do banco preservada', typeof st.dados?.versao === 'string' && st.dados.versao.length > 0);

  const loginB = await req(baseB, 'POST', '/api/login', { usuario: 'admin', senha: '1234' });
  check('a senha do admin funciona no banco restaurado', loginB.status === 200, JSON.stringify(loginB.dados));
  const tokenB = loginB.dados?.token;
  check('login devolve token novo', !!tokenB);

  const base = await req(baseB, 'GET', '/api/base', undefined, tokenB);
  const produtos = base.dados?.produtos || [];
  check('produto voltou', produtos.some((p) => p.id === 'p1' && p.name === 'Arroz'), JSON.stringify(produtos));
  const arroz = produtos.find((p) => p.id === 'p1');
  check('estoque reflete a venda (50 - 3 = 47)', arroz?.stock === 47, 'stock=' + arroz?.stock);
  check('preco voltou inteiro (20)', arroz?.price === 20, 'price=' + arroz?.price);
  check('cliente voltou', (base.dados?.clientes || []).some((c) => c.id === 'c1'),
    JSON.stringify(base.dados?.clientes));
  check('config voltou', base.dados?.config?.storeName === 'Teste Backup', JSON.stringify(base.dados?.config));

  /* Vendas nao vem em /api/base: tem rota propria, com paginacao. */
  const lv = await req(baseB, 'GET', '/api/vendas?limite=50', undefined, tokenB);
  const vendas = lv.dados?.vendas || lv.dados || [];
  check('a venda voltou', Array.isArray(vendas) && vendas.some((x) => x.id === 'venda-restauro'),
    'vendas=' + JSON.stringify(vendas).slice(0, 200));
  const venda = (Array.isArray(vendas) ? vendas : []).find((x) => x.id === 'venda-restauro');
  check('total da venda voltou (60)', venda?.total === 60, 'total=' + venda?.total);
  /* A venda foi feita como UMA linha de 3 unidades, nao 3 linhas. */
  check('a linha da venda voltou (1 item, qty 3)',
    (venda?.items || []).length === 1 && venda.items[0].qty === 3,
    'itens=' + JSON.stringify(venda?.items));
} catch (e) {
  fail++;
  console.log('  FAIL  excecao: ' + e.message);
} finally {
  if (A) await desliga(A);
  if (B) await desliga(B);
}

console.log('\n==============================================');
console.log('  ' + ok + ' passaram, ' + fail + ' falharam');
console.log('==============================================');
process.exit(fail ? 1 : 0);
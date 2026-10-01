/* Backup automatico.
 *
 * O mini PC da loja e um Windows comum: ele trava, o disco enche, a energia
 * acaba. A defesa aqui e simples de proposito -- um arquivo .db por dia, com
 * as ultimas 24 horas, mais um backup diario por 30 dias. O objetivo e que existam
 * varias copias buenas, e nao um sistema sofisticado que o gerente precise
 * lembrar de acionar.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoBanco, caminhoBackup } from './banco.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
/* A pasta acompanha o banco (ver caminhoBackup em banco.mjs). Com SUDAM_DB
   apontando para outro disco, o backup vai para o lado daquele banco. */
const PASTA = caminhoBackup();
const PASTA_ESPELHO = process.env.SUDAM_BACKUP_ESPELHO || '';
const DIAS = 30;
const HORAS_RECENTES = 24;
let ultimoSucesso = null;
let ultimaFalha = null;
let falhaEspelho = null;

/* Carimbo com segundos: o backup roda no boot, a cada hora e no desligamento,
   e duas dessas chamadas podem cair no mesmo minuto. Com VACUUM INTO o nome
   nao pode repetir (o arquivo tem de nao existir), dai a resolucao extra. */
function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* O nome real gravado em `fazer()` e `sudam.<carimbo>` (e `sudam-wal.<carimbo>`
 * para o WAL). A limpeza procurava `sudam.db.`, que nunca existiu — nenhuma
 * copia era apagada e a pasta crescia 2 arquivos por hora, ~17 mil por ano. No
 * mini PC da loja, que costuma ser um SSD de 120 GB com o sistema em cima, o
 * disco enche e o PDV para. A lista precisa casar com o que `fazer()` grava. */

function fazer(db) {
  mkdirSync(PASTA, { recursive: true });
  const destino = join(PASTA, 'sudam.' + carimbo());

  /* Caminho preferido: VACUUM INTO. O SQLite escreve a copia inteira em UM
     arquivo, ja como um banco fechado -- e a unica forma de nao existir uma
     janela em que o .db e o -wal nao batem (uma venda entrando entre copiar
     um e outro). Quem restaura copia um arquivo so, sem se preocupar com WAL. */
  if (db) {
    try {
      if (existsSync(destino)) unlinkSync(destino);
      db.exec("VACUUM INTO '" + destino.replace(/'/g, "''") + "'");
      verificarArquivo(destino);
      espelhar(destino);
      limpar(PASTA);
      ultimoSucesso = new Date().toISOString(); ultimaFalha = null;
      return;
    } catch (e) {
      try { if (existsSync(destino)) unlinkSync(destino); } catch {}
      ultimaFalha = e.message;
      console.error('[backup] VACUUM INTO falhou, copiando o arquivo:', e.message);
    }
  }

  /* Reserva (banco indisponivel ou somente leitura): copia o par .db/-wal.
     O checkpoint vem antes para o .db sozinho ja ser um banco fechado, e a
     ordem de copia e a segura: primeiro o .db, depois o -wal. Assim o WAL
     copiado nunca e mais velho que o banco. */
  if (db) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  }
  const marcaFallback = carimbo();
  const arquivoFallback = join(PASTA, 'sudam.' + marcaFallback);
  const origemBanco = caminhoBanco();
  if (!existsSync(origemBanco)) throw new Error('arquivo do banco nao encontrado para backup');
  copyFileSync(origemBanco, arquivoFallback);
  if (existsSync(origemBanco + '-wal')) copyFileSync(origemBanco + '-wal', arquivoFallback + '-wal');
  if (existsSync(origemBanco + '-shm')) copyFileSync(origemBanco + '-shm', arquivoFallback + '-shm');
  /* Consolida WAL da copia (se checkpoint do banco ativo estava ocupado) e
     deixa o snapshot independente, como no caminho VACUUM INTO. */
  try {
    const recuperada = new DatabaseSync(arquivoFallback);
    try {
      const checkpoint = recuperada.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (checkpoint && Number(checkpoint.busy) !== 0) throw new Error('nao foi possivel consolidar o WAL do backup');
    } finally { recuperada.close(); }
    for (const sufixo of ['-wal', '-shm']) { try { unlinkSync(arquivoFallback + sufixo); } catch {} }
    verificarArquivo(arquivoFallback);
  } catch (e) {
    for (const sufixo of ['', '-wal', '-shm']) { try { unlinkSync(arquivoFallback + sufixo); } catch {} }
    throw e;
  }
  espelhar(arquivoFallback);
  limpar(PASTA); ultimoSucesso = new Date().toISOString(); ultimaFalha = null;
}

function verificarArquivo(arquivo) {
  const copia = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const resultado = copia.prepare('PRAGMA integrity_check').get();
    if (!resultado || resultado.integrity_check !== 'ok') throw new Error('integrity_check da copia nao retornou ok');
  } finally { copia.close(); }
}

function espelhar(arquivo) {
  falhaEspelho = null;
  if (!PASTA_ESPELHO || PASTA_ESPELHO === PASTA) return;
  try {
    mkdirSync(PASTA_ESPELHO, { recursive: true });
    const destino = join(PASTA_ESPELHO, arquivo.split(/[\\/]/).pop());
    copyFileSync(arquivo, destino);
    verificarArquivo(destino);
    limpar(PASTA_ESPELHO);
  } catch (e) {
    try { unlinkSync(join(PASTA_ESPELHO, arquivo.split(/[\\/]/).pop())); } catch {}
    falhaEspelho = e.message; console.error('[backup] espelho externo falhou:', e.message);
  }
}

function limpar(pasta) {
  pasta = pasta || PASTA;
  const todos = readdirSync(pasta);
  const validos = todos.filter((f) => /^sudam\.\d{4}-\d{2}-\d{2}_\d{6}$/.test(f))
    .map((nome) => ({ nome, caminho: join(pasta, nome), data: nome.slice(6) }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const recentes = new Set(validos.slice(-HORAS_RECENTES).map((x) => x.nome));
  const porDia = new Map();
  for (const item of validos) porDia.set(item.data.slice(0, 10), item.nome);
  const dias = [...porDia.keys()].sort();
  const diasMantidos = new Set(dias.slice(-DIAS));
  const manter = new Set(recentes);
  for (const dia of diasMantidos) manter.add(porDia.get(dia));
  for (const item of validos) if (!manter.has(item.nome)) {
    try { unlinkSync(item.caminho); } catch {}
    for (const sufixo of ['-wal', '-shm']) { try { unlinkSync(item.caminho + sufixo); } catch {} }
  }
  for (const f of todos) {
    if (f.startsWith('sudam-wal.')) {
      const base = f.replace('sudam-wal.', 'sudam.');
      if (!existsSync(join(pasta, base))) { try { unlinkSync(join(pasta, f)); } catch {} }
    }
    if (f.startsWith('sudam.tmp-')) { try { unlinkSync(join(pasta, f)); } catch {} }
  }
}

export function iniciarBackup(db) {
  try { fazer(db); } catch (e) { ultimaFalha = e.message; console.error('[backup] falha na copia inicial:', e.message); }
  setInterval(() => {
    try { fazer(db); } catch (e) { ultimaFalha = e.message; console.error('[backup] falha:', e.message); }
  }, 60 * 60 * 1000).unref?.();
  console.log('  backup automatico a cada hora em: ' + PASTA);
}

export function estadoBackup() {
  let arquivos = [];
  try { arquivos = readdirSync(PASTA).filter((f) => /^sudam\.\d{4}-\d{2}-\d{2}_\d{6}$/.test(f)); } catch {}
  const maisNovo = arquivos.map((f) => ({ f, m: statSync(join(PASTA, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
  let copiasEspelho = 0;
  try { if (PASTA_ESPELHO) copiasEspelho = readdirSync(PASTA_ESPELHO).filter((f) => /^sudam\.\d{4}-\d{2}-\d{2}_\d{6}$/.test(f)).length; } catch {}
  return { ultimoSucesso, ultimoArquivo: maisNovo ? new Date(maisNovo.m).toISOString() : null, quantidade: arquivos.length, falha: ultimaFalha, espelhoAtivo: !!PASTA_ESPELHO, copiasEspelho, falhaEspelho };
}

export { PASTA as PASTA_BACKUP, fazer as fazerBackupAgora };

/* Backup automatico.
 *
 * O mini PC da loja e um Windows comum: ele trava, o disco enche, a energia
 * acaba. A defesa aqui e simples de proposito -- um arquivo .db por dia, com
 * os ultimos 30 dias, mais um backup a cada hora. O objetivo e que existam
 * varias copias buenas, e nao um sistema sofisticado que o gerente precise
 * lembrar de acionar.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoBanco, caminhoBackup } from './banco.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
/* A pasta acompanha o banco (ver caminhoBackup em banco.mjs). Com SUDAM_DB
   apontando para outro disco, o backup vai para o lado daquele banco. */
const PASTA = caminhoBackup();
const DIAS = 30;

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function fazer() {
  mkdirSync(PASTA, { recursive: true });
  /* O .db e copiado junto do -wal; sem o checkpoint o .db sozinho pode estar
     atrasado em relacao ao que esta em memoria. O -shm NAO e copiado: ele e
     um indice de memoria compartilhada, recriado pelo proprio SQLite quando
     o banco abre, e guardar uma copia parada so ocupa espaco e confunde quem
     for restaurar. */
  for (const sufixo of ['', '-wal']) {
    const origem = caminhoBanco() + sufixo;
    if (existsSync(origem)) {
      copyFileSync(origem, join(PASTA, 'sudam' + sufixo + '.' + carimbo()));
    }
  }
  limpar();
}

function limpar() {
  const arquivos = readdirSync(PASTA).filter((f) => f.startsWith('sudam.db.')).sort();
  /* Um backup por dia, mantendo DIAS dias. */
  const porDia = new Map();
  for (const f of arquivos) {
    const dia = f.split('_')[0];
    porDia.set(dia, f);
  }
  const dias = [...porDia.keys()].sort();
  const sobra = dias.slice(0, Math.max(0, dias.length - DIAS));
  for (const dia of sobra) {
    for (const f of arquivos.filter((x) => x.startsWith(dia))) {
      try { unlinkSync(join(PASTA, f)); } catch {}
    }
  }
  /* Arquivos -wal velhos que ficaram sem o .db correspondente. */
  for (const f of readdirSync(PASTA)) {
    if (f.startsWith('sudam-wal.') || f.startsWith('sudam.db-wal.')) {
      const base = f.replace('-wal.', '');
      if (!existsSync(join(PASTA, base))) {
        try { unlinkSync(join(PASTA, f)); } catch {}
      }
    }
  }
}

export function iniciarBackup(db) {
  try { fazer(); } catch (e) { console.error('[backup] falha na copia inicial:', e.message); }
  setInterval(() => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    try { fazer(); } catch (e) { console.error('[backup] falha:', e.message); }
  }, 60 * 60 * 1000).unref?.();
  console.log('  backup automatico a cada hora em: ' + PASTA);
}

export { PASTA as PASTA_BACKUP, fazer as fazerBackupAgora };

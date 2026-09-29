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

/* O nome real gravado em `fazer()` e `sudam.<carimbo>` (e `sudam-wal.<carimbo>`
 * para o WAL). A limpeza procurava `sudam.db.`, que nunca existiu — nenhuma
 * copia era apagada e a pasta crescia 2 arquivos por hora, ~17 mil por ano. No
 * mini PC da loja, que costuma ser um SSD de 120 GB com o sistema em cima, o
 * disco enche e o PDV para. A lista precisa casar com o que `fazer()` grava. */
const PREFIXO_DB = 'sudam.';

function fazer(db) {
  mkdirSync(PASTA, { recursive: true });
  /* O checkpoint vem ANTES da copia, em todos os caminhos (primeira carga,
     hora, desligamento). Sem ele o .db pode estar atrasado em relacao ao que
     ainda esta no WAL, e quem restaura sem o -wal perde as ultimas vendas.
     Com o checkpoint, o .db sozinho ja e um banco fechado e consistente. */
  if (db) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  }
  /* O .db e copiado junto do -wal; ainda assim o WAL vai junto porque a copia
     leva alguns milissegundos e uma venda pode entrar nesse meio-tempo. A ordem
     importa e e a segura: primeiro o .db, depois o -wal. Assim o WAL copiado e
     sempre mais novo ou igual ao .db, e o SQLite replaya os frames ate o ultimo
     commit completo. Copiar na ordem contraria produziria um par inconsistente.
     O -shm NAO e copiado: ele e um indice de memoria compartilhada, recriado
     pelo proprio SQLite quando o banco abre, e guardar uma copia parada so
     ocupa espaco e confunde quem for restaurar. */
  for (const sufixo of ['', '-wal']) {
    const origem = caminhoBanco() + sufixo;
    if (existsSync(origem)) {
      copyFileSync(origem, join(PASTA, 'sudam' + sufixo + '.' + carimbo()));
    }
  }
  limpar();
}

function limpar() {
  const todos = readdirSync(PASTA);
  /* Um backup por dia, mantendo DIAS dias. */
  const porDia = new Map();
  for (const f of todos) {
    if (!f.startsWith(PREFIXO_DB) || f.startsWith(PREFIXO_DB + '-wal.')) continue;
    const dia = f.slice(PREFIXO_DB.length).split('_')[0];
    porDia.set(dia, f);
  }
  const dias = [...porDia.keys()].sort();
  const sobra = dias.slice(0, Math.max(0, dias.length - DIAS));
  for (const dia of sobra) {
    for (const f of todos.filter((x) => x.startsWith(PREFIXO_DB + dia))) {
      try { unlinkSync(join(PASTA, f)); } catch {}
    }
  }
  /* Arquivos -wal velhos que ficaram sem o .db correspondente. */
  for (const f of todos) {
    if (f.startsWith('sudam-wal.')) {
      const base = f.replace('-wal.', '.');
      if (!existsSync(join(PASTA, base))) {
        try { unlinkSync(join(PASTA, f)); } catch {}
      }
    }
  }
}

export function iniciarBackup(db) {
  try { fazer(db); } catch (e) { console.error('[backup] falha na copia inicial:', e.message); }
  setInterval(() => {
    try { fazer(db); } catch (e) { console.error('[backup] falha:', e.message); }
  }, 60 * 60 * 1000).unref?.();
  console.log('  backup automatico a cada hora em: ' + PASTA);
}

export { PASTA as PASTA_BACKUP, fazer as fazerBackupAgora };

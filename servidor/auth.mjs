/* Senhas no servidor.
 *
 * O app antigo guardava hash FNV-1a com sal fixo e comparava no cliente
 * (js/store.js). Isso e ofuscacao, nao protecao: com 5 maquinas falando com o
 * servidor, qualquer pessoa com acesso a rede poderia descobrir a senha.
 * Aqui e scrypt, com sal por usuario.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const CUSTO = 16384;
const TAM = 64;

export function gerarHash(senha) {
  const sal = randomBytes(16).toString('hex');
  const h = scryptSync(String(senha), sal, TAM, { N: CUSTO }).toString('hex');
  return { sal, hash: h };
}

export function conferir(senha, sal, hash) {
  if (!sal || !hash) return false;
  let esperado;
  try {
    esperado = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  if (esperado.length !== TAM) return false;
  const obtido = scryptSync(String(senha), sal, TAM, { N: CUSTO });
  return timingSafeEqual(obtido, esperado);
}

/* Converte o hash antigo (FNV-1a "a.b.c") vindo do localStorage, para que a
 * migracao traga os usuarios existentes sem obrigar o gerente a recriar senha.
 * A conversao acontece no primeiro login, quando a senha em texto puro esta
 * disponivel de qualquer jeito. */
export function hashAntigo(senha) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = 'sudam::' + senha + '::pdv';
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = ((h2 << 5) - h2 + s.charCodeAt(i)) >>> 0;
  }
  return h1.toString(36) + '.' + h2.toString(36) + '.' + s.length;
}

/* ---------------- sessoes ----------------
 *
 * Antes desta parte o /api/login verificava a senha e devolvia o usuario, sem
 * emitir nada: todas as rotas respondiam a qualquer chamada da rede. O token
 * abaixo e o que fecha essa porta. Vive na tabela `sessoes` (e nao em
 * memoria) para sobreviver a reinicio do mini PC no meio do expediente.
 */

/* Renovar a sessao a cada requisicao e o que segura o caixa aberto o
   expediente inteiro. Sem isso, o token expira 12 h depois do login, a
   proxima venda cai em 401 e vai para a fila -- e o caixa ve "deu erro"
   numa venda que ele ja tinha fechado na tela. A janela deslizante de 12 h
   significa que a sessao morre 12 h depois da ULTIMA atividade, nao do
   login: quem opera o dia todo nunca ve expirar. */
const JANELA_HORAS = 12;

export function criarSessao(db, username) {
  const token = randomBytes(32).toString('hex');
  const agora = new Date();
  const expira = new Date(agora.getTime() + JANELA_HORAS * 3600 * 1000);
  db.prepare(
    'INSERT INTO sessoes (token, usuario, criadoEm, expiraEm) VALUES (?, ?, ?, ?)'
  ).run(token, username, agora.toISOString(), expira.toISOString());
  return { token, expiraEm: expira.toISOString() };
}

/* Empurra o vencimento para frente. Chamado a cada requisicao autenticada;
 * custa um UPDATE e evita o logout involuntaryario no meio do turno. */
export function renovarSessao(db, token) {
  if (!token) return null;
  const expira = new Date(Date.now() + JANELA_HORAS * 3600 * 1000).toISOString();
  try {
    db.prepare('UPDATE sessoes SET expiraEm = ? WHERE token = ?').run(expira, token);
    return expira;
  } catch {
    return null;
  }
}

/* Devolve o usuario da sessao, ou null. Token expirado e removido na
 * oportunidade; a limpeza periodica e em iniciarSessoes(). */
export function usuarioDaSessao(db, token) {
  if (!token || typeof token !== 'string') return null;
  const s = db.prepare('SELECT usuario, expiraEm FROM sessoes WHERE token = ?').get(token);
  if (!s) return null;
  if (new Date(s.expiraEm).getTime() <= Date.now()) {
    try { db.prepare('DELETE FROM sessoes WHERE token = ?').run(token); } catch {}
    return null;
  }
  const u = db.prepare('SELECT json FROM usuarios WHERE lower(username) = lower(?)').get(s.usuario);
  if (!u) return null;
  const reg = JSON.parse(u.json);
  if (reg.active === false) return null;
  return reg;
}

export function encerrarSessao(db, token) {
  if (!token) return;
  try { db.prepare('DELETE FROM sessoes WHERE token = ?').run(token); } catch {}
}

/* Remove sessao expirada de tempos em tempos, para a tabela nao crescer
 * sozinha a cada login do dia. */
export function iniciarSessoes(db) {
  const limpar = () => {
    try { db.prepare('DELETE FROM sessoes WHERE expiraEm <= ?').run(new Date().toISOString()); }
    catch (e) { console.error('[sessao] falha na limpeza:', e.message); }
  };
  limpar();
  setInterval(limpar, 60 * 60 * 1000).unref?.();
}

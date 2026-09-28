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

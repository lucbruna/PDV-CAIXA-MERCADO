/* Dinheiro em centavos inteiros.
 *
 * Antes, todo valor era REAL em ponto flutuante e cada operacao arredondava com
 * `Math.round(x * 100) / 100`. Isso funciona para um valor isolado, mas nao
 * para SOMA: ponto flutuante binario nao representa 0,10 exatamente, entao
 * somar centenas de linhas deriva (0,1 + 0,2 = 0,30000000000000004). O corte
 * limpo e guardar e calcular dinheiro em CENTAVOS INTEIROS, e converter para
 * reais so na borda -- no JSON que o cliente le.
 *
 * Regras:
 *   - Nada de `* 100` / `/ 100` espalhado pelo codigo. Tudo passa por aqui.
 *   - O JSON (a colecao que o cliente consome) continua em REAIS. E o contrato
 *     do app e mudar isso quebraria todas as telas.
 *   - As colunas de dinheiro no SQLite passam a guardar centavos inteiros.
 *   - Quantidade (estoque, kg) NAO e dinheiro: continua com decimais.
 */

/* Reais -> centavos inteiros. O `+ EPSILON` antes do `* 100` corrige o caso
 * classico de 1.005, que em binario e 1.00499999... e arredondaria para 100. */
export function centavos(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + (n >= 0 ? 1 : -1) * Number.EPSILON) * 100);
}

/* Centavos inteiros -> reais (numero de duas casas). */
export function reais(cent) {
  const c = Number(cent);
  if (!Number.isFinite(c)) return 0;
  return Math.round(c) / 100;
}

/* Arredonda um valor em reais para duas casas. Mantido para o que nao e
 * dinheiro (ex.: quantidade) e para nao reescrever cada chamada existente. */
export function arred2(valor) {
  return reais(centavos(valor));
}

/* Soma uma lista de valores em reais sem deriva: converte cada um para centavos
 * e soma inteiros. */
export function somaCentavos(lista) {
  let total = 0;
  for (const v of lista) total += centavos(v);
  return total;
}

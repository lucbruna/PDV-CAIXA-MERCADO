/* boot.js -- antes de qualquer outra coisa.
 *
 * Este arquivo nasceu dentro do index.html e foi movido para ca por causa do
 * Content-Security-Policy. A politica manda `script-src 'self'`, sem
 * 'unsafe-inline', sem nonce e sem hash: um `<script>` escrito dentro do HTML
 * e BLOQUEADO pelo navegador. Os dois blocos que viviam no index.html -- o
 * coletor de erro e o watchdog de inicializacao -- simplesmente nunca
 * executaram. O resultado era o pior possivel para um caixa: quando o app
 * falhasse ao subir, aparecia uma tela escura vazia, sem mensagem, sem causa e
 * sem botao de "Tentar novamente" -- justamente o que aquele codigo existia
 * para evitar.
 *
 * Por isso o arquivo precisa ser o PRIMEIRO script da pagina, ainda no
 * <head>: e ele que tem de estar ouvindo quando os scripts seguintes falharem
 * ao carregar.
 */
(function () {
  /* ---- 1. Coleta de erro, para ter o que mostrar quando a tela travar ---- */
  window.__pdvErrors = [];
  window.addEventListener('error', function (event) {
    var target = event.target;
    window.__pdvErrors.push(target && (target.src || target.href)
      ? 'Falha ao carregar: ' + (target.src || target.href)
      : (event.message || 'Erro de JavaScript'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    window.__pdvErrors.push('Falha ao iniciar: ' + String(event.reason && event.reason.message || event.reason));
  });

  /* ---- 2. Watchdog: se o app nao montou em 2,5 s, diz o que fazer ----
   *
   * Cobre os casos que o operador realmente vai encontrar: instalacao com
   * arquivos faltando, versao antiga de js/ misturada com css/ nova depois de
   * uma atualizacao, e o app montado mas com o overlay de login vazio por
   * cima (o operador ve so um retangulo escuro e nao clica em nada). */
  setTimeout(function () {
    var app  = document.getElementById('app');
    var auth = document.getElementById('authScreen');

    /* Caso "coberto": o app montou e renderizou, mas o overlay de login ficou
       por cima (vazio, opaco, tela inteira). A checagem abaixo considerava
       isso "carregou com sucesso" porque #app tem filhos, entao nunca
       denunciava. Aqui o overlay vazio e visivel e a propria causa, e a
       correcao e esconder o overlay em vez de abortar a tela. */
    if (auth && !auth.classList.contains('hidden') && auth.children.length === 0 && app && app.children.length > 0) {
      auth.classList.add('hidden');
      return;
    }

    var carregou = (app && app.children.length > 0) || (auth && auth.children.length > 0);
    if (carregou) return;
    if (window.__pdvBootOk) return;
    if (document.getElementById('pdvBootFailure')) return;

    var detalhes = (window.__pdvErrors || []).slice(0, 3).join('\n');
    var div = document.createElement('div');
    div.id = 'pdvBootFailure';
    div.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;' +
      'background:#0b1220;color:#e8eef7;font:15px/1.6 system-ui,sans-serif;padding:24px;z-index:9999';
    div.innerHTML = '<div style="max-width:540px">' +
      '<h1 style="font-size:19px;margin:0 0 10px">O sistema não conseguiu iniciar</h1>' +
      '<p style="color:#9fb0c8;margin:0 0 16px">O PDV não conseguiu montar as telas. Seus dados continuam preservados. ' +
      'Confira se os arquivos da instalação estão completos.</p>' +
      '<ol style="color:#9fb0c8;padding-left:20px;margin:0 0 18px">' +
      '<li>Feche e abra novamente pelo atalho do PDV.</li>' +
      '<li>Se persistir, reinstale o PDV para restaurar os arquivos.</li>' +
      '</ol>' +
      '<button id="pdvReload" style="background:#1e293b;color:#e8eef7;border:1px solid #334155;' +
      'padding:9px 15px;border-radius:8px;cursor:pointer;font:inherit">Tentar novamente</button>' +
      '</div>';
    if (detalhes) {
      var pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;color:#fca5a5;font-size:12px';
      pre.textContent = detalhes;
      div.firstChild.insertBefore(pre, div.firstChild.querySelector('ol'));
    }
    document.body.appendChild(div);
    document.getElementById('pdvReload').onclick = function () { location.reload(); };
  }, 2500);
})();

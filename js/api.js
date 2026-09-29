/* ==========================================================================
   api.js — Ponte entre o app e o servidor do mini PC.

   Por que este arquivo existe: o servidor Node + SQLite foi escrito, mas o
   app nunca falou com ele. Toda gravacao ia para o localStorage da maquina,
   que tem 5 MB de teto — e a falha e silenciosa: a venda aparecia na tela,
   o troco saia, e o registro sumia ao reabrir o navegador. Com 5 caixas,
   nenhuma enxergava a venda da outra.

   Este arquivo e a camada que fecha essa distancia. Tres responsabilidades:

     1. Descobrir o servidor e fazer login, guardando o token.
     2. Baixar a base (produtos, clientes, config) para o app trabalhar.
     3. Enviar vendas e gravacoes.

   Regra de ouro: o servidor é a fonte da verdade, mas a venda NUNCA é
   impedida por causa dele. Se o servidor não responde, a venda é mantida
   localmente e marcada para reconciliar — o dinheiro e a mercadoria já
   saíram com o cliente. Recusar a venda seria devolver o cliente ao balcão.
   ========================================================================== */
(function (global) {
  'use strict';

  var CHAVE_TOKEN = 'sudam_token';
  var CHAVE_PEND = 'sudam_pendentes';
  var CHAVE_MIGRADO = 'sudam_migrado';
  var CHAVE_EXPIRA = 'sudam_sessao_expira';
  var CHAVE_REJEITADOS = 'sudam_rejeitados';

  var estado = {
    online: false,        // o servidor respondeu na ultima sondagem
    autenticado: false,
    usuario: null,
    migrado: false,
    ultimoErro: null,
    verificando: false,
  };

  function base() {
    // Mesmo origen: o app e servido pelo proprio servidor, entao caminho
    // relativo e suficiente e nao ha CORS no meio.
    return '';
  }

  function lerToken() {
    try { return localStorage.getItem(CHAVE_TOKEN) || null; } catch (e) { return null; }
  }

  function guardarToken(t) {
    try {
      if (t) localStorage.setItem(CHAVE_TOKEN, t);
      else { localStorage.removeItem(CHAVE_TOKEN); localStorage.removeItem(CHAVE_EXPIRA); }
    } catch (e) { /* modo privado sem storage: segue so em memoria */ }
  }

  /* Quando a sessao expira. O servidor manda esse valor no header de cada
     resposta autenticada (janela deslizante de 12 h). O caixa precisa
     saber ANTES -- avisar "sua sessao expira em 30 min" e infinitamente
     melhor do que a proxima venda cair em 401 e ir para a fila. */
  function lerExpira() {
    try { return localStorage.getItem(CHAVE_EXPIRA) || null; } catch (e) { return null; }
  }

  function guardarExpira(iso) {
    try { if (iso) localStorage.setItem(CHAVE_EXPIRA, iso); } catch (e) {}
  }

  function minutosParaExpirar() {
    var iso = lerExpira();
    if (!iso) return null;
    var ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return null;
    return Math.round(ms / 60000);
  }

  /* ---------------- fila do que ainda nao subiu ----------------
   * Venda que o servidor recusou fica aqui e e reenviada na proxima
   * oportunidade. Sem isso, uma queda de rede no meio da venda perdia o
   * registro — exatamente o problema que motivou o servidor. */
  function lerPendentes() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_PEND) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function guardarPendentes(lista) {
    try { localStorage.setItem(CHAVE_PEND, JSON.stringify(lista.slice(0, 500))); }
    catch (e) { /* cota cheia: a fila e o ultimo recurso */ }
  }

  function enfileirar(tipo, dados) {
    var l = lerPendentes();
    l.push({ tipo: tipo, dados: dados, em: new Date().toISOString() });
    guardarPendentes(l);
  }

  function desenfileirar() {
    var l = lerPendentes();
    if (!l.length) return null;
    var item = l.shift();
    guardarPendentes(l);
    return item;
  }

  function pendentes() { return lerPendentes().length; }

  /* ---------------- o que o servidor recusou de vez ----------------
   * A fila de reenvio e para o que o servidor ainda PODE aceitar. Quando ele
   * recusa de forma definitiva (400/409 -- produto apagado, total invalido),
   * deixar o item na fila e pior do que parece: ele volta para a FRENTE a
   * cada tentativa, e como o reenvio para no primeiro erro, aquele item
   * sozinho bloqueia para sempre todos os outros. A loja ficaria achando que
   * sincronizou enquanto nenhuma venda antiga sobe.
   * Aqui o item sai da fila e fica guardado, com o motivo, para o gerente ver
   * e resolver. Nada e apagado em silencio. */
  function lerRejeitados() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_REJEITADOS) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function guardarRejeitados(lista) {
    try { localStorage.setItem(CHAVE_REJEITADOS, JSON.stringify(lista.slice(0, 200))); }
    catch (e) { /* cota cheia */ }
  }

  function rejeitar(item, motivo) {
    var l = lerRejeitados();
    l.push({
      tipo: item.tipo,
      dados: item.dados,
      em: item.em,
      motivo: motivo || 'recusado pelo servidor',
      rejeitadoEm: new Date().toISOString(),
    });
    guardarRejeitados(l);
  }

  function rejeitados() { return lerRejeitados().length; }

  /* Devolve o item ao FIM da fila. Nao ao começo: no começo, um item que o
   * servidor recusa (ou que ainda nao subiu por falta de rede) segura a fila
   * inteira na frente dele. */
  function reenfileirar(item) {
    var l = lerPendentes();
    l.push(item);
    guardarPendentes(l);
  }

  /* ---------------- nucleo HTTP ---------------- */

  function req(metodo, caminho, corpo, token, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000) : null;
    var headers = {};
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    /* token === null significa "explicitamente sem token" (usado no login,
       antes de existir sessao). Ausente significa "use o token guardado" --
       e foi essa distincao que faltava: passar null na migracao jogava fora
       a sessao valida e o servidor respondia 401. */
    var t = token === null ? null : (token === undefined ? lerToken() : token);
    if (t) headers['Authorization'] = 'Bearer ' + t;

    return fetch(base() + caminho, {
      method: metodo,
      headers: headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      // O servidor renova a sessao a cada requisicao e avisa o novo
      // vencimento neste header. Guardar aqui e o que permite avisar o
      // caixa antes da sessao morrer.
      var exp = r.headers && r.headers.get('X-Sessao-Expira');
      if (exp) guardarExpira(exp);
      return r.json().catch(function () { return {}; }).then(function (dados) {
        return { status: r.status, ok: r.ok, dados: dados };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      // Abort/TypeError aqui significa servidor fora do ar, nao erro de regra.
      estado.online = false;
      return { status: 0, ok: false, dados: { erro: 'Servidor fora do ar.' } };
    });
  }

  /* ---------------- sondagem e sessao ---------------- */

  function status() {
    return req('GET', '/api/status', undefined, null, 4000).then(function (r) {
      estado.online = r.status === 200;
      if (r.status === 200) {
        estado.migrado = !!r.dados.migrado;
        estado.versao = r.dados.versao;
      }
      return estado.online;
    });
  }

  function login(usuario, senha) {
    return req('POST', '/api/login', { usuario: usuario, senha: senha }, null, 8000)
      .then(function (r) {
        if (r.status === 200 && r.dados.token) {
          guardarToken(r.dados.token);
          if (r.dados.expiraEm) guardarExpira(r.dados.expiraEm);
          estado.autenticado = true;
          estado.usuario = r.dados.usuario || null;
          estado.online = true;
          estado.ultimoErro = null;
          return { ok: true, usuario: estado.usuario };
        }
        estado.ultimoErro = r.dados.erro || 'Não foi possível entrar.';
        return { ok: false, erro: estado.ultimoErro };
      });
  }

  function logout() {
    // Para a sondagem antes de jogar o token fora, senao o timer continua
    // batendo no servidor a cada 10 min com um token que nao existe mais.
    if (timerSessao) { clearInterval(timerSessao); timerSessao = null; }
    return req('POST', '/api/logout', {}).then(function () {
      guardarToken(null);
      estado.autenticado = false;
      estado.usuario = null;
    });
  }

  /* Revalida a sessao guardada. Usa /api/sessao (leve) e nao /api/base:
     nao ha motivo para puxar o catalogo inteiro so para checar um token. */
  function sessaoValida() {
    if (!lerToken()) return Promise.resolve(false);
    return req('GET', '/api/sessao', undefined, undefined, 6000).then(function (r) {
      if (r.status === 200) {
        estado.autenticado = true;
        estado.online = true;
        if (r.dados && r.dados.usuario) estado.usuario = r.dados.usuario;
        return true;
      }
      if (r.status === 401) {
        guardarToken(null);
        estado.autenticado = false;
        return false;
      }
      estado.online = false;
      return false;
    });
  }

  /* ---------------- dados ---------------- */

  /* Mantem a sessao viva sem o usuario perceber. A janela deslizante so
     avanca quando ha requisicao; um caixa que fica 2 h sem vender (almoço,
     fila na loja) voltaria com o token vencido. Uma sondagem leve a cada
     10 min resolve, e devolve o token a fila de reenvio de brinde. */
  var timerSessao = null;
  function manterSessaoViva(intervaloMs) {
    if (timerSessao) clearInterval(timerSessao);
    var iv = intervaloMs || 10 * 60 * 1000;
    timerSessao = setInterval(function () {
      if (!lerToken()) return;
      if (document.hidden) return; // aba em segundo plano: nao gasta
      req('GET', '/api/sessao', undefined, undefined, 5000).then(function (r) {
        estado.online = r.status === 200 || r.status === 401;
        if (r.status === 401) {
          guardarToken(null);
          estado.autenticado = false;
          avisarSessaoCaiu();
        }
      });
    }, iv);
    return timerSessao;
  }

  var onSessaoCaiu = null;
  function aoCairSessao(fn) { onSessaoCaiu = fn; }
  function avisarSessaoCaiu() {
    if (onSessaoCaiu) { try { onSessaoCaiu(); } catch (e) {} }
  }

  function base_() {
    return req('GET', '/api/base').then(function (r) {
      if (r.status !== 200) return null;
      estado.online = true;
      return r.dados;
    });
  }

  function vendas(opts) {
    opts = opts || {};
    var q = '/api/vendas?limite=' + (opts.limite || 500) + '&offset=' + (opts.offset || 0);
    if (opts.de) q += '&de=' + encodeURIComponent(opts.de);
    if (opts.ate) q += '&ate=' + encodeURIComponent(opts.ate);
    return req('GET', q).then(function (r) { return r.status === 200 ? r.dados : null; });
  }

  /* Envia uma venda. NUNCA lanca: devolve sempre {ok, ...} e, em falha de
     rede, enfileira para reenvio. O caixa nao pode ver erro por causa do
     servidor depois de entregar a mercadoria.
     `semEnfileirar` existe para o proprio reenvio: quando o item ja está na
     fila, deixar o `venda()` enfileirar de novo cria uma segunda cópia do
     mesmo registro e a fila dobra a cada tentativa. */
  function venda(v, opcoes) {
    opcoes = opcoes || {};
    return req('POST', '/api/venda', v).then(function (r) {
      if (r.status === 200) {
        estado.online = true;
        return { ok: true, venda: r.dados.venda, divergentes: r.dados.divergentes || [], repetida: !!r.dados.repetida };
      }
      if (r.status === 401) {
        guardarToken(null);
        estado.autenticado = false;
        return { ok: false, erro: r.dados.erro, semSessao: true };
      }
      if (r.status === 0) {
        if (!opcoes.semEnfileirar) enfileirar('venda', v);
        return {
          ok: false,
          servidorFora: true,
          enfileirada: !opcoes.semEnfileirar,
          erro: 'Servidor fora do ar — venda guardada para enviar depois.',
        };
      }
      /* 400/409 e recusa definitiva: o servidor ja decidiu que esse registro
         nao entra. Guardar na fila so faria ele voltar sempre. Erro 5xx, ao
         contrario, e problema do servidor e vale tentar de novo. */
      var definitivo = r.status >= 400 && r.status < 500;
      if (!definitivo && !opcoes.semEnfileirar) enfileirar('venda', v);
      return {
        ok: false,
        definitivo: definitivo,
        enfileirada: !definitivo && !opcoes.semEnfileirar,
        erro: r.dados.erro,
        codigo: r.dados.codigo,
        status: r.status,
      };
    });
  }

  /* Estorno vai ao servidor antes de confidentemente. O servidor devolve o
     estoque, baixa a divida e tira do turno; se ele nao souber do estorno, os
     outros 4 caixas continuam vendo a mercadoria como disponivel. */
  function estornar(vendaId, motivo, opcoes) {
    opcoes = opcoes || {};
    return req('POST', '/api/venda/estornar', { id: vendaId, motivo: motivo }, undefined, 10000)
      .then(function (r) {
        if (r.status === 200) { estado.online = true; return { ok: true, venda: r.dados.venda }; }
        if (r.status === 401) { guardarToken(null); estado.autenticado = false; return { ok: false, semSessao: true, erro: r.dados.erro }; }
        if (r.status === 0) {
          if (!opcoes.semEnfileirar) enfileirar('estorno', { id: vendaId, motivo: motivo });
          return { ok: false, servidorFora: true, enfileirada: !opcoes.semEnfileirar };
        }
        var definitivo = r.status >= 400 && r.status < 500;
        if (!definitivo && !opcoes.semEnfileirar) enfileirar('estorno', { id: vendaId, motivo: motivo });
        return { ok: false, definitivo: definitivo, enfileirada: !definitivo && !opcoes.semEnfileirar, erro: r.dados.erro, status: r.status };
      });
  }

  function salvar(colecao, lista, opcoes) {
    opcoes = opcoes || {};
    return req('POST', '/api/' + colecao, { lista: lista }).then(function (r) {
      if (r.status === 200) return { ok: true, gravados: r.dados.gravados };
      if (r.status === 0) {
        if (!opcoes.semEnfileirar) enfileirar(colecao, lista);
        return { ok: false, servidorFora: true, enfileirada: !opcoes.semEnfileirar };
      }
      if (r.status === 401) { guardarToken(null); estado.autenticado = false; return { ok: false, semSessao: true, erro: r.dados.erro }; }
      var definitivo = r.status >= 400 && r.status < 500;
      if (!definitivo && !opcoes.semEnfileirar) enfileirar(colecao, lista);
      return { ok: false, definitivo: definitivo, enfileirada: !definitivo && !opcoes.semEnfileirar, erro: r.dados.erro, status: r.status };
    });
  }

  function migrar(db) {
    return req('POST', '/api/migrar', {
      products: db.products || [],
      customers: db.customers || [],
      suppliers: db.suppliers || [],
      sales: db.sales || [],
      entries: db.entries || [],
      shifts: db.shifts || [],
      purchases: db.purchases || [],
      payables: db.payables || [],
      auth: { users: (db.auth && db.auth.users) || [] },
      config: db.config || null,
      loyalty: db.loyalty || null,
    }, undefined, 60000).then(function (r) {
      if (r.status === 200) {
        estado.migrado = true;
        try { localStorage.setItem(CHAVE_MIGRADO, 'sim'); } catch (e) {}
        return { ok: true, contagem: r.dados.contagem };
      }
      return { ok: false, erro: r.dados.erro || 'Falha ao migrar.' };
    });
  }

  function migrado() {
    try { return localStorage.getItem(CHAVE_MIGRADO) === 'sim'; } catch (e) { return false; }
  }

  /* Reenvia o que ficou na fila. Chamado ao abrir o app e depois de cada
     venda, para a fila nao crescer em silencio.
     IMPORTANTE: aqui cada envio e uma Promise, e a resposta so existe DEPOIS
     do await. A versao anterior testava `p.ok` direto no objeto da Promise --
     que da `undefined` sempre. Consequencia: nenhum item nunca contava como
     enviado, o loop parava no primeiro e devolvia o item para a frente da
     fila. A fila nao esvaziava NUNCA, e a tela dizia "X ainda na fila" para
     sempre, achando que tinha sincronizado. As vendas feitas durante a queda
     de rede nunca chegavam ao servidor. */
  function reenviar() {
    if (!lerToken()) return Promise.resolve({ ok: false, pendentes: pendentes(), motivo: 'sem sessao' });
    if (estado.verificando) return Promise.resolve({ ok: false, pendentes: pendentes(), motivo: 'ja rodando' });
    estado.verificando = true;

    var enviados = 0;
    var recusados = 0;
    var parar = null;

    function passo() {
      var item = desenfileirar();
      if (!item) return Promise.resolve();

      var p = item.tipo === 'venda'
        ? venda(item.dados, { semEnfileirar: true })
        : item.tipo === 'estorno'
        ? estornar(item.dados.id, item.dados.motivo, { semEnfileirar: true })
        : salvar(item.tipo, [].concat(item.dados), { semEnfileirar: true });

      return p.then(function (r) {
        if (r && r.ok) { enviados++; return passo(); }

        /* Servidor fora do ar: nao adianta tentar os 500 itens, todos vao
         * falhar do mesmo jeito. Devolve este ao fim da fila e encerra. */
        if (r && r.servidorFora) {
          reenfileirar(item);
          parar = 'servidor fora do ar';
          return;
        }

        /* Sessao morreu no meio: o caixa precisa entrar de novo. O item volta
         * para a fila (nao e recusa do dado) e a sincronizacao para. */
        if (r && r.semSessao) {
          reenfileirar(item);
          parar = 'sessao expirada';
          avisarSessaoCaiu();
          return;
        }

        /* Recusa definitiva (400/409): este registro nao vai passar nunca.
         * Sai da fila para a lista de rejeitados com o motivo, senao ele
         * trava a fila inteira na frente. */
        if (r && r.definitivo) {
          recusados++;
          rejeitar(item, r.erro || r.codigo);
          return passo();
        }

        /* Falha inesperada: devolve ao fim e para. Melhor repetir depois do
         * que perder o registro. */
        reenfileirar(item);
        parar = (r && r.erro) || 'falha ao reenviar';
      }, function (e) {
        reenfileirar(item);
        parar = (e && e.message) || 'excecao no reenvio';
      });
    }

    return passo().then(function () {
      estado.verificando = false;
      return {
        ok: enviados > 0 || (!parar && recusados === 0),
        enviados: enviados,
        recusados: recusados,
        restam: pendentes(),
        rejeitados: rejeitados(),
        motivo: parar,
      };
    }).catch(function () {
      estado.verificando = false;
      return { ok: false, enviados: enviados, recusados: recusados, restam: pendentes(), rejeitados: rejeitados() };
    });
  }

  global.API = {
    estado: estado,
    status: status,
    login: login,
    logout: logout,
    sessaoValida: sessaoValida,
    minutosParaExpirar: minutosParaExpirar,
    manterSessaoViva: manterSessaoViva,
    aoCairSessao: aoCairSessao,
    base: base_,
    vendas: vendas,
    venda: venda,
    estornar: estornar,
    salvar: salvar,
    migrar: migrar,
    migrado: migrado,
    reenviar: reenviar,
    pendentes: pendentes,
    rejeitados: rejeitados,
  };
})(window);

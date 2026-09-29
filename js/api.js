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
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch (e) { /* modo privado sem storage: segue so em memoria */ }
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
    return req('POST', '/api/logout', {}).then(function () {
      guardarToken(null);
      estado.autenticado = false;
      estado.usuario = null;
    });
  }

  /* Revalida a sessao guardada. O token dura 12 h; um caixa que ficou
     aberto o expediente inteiro precisa saber disso antes de a proxima
     venda ser recusada por 401. */
  function sessaoValida() {
    if (!lerToken()) return Promise.resolve(false);
    return req('GET', '/api/base', undefined, undefined, 6000).then(function (r) {
      if (r.status === 200) {
        estado.autenticado = true;
        estado.online = true;
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
     servidor depois de entregar a mercadoria. */
  function venda(v) {
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
        enfileirar('venda', v);
        return { ok: false, enfileirada: true, erro: 'Servidor fora do ar — venda guardada para enviar depois.' };
      }
      // 409 (produto sumiu) e 400 sao recusa definitiva: nao enfileira,
      // senao o servidor reprocessaria uma venda que ele ja recusou.
      return { ok: false, erro: r.dados.erro, codigo: r.dados.codigo };
    });
  }

  function salvar(colecao, lista) {
    return req('POST', '/api/' + colecao, { lista: lista }).then(function (r) {
      if (r.status === 0) { enfileirar(colecao, lista); return { ok: false, enfileirada: true }; }
      return { ok: r.status === 200, gravados: r.dados.gravados };
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
     venda, para a fila nao crescer em silencio. */
  function reenviar() {
    if (!lerToken()) return Promise.resolve({ ok: false, pendentes: pendentes() });
    if (estado.verificando) return Promise.resolve({ ok: false, pendentes: pendentes() });
    estado.verificando = true;

    function passo() {
      var item = desenfileirar();
      if (!item) return Promise.resolve({ ok: true, enviados: 0, restam: 0 });
      var p = item.tipo === 'venda'
        ? venda(item.dados)
        : salvar(item.tipo, [].concat(item.dados));
      if (p && p.ok) return passo().then(function (r) {
        r.enviados = (r.enviados || 0) + 1;
        return r;
      });
      // Falhou de novo: devolve para o fim da fila e para por agora.
      if (p && p.enfileirada) return Promise.resolve({ ok: false, enviados: 0, restam: pendentes() });
      guardarPendentes([item].concat(lerPendentes()));
      return Promise.resolve({ ok: false, enviados: 0, restam: pendentes() });
    }

    return passo().then(function (r) {
      estado.verificando = false;
      return r;
    }).catch(function () {
      estado.verificando = false;
      return { ok: false, restam: pendentes() };
    });
  }

  global.API = {
    estado: estado,
    status: status,
    login: login,
    logout: logout,
    sessaoValida: sessaoValida,
    base: base_,
    vendas: vendas,
    venda: venda,
    salvar: salvar,
    migrar: migrar,
    migrado: migrado,
    reenviar: reenviar,
    pendentes: pendentes,
  };
})(window);

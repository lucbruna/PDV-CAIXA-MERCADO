/* ==========================================================================
   app.js — Shell: login, tema, rail, roteamento, abas de gestão.
   ========================================================================== */
(function (global) {
  'use strict';

  var UI = global.UI, Store = global.Store, PDV = global.PDV;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc, money = UI.money, icon = UI.icon;
  var el = UI.el, iconEl = UI.iconEl, frag = UI.frag;

  var PAGES = [
    { id: 'dashboard', label: 'Início',    icon: 'home',      perm: null },
    { id: 'pdv',       label: 'Caixa',     icon: 'cart',      perm: 'pdv' },
    { id: 'sales',     label: 'Vendas',    icon: 'receipt',   perm: 'sales' },
    { id: 'products',  label: 'Produtos',  icon: 'box',       perm: 'products' },
    { id: 'purchases', label: 'Compras',   icon: 'truck',     perm: 'purchases' },
    { id: 'customers', label: 'Clientes',  icon: 'users',     perm: 'customers' },
    { id: 'finance',   label: 'Financeiro',icon: 'wallet',    perm: 'finance' },
    { id: 'payables',  label: 'Contas',    icon: 'invoice',   perm: 'payables' },
    { id: 'reports',   label: 'Relatórios',icon: 'chart',     perm: 'reports' },
    { id: 'settings',  label: 'Ajustes',   icon: 'gear',      perm: null }
  ];

  var current = 'dashboard';

  /* ================= TEMA ================= */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1220' : '#e3eaf3');
    var b = $('#themeBtn');
    if (b) UI.fill(b, iconEl(t === 'dark' ? 'sun' : 'moon', 15));
  }
  function toggleTheme() {
    var next = Store.db.config.theme === 'dark' ? 'light' : 'dark';
    Store.db.config.theme = next;
    Store.save();
    applyTheme(next);
    UI.toast('Tema ' + (next === 'dark' ? 'escuro' : 'claro') + ' ativado.', 'ok');
  }

  /* ================= LOGIN ================= */
  /* O overlay #authScreen é opaco, cobre a tela inteira (z-index 900) e só
     some com a classe .hidden. Esconder o overlay NÃO pode depender do clique
     no botão: se a sessão já estiver salva, start() nunca passa por aqui e o
     operador ficava olhando para um retângulo escuro sobre o sistema inteiro.
     Toda entrada/saída de login passa obrigatoriamente por aqui. */
  function hideLogin() {
    var a = $('#authScreen');
    if (a) a.classList.add('hidden');
  }

  function showLogin(msg) {
    var a = $('#authScreen');
    a.classList.remove('hidden');
    UI.fill(a, el('div', { class: 'auth-box' }, [
      el('div', { class: 'auth-logo' }, iconEl('cart', 30)),
      el('h2', null, 'Sudam Gestão'),
      el('p', { class: 'sub' }, 'Frente de caixa e gestão do mercadinho'),
      el('div', { class: 'auth-card' }, [
        msg ? el('div', { class: 'auth-err show' }, msg) : null,
        el('label', { class: 'lbl' }, 'Usuário'),
        el('input', { class: 'field', id: 'authUser', autocomplete: 'username', placeholder: 'Digite seu usuário' }),
        el('label', { class: 'lbl' }, 'Senha'),
        el('input', { class: 'field', id: 'authPass', type: 'password', autocomplete: 'current-password', placeholder: 'Digite sua senha' }),
        el('button', { class: 'auth-btn', id: 'authGo' }, [iconEl('logout', 17), ' Entrar no sistema']),
        el('div', { class: 'auth-qk' }, [
          el('button', { 'data-qk': 'admin' }, ['Administrador', el('small', null, 'admin / 1234')])
        ])
      ])
    ]));

    $('#authGo').onclick = attemptLogin;
    $('#authPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptLogin(); });
    $('#authUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#authPass').focus(); });
    a.addEventListener('click', function (e) {
      var qk = e.target.closest('[data-qk]');
      if (!qk) return;
      var isAdmin = qk.dataset.qk === 'admin';
      $('#authUser').value = isAdmin ? 'admin' : 'caixa1';
      $('#authPass').value = isAdmin ? '1234' : '0000';
      attemptLogin();
    });
    setTimeout(function () { $('#authUser').focus(); }, 60);
  }

  function attemptLogin() {
    var u = $('#authUser').value.trim();
    var p = $('#authPass').value;
    if (!u || !p) { showLogin('Preencha usuário e senha.'); return; }
    var btn = $('#authGo');
    if (btn) btn.disabled = true;
    /* Passa pelo servidor quando ha um (scrypt no mini PC). A funcao
       resolve sempre -- nunca lanca -- para o botao nao ficar preso. */
    Store.loginComServidor(u, p).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r || !r.ok) { showLogin((r && r.erro) || 'Usuário ou senha incorretos.'); return; }
      hideLogin();
      Store.save();
      // Com o servidor no ar, os 5 caixas passam a ler a mesma base.
      Store.puxarDoServidor().then(function () {
        start();
        UI.toast('Bem-vindo, ' + (r.usuario.name || u) + '!', 'ok');
        if (r.local) UI.toast('Servidor fora do ar — entrando em modo local.', 'warn', 5000);
      });
    }).catch(function () {
      if (btn) btn.disabled = false;
      showLogin('Não foi possível entrar. Tente novamente.');
    });
  }

  function logout() {
    UI.confirm({ title: 'Sair do sistema?', kind: 'warn', message: 'Os dados já foram salvos neste navegador.', confirmText: 'Sair' })
      .then(function (ok) {
        if (!ok) return;
        Store.logout();
        location.hash = '';
        showLogin();
      });
  }

  /* ================= SHELL ================= */
  function buildShell() {
    var u = Store.currentUser();
    var app = $('#app');
    UI.fill(app, frag(
      el('nav', { class: 'rail' }, [
        el('div', { class: 'rail-logo' }, iconEl('cart', 21)),
        el('div', { class: 'rail-nav', id: 'railNav' }),
        el('div', { class: 'rail-foot' }, [
          el('button', { class: 'rail-btn', id: 'themeBtn', title: 'Alternar tema (Ctrl+Shift+D)' }),
          el('button', { class: 'rail-btn', id: 'cfgBtn', title: 'Configurações (F12)' }, [iconEl('gear', 19), el('em', null, 'Ajustes')]),
          el('button', { class: 'rail-btn', id: 'logoutBtn', title: 'Sair' }, [iconEl('logout', 19), el('em', null, 'Sair')])
        ])
      ]),
      el('div', { class: 'work' }, [
        el('header', { class: 'topbar' }, [
          el('div', null, [el('h1', { id: 'pageTitle' }, 'Início'), el('div', { class: 'sub', id: 'pageSub' })]),
          el('div', { class: 'tb-sep' }),
          el('div', { class: 'tb-right' }, [
            el('span', { class: 'clock', id: 'clock' }),
            el('span', { class: 'chip', id: 'shiftChip' }),
            el('button', { class: 'btn sm', id: 'shiftBtn' }),
            el('button', { class: 'btn sm', id: 'fullscreenBtn', title: 'Alternar tela cheia' }, 'Tela cheia'),
            el('div', { class: 'user-pill' }, [
              el('span', { class: 'avatar', id: 'avatar' }, (u ? u.name : '?').slice(0, 2).toUpperCase()),
              el('span', null, [el('b', null, u ? u.name : ''), el('small', null, roleLabel(u))])
            ])
          ])
        ]),
        el('div', { class: 'content', id: 'view' })
      ]),
      el('div', { id: 'toastWrap', class: 'toast-wrap' }),
      el('input', { type: 'file', id: 'importFile', accept: '.json,application/json', style: { display: 'none' } })
    ));

    $('#themeBtn').onclick = toggleTheme;
    $('#cfgBtn').onclick = function () { go('settings'); };
    $('#logoutBtn').onclick = logout;
    $('#shiftBtn').onclick = toggleShift;
    $('#fullscreenBtn').onclick = alternarTelaCheia;
    document.addEventListener('fullscreenchange', atualizarBotaoTelaCheia);
    applyTheme(Store.db.config.theme);
    renderRail();
    tickClock();
    setInterval(tickClock, 15000);
  }

  function alternarTelaCheia() {
    var acao = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    if (acao && acao.catch) acao.catch(function () {
      UI.toast('O navegador nao permitiu abrir em tela cheia. Use F11.', 'warn');
    });
  }

  function atualizarBotaoTelaCheia() {
    var b = $('#fullscreenBtn');
    if (b) b.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
  }

  function roleLabel(u) {
    if (!u) return '';
    return { admin: 'Administrador', gerente: 'Gerente', caixa: 'Caixa', estoque: 'Estoquista' }[u.role] || u.role;
  }

  function renderRail() {
    var u = Store.currentUser();
    var nav = $('#railNav');
    if (!nav) return;
    var low = Store.db.products.filter(function (p) { return p.active && p.stock <= p.min; }).length;
    var debt = Store.db.customers.reduce(function (a, c) { return a + (Number(c.debt) || 0); }, 0);

    UI.fill(nav, PAGES.filter(function (p) { return !p.perm || Store.can(p.perm) || p.perm === 'pdv'; }).map(function (p) {
      var dot = null;
      if (p.id === 'products' && low) dot = el('span', { class: 'dot' });
      if (p.id === 'customers' && debt > 0) dot = el('span', { class: 'dot', style: { background: 'var(--amber)' } });
      return el('button', { class: 'rail-btn', 'data-page': p.id, title: p.label }, [iconEl(p.icon, 19), el('em', null, p.label), dot]);
    }));

    /* onclick (e nao addEventListener): renderRail roda a cada render e os
       listeners se acumulariam, disparando go() N vezes por clique. */
    nav.onclick = function (e) {
      var b = e.target.closest('[data-page]');
      if (b) go(b.dataset.page);
    };
  }

  function tickClock() {
    var c = $('#clock');
    if (!c) return;
    var d = new Date();
    c.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var u = Store.currentUser();
    if (u) {
      var a = $('#avatar');
      if (a) a.textContent = u.name.slice(0, 2).toUpperCase();
    }
  }

  function updateShiftUI() {
    var db = Store.db;
    var chip = $('#shiftChip'), btn = $('#shiftBtn');
    if (!chip || !btn) return;
    if (db.shift) {
      chip.className = 'chip ok';
      UI.fill(chip, frag(el('span', { class: 'pulse' }), ' ' + db.shift.operator + ' · ' + money(db.shift.cashExpected) + ' em caixa'));
      chip.title = 'Clique para conferir e fechar o caixa';
      chip.onclick = closeShiftFlow;
      btn.className = 'btn sm warn';
      UI.fill(btn, frag(iconEl('lock', 13), ' Fechar caixa'));
    } else {
      chip.className = 'chip err';
      UI.fill(chip, frag(el('span', { class: 'pulse' }), ' Caixa fechado'));
      chip.onclick = toggleShift;
      btn.className = 'btn sm primary';
      UI.fill(btn, frag(iconEl('wallet', 13), ' Abrir caixa'));
    }
  }

  function toggleShift() {
    if (Store.db.shift) return closeShiftFlow();
    PDV.requireShift();
  }

  function closeShiftFlow() {
    var s = Store.db.shift;
    if (!s) return;
    var db = Store.db;
    var cashSales = db.sales.filter(function (x) {
      return x.shiftId === s.id && x.status !== 'Estornada' &&
        x.payments.some(function (p) { return p.method === 'Dinheiro'; });
    });
    var cashIn = cashSales.reduce(function (a, x) {
      return a + x.payments.filter(function (p) { return p.method === 'Dinheiro'; })
        .reduce(function (b, p) { return b + p.amount; }, 0) - (x.change || 0);
    }, 0);
    var expected = UI.round2(s.opening + cashIn + s.movements.reduce(function (a, m) {
      return a + (m.type === 'Entrada' ? m.amount : -m.amount);
    }, 0));

    var byMethod = {};
    db.sales.filter(function (x) { return x.shiftId === s.id && x.status !== 'Estornada'; })
      .forEach(function (x) {
        x.payments.forEach(function (p) { var valor = p.amount - (p.method === 'Dinheiro' ? (x.change || 0) : 0); byMethod[p.method] = UI.round2((byMethod[p.method] || 0) + valor); });
      });

    UI.modal({
      title: 'Fechar caixa de ' + esc(s.operator), icon: 'lock', size: 'md',
      body:
        '<div class="grid kpis" style="margin-bottom:14px">' +
          kpi('Fundo inicial', money(s.opening), 'na abertura') +
          kpi('Vendas no turno', String(s.sales.length), money(cashIn) + ' em dinheiro') +
          kpi('Esperado no caixa', money(expected), 'contagem calculada', 'amber') +
        '</div>' +
        '<div class="form-grid">' +
          UI.field('Dinheiro contado (R$)', 'counted', '', { type: 'money', step: '0.01', min: 0, placeholder: '0,00' }) +
          UI.field('Observação do fechamento', 'note', '', { placeholder: 'Ex.: sem ocorrências' }) +
        '</div>' +
        '<div class="modal-note">Compare o valor contado com o esperado. A diferença fica registrada na auditoria do turno.</div>' +
        '<div class="mt-2"><div class="pay-label">Resumo por forma de pagamento</div>' +
          '<div class="term-row">' + Object.keys(byMethod).map(function (m) {
            return '<div class="term"><b class="num">' + money(byMethod[m]) + '</b><span>' + esc(m) + '</span></div>';
          }).join('') + '</div></div>' +
        (s.movements.length ? '<div class="mt-2"><div class="pay-label">Movimentações do gaveteiro</div>' +
          '<div class="list-plain">' + s.movements.map(function (m) {
            return '<div class="stat-mini"><span>' + esc(m.type) + ' · ' + esc(m.reason) + '</span><b>' + (m.type === 'Entrada' ? '+' : '−') + ' ' + money(m.amount) + '</b></div>';
          }).join('') + '</div></div>' : ''),
      confirmText: 'Fechar caixa',
      onMount: function (root, close) { root._closeShiftDialog = close; },
      onConfirm: function (root) {
        var d = UI.formData(root);
        var counted = UI.round2(UI.parseNum(d.counted));
        if (d.counted === '' || counted < 0) { UI.toast('Informe o dinheiro contado.', 'err'); return false; }
        var diff = UI.round2(counted - expected);
        var finalizarLocal = function () {
          Store.closeShift(counted);
          s.note = d.note || ''; s.expectedCash = expected; s.totalsByMethod = byMethod;
          s.voidedCount = 0; Store.save(); rerender();
        };
        if (API.estado && API.estado.online && API.fecharTurno) {
          API.fecharTurno(s.id, counted, { nota: d.note || '', resumoPorForma: byMethod, movimentacoes: s.movements || [] }).then(function (r) {
            if (!r.ok) { UI.toast(r.erro + ' O caixa continua aberto neste computador.', 'err', 7000); return; }
            if (r.turno) { expected = Number(r.turno.cashExpected) || expected; diff = Number(r.turno.difference) || 0; Object.assign(s, r.turno); }
            finalizarLocal(); root._closeShiftDialog();
            UI.modal({ title: diff === 0 ? 'Caixa fechado sem diferenca' : 'Fechamento com diferenca', icon: diff === 0 ? 'check' : 'alert', size: 'sm', body: 'Esperado: ' + money(expected) + ' · Contado: ' + money(counted), confirmText: 'OK' });
          });
          return false;
        }
        finalizarLocal();
        UI.modal({
          title: diff === 0 ? 'Caixa fechado sem diferença' : (diff > 0 ? 'Sobra de ' + money(diff) : 'Falta de ' + money(-diff)),
          icon: diff === 0 ? 'check' : 'alert', size: 'sm', footer: false,
          body: '<div class="confirm-box"><div class="confirm-icon ' + (diff === 0 ? 'info' : 'warn') + '">' + icon(diff === 0 ? 'check' : 'alert', 23) + '</div>' +
            '<p>Esperado: <strong>' + money(expected) + '</strong><br>Contado: <strong>' + money(counted) + '</strong></p>' +
            '<div class="modal-note ' + (diff === 0 ? 'ok' : 'warn') + '">' +
            (diff === 0 ? 'Turno encerrado com a contagem correta.' : 'Diferença de <b>' + money(Math.abs(diff)) + '</b> registrada no turno ' + esc(s.id) + '.') +
            '</div></div>',
          onMount: function (r, close) {
            r.querySelector('.modal-body').insertAdjacentHTML('beforeend',
              '<div class="row mt-2" style="justify-content:flex-end"><button class="btn" data-print>Imprimir fechamento</button><button class="btn primary" data-ok>OK</button></div>');
            r.querySelector('[data-ok]').onclick = close;
            r.querySelector('[data-print]').onclick = function () { printShiftReport(s.id); };
          }
        });
      }
    });
  }

  function printShiftReport(id) {
    var s = Store.db.shifts.find(function (x) { return x.id === id; });
    if (!s) return;
    var c = Store.db.config;
    var html = '<div class="c b">' + esc(c.storeName) + '</div>' +
      '<div class="c">FECHAMENTO DE CAIXA</div><div class="sep"></div>' +
      '<div class="r"><span>Operador</span><span>' + esc(s.operator) + '</span></div>' +
      '<div class="r"><span>Abertura</span><span>' + UI.dt(s.openedAt) + '</span></div>' +
      '<div class="r"><span>Fechamento</span><span>' + UI.dt(s.closedAt) + '</span></div>' +
      '<div class="r"><span>Fundo inicial</span><span>' + UI.num(s.opening) + '</span></div>' +
      '<div class="r"><span>Vendas</span><span>' + s.sales.length + '</span></div>' +
      (s.movements.length ? '<div class="sep"></div><div class="b">GA VETERINO</div>' : '') +
      s.movements.map(function (m) {
        return '<div class="r"><span>' + esc(m.type) + ' ' + esc(m.reason) + '</span><span>' + UI.num(m.amount) + '</span></div>';
      }).join('') +
      '<div class="sep"></div>' +
      '<div class="r b"><span>Esperado</span><span>' + UI.num((s.opening || 0) + (s.cashExpected - s.opening || 0)) + '</span></div>' +
      '<div class="r b"><span>Contado</span><span>' + UI.num(s.counted) + '</span></div>' +
      '<div class="r b"><span>Diferença</span><span>' + UI.num(s.difference || 0) + '</span></div>';
    UI.printHTML(html, 80);
  }

  /* ================= HELPERS DE VIEWS ================= */
  /* O #view é um elemento persistente: ligar listeners direto nele a cada
     render os acumula (um clique passaria a disparar N vezes). Por isso cada
     render cria um #viewInner descartável que carrega os listeners. */
  function freshView() {
    var view = $('#view');
    if (!view) return null;
    view.innerHTML = '';
    var inner = document.createElement('div');
    inner.id = 'viewInner';
    inner.style.display = 'contents';
    view.appendChild(inner);
    return inner;
  }

  /* Uma view devolve string (telas ainda por migrar) ou nós montados com
     createElement. pintar aceita os dois, para a migração ser por tela. */
  function pintar(container, conteudo) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (typeof conteudo === 'string') container.innerHTML = conteudo;
    else if (conteudo) container.appendChild(conteudo);
  }
  /* Variantes em NÓ. As versões em string continuam existindo para as telas
     ainda por migrar, então a conversão pode ser feita tela a tela sem
     quebrar as outras. Toda view nova usa as versões *El. */
  function kpiEl(label, value, foot, tone, spark) {
    return el('div', { class: 'card kpi ' + (tone || '') }, [
      el('div', { class: 'kpi-label' }, el('i')),
      el('div', { class: 'kpi-value num' }, value),
      foot ? el('div', { class: 'kpi-foot' }, foot) : null,
      spark ? UI.sparklineEl(spark) : null
    ]);
  }
  function kpi(label, value, foot, tone, spark) { return kpiEl(label, value, foot, tone, spark).outerHTML; }

  function cardEl(title, body, extra, iconName) {
    var head = el('div', { class: 'card-head' }, el('h2', null, [iconName ? iconEl(iconName, 16) : null, title]));
    UI.appendBody(head, extra || '');
    var sec = el('section', { class: 'card' }, head);
    UI.appendBody(sec, body);
    return sec;
  }
  function card(title, body, extra, iconName) { return cardEl(title, body, extra, iconName).outerHTML; }

  function emptyEl(msg, sub, ico) {
    return el('div', { class: 'empty' }, [
      el('span', { class: 'ico' }, iconEl(ico || 'info', 34)),
      el('b', null, msg),
      sub || ''
    ]);
  }
  function empty(msg, sub, ico) { return emptyEl(msg, sub, ico).outerHTML; }

  /* Cabeçalho padrão das telas. `actions` aceita nó ou markup constante. */
  function pageHead(title, sub, actions) {
    var box = el('div', { class: 'page-head' }, el('div', null, [el('h1', null, title), el('p', null, sub)]));
    if (actions) {
      var a = el('div', { class: 'actions' });
      UI.appendBody(a, actions);
      box.appendChild(a);
    }
    return box;
  }

  /* Botão com ícone opcional e ação real, sem onclick inline. */
  function btn(label, iconName, cls, fn) {
    return el('button', { class: cls || 'btn', onclick: fn || null },
      iconName ? [iconEl(iconName, 14), ' ' + label] : label);
  }

  /* Tabela com cabeçalho. `headers` aceita string ou {label, right}. */
  function tabela(headers, rows, foot) {
    var thead = el('thead', null, el('tr', null, headers.map(function (h) {
      var h2 = (h && typeof h === 'object') ? h : { label: h };
      return el('th', h2.right ? { class: 'right' } : null, h2.label);
    })));
    return el('div', { class: 'table-wrap' },
      el('table', null, [thead, el('tbody', null, rows), foot || null]));
  }

  function salesOfDay(dateStr) {
    return Store.db.sales.filter(function (s) {
      return s.status !== 'Estornada' && new Date(s.date).toDateString() === dateStr;
    });
  }
  function totalOf(list) {
    return UI.round2(list.reduce(function (a, s) { return a + s.total; }, 0));
  }
  function lastDays(n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      out.push({ date: d, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), key: d.toDateString() });
    }
    return out;
  }
  function costOf(list) {
    return UI.round2(list.reduce(function (a, s) {
      return a + (s.items || []).reduce(function (b, i) { return b + (Number(i.cost) || 0) * i.qty; }, 0);
    }, 0));
  }

  /* ================= VIEWS ================= */
  var Views = {};

  /* ---------- PDV (delega ao módulo pdv.js) ---------- */
  Views.pdv = function () { return global.PDV.render(); };

  /* ---------- DASHBOARD ---------- */
  Views.dashboard = function () {
    var db = Store.db;
    var today = salesOfDay(UI.today());
    var week = lastDays(7).map(function (d) { return { l: d.label, v: totalOf(salesOfDay(d.key)) }; });
    var low = db.products.filter(function (p) { return p.active && p.stock <= p.min; });
    var expiry = db.products.filter(function (p) { return p.expiry && UI.daysBetween(UI.today(), p.expiry) <= 30; });
    var debt = UI.round2(db.customers.reduce(function (a, c) { return a + (Number(c.debt) || 0); }, 0));
    var receivableOpen = db.entries.filter(function (e) { return e.type === 'A receber' && !e.settled; });
    var payableOpen = db.entries.filter(function (e) { return e.type === 'A pagar' && !e.settled; });
    var stockValue = UI.round2(db.products.reduce(function (a, p) { return a + p.stock * p.cost; }, 0));
    var rev = totalOf(today), cost = costOf(today);
    var profit = UI.round2(rev - cost);

    return frag(
      pageHead('Bom dia, ' + ((Store.currentUser() || {}).name || ''),
        new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) +
        ' — operação do ' + db.config.storeName + '.',
        [
          btn('Produtos', 'box', 'btn', function () { go('products'); }),
          btn('Abrir frente de caixa', 'cart', 'btn primary', function () { go('pdv'); })
        ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Vendas hoje', money(rev), today.length + ' operação(ões)', 'accent', week.map(function (w) { return w.v; })),
        kpiEl('Lucro estimado', money(profit), rev ? 'margem ' + UI.pct(rev ? profit / rev * 100 : 0) : 'sem vendas', 'teal'),
        kpiEl('Ticket médio', money(today.length ? rev / today.length : 0), 'por operação'),
        kpiEl('A receber (fiado)', money(debt), db.customers.filter(function (c) { return c.debt > 0; }).length + ' cliente(s)', 'purple'),
        kpiEl('Valor em estoque', money(stockValue), db.products.length + ' produtos', 'blue')
      ]),

      el('div', { class: 'grid two' }, [
        cardEl('Vendas dos últimos 7 dias', UI.lineChartEl(week), '', 'chart'),
        el('div', { class: 'grid', style: { gap: '13px' } }, [
          cardEl('Formas de pagamento (hoje)', paymentDonut(today)),
          cardEl('Atenção necessária', attentionBlock(low, expiry, receivableOpen, payableOpen))
        ])
      ]),

      el('div', { class: 'grid two mt-2' }, [
        cardEl('Movimento recente', recentSalesTable(db.sales.slice(0, 8)), btn('Ver todas', null, 'btn sm', function () { go('sales'); }), 'receipt'),
        cardEl('Caixa e turno', shiftPanel(), '', 'wallet')
      ]),
      el('div', { style: { height: '10px' } }),
      cardEl('Produtos para repor', lowStockTable(low),
        low.length ? btn('Montar compra', 'truck', 'btn sm', function () { go('purchases'); }) : '', 'truck')
    );
  };

  /* Linha rótulo/valor usada em modais e painéis. */
  function stat(label, value) {
    return el('div', { class: 'stat-mini' }, [el('span', null, label), el('b', null, value)]);
  }

  function paymentDonut(list) {
    var by = {};
    list.forEach(function (s) {
      s.payments.forEach(function (p) { by[p.method] = UI.round2((by[p.method] || 0) + p.amount); });
    });
    var data = Object.keys(by).map(function (k) { return { l: k, v: by[k] }; });
    if (!data.length) return emptyEl('Nenhuma venda hoje', 'Os pagamentos aparecem aqui.');
    return UI.donutChartEl(data);
  }

  function attentionBlock(low, expiry, recv, pay) {
    var items = [];
    if (low.length) items.push({ icon: 'alert', text: [el('b', null, String(low.length)), ' produto(s) abaixo do estoque mínimo'], go: 'products' });
    var venc = recv.filter(function (e) { return e.due && UI.daysBetween(UI.today(), e.due) < 0; });
    if (venc.length) items.push({ icon: 'debt', text: [el('b', null, String(venc.length)), ' título(s) em atraso'], go: 'payables' });
    var vencP = pay.filter(function (e) { return e.due && UI.daysBetween(UI.today(), e.due) < 0; });
    if (vencP.length) items.push({ icon: 'invoice', text: [el('b', null, String(vencP.length)), ' conta(s) a pagar vencida(s)'], go: 'payables' });
    var soon = expiry.filter(function (p) { return UI.daysBetween(UI.today(), p.expiry) >= 0; });
    if (soon.length) items.push({ icon: 'clock', text: [el('b', null, String(soon.length)), ' produto(s) vencendo em até 30 dias'], go: 'products' });
    if (!db_hasSales()) items.push({ icon: 'target', text: 'Cadastre produtos e faça a primeira venda', go: 'products' });
    if (!items.length) return emptyEl('Tudo em ordem', 'Nenhum alerta no momento.', 'check');
    return el('div', { class: 'list-plain' }, items.map(function (i) {
      return el('div', { class: 'list-item', 'data-go': i.go, style: { cursor: 'pointer' } }, [
        el('span', { class: 'thumb-emoji', style: { background: 'var(--warn-bg)', color: 'var(--amber)' } }, iconEl(i.icon, 16)),
        el('span', { class: 'grow' }, el('small', { style: { color: 'var(--text)', 'font-size': '12px' } }, i.text)),
        iconEl('arrowR', 14)
      ]);
    }));
  }
  function db_hasSales() { return Store.db.sales.length > 0; }

  function lowStockTable(list) {
    if (!list.length) return emptyEl('Estoque em dia', 'Nenhum produto abaixo do mínimo.', 'check');
    return tabela(['Produto', 'Atual', 'Mínimo', { label: 'Sugestão', right: true }, 'Situação'],
      list.slice(0, 12).map(function (p) {
        var sug = Math.max(0, (p.min * 3) - p.stock);
        return el('tr', null, [
          el('td', null, [el('b', null, (p.emoji || '') + ' ' + p.name), el('br'), el('span', { class: 'tiny muted' }, p.code || '')]),
          el('td', null, el('span', { class: 'badge ' + (p.stock === 0 ? 'red' : 'amber') }, String(p.stock))),
          el('td', null, String(p.min)),
          el('td', { class: 'right num' }, [el('b', null, money(sug * p.cost)), el('br'), el('span', { class: 'tiny muted' }, sug + ' un')]),
          el('td', null, p.stock === 0 ? el('span', { class: 'badge red' }, 'ZERADO') : el('span', { class: 'badge amber' }, 'BAIXO'))
        ]);
      }));
  }

  function recentSalesTable(list) {
    if (!list.length) return emptyEl('Nenhuma venda ainda', 'Abra o caixa para começar a atender.', 'cart');
    return tabela(['Venda', 'Hora', 'Pagamento', { label: 'Total', right: true }, ''],
      list.map(function (s) {
        return el('tr', null, [
          el('td', null, ['#' + s.id, s.status === 'Estornada' ? el('span', { class: 'badge red' }, 'ESTORNADA') : null]),
          el('td', null, new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
          el('td', null, s.payments.map(function (p) { return p.method; }).join(', ')),
          el('td', { class: 'right num' }, el('b', null, money(s.total))),
          el('td', { class: 'right' }, el('button', { class: 'btn sm', 'data-print': s.id }, 'Imprimir'))
        ]);
      }));
  }

  function shiftPanel() {
    var s = Store.db.shift;
    if (!s) {
      return frag(
        el('div', { class: 'empty' }, [
          el('span', { class: 'ico' }, iconEl('lock', 30)),
          el('b', null, 'Caixa fechado'),
          'Abra o caixa para registrar vendas e controlar o gaveteiro.'
        ]),
        btn('Abrir caixa', 'wallet', 'btn primary block mt-1', function () { toggleShift(); })
      );
    }
    var todaySales = Store.db.sales.filter(function (x) { return x.shiftId === s.id && x.status !== 'Estornada'; });
    var cash = todaySales.reduce(function (a, x) {
      return a + x.payments.filter(function (p) { return p.method === 'Dinheiro'; }).reduce(function (b, p) { return b + p.amount; }, 0) - (x.change || 0);
    }, 0);
    return frag(
      stat('Operador', s.operator),
      stat('Aberto desde', UI.dt(s.openedAt)),
      stat('Fundo inicial', money(s.opening)),
      stat('Vendas no turno', todaySales.length + ' · ' + money(totalOf(todaySales))),
      stat('Dinheiro recebido', money(cash)),
      el('div', { class: 'stat-mini total' }, [el('span', null, 'Esperado no gaveteiro'), el('b', null, money(s.cashExpected))]),
      el('div', { class: 'row mt-2' }, btn('Conferir e fechar caixa', 'lock', 'btn block', function () { toggleShift(); }))
    );
  }

  /* ---------- VENDAS ---------- */
  Views.sales = function () {
    var db = Store.db;
    var f = Views.sales._f || (Views.sales._f = { q: '', from: '', to: '', method: 'all' });
    var list = db.sales.filter(function (s) {
      if (f.method !== 'all' && !s.payments.some(function (p) { return p.method === f.method; })) return false;
      if (f.from && new Date(s.date) < new Date(f.from)) return false;
      if (f.to) { var t = new Date(f.to); t.setHours(23, 59, 59); if (new Date(s.date) > t) return false; }
      if (f.q) {
        var q = f.q.toLowerCase();
        if (!(s.id + ' ' + s.operator + ' ' + (s.customerName || '') + ' ' +
          s.items.map(function (i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) > -1) return false;
      }
      return true;
    });
    var rev = totalOf(list), cost = costOf(list);

    var toolbar = el('div', { class: 'toolbar' }, [
      el('div', { class: 'search-wrap' }, [iconEl('search', 15),
        el('input', { class: 'field', id: 'saleQ', placeholder: 'Buscar por número, cliente, operador ou produto', value: f.q })]),
      el('input', { class: 'field', style: { width: 'auto' }, type: 'date', id: 'saleFrom', value: f.from, title: 'De' }),
      el('input', { class: 'field', style: { width: 'auto' }, type: 'date', id: 'saleTo', value: f.to, title: 'Até' }),
      el('select', { class: 'field', style: { width: 'auto' }, id: 'saleMethod' },
        [el('option', { value: 'all' }, 'Todas as formas')].concat(db.config.paymentMethods.map(function (m) {
          var o = el('option', { value: m }, m);
          if (f.method === m) o.setAttribute('selected', '');
          return o;
        }))),
      el('button', { class: 'btn', id: 'saleClear' }, [iconEl('x', 13), ' Limpar'])
    ]);

    return frag(
      pageHead('Vendas', 'Histórico completo, estornos e reimpressão de cupons.', [
        btn('Exportar CSV', 'down', 'btn', function () { exportSales(); }),
        btn('Nova venda', 'cart', 'btn primary', function () { go('pdv'); })
      ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Vendas no filtro', money(rev), list.length + ' operação(ões)', 'accent'),
        kpiEl('Custo dos itens', money(cost), 'base de custo atual'),
        kpiEl('Lucro estimado', money(UI.round2(rev - cost)), rev ? 'margem ' + UI.pct(rev ? (rev - cost) / rev * 100 : 0) : '—', 'teal'),
        kpiEl('Ticket médio', money(list.length ? rev / list.length : 0), 'por operação'),
        kpiEl('Estornadas', String(db.sales.filter(function (s) { return s.status === 'Estornada'; }).length), 'não entram na receita', 'red')
      ]),

      cardEl('Operações', frag(toolbar, salesTable(list)), '', 'receipt')
    );
  };

  function salesTable(list) {
    if (!list.length) return emptyEl('Nenhuma venda encontrada', 'Ajuste os filtros ou registre a primeira venda.', 'receipt');
    return tabela(
      ['Venda', 'Data', 'Operador', 'Cliente', 'Itens', 'Pagamento', { label: 'Total', right: true }, ''],
      list.map(function (s) {
        return el('tr', { class: 'clickable', 'data-sale': s.id }, [
          el('td', null, ['#' + s.id, s.status === 'Estornada' ? el('span', { class: 'badge red' }, 'ESTORNADA') : null]),
          el('td', { class: 'nowrap' }, UI.dt(s.date)),
          el('td', null, s.operator),
          el('td', null, s.customerName || el('span', { class: 'muted' }, '—')),
          el('td', { class: 'num' }, String(s.items.length)),
          el('td', null, s.payments.reduce(function (acc, p, i) {
            if (i) acc.push(' ');
            acc.push(el('span', { class: 'badge' }, p.method));
            return acc;
          }, [])),
          el('td', { class: 'right num' }, el('b', null, money(s.total))),
          el('td', { class: 'right nowrap' }, [
            el('button', { class: 'btn sm', 'data-print': s.id, title: 'Imprimir cupom' }, iconEl('print', 12)), ' ',
            s.status === 'Estornada' ? null : el('button', { class: 'btn sm danger', 'data-void': s.id, title: 'Estornar' }, iconEl('refresh', 12))
          ])
        ]);
      })
    );
  }

  function saleDetail(id) {
    var s = Store.db.sales.find(function (x) { return x.id === id; });
    if (!s) return;
    UI.modal({
      title: 'Venda #' + esc(s.id), icon: 'receipt', size: 'md',
      body:
        '<div class="grid kpis" style="margin-bottom:14px">' +
          kpi('Total', money(s.total), s.status, s.status === 'Estornada' ? 'red' : 'accent') +
          kpi('Itens', String(s.items.length), 'linhas da venda') +
          kpi('Lucro', money(UI.round2(s.total - s.items.reduce(function (a, i) { return a + (i.cost || 0) * i.qty; }, 0))), 'estimado', 'teal') +
        '</div>' +
        '<div class="stat-mini"><span>Data</span><b>' + UI.dt(s.date) + '</b></div>' +
        '<div class="stat-mini"><span>Operador</span><b>' + esc(s.operator) + '</b></div>' +
        (s.customerName ? '<div class="stat-mini"><span>Cliente</span><b>' + esc(s.customerName) + '</b></div>' : '') +
        (s.refundReason ? '<div class="stat-mini"><span>Motivo do estorno</span><b>' + esc(s.refundReason) + '</b></div>' : '') +
        '<div class="divider"></div><div class="pay-label">Itens</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="right">Qtd</th><th class="right">Unit.</th><th class="right">Total</th></tr></thead><tbody>' +
        s.items.map(function (i) {
          return '<tr><td>' + esc(i.emoji || '') + ' ' + esc(i.name) + '</td><td class="right num">' + i.qty + ' ' + esc(i.unit || 'un') +
            '</td><td class="right num">' + money(i.price) + '</td><td class="right num"><b>' + money(UI.round2(i.price * i.qty)) + '</b></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="divider"></div><div class="pay-label">Pagamento</div>' +
        s.payments.map(function (p) {
          return '<div class="stat-mini"><span>' + esc(p.method) + '</span><b>' + money(p.amount) + '</b></div>';
        }).join('') +
        '<div class="stat-mini"><span>Subtotal</span><b>' + money(s.subtotal) + '</b></div>' +
        (s.discount ? '<div class="stat-mini"><span>Desconto</span><b>− ' + money(s.discount) + '</b></div>' : '') +
        (s.change ? '<div class="stat-mini"><span>Troco</span><b>' + money(s.change) + '</b></div>' : '') +
        '<div class="stat-mini total"><span>Total pago</span><b>' + money(s.total) + '</b></div>',
      footLeft: '<button class="btn" data-print="' + esc(id) + '">' + icon('print', 14) + ' Imprimir</button>',
      confirmText: 'Fechar',
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          if (e.target.closest('[data-print]')) PDV.printReceipt(id);
        });
      }
    });
  }

  /* ---------- PRODUTOS ---------- */
  Views.products = function () {
    var db = Store.db;
    var f = Views.products._f || (Views.products._f = { q: '', cat: 'all', status: 'all' });
    var list = db.products.filter(function (p) {
      if (f.cat !== 'all' && p.category !== f.cat) return false;
      if (f.status === 'low' && !(p.stock <= p.min)) return false;
      if (f.status === 'out' && p.stock > 0) return false;
      if (f.status === 'exp' && !(p.expiry && UI.daysBetween(UI.today(), p.expiry) <= 30)) return false;
      if (f.status === 'off' && p.active) return false;
      if (f.q) {
        var q = f.q.toLowerCase();
        if ((p.name + ' ' + p.category + ' ' + (p.code || '') + ' ' + (p.barcode || '') + ' ' + (p.supplier || '') + ' ' + (p.stockArea || '') + ' ' + (p.depositAisle || '') + ' ' + (p.depositShelf || '') + ' ' + (p.depositHeight || '') + ' ' + (p.salesAisle || '') + ' ' + (p.salesShelf || '') + ' ' + (p.salesHeight || '')).toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var val = UI.round2(list.reduce(function (a, p) { return a + p.stock * p.cost; }, 0));

    var toolbar = el('div', { class: 'toolbar' }, [
      el('div', { class: 'search-wrap' }, [iconEl('search', 15),
        el('input', { class: 'field', id: 'prodQ', placeholder: 'Buscar por nome, código, categoria ou fornecedor', value: f.q })]),
      el('select', { class: 'field', style: { width: 'auto' }, id: 'prodCat' },
        [el('option', { value: 'all' }, 'Todas as categorias')].concat(db.categories.map(function (c) {
          var o = el('option', { value: c.id }, (c.emoji || '') + ' ' + c.name);
          if (f.cat === c.id) o.setAttribute('selected', '');
          return o;
        }))),
      el('select', { class: 'field', style: { width: 'auto' }, id: 'prodStatus' },
        [['all', 'Todos'], ['low', 'Estoque baixo'], ['out', 'Zerados'], ['exp', 'Vencendo/vencido'], ['off', 'Inativos']].map(function (o) {
          var op = el('option', { value: o[0] }, o[1]);
          if (f.status === o[0]) op.setAttribute('selected', '');
          return op;
        }))
    ]);

    return frag(
      pageHead('Produtos e estoque', 'Cadastro completo, custo, margem, validade e mínimos.', [
        btn('Fiscal NFC-e', 'file', 'btn', function () { fiscalReadiness(); }),
        btn('Etiquetas', 'tag', 'btn', function () { printLabels(); }),
        btn('Importar CSV', 'up', 'btn', function () { importProducts(); }),
        btn('Novo produto', 'plus', 'btn primary', function () { editProduct(); })
      ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Produtos cadastrados', String(db.products.length), db.products.filter(function (p) { return p.active; }).length + ' ativos', 'accent'),
        kpiEl('Valor em estoque', money(val), 'ao custo', 'blue'),
        kpiEl('Valor de venda', money(UI.round2(list.reduce(function (a, p) { return a + p.stock * p.price; }, 0))), 'potencial bruto', 'teal'),
        kpiEl('Margem média', UI.pct(db.products.length ? db.products.reduce(function (a, p) { return a + Store.marginOf(p); }, 0) / db.products.length : 0), 'sobre custo', 'amber'),
        kpiEl('Alertas', String(db.products.filter(function (p) { return p.active && p.stock <= p.min; }).length), 'estoque baixo', 'red')
      ]),

      cardEl('Catálogo', frag(toolbar, productTable(list)), '', 'box')
    );
  };

  function productTable(list) {
    if (!list.length) return emptyEl('Nenhum produto', 'Ajuste a busca ou cadastre um produto novo.', 'box');
    return tabela(
      ['Produto / EAN', 'Categoria', 'Validade', { label: 'Custo', right: true }, { label: 'Venda', right: true }, { label: 'Margem', right: true }, 'Estoque', 'Endereco', { label: 'Valor', right: true }, ''],
      list.map(function (p) {
        var cat = Store.categoryOf(p.category);
        var dExp = p.expiry ? UI.daysBetween(UI.today(), p.expiry) : null;
        var expBadge = !p.expiry ? el('span', { class: 'muted tiny' }, '—')
          : dExp < 0 ? el('span', { class: 'badge red' }, 'VENCIDO')
          : dExp <= 7 ? el('span', { class: 'badge red' }, dExp + 'd')
          : dExp <= 30 ? el('span', { class: 'badge amber' }, dExp + 'd')
          : el('span', { class: 'badge green' }, UI.dateOnly(p.expiry));
        var marg = Store.marginOf(p);
        return el('tr', { class: 'clickable', 'data-prod': p.id, style: p.active ? null : { opacity: '.5' } }, [
          el('td', null, [el('b', null, (p.emoji || '') + ' ' + p.name), el('br'), el('span', { class: 'tiny muted' }, p.barcode ? 'EAN ' + p.barcode : 'SKU ' + (p.code || ''))]),
          el('td', null, el('span', { class: 'badge', style: { 'border-color': cat.color + '55' } }, (cat.emoji || '') + ' ' + cat.name)),
          el('td', null, expBadge),
          el('td', { class: 'right num' }, money(p.cost)),
          el('td', { class: 'right num' }, (function () {
            if (!Store.promoVigente(p)) return el('b', null, money(p.price));
            return el('span', null, [
              el('b', { style: { color: 'var(--accent-3)' } }, money(p.promoPrice)),
              el('br'),
              el('span', { class: 'tiny muted', style: { 'text-decoration': 'line-through' } }, money(p.price))
            ]);
          })()),
          el('td', { class: 'right num' }, el('span', { class: 'badge ' + (marg >= 40 ? 'green' : marg >= 20 ? 'amber' : 'red') }, UI.pct(marg))),
          el('td', null, [el('span', { class: 'badge ' + (p.stock <= 0 ? 'red' : p.stock <= p.min ? 'amber' : 'green') }, String(p.stock)), ' ', el('span', { class: 'tiny muted' }, 'mín ' + p.min)]),
          el('td', null, [
            el('span', { class: 'badge amber' }, 'Deposito: ' + (p.stockDeposit == null ? (p.stockArea === 'venda' ? 0 : p.stock) : p.stockDeposit)),
            el('br'), el('span', { class: 'tiny muted' }, [(p.depositAisle || 'Rua N/D'), ' | ', (p.depositShelf || 'Prateleira N/D'), ' | ', (p.depositHeight || 'Nivel N/D')]),
            el('br'), el('span', { class: 'badge green' }, 'Area de venda: ' + (p.stockSales == null ? (p.stockArea === 'venda' ? p.stock : 0) : p.stockSales)),
            el('br'), el('span', { class: 'tiny muted' }, [(p.salesAisle || 'Rua N/D'), ' | ', (p.salesShelf || 'Prateleira N/D'), ' | ', (p.salesHeight || 'Nivel N/D')])
          ]),
          el('td', { class: 'right num' }, money(UI.round2(p.stock * p.cost))),
          el('td', { class: 'right nowrap' }, [
            el('button', { class: 'btn sm', 'data-edit': p.id }, iconEl('edit', 12)), ' ',
            el('button', { class: 'btn sm', 'data-stock': p.id, title: 'Movimentar estoque' }, iconEl('layers', 12))
          ])
        ]);
      })
    );
  }

  /* ---------- PRONTIDÃO FISCAL ----------
   * Lista, por produto ativo, o que falta para os campos mínimos de uma
   * futura NFC-e. Não emite nada: é um checklist do cadastro. Qual campo de
   * ICMS conta depende do regime (CRT) — CSOSN no Simples, CST no Normal. */
  function fiscalReadiness() {
    var db = Store.db;
    var regime = String(db.config.crt || '');
    var normal = regime === '3';
    var ativos = db.products.filter(function (p) { return p.active; });

    function faltas(p) {
      var f = [];
      if (!String(p.ncm || '').trim()) f.push('NCM');
      if (!String(p.cfop || '').trim()) f.push('CFOP');
      if (normal) { if (!String(p.cst || '').trim()) f.push('CST ICMS'); }
      else if (!String(p.csosn || '').trim()) f.push('CSOSN');
      if (!String(p.pisCst || '').trim()) f.push('CST PIS');
      if (!String(p.cofinsCst || '').trim()) f.push('CST COFINS');
      return f;
    }

    var pendentes = ativos.map(function (p) { return { p: p, f: faltas(p) }; })
      .filter(function (x) { return x.f.length; });
    var prontos = ativos.length - pendentes.length;

    var linhas = pendentes.map(function (x) {
      return el('div', { class: 'list-item' }, [
        el('span', { class: 'thumb-emoji' }, x.p.emoji || '📦'),
        el('span', { class: 'grow' }, [
          el('b', null, x.p.name),
          el('br'),
          el('span', { class: 'tiny muted' }, 'Falta: ' + x.f.join(', '))
        ]),
        el('button', { class: 'mini-btn', 'data-fix': x.p.id, title: 'Corrigir cadastro' }, iconEl('edit', 12))
      ]);
    });

    UI.modal({
      title: 'Prontidão fiscal (NFC-e)', icon: 'file', size: 'lg', footer: false,
      body: frag(
        el('div', { class: 'grid kpis', style: { 'margin-bottom': '12px' } }, [
          kpiEl('Produtos prontos', String(prontos), 'de ' + ativos.length + ' ativos', 'teal'),
          kpiEl('Pendentes', String(pendentes.length), 'faltando campo fiscal', pendentes.length ? 'amber' : 'teal'),
          kpiEl('ICMS do regime', normal ? 'CST' : 'CSOSN', regime ? 'CRT ' + regime : 'CRT não definido', 'accent')
        ]),
        el('div', { class: 'modal-note' }, 'Este painel confere só o cadastro. Emitir NFC-e exige também certificado ICP-Brasil (e-CNPJ A1), geração e assinatura do XML e comunicação com a SEFAZ.'),
        pendentes.length
          ? el('div', { class: 'list-plain' }, linhas)
          : emptyEl('Nada pendente', 'Todos os produtos ativos têm os campos fiscais mínimos.', 'file')
      ),
      onMount: function (root, close) {
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-fix]');
          if (!b) return;
          close();
          editProduct(b.dataset.fix);
        });
      }
    });
  }

  function editProduct(id) {
    var db = Store.db;
    var p = id ? db.products.find(function (x) { return x.id === id; }) : null;
    var v = p || { name: '', code: '', barcode: '', category: 'mercearia', cost: '', price: '', stock: 0, min: 3, unit: 'un', emoji: '📦', supplier: '', ncm: '', cfop: '5102', csosn: '102', expiry: '', lot: '', active: true, promoPrice: '', promoFrom: '', promoTo: '' };
    /* CSOSN e CST ICMS sao exclusivos por regime: Simples/MEI usa CSOSN,
       Regime Normal usa CST. Sem olhar o CRT o cadastro aceitava os dois
       preenchidos e gravava dado fiscal invalido. Regime indefinido cai no
       CSOSN (o caso mais comum em mercadinho). */
    var regime = String(db.config.crt || '');
    var normal = regime === '3';
    var simples = !normal;
    var notaRegime = regime === '3'
      ? 'Regime Normal (CRT 3): o ICMS usa CST. O CSOSN do Simples não se aplica.'
      : (regime === '1' || regime === '2' || regime === '4')
        ? 'Simples Nacional/MEI (CRT ' + regime + '): o ICMS usa CSOSN. O CST ICMS não se aplica.'
        : 'Regime (CRT) ainda não definido em Ajustes → Fiscal. Enquanto isso o ICMS usa CSOSN (Simples), o caso mais comum em mercadinho.';
    var blocoIcms = normal
      ? UI.field('CST ICMS (regime normal)', 'cst', v.cst || '', { placeholder: 'Ex.: 00, 20, 60' })
      : UI.field('CSOSN (Simples Nacional)', 'csosn', v.csosn, { type: 'select', options: [
          { value: '102', label: '102 — Tributada sem permissão de crédito' }, { value: '103', label: '103 — Isenta' },
          { value: '300', label: '300 — Imune' }, { value: '400', label: '400 — Não tributada' },
          { value: '500', label: '500 — ST cobrado anteriormente' }] });
    UI.modal({
      title: id ? 'Editar produto' : 'Novo produto', icon: 'box', size: 'lg',
      tabs: [
        { id: 'basico', label: 'Básico', icon: 'box' },
        { id: 'preco', label: 'Preço e margem', icon: 'tag' },
        { id: 'fiscal', label: 'Fiscal', icon: 'file' },
        { id: 'estoque', label: 'Estoque', icon: 'layers' }
      ],
      body:
        '<div class="mpane active" data-pane="basico"><div class="form-grid">' +
          UI.field('Nome do produto *', 'name', v.name, { full: true, placeholder: 'Ex.: Arroz Tipo 1 5kg' }) +
          UI.field('Código interno / SKU', 'code', v.code, { placeholder: 'AUTO' }) +
          UI.field('Código de barras (EAN)', 'barcode', v.barcode, { full: true, placeholder: 'digite ou use o leitor' }) +
          '<div class=\"full row\"><button type=\"button\" class=\"btn sm\" data-focusbarcode>Focar leitor</button><span class=\"tiny muted\">Clique aqui e passe o produto no leitor.</span></div>' +
          UI.field('Categoria', 'category', v.category, { type: 'select', options: db.categories.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; }) }) +
          UI.field('Emoji / imagem', 'emoji', v.emoji, { placeholder: '🍚' }) +
          UI.field('Fornecedor', 'supplier', v.supplier, { placeholder: 'Nome do fornecedor' }) +
          UI.field('Unidade de venda', 'unit', v.unit, { type: 'select', options: [
            { value: 'un', label: 'Unidade (un)' }, { value: 'kg', label: 'Quilo (kg)' },
            { value: 'g', label: 'Grama (g)' }, { value: 'L', label: 'Litro (L)' },
            { value: 'ml', label: 'Mililitro (ml)' }, { value: 'pct', label: 'Pacote (pct)' },
            { value: 'cx', label: 'Caixa (cx)' }] }) +
        '</div></div>' +

        '<div class="mpane" data-pane="preco"><div class="form-grid three">' +
          UI.field('Custo unitário (R$)', 'cost', v.cost, { type: 'money', step: '0.01', min: 0 }) +
          UI.field('Preço de venda (R$)', 'price', v.price, { type: 'money', step: '0.01', min: 0 }) +
          UI.field('Margem (%)', 'marginOut', UI.pct(Store.marginOf(v)), { hint: 'calculada' }) +
        '</div>' +
        '<div class="form-grid three mt-2">' +
          UI.field('Preço promocional (R$)', 'promoPrice', v.promoPrice, { type: 'money', step: '0.01', min: 0, hint: '0 = sem promoção' }) +
          UI.field('Promoção a partir de', 'promoFrom', v.promoFrom, { type: 'date' }) +
          UI.field('Promoção até', 'promoTo', v.promoTo, { type: 'date' }) +
        '</div>' +
        '<div class="modal-note">Preço promocional com data de início e fim. Sem datas, vale até ser removido; o caixa aplica o promocional automaticamente enquanto estiver vigente.</div>' +
        '<div class="modal-note" id="marginNote">A margem é calculada sobre o custo: <b>(venda − custo) ÷ custo</b>. O preço mínimo do configurador é apenas referência.</div></div>' +

        '<div class="mpane" data-pane="fiscal"><div class="form-grid">' +
          UI.field('NCM', 'ncm', v.ncm, { placeholder: '2202.10.00' }) +
          UI.field('CFOP', 'cfop', v.cfop, { type: 'select', hint: 'Padrão 5102 (venda interna). Depende da operação e do destino.', options: [
            { value: '5102', label: '5102 — Venda interna' }, { value: '6102', label: '6102 — Venda interestadual' },
            { value: '5405', label: '5405 — ST' }, { value: '2202', label: '2202 — Devolução' }] }) +
          blocoIcms +
          UI.field('CEST (opcional)', 'cest', v.cest || '', { placeholder: '28.0100' }) +
          UI.field('CST PIS', 'pisCst', v.pisCst || '', { placeholder: 'Simples tende a 49; Normal, conforme contador' }) +
          UI.field('CST COFINS', 'cofinsCst', v.cofinsCst || '', { placeholder: 'Simples tende a 49; Normal, conforme contador' }) +
          UI.field('Origem da mercadoria', 'origin', v.origin || '0', { type: 'select', options: [
            { value: '0', label: '0 - Nacional' }, { value: '1', label: '1 - Estrangeira (importacao direta)' },
            { value: '2', label: '2 - Estrangeira (adquirida no mercado interno)' }, { value: '3', label: '3 - Nacional com conteudo de importacao acima de 40%' },
            { value: '4', label: '4 - Nacional conforme processo produtivo basico' }, { value: '5', label: '5 - Nacional com conteudo de importacao ate 40%' },
            { value: '6', label: '6 - Estrangeira (importacao direta, sem similar nacional)' }, { value: '7', label: '7 - Estrangeira (mercado interno, sem similar nacional)' },
            { value: '8', label: '8 - Nacional com conteudo de importacao acima de 70%' }] }) +
        '</div>' +
        '<div class="modal-note">' + icon('info', 12) + ' ' + notaRegime + '</div>' +
        '<div class="modal-note warn">' + icon('alert', 12) + ' Este sistema <b>não emite NFC-e</b>. Ele prepara os campos fiscais e gera o comprovante de venda auxiliar. Para emitir nota fiscal é necessário um certificado digital ICP-Brasil (e-CNPJ A1), geração e assinatura do XML da NFC-e e comunicação com a SEFAZ — não basta preencher os dados abaixo.</div></div>' +

        '<div class="mpane" data-pane="estoque"><div class="form-grid three">' +
          UI.field('No deposito', 'stockDeposit', v.stockDeposit == null ? (v.stockArea === 'venda' ? 0 : v.stock) : v.stockDeposit, { type: 'number', step: '0.001', min: 0 }) +
          UI.field('Na area de venda', 'stockSales', v.stockSales == null ? (v.stockArea === 'venda' ? v.stock : 0) : v.stockSales, { type: 'number', step: '0.001', min: 0 }) +
          UI.field('Estoque mínimo', 'min', v.min, { type: 'number', step: '1' }) +
          UI.field('Validade', 'expiry', v.expiry, { type: 'date' }) +
          UI.field('Lote', 'lot', v.lot, { placeholder: 'L2026001' }) +
          UI.field('Rua do deposito', 'depositAisle', v.depositAisle || '', { placeholder: 'Ex.: Rua A' }) +
          UI.field('Prateleira do deposito', 'depositShelf', v.depositShelf || '', { placeholder: 'Ex.: Prateleira 3' }) +
          UI.field('Altura no deposito', 'depositHeight', v.depositHeight || '', { placeholder: 'Ex.: nivel 2' }) +
          UI.field('Rua da area de venda', 'salesAisle', v.salesAisle || '', { placeholder: 'Ex.: Corredor 2' }) +
          UI.field('Prateleira na area de venda', 'salesShelf', v.salesShelf || '', { placeholder: 'Ex.: Gondola 4' }) +
          UI.field('Altura na area de venda', 'salesHeight', v.salesHeight || '', { placeholder: 'Ex.: nivel 2' }) +
        '</div>' + UI.checkbox('Produto ativo (aparece no caixa)', 'active', v.active) + '</div>',
      confirmText: id ? 'Salvar alterações' : 'Cadastrar produto',
      onMount: function (root) {
        var cost = root.querySelector('[name=cost]'), price = root.querySelector('[name=price]'), out = root.querySelector('[name=marginOut]');
        var barcode = root.querySelector('[name=barcode]'), focusBarcode = root.querySelector('[data-focusbarcode]');
        if (focusBarcode && barcode) focusBarcode.addEventListener('click', function () { barcode.focus(); barcode.select(); });
        if (barcode) barcode.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); barcode.value = barcode.value.trim(); UI.toast('Codigo lido. Complete os dados e cadastre o produto.', 'ok'); }
        });
        var upd = function () {
          var c = UI.parseNum(cost.value), p = UI.parseNum(price.value);
          out.value = c > 0 ? UI.pct(((p - c) / c) * 100) : '—';
        };
        cost.addEventListener('input', upd); price.addEventListener('input', upd);
      },
      onConfirm: function (root) {
        var d = UI.formData(root);
        if (!d.name || !d.name.trim()) { UI.toast('Informe o nome do produto.', 'err'); return false; }
        if (!(Number(d.price) > 0)) { UI.toast('Informe o preço de venda.', 'err'); return false; }
        if (d.promoFrom && d.promoTo && d.promoFrom > d.promoTo) {
          UI.toast('A data final da promoção deve ser depois da inicial.', 'err'); return false;
        }
        var target = id ? db.products.find(function (x) { return x.id === id; }) : null;
        var dup = db.products.find(function (x) {
          return x.id !== id && d.barcode && x.barcode === String(d.barcode).trim();
        });
        if (dup) { UI.toast('Este código de barras já existe em "' + dup.name + '".', 'err'); return false; }

        var rec = {
          id: id || Store.uid('p'),
          name: d.name.trim(), code: String(d.code || '').trim(), barcode: String(d.barcode || '').trim(),
          category: d.category, emoji: d.emoji || '📦', supplier: d.supplier || '',
          unit: d.unit || 'un',
          cost: UI.round2(UI.parseNum(d.cost)), price: UI.round2(UI.parseNum(d.price)),
          promoPrice: UI.round2(UI.parseNum(d.promoPrice)), promoFrom: d.promoFrom || '', promoTo: d.promoTo || '',
          stockDeposit: Math.max(0, Number(d.stockDeposit) || 0), stockSales: Math.max(0, Number(d.stockSales) || 0),
          stock: Math.round(((Number(d.stockDeposit) || 0) + (Number(d.stockSales) || 0)) * 1000) / 1000, min: Number(d.min) || 0,
          stockArea: 'deposito',
          depositAisle: String(d.depositAisle || '').trim(), depositShelf: String(d.depositShelf || '').trim(), depositHeight: String(d.depositHeight || '').trim(),
          salesAisle: String(d.salesAisle || '').trim(), salesShelf: String(d.salesShelf || '').trim(), salesHeight: String(d.salesHeight || '').trim(),
          ncm: d.ncm || '', cfop: d.cfop || '5102', cest: d.cest || '', origin: d.origin || '0',
          /* So o campo do regime vigente e gravado; o outro fica vazio para
             nao virar XML invalido quando a emissao existir. */
          csosn: normal ? '' : (d.csosn || '102'),
          cst: normal ? (d.cst || '') : '',
          pisCst: d.pisCst || '', cofinsCst: d.cofinsCst || '',
          expiry: d.expiry || '', lot: d.lot || '', active: !!d.active,
          createdAt: target ? target.createdAt : new Date().toISOString()
        };
        if (!rec.code) rec.code = rec.barcode || rec.id;
        if (target) Object.assign(target, rec);
        else db.products.push(rec);
        Store.save();
        // O preco e o estoque sao decididos no servidor: se o cadastro nao
        // subir, os outros 4 caixas vendem pelo preco velho.
        Store.marcarCadastro('products', target || rec);
        rerender();
        UI.toast('Produto "' + rec.name + '" salvo.', 'ok');
      }
    });
  }

  function stockMove(id) {
    var db = Store.db;
    var p = db.products.find(function (x) { return x.id === id; });
    if (!p) return;
    if (p.stockDeposit == null) p.stockDeposit = p.stockArea === 'venda' ? 0 : p.stock;
    if (p.stockSales == null) p.stockSales = p.stockArea === 'venda' ? p.stock : 0;
    UI.modal({
      title: 'Estoque — ' + p.name, icon: 'layers', size: 'sm',
      body: '<div class="grid kpis mb-2">' +
          kpi('Total', String(p.stock), 'unidades', 'accent') +
          kpi('Depósito', String(p.stockDeposit), 'unidades', 'amber') +
          kpi('Área de venda', String(p.stockSales), 'unidades', 'green') +
        '</div>' +
        '<div class="form-grid">' +
          UI.field('Movimento', 'type', 'entrada', { type: 'select', options: [
            { value: 'entrada', label: 'Entrada de estoque' }, { value: 'saida', label: 'Saída / perda' },
            { value: 'transferencia', label: 'Transferir entre locais' }] }) +
          UI.field('Quantidade', 'qty', '', { type: 'number', step: '0.001', min: 0 }) +
          UI.field('Origem / destino', 'location', 'deposito', { type: 'select', options: [
            { value: 'deposito', label: 'Depósito' }, { value: 'venda', label: 'Área de venda' }] }) +
          UI.field('Motivo', 'reason', '', { full: true, placeholder: 'Ex.: reposição da prateleira' }) +
        '</div>' +
        '<div class="modal-note">Total depois do movimento: <b id="stockPreview">' + p.stock + '</b> ' + esc(p.unit) + '</div>',
      confirmText: 'Registrar',
      onMount: function (root) {
        var t = root.querySelector('[name=type]'), q = root.querySelector('[name=qty]'), loc = root.querySelector('[name=location]');
        var preview = root.querySelector('#stockPreview');
        var upd = function () {
          var n = Number(q.value) || 0;
          preview.textContent = UI.round2(t.value === 'transferencia' ? p.stock : p.stock + (t.value === 'entrada' ? n : -n));
        };
        t.addEventListener('change', upd); q.addEventListener('input', upd); loc.addEventListener('change', upd);
      },
      onConfirm: function (root) {
        var d = UI.formData(root), qty = Math.round((Number(d.qty) || 0) * 1000) / 1000;
        if (qty <= 0) { UI.toast('Informe uma quantidade válida.', 'err'); return false; }
        if (!d.reason || !d.reason.trim()) { UI.toast('Informe o motivo.', 'err'); return false; }
        var area = d.location === 'venda' ? 'stockSales' : 'stockDeposit';
        var origem = d.location === 'venda' ? 'stockSales' : 'stockDeposit';
        var destino = d.location === 'venda' ? 'stockDeposit' : 'stockSales';
        if (d.type === 'transferencia') {
          if (Number(p[origem]) < qty) { UI.toast('Quantidade insuficiente no local de origem.', 'err'); return false; }
          p[origem] = Math.round((Number(p[origem]) - qty) * 1000) / 1000;
          p[destino] = Math.round((Number(p[destino]) + qty) * 1000) / 1000;
        } else if (d.type === 'entrada') p[area] = Math.round((Number(p[area]) + qty) * 1000) / 1000;
        else {
          if (Number(p[area]) < qty) { UI.toast('Quantidade insuficiente neste local.', 'err'); return false; }
          p[area] = Math.round((Number(p[area]) - qty) * 1000) / 1000;
        }
        p.stock = Math.round((Number(p.stockDeposit) + Number(p.stockSales)) * 1000) / 1000;
        var delta = d.type === 'entrada' ? qty : (d.type === 'saida' ? -qty : 0);
        var movimento = { id: String(Store.nextId('entry')), date: new Date().toISOString(),
          type: delta > 0 ? 'Entrada' : (delta < 0 ? 'Saída' : 'Transferência'),
          category: d.type === 'transferencia' ? 'Transferência de estoque' : (delta > 0 ? 'Entrada de estoque' : 'Ajuste de estoque'),
          description: p.name + ' · ' + (d.type === 'transferencia' ? (d.location === 'venda' ? 'área de venda → depósito' : 'depósito → área de venda') : d.reason),
          amount: UI.round2(Math.abs(delta) * p.cost), method: 'Estoque', productId: p.id,
          quantity: qty, location: d.location, reason: d.reason.trim(), settled: true };
        db.entries.unshift(movimento);
        Store.save(); Store.marcarCadastro('products', p); Store.marcarCadastro('entries', movimento);
        rerender(); UI.toast('Estoque atualizado: depósito ' + p.stockDeposit + ' · área de venda ' + p.stockSales + '.', 'ok');
      }
    });
  }

  /* ---------- COMPRAS / FORNECEDORES ---------- */
  Views.purchases = function () {
    var db = Store.db;
    var f = Views.purchases._f || (Views.purchases._f = { tab: 'list' });
    var body;

    if (f.tab === 'list') {
      var list = db.purchases || [];
      body = cardEl('Compras registradas', list.length ? tabela(
        ['Compra', 'Data', 'Fornecedor', { label: 'Itens', right: true }, { label: 'Total', right: true }, 'Pagamento', ''],
        list.map(function (pc) {
          return el('tr', null, [
            el('td', null, el('b', null, '#' + pc.id)),
            el('td', { class: 'nowrap' }, UI.dt(pc.date)),
            el('td', null, pc.supplierName || '—'),
            el('td', { class: 'right num' }, String(pc.items.length)),
            el('td', { class: 'right num' }, el('b', null, money(pc.total))),
            el('td', null, el('span', { class: 'badge ' + (pc.paid ? 'green' : 'amber') }, pc.paid ? 'Pago' : 'A pagar')),
            el('td', { class: 'right' }, el('button', { class: 'btn sm', 'data-viewpc': pc.id }, 'Detalhes'))
          ]);
        })
      ) : emptyEl('Nenhuma compra registrada', 'Monte uma compra para dar entrada no estoque.', 'truck'),
        el('button', { class: 'btn primary sm', 'data-newpc': '' }, [iconEl('plus', 13), ' Nova compra']), 'truck');
    } else if (f.tab === 'suppliers') {
      var sup = db.suppliers || [];
      body = cardEl('Fornecedores', sup.length ? tabela(
        ['Fornecedor', 'Contato', 'Produtos', { label: 'Compras', right: true }, ''],
        sup.map(function (s) {
          var prods = db.products.filter(function (p) { return p.supplier === s.name; });
          var pc = db.purchases.filter(function (x) { return x.supplierId === s.id; });
          return el('tr', null, [
            el('td', null, [
              el('b', null, s.name),
              s.cnpj ? el('span', null, [el('br'), el('span', { class: 'tiny muted' }, s.cnpj)]) : null
            ]),
            el('td', null, s.phone || '—'),
            el('td', { class: 'num' }, String(prods.length)),
            el('td', { class: 'right num' }, money(UI.round2(pc.reduce(function (a, x) { return a + x.total; }, 0)))),
            el('td', { class: 'right nowrap' }, [
              el('button', { class: 'btn sm', 'data-newpc-supplier': s.id }, 'Nova compra'), ' ',
              el('button', { class: 'btn sm', 'data-editsup': s.id }, 'Editar')
            ])
          ]);
        })
      ) : emptyEl('Nenhum fornecedor', 'Cadastre os fornecedores para vincular aos produtos.', 'truck'),
        el('button', { class: 'btn primary sm', 'data-newsup': '' }, [iconEl('plus', 13), ' Novo fornecedor']), 'truck');
    } else {
      var sug = db.products.filter(function (p) { return p.active && p.stock <= p.min * 1.5; })
        .map(function (p) { return { p: p, sug: Math.max(1, (p.min * 3) - p.stock) }; })
        .sort(function (a, b) { return b.sug * b.p.cost - a.sug * a.p.cost; });
      var totalSug = UI.round2(sug.reduce(function (a, s) { return a + s.sug * s.p.cost; }, 0));
      body = cardEl('Lista de reposição sugerida', sug.length ? frag(
        tabela(
          ['Produto', 'Estoque', 'Mínimo', { label: 'Sugerir', right: true }, { label: 'Custo', right: true }, { label: 'Total', right: true }, ''],
          sug.map(function (s) {
            return el('tr', null, [
              el('td', null, [el('b', null, (s.p.emoji || '') + ' ' + s.p.name), el('br'), el('span', { class: 'tiny muted' }, s.p.supplier || 'sem fornecedor')]),
              el('td', null, el('span', { class: 'badge ' + (s.p.stock <= 0 ? 'red' : 'amber') }, String(s.p.stock))),
              el('td', null, String(s.p.min)),
              el('td', { class: 'right num' }, [el('b', null, String(s.sug)), ' ' + (s.p.unit || '')]),
              el('td', { class: 'right num' }, money(s.p.cost)),
              el('td', { class: 'right num' }, el('b', null, money(UI.round2(s.sug * s.p.cost)))),
              el('td', { class: 'right' }, el('label', { class: 'check' }, el('input', { type: 'checkbox', class: 'pc-pick', value: s.p.id, 'data-sug': String(s.sug), 'data-cost': s.p.cost })))
            ]);
          }),
          el('tfoot', null, el('tr', null, [
            el('td', { colspan: 5 }, 'Total sugerido'),
            el('td', { class: 'right num' }, money(totalSug)),
            el('td')
          ]))
        ),
        el('div', { class: 'row mt-2' }, [
          el('button', { class: 'btn primary', 'data-makeorder': '' }, [iconEl('cart', 14), ' Montar compra com selecionados']),
          el('button', { class: 'btn', 'data-selectall': '' }, 'Selecionar todos')
        ])
      ) : emptyEl('Estoque em dia', 'Nenhuma reposição sugerida no momento.', 'check'),
        '', 'truck');
    }

    return frag(
      pageHead('Compras e fornecedores', 'Entrada de estoque, custo de compra e lista de reposicao.', [
        btn('Nova compra', 'plus', 'btn primary', function () { newPurchase(); })
      ]),
      el('div', { class: 'subtabs' }, [
        el('button', { 'data-ptab': 'list', class: f.tab === 'list' ? 'active' : null }, [iconEl('receipt', 14), ' Compras']),
        el('button', { 'data-ptab': 'suppliers', class: f.tab === 'suppliers' ? 'active' : null }, [iconEl('truck', 14), ' Fornecedores']),
        el('button', { 'data-ptab': 'sugestao', class: f.tab === 'sugestao' ? 'active' : null }, [iconEl('target', 14), ' Lista de reposição'])
      ]),
      body
    );
  };

  function newPurchase(items, supplierId) {
    var db = Store.db;
    var pick = items ? items.slice() : [];

    function renderSelector() {
      var produtos = db.products.filter(function (p) { return p.active; });
      if (!produtos.length) return '<div class="modal-note warn">Cadastre um produto antes de registrar a compra. <button type="button" class="btn sm" data-pc-new-product>Cadastrar produto</button></div>';
      return '<div class="form-grid"><label class="full"><span class="lbl">Adicionar produto</span><select class="field" id="pcProduct">' +
        produtos.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' - estoque ' + esc(String(p.stock)) + '</option>'; }).join('') +
        '</select></label><label><span class="lbl">Quantidade</span><input class="field" id="pcQty" type="number" min="0.001" step="0.001" value="1"></label>' +
        '<div class="row" style="align-items:end"><button type="button" class="btn" data-pc-add>Adicionar produto</button></div></div>';
    }

    function renderList() {
      if (!pick.length) return '<div class="modal-note">Nenhum produto adicionado. Escolha os produtos acima para iniciar a compra.</div>';
      return '<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="right">Qtd</th><th class="right">Custo</th><th class="right">Total</th><th></th></tr></thead><tbody>' +
        pick.map(function (i, idx) {
          var p = db.products.find(function (x) { return x.id === i.id; });
          return '<tr><td><b>' + esc(p.emoji) + ' ' + esc(p.name) + '</b><br><span class="tiny muted">Estoque ' + p.stock + ' · venda ' + money(p.price) + '</span></td>' +
            '<td class="right"><input class="field" style="width:88px;text-align:right" type="number" min="0.001" step="0.001" data-pq="' + idx + '" value="' + i.qty + '"></td>' +
            '<td class="right"><input class="field" style="width:100px;text-align:right" type="number" min="0" step="0.01" data-pc="' + idx + '" value="' + (i.cost != null ? i.cost : p.cost) + '"></td>' +
            '<td class="right num"><b>' + money(UI.round2(i.qty * i.cost)) + '</b></td>' +
            '<td class="right"><button class="btn sm danger" data-pdel="' + idx + '">' + icon('x', 12) + '</button></td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="3">Total da compra</td><td class="right num" id="pcTotal">' + money(pickTotal()) + '</td><td></td></tr></tfoot></table></div>';
    }
    function pickTotal() {
      return UI.round2(pick.reduce(function (a, i) { return a + i.qty * (Number(i.cost) || 0); }, 0));
    }

    var m = UI.modal({
      title: 'Nova compra', icon: 'truck', size: 'lg',
      body: '<div class="form-grid mb-2">' +
          UI.field('Fornecedor', 'supplierId', supplierId || '', { type: 'select', options: [{ value: '', label: '— selecione —' }].concat((db.suppliers || []).map(function (s) { return { value: s.id, label: s.name }; })) }) +
          UI.field('Forma de pagamento', 'payMethod', 'Dinheiro', { type: 'select', options: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Boleto', 'A prazo'] }) +
          UI.field('Número da nota', 'invoiceNo', '', { placeholder: 'opcional' }) +
          UI.field('Vencimento do pagamento', 'due', '', { type: 'date', hint: 'deixe vazio se pago à vista' }) +
        '</div>' +
        renderSelector() +
        '<div id="pcItems" class="mt-2">' + renderList() + '</div>' +
        '<div class="modal-note">Ao confirmar, o estoque é atualizado e o custo de cada produto é substituído pelo preço de compra informado.</div>',
      confirmText: 'Registrar compra',
      onMount: function (root, close) {
        var box = root.querySelector('#pcItems');
        function refresh() { box.innerHTML = renderList(); }
        root.addEventListener('click', function (e) {
          if (e.target.closest('[data-pc-new-product]')) { close(); editProduct(); return; }
          if (e.target.closest('[data-pc-add]')) {
            var sel = root.querySelector('#pcProduct'), qty = Number(root.querySelector('#pcQty').value);
            var p = sel && db.products.find(function (x) { return x.id === sel.value; });
            if (!p || !(qty > 0)) { UI.toast('Escolha um produto e informe uma quantidade valida.', 'warn'); return; }
            var atual = pick.find(function (x) { return x.id === p.id; });
            if (atual) atual.qty += qty; else pick.push({ id: p.id, qty: qty, cost: Number(p.cost) || 0 });
            refresh();
          }
        });
        box.addEventListener('input', function (e) {
          var q = e.target.dataset.pq, c = e.target.dataset.pc;
          if (q != null) pick[Number(q)].qty = Number(e.target.value) || 0;
          if (c != null) pick[Number(c)].cost = UI.round2(UI.parseNum(e.target.value));
          root.querySelector('#pcTotal').textContent = money(pickTotal());
        });
        box.addEventListener('click', function (e) {
          var d = e.target.closest('[data-pdel]');
          if (d) { pick.splice(Number(d.dataset.pdel), 1); refresh(); }
        });
        root.addEventListener('click', function (e) {
          if (!e.target.closest('[data-confirm]')) return;
          var d = UI.formData(root);
          if (pickTotal() <= 0) { UI.toast('Informe quantidades e custos válidos.', 'err'); return false; }
          var sup = (db.suppliers || []).find(function (s) { return s.id === d.supplierId; });
          var paid = d.payMethod !== 'A prazo';
          var pc = {
            id: String(Store.nextId('entry')).slice(-4),
            date: new Date().toISOString(),
            supplierId: d.supplierId || null,
            supplierName: sup ? sup.name : '',
            invoiceNo: d.invoiceNo || '',
            items: pick.map(function (i) { return { id: i.id, qty: i.qty, cost: i.cost }; }),
            total: pickTotal(),
            payMethod: d.payMethod,
            due: d.due || null,
            paid: paid
          };
          db.purchases.unshift(pc);
          Store.marcarCadastro('purchases', pc);
          // entrada de estoque + custo
          pick.forEach(function (i) {
            var p = db.products.find(function (x) { return x.id === i.id; });
            if (!p) return;
            if (p.stockDeposit == null) p.stockDeposit = p.stock;
            p.stockDeposit = Math.round((p.stockDeposit + i.qty) * 1000) / 1000;
            p.stock = Math.round((p.stockDeposit + (Number(p.stockSales) || 0)) * 1000) / 1000;
            if (i.cost > 0) p.cost = i.cost;
            if (sup) p.supplier = sup.name;
            Store.marcarCadastro('products', p);
          });
          var lancamentoCompra = {
            id: String(Store.nextId('entry')), date: pc.date,
            type: paid ? 'Saída' : 'A pagar',
            category: 'Compra de mercadoria',
            description: 'Compra ' + (sup ? sup.name : '') + (d.invoiceNo ? ' · NF ' + d.invoiceNo : ''),
            amount: pc.total, method: d.payMethod, source: pc.id,
            due: d.due || null, settled: paid
          };
          db.entries.unshift(lancamentoCompra);
          Store.marcarCadastro('entries', lancamentoCompra);
          Store.save();
          rerender();
          UI.toast('Compra de ' + money(pc.total) + ' registrada. Estoque atualizado.', 'ok');
        });
      }
    });
    return m;
  }

  function editSupplier(id) {
    var db = Store.db;
    var s = id ? (db.suppliers || []).find(function (x) { return x.id === id; }) : null;
    var v = s || { name: '', cnpj: '', contact: '', phone: '', email: '', address: '' };
    UI.modal({
      title: id ? 'Editar fornecedor' : 'Novo fornecedor', icon: 'truck', size: 'md',
      body: '<div class="form-grid">' +
        UI.field('Razão social *', 'name', v.name, { full: true }) +
        UI.field('CNPJ', 'cnpj', v.cnpj, { placeholder: '00.000.000/0001-00' }) +
        UI.field('Contato', 'contact', v.contact) +
        UI.field('Telefone', 'phone', v.phone) +
        UI.field('E-mail', 'email', v.email, { type: 'email' }) +
        UI.field('Endereço', 'address', v.address, { full: true }) +
        '</div>',
      confirmText: id ? 'Salvar' : 'Cadastrar',
      onConfirm: function (root) {
        var d = UI.formData(root);
        if (!d.name || !d.name.trim()) { UI.toast('Informe a razão social.', 'err'); return false; }
        db.suppliers = db.suppliers || [];
        if (s) Object.assign(s, d);
        else db.suppliers.push(Object.assign({ id: Store.uid('sup') }, d));
        Store.save();
        Store.marcarCadastro('suppliers', s || db.suppliers[db.suppliers.length - 1]);
        rerender();
        UI.toast('Fornecedor salvo.', 'ok');
      }
    });
  }

  /* ---------- CLIENTES ---------- */
  Views.customers = function () {
    var db = Store.db;
    var f = Views.customers._f || (Views.customers._f = { q: '', only: 'all' });
    var list = db.customers.filter(function (c) {
      if (f.only === 'debt' && !(c.debt > 0)) return false;
      if (f.q && (c.name + ' ' + c.phone + ' ' + c.cpf).toLowerCase().indexOf(f.q.toLowerCase()) === -1) return false;
      return true;
    });
    var debt = UI.round2(db.customers.reduce(function (a, c) { return a + (Number(c.debt) || 0); }, 0));

    return frag(
      pageHead('Clientes e crediário', 'Cadastro, limites de fiado, recebimento e histórico.', [
        btn('Exportar', 'down', 'btn', function () { exportCustomers(); }),
        btn('Novo cliente', 'plus', 'btn primary', function () { editCustomer(); })
      ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Clientes', String(db.customers.length), db.customers.filter(function (c) { return c.debt > 0; }).length + ' com saldo', 'accent'),
        kpiEl('Total a receber', money(debt), 'fiado em aberto', 'purple'),
        kpiEl('Ticket médio', money(db.customers.length ? db.sales.filter(function (s) { return s.customerId; }).reduce(function (a, s) { return a + s.total; }, 0) / Math.max(1, db.customers.length) : 0), 'por cliente'),
        kpiEl('Limite concedido', money(UI.round2(db.customers.reduce(function (a, c) { return a + (Number(c.debtLimit) || 0); }, 0))), 'soma dos limites', 'blue')
      ]),

      cardEl('Cadastro', frag(
        el('div', { class: 'toolbar' }, [
          el('div', { class: 'search-wrap' }, [iconEl('search', 15),
            el('input', { class: 'field', id: 'custQ', placeholder: 'Buscar nome, telefone ou CPF', value: f.q })]),
          el('div', { class: 'btn-group' }, [
            el('button', { 'data-cf': 'all', class: f.only === 'all' ? 'active' : null }, 'Todos'),
            el('button', { 'data-cf': 'debt', class: f.only === 'debt' ? 'active' : null }, 'Com fiado')
          ])
        ]),
        customerTable(list)
      ), '', 'users')
    );
  };

  function customerTable(list) {
    if (!list.length) return emptyEl('Nenhum cliente', 'Cadastre clientes para vender no crediário e emitir recibos.', 'users');
    var fidelidade = Store.db.loyalty && Store.db.loyalty.enabled;
    return tabela(
      ['Cliente', 'Contato', 'CPF', 'Limite', 'Disponível', { label: 'Em aberto', right: true }, 'Fidelidade', ''],
      list.map(function (c) {
        var lim = Number(c.debtLimit) || 0;
        var deve = Number(c.debt) || 0;
        var disp = lim > 0 ? Math.max(0, lim - deve) : Infinity;
        return el('tr', { class: 'clickable', 'data-cust': c.id }, [
          el('td', null, [el('b', null, c.name), c.address ? frag(el('br'), el('span', { class: 'tiny muted' }, c.address)) : null]),
          el('td', null, c.phone || '—'),
          el('td', { class: 'tiny' }, c.cpf || el('span', { class: 'muted' }, 'sem CPF')),
          el('td', null, lim > 0 ? money(lim) : el('span', { class: 'muted tiny' }, 'sem limite')),
          el('td', null, lim > 0 ? el('span', { class: 'badge ' + (disp <= 0 ? 'red' : disp < lim * 0.2 ? 'amber' : 'green') }, money(disp)) : '—'),
          el('td', { class: 'right num' }, el('b', { style: { color: deve > 0 ? 'var(--amber)' : 'var(--text-3)' } }, money(deve))),
          el('td', null, fidelidade ? el('span', { class: 'badge purple' }, (c.points || 0) + ' pts') : '—'),
          el('td', { class: 'right nowrap' }, deve > 0
            ? [el('button', { class: 'btn sm primary', 'data-recv': c.id }, 'Receber'), ' ', el('button', { class: 'btn sm', 'data-cec': c.id }, 'Editar')]
            : el('button', { class: 'btn sm', 'data-cec': c.id }, 'Editar'))
        ]);
      })
    );
  }

  function editCustomer(id) {
    var db = Store.db;
    var c = id ? db.customers.find(function (x) { return x.id === id; }) : null;
    var v = c || { name: '', phone: '', cpf: '', address: '', debtLimit: 0, points: 0, notes: '' };
    UI.modal({
      title: id ? 'Editar cliente' : 'Novo cliente', icon: 'users', size: 'md',
      body: '<div class="form-grid">' +
        UI.field('Nome completo *', 'name', v.name, { full: true }) +
        UI.field('Telefone / WhatsApp', 'phone', v.phone) +
        UI.field('CPF', 'cpf', v.cpf, { placeholder: '000.000.000-00', hint: 'necessário para crediário' }) +
        UI.field('Endereço', 'address', v.address, { full: true }) +
        UI.field('Limite de crediário (R$)', 'debtLimit', v.debtLimit, { type: 'money', step: '0.01', min: 0, hint: '0 = sem limite' }) +
        UI.field('Pontos de fidelidade', 'points', v.points || 0, { type: 'number', min: 0, disabled: true }) +
        UI.field('Observações', 'notes', v.notes, { type: 'textarea', full: true }) +
        '</div>' +
        (c && c.debt > 0 ? '<div class="modal-note warn">Este cliente tem <b>' + money(c.debt) + '</b> em aberto. O saldo só muda por vendas a prazo ou recebimentos.</div>' : ''),
      confirmText: id ? 'Salvar' : 'Cadastrar',
      onConfirm: function (root) {
        var d = UI.formData(root);
        if (!d.name || !d.name.trim()) { UI.toast('Informe o nome do cliente.', 'err'); return false; }
        if (d.cpf && !/^\d{11}$/.test(String(d.cpf).replace(/\D/g, ''))) { UI.toast('CPF deve ter 11 dígitos.', 'err'); return false; }
        if (c) { Object.assign(c, d); c.debtLimit = UI.round2(UI.parseNum(d.debtLimit)); }
        else db.customers.push(Object.assign({ id: Store.uid('c'), debt: 0, points: 0, createdAt: new Date().toISOString() }, d, { debtLimit: UI.round2(UI.parseNum(d.debtLimit)) }));
        Store.save();
        // Cliente cadastrado no caixa 1 precisa existir no caixa 2: sem isso
        // a venda a prazo la cria um cliente fantasma, e a divida fica
        // dividida entre dois registros com o mesmo nome.
        Store.marcarCadastro('customers', c || db.customers[db.customers.length - 1]);
        rerender();
        UI.toast('Cliente salvo.', 'ok');
      }
    });
  }

  function receiveDebt(id) {
    var db = Store.db;
    var c = db.customers.find(function (x) { return x.id === id; });
    if (!c) return;
    UI.modal({
      title: 'Receber de ' + c.name, icon: 'money', size: 'sm',
      body: '<div class="grid kpis mb-2">' +
          kpi('Em aberto', money(c.debt), 'saldo atual', 'purple') +
          kpi('Limite', c.debtLimit > 0 ? money(c.debtLimit) : '—', c.debtLimit > 0 ? 'disponível: ' + money(Math.max(0, c.debtLimit - c.debt)) : 'sem limite') +
        '</div>' +
        '<div class="form-grid">' +
          UI.field('Valor recebido (R$)', 'amount', '', { type: 'money', step: '0.01', min: 0, placeholder: '0,00' }) +
          UI.field('Forma', 'method', 'Dinheiro', { type: 'select', options: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Transferência'] }) +
        '</div>' +
        '<div class="row mt-1"><button class="btn sm" data-full>Receber tudo (' + money(c.debt) + ')</button></div>' +
        '<div class="modal-note">O recebimento abate o fiado em aberto e entra como entrada no financeiro.</div>',
      confirmText: 'Confirmar recebimento',
      onMount: function (root) {
        root.querySelector('[data-full]').onclick = function () {
          root.querySelector('[name=amount]').value = String(c.debt).replace('.', ',');
        };
      },
      onConfirm: function (root) {
        var d = UI.formData(root);
        var amt = UI.round2(UI.parseNum(d.amount));
        if (amt <= 0) { UI.toast('Informe o valor recebido.', 'err'); return false; }
        if (amt > c.debt + 0.001) { UI.toast('O valor é maior que o saldo em aberto (' + money(c.debt) + ').', 'err'); return false; }
        c.debt = UI.round2(c.debt - amt);
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: new Date().toISOString(), type: 'Entrada',
          category: 'Recebimento de crediário', description: c.name, amount: amt,
          method: d.method, customerId: c.id, settled: true
        });
        // baixa dos lançamentos a receber abertos, FIFO
        var open = db.entries.filter(function (e) { return e.type === 'A receber' && !e.settled && e.customerId === c.id; })
          .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        var left = amt;
        open.forEach(function (e) {
          if (left <= 0) return;
          if (e.amount <= left) { e.settled = true; left = UI.round2(left - e.amount); }
          else { e.amount = UI.round2(e.amount - left); left = 0; }
        });
        // vendas a prazo também entram por customerId
        if (left > 0) {
          var open2 = db.entries.filter(function (e) { return e.type === 'A receber' && !e.settled && e.description.indexOf(c.name) > -1; });
          open2.forEach(function (e) {
            if (left <= 0) return;
            if (e.amount <= left) { e.settled = true; left = UI.round2(left - e.amount); }
            else { e.amount = UI.round2(e.amount - left); left = 0; }
          });
        }
        Store.save(); rerender();
        UI.toast('Recebidos ' + money(amt) + ' de ' + c.name + '. Saldo: ' + money(c.debt) + '.', 'ok');
      }
    });
  }

  function customerDetail(id) {
    var db = Store.db;
    var c = db.customers.find(function (x) { return x.id === id; });
    if (!c) return;
    var sales = db.sales.filter(function (s) { return s.customerId === id; });
    UI.modal({
      title: c.name, icon: 'users', size: 'md',
      body: '<div class="grid kpis mb-2">' +
          kpi('Em aberto', money(c.debt), c.debt > 0 ? 'fiado' : 'sem dívida', c.debt > 0 ? 'amber' : 'green') +
          kpi('Total comprado', money(totalOf(sales)), sales.length + ' compras', 'accent') +
          kpi('Fidelidade', String(c.points || 0), 'pontos', 'purple') +
        '</div>' +
        '<div class="stat-mini"><span>Telefone</span><b>' + esc(c.phone || '—') + '</b></div>' +
        '<div class="stat-mini"><span>CPF</span><b>' + esc(c.cpf || '—') + '</b></div>' +
        '<div class="stat-mini"><span>Endereço</span><b>' + esc(c.address || '—') + '</b></div>' +
        '<div class="stat-mini"><span>Limite</span><b>' + (c.debtLimit > 0 ? money(c.debtLimit) : 'sem limite') + '</b></div>' +
        (c.notes ? '<div class="stat-mini"><span>Obs.</span><b>' + esc(c.notes) + '</b></div>' : '') +
        '<div class="divider"></div><div class="pay-label">Compras</div>' +
        (sales.length ? '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Itens</th><th>Pagamento</th><th class="right">Total</th></tr></thead><tbody>' +
          sales.slice(0, 20).map(function (s) {
            return '<tr><td>' + UI.dt(s.date) + '</td><td class="num">' + s.items.length + '</td>' +
              '<td>' + esc(s.payments.map(function (p) { return p.method; }).join(', ')) + '</td>' +
              '<td class="right num"><b>' + money(s.total) + '</b></td></tr>';
          }).join('') + '</tbody></table></div>'
          : empty('Nenhuma compra registrada', '', 'receipt')),
      footLeft: c.debt > 0 ? '<button class="btn primary" data-recv2="' + esc(id) + '">' + icon('money', 14) + ' Receber</button>' : '',
      confirmText: 'Fechar',
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-recv2]');
          if (b) { root.closest('.overlay').querySelector('[data-close]').click(); receiveDebt(b.dataset.recv2); }
        });
      }
    });
  }

  /* ---------- FINANCEIRO ---------- */
  Views.finance = function () {
    var db = Store.db;
    var f = Views.finance._f || (Views.finance._f = { q: '', type: 'all', period: '30' });
    var days = Number(f.period) || 0;
    var from = days ? new Date(Date.now() - days * 86400000) : null;

    var all = db.entries.filter(function (e) {
      if (from && new Date(e.date) < from) return false;
      if (f.type !== 'all' && e.type !== f.type) return false;
      if (f.q && (e.description + ' ' + e.category).toLowerCase().indexOf(f.q.toLowerCase()) === -1) return false;
      return true;
    });

    var ins = UI.round2(all.filter(function (e) { return e.type === 'Entrada'; }).reduce(function (a, e) { return a + e.amount; }, 0));
    var outs = UI.round2(all.filter(function (e) { return e.type === 'Saída'; }).reduce(function (a, e) { return a + e.amount; }, 0));
    var recv = UI.round2(all.filter(function (e) { return e.type === 'A receber' && !e.settled; }).reduce(function (a, e) { return a + e.amount; }, 0));
    var pay = UI.round2(all.filter(function (e) { return e.type === 'A pagar' && !e.settled; }).reduce(function (a, e) { return a + e.amount; }, 0));

    var byCat = {};
    db.entries.filter(function (e) { return e.type === 'Saída' && (!from || new Date(e.date) >= from); })
      .forEach(function (e) { byCat[e.category] = UI.round2((byCat[e.category] || 0) + e.amount); });
    var catData = Object.keys(byCat).map(function (k) { return { l: k, v: byCat[k] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 8);

    var flow = lastDays(14).map(function (d) {
      var day = db.entries.filter(function (e) { return new Date(e.date).toDateString() === d.key; });
      return {
        l: d.label,
        v: UI.round2(day.filter(function (e) { return e.type === 'Entrada'; }).reduce(function (a, e) { return a + e.amount; }, 0) -
                     day.filter(function (e) { return e.type === 'Saída'; }).reduce(function (a, e) { return a + e.amount; }, 0))
      };
    });

    var toolbar = el('div', { class: 'toolbar' }, [
      el('div', { class: 'search-wrap' }, [iconEl('search', 15),
        el('input', { class: 'field', id: 'finQ', placeholder: 'Buscar descrição ou categoria', value: f.q })]),
      el('select', { class: 'field', style: { width: 'auto' }, id: 'finType' },
        [el('option', { value: 'all' }, 'Todos')].concat(['Entrada', 'Saída', 'A receber', 'A pagar'].map(function (t) {
          var o = el('option', { value: t }, t);
          if (f.type === t) o.setAttribute('selected', '');
          return o;
        }))),
      el('select', { class: 'field', style: { width: 'auto' }, id: 'finPeriod' },
        [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']].map(function (o) {
          var op = el('option', { value: o[0] }, o[1]);
          if (f.period === o[0]) op.setAttribute('selected', '');
          return op;
        })),
      el('button', { class: 'btn', id: 'finExport' }, [iconEl('down', 13), ' CSV'])
    ]);

    return frag(
      pageHead('Financeiro', 'Fluxo de caixa, despesas, recebimentos e crediário.', [
        btn('Despesa', 'down', 'btn', function () { newEntry('Saída'); }),
        btn('Recebimento', 'up', 'btn', function () { newEntry('Entrada'); }),
        btn('Contas a pagar', 'invoice', 'btn primary', function () { go('payables'); })
      ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Entradas', money(ins), 'no período', 'green'),
        kpiEl('Saídas', money(outs), 'no período', 'red'),
        kpiEl('Saldo', money(UI.round2(ins - outs)), ins - outs >= 0 ? 'positivo' : 'negativo', ins - outs >= 0 ? 'teal' : 'red'),
        kpiEl('A receber', money(recv), 'em aberto', 'purple'),
        kpiEl('A pagar', money(pay), 'em aberto', 'amber')
      ]),

      el('div', { class: 'grid two mb-2' }, [
        cardEl('Fluxo dos últimos 14 dias', UI.lineChartEl(flow, { height: 180 }), '', 'chart'),
        cardEl('Maiores despesas por categoria', catData.length ? UI.barChartEl(catData) : emptyEl('Sem despesas no período', '', 'wallet'), '', 'percent')
      ]),

      cardEl('Lançamentos', frag(toolbar, entryTable(all)), '', 'wallet')
    );
  };

  function entryTable(list) {
    if (!list.length) return emptyEl('Nenhum lançamento', 'As vendas e movimentações aparecem aqui.', 'wallet');
    return tabela(
      ['Data', 'Tipo', 'Categoria', 'Descrição', 'Forma', 'Vencimento', { label: 'Valor', right: true }, ''],
      list.slice(0, 300).map(function (e) {
        var overdue = (e.type === 'A pagar' || e.type === 'A receber') && !e.settled && e.due && UI.daysBetween(UI.today(), e.due) < 0;
        var tone = e.type === 'Entrada' ? 'green' : e.type === 'Saída' ? 'red' : e.type === 'A receber' ? 'purple' : 'amber';
        var cor = e.type === 'Saída' ? 'var(--red)' : e.type === 'Entrada' ? 'var(--accent-3)' : 'var(--text)';
        return el('tr', null, [
          el('td', { class: 'nowrap' }, UI.dt(e.date)),
          el('td', null, el('span', { class: 'badge ' + tone }, e.type)),
          el('td', null, e.category),
          el('td', null, [e.description, e.method === 'Estoque' ? frag(' ', el('span', { class: 'badge gray' }, 'estoque')) : null]),
          el('td', null, e.method || '—'),
          el('td', { class: 'tiny' }, e.due
            ? [overdue ? frag(el('span', { class: 'badge red' }, 'vencido'), ' ') : null, UI.dateOnly(e.due)]
            : '—'),
          el('td', { class: 'right num' }, el('b', { style: { color: cor } }, (e.type === 'Saída' ? '− ' : '+ ') + money(e.amount))),
          el('td', { class: 'right' }, ((e.type === 'A pagar' || e.type === 'A receber') && !e.settled)
            ? el('button', { class: 'btn sm', 'data-settle': e.id }, 'Baixar') : null)
        ]);
      })
    );
  }

  function newEntry(type) {
    var db = Store.db;
    var cats = type === 'Saída'
      ? ['Compra de mercadoria', 'Aluguel', 'Água', 'Luz', 'Internet', 'Salários', 'Transporte', 'Manutenção', 'Impostos', 'Marketing', 'Outras despesas']
      : ['Recebimento de crediário', 'Aluguel recebido', 'Empréstimo recebido', 'Venda avulsa', 'Outras receitas'];
    UI.modal({
      title: type === 'Saída' ? 'Nova despesa' : 'Novo recebimento', icon: type === 'Saída' ? 'down' : 'up', size: 'md',
      body: '<div class="form-grid">' +
        UI.field('Valor (R$) *', 'amount', '', { type: 'money', step: '0.01', min: 0 }) +
        UI.field('Categoria', 'category', cats[0], { type: 'select', options: cats }) +
        UI.field('Descrição', 'description', '', { full: true, placeholder: 'Ex.: conta de luz de setembro' }) +
        UI.field('Forma', 'method', 'Dinheiro', { type: 'select', options: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Boleto', 'Transferência'] }) +
        UI.field('Vencimento', 'due', '', { type: 'date' }) +
        UI.checkbox('Já foi pago / recebido', 'settled', true) +
        '</div>',
      confirmText: 'Lançar',
      onConfirm: function (root) {
        var d = UI.formData(root);
        var amt = UI.round2(UI.parseNum(d.amount));
        if (amt <= 0) { UI.toast('Informe um valor válido.', 'err'); return false; }
        if (!d.description || !d.description.trim()) { UI.toast('Informe a descrição.', 'err'); return false; }
        var t = d.settled ? type : (type === 'Saída' ? 'A pagar' : 'A receber');
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: new Date().toISOString(), type: t,
          category: d.category, description: d.description, amount: amt,
          method: d.method, due: d.due || null, settled: !!d.settled
        });
        if (d.settled && t === 'Saída' && db.shift && d.method === 'Dinheiro') {
          db.shift.cashExpected = UI.round2(db.shift.cashExpected - amt);
        }
        Store.save(); rerender();
        UI.toast((t === 'Saída' ? 'Despesa' : 'Recebimento') + ' de ' + money(amt) + ' lançado.', 'ok');
      }
    });
  }

  /* ---------- CONTAS A PAGAR / RECEBER ---------- */
  Views.payables = function () {
    var db = Store.db;
    var f = Views.payables._f || (Views.payables._f = { tab: 'pagar' });
    var isPay = f.tab === 'pagar';
    var list = db.entries.filter(function (e) {
      return !e.settled && (isPay ? e.type === 'A pagar' : e.type === 'A receber');
    }).sort(function (a, b) {
      var ad = a.due || '9999', bd = b.due || '9999';
      return String(ad).localeCompare(String(bd));
    });
    var total = UI.round2(list.reduce(function (a, e) { return a + e.amount; }, 0));
    var overdue = UI.round2(list.filter(function (e) { return e.due && UI.daysBetween(UI.today(), e.due) < 0; })
      .reduce(function (a, e) { return a + e.amount; }, 0));
    var soon = UI.round2(list.filter(function (e) {
      var d = e.due ? UI.daysBetween(UI.today(), e.due) : 999;
      return d >= 0 && d <= 7;
    }).reduce(function (a, e) { return a + e.amount; }, 0));

    return frag(
      pageHead('Contas a pagar e receber', 'Compromissos, vencimentos e baixa de títulos.', [
        btn(isPay ? 'Nova conta a pagar' : 'Novo recebimento', 'plus', 'btn', function () { newEntry(isPay ? 'Saída' : 'Entrada'); })
      ]),

      el('div', { class: 'grid kpis' }, [
        kpiEl(isPay ? 'Total a pagar' : 'Total a receber', money(total), list.length + ' título(s)', isPay ? 'amber' : 'purple'),
        kpiEl('Vencidos', money(overdue), 'atrasados', 'red'),
        kpiEl('Vencem em 7 dias', money(soon), 'atenção', 'amber'),
        kpiEl('Quitados', String(db.entries.filter(function (e) { return e.settled && (e.type === 'A pagar' || e.type === 'A receber'); }).length), 'histórico', 'green')
      ]),

      el('div', { class: 'subtabs' }, [
        el('button', { 'data-atab': 'pagar', class: isPay ? 'active' : null }, [iconEl('invoice', 14), ' A pagar']),
        el('button', { 'data-atab': 'receber', class: !isPay ? 'active' : null }, [iconEl('debt', 14), ' A receber'])
      ]),

      cardEl(isPay ? 'Contas a pagar' : 'Contas a receber', list.length ?
        tabela(
          ['Vencimento', 'Descrição', 'Categoria', 'Forma', 'Situação', { label: 'Valor', right: true }, ''],
          list.map(function (e) {
            var d = e.due ? UI.daysBetween(UI.today(), e.due) : null;
            var sit = d === null ? el('span', { class: 'badge gray' }, 'sem data')
              : d < 0 ? el('span', { class: 'badge red' }, 'vencido ' + Math.abs(d) + 'd')
              : d === 0 ? el('span', { class: 'badge amber' }, 'vence hoje')
              : d <= 7 ? el('span', { class: 'badge amber' }, 'faltam ' + d + 'd')
              : el('span', { class: 'badge green' }, 'faltam ' + d + 'd');
            return el('tr', null, [
              el('td', { class: 'nowrap' }, e.due ? UI.dateOnly(e.due) : '—'),
              el('td', null, el('b', null, e.description)),
              el('td', null, e.category),
              el('td', null, e.method || '—'),
              el('td', null, sit),
              el('td', { class: 'right num' }, el('b', null, money(e.amount))),
              el('td', { class: 'right' }, el('button', { class: 'btn sm primary', 'data-settle': e.id }, 'Quitar'))
            ]);
          }),
          el('tfoot', null, el('tr', null, [
            el('td', { colspan: 5 }, 'Total'),
            el('td', { class: 'right num' }, money(total)),
            el('td')
          ]))
        )
        : emptyEl(isPay ? 'Nenhuma conta a pagar' : 'Nenhum título a receber', isPay ? 'Registre compras e despesas pendentes.' : 'O crediário aparece aqui quando há venda a prazo.', isPay ? 'invoice' : 'debt'),
        '', isPay ? 'invoice' : 'debt')
    );
  };

  function settleEntry(id) {
    var db = Store.db;
    var e = db.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    UI.modal({
      title: 'Quitar título', icon: 'check', size: 'sm',
      body: '<div class="list-item mb-2"><span class="grow"><b>' + esc(e.description) + '</b><small>' + esc(e.type) + ' · ' + esc(e.category) + '</small></span>' +
        '<b class="num" style="font-size:15px">' + money(e.amount) + '</b></div>' +
        '<div class="form-grid">' +
          UI.field('Valor pago (R$)', 'amount', e.amount, { type: 'money', step: '0.01', min: 0 }) +
          UI.field('Forma', 'method', e.method || 'Dinheiro', { type: 'select', options: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Boleto', 'Transferência'] }) +
        '</div>' +
        (e.type === 'A pagar' ? '<div class="modal-note">Se for despesa já efetivada em dinheiro, o valor sai do gaveteiro do turno aberto.</div>' : ''),
      confirmText: 'Confirmar quitação',
      onConfirm: function (root) {
        var d = UI.formData(root);
        var amt = UI.round2(UI.parseNum(d.amount));
        if (amt <= 0) { UI.toast('Informe o valor.', 'err'); return false; }
        e.settled = true;
        e.settledAt = new Date().toISOString();
        e.settledAmount = amt;
        if (e.type === 'A pagar') {
          db.entries.unshift({
            id: String(Store.nextId('entry')), date: new Date().toISOString(), type: 'Saída',
            category: e.category, description: e.description + ' (quitação)',
            amount: amt, method: d.method, settled: true, source: e.id
          });
          if (db.shift && d.method === 'Dinheiro') db.shift.cashExpected = UI.round2(db.shift.cashExpected - amt);
        }
        Store.save(); rerender();
        UI.toast('Título quitado: ' + money(amt) + '.', 'ok');
      }
    });
  }

  /* ---------- RELATÓRIOS ---------- */
  Views.reports = function () {
    var db = Store.db;
    var f = Views.reports._f || (Views.reports._f = { period: '30' });
    var days = Number(f.period) || 0;
    var from = days ? new Date(Date.now() - days * 86400000) : null;
    var sales = db.sales.filter(function (s) { return s.status !== 'Estornada' && (!from || new Date(s.date) >= from); });
    var rev = totalOf(sales), cost = costOf(sales);

    // produtos
    var byProd = {};
    sales.forEach(function (s) {
      s.items.forEach(function (i) {
        if (!byProd[i.id]) byProd[i.id] = { name: i.name, emoji: i.emoji, qty: 0, revenue: 0, profit: 0 };
        byProd[i.id].qty += i.qty;
        byProd[i.id].revenue = UI.round2(byProd[i.id].revenue + i.price * i.qty);
        byProd[i.id].profit = UI.round2(byProd[i.id].profit + ((i.price - (i.cost || 0)) * i.qty));
      });
    });
    var topQty = Object.keys(byProd).map(function (k) { return byProd[k]; })
      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 10);
    var topProfit = Object.keys(byProd).map(function (k) { return byProd[k]; })
      .sort(function (a, b) { return b.profit - a.profit; }).slice(0, 10);

    // categoria
    var byCat = {};
    sales.forEach(function (s) {
      s.items.forEach(function (i) {
        var p = db.products.find(function (x) { return x.id === i.id; });
        var c = p ? p.category : 'outros';
        byCat[c] = UI.round2((byCat[c] || 0) + i.price * i.qty);
      });
    });
    var catData = Object.keys(byCat).map(function (k) {
      var c = Store.categoryOf(k);
      return { l: c.emoji + ' ' + c.name, v: byCat[k], c: c.color };
    }).sort(function (a, b) { return b.v - a.v; });

    // curva ABC
    var abc = Object.keys(byProd).map(function (k) { return byProd[k]; })
      .sort(function (a, b) { return b.revenue - a.revenue; });
    var cum = 0, totalRev = rev || 1;
    var abcRows = abc.map(function (a, i) {
      cum += a.revenue;
      var c = cum / totalRev;
      return { name: a.name, qty: a.qty, revenue: a.revenue, share: (a.revenue / totalRev) * 100, cum: c * 100, cls: c <= 0.8 ? 'A' : c <= 0.95 ? 'B' : 'C' };
    });

    // operador
    var byOp = {};
    sales.forEach(function (s) { byOp[s.operator] = UI.round2((byOp[s.operator] || 0) + s.total); });

    // hora
    var byHour = {};
    for (var h = 6; h <= 23; h++) byHour[h] = 0;
    sales.forEach(function (s) { var h = new Date(s.date).getHours(); byHour[h] = UI.round2((byHour[h] || 0) + s.total); });
    var hourData = Object.keys(byHour).map(function (h) {
      return { l: String(h).padStart(2, '0') + 'h', v: byHour[h] };
    }).filter(function (d) { return d.v > 0; });

    // DRE simplificado
    var ins = UI.round2(db.entries.filter(function (e) { return e.type === 'Entrada' && (!from || new Date(e.date) >= from); }).reduce(function (a, e) { return a + e.amount; }, 0));
    var outs = UI.round2(db.entries.filter(function (e) { return e.type === 'Saída' && (!from || new Date(e.date) >= from); }).reduce(function (a, e) { return a + e.amount; }, 0));
    var taxes = UI.round2(outs * 0.06);

    return frag(
      pageHead('Relatórios', 'Indicadores calculados a partir das vendas, estoque e lançamentos reais.', [
        btn('Imprimir DRE', 'print', 'btn', function () { printDRE(); }),
        btn('Backup', 'save', 'btn primary', function () { UI.downloadBackup(); })
      ]),

      el('div', { class: 'toolbar' }, el('div', { class: 'btn-group' },
        [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']].map(function (o) {
          return el('button', { 'data-rp': o[0], class: f.period === o[0] ? 'active' : null }, o[1]);
        }))),

      el('div', { class: 'grid kpis' }, [
        kpiEl('Receita', money(rev), sales.length + ' vendas', 'accent'),
        kpiEl('Custo dos produtos', money(cost), 'CMV', 'red'),
        kpiEl('Lucro bruto', money(UI.round2(rev - cost)), rev ? 'margem ' + UI.pct(rev ? (rev - cost) / rev * 100 : 0) : '—', 'teal'),
        kpiEl('Ticket médio', money(sales.length ? rev / sales.length : 0), 'por venda'),
        kpiEl('Itens vendidos', String(UI.round2(sales.reduce(function (a, s) { return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0))), 'unidades', 'blue')
      ]),

      el('div', { class: 'grid two mb-2' }, [
        cardEl('Receita por dia', dailySeries(days || 30), '', 'chart'),
        cardEl('Vendas por categoria', catData.length ? UI.donutChartEl(catData) : emptyEl('Sem vendas no período', '', 'chart'), '', 'percent')
      ]),

      el('div', { class: 'grid two mb-2' }, [
        cardEl('Mais vendidos (unidades)', topQty.length ? UI.barChartEl(topQty.map(function (p) { return { l: (p.emoji || '') + ' ' + p.name, v: p.qty }; }), { fmt: 'count' }) : emptyEl('—', '', 'box'), '', 'box'),
        cardEl('Mais lucrativos', topProfit.length ? UI.barChartEl(topProfit.map(function (p) { return { l: (p.emoji || '') + ' ' + p.name, v: p.profit }; })) : emptyEl('—', '', 'percent'), '', 'percent')
      ]),

      el('div', { class: 'grid two mb-2' }, [
        cardEl('Horários de maior movimento', hourData.length ? UI.barChartEl(hourData) : emptyEl('—', '', 'clock'), '', 'clock'),
        cardEl('Desempenho por operador', Object.keys(byOp).length ? UI.barChartEl(Object.keys(byOp).map(function (k) { return { l: k, v: byOp[k] }; })) : emptyEl('—', '', 'user'), '', 'user')
      ]),

      el('div', { class: 'grid two mb-2' }, [
        cardEl('Curva ABC (giro)', abcRows.length ? frag(
          el('div', { class: 'modal-note', style: { margin: '0 0 11px' } }, [
            'Classe ', el('b', null, 'A'), ': até 80% do faturamento · ',
            el('b', null, 'B'), ': até 95% · ', el('b', null, 'C'),
            ': cauda longa. Monitore o estoque das classes A com mais cuidado.'
          ]),
          tabela(
            ['Produto', { label: 'Un.', right: true }, { label: 'Receita', right: true }, { label: 'Part.', right: true }, { label: 'Acum.', right: true }, 'Classe'],
            abcRows.slice(0, 14).map(function (r) {
              return el('tr', null, [
                el('td', null, el('b', null, r.name)),
                el('td', { class: 'right num' }, String(r.qty)),
                el('td', { class: 'right num' }, money(r.revenue)),
                el('td', { class: 'right num' }, UI.pct(r.share)),
                el('td', { class: 'right num' }, UI.pct(r.cum)),
                el('td', null, el('span', { class: 'badge ' + (r.cls === 'A' ? 'green' : r.cls === 'B' ? 'amber' : 'gray') }, r.cls))
              ]);
            })
          )
        ) : emptyEl('—', '', 'target'), '', 'target'),
        cardEl('DRE simplificada do período', frag(
          [
            ['Receita bruta de vendas', money(rev), null, false],
            ['(−) Custo dos produtos (CMV)', money(cost), 'var(--red)', false],
            ['= Lucro bruto', money(UI.round2(rev - cost)), 'var(--accent-3)', true],
            ['(−) Despesas operacional', money(outs), 'var(--red)', false],
            ['(−) Estimativa de impostos (6%)', money(taxes), 'var(--red)', false],
            ['= Resultado estimado', money(UI.round2(rev - cost - outs - taxes)), rev - cost - outs - taxes >= 0 ? 'var(--accent-3)' : 'var(--red)', true]
          ].map(function (r) {
            return el('div', { class: 'stat-mini' + (r[3] ? ' total' : '') }, [
              el('span', null, r[0]),
              el('b', r[2] ? { style: { color: r[2] } } : null, r[1])
            ]);
          }),
          el('div', { class: 'modal-note warn', style: { 'margin-top': '11px' } }, [
            iconEl('info', 12),
            ' Impostos aqui são uma ', el('b', null, 'estimativa fixa de 6%'),
            '. O Simples Nacional varia de 4% a 13% conforme a faixa de faturamento. Consulte o contador.'
          ])
        ), '', 'invoice')
      ]),

      cardEl('Valor de estoque por categoria', catData.length ? UI.barChartEl(db.categories.map(function (c) {
        var v = UI.round2(db.products.filter(function (p) { return p.category === c.id; }).reduce(function (a, p) { return a + p.stock * p.cost; }, 0));
        return { l: c.emoji + ' ' + c.name, v: v, c: c.color };
      }).filter(function (x) { return x.v > 0; })) : emptyEl('—', '', 'box'), '', 'layers')
    );
  };

  function dailySeries(days) {
    var n = Math.min(days || 30, 90);
    return UI.lineChartEl(lastDays(n).map(function (d) { return { l: d.label, v: totalOf(salesOfDay(d.key)) }; }));
  }

  function printDRE() {
    var db = Store.db;
    var sales = db.sales.filter(function (s) { return s.status !== 'Estornada'; });
    var rev = totalOf(sales), cost = costOf(sales);
    var outs = UI.round2(db.entries.filter(function (e) { return e.type === 'Saída'; }).reduce(function (a, e) { return a + e.amount; }, 0));
    var ins = UI.round2(db.entries.filter(function (e) { return e.type === 'Entrada'; }).reduce(function (a, e) { return a + e.amount; }, 0));
    var html = '<div class="c b">' + esc(db.config.storeName) + '</div>' +
      '<div class="c">DRE SIMPLIFICADA · CNPJ ' + esc(db.config.cnpj) + '</div>' +
      '<div class="c">Período: até ' + UI.dateOnly(new Date()) + '</div><div class="sep"></div>' +
      '<div class="r"><span>Receita de vendas</span><span>' + UI.num(rev) + '</span></div>' +
      '<div class="r"><span>(-) CMV</span><span>' + UI.num(cost) + '</span></div>' +
      '<div class="r b"><span>= Lucro bruto</span><span>' + UI.num(rev - cost) + '</span></div>' +
      '<div class="r"><span>Outras entradas</span><span>' + UI.num(ins - rev) + '</span></div>' +
      '<div class="r"><span>(-) Despesas</span><span>' + UI.num(outs) + '</span></div>' +
      '<div class="r b"><span>= Resultado</span><span>' + UI.num(rev - cost - outs) + '</span></div>' +
      '<div class="sep"></div><div class="c" style="font-size:9px">Documento gerado pelo Sudam Gestão. Impostos não calculados automaticamente.</div>';
    UI.printHTML(html, 80);
  }

  /* ---------- CONFIGURAÇÕES ---------- */
  Views.settings = function () {
    var db = Store.db;
    var u = Store.currentUser();
    var cfg = db.config;
    return frag(
      pageHead('Configurações', 'Loja, operação, fiscal, tema, usuários e dados.'),
      el('div', { class: 'grid two' }, [
        el('div', { class: 'grid', style: { gap: '13px', 'align-content': 'start' } }, [
          cardEl('Identificação da loja', cfgForm('loja'), '', 'store'),
          cardEl('Caixa e operação', cfgForm('operacao'), '', 'wallet'),
          cardEl('Fiscal e NFC-e', cfgForm('fiscal'), '', 'file'),
          cardEl('Impressão e tema', cfgForm('tema'), '', 'print')
        ]),
        el('div', { class: 'grid', style: { gap: '13px', 'align-content': 'start' } }, [
          cardEl('Preços e promoções', priceTools(), '', 'tag'),
          cardEl('Formas de pagamento', paymentConfig(), '', 'card'),
          cardEl('Categorias de produto', categoryConfig(), '', 'tag'),
          (u && u.role === 'admin' ? cardEl('Usuarios e acessos', usersBlock(), '', 'users') : null),
          cardEl('Dados e segurança', dataBlock(), '', 'save')
        ])
      ])
    );
  };

  function cfgForm(which) {
    var cfg = Store.db.config;
    if (which === 'loja') {
      return frag(
        el('div', { class: 'form-grid' }, [
          UI.fieldEl('Nome da loja', 'storeName', cfg.storeName, { full: true }),
          UI.fieldEl('CNPJ', 'cnpj', cfg.cnpj),
          UI.fieldEl('Inscrição estadual', 'ie', cfg.ie),
          UI.fieldEl('Endereço', 'address', cfg.address, { full: true }),
          UI.fieldEl('Telefone', 'phone', cfg.phone),
          UI.fieldEl('Regime tributário', 'taxRegime', cfg.taxRegime, { type: 'select', options: ['Simples Nacional', 'Simples Nacional - excesso de sublimite', 'Regime Normal (Lucro Real/Presumido)'] })
        ]),
        el('button', { class: 'btn primary mt-2', 'data-save': 'loja' }, [iconEl('save', 14), ' Salvar loja'])
      );
    }
    if (which === 'operacao') {
      return frag(
        el('div', { class: 'form-grid' }, [
          UI.fieldEl('Operador padrão', 'operator', cfg.operator),
          UI.fieldEl('Desconto máximo por venda (R$)', 'maxDiscount', cfg.maxDiscount, { type: 'money', step: '0.01', min: 0 }),
          UI.fieldEl('Fundo de caixa sugerido (R$)', 'cashOpening', cfg.cashOpening, { type: 'money', step: '0.01', min: 0 })
        ]),
        el('div', { class: 'mt-1' }, [
          UI.checkboxEl('Permitir venda com estoque negativo', 'allowNegativeStock', cfg.allowNegativeStock, 'Evita bloquear a venda quando o caixa está atrasado na contagem.'),
          UI.checkboxEl('Exigir CPF do cliente para crediário', 'requireCustomerOnCredit', cfg.requireCustomerOnCredit)
        ]),
        el('button', { class: 'btn primary mt-2', 'data-save': 'operacao' }, [iconEl('save', 14), ' Salvar operação'])
      );
    }
    if (which === 'fiscal') {
      return frag(
        el('div', { class: 'form-grid' }, [
          UI.fieldEl('Chave Pix (CPF/CNPJ, e-mail, telefone ou aleatória)', 'pixKey', cfg.pix.pixKey, { full: true, placeholder: 'ex.: 11999998888 ou loja@email.com' }),
          UI.fieldEl('Cidade do recebedor Pix', 'pixCity', cfg.pix.city, { placeholder: 'SAO PAULO' }),
          UI.fieldEl('Inscricao municipal', 'municipalRegistration', cfg.municipalRegistration || ''),
          UI.fieldEl('CRT (codigo do regime)', 'crt', cfg.crt || '', { type: 'select', options: [
            { value: '', label: 'Selecionar com o contador' }, { value: '1', label: '1 - Simples Nacional' },
            { value: '2', label: '2 - Simples Nacional - excesso de sublimite' }, { value: '3', label: '3 - Regime normal' },
            { value: '4', label: '4 - MEI' }] }),
          UI.fieldEl('CNAE principal', 'cnae', cfg.cnae || '', { placeholder: 'Informado pelo contador' }),
          UI.fieldEl('Codigo IBGE do municipio', 'municipalityCode', cfg.municipalityCode || ''),
          UI.fieldEl('CEP fiscal', 'zipCode', cfg.zipCode || '', { placeholder: '00000-000' }),
          UI.fieldEl('UF', 'state', cfg.state || '', { placeholder: 'UF' }),
          UI.fieldEl('Municipio', 'city', cfg.city || '', { full: true }),
          UI.fieldEl('Bairro', 'district', cfg.district || ''),
          UI.fieldEl('Numero', 'addressNumber', cfg.addressNumber || ''),
          UI.fieldEl('Complemento', 'addressComplement', cfg.addressComplement || ''),
          UI.fieldEl('Telefone fiscal', 'fiscalPhone', cfg.fiscalPhone || ''),
          UI.fieldEl('E-mail fiscal', 'fiscalEmail', cfg.fiscalEmail || '', { full: true })
        ]),
        el('div', { class: 'modal-note warn mt-1' }, [
          iconEl('alert', 12), ' ', el('b', null, 'Este sistema não emite NFC-e.'),
          ' Sem servidor, certificado digital e comunicação com a SEFAZ não é possível emitir nota fiscal válida. O que o PDV faz: prepara NCM/CFOP/CSOSN no cadastro, gera QR Pix de cobrança e imprime o comprovante auxiliar de venda (CANFE).'
        ]),
        el('div', { class: 'modal-note mt-1' }, 'Os dados preenchidos ficam salvos para uma futura integracao fiscal. O PDV ainda nao transmite documentos para a SEFAZ.'),
        el('button', { class: 'btn primary mt-2', 'data-save': 'fiscal' }, [iconEl('save', 14), ' Salvar fiscal'])
      );
    }
    return frag(
      el('div', { class: 'form-grid' }, [
        UI.fieldEl('Mensagem no cupom', 'receiptFooter', cfg.receiptFooter, { full: true }),
        UI.fieldEl('Largura do cupom', 'printWidth', cfg.printWidth, { type: 'select', options: [{ value: 80, label: '80 mm (padrão)' }, { value: 58, label: '58 mm (bobina pequena)' }] }),
        UI.fieldEl('Tema da interface', 'theme', cfg.theme, { type: 'select', options: [{ value: 'dark', label: 'Escuro (padrão)' }, { value: 'light', label: 'Claro' }] })
      ]),
      el('div', { class: 'modal-note mt-1' }, ['Atalho: ', el('span', { class: 'kbd' }, 'Ctrl'), ' + ', el('span', { class: 'kbd' }, 'Shift'), ' + ', el('span', { class: 'kbd' }, 'D'), ' alterna o tema a qualquer momento.']),
      el('button', { class: 'btn primary mt-2', 'data-save': 'tema' }, [iconEl('save', 14), ' Salvar aparência'])
    );
  }

  function paymentConfig() {
    var cfg = Store.db.config;
    var all = ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Crediário', 'Vale', 'Boleto'];
    return frag(
      el('div', { class: 'row tight mb-2' }, all.map(function (m) {
        var on = cfg.paymentMethods.indexOf(m) > -1;
        return el('button', { class: 'btn sm ' + (on ? 'primary' : 'ghost'), 'data-pay': m }, on ? [iconEl('check', 12), ' ' + m] : '+ ' + m);
      })),
      el('div', { class: 'modal-note' }, 'As formas marcadas aparecem no painel de pagamento da frente de caixa, na ordem em que foram ativadas.')
    );
  }

  function categoryConfig() {
    var db = Store.db;
    return frag(
      el('div', { class: 'list-plain' }, db.categories.map(function (c) {
        var n = db.products.filter(function (p) { return p.category === c.id; }).length;
        var del = el('button', { class: 'mini-btn danger', 'data-delcat': c.id }, iconEl('trash', 13));
        if (n) { del.disabled = true; del.title = 'Há produtos nesta categoria'; }
        return el('div', { class: 'list-item' }, [
          el('span', { class: 'thumb-emoji', style: { background: c.color + '22' } }, c.emoji),
          el('span', { class: 'grow' }, [el('b', null, c.name), el('small', null, n + ' produto(s)')]),
          del
        ]);
      })),
      el('button', { class: 'btn block mt-2', 'data-newcat': '' }, [iconEl('plus', 14), ' Nova categoria'])
    );
  }

  /* ---------- PREÇOS E PROMOÇÕES ---------- */
  function priceTools() {
    var db = Store.db;
    var ativos = db.products.filter(function (p) { return p.active; }).length;
    return frag(
      el('p', { class: 'tiny muted', style: { margin: '0 0 10px' } }, [
        'Ajuste o preço de venda em massa. Escolha ', el('b', null, 'aumentar'),
        ' ou ', el('b', null, 'reduzir'), ' (promoção), em ', el('b', null, '%'),
        ' ou em ', el('b', null, 'R$'), ', e aplique em todos os produtos ativos ou só nos selecionados. Cada produto alterado é enviado ao servidor.'
      ]),
      el('button', { class: 'btn primary block', 'data-price-tool': '' }, [iconEl('percent', 14), ' Ajustar preços (' + ativos + ' ativos)'])
    );
  }

  function precoAjustado(atual, cfg) {
    var delta = cfg.modo === 'pct' ? atual * (cfg.qtd / 100) : cfg.qtd;
    var novo = UI.round2(cfg.op === 'aumentar' ? atual + delta : atual - delta);
    return novo < 0.01 ? 0.01 : novo;
  }

  function priceAdjustTool() {
    var db = Store.db;
    var selecionados = {};
    if (!db.products.some(function (p) { return p.active; })) { UI.toast('Nenhum produto ativo para ajustar.', 'warn'); return; }

    function baseList(cat) {
      return db.products.filter(function (p) { return p.active && (cat === 'all' || p.category === cat); });
    }

    var catOpts = [{ value: 'all', label: 'Todas as categorias' }].concat(
      db.categories.map(function (c) { return { value: c.id, label: c.emoji + ' ' + c.name }; }));

    /* Corpo montado com createElement: nome e preço do produto viram nós de
       texto, então nada do cadastro entra como marcação. */
    UI.modal({
      title: 'Preços e promoções', icon: 'tag', size: 'lg',
      body: frag(
        el('div', { class: 'form-grid' }, [
          UI.fieldEl('Operação', 'op', 'aumentar', { type: 'select', options: [
            { value: 'aumentar', label: 'Aumentar preços' },
            { value: 'reduzir', label: 'Reduzir preços (promoção)' }
          ] }),
          UI.fieldEl('Quanto', 'qtd', '', { type: 'money', step: '0.01', min: 0, placeholder: 'ex.: 10' }),
          UI.fieldEl('Modo', 'modo', 'pct', { type: 'select', options: [
            { value: 'pct', label: 'Percentual (%)' },
            { value: 'valor', label: 'Valor fixo (R$)' }
          ] }),
          UI.fieldEl('Aplicar em', 'escopo', 'todos', { type: 'select', options: [
            { value: 'todos', label: 'Todos os produtos do filtro' },
            { value: 'selecionar', label: 'Apenas os selecionados abaixo' }
          ] }),
          UI.fieldEl('Filtrar por categoria', 'cat', 'all', { type: 'select', full: true, options: catOpts })
        ]),
        el('div', { class: 'modal-note', id: 'pricePreview' }, 'Digite o quanto quer aumentar ou reduzir.'),
        el('div', {
          id: 'priceList',
          style: { display: 'none', 'max-height': '260px', overflow: 'auto', 'margin-top': '8px', border: '1px solid var(--line)', 'border-radius': 'var(--r-sm)' }
        })
      ),
      confirmText: 'Aplicar aos preços',
      onMount: function (root) {
        var preview = root.querySelector('#pricePreview');
        var listBox = root.querySelector('#priceList');

        function cfg() {
          var d = UI.formData(root);
          return { op: d.op, modo: d.modo, qtd: UI.round2(UI.parseNum(d.qtd)), escopo: d.escopo, cat: d.cat };
        }
        function afetados(c) {
          var base = baseList(c.cat);
          if (c.escopo === 'selecionar') base = base.filter(function (p) { return selecionados[p.id]; });
          return base.map(function (p) { return { p: p, novo: precoAjustado(p.price, c) }; });
        }
        function verPreview() {
          var c = cfg();
          if (c.qtd <= 0) { preview.textContent = 'Digite o quanto quer aumentar ou reduzir.'; return; }
          var a = afetados(c);
          if (!a.length) { preview.textContent = 'Nenhum produto no filtro/seleção atual.'; return; }
          var ex = a[0];
          var sinal = c.op === 'aumentar' ? '+' : '− ';
          var quanto = c.modo === 'pct' ? UI.num(c.qtd) + '%' : money(c.qtd);
          preview.textContent = a.length + ' produto(s) serão atualizados (' + sinal + quanto + ') · ex.: ' +
            ex.p.name + ': ' + money(ex.p.price) + ' → ' + money(ex.novo);
        }
        function listar() {
          var c = cfg();
          if (c.escopo !== 'selecionar') { listBox.style.display = 'none'; UI.fill(listBox, null); return; }
          var base = baseList(c.cat);
          if (!base.length) { listBox.style.display = 'none'; UI.fill(listBox, null); return; }
          listBox.style.display = 'block';
          UI.fill(listBox, base.map(function (p) {
            var box = el('input', { type: 'checkbox', class: 'price-pick', value: p.id });
            if (selecionados[p.id]) box.setAttribute('checked', '');
            box.addEventListener('change', function () {
              if (box.checked) selecionados[p.id] = true; else delete selecionados[p.id];
              verPreview();
            });
            return el('label', { style: { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '10px', padding: '6px 8px', 'border-bottom': '1px solid var(--line)' } }, [
              el('span', null, [box, ' ' + (p.emoji || '') + ' ' + p.name]),
              el('b', { class: 'num' }, money(p.price))
            ]);
          }));
        }
        function tudo() { listar(); verPreview(); }
        ['escopo', 'cat'].forEach(function (n) {
          var f = root.querySelector('[name=' + n + ']');
          if (f) f.addEventListener('change', tudo);
        });
        ['op', 'modo', 'qtd'].forEach(function (n) {
          var f = root.querySelector('[name=' + n + ']');
          if (f) { f.addEventListener('input', verPreview); f.addEventListener('change', verPreview); }
        });
        listar(); verPreview();
      },
      onConfirm: function (root) {
        var d = UI.formData(root);
        var c = { op: d.op, modo: d.modo, qtd: UI.round2(UI.parseNum(d.qtd)), escopo: d.escopo, cat: d.cat };
        if (c.qtd <= 0) { UI.toast('Informe o quanto aumentar ou reduzir.', 'err'); return false; }
        var base = baseList(c.cat);
        if (c.escopo === 'selecionar') base = base.filter(function (p) { return selecionados[p.id]; });
        if (!base.length) {
          UI.toast(c.escopo === 'selecionar' ? 'Selecione ao menos um produto.' : 'Nenhum produto no filtro.', 'err');
          return false;
        }
        base.forEach(function (p) {
          p.price = precoAjustado(p.price, c);
          Store.marcarCadastro('products', p);
        });
        Store.save();
        rerender();
        var sinal = c.op === 'aumentar' ? 'aumentados em ' : 'reduzidos em ';
        var quanto = c.modo === 'pct' ? UI.num(c.qtd) + '%' : money(c.qtd);
        UI.toast(base.length + ' preço(s) ' + sinal + quanto + '.', 'ok', 4500);
      }
    });
  }

  function usersBlock() {
    var db = Store.db;
    var me = Store.currentUser();
    return frag(
      db.auth.users.map(function (u) {
        return el('div', { class: 'list-item' }, [
          el('span', { class: 'avatar' }, u.name.slice(0, 2).toUpperCase()),
          el('span', { class: 'grow' }, [
            el('b', null, u.name),
            el('small', null, u.username + ' · ' + roleLabel(u) + (u.id === (me || {}).id ? ' · você' : ''))
          ]),
          u.id === (me || {}).id ? null : el('button', { class: 'mini-btn danger', 'data-deluser': u.id }, iconEl('trash', 13))
        ]);
      }),
      el('button', { class: 'btn block mt-2', 'data-newuser': '' }, [iconEl('plus', 14), ' Novo usuário']),
      el('button', { class: 'btn block mt-1', 'data-change-password': '' }, [iconEl('lock', 14), ' Trocar minha senha']),
      el('div', { class: 'modal-note', style: { 'margin-top': '11px' } }, [
        'Perfis: ', el('b', null, 'Administrador'), ' (tudo) · ', el('b', null, 'Gerente'),
        ' (tudo menos usuários) · ', el('b', null, 'Caixa'), ' (só venda e clientes) · ',
        el('b', null, 'Estoquista'), ' (produtos e estoque).'
      ])
    );
  }

  function dataBlock() {
    var servidor = (typeof API !== 'undefined' && API.status)
      ? frag(
          el('div', { class: 'divider', style: { margin: '6px 0' } }),
          el('button', { class: 'btn block', 'data-migrar': '' }, [iconEl('up', 14), ' Migrar dados para o servidor']),
          el('button', { class: 'btn block', 'data-sync': '' }, [iconEl('refresh', 14), ' Sincronizar agora']),
          el('div', { class: 'modal-note mt-1', 'data-server-note': '' }, 'Verificando o servidor…'),
          el('div', { class: 'modal-note mt-1', 'data-backup-note': '' }, 'Verificando backup automatico')
        )
      : null;
    return frag(
      el('div', { class: 'grid', style: { gap: '7px' } }, [
        el('button', { class: 'btn block', onclick: function () { UI.downloadBackup(); } }, [iconEl('down', 14), ' Baixar backup (JSON)']),
        el('button', { class: 'btn block', 'data-import': '' }, [iconEl('up', 14), ' Restaurar backup']),
        el('button', { class: 'btn block', 'data-exportcsv': '' }, [iconEl('down', 14), ' Exportar produtos (CSV)']),
        servidor,
        el('div', { class: 'divider', style: { margin: '6px 0' } }),
        el('button', { class: 'btn block', 'data-seedenullish': '' }, [iconEl('refresh', 14), ' Recarregar catálogo de exemplo']),
        el('button', { class: 'btn block danger', 'data-reset': '' }, [iconEl('trash', 14), ' Apagar todos os dados'])
      ]),
      el('div', { class: 'modal-note mt-1' }, [
        'Sem servidor, os dados ficam ', el('b', null, 'somente neste navegador'),
        ' (teto de ~5 MB). Com o servidor ligado, todos os caixas leem a mesma base.'
      ])
    );
  }

  function newUser() {
    UI.modal({
      title: 'Novo usuário', icon: 'user', size: 'sm',
      body: '<div class="form-grid">' +
        UI.field('Nome *', 'name', '', { full: true }) +
        UI.field('Usuário *', 'username', '', { full: true, hint: 'sem espaços, será minusculo' }) +
        UI.field('Senha *', 'pass', '', { type: 'password', full: true, hint: 'mínimo 4 caracteres' }) +
        UI.field('Perfil', 'role', 'caixa', { type: 'select', full: true, options: [
          { value: 'admin', label: 'Administrador — acesso total' },
          { value: 'gerente', label: 'Gerente — operação e relatórios' },
          { value: 'caixa', label: 'Caixa — só frente de caixa e clientes' },
          { value: 'estoque', label: 'Estoquista — produtos e estoque' }] }) +
        '</div>',
      confirmText: 'Criar usuário',
      onConfirm: function (root) {
        var d = UI.formData(root);
        if (!d.name || !d.name.trim()) { UI.toast('Informe o nome.', 'err'); return false; }
        if (!d.username || !d.username.trim()) { UI.toast('Informe o usuário.', 'err'); return false; }
        if (!d.pass || String(d.pass).length < 4) { UI.toast('A senha precisa de 4 caracteres.', 'err'); return false; }
        var un = String(d.username).trim().toLowerCase();
        if (Store.db.auth.users.some(function (u) { return u.username.toLowerCase() === un; })) {
          UI.toast('Este usuário já existe.', 'err'); return false;
        }
        var usuarioLocal = {
          id: Store.uid('u'), name: d.name.trim(), username: un,
          passHash: Store.hashPass(String(d.pass)), role: d.role, active: true,
          createdAt: new Date().toISOString()
        };
        if (API.estado && API.estado.online) {
          API.criarUsuario({ name: usuarioLocal.name, username: un, senha: String(d.pass), role: d.role })
            .then(function (r) {
              if (!r.ok) { UI.toast(r.erro || 'Nao foi possivel criar no servidor.', 'err', 5000); return; }
              usuarioLocal.id = r.usuario.id;
              Store.db.auth.users.push(usuarioLocal);
              Store.save(); rerender();
              UI.toast('Usuario criado no servidor e disponivel nos caixas.', 'ok');
            });
          return;
        }
        Store.db.auth.users.push(usuarioLocal);
        Store.save(); rerender();
        UI.toast('Usuario criado neste computador.', 'ok');
      }
    });
  }

  function changePassword() {
    UI.modal({
      title: 'Trocar minha senha', icon: 'lock', size: 'sm',
      body: '<div class="form-grid">' +
        UI.field('Senha atual *', 'currentPassword', '', { type: 'password', full: true }) +
        UI.field('Nova senha *', 'newPassword', '', { type: 'password', full: true, hint: 'mínimo de 12 caracteres' }) +
        UI.field('Repetir nova senha *', 'confirmPassword', '', { type: 'password', full: true }) +
        '</div>',
      confirmText: 'Alterar senha',
      onConfirm: function (root) {
        var d = UI.formData(root);
        if (!d.currentPassword) { UI.toast('Informe a senha atual.', 'err'); return false; }
        if (typeof d.newPassword !== 'string' || d.newPassword.length < 12) {
          UI.toast('A nova senha precisa ter pelo menos 12 caracteres.', 'err'); return false;
        }
        if (d.newPassword !== d.confirmPassword) { UI.toast('As novas senhas não conferem.', 'err'); return false; }
        if (typeof API === 'undefined' || !API.alterarSenha) {
          UI.toast('A troca de senha exige conexão com o servidor.', 'err'); return false;
        }
        API.alterarSenha(d.currentPassword, d.newPassword).then(function (r) {
          if (!r.ok) { UI.toast(r.erro || 'Não foi possível alterar a senha.', 'err', 5000); return; }
          var me = Store.currentUser();
          if (me) me.passHash = Store.hashPass(d.newPassword);
          Store.save();
          UI.toast('Senha alterada. As outras sessões foram encerradas.', 'ok');
        });
      }
    });
  }

  function newCategory() {
    UI.promptText({ title: 'Nova categoria', icon: 'tag', label: 'Nome da categoria', required: true, confirmText: 'Criar' })
      .then(function (name) {
        if (!name || !name.trim()) return;
        Store.db.categories.push({
          id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: name.trim(), emoji: '🏷️', color: UI.PALETTE[Store.db.categories.length % UI.PALETTE.length]
        });
        Store.save(); rerender();
        UI.toast('Categoria criada.', 'ok');
      });
  }

  function printLabels() {
    var db = Store.db;
    var list = db.products.filter(function (p) { return p.active; }).slice(0, 60);
    if (!list.length) { UI.toast('Nenhum produto para etiquetar.', 'warn'); return; }
    var html = '<div style="font:10px sans-serif">' + list.map(function (p) {
      return '<div style="display:inline-block;width:62mm;padding:2mm;border:1px dashed #999;margin:1mm;vertical-align:top">' +
        '<div style="font-weight:700;font-size:10px">' + esc(p.name) + '</div>' +
        '<div style="font-size:8px;color:#555">' + esc(p.code || '') + '</div>' +
        '<div style="font-size:16px;font-weight:800;margin-top:1mm">' + UI.num(p.price) + '</div>' +
        '<div style="font-size:7px;color:#777">' + esc(db.config.storeName) + '</div></div>';
    }).join('') + '</div>';
    UI.printHTML(html, 1000);
  }

  function importProducts() {
    UI.openImportDialog(function () { UI.toast('Use CSV para produtos.', 'info'); });
  }

  /* ================= ROTEADOR ================= */
  function go(page) {
    if (!Store.currentUser()) { showLogin(); return; }
    var def = PAGES.filter(function (p) { return p.id === page; })[0];
    if (!def) page = 'dashboard';
    if (def.perm && !Store.can(def.perm)) {
      UI.toast('Seu perfil não tem acesso a esta área.', 'err');
      return;
    }
    current = page;
    location.hash = page === 'dashboard' ? '' : page;
    $$('.rail-btn[data-page]').forEach(function (b) { b.classList.toggle('active', b.dataset.page === page); });
    var d = PAGES.filter(function (p) { return p.id === page; })[0];
    $('#pageTitle').textContent = d.label;
    $('#pageSub').textContent = { pdv: 'Caixa aberto — F2 leitor · F9 finalizar' }[page] || '';
    updateShiftUI();
    rerender();
  }

  /* Tela de erro visível. Sem isso, qualquer exceção dentro de uma view deixa
     só o fundo escuro — o operador vê "tela preta" e não sabe o que houve. */
  function renderCrash(shell, page, err) {
    shell.innerHTML =
      '<div class="crash-box">' +
        '<div class="crash-icon">' + icon('alert', 26) + '</div>' +
        '<h2>Não foi possível abrir "' + esc(page) + '"</h2>' +
        '<p>Seus dados estão salvos. Este erro é da tela, não do cadastro — ' +
          'você pode voltar e continuar operando.</p>' +
        '<pre class="crash-detail">' + esc(err && err.message ? err.message : String(err)) + '</pre>' +
        '<div class="crash-actions">' +
          '<button class="btn primary" id="crashBack">Voltar ao Caixa</button>' +
          '<button class="btn" id="crashReload">Recarregar o sistema</button>' +
        '</div>' +
        '<p class="tiny muted" style="margin-top:14px">Se o problema persistir, ' +
          'o botão abaixo limpa apenas o cache da tela (não apaga vendas nem produtos).</p>' +
        '<button class="btn danger" id="crashReset">Limpar cache da tela</button>' +
      '</div>';
    var back = $('#crashBack');
    if (back) back.onclick = function () { go('pdv'); };
    var rl = $('#crashReload');
    if (rl) rl.onclick = function () { location.reload(); };
    var rs = $('#crashReset');
    if (rs) rs.onclick = function () {
      try {
        var raw = localStorage.getItem('sudam_gestao_v3');
        localStorage.removeItem('sudam_gestao_v3');
        localStorage.setItem('sudam_gestao_v3_corrompido_backup', raw || '');
        location.reload();
      } catch (e) { alert('Não foi possível limpar o cache: ' + e.message); }
    };
  }

  function rerender() {
    var shell = $('#view');
    if (!shell) return;
    var f = Views[current];
    if (!f) return;
    updateShiftUI();
    shell.style.padding = '';
    shell.style.overflow = '';
    var view = freshView();
    if (!view) return;
    // O visual Vértice é exclusivo do PDV: sai do modo ao trocar de aba.
    if (current !== 'pdv' && PDV.leave) PDV.leave();

    var html;
    try {
      html = f();          // a view pode lançar sobre dado corrompido
    } catch (err) {
      if (console) console.error('[app] falha ao renderizar "' + current + '":', err);
      renderCrash(shell, current, err);
      renderRail();
      return;
    }

    // PDV usa layout sem padding próprio
    if (current === 'pdv') {
      shell.style.padding = '0';
      shell.style.overflow = 'hidden';
      pintar(view, html);
      try { PDV.bind(view); }
      catch (e2) {
        if (console) console.error('[app] falha ao ligar o PDV:', e2);
        renderCrash(shell, 'pdv', e2);
        renderRail();
        return;
      }
    } else {
      pintar(view, html);
      try { bindView(view); }
      catch (e3) {
        if (console) console.error('[app] falha ao ligar a view "' + current + '":', e3);
        renderCrash(shell, current, e3);
        renderRail();
        return;
      }
    }
    renderRail();
  }

  function bindView(view) {
    var on = function (sel, ev, fn) { var n = $(sel); if (n) n.addEventListener(ev, fn); };

    /* --- dashboard --- */
    view.addEventListener('click', function (e) {
      var goEl = e.target.closest('[data-go]');
      if (goEl) go(goEl.dataset.go);
      var pr = e.target.closest('[data-print]');
      if (pr) { PDV.printReceipt(pr.dataset.print); return; }
    });

    /* --- vendas --- */
    var sq = $('#saleQ');
    if (sq) {
      var deb = function () {
        var f = Views.sales._f;
        f.q = sq.value; rerender();
        setTimeout(function () { var n = $('#saleQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0);
      };
      sq.addEventListener('input', deb);
    }
    on('#saleFrom', 'change', function () { Views.sales._f.from = this.value; rerender(); });
    on('#saleTo', 'change', function () { Views.sales._f.to = this.value; rerender(); });
    on('#saleMethod', 'change', function () { Views.sales._f.method = this.value; rerender(); });
    on('#saleClear', 'click', function () { Views.sales._f = { q: '', from: '', to: '', method: 'all' }; rerender(); });
    view.addEventListener('click', function (e) {
      var v = e.target.closest('[data-void]');
      if (v) { PDV.voidSale(v.dataset.void); return; }
      var p = e.target.closest('[data-print]');
      if (p) { PDV.printReceipt(p.dataset.print); return; }
      var s = e.target.closest('[data-sale]');
      if (s && !e.target.closest('button')) saleDetail(s.dataset.sale);
    });

    /* --- produtos --- */
    var pq = $('#prodQ');
    if (pq) {
      pq.addEventListener('input', function () {
        Views.products._f.q = pq.value; rerender();
        setTimeout(function () { var n = $('#prodQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0);
      });
    }
    on('#prodCat', 'change', function () { Views.products._f.cat = this.value; rerender(); });
    on('#prodStatus', 'change', function () { Views.products._f.status = this.value; rerender(); });
    view.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]');
      if (ed) { editProduct(ed.dataset.edit); return; }
      var st = e.target.closest('[data-stock]');
      if (st) { stockMove(st.dataset.stock); return; }
      var pr = e.target.closest('[data-prod]');
      if (pr && !e.target.closest('button')) editProduct(pr.dataset.prod);
    });

    /* --- compras --- */
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-ptab]');
      if (t) { Views.purchases._f.tab = t.dataset.ptab; rerender(); return; }
      if (e.target.closest('[data-newsup]')) { editSupplier(); return; }
      var nps = e.target.closest('[data-newpc-supplier]');
      if (nps) { newPurchase([], nps.dataset.newpcSupplier); return; }
      var es = e.target.closest('[data-editsup]');
      if (es) { editSupplier(es.dataset.editsup); return; }
      if (e.target.closest('[data-newpc]')) { newPurchase(); return; }
      var vp = e.target.closest('[data-viewpc]');
      if (vp) { viewPurchase(vp.dataset.viewpc); return; }
      if (e.target.closest('[data-selectall]')) {
        view.querySelectorAll('.pc-pick').forEach(function (c) { c.checked = true; });
        return;
      }
      if (e.target.closest('[data-makeorder]')) {
        var pick = [];
        view.querySelectorAll('.pc-pick:checked').forEach(function (c) {
          pick.push({ id: c.value, qty: Number(c.dataset.sug) || 1, cost: UI.round2(UI.parseNum(c.dataset.cost)) });
        });
        if (!pick.length) { UI.toast('Selecione ao menos um produto.', 'warn'); return; }
        newPurchase(pick);
      }
    });

    /* --- clientes --- */
    var cq = $('#custQ');
    if (cq) {
      cq.addEventListener('input', function () {
        Views.customers._f.q = cq.value; rerender();
        setTimeout(function () { var n = $('#custQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0);
      });
    }
    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-cf]');
      if (f) { Views.customers._f.only = f.dataset.cf; rerender(); return; }
      var r = e.target.closest('[data-recv]');
      if (r) { receiveDebt(r.dataset.recv); return; }
      var ec = e.target.closest('[data-cec]');
      if (ec) { editCustomer(ec.dataset.cec); return; }
      var c = e.target.closest('[data-cust]');
      if (c && !e.target.closest('button')) customerDetail(c.dataset.cust);
    });

    /* --- financeiro --- */
    var fq = $('#finQ');
    if (fq) {
      fq.addEventListener('input', function () {
        Views.finance._f.q = fq.value; rerender();
        setTimeout(function () { var n = $('#finQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0);
      });
    }
    on('#finType', 'change', function () { Views.finance._f.type = this.value; rerender(); });
    on('#finPeriod', 'change', function () { Views.finance._f.period = this.value; rerender(); });
    on('#finExport', 'click', function () {
      var rows = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Forma', 'Vencimento', 'Valor', 'Quitado']];
      Store.db.entries.forEach(function (e) {
        rows.push([UI.dt(e.date), e.type, e.category, e.description, e.method || '', e.due || '', UI.num(e.amount), e.settled ? 'Sim' : 'Não']);
      });
      UI.downloadCSV('financeiro.csv', rows);
    });

    /* --- contas --- */
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-atab]');
      if (t) { Views.payables._f.tab = t.dataset.atab; rerender(); return; }
      var s = e.target.closest('[data-settle]');
      if (s) settleEntry(s.dataset.settle);
    });

    /* --- relatórios --- */
    view.addEventListener('click', function (e) {
      var p = e.target.closest('[data-rp]');
      if (p) { Views.reports._f.period = p.dataset.rp; rerender(); }
    });

    /* --- configurações --- */
    view.addEventListener('click', function (e) {
      var sv = e.target.closest('[data-save]');
      if (sv) { saveCfg(sv.dataset.save); return; }

      var pay = e.target.closest('[data-pay]');
      if (pay) { togglePayMethod(pay.dataset.pay); return; }

      var ncat = e.target.closest('[data-newcat]');
      if (ncat) { newCategory(); return; }
      var dcat = e.target.closest('[data-delcat]');
      if (dcat) { deleteCategory(dcat.dataset.delcat); return; }

      var nu = e.target.closest('[data-newuser]');
      if (nu) { newUser(); return; }
      if (e.target.closest('[data-change-password]')) { changePassword(); return; }
      var du = e.target.closest('[data-deluser]');
      if (du) { deleteUser(du.dataset.deluser); return; }

      if (e.target.closest('[data-price-tool]')) { priceAdjustTool(); return; }

      if (e.target.closest('[data-import]')) { doImport(); return; }
      if (e.target.closest('[data-exportcsv]')) { exportProductsCSV(); return; }
      if (e.target.closest('[data-migrar]')) { migrarServidor(); return; }
      if (e.target.closest('[data-sync]')) { sincronizarServidor(); return; }
      if (e.target.closest('[data-seedenullish]')) { reloadSeed(); return; }
      if (e.target.closest('[data-reset]')) { resetAll(); return; }
    });
    atualizarNotaServidor();
  }

  /* ---------------- ponte com o servidor (Ajustes) ---------------- */

  function notaServidor(texto) {
    var el = document.querySelector('[data-server-note]');
    if (el) el.innerHTML = texto;
  }

  function atualizarNotaServidor() {
    if (typeof API === 'undefined' || !API.status) return;
    API.status().then(function (on) {
      if (!on) {
        notaServidor('<b style="color:#b42318">Servidor não encontrado.</b> O app funciona só neste computador.');
        return;
      }
      var p = API.pendentes();
      var rej = API.rejeitados ? API.rejeitados() : 0;
      notaServidor('Servidor <b>conectado</b>' +
        (API.estado.migrado ? ' · dados já migrados' : ' · ainda não migrados') +
        (API.estado.caixasAbertos ? ' - ' + API.estado.caixasAbertos + ' caixa(s) aberto(s)' : '') +
        (p ? ' · <b>' + p + '</b> venda(s) na fila' : '') +
        (rej ? ' · <b style="color:#b42318">' + rej + '</b> recusado(s) pelo servidor' : ''));
      if (API.backupStatus) API.backupStatus().then(function (b) {
        var el = document.querySelector('[data-backup-note]'); if (!el) return;
        if (!b || !b.ultimoArquivo) { el.textContent = 'Backup automatico ainda nao confirmado.'; return; }
        var data = new Date(b.ultimoArquivo), horas = Math.floor((Date.now() - data.getTime()) / 3600000);
        el.textContent = (b.falha ? 'Falha no backup: ' + b.falha : 'Ultimo backup integro: ' + data.toLocaleString('pt-BR')) +
          ' - ' + b.quantidade + ' copias locais' + (b.espelhoAtivo ? ' - espelho externo: ' + b.copiasEspelho : ' - espelho externo nao configurado') +
          (b.falhaEspelho ? ' - falha no espelho: ' + b.falhaEspelho : '') + (horas > 2 ? ' - ATENCAO: copia mais antiga que 2 horas' : '');
      });
    }).catch(function () { notaServidor('Servidor não encontrado.'); });
  }

  function migrarServidor() {
    var db = Store.db;
    var n = (db.products || []).length + (db.customers || []).length + (db.sales || []).length;
    UI.confirm({
      title: 'Migrar dados para o servidor?', kind: 'warn', confirmText: 'Migrar agora',
      message: n + ' registro(s) serão enviados ao mini PC. Depois disso, todos os caixas leem a mesma base e o limite de 5 MB do navegador deixa de importar. Este processo pode levar alguns minutos.'
    }).then(function (ok) {
      if (!ok) return;
      UI.toast('Enviando dados para o servidor…', 'info', 4000);
      return Store.migrarParaServidor();
    }).then(function (r) {
      if (!r) return;
      if (r.ok) {
        var c = r.contagem || {};
        UI.toast('Migração concluída: ' + (c.produtos || 0) + ' produtos, ' +
          (c.clientes || 0) + ' clientes, ' + (c.vendas || 0) + ' vendas.', 'ok', 6000);
        atualizarNotaServidor();
      } else {
        UI.toast(r.erro || 'Falha ao migrar.', 'err', 6000);
      }
    }).catch(function () {
      UI.toast('Falha ao migrar.', 'err');
    });
  }

  function sincronizarServidor() {
    UI.toast('Sincronizando…', 'info', 2000);
    API.reenviar().then(function (r) {
      if (!r) { UI.toast('Servidor indisponível.', 'warn'); return; }
      if (r.recusados) {
        /* Recusa definitiva e o caso que exige fala: o servidor disse que esse
         * registro nao entra, entao ele saiu da fila. Se isso passar em
         * silencio, o gerente nunca descobre que aquela venda nao esta no
         * servidor -- e so descobre quando a contagem de caixa nao bate. */
        UI.toast(r.recusados + ' registro(s) recusado(s) pelo servidor e guardado(s) para você revisar.',
          'err', 9000);
      }
      if (r.enviados) UI.toast(r.enviados + ' registro(s) enviados.', 'ok');
      else if (!r.recusados && r.ok) UI.toast('Tudo em dia.', 'ok');
      else if (r.restam) UI.toast(r.restam + ' registro(s) ainda na fila.', 'warn', 5000);
      else if (!r.recusados) UI.toast('Servidor indisponível.', 'warn', 5000);
      atualizarNotaServidor();
    }).catch(function () { UI.toast('Servidor indisponível.', 'warn'); });
  }

  function viewPurchase(id) {
    var pc = (Store.db.purchases || []).find(function (x) { return x.id === id; });
    if (!pc) return;
    var db = Store.db;
    UI.modal({
      title: 'Compra #' + pc.id, icon: 'truck', size: 'md',
      body: '<div class="stat-mini"><span>Data</span><b>' + UI.dt(pc.date) + '</b></div>' +
        '<div class="stat-mini"><span>Fornecedor</span><b>' + esc(pc.supplierName || '—') + '</b></div>' +
        (pc.invoiceNo ? '<div class="stat-mini"><span>Nota fiscal</span><b>' + esc(pc.invoiceNo) + '</b></div>' : '') +
        '<div class="stat-mini"><span>Pagamento</span><b>' + esc(pc.payMethod) + (pc.paid ? ' — pago' : ' — a pagar ' + (pc.due ? UI.dateOnly(pc.due) : '')) + '</b></div>' +
        '<div class="divider"></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="right">Qtd</th><th class="right">Custo</th><th class="right">Total</th></tr></thead><tbody>' +
        pc.items.map(function (i) {
          var p = db.products.find(function (x) { return x.id === i.id; });
          return '<tr><td>' + (p ? esc(p.emoji) + ' ' + esc(p.name) : 'produto removido') + '</td>' +
            '<td class="right num">' + i.qty + '</td><td class="right num">' + money(i.cost) + '</td>' +
            '<td class="right num"><b>' + money(UI.round2(i.qty * i.cost)) + '</b></td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="right num">' + money(pc.total) + '</td></tr></tfoot></table></div>',
      confirmText: 'Fechar'
    });
  }

  function saveCfg(which) {
    var cfg = Store.db.config;
    function read(name) { var n = $('[name=' + name + ']'); return n ? n.value : ''; }
    function readNum(name) { var n = $('[name=' + name + ']'); return n ? UI.parseNum(n.value) : 0; }
    function readChk(name) { var n = $('[name=' + name + ']'); return n ? n.checked : false; }

    if (which === 'loja') {
      cfg.storeName = read('storeName') || 'Minha loja';
      cfg.cnpj = read('cnpj'); cfg.ie = read('ie');
      cfg.address = read('address'); cfg.phone = read('phone');
      cfg.taxRegime = read('taxRegime');
      $('#pageSub') && ($('#pageSub').textContent = cfg.storeName);
    } else if (which === 'operacao') {
      cfg.operator = read('operator');
      cfg.maxDiscount = readNum('maxDiscount');
      cfg.cashOpening = readNum('cashOpening');
      cfg.allowNegativeStock = readChk('allowNegativeStock');
      cfg.requireCustomerOnCredit = readChk('requireCustomerOnCredit');
    } else if (which === 'fiscal') {
      cfg.pix.pixKey = UI.normalizePixKey(read('pixKey'));
      cfg.pix.city = read('pixCity');
      cfg.municipalRegistration = read('municipalRegistration'); cfg.crt = read('crt');
      cfg.cnae = read('cnae'); cfg.municipalityCode = read('municipalityCode');
      cfg.zipCode = read('zipCode'); cfg.state = read('state').trim().toUpperCase().slice(0, 2);
      cfg.city = read('city'); cfg.district = read('district');
      cfg.addressNumber = read('addressNumber'); cfg.addressComplement = read('addressComplement');
      cfg.fiscalPhone = read('fiscalPhone'); cfg.fiscalEmail = read('fiscalEmail');
    } else if (which === 'tema') {
      cfg.receiptFooter = read('receiptFooter');
      cfg.printWidth = Number(read('printWidth')) || 80;
      cfg.theme = read('theme');
      applyTheme(cfg.theme);
    }
    Store.save();
    if (which !== 'tema' && typeof API !== 'undefined' && API.estado && API.estado.online && API.salvarConfig) {
      var configRemota = Object.assign({}, cfg, { pix: { pixKey: cfg.pix.pixKey || '', city: cfg.pix.city || '' } });
      API.salvarConfig(configRemota).then(function (r) {
        if (!r.ok) UI.toast('Configuracao salva neste caixa, mas nao sincronizada com o servidor.', 'warn', 5000);
      });
    }
    UI.toast('Configurações salvas.', 'ok');
    rerender();
  }

  function togglePayMethod(m) {
    var cfg = Store.db.config;
    var i = cfg.paymentMethods.indexOf(m);
    if (i > -1) {
      if (cfg.paymentMethods.length <= 1) { UI.toast('Mantenha ao menos uma forma de pagamento.', 'warn'); return; }
      cfg.paymentMethods.splice(i, 1);
    } else cfg.paymentMethods.push(m);
    Store.save(); rerender();
  }

  function deleteCategory(id) {
    var n = Store.db.products.filter(function (p) { return p.category === id; }).length;
    if (n) { UI.toast('Há produtos nesta categoria.', 'warn'); return; }
    UI.confirm({ title: 'Excluir categoria?', kind: 'danger', message: 'Esta ação não pode ser desfeita.', confirmText: 'Excluir' })
      .then(function (ok) {
        if (!ok) return;
        Store.db.categories = Store.db.categories.filter(function (c) { return c.id !== id; });
        Store.save(); rerender(); UI.toast('Categoria excluída.', 'ok');
      });
  }

  function deleteUser(id) {
    var me = Store.currentUser();
    if (me && me.id === id) return;
    var u = Store.db.auth.users.find(function (x) { return x.id === id; });
    if (!u) return;
    UI.confirm({ title: 'Excluir usuário "' + u.name + '"?', kind: 'danger', message: 'Ele não poderá mais entrar no sistema.', confirmText: 'Excluir' })
      .then(function (ok) {
        if (!ok) return;
        Store.db.auth.users = Store.db.auth.users.filter(function (x) { return x.id !== id; });
        Store.save(); rerender(); UI.toast('Usuário excluído.', 'ok');
      });
  }

  function doImport() {
    UI.confirm({
      title: 'Restaurar backup?', kind: 'danger',
      message: 'Todos os dados atuais serão substituídos pelo conteúdo do arquivo.',
      confirmText: 'Escolher arquivo'
    }).then(function (ok) {
      if (!ok) return;
      UI.openImportDialog(function (text) {
        try {
          Store.importJSON(text);
          applyTheme(Store.db.config.theme);
          Store.logout();
          showLogin('Backup restaurado. Entre novamente.');
        } catch (e) {
          UI.toast('Arquivo inválido: ' + e.message, 'err');
        }
      });
    });
  }

  function exportProductsCSV() {
    var rows = [['Código', 'Código de barras', 'Nome', 'Categoria', 'Emoji', 'Custo', 'Preço', 'Margem %', 'Estoque', 'Mínimo', 'Unidade', 'Validade', 'Fornecedor', 'NCM', 'CFOP', 'CSOSN', 'CST ICMS', 'CST PIS', 'CST COFINS', 'CEST', 'Origem']];
    Store.db.products.forEach(function (p) {
      rows.push([p.code || '', p.barcode || '', p.name, p.category, p.emoji,
        UI.num(p.cost), UI.num(p.price), Store.marginOf(p), p.stock, p.min,
        p.unit || 'un', p.expiry || '', p.supplier || '', p.ncm || '', p.cfop || '', p.csosn || '', p.cst || '', p.pisCst || '', p.cofinsCst || '', p.cest || '', p.origin || '0']);
    });
    UI.downloadCSV('produtos.csv', rows);
    UI.toast('produtos.csv exportado. Use como modelo de importação.', 'ok');
  }

  function exportSales() {
    var rows = [['Venda', 'Data', 'Operador', 'Cliente', 'Itens', 'Formas', 'Subtotal', 'Desconto', 'Total', 'Troco', 'Status']];
    Store.db.sales.forEach(function (s) {
      rows.push([s.id, UI.dt(s.date), s.operator, s.customerName || '', s.items.length,
        s.payments.map(function (p) { return p.method; }).join(' + '),
        UI.num(s.subtotal), UI.num(s.discount), UI.num(s.total), UI.num(s.change), s.status]);
    });
    UI.downloadCSV('vendas.csv', rows);
    UI.toast('vendas.csv exportado.', 'ok');
  }

  function exportCustomers() {
    var rows = [['Nome', 'Telefone', 'CPF', 'Endereço', 'Limite', 'Em aberto', 'Pontos', 'Cliente desde']];
    Store.db.customers.forEach(function (c) {
      rows.push([c.name, c.phone || '', c.cpf || '', c.address || '', UI.num(c.debtLimit), UI.num(c.debt), c.points || 0, UI.dateOnly(c.createdAt)]);
    });
    UI.downloadCSV('clientes.csv', rows);
    UI.toast('clientes.csv exportado.', 'ok');
  }

  function reloadSeed() {
    UI.confirm({
      title: 'Recarregar catálogo de exemplo?', kind: 'warn',
      message: 'Os 61 produtos de demonstração serão recriados. Vendas, clientes e financeiro atuais permanecem.',
      confirmText: 'Recarregar'
    }).then(function (ok) {
      if (!ok) return;
      var fresh = Store.migrate(null);
      Store.db.products = fresh.products;
      Store.db.categories = fresh.categories;
      Store.save(); rerender();
      UI.toast('Catálogo recarregado com ' + Store.db.products.length + ' produtos.', 'ok');
    });
  }

  function resetAll() {
    UI.promptText({
      title: 'Apagar todos os dados', icon: 'alert', label: 'Digite APAGAR para confirmar',
      required: true, danger: true, confirmText: 'Apagar tudo'
    }).then(function (v) {
      if (v !== 'APAGAR') { UI.toast('Confirmação cancelada — nada foi apagado.', 'info'); return; }
      Store.resetData(false);
      applyTheme(Store.db.config.theme);
      Store.logout();
      showLogin('Todos os dados foram apagados.');
    });
  }

  /* ================= TECLADO GLOBAL ================= */
  function globalKeys(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); toggleTheme(); return; }
    PDV.keys(e);
  }

  /* ================= RECONCILIACAO DE CATALOGO =================
   *
   * O servidor decide preco e estoque; o local e copia de trabalho. Sem um
   * ciclo proprio, dois caixas que mexem no mesmo produto fora do fluxo
   * normal ficam divergentes ate alguem reparar. Roda a cada 5 min e tambem
   * quando a aba volta a ficar visivel -- o caixa que saiu para o almoco
   * volta com o estoque de agora, nao com o de duas horas atras.
   */
  var RECONCILIA_MS = 5 * 60 * 1000;
  var reconciliacaoArmada = false;

  function reconciliarCatalogo(avisar) {
    if (!Store.currentUser() || !Store.reconciliarEstoque) return;
    Store.reconciliarEstoque().then(function (r) {
      if (!r || !r.ok || (!r.atualizados && !r.novos)) return;
      /* Nao redesenha por baixo de um modal aberto: apagaria o que o operador
         esta digitando. Fechado o modal, o proximo render ja pega o novo dado. */
      if (!UI.modalAberto || !UI.modalAberto()) rerender();
      if (avisar) {
        UI.toast('Estoque atualizado pelo servidor: ' + (r.atualizados + r.novos) + ' produto(s).', 'info');
      }
    });
  }

  function armarReconciliacao() {
    if (reconciliacaoArmada) return;
    reconciliacaoArmada = true;
    setInterval(function () { reconciliarCatalogo(false); }, RECONCILIA_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) reconciliarCatalogo(false);
    });
  }

  /* ================= BOOT ================= */
  function start() {
    applyTheme(Store.db.config.theme);
    buildShell();
    if (!Store.currentUser()) { showLogin(); return; }
    /* Sessão restaurada do navegador: o overlay de login precisa sair ANTES de
       qualquer render, senão ele fica por cima do sistema já montado. */
    hideLogin();
    var h = location.hash.slice(1);
    var u = Store.currentUser();
    var initial = h && PAGES.some(function (p) { return p.id === h; }) ? h : (u.role === 'caixa' ? 'pdv' : 'dashboard');
    if (u.role === 'caixa' && initial !== 'pdv' && initial !== 'settings') initial = 'pdv';
    go(initial);
    armarReconciliacao();
  }

  document.addEventListener('DOMContentLoaded', function () {
    try {
      Store.load();
      document.addEventListener('keydown', globalKeys);
      window.addEventListener('hashchange', function () {
        if (!Store.currentUser()) return;
        var h = location.hash.slice(1);
        if (h && h !== current && PAGES.some(function (p) { return p.id === h; })) go(h);
      });
      start();
      global.__pdvBootOk = true;
    } catch (err) {
      if (console) console.error('[app] falha ao iniciar:', err);
      var app = $('#app');
      if (app) {
        app.innerHTML = '<section class="boot-error" role="alert">' +
          '<h1>O sistema não conseguiu iniciar</h1>' +
          '<p>O cadastro foi preservado. Recarregue a página; se o erro continuar, confira o armazenamento do navegador.</p>' +
          '<pre></pre><button class="btn primary" type="button">Recarregar sistema</button></section>';
        var detail = app.querySelector('pre');
        if (detail) detail.textContent = err && err.message ? err.message : String(err);
        var reload = app.querySelector('button');
        if (reload) reload.onclick = function () { location.reload(); };
      }
    }
  });

  global.App = {
    go: go, rerender: rerender, logout: logout, toggleTheme: toggleTheme,
    shiftAction: toggleShift, refreshShiftUI: updateShiftUI,
    toggleConfig: function () { go('settings'); },
    editProduct: editProduct, editCustomer: editCustomer,
    newEntry: newEntry, printDRE: printDRE, printLabels: printLabels,
    exportSales: exportSales, exportCustomers: exportCustomers, importProducts: importProducts,
    saleDetail: saleDetail, Views: Views
  };
})(window);

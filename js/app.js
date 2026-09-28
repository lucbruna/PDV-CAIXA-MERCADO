/* ==========================================================================
   app.js — Shell: login, tema, rail, roteamento, abas de gestão.
   ========================================================================== */
(function (global) {
  'use strict';

  var UI = global.UI, Store = global.Store, PDV = global.PDV;
  var $ = UI.$, $$ = UI.$$, esc = UI.esc, money = UI.money, icon = UI.icon;

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
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1220' : '#e6ecf3');
    var b = $('#themeBtn');
    if (b) b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 15);
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
    a.innerHTML =
      '<div class="auth-box">' +
        '<div class="auth-logo">' + icon('cart', 30) + '</div>' +
        '<h2>Sudam Gestão</h2>' +
        '<p class="sub">Frente de caixa e gestão do mercadinho</p>' +
        '<div class="auth-card">' +
          (msg ? '<div class="auth-err show">' + esc(msg) + '</div>' : '') +
          '<label class="lbl">Usuário</label>' +
          '<input class="field" id="authUser" autocomplete="username" placeholder="Digite seu usuário">' +
          '<label class="lbl">Senha</label>' +
          '<input class="field" id="authPass" type="password" autocomplete="current-password" placeholder="Digite sua senha">' +
          '<button class="auth-btn" id="authGo">' + icon('logout', 17) + ' Entrar no sistema</button>' +
          '<div class="auth-qk">' +
            '<button data-qk="admin">Administrador<small>admin / 1234</small></button>' +
            '<button data-qk="caixa">Caixa 1<small>caixa1 / 0000</small></button>' +
          '</div>' +
        '</div>' +
      '</div>';

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
    var user = Store.login(u, p);
    if (!user) { showLogin('Usuário ou senha incorretos.'); return; }
    hideLogin();
    Store.save();
    start();
    UI.toast('Bem-vindo, ' + user.name + '!', 'ok');
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
    app.innerHTML =
      '<nav class="rail">' +
        '<div class="rail-logo">' + icon('cart', 21) + '</div>' +
        '<div class="rail-nav" id="railNav"></div>' +
        '<div class="rail-foot">' +
          '<button class="rail-btn" id="themeBtn" title="Alternar tema (Ctrl+Shift+D)"></button>' +
          '<button class="rail-btn" id="cfgBtn" title="Configurações (F12)">' + icon('gear', 19) + '<em>Ajustes</em></button>' +
          '<button class="rail-btn" id="logoutBtn" title="Sair">' + icon('logout', 19) + '<em>Sair</em></button>' +
        '</div>' +
      '</nav>' +
      '<div class="work">' +
        '<header class="topbar">' +
          '<div><h1 id="pageTitle">Início</h1><div class="sub" id="pageSub"></div></div>' +
          '<div class="tb-sep"></div>' +
          '<div class="tb-right">' +
            '<span class="clock" id="clock"></span>' +
            '<span class="chip" id="shiftChip"></span>' +
            '<button class="btn sm" id="shiftBtn"></button>' +
            '<div class="user-pill"><span class="avatar" id="avatar">' + esc((u ? u.name : '?').slice(0, 2).toUpperCase()) + '</span>' +
            '<span><b>' + esc(u ? u.name : '') + '</b><small>' + esc(roleLabel(u)) + '</small></span></div>' +
          '</div>' +
        '</header>' +
        '<div class="content" id="view"></div>' +
      '</div>' +
      '<div id="toastWrap" class="toast-wrap"></div>' +
      '<input type="file" id="importFile" accept=".json,application/json" style="display:none">';

    $('#themeBtn').onclick = toggleTheme;
    $('#cfgBtn').onclick = function () { go('settings'); };
    $('#logoutBtn').onclick = logout;
    $('#shiftBtn').onclick = toggleShift;
    applyTheme(Store.db.config.theme);
    renderRail();
    tickClock();
    setInterval(tickClock, 15000);
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

    nav.innerHTML = PAGES.filter(function (p) { return !p.perm || Store.can(p.perm) || p.perm === 'pdv'; }).map(function (p) {
      var dot = '';
      if (p.id === 'products' && low) dot = '<span class="dot"></span>';
      if (p.id === 'customers' && debt > 0) dot = '<span class="dot" style="background:var(--amber)"></span>';
      return '<button class="rail-btn" data-page="' + p.id + '" title="' + p.label + '">' + icon(p.icon, 19) +
        '<em>' + p.label + '</em>' + dot + '</button>';
    }).join('');

    nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]');
      if (b) go(b.dataset.page);
    });
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
      chip.innerHTML = '<span class="pulse"></span> ' + esc(db.shift.operator) + ' · ' + money(db.shift.cashExpected) + ' em caixa';
      chip.title = 'Clique para conferir e fechar o caixa';
      chip.onclick = closeShiftFlow;
      btn.className = 'btn sm warn';
      btn.innerHTML = icon('lock', 13) + ' Fechar caixa';
    } else {
      chip.className = 'chip err';
      chip.innerHTML = '<span class="pulse"></span> Caixa fechado';
      chip.onclick = toggleShift;
      btn.className = 'btn sm primary';
      btn.innerHTML = icon('wallet', 13) + ' Abrir caixa';
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
        x.payments.forEach(function (p) { byMethod[p.method] = UI.round2((byMethod[p.method] || 0) + p.amount); });
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
      onConfirm: function (root) {
        var d = UI.formData(root);
        var counted = UI.round2(UI.parseNum(d.counted));
        if (d.counted === '' || counted < 0) { UI.toast('Informe o dinheiro contado.', 'err'); return false; }
        var diff = UI.round2(counted - expected);
        Store.closeShift(counted);
        s.note = d.note || '';
        s.voidedCount = 0;
        Store.save();
        rerender();
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
  function kpi(label, value, foot, tone, spark) {
    return '<div class="card kpi ' + (tone || '') + '">' +
      '<div class="kpi-label"><i></i>' + esc(label) + '</div>' +
      '<div class="kpi-value num">' + value + '</div>' +
      (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') +
      (spark ? UI.sparkline(spark) : '') + '</div>';
  }

  function card(title, body, extra, iconName) {
    return '<section class="card"><div class="card-head"><h2>' + (iconName ? icon(iconName, 16) : '') + esc(title) + '</h2>' +
      (extra || '') + '</div>' + body + '</section>';
  }

  function empty(msg, sub, ico) {
    return '<div class="empty"><span class="ico">' + icon(ico || 'info', 34) + '</span><b>' + esc(msg) + '</b>' + esc(sub || '') + '</div>';
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

    return '<div class="page-head"><div><h1>Bom dia, ' + esc((Store.currentUser() || {}).name || '') + '</h1>' +
      '<p>' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' — operação do ' + esc(db.config.storeName) + '.</p></div>' +
      '<div class="actions"><button class="btn" onclick="App.go(\'products\')">' + icon('box', 14) + ' Produtos</button>' +
      '<button class="btn primary" onclick="App.go(\'pdv\')">' + icon('cart', 14) + ' Abrir frente de caixa</button></div></div>' +

      '<div class="grid kpis">' +
        kpi('Vendas hoje', money(rev), today.length + ' operação(ões)', 'accent', week.map(function (w) { return w.v; })) +
        kpi('Lucro estimado', money(profit), rev ? 'margem ' + UI.pct(rev ? profit / rev * 100 : 0) : 'sem vendas', 'teal') +
        kpi('Ticket médio', money(today.length ? rev / today.length : 0), 'por operação') +
        kpi('A receber (fiado)', money(debt), db.customers.filter(function (c) { return c.debt > 0; }).length + ' cliente(s)', 'purple') +
        kpi('Valor em estoque', money(stockValue), db.products.length + ' produtos', 'blue') +
      '</div>' +

      '<div class="grid two">' +
        card('Vendas dos últimos 7 dias', UI.lineChart(week), '', 'chart') +
        '<div class="grid" style="gap:13px">' +
          card('Formas de pagamento (hoje)', paymentDonut(today)) +
          card('Atenção necessária', attentionBlock(low, expiry, receivableOpen, payableOpen)) +
        '</div>' +
      '</div>' +

      '<div class="grid two mt-2">' +
        card('Movimento recente', recentSalesTable(db.sales.slice(0, 8)), '<button class="btn sm" onclick="App.go(\'sales\')">Ver todas</button>', 'receipt') +
        card('Caixa e turno', shiftPanel(), '', 'wallet') +
      '</div>' +
      '<div style="height:10px"></div>' +
      card('Produtos para repor', lowStockTable(low), low.length ? '<button class="btn sm" onclick="App.go(\'purchases\')">' + icon('truck', 13) + ' Montar compra</button>' : '', 'truck');
  };

  function paymentDonut(list) {
    var by = {};
    list.forEach(function (s) {
      s.payments.forEach(function (p) { by[p.method] = UI.round2((by[p.method] || 0) + p.amount); });
    });
    var data = Object.keys(by).map(function (k) { return { l: k, v: by[k] }; });
    if (!data.length) return empty('Nenhuma venda hoje', 'Os pagamentos aparecem aqui.');
    return UI.donutChart(data);
  }

  function attentionBlock(low, expiry, recv, pay) {
    var items = [];
    if (low.length) items.push({ icon: 'alert', tone: 'amber', text: '<b>' + low.length + '</b> produto(s) abaixo do estoque mínimo', go: 'products' });
    var venc = recv.filter(function (e) { return e.due && UI.daysBetween(UI.today(), e.due) < 0; });
    if (venc.length) items.push({ icon: 'debt', tone: 'red', text: '<b>' + venc.length + '</b>_receive(s) em atraso', go: 'payables' });
    var vencP = pay.filter(function (e) { return e.due && UI.daysBetween(UI.today(), e.due) < 0; });
    if (vencP.length) items.push({ icon: 'invoice', tone: 'red', text: '<b>' + vencP.length + '</b> conta(s) a pagar vencida(s)', go: 'payables' });
    var soon = expiry.filter(function (p) { return UI.daysBetween(UI.today(), p.expiry) >= 0; });
    if (soon.length) items.push({ icon: 'clock', tone: 'amber', text: '<b>' + soon.length + '</b> produto(s) vencendo em até 30 dias', go: 'products' });
    if (!db_hasSales()) items.push({ icon: 'target', tone: 'blue', text: 'Cadastre produtos e faça a primeira venda', go: 'products' });
    if (!items.length) return empty('Tudo em ordem', 'Nenhum alerta no momento.', 'check');
    return '<div class="list-plain">' + items.map(function (i) {
      return '<div class="list-item" data-go="' + i.go + '" style="cursor:pointer">' +
        '<span class="thumb-emoji" style="background:var(--warn-bg);color:var(--amber)">' + icon(i.icon, 16) + '</span>' +
        '<span class="grow"><small style="color:var(--text);font-size:12px">' + i.text + '</small></span>' +
        icon('arrowR', 14) + '</div>';
    }).join('') + '</div>';
  }
  function db_hasSales() { return Store.db.sales.length > 0; }

  function lowStockTable(list) {
    if (!list.length) return empty('Estoque em dia', 'Nenhum produto abaixo do mínimo.', 'check');
    return '<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Atual</th><th>Mínimo</th><th class="right">Sugestão</th><th>Situação</th></tr></thead><tbody>' +
      list.slice(0, 12).map(function (p) {
        var sug = Math.max(0, (p.min * 3) - p.stock);
        return '<tr><td><b>' + p.emoji + ' ' + esc(p.name) + '</b><br><span class="tiny muted">' + esc(p.code || '') + '</span></td>' +
          '<td><span class="badge ' + (p.stock === 0 ? 'red' : 'amber') + '">' + p.stock + '</span></td>' +
          '<td>' + p.min + '</td>' +
          '<td class="right num"><b>' + money(sug * p.cost) + '</b><br><span class="tiny muted">' + sug + ' un</span></td>' +
          '<td>' + (p.stock === 0 ? '<span class="badge red">ZERADO</span>' : '<span class="badge amber">BAIXO</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function recentSalesTable(list) {
    if (!list.length) return empty('Nenhuma venda ainda', 'Abra o caixa para começar a atender.', 'cart');
    return '<div class="table-wrap"><table><thead><tr><th>Venda</th><th>Hora</th><th>Pagamento</th><th class="right">Total</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr><td>#' + esc(s.id) + (s.status === 'Estornada' ? ' <span class="badge red">ESTORNADA</span>' : '') + '</td>' +
          '<td>' + new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '</td>' +
          '<td>' + esc(s.payments.map(function (p) { return p.method; }).join(', ')) + '</td>' +
          '<td class="right num"><b>' + money(s.total) + '</b></td>' +
          '<td class="right"><button class="btn sm" data-print="' + esc(s.id) + '">Imprimir</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function shiftPanel() {
    var s = Store.db.shift;
    if (!s) {
      return '<div class="empty"><span class="ico">' + icon('lock', 30) + '</span><b>Caixa fechado</b>' +
        'Abra o caixa para registrar vendas e controlar o gaveteiro.</div>' +
        '<button class="btn primary block mt-1" onclick="App.shiftAction()">' + icon('wallet', 15) + ' Abrir caixa</button>';
    }
    var todaySales = Store.db.sales.filter(function (x) { return x.shiftId === s.id && x.status !== 'Estornada'; });
    var cash = todaySales.reduce(function (a, x) {
      return a + x.payments.filter(function (p) { return p.method === 'Dinheiro'; }).reduce(function (b, p) { return b + p.amount; }, 0) - (x.change || 0);
    }, 0);
    return '<div class="stat-mini"><span>Operador</span><b>' + esc(s.operator) + '</b></div>' +
      '<div class="stat-mini"><span>Aberto desde</span><b>' + UI.dt(s.openedAt) + '</b></div>' +
      '<div class="stat-mini"><span>Fundo inicial</span><b>' + money(s.opening) + '</b></div>' +
      '<div class="stat-mini"><span>Vendas no turno</span><b>' + todaySales.length + ' · ' + money(totalOf(todaySales)) + '</b></div>' +
      '<div class="stat-mini"><span>Dinheiro recebido</span><b>' + money(cash) + '</b></div>' +
      '<div class="stat-mini total"><span>Esperado no gaveteiro</span><b>' + money(s.cashExpected) + '</b></div>' +
      '<div class="row mt-2"><button class="btn block" onclick="App.shiftAction()">' + icon('lock', 14) + ' Conferir e fechar caixa</button></div>';
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

    return '<div class="page-head"><div><h1>Vendas</h1><p>Histórico completo, estornos e reimpressão de cupons.</p></div>' +
      '<div class="actions"><button class="btn" onclick="App.exportSales()">' + icon('down', 14) + ' Exportar CSV</button>' +
      '<button class="btn primary" onclick="App.go(\'pdv\')">' + icon('cart', 14) + ' Nova venda</button></div></div>' +

      '<div class="grid kpis">' +
        kpi('Vendas no filtro', money(rev), list.length + ' operação(ões)', 'accent') +
        kpi('Custo dos itens', money(cost), 'base de custo atual') +
        kpi('Lucro estimado', money(UI.round2(rev - cost)), rev ? 'margem ' + UI.pct(rev ? (rev - cost) / rev * 100 : 0) : '—', 'teal') +
        kpi('Ticket médio', money(list.length ? rev / list.length : 0), 'por operação') +
        kpi('Estornadas', String(db.sales.filter(function (s) { return s.status === 'Estornada'; }).length), 'não entram na receita', 'red') +
      '</div>' +

      card('Operações', '<div class="toolbar">' +
        '<div class="search-wrap">' + icon('search', 15) + '<input class="field" id="saleQ" placeholder="Buscar por número, cliente, operador ou produto" value="' + esc(f.q) + '"></div>' +
        '<input class="field" style="width:auto" type="date" id="saleFrom" value="' + esc(f.from) + '" title="De">' +
        '<input class="field" style="width:auto" type="date" id="saleTo" value="' + esc(f.to) + '" title="Até">' +
        '<select class="field" style="width:auto" id="saleMethod"><option value="all">Todas as formas</option>' +
        db.config.paymentMethods.map(function (m) { return '<option value="' + esc(m) + '"' + (f.method === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' +
        '<button class="btn" id="saleClear">' + icon('x', 13) + ' Limpar</button>' +
        '</div>' + salesTable(list), '', 'receipt');
  };

  function salesTable(list) {
    if (!list.length) return empty('Nenhuma venda encontrada', 'Ajuste os filtros ou registre a primeira venda.', 'receipt');
    return '<div class="table-wrap"><table><thead><tr><th>Venda</th><th>Data</th><th>Operador</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="right">Total</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr data-sale="' + esc(s.id) + '" class="clickable">' +
          '<td><b>#' + esc(s.id) + '</b>' + (s.status === 'Estornada' ? ' <span class="badge red">ESTORNADA</span>' : '') + '</td>' +
          '<td class="nowrap">' + UI.dt(s.date) + '</td>' +
          '<td>' + esc(s.operator) + '</td>' +
          '<td>' + (s.customerName ? esc(s.customerName) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + s.items.length + '</td>' +
          '<td>' + s.payments.map(function (p) { return '<span class="badge">' + esc(p.method) + '</span>'; }).join(' ') + '</td>' +
          '<td class="right num"><b>' + money(s.total) + '</b></td>' +
          '<td class="right nowrap">' +
            '<button class="btn sm" data-print="' + esc(s.id) + '" title="Imprimir cupom">' + icon('print', 12) + '</button> ' +
            (s.status === 'Estornada' ? '' : '<button class="btn sm danger" data-void="' + esc(s.id) + '" title="Estornar">' + icon('refresh', 12) + '</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
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
          return '<tr><td>' + (i.emoji || '') + ' ' + esc(i.name) + '</td><td class="right num">' + i.qty + ' ' + esc(i.unit || 'un') +
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
        if ((p.name + ' ' + p.category + ' ' + (p.code || '') + ' ' + (p.barcode || '') + ' ' + (p.supplier || '')).toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var val = UI.round2(list.reduce(function (a, p) { return a + p.stock * p.cost; }, 0));

    return '<div class="page-head"><div><h1>Produtos e estoque</h1><p>Cadastro completo, custo, margem, validade e mínimos.</p></div>' +
      '<div class="actions">' +
        '<button class="btn" onclick="App.printLabels()">' + icon('tag', 14) + ' Etiquetas</button>' +
        '<button class="btn" onclick="App.importProducts()">' + icon('up', 14) + ' Importar CSV</button>' +
        '<button class="btn primary" onclick="App.editProduct()">' + icon('plus', 14) + ' Novo produto</button>' +
      '</div></div>' +

      '<div class="grid kpis">' +
        kpi('Produtos cadastrados', String(db.products.length), db.products.filter(function (p) { return p.active; }).length + ' ativos', 'accent') +
        kpi('Valor em estoque', money(val), 'ao custo', 'blue') +
        kpi('Valor de venda', money(UI.round2(list.reduce(function (a, p) { return a + p.stock * p.price; }, 0))), 'potencial bruto', 'teal') +
        kpi('Margem média', UI.pct(db.products.length ? db.products.reduce(function (a, p) { return a + Store.marginOf(p); }, 0) / db.products.length : 0), 'sobre custo', 'amber') +
        kpi('Alertas', String(db.products.filter(function (p) { return p.active && p.stock <= p.min; }).length), 'estoque baixo', 'red') +
      '</div>' +

      card('Catálogo', '<div class="toolbar">' +
        '<div class="search-wrap">' + icon('search', 15) + '<input class="field" id="prodQ" placeholder="Buscar por nome, código, categoria ou fornecedor" value="' + esc(f.q) + '"></div>' +
        '<select class="field" style="width:auto" id="prodCat"><option value="all">Todas as categorias</option>' +
        db.categories.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.cat === c.id ? ' selected' : '') + '>' + c.emoji + ' ' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<select class="field" style="width:auto" id="prodStatus">' +
        [['all', 'Todos'], ['low', 'Estoque baixo'], ['out', 'Zerados'], ['exp', 'Vencendo/vencido'], ['off', 'Inativos']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (f.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div>' + productTable(list), '', 'box');
  };

  function productTable(list) {
    if (!list.length) return empty('Nenhum produto', 'Ajuste a busca ou cadastre um produto novo.', 'box');
    return '<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Validade</th><th class="right">Custo</th><th class="right">Venda</th><th class="right">Margem</th><th>Estoque</th><th class="right">Valor</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        var cat = Store.categoryOf(p.category);
        var dExp = p.expiry ? UI.daysBetween(UI.today(), p.expiry) : null;
        var expBadge = !p.expiry ? '<span class="muted tiny">—</span>'
          : dExp < 0 ? '<span class="badge red">VENCIDO</span>'
          : dExp <= 7 ? '<span class="badge red">' + dExp + 'd</span>'
          : dExp <= 30 ? '<span class="badge amber">' + dExp + 'd</span>'
          : '<span class="badge green">' + UI.dateOnly(p.expiry) + '</span>';
        return '<tr data-prod="' + esc(p.id) + '" class="clickable' + (p.active ? '' : ' opacity:0.5') + '">' +
          '<td><b>' + p.emoji + ' ' + esc(p.name) + '</b><br><span class="tiny muted">' + esc(p.code || p.barcode || '') + '</span></td>' +
          '<td><span class="badge" style="border-color:' + cat.color + '55">' + cat.emoji + ' ' + esc(cat.name) + '</span></td>' +
          '<td>' + expBadge + '</td>' +
          '<td class="right num">' + money(p.cost) + '</td>' +
          '<td class="right num"><b>' + money(p.price) + '</b></td>' +
          '<td class="right num"><span class="badge ' + (Store.marginOf(p) >= 40 ? 'green' : Store.marginOf(p) >= 20 ? 'amber' : 'red') + '">' + UI.pct(Store.marginOf(p)) + '</span></td>' +
          '<td><span class="badge ' + (p.stock <= 0 ? 'red' : p.stock <= p.min ? 'amber' : 'green') + '">' + p.stock + '</span> <span class="tiny muted">mín ' + p.min + '</span></td>' +
          '<td class="right num">' + money(UI.round2(p.stock * p.cost)) + '</td>' +
          '<td class="right nowrap"><button class="btn sm" data-edit="' + esc(p.id) + '">' + icon('edit', 12) + '</button> ' +
          '<button class="btn sm" data-stock="' + esc(p.id) + '" title="Movimentar estoque">' + icon('layers', 12) + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function editProduct(id) {
    var db = Store.db;
    var p = id ? db.products.find(function (x) { return x.id === id; }) : null;
    var v = p || { name: '', code: '', barcode: '', category: 'mercearia', cost: '', price: '', stock: 0, min: 3, unit: 'un', emoji: '📦', supplier: '', ncm: '', cfop: '5102', csosn: '102', expiry: '', lot: '', active: true };
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
          UI.field('Código de barras (EAN)', 'barcode', v.barcode, { placeholder: '789...' }) +
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
        '<div class="modal-note" id="marginNote">A margem é calculada sobre o custo: <b>(venda − custo) ÷ custo</b>. O preço mínimo do configurador é apenas referência.</div></div>' +

        '<div class="mpane" data-pane="fiscal"><div class="form-grid">' +
          UI.field('NCM', 'ncm', v.ncm, { placeholder: '2202.10.00' }) +
          UI.field('CFOP', 'cfop', v.cfop, { type: 'select', options: [
            { value: '5102', label: '5102 — Venda interna' }, { value: '6102', label: '6102 — Venda interestadual' },
            { value: '5405', label: '5405 — ST' }, { value: '2202', label: '2202 — Devolução' }] }) +
          UI.field('CSOSN (Simples Nacional)', 'csosn', v.csosn, { type: 'select', options: [
            { value: '102', label: '102 — Tributada sem permissão de crédito' }, { value: '103', label: '103 — Isenta' },
            { value: '300', label: '300 — Imune' }, { value: '400', label: '400 — Não tributada' },
            { value: '500', label: '500 — ST cobrado anteriormente' }] }) +
          UI.field('CEST (opcional)', 'cest', v.cest || '', { placeholder: '28.0100' }) +
        '</div>' +
        '<div class="modal-note warn">' + icon('alert', 12) + ' Este sistema <b>não emite NFC-e</b>. Ele prepara os campos fiscais e gera o comprovante de venda auxiliar. Para emitir nota fiscal é necessário um servidor com certificado digital e comunicação com a SEFAZ.</div></div>' +

        '<div class="mpane" data-pane="estoque"><div class="form-grid three">' +
          UI.field('Estoque atual', 'stock', v.stock, { type: 'money', step: '0.001' }) +
          UI.field('Estoque mínimo', 'min', v.min, { type: 'number', step: '1' }) +
          UI.field('Validade', 'expiry', v.expiry, { type: 'date' }) +
          UI.field('Lote', 'lot', v.lot, { placeholder: 'L2026001' }) +
        '</div>' + UI.checkbox('Produto ativo (aparece no caixa)', 'active', v.active) + '</div>',
      confirmText: id ? 'Salvar alterações' : 'Cadastrar produto',
      onMount: function (root) {
        var cost = root.querySelector('[name=cost]'), price = root.querySelector('[name=price]'), out = root.querySelector('[name=marginOut]');
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
        var target = id ? db.products.find(function (x) { return x.id === id; }) : null;
        var dup = db.products.find(function (x) {
          return x.id !== id && d.barcode && x.barcode === String(d.barcode).trim();
        });
        if (dup) { UI.toast('Este código de barras já existe em "' + dup.name + '".', 'err'); return false; }

        var rec = {
          id: id || Store.uid('p'),
          name: d.name.trim(), code: d.code || '', barcode: d.barcode || '',
          category: d.category, emoji: d.emoji || '📦', supplier: d.supplier || '',
          unit: d.unit || 'un',
          cost: UI.round2(UI.parseNum(d.cost)), price: UI.round2(UI.parseNum(d.price)),
          stock: Number(d.stock) || 0, min: Number(d.min) || 0,
          ncm: d.ncm || '', cfop: d.cfop || '5102', csosn: d.csosn || '102', cest: d.cest || '',
          expiry: d.expiry || '', lot: d.lot || '', active: !!d.active,
          createdAt: target ? target.createdAt : new Date().toISOString()
        };
        if (!rec.code) rec.code = rec.barcode || rec.id;
        if (target) Object.assign(target, rec);
        else db.products.push(rec);
        Store.save();
        rerender();
        UI.toast('Produto "' + rec.name + '" salvo.', 'ok');
      }
    });
  }

  function stockMove(id) {
    var db = Store.db;
    var p = db.products.find(function (x) { return x.id === id; });
    if (!p) return;
    UI.modal({
      title: 'Estoque — ' + p.name, icon: 'layers', size: 'sm',
      body: '<div class="grid kpis mb-2">' +
          kpi('Atual', String(p.stock), 'em estoque', 'accent') +
          kpi('Mínimo', String(p.min), 'nível de alerta') +
          kpi('Valor', money(UI.round2(p.stock * p.cost)), 'ao custo', 'blue') +
        '</div>' +
        '<div class="form-grid">' +
          UI.field('Tipo de movimento', 'type', 'entrada', { type: 'select', options: [
            { value: 'entrada', label: 'Entrada (compra, devolução)' },
            { value: 'saida', label: 'Saída (perda, consumo, ajuste)' }] }) +
          UI.field('Quantidade', 'qty', '', { type: 'money', step: '0.001', min: 0 }) +
          UI.field('Motivo', 'reason', '', { full: true, placeholder: 'Ex.: compra NF 1234' }) +
        '</div>' +
        '<div class="modal-note">Novo estoque: <b id="stockPreview">' + p.stock + '</b> ' + esc(p.unit) + '</div>',
      confirmText: 'Registrar',
      onMount: function (root) {
        var t = root.querySelector('[name=type]'), q = root.querySelector('[name=qty]'), prev = root.querySelector('#stockPreview');
        var upd = function () {
          var n = Number(q.value) || 0;
          prev.textContent = UI.round2(t.value === 'entrada' ? p.stock + n : p.stock - n);
        };
        t.addEventListener('change', upd); q.addEventListener('input', upd);
      },
      onConfirm: function (root) {
        var d = UI.formData(root);
        var q = Number(d.qty) || 0;
        if (q <= 0) { UI.toast('Informe a quantidade.', 'err'); return false; }
        if (!d.reason || !d.reason.trim()) { UI.toast('Informe o motivo.', 'err'); return false; }
        var delta = d.type === 'entrada' ? q : -q;
        p.stock = Math.round((p.stock + delta) * 1000) / 1000;
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: new Date().toISOString(),
          type: delta > 0 ? 'Entrada' : 'Saída',
          category: delta > 0 ? 'Entrada de estoque' : 'Ajuste de estoque',
          description: p.name + ' · ' + d.reason,
          amount: UI.round2(Math.abs(delta) * p.cost), method: 'Estoque', productId: p.id, settled: true
        });
        Store.save();
        rerender();
        UI.toast('Estoque de "' + p.name + '" agora é ' + p.stock + '.', 'ok');
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
      body = card('Compras registradas', list.length ?
        '<div class="table-wrap"><table><thead><tr><th>Compra</th><th>Data</th><th>Fornecedor</th><th class="right">Itens</th><th class="right">Total</th><th>Pagamento</th><th></th></tr></thead><tbody>' +
        list.map(function (pc) {
          return '<tr><td><b>#' + esc(pc.id) + '</b></td><td class="nowrap">' + UI.dt(pc.date) + '</td>' +
            '<td>' + esc(pc.supplierName || '—') + '</td>' +
            '<td class="right num">' + pc.items.length + '</td>' +
            '<td class="right num"><b>' + money(pc.total) + '</b></td>' +
            '<td><span class="badge ' + (pc.paid ? 'green' : 'amber') + '">' + (pc.paid ? 'Pago' : 'A pagar') + '</span></td>' +
            '<td class="right"><button class="btn sm" data-viewpc="' + esc(pc.id) + '">Detalhes</button></td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('Nenhuma compra registrada', 'Monte uma compra para dar entrada no estoque.', 'truck'),
        '<button class="btn primary sm" data-newpc>' + icon('plus', 13) + ' Nova compra</button>', 'truck');
    } else if (f.tab === 'suppliers') {
      var sup = db.suppliers || [];
      body = card('Fornecedores', sup.length ?
        '<div class="table-wrap"><table><thead><tr><th>Fornecedor</th><th>Contato</th><th>Produtos</th><th class="right">Compras</th><th></th></tr></thead><tbody>' +
        sup.map(function (s) {
          var prods = db.products.filter(function (p) { return p.supplier === s.name; });
          var pc = db.purchases.filter(function (x) { return x.supplierId === s.id; });
          return '<tr><td><b>' + esc(s.name) + '</b>' + (s.cnpj ? '<br><span class="tiny muted">' + esc(s.cnpj) + '</span>' : '') + '</td>' +
            '<td>' + (s.phone ? esc(s.phone) : '—') + '</td>' +
            '<td class="num">' + prods.length + '</td>' +
            '<td class="right num">' + money(UI.round2(pc.reduce(function (a, x) { return a + x.total; }, 0))) + '</td>' +
            '<td class="right"><button class="btn sm" data-editsup="' + esc(s.id) + '">Editar</button></td></tr>';
        }).join('') + '</tbody></table></div>'
        : empty('Nenhum fornecedor', 'Cadastre os fornecedores para vincular aos produtos.', 'truck'),
        '<button class="btn primary sm" data-newsup>' + icon('plus', 13) + ' Novo fornecedor</button>', 'truck');
    } else {
      var sug = db.products.filter(function (p) { return p.active && p.stock <= p.min * 1.5; })
        .map(function (p) { return { p: p, sug: Math.max(1, (p.min * 3) - p.stock) }; })
        .sort(function (a, b) { return b.sug * b.p.cost - a.sug * a.p.cost; });
      var totalSug = UI.round2(sug.reduce(function (a, s) { return a + s.sug * s.p.cost; }, 0));
      body = card('Lista de reposição sugerida', sug.length ?
        '<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Mínimo</th><th class="right">Sugerir</th><th class="right">Custo</th><th class="right">Total</th><th></th></tr></thead><tbody>' +
        sug.map(function (s) {
          return '<tr><td><b>' + s.p.emoji + ' ' + esc(s.p.name) + '</b><br><span class="tiny muted">' + esc(s.p.supplier || 'sem fornecedor') + '</span></td>' +
            '<td><span class="badge ' + (s.p.stock <= 0 ? 'red' : 'amber') + '">' + s.p.stock + '</span></td>' +
            '<td>' + s.p.min + '</td>' +
            '<td class="right num"><b>' + s.sug + '</b> ' + esc(s.p.unit) + '</td>' +
            '<td class="right num">' + money(s.p.cost) + '</td>' +
            '<td class="right num"><b>' + money(UI.round2(s.sug * s.p.cost)) + '</b></td>' +
            '<td class="right"><label class="check"><input type="checkbox" class="pc-pick" value="' + esc(s.p.id) + '" data-sug="' + s.sug + '" data-cost="' + s.p.cost + '"></label></td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="5">Total sugerido</td><td class="right num">' + money(totalSug) + '</td><td></td></tr></tfoot></table></div>' +
        '<div class="row mt-2"><button class="btn primary" data-makeorder>' + icon('cart', 14) + ' Montar compra com selecionados</button>' +
        '<button class="btn" data-selectall>Selecionar todos</button></div>'
        : empty('Estoque em dia', 'Nenhuma reposição sugerida no momento.', 'check'),
        '', 'truck');
    }

    return '<div class="page-head"><div><h1>Compras e fornecedores</h1><p>Entrada de estoque, custo de compra e lista de reposição.</p></div></div>' +
      '<div class="subtabs">' +
        '<button data-ptab="list" class="' + (f.tab === 'list' ? 'active' : '') + '">' + icon('receipt', 14) + ' Compras</button>' +
        '<button data-ptab="suppliers" class="' + (f.tab === 'suppliers' ? 'active' : '') + '">' + icon('truck', 14) + ' Fornecedores</button>' +
        '<button data-ptab="sugestao" class="' + (f.tab === 'sugestao' ? 'active' : '') + '">' + icon('target', 14) + ' Lista de reposição</button>' +
      '</div>' + body;
  };

  function newPurchase(items, supplierId) {
    var db = Store.db;
    var pick = items || [];
    if (!pick.length) { UI.toast('Selecione ao menos um produto.', 'warn'); return; }

    function renderList() {
      return '<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="right">Qtd</th><th class="right">Custo</th><th class="right">Total</th><th></th></tr></thead><tbody>' +
        pick.map(function (i, idx) {
          var p = db.products.find(function (x) { return x.id === i.id; });
          return '<tr><td><b>' + p.emoji + ' ' + esc(p.name) + '</b><br><span class="tiny muted">Estoque ' + p.stock + ' · venda ' + money(p.price) + '</span></td>' +
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
        '<div id="pcItems">' + renderList() + '</div>' +
        '<div class="modal-note">Ao confirmar, o estoque é atualizado e o custo de cada produto é substituído pelo preço de compra informado.</div>',
      confirmText: 'Registrar compra',
      onMount: function (root, close) {
        var box = root.querySelector('#pcItems');
        function refresh() { box.innerHTML = renderList(); }
        box.addEventListener('input', function (e) {
          var q = e.target.dataset.pq, c = e.target.dataset.pc;
          if (q != null) pick[Number(q)].qty = Number(e.target.value) || 0;
          if (c != null) pick[Number(c)].cost = UI.round2(UI.parseNum(e.target.value));
          root.querySelector('#pcTotal').textContent = money(pickTotal());
        });
        box.addEventListener('click', function (e) {
          var d = e.target.closest('[data-pdel]');
          if (d) { pick.splice(Number(d.dataset.pdel), 1); if (!pick.length) { close(); return; } refresh(); }
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
          // entrada de estoque + custo
          pick.forEach(function (i) {
            var p = db.products.find(function (x) { return x.id === i.id; });
            if (!p) return;
            p.stock = Math.round((p.stock + i.qty) * 1000) / 1000;
            if (i.cost > 0) p.cost = i.cost;
            if (sup) p.supplier = sup.name;
          });
          db.entries.unshift({
            id: String(Store.nextId('entry')), date: pc.date,
            type: paid ? 'Saída' : 'A pagar',
            category: 'Compra de mercadoria',
            description: 'Compra ' + (sup ? sup.name : '') + (d.invoiceNo ? ' · NF ' + d.invoiceNo : ''),
            amount: pc.total, method: d.payMethod, source: pc.id,
            due: d.due || null, settled: paid
          });
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
        Store.save(); rerender();
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

    return '<div class="page-head"><div><h1>Clientes e crediário</h1><p>Cadastro, limites de fiado, recebimento e histórico.</p></div>' +
      '<div class="actions"><button class="btn" onclick="App.exportCustomers()">' + icon('down', 14) + ' Exportar</button>' +
      '<button class="btn primary" onclick="App.editCustomer()">' + icon('plus', 14) + ' Novo cliente</button></div></div>' +

      '<div class="grid kpis">' +
        kpi('Clientes', String(db.customers.length), db.customers.filter(function (c) { return c.debt > 0; }).length + ' com saldo', 'accent') +
        kpi('Total a receber', money(debt), 'fiado em aberto', 'purple') +
        kpi('Ticket médio', money(db.customers.length ? db.sales.filter(function (s) { return s.customerId; }).reduce(function (a, s) { return a + s.total; }, 0) / Math.max(1, db.customers.length) : 0), 'por cliente') +
        kpi('Limite concedido', money(UI.round2(db.customers.reduce(function (a, c) { return a + (Number(c.debtLimit) || 0); }, 0))), 'soma dos limites', 'blue') +
      '</div>' +

      card('Cadastro', '<div class="toolbar">' +
        '<div class="search-wrap">' + icon('search', 15) + '<input class="field" id="custQ" placeholder="Buscar nome, telefone ou CPF" value="' + esc(f.q) + '"></div>' +
        '<div class="btn-group"><button data-cf="all" class="' + (f.only === 'all' ? 'active' : '') + '">Todos</button>' +
        '<button data-cf="debt" class="' + (f.only === 'debt' ? 'active' : '') + '">Com fiado</button></div></div>' +
        customerTable(list), '', 'users');
  };

  function customerTable(list) {
    if (!list.length) return empty('Nenhum cliente', 'Cadastre clientes para vender no crediário e Emitir recibos.', 'users');
    return '<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Contato</th><th>CPF</th><th>Limite</th><th>Disponível</th><th class="right">Em aberto</th><th>Fidelidade</th><th></th></tr></thead><tbody>' +
      list.map(function (c) {
        var lim = Number(c.debtLimit) || 0;
        var disp = lim > 0 ? Math.max(0, lim - (Number(c.debt) || 0)) : Infinity;
        return '<tr data-cust="' + esc(c.id) + '" class="clickable">' +
          '<td><b>' + esc(c.name) + '</b>' + (c.address ? '<br><span class="tiny muted">' + esc(c.address) + '</span>' : '') + '</td>' +
          '<td>' + (c.phone ? esc(c.phone) : '—') + '</td>' +
          '<td class="tiny">' + (c.cpf ? esc(c.cpf) : '<span class="muted">sem CPF</span>') + '</td>' +
          '<td>' + (lim > 0 ? money(lim) : '<span class="muted tiny">sem limite</span>') + '</td>' +
          '<td>' + (lim > 0 ? '<span class="badge ' + (disp <= 0 ? 'red' : disp < lim * 0.2 ? 'amber' : 'green') + '">' + money(disp) + '</span>' : '—') + '</td>' +
          '<td class="right num"><b style="color:' + (c.debt > 0 ? 'var(--amber)' : 'var(--text-3)') + '">' + money(c.debt) + '</b></td>' +
          '<td>' + (Store.db.loyalty && Store.db.loyalty.enabled ? '<span class="badge purple">' + (c.points || 0) + ' pts</span>' : '—') + '</td>' +
          '<td class="right nowrap">' +
            (c.debt > 0 ? '<button class="btn sm primary" data-recv="' + esc(c.id) + '">Receber</button> ' : '') +
            '<button class="btn sm" data-cec="' + esc(c.id) + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>';
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
        Store.save(); rerender();
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

    return '<div class="page-head"><div><h1>Financeiro</h1><p>Fluxo de caixa, despesas, recebimentos e crediário.</p></div>' +
      '<div class="actions">' +
        '<button class="btn" onclick="App.newEntry(\'Saída\')">' + icon('down', 14) + ' Despesa</button>' +
        '<button class="btn" onclick="App.newEntry(\'Entrada\')">' + icon('up', 14) + ' Recebimento</button>' +
        '<button class="btn primary" onclick="App.go(\'payables\')">' + icon('invoice', 14) + ' Contas a pagar</button>' +
      '</div></div>' +

      '<div class="grid kpis">' +
        kpi('Entradas', money(ins), 'no período', 'green') +
        kpi('Saídas', money(outs), 'no período', 'red') +
        kpi('Saldo', money(UI.round2(ins - outs)), ins - outs >= 0 ? 'positivo' : 'negativo', ins - outs >= 0 ? 'teal' : 'red') +
        kpi('A receber', money(recv), 'em aberto', 'purple') +
        kpi('A pagar', money(pay), 'em aberto', 'amber') +
      '</div>' +

      '<div class="grid two mb-2">' +
        card('Fluxo dos últimos 14 dias', UI.lineChart(flow, { height: 180 }), '', 'chart') +
        card('Maiores despesas por categoria', catData.length ? UI.barChart(catData) : empty('Sem despesas no período', '', 'wallet'), '', 'percent') +
      '</div>' +

      card('Lançamentos', '<div class="toolbar">' +
        '<div class="search-wrap">' + icon('search', 15) + '<input class="field" id="finQ" placeholder="Buscar descrição ou categoria" value="' + esc(f.q) + '"></div>' +
        '<select class="field" style="width:auto" id="finType"><option value="all">Todos</option>' +
        ['Entrada', 'Saída', 'A receber', 'A pagar'].map(function (t) { return '<option' + (f.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<select class="field" style="width:auto" id="finPeriod">' +
        [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (f.period === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<button class="btn" id="finExport">' + icon('down', 13) + ' CSV</button></div>' +
        entryTable(all), '', 'wallet');
  };

  function entryTable(list) {
    if (!list.length) return empty('Nenhum lançamento', 'As vendas e movimentações aparecem aqui.', 'wallet');
    return '<div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Forma</th><th>Vencimento</th><th class="right">Valor</th><th></th></tr></thead><tbody>' +
      list.slice(0, 300).map(function (e) {
        var overdue = (e.type === 'A pagar' || e.type === 'A receber') && !e.settled && e.due && UI.daysBetween(UI.today(), e.due) < 0;
        var tone = e.type === 'Entrada' ? 'green' : e.type === 'Saída' ? 'red' : e.type === 'A receber' ? 'purple' : 'amber';
        return '<tr><td class="nowrap">' + UI.dt(e.date) + '</td>' +
          '<td><span class="badge ' + tone + '">' + esc(e.type) + '</span></td>' +
          '<td>' + esc(e.category) + '</td>' +
          '<td>' + esc(e.description) + (e.method === 'Estoque' ? ' <span class="badge gray">estoque</span>' : '') + '</td>' +
          '<td>' + esc(e.method || '—') + '</td>' +
          '<td class="tiny">' + (e.due ? (overdue ? '<span class="badge red">vencido</span> ' : '') + UI.dateOnly(e.due) : '—') + '</td>' +
          '<td class="right num"><b style="color:' + (e.type === 'Saída' ? 'var(--red)' : e.type === 'Entrada' ? 'var(--accent-3)' : 'var(--text)') + '">' +
            (e.type === 'Saída' ? '− ' : '+ ') + money(e.amount) + '</b></td>' +
          '<td class="right">' + ((e.type === 'A pagar' || e.type === 'A receber') && !e.settled ?
            '<button class="btn sm" data-settle="' + esc(e.id) + '">Baixar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
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

    return '<div class="page-head"><div><h1>Contas a pagar e receber</h1><p>Compromissos, vencimentos e baixa de títulos.</p></div>' +
      '<div class="actions"><button class="btn" onclick="App.newEntry(\'' + (isPay ? 'Saída' : 'Entrada') + '\')">' +
        icon('plus', 14) + (isPay ? ' Nova conta a pagar' : ' Novo recebimento') + '</button></div></div>' +

      '<div class="grid kpis">' +
        kpi(isPay ? 'Total a pagar' : 'Total a receber', money(total), list.length + ' título(s)', isPay ? 'amber' : 'purple') +
        kpi('Vencidos', money(overdue), 'atrasados', 'red') +
        kpi('Vencem em 7 dias', money(soon), 'atenção', 'amber') +
        kpi('Quitados', String(db.entries.filter(function (e) { return e.settled && (e.type === 'A pagar' || e.type === 'A receber'); }).length), 'histórico', 'green') +
      '</div>' +

      '<div class="subtabs">' +
        '<button data-atab="pagar" class="' + (isPay ? 'active' : '') + '">' + icon('invoice', 14) + ' A pagar</button>' +
        '<button data-atab="receber" class="' + (!isPay ? 'active' : '') + '">' + icon('debt', 14) + ' A receber</button>' +
      '</div>' +

      card(isPay ? 'Contas a pagar' : 'Contas a receber', list.length ?
        '<div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Situação</th><th class="right">Valor</th><th></th></tr></thead><tbody>' +
        list.map(function (e) {
          var d = e.due ? UI.daysBetween(UI.today(), e.due) : null;
          var sit = d === null ? '<span class="badge gray">sem data</span>'
            : d < 0 ? '<span class="badge red">vencido ' + Math.abs(d) + 'd</span>'
            : d === 0 ? '<span class="badge amber">vence hoje</span>'
            : d <= 7 ? '<span class="badge amber">faltam ' + d + 'd</span>'
            : '<span class="badge green">faltam ' + d + 'd</span>';
          return '<tr><td class="nowrap">' + (e.due ? UI.dateOnly(e.due) : '—') + '</td>' +
            '<td><b>' + esc(e.description) + '</b></td>' +
            '<td>' + esc(e.category) + '</td><td>' + esc(e.method || '—') + '</td>' +
            '<td>' + sit + '</td>' +
            '<td class="right num"><b>' + money(e.amount) + '</b></td>' +
            '<td class="right"><button class="btn sm primary" data-settle="' + esc(e.id) + '">Quitar</button></td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="5">Total</td><td class="right num">' + money(total) + '</td><td></td></tr></tfoot></table></div>'
        : empty(isPay ? 'Nenhuma conta a pagar' : 'Nenhum título a receber', isPay ? 'Registre compras e despesas pendentes.' : 'O crediário aparece aqui quando há venda a prazo.', isPay ? 'invoice' : 'debt'),
        '', isPay ? 'invoice' : 'debt');
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

    return '<div class="page-head"><div><h1>Relatórios</h1><p>Indicadores calculados a partir das vendas, estoque e lançamentos reais.</p></div>' +
      '<div class="actions"><button class="btn" onclick="App.printDRE()">' + icon('print', 14) + ' Imprimir DRE</button>' +
      '<button class="btn primary" onclick="UI.downloadBackup()">' + icon('save', 14) + ' Backup</button></div></div>' +

      '<div class="toolbar"><div class="btn-group">' +
        [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']].map(function (o) {
          return '<button data-rp="' + o[0] + '" class="' + (f.period === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div>' +

      '<div class="grid kpis">' +
        kpi('Receita', money(rev), sales.length + ' vendas', 'accent') +
        kpi('Custo dos produtos', money(cost), 'CMV', 'red') +
        kpi('Lucro bruto', money(UI.round2(rev - cost)), rev ? 'margem ' + UI.pct(rev ? (rev - cost) / rev * 100 : 0) : '—', 'teal') +
        kpi('Ticket médio', money(sales.length ? rev / sales.length : 0), 'por venda') +
        kpi('Itens vendidos', String(UI.round2(sales.reduce(function (a, s) { return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0))), 'unidades', 'blue') +
      '</div>' +

      '<div class="grid two mb-2">' +
        card('Receita por dia', dailySeries(days || 30), '', 'chart') +
        card('Vendas por categoria', catData.length ? UI.donutChart(catData) : empty('Sem vendas no período', '', 'chart'), '', 'percent') +
      '</div>' +

      '<div class="grid two mb-2">' +
        card('Mais vendidos (unidades)', topQty.length ? UI.barChart(topQty.map(function (p) { return { l: (p.emoji || '') + ' ' + p.name, v: p.qty }; }), { fmt: 'count' }) : empty('—', '', 'box'), '', 'box') +
        card('Mais lucrativos', topProfit.length ? UI.barChart(topProfit.map(function (p) { return { l: (p.emoji || '') + ' ' + p.name, v: p.profit }; })) : empty('—', '', 'percent'), '', 'percent') +
      '</div>' +

      '<div class="grid two mb-2">' +
        card('Horários de maior movimento', hourData.length ? UI.barChart(hourData) : empty('—', '', 'clock'), '', 'clock') +
        card('Desempenho por operador', Object.keys(byOp).length ? UI.barChart(Object.keys(byOp).map(function (k) { return { l: k, v: byOp[k] }; })) : empty('—', '', 'user'), '', 'user') +
      '</div>' +

      '<div class="grid two mb-2">' +
        card('Curva ABC (giro)', abcRows.length ?
          '<div class="modal-note" style="margin:0 0 11px">Classe <b>A</b>: até 80% do faturamento · <b>B</b>: até 95% · <b>C</b>: cauda longa. Monitore o estoque das classes A com mais cuidado.</div>' +
          '<div class="table-wrap"><table><thead><tr><th>Produto</th><th class="right">Un.</th><th class="right">Receita</th><th class="right">Part.</th><th class="right">Acum.</th><th>Classe</th></tr></thead><tbody>' +
          abcRows.slice(0, 14).map(function (r) {
            return '<tr><td><b>' + esc(r.name) + '</b></td><td class="right num">' + r.qty + '</td>' +
              '<td class="right num">' + money(r.revenue) + '</td><td class="right num">' + UI.pct(r.share) + '</td>' +
              '<td class="right num">' + UI.pct(r.cum) + '</td>' +
              '<td><span class="badge ' + (r.cls === 'A' ? 'green' : r.cls === 'B' ? 'amber' : 'gray') + '">' + r.cls + '</span></td></tr>';
          }).join('') + '</tbody></table></div>'
          : empty('—', '', 'target'), '', 'target') +
        card('DRE simplificada do período',
          '<div class="stat-mini"><span>Receita bruta de vendas</span><b>' + money(rev) + '</b></div>' +
          '<div class="stat-mini"><span>(−) Custo dos produtos (CMV)</span><b style="color:var(--red)">' + money(cost) + '</b></div>' +
          '<div class="stat-mini total"><span>= Lucro bruto</span><b style="color:var(--accent-3)">' + money(UI.round2(rev - cost)) + '</b></div>' +
          '<div class="stat-mini"><span>(−) Despesas operacional</span><b style="color:var(--red)">' + money(outs) + '</b></div>' +
          '<div class="stat-mini"><span>(−) Estimativa de impostos (6%)</span><b style="color:var(--red)">' + money(taxes) + '</b></div>' +
          '<div class="stat-mini total"><span>= Resultado estimado</span><b style="color:' + (rev - cost - outs - taxes >= 0 ? 'var(--accent-3)' : 'var(--red)') + '">' + money(UI.round2(rev - cost - outs - taxes)) + '</b></div>' +
          '<div class="modal-note warn" style="margin-top:11px">' + icon('info', 12) + ' Impostos aqui são uma <b>estimativa fixa de 6%</b>. O Simples Nacional varia de 4% a 13% conforme a faixa de faturamento. Consulte o contador.</div>',
          '', 'invoice') +
      '</div>' +

      card('Valor de estoque por categoria', catData.length ? UI.barChart(db.categories.map(function (c) {
        var v = UI.round2(db.products.filter(function (p) { return p.category === c.id; }).reduce(function (a, p) { return a + p.stock * p.cost; }, 0));
        return { l: c.emoji + ' ' + c.name, v: v, c: c.color };
      }).filter(function (x) { return x.v > 0; })) : empty('—', '', 'box'), '', 'layers');
  };

  function dailySeries(days) {
    var n = Math.min(days || 30, 90);
    return UI.lineChart(lastDays(n).map(function (d) { return { l: d.label, v: totalOf(salesOfDay(d.key)) }; }));
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
    return '<div class="page-head"><div><h1>Configurações</h1><p>Loja, operação, fiscal, tema, usuários e dados.</p></div></div>' +
      '<div class="grid two">' +
        '<div class="grid" style="gap:13px;align-content:start">' +
          card('Identificação da loja', cfgForm('loja'), '', 'store') +
          card('Caixa e operação', cfgForm('operacao'), '', 'wallet') +
          card('Fiscal e NFC-e', cfgForm('fiscal'), '', 'file') +
          card('Impressão e tema', cfgForm('tema'), '', 'print') +
        '</div>' +
        '<div class="grid" style="gap:13px;align-content:start">' +
          card('Formas de pagamento', paymentConfig(), '', 'card') +
          card('Categorias de produto', categoryConfig(), '', 'tag') +
          card('Usuários e acessos', usersBlock(), '', 'users') +
          card('Dados e segurança', dataBlock(), '', 'save') +
        '</div>' +
      '</div>';
  };

  function cfgForm(which) {
    var cfg = Store.db.config;
    if (which === 'loja') {
      return '<div class="form-grid">' +
        UI.field('Nome da loja', 'storeName', cfg.storeName, { full: true }) +
        UI.field('CNPJ', 'cnpj', cfg.cnpj) + UI.field('Inscrição estadual', 'ie', cfg.ie) +
        UI.field('Endereço', 'address', cfg.address, { full: true }) +
        UI.field('Telefone', 'phone', cfg.phone) +
        UI.field('Regime tributário', 'taxRegime', cfg.taxRegime, { type: 'select', options: ['Simples Nacional', 'Simples Nacional - excesso de sublimite', 'Regime Normal (Lucro Real/Presumido)'] }) +
        '</div><button class="btn primary mt-2" data-save="loja">' + icon('save', 14) + ' Salvar loja</button>';
    }
    if (which === 'operacao') {
      return '<div class="form-grid">' +
        UI.field('Operador padrão', 'operator', cfg.operator) +
        UI.field('Desconto máximo por venda (R$)', 'maxDiscount', cfg.maxDiscount, { type: 'money', step: '0.01', min: 0 }) +
        UI.field('Fundo de caixa sugerido (R$)', 'cashOpening', cfg.cashOpening, { type: 'money', step: '0.01', min: 0 }) +
        '</div>' +
        '<div class="mt-1">' +
          UI.checkbox('Permitir venda com estoque negativo', 'allowNegativeStock', cfg.allowNegativeStock, 'Evita bloquear a venda quando o caixa está atrasado na contagem.') +
          UI.checkbox('Exigir CPF do cliente para crediário', 'requireCustomerOnCredit', cfg.requireCustomerOnCredit) +
        '</div>' +
        '<button class="btn primary mt-2" data-save="operacao">' + icon('save', 14) + ' Salvar operação</button>';
    }
    if (which === 'fiscal') {
      return '<div class="form-grid">' +
        UI.field('Chave Pix (CPF/CNPJ, e-mail, telefone ou aleatória)', 'pixKey', cfg.pix.pixKey, { full: true, placeholder: 'ex.: 11999998888 ou loja@email.com' }) +
        UI.field('Cidade do recebedor', 'pixCity', cfg.pix.city, { placeholder: 'SAO PAULO' }) +
        '</div>' +
        '<div class="modal-note warn mt-1">' + icon('alert', 12) +
        ' <b>Este sistema não emite NFC-e.</b> Sem servidor, certificado digital e comunicação com a SEFAZ não é possível emitir nota fiscal válida. O que o PDV faz: prepara NCM/CFOP/CSOSN no cadastro, gera QR Pix de cobrança e imprime o comprovante auxiliar de venda (CANFE).</div>' +
        '<button class="btn primary mt-2" data-save="fiscal">' + icon('save', 14) + ' Salvar fiscal</button>';
    }
    return '<div class="form-grid">' +
      UI.field('Mensagem no cupom', 'receiptFooter', cfg.receiptFooter, { full: true }) +
      UI.field('Largura do cupom', 'printWidth', cfg.printWidth, { type: 'select', options: [{ value: 80, label: '80 mm (padrão)' }, { value: 58, label: '58 mm (bobina pequena)' }] }) +
      UI.field('Tema da interface', 'theme', cfg.theme, { type: 'select', options: [{ value: 'dark', label: 'Escuro (padrão)' }, { value: 'light', label: 'Claro' }] }) +
      '</div>' +
      '<div class="modal-note mt-1">Atalho: <span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">D</span> alterna o tema a qualquer momento.</div>' +
      '<button class="btn primary mt-2" data-save="tema">' + icon('save', 14) + ' Salvar aparência</button>';
  }

  function paymentConfig() {
    var cfg = Store.db.config;
    var all = ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Crediário', 'Vale', 'Boleto'];
    return '<div class="row tight mb-2">' + all.map(function (m) {
      var on = cfg.paymentMethods.indexOf(m) > -1;
      return '<button class="btn sm ' + (on ? 'primary' : 'ghost') + '" data-pay="' + esc(m) + '">' + (on ? icon('check', 12) + ' ' : '+ ') + esc(m) + '</button>';
    }).join('') + '</div>' +
    '<div class="modal-note">As formas marcadas aparecem no painel de pagamento da frente de caixa, na ordem em que foram ativadas.</div>';
  }

  function categoryConfig() {
    var db = Store.db;
    return '<div class="list-plain">' + db.categories.map(function (c) {
      var n = db.products.filter(function (p) { return p.category === c.id; }).length;
      return '<div class="list-item"><span class="thumb-emoji" style="background:' + c.color + '22">' + c.emoji + '</span>' +
        '<span class="grow"><b>' + esc(c.name) + '</b><small>' + n + ' produto(s)</small></span>' +
        '<button class="mini-btn danger" data-delcat="' + esc(c.id) + '" ' + (n ? 'disabled title="Há produtos nesta categoria"' : '') + '>' + icon('trash', 13) + '</button></div>';
    }).join('') + '</div>' +
    '<button class="btn block mt-2" data-newcat>' + icon('plus', 14) + ' Nova categoria</button>';
  }

  function usersBlock() {
    var db = Store.db;
    var me = Store.currentUser();
    return db.auth.users.map(function (u) {
      return '<div class="list-item"><span class="avatar">' + esc(u.name.slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="grow"><b>' + esc(u.name) + '</b><small>' + esc(u.username) + ' · ' + roleLabel(u) + (u.id === (me || {}).id ? ' · você' : '') + '</small></span>' +
        (u.id === (me || {}).id ? '' : '<button class="mini-btn danger" data-deluser="' + esc(u.id) + '">' + icon('trash', 13) + '</button>') +
        '</div>';
    }).join('') +
    '<button class="btn block mt-2" data-newuser>' + icon('plus', 14) + ' Novo usuário</button>' +
    '<div class="modal-note" style="margin-top:11px">Perfis: <b>Administrador</b> (tudo) · <b>Gerente</b> (tudo menos usuários) · <b>Caixa</b> (só venda e clientes) · <b>Estoquista</b> (produtos e estoque).</div>';
  }

  function dataBlock() {
    return '<div class="grid" style="gap:7px">' +
      '<button class="btn block" onclick="UI.downloadBackup()">' + icon('down', 14) + ' Baixar backup (JSON)</button>' +
      '<button class="btn block" data-import>' + icon('up', 14) + ' Restaurar backup</button>' +
      '<button class="btn block" data-exportcsv>' + icon('down', 14) + ' Exportar produtos (CSV)</button>' +
      '<div class="divider" style="margin:6px 0"></div>' +
      '<button class="btn block" data-seedenullish>' + icon('refresh', 14) + ' Recarregar catálogo de exemplo</button>' +
      '<button class="btn block danger" data-reset>' + icon('trash', 14) + ' Apagar todos os dados</button>' +
    '</div>' +
    '<div class="modal-note mt-1">Os dados ficam salvos <b>somente neste navegador</b>. Limpar o histórico do navegador apaga tudo. Faça backup regularly.</div>';
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
        Store.db.auth.users.push({
          id: Store.uid('u'), name: d.name.trim(), username: un,
          passHash: Store.hashPass(String(d.pass)), role: d.role, active: true,
          createdAt: new Date().toISOString()
        });
        Store.save(); rerender();
        UI.toast('Usuário criado.', 'ok');
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
      view.innerHTML = html;
      try { PDV.bind(view); }
      catch (e2) {
        if (console) console.error('[app] falha ao ligar o PDV:', e2);
        renderCrash(shell, 'pdv', e2);
        renderRail();
        return;
      }
    } else {
      view.innerHTML = html;
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
      var du = e.target.closest('[data-deluser]');
      if (du) { deleteUser(du.dataset.deluser); return; }

      if (e.target.closest('[data-import]')) { doImport(); return; }
      if (e.target.closest('[data-exportcsv]')) { exportProductsCSV(); return; }
      if (e.target.closest('[data-seedenullish]')) { reloadSeed(); return; }
      if (e.target.closest('[data-reset]')) { resetAll(); return; }
    });
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
          return '<tr><td>' + (p ? p.emoji + ' ' + esc(p.name) : 'produto removido') + '</td>' +
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
    } else if (which === 'tema') {
      cfg.receiptFooter = read('receiptFooter');
      cfg.printWidth = Number(read('printWidth')) || 80;
      cfg.theme = read('theme');
      applyTheme(cfg.theme);
    }
    Store.save();
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
    var rows = [['Código', 'Código de barras', 'Nome', 'Categoria', 'Emoji', 'Custo', 'Preço', 'Margem %', 'Estoque', 'Mínimo', 'Unidade', 'Validade', 'Fornecedor', 'NCM', 'CFOP', 'CSOSN']];
    Store.db.products.forEach(function (p) {
      rows.push([p.code || '', p.barcode || '', p.name, p.category, p.emoji,
        UI.num(p.cost), UI.num(p.price), Store.marginOf(p), p.stock, p.min,
        p.unit || 'un', p.expiry || '', p.supplier || '', p.ncm || '', p.cfop || '', p.csosn || '']);
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

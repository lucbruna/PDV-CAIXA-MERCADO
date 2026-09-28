/* ==========================================================================
   pdv.js — Frente de caixa reformulada.
   Layout de 3 zonas: busca/leitor (topo) · catálogo (esq) · venda+pagamento (dir).
   Tudo com teclado: F1-F12, atalhos de pagamento, keypad de dinheiro.
   ========================================================================== */
(function (global) {
  'use strict';

  var UI = global.UI, Store = global.Store, $ = UI.$, esc = UI.esc, money = UI.money, icon = UI.icon;

  /* ---------------- estado da venda corrente ---------------- */
  var cart = [];
  var payMethod = 'Dinheiro';
  var payParts = [];
  var payInput = '';
  var saleDiscount = 0;
  var customerId = '';
  var cartDiscountMode = 'value';
  var activeCategory = 'all';
  var productQuery = '';
  var weightTarget = null;

  function reset() {
    cart = []; payParts = []; payInput = '';
    saleDiscount = 0; customerId = ''; weightTarget = null;
  }

  /* ---------------- cálculos ---------------- */
  function subtotal() {
    return UI.round2(cart.reduce(function (s, i) { return s + i.price * i.qty; }, 0));
  }
  function discountValue() {
    var max = Number(Store.db.config.maxDiscount) || 0;
    var d = Math.min(Math.max(0, Number(saleDiscount) || 0), max);
    return UI.round2(Math.min(d, subtotal()));
  }
  function total() { return UI.round2(subtotal() - discountValue()); }
  function itemCount() { return cart.reduce(function (s, i) { return s + i.qty; }, 0); }
  function paidSoFar() {
    return UI.round2(payParts.reduce(function (a, p) { return a + p.amount; }, 0) + UI.parseNum(payInput));
  }
  function remaining() { return UI.round2(Math.max(0, total() - payParts.reduce(function (a, p) { return a + p.amount; }, 0))); }
  function changeDue() {
    var cash = payParts.filter(function (p) { return p.method === 'Dinheiro'; })
      .reduce(function (a, p) { return a + p.amount; }, 0) + UI.parseNum(payInput);
    return UI.round2(Math.max(0, cash - total()));
  }
  function creditPart() {
    return UI.round2(payParts.filter(function (p) { return p.method === 'Crediário'; })
      .reduce(function (a, p) { return a + p.amount; }, 0));
  }

  /* ---------------- catálogo ---------------- */
  function visibleProducts() {
    var db = Store.db;
    var q = productQuery.trim().toLowerCase();
    return db.products.filter(function (p) {
      if (!p.active) return false;
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!q) return true;
      return p.name.toLowerCase().indexOf(q) > -1 ||
             String(p.barcode || '').indexOf(q) > -1 ||
             String(p.code || '').indexOf(q) > -1;
    });
  }

  function prodCard(p) {
    var out = p.stock <= 0;
    var low = !out && p.stock <= p.min;
    var stockTxt = out ? 'Esgotado' : (p.unit === 'kg' ? p.stock + ' kg' : p.stock + ' un');
    return '<button class="v-prod" data-add="' + esc(p.id) + '"' + (out ? ' disabled' : '') + ' title="' + esc(p.name) + '">' +
      '<span class="v-prod-info">' +
        '<span class="v-prod-name"><span class="v-prod-emoji">' + p.emoji + '</span>' + esc(p.name) + '</span>' +
        '<span class="v-prod-meta v-mono">' + esc(p.code || p.barcode || '') + '<em>·</em>' + esc(Store.categoryOf(p.category).name) + '</span>' +
      '</span>' +
      '<span class="v-prod-right">' +
        '<span class="v-prod-price v-mono">' + money(p.price) + (p.unit === 'kg' ? '<em style="font-size:9px;font-weight:400;opacity:.55">/kg</em>' : '') + '</span>' +
        '<span class="v-prod-add">' + icon('Plus', 11) + ' Adicionar</span>' +
        '<span class="v-prod-stock ' + (out ? 'out' : low ? 'low' : '') + '">' + stockTxt + '</span>' +
      '</span>' +
    '</button>';
  }

  function visibleProducts() {
    var db = Store.db;
    var q = productQuery.trim().toLowerCase();
    return db.products.filter(function (p) {
      if (!p.active) return false;
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!q) return true;
      return p.name.toLowerCase().indexOf(q) > -1 ||
             String(p.barcode || '').indexOf(q) > -1 ||
             String(p.code || '').indexOf(q) > -1;
    });
  }

  function renderCatalog() {
    var g = $('#pdvGrid');
    if (!g) return;
    var list = visibleProducts();
    if (!list.length) {
      g.innerHTML = '<div class="empty"><span class="ico">' + icon('Search', 30) + '</span>' +
        '<b>Nenhum produto encontrado</b>Ajuste a busca ou cadastre o produto.</div>';
      return;
    }
    g.innerHTML = list.map(prodCard).join('');
  }

  function renderCategories() {
    var bar = $('#pdvCats');
    if (!bar) return;
    var db = Store.db;
    var counts = {};
    db.products.forEach(function (p) {
      if (!p.active) return;
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    var nActive = db.products.filter(function (p) { return p.active; }).length;
    bar.innerHTML =
      '<button class="v-cat' + (activeCategory === 'all' ? ' active' : '') + '" data-cat="all">Todos <b>' + nActive + '</b></button>' +
      db.categories.filter(function (c) { return counts[c.id]; }).map(function (c) {
        return '<button class="v-cat' + (activeCategory === c.id ? ' active' : '') + '" data-cat="' + esc(c.id) + '">' +
          c.emoji + ' ' + esc(c.name) + ' <b>' + counts[c.id] + '</b></button>';
      }).join('');
  }

  /* ---------------- carrinho ---------------- */
  function cartLineHTML(item) {
    var p = Store.db.products.find(function (x) { return x.id === item.id; });
    var flagged = p && item.qty > p.stock;
    return '<div class="v-line' + (flagged ? ' flagged' : '') + '">' +
      '<span class="v-line-main">' +
        '<span class="v-line-ico">' + icon('ShoppingBag', 15) + '</span>' +
        '<span style="min-width:0">' +
          '<span class="v-line-name">' + esc(item.name) + '</span>' +
          '<span class="v-line-sub v-mono">' + money(item.price) + ' / ' + esc(item.unit || 'un') + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="v-line-right">' +
        '<span class="v-qty">' +
          '<button data-q="-1" data-id="' + esc(item.id) + '" aria-label="Diminuir">' + icon('Minus', 12) + '</button>' +
          '<input type="text" inputmode="decimal" value="' + item.qty + '" data-qty="' + esc(item.id) + '" aria-label="Quantidade">' +
          '<button data-q="1" data-id="' + esc(item.id) + '" aria-label="Aumentar">' + icon('Plus', 12) + '</button>' +
        '</span>' +
        '<span class="v-line-total v-mono">' + money(item.price * item.qty) + '</span>' +
        '<span style="display:flex;flex-direction:column;gap:2px">' +
          (p && p.unit === 'kg' ? '<button class="v-del" data-weight="' + esc(item.id) + '" title="Definir peso (kg)">' + icon('Scale', 13) + '</button>' : '') +
          '<button class="v-del" data-del="' + esc(item.id) + '" title="Remover">' + icon('Trash2', 14) + '</button>' +
        '</span>' +
        '<span class="v-tools">' +
          '<button data-price="' + esc(item.id) + '" title="Alterar preço">' + icon('Tag', 12) + '</button>' +
        '</span>' +
      '</span>' +
    '</div>';
  }

  function renderCart() {
    var box = $('#cartList');
    if (!box) return;
    if (!cart.length) {
      box.innerHTML = '<div class="empty"><span class="ico">' + icon('ShoppingCart', 28) + '</span>' +
        '<b>Carrinho vazio</b>Escaneie um código ou toque em "Adicionar".</div>';
    } else {
      box.innerHTML = cart.map(cartLineHTML).join('');
    }
    var c = $('#cartCount');
    if (c) c.textContent = itemCount() + (itemCount() === 1 ? ' item' : ' itens') + ' no carrinho';
    var num = $('#saleNum');
    if (num) num.textContent = '#' + (Store.nextId ? nextPreview() : '—');
  }

  function nextPreview() {
    var db = Store.db;
    var max = db.sales.reduce(function (m, s) { return Math.max(m, parseInt(s.id, 10) || 0); }, 0);
    return (db.counters ? db.counters.sale : max + 1);
  }

  function renderTotals() {
    var t = $('#totalsBox');
    if (!t) return;
    var sub = subtotal(), d = discountValue();
    t.innerHTML =
      '<div class="v-sum-row"><span>Subtotal</span><b class="v-mono">' + money(sub) + '</b></div>' +
      (d > 0 ? '<div class="v-sum-row disc"><span>Desconto</span><b class="v-mono">− ' + money(d) + '</b></div>' : '') +
      (creditPart() > 0 ? '<div class="v-sum-row"><span>Crediário</span><b class="v-mono">' + money(creditPart()) + '</b></div>' : '') +
      '<div class="v-sum-row"><span>Itens</span><b class="v-mono">' + itemCount() + '</b></div>' +
      '<div class="v-total">' +
        '<div class="v-total-lbl">Total a pagar</div>' +
        '<div class="v-total-val v-mono">' + money(total()) + '</div>' +
      '</div>';

    var dInput = $('#discInput');
    if (dInput && document.activeElement !== dInput) dInput.value = d > 0 ? String(d).replace('.', ',') : '';
  }

  var PAY_ICON = { 'Dinheiro': 'Banknote', 'Pix': 'QrCode', 'Débito': 'CreditCard', 'Crédito': 'CreditCard', 'Crediário': 'HandCoins' };

  function renderPayment() {
    var methods = Store.db.config.paymentMethods || [];
    var box = $('#payMethods');
    if (box) {
      box.innerHTML = methods.map(function (m) {
        return '<button class="v-pay-m' + (payMethod === m ? ' active' : '') + '" data-method="' + esc(m) + '">' +
          icon(PAY_ICON[m] || 'CreditCard', 14) + '<span>' + esc(m) + '</span></button>';
      }).join('');
    }

    var cash = $('#quickCash');
    if (cash) {
      var t = total();
      var opts = [];
      [5, 10, 20, 50, 100].forEach(function (v) { if (t > 0 && v >= Math.ceil(t)) opts.push(v); });
      if (t > 0) opts.push(Math.ceil(t));
      opts = opts.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 5);
      cash.innerHTML = opts.map(function (v) {
        return '<button data-cash="' + v + '">' + money(v) + '</button>';
      }).join('');
      cash.style.display = payMethod === 'Dinheiro' && t > 0 ? 'grid' : 'none';
    }

    var inp = $('#payInput');
    if (inp) {
      inp.placeholder = payMethod === 'Dinheiro' ? 'Valor recebido' : money(remaining());
      if (document.activeElement !== inp) inp.value = payInput;
    }

    var parts = $('#payParts');
    if (parts) {
      parts.innerHTML = payParts.map(function (p, i) {
        return '<div class="v-part"><span>' + esc(p.method) + '</span>' +
          '<span style="display:flex;align-items:center;gap:6px"><b class="v-mono">' + money(p.amount) + '</b>' +
          '<button class="v-del" data-rmpay="' + i + '">' + icon('X', 12) + '</button></span></div>';
      }).join('');
    }

    renderChange();

    var btn = $('#btnCheckout');
    if (btn) btn.disabled = !canCheckout();

    var zone = $('#btnCheckout');
    if (zone) zone.classList.toggle('off', !cart.length);
  }

  function renderChange() {
    var box = $('#changeBox');
    if (!box) return;
    var t = total();
    var ready = t > 0 && payParts.reduce(function (a, p) { return a + p.amount; }, 0) + UI.parseNum(payInput) >= t - 0.001;
    box.className = 'v-change' + (ready ? ' ready' : '');
    box.innerHTML = '<span>' + (ready ? 'Troco' : 'Falta receber') + '</span>' +
      '<b class="v-mono">' + money(ready ? changeDue() : remaining()) + '</b>';
  }

  function renderCustomer() {
    var name = $('#custName'), hint = $('#custHint'), btn = $('#btnCustomer');
    if (!btn) return;
    var c = Store.db.customers.find(function (x) { return x.id === customerId; });
    if (c) {
      name.textContent = c.name;
      hint.textContent = c.debt ? 'deve ' + money(c.debt) : 'sem débitos';
      btn.classList.add('has');
    } else {
      name.textContent = 'Cliente';
      hint.textContent = 'Identificar';
      btn.classList.remove('has');
    }
  }

  function pickCustomer() {
    var db = Store.db;
    if (!db.customers.length) {
      return UI.confirm({
        title: 'Nenhum cliente cadastrado', kind: 'info',
        message: 'Cadastre clientes para lançar vendas no crediário e emitir recibos.',
        confirmText: 'Cadastrar cliente'
      }).then(function (ok) { if (ok) global.App.editCustomer(); });
    }
    UI.modal({
      title: 'Identificar cliente', icon: 'UserPlus', size: 'sm',
      body: '<div class="list-plain">' +
        '<button class="list-item" data-pick="" style="text-align:left">' +
          '<span class="thumb-emoji">' + icon('X', 15) + '</span>' +
          '<span class="grow"><b>Consumidor não identificado</b><small>Venda avulsa, sem crediário</small></span></button>' +
        db.customers.map(function (c) {
          var lim = Number(c.debtLimit) || 0;
          return '<button class="list-item" data-pick="' + esc(c.id) + '" style="text-align:left">' +
            '<span class="avatar">' + esc(c.name.slice(0, 2).toUpperCase()) + '</span>' +
            '<span class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.phone || 'sem telefone') +
            (c.debt ? ' · deve ' + money(c.debt) : '') + (lim ? ' · limite ' + money(lim) : '') + '</small></span></button>';
        }).join('') + '</div>',
      onMount: function (root, close) {
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pick]');
          if (!b) return;
          customerId = b.dataset.pick;
          renderCustomer(); renderTotals(); renderPayment();
          close();
        });
      }
    });
  }

  function renderAll() {
    renderCategories();
    renderCatalog();
    renderCart();
    renderTotals();
    renderCustomer();
    renderPayment();
  }

  /* ---------------- ações do carrinho ---------------- */
  function addProduct(id, silent) {
    var p = Store.db.products.find(function (x) { return x.id === id; });
    if (!p) return false;
    if (p.stock <= 0 && !Store.db.config.allowNegativeStock) {
      UI.toast('"' + p.name + '" está sem estoque.', 'warn');
      return false;
    }
    var line = cart.find(function (i) { return i.id === id; });
    if (line) {
      if (line.qty >= p.stock && !Store.db.config.allowNegativeStock) {
        UI.toast('Quantidade máxima disponível: ' + p.stock, 'warn');
        return false;
      }
      line.qty += 1;
    } else {
      cart.push({ id: p.id, name: p.name, emoji: p.emoji, price: Number(p.price), cost: Number(p.cost), qty: 1, unit: p.unit });
    }
    productQuery = '';
    var inp = $('#pdvSearch');
    if (inp) inp.value = '';
    if (!silent) renderCatalog();
    renderCart(); renderTotals(); renderPayment();
    var badge = $('#cartBadge');
    if (badge) { badge.textContent = itemCount(); badge.style.display = 'grid'; }
    return true;
  }

  function setQty(id, q) {
    var line = cart.find(function (i) { return i.id === id; });
    if (!line) return;
    var p = Store.db.products.find(function (x) { return x.id === id; });
    var max = p && !Store.db.config.allowNegativeStock ? p.stock : 9999;
    q = Math.min(Math.max(0, Number(q) || 0), max);
    if (q < 1) { removeLine(id); return; }
    line.qty = UI.round2(q);
    renderCart(); renderTotals(); renderPayment();
  }

  function removeLine(id) {
    cart = cart.filter(function (i) { return i.id !== id; });
    renderCart(); renderTotals(); renderPayment();
  }

  function clearSale(ask) {
    if (!cart.length) return Promise.resolve(true);
    if (ask === false) { reset(); renderAll(); return Promise.resolve(true); }
    return UI.confirm({
      title: 'Cancelar esta venda?', kind: 'danger',
      message: 'Os ' + itemCount() + ' itens do carrinho serão descartados.',
      confirmText: 'Cancelar venda'
    }).then(function (ok) { if (ok) { reset(); renderAll(); } return ok; });
  }

  function addPayPart() {
    var amount = UI.round2(UI.parseNum(payInput));
    if (amount <= 0) { UI.toast('Informe o valor desta forma de pagamento.', 'warn'); return; }
    if (payParts.some(function (p) { return p.method === payMethod; })) {
      UI.toast('Esta forma já está na venda. Remova antes de adicionar de novo.', 'warn');
      return;
    }
    var already = payParts.reduce(function (a, p) { return a + p.amount; }, 0);
    if (payMethod !== 'Dinheiro' && already + amount > total() + 0.001) {
      UI.toast('O pagamento não pode exceder o total.', 'warn');
      return;
    }
    payParts.push({ method: payMethod, amount: amount });
    payInput = '';
    renderPayment();
  }

  function removePayPart(i) { payParts.splice(i, 1); renderPayment(); }

  /* ---------------- finalizar ---------------- */
  function finishSale() {
    var db = Store.db;
    if (!db.shift) { UI.toast('Abra o caixa para registrar vendas.', 'err'); return; }
    if (!cart.length) { UI.toast('Adicione pelo menos um produto.', 'warn'); return; }

    var parts = payParts.slice();
    var typed = UI.round2(UI.parseNum(payInput));
    if (typed > 0) parts.push({ method: payMethod, amount: typed });
    if (!parts.length) { UI.toast('Informe ao menos uma forma de pagamento.', 'warn'); return; }

    var totalV = total();
    var paid = UI.round2(parts.reduce(function (a, p) { return a + p.amount; }, 0));
    if (paid + 0.001 < totalV) { UI.toast('Falta ' + money(totalV - paid) + ' para concluir.', 'err'); return; }

    var cash = UI.round2(parts.filter(function (p) { return p.method === 'Dinheiro'; }).reduce(function (a, p) { return a + p.amount; }, 0));
    var change = UI.round2(Math.max(0, cash - totalV));
    if (cash > 0 && change > cash + 0.001) { UI.toast('O troco não pode ser maior que o dinheiro recebido.', 'err'); return; }

    var credit = UI.round2(parts.filter(function (p) { return p.method === 'Crediário'; }).reduce(function (a, p) { return a + p.amount; }, 0));
    var customer = db.customers.find(function (c) { return c.id === customerId; });
    if (credit > 0) {
      if (!customer) { UI.toast('Selecione o cliente para lançar no crediário.', 'err'); return; }
      if (db.config.requireCustomerOnCredit && !customer.cpf) {
        UI.toast('Cadastre o CPF do cliente para lançar em crediário.', 'warn');
        return;
      }
      var lim = Number(customer.debtLimit) || 0;
      if (lim > 0 && (Number(customer.debt) || 0) + credit > lim) {
        UI.toast('O crediário excede o limite de ' + money(lim) + ' deste cliente.', 'err');
        return;
      }
    }

    // validação de estoque
    if (!db.config.allowNegativeStock) {
      var over = cart.find(function (i) {
        var p = db.products.find(function (x) { return x.id === i.id; });
        return p && i.qty > p.stock;
      });
      if (over) { UI.toast('"' + over.name + '" ficou acima do estoque disponível.', 'err'); return; }
    }

    var summary = parts.map(function (p) { return p.method + ': ' + money(p.amount); }).join(' · ');
    UI.confirm({
      title: 'Confirmar venda de ' + money(totalV) + '?',
      kind: 'ok', confirmText: 'Concluir venda',
      html: '<strong>' + esc(summary) + '</strong>' +
        (change > 0 ? '<br>Troco: <strong>' + money(change) + '</strong>' : '') +
        (credit > 0 ? '<br>Crediário: <strong>' + money(credit) + '</strong> para ' + esc(customer.name) : '') +
        (customer && !credit ? '<br>Cliente: <strong>' + esc(customer.name) + '</strong>' : '') +
        '<br><span class="muted small">Confirme o recebimento de Pix e cartões no aplicativo da instituição.</span>'
    }).then(function (ok) {
      if (!ok) return;
      commitSale(parts, totalV, change, credit, customer);
    });
  }

  function commitSale(parts, totalV, change, credit, customer) {
    var db = Store.db;
    var u = Store.currentUser();

    /* === Guarda de gravação =============================================
       Tudo que a venda altera, capturado ANTES de qualquer mutação (o
       nextId() da linha seguinte já incrementa contador): estoque, caderno
       do cliente, lista de vendas, turno, lançamentos financeiros e
       contadores. Se o armazenamento estiver cheio, o commit chama este
       desfaz e a venda não chega a ser vista pelo caixa — que é a única
       forma de ele não entregar troco por um registro que vai evaporar. */
    var antes = {
      vendas: db.sales.length,
      lancamentos: db.entries.length,
      contadorVenda: db.counters.sale,
      contadorLanc: db.counters.entry,
      turnoVendas: db.shift ? db.shift.sales.length : 0,
      esperadoCaixa: db.shift ? db.shift.cashExpected : 0,
      estoque: [],
      divida: customer ? Number(customer.debt) || 0 : 0,
      pontos: customer ? Number(customer.points) || 0 : 0
    };
    cart.forEach(function (i) {
      var p = db.products.find(function (x) { return x.id === i.id; });
      if (p) antes.estoque.push({ p: p, stock: p.stock });
    });

    var sale = {
      id: String(Store.nextId('sale')),
      date: new Date().toISOString(),
      operator: u ? u.name : db.operator,
      operatorId: u ? u.id : null,
      shiftId: db.shift ? db.shift.id : null,
      subtotal: subtotal(),
      discount: discountValue(),
      total: totalV,
      change: change,
      customerId: customerId || null,
      customerName: customer ? customer.name : null,
      items: cart.map(function (i) { return { id: i.id, name: i.name, emoji: i.emoji, price: i.price, cost: i.cost, qty: i.qty, unit: i.unit }; }),
      payments: parts.map(function (p) { return { method: p.method, amount: p.amount }; }),
      status: 'Concluída'
    };

    // baixa de estoque
    sale.items.forEach(function (i) {
      var p = db.products.find(function (x) { return x.id === i.id; });
      if (p) p.stock = Math.round((p.stock - i.qty) * 1000) / 1000;
    });

    // crediário
    if (credit > 0 && customer) {
      customer.debt = UI.round2((Number(customer.debt) || 0) + credit);
      if (db.loyalty && db.loyalty.enabled) {
        customer.points = (Number(customer.points) || 0) + Math.floor(totalV * (db.loyalty.pointsPerReal || 1));
      }
    }

    db.sales.unshift(sale);
    if (db.shift) {
      db.shift.sales.push(sale.id);
      var cashIn = UI.round2(parts.filter(function (p) { return p.method === 'Dinheiro'; }).reduce(function (a, p) { return a + p.amount; }, 0) - change);
      db.shift.cashExpected = UI.round2(db.shift.cashExpected + cashIn);
    }

    // lançamentos financeiros
    parts.forEach(function (p) {
      if (p.method === 'Crediário') {
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: sale.date, type: 'A receber',
          category: 'Venda a prazo', description: 'Venda #' + sale.id + ' · ' + (customer ? customer.name : ''),
          amount: p.amount, method: 'Crediário', source: sale.id,
          // customerId é obrigatório: sem ele o recebimento não consegue baixar o título
          customerId: customer ? customer.id : null, settled: false
        });
      } else {
        var received = UI.round2(p.amount - (p.method === 'Dinheiro' ? change : 0));
        if (received > 0) {
          db.entries.unshift({
            id: String(Store.nextId('entry')), date: sale.date, type: 'Entrada',
            category: 'Venda PDV', description: 'Venda #' + sale.id,
            amount: received, method: p.method, source: sale.id, settled: p.method === 'Dinheiro'
          });
        }
      }
    });

    /* === Gravação crítica: grava inteira ou não acontece === */
    var gravou = Store.commit(function () {
      db.sales.length = antes.vendas;
      db.entries.length = antes.lancamentos;
      db.counters.sale = antes.contadorVenda;
      db.counters.entry = antes.contadorLanc;
      if (db.shift) {
        db.shift.sales.length = antes.turnoVendas;
        db.shift.cashExpected = antes.esperadoCaixa;
      }
      antes.estoque.forEach(function (r) { r.p.stock = r.stock; });
      if (customer) { customer.debt = antes.divida; customer.points = antes.pontos; }
    });

    /* Falhou: o carrinho fica intacto de propósito. O caixa precisa
       conseguir repetir a venda depois de liberar espaço, e precisa entender
       por que parou — senão ele anota o número do cupom numa folha e segue. */
    if (!gravou) {
      var uso = Store.usage();
      var cheio = uso
        ? 'O armazenamento do navegador acabou (' + uso.mb + ' MB de ' + uso.limiteMB + ' MB)'
        : 'O armazenamento do navegador acabou';
      renderAll();
      // kind 'danger' (e nao 'err'): 'err' cai no icone azul de 'info' e no
      // botao azul -- verde/azul aqui daria a impressao de que pode seguir.
      // O texto vai em html porque confirm() ignora 'message' quando html existe.
      UI.confirm({
        title: 'Venda NÃO registrada', kind: 'danger', confirmText: 'Entendi',
        html: '<strong style="color:#b42318">' + cheio + '.</strong><br>' +
          'Por segurança a venda foi desfeita: ' +
          'nenhum estoque foi baixado, nada foi lançado no caixa e o cupom não foi impresso.' +
          '<div class="modal-note" style="margin-top:12px">O que fazer agora:</div>' +
          '<ol style="margin:8px 0 0;padding-left:20px;font-size:12.5px;line-height:1.65">' +
          '<li>Faça backup em <strong>Ajustes → Backup</strong> e guarde o arquivo.</li>' +
          '<li>Libere espaço arquivando vendas antigas ou apagando dados de demonstração.</li>' +
          '<li>Os produtos continuam no carrinho: clique em <strong>Finalizar</strong> de novo.</li>' +
          '</ol>'
      });
      return;
    }

    var id = sale.id;
    reset();
    renderAll();
    focusSearch();

    UI.toast('Venda #' + id + ' concluída · ' + money(totalV) + (change > 0 ? ' · troco ' + money(change) : ''), 'ok', 4200);

    UI.confirm({
      title: 'Venda #' + id + ' registrada', kind: 'ok', confirmText: 'Imprimir cupom',
      html: 'Total <strong>' + money(totalV) + '</strong> · ' + sale.items.length + ' itens' +
        (change > 0 ? '<br>Troco <strong>' + money(change) + '</strong>' : '')
    }).then(function (print) { if (print) printReceipt(id); });
  }

  /* ---------------- estorno ---------------- */
  function voidSale(id) {
    var db = Store.db;
    var s = db.sales.find(function (x) { return x.id === id; });
    if (!s || s.status === 'Estornada') { UI.toast('Esta venda já foi estornada.', 'warn'); return; }
    if (!db.shift) { UI.toast('Abra o caixa para registrar a devolução.', 'err'); return; }

    UI.promptText({
      title: 'Estornar venda #' + id, icon: 'refresh', label: 'Motivo do estorno',
      placeholder: 'Ex.: produto devolvido', required: true, confirmText: 'Confirmar estorno', danger: true,
      hint: 'O estoque volta e o financeiro é revertido automaticamente.'
    }).then(function (reason) {
      if (!reason) return;
      return UI.confirm({
        title: 'Confirmar devolução de ' + money(s.total) + '?',
        kind: 'danger', confirmText: 'Estornar venda',
        message: 'Motivo: "' + reason + '". Os produtos voltam ao estoque e o valor é revertido.'
      });
    }).then(function (ok) {
      if (!ok) return;
      var customer = db.customers.find(function (c) { return c.id === s.customerId; });
      var credit = s.payments.filter(function (p) { return p.method === 'Crediário'; })
        .reduce(function (a, p) { return a + p.amount; }, 0);
      if (customer && credit > 0) customer.debt = UI.round2(Math.max(0, (Number(customer.debt) || 0) - credit));

      var refundCash = 0;
      s.payments.forEach(function (p) {
        if (p.method === 'Crediário') return;
        var amt = UI.round2(p.amount - (p.method === 'Dinheiro' ? s.change : 0));
        if (amt <= 0) return;
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: new Date().toISOString(), type: 'Saída',
          category: 'Estorno de venda', description: 'Venda #' + id + ' · ' + reason,
          amount: amt, method: p.method, source: id, settled: p.method === 'Dinheiro'
        });
        if (p.method === 'Dinheiro') refundCash += amt;
      });

      s.items.forEach(function (i) {
        var p = db.products.find(function (x) { return x.id === i.id; });
        if (p) p.stock = Math.round((p.stock + i.qty) * 1000) / 1000;
      });
      s.status = 'Estornada';
      s.refundReason = reason;
      s.voidedAt = new Date().toISOString();
      if (refundCash && db.shift) db.shift.cashExpected = UI.round2(db.shift.cashExpected - refundCash);
      if (db.shift) {
        db.shift.sales = db.shift.sales.filter(function (x) { return x !== id; });
      }
      Store.save();
      global.App.rerender();
      UI.toast('Venda #' + id + ' estornada. Devolva ' + money(UI.round2(s.total - credit)) + ' ao cliente.', 'ok', 4500);
    });
  }

  /* ---------------- movimentações de caixa ---------------- */
  function cashMovement(type) {
    var db = Store.db;
    if (!db.shift) { UI.toast('Abra o caixa para movimentar o gaveteiro.', 'err'); return; }
    UI.modal({
      title: type === 'Entrada' ? 'Suprimento de caixa' : 'Sangria de caixa',
      icon: type === 'Entrada' ? 'up' : 'down', size: 'sm',
      body: '<div class="form-grid">' +
        UI.field('Valor (R$)', 'amount', '', { type: 'money', step: '0.01', min: 0, placeholder: '0,00' }) +
        UI.field('Motivo', 'reason', '', { placeholder: type === 'Entrada' ? 'Ex.: troco inicial' : 'Ex.: pagar fornecedor', full: true }) +
        '</div>' +
        (type === 'Entrada' ? '' : '<div class="modal-note warn">Sangrias são registradas na auditoria do turno. Informe o motivo com clareza.</div>'),
      confirmText: type === 'Entrada' ? 'Registrar suprimento' : 'Registrar sangria',
      danger: type === 'Saída',
      onConfirm: function (root) {
        var d = UI.formData(root);
        var amount = UI.round2(UI.parseNum(d.amount));
        if (amount <= 0) { UI.toast('Informe um valor válido.', 'err'); return false; }
        if (!d.reason || !d.reason.trim()) { UI.toast('Informe o motivo.', 'err'); return false; }
        db.shift.cashExpected = UI.round2(db.shift.cashExpected + (type === 'Entrada' ? amount : -amount));
        db.shift.movements.push({ date: new Date().toISOString(), type: type, amount: amount, reason: d.reason });
        db.entries.unshift({
          id: String(Store.nextId('entry')), date: new Date().toISOString(), type: type,
          category: type === 'Entrada' ? 'Suprimento' : 'Sangria', description: d.reason,
          amount: amount, method: 'Dinheiro', settled: true
        });
        Store.save();
        global.App.rerender();
        UI.toast((type === 'Entrada' ? 'Suprimento' : 'Sangria') + ' de ' + money(amount) + ' registrada.', 'ok');
      }
    });
  }

  /* ---------------- venda suspensa ---------------- */
  function holdSale() {
    if (!cart.length) { UI.toast('Adicione itens antes de suspender a venda.', 'warn'); return; }
    Store.db.heldSales.unshift({
      id: Store.uid('h'), date: new Date().toISOString(),
      items: cart.map(function (i) { return Object.assign({}, i); }),
      customerId: customerId, total: total(), note: ''
    });
    Store.save();
    reset();
    renderAll();
    UI.toast('Venda suspensa (' + Store.db.heldSales.length + ' pendente[s]).', 'ok');
  }

  function resumeSale() {
    var held = Store.db.heldSales;
    if (!held.length) { UI.toast('Nenhuma venda suspensa.', 'info'); return; }
    UI.modal({
      title: 'Vendas suspensas', icon: 'layers', size: 'sm',
      body: held.map(function (h) {
        return '<div class="list-item"><span class="thumb-emoji">' + icon('cart2', 17) + '</span>' +
          '<span class="grow"><b>' + h.items.length + ' itens · ' + money(h.total) + '</b>' +
          '<small>' + UI.dt(h.date) + '</small></span>' +
          '<button class="btn sm primary" data-resume="' + esc(h.id) + '">Retomar</button>' +
          '<button class="btn sm danger" data-drop="' + esc(h.id) + '">Descartar</button></div>';
      }).join(''),
      onMount: function (root) {
        root.addEventListener('click', function (e) {
          var r = e.target.closest('[data-resume]'), dr = e.target.closest('[data-drop]');
          if (r) {
            var h = Store.db.heldSales.find(function (x) { return x.id === r.dataset.resume; });
            if (h) {
              cart = h.items.map(function (i) { return Object.assign({}, i); });
              customerId = h.customerId;
              Store.db.heldSales = Store.db.heldSales.filter(function (x) { return x.id !== h.id; });
              Store.save(); renderAll(); focusSearch();
              root.closest('.overlay').querySelector('[data-close]').click();
            }
          }
          if (dr) {
            Store.db.heldSales = Store.db.heldSales.filter(function (x) { return x.id !== dr.dataset.drop; });
            Store.save(); global.App.rerender();
          }
        });
      }
    });
  }

  /* ---------------- balança / peso ---------------- */
  function setWeight(id) {
    var line = cart.find(function (i) { return i.id === id; });
    if (!line) return;
    UI.promptText({
      title: 'Peso de "' + line.name + '"', icon: 'weight',
      label: 'Peso em kg', type: 'number', value: line.qty, step: '0.001',
      hint: 'Preço: ' + money(line.price) + '/kg', confirmText: 'Aplicar peso'
    }).then(function (v) {
      if (v === null) return;
      var kg = UI.round2(UI.parseNum(v));
      if (kg <= 0) { UI.toast('Peso inválido.', 'err'); return; }
      setQty(id, kg);
    });
  }

  function setLinePrice(id) {
    var line = cart.find(function (i) { return i.id === id; });
    if (!line) return;
    if (!Store.can('pdv_admin') && !Store.currentUser()) return;
    UI.promptText({
      title: 'Alterar preço', icon: 'tag', label: 'Novo preço unitário (R$)',
      type: 'number', value: line.price, step: '0.01', confirmText: 'Aplicar'
    }).then(function (v) {
      if (v === null) return;
      var np = UI.round2(UI.parseNum(v));
      if (np <= 0) { UI.toast('Preço inválido.', 'err'); return; }
      line.price = np;
      line.cost = line.cost || 0;
      renderCart(); renderTotals(); renderPayment();
      UI.toast('Preço alterado para ' + money(np) + ' nesta venda.', 'warn');
    });
  }

  /* ---------------- leitor de código de barras ---------------- */
  function focusSearch() {
    var i = $('#pdvSearch');
    if (i) { i.focus(); i.select(); }
  }

  function handleScan(raw) {
    var code = String(raw || '').trim();
    if (!code) return;
    var p = Store.productByBarcode(code);
    if (p) { addProduct(p.id); return; }
    // código de balança: 2 primeiros dígitos = PLU
    if (code.length >= 5) {
      var plu = parseInt(code.slice(0, 2), 10);
      var byIndex = Store.db.products.filter(function (x) { return x.active; })[plu - 1];
      if (byIndex) { addProduct(byIndex.id); return; }
    }
    // busca por nome exato
    var lower = code.toLowerCase();
    var byName = Store.db.products.find(function (x) { return x.name.toLowerCase() === lower; });
    if (byName) { addProduct(byName.id); return; }
    UI.toast('Código ' + code + ' não cadastrado.', 'warn');
  }

  /* ---------------- cupom ---------------- */
  function printReceipt(id) {
    var db = Store.db;
    var s = db.sales.find(function (x) { return x.id === id; });
    if (!s) return;
    var c = db.config;
    var narrow = Number(c.printWidth) <= 58;

    var items = s.items.map(function (i) {
      return '<tr><td>' + esc(i.name) + '<br><span style="color:#555">' + i.qty + ' x ' + UI.num(i.price) + '</span></td>' +
        '<td>' + UI.num(UI.round2(i.price * i.qty)) + '</td></tr>';
    }).join('');

    var pays = s.payments.map(function (p) {
      var received = UI.round2(p.amount - (p.method === 'Dinheiro' ? s.change : 0));
      return '<div class="r"><span>' + esc(p.method) + '</span><span>' + UI.num(p.amount) + '</span></div>' +
        (p.method === 'Dinheiro' && s.change > 0 ? '<div class="r"><span>Troco</span><span>' + UI.num(s.change) + '</span></div>' : '');
    }).join('');

    var html =
      '<div class="c b">' + esc(c.storeName) + '</div>' +
      (narrow ? '' : '<div class="c">' + esc(c.address || '') + '</div>') +
      '<div class="c">CNPJ: ' + esc(c.cnpj) + ' · ' + esc(c.phone || '') + '</div>' +
      '<div class="sep"></div>' +
      '<div class="c b">COMPROVANTE DE VENDA</div>' +
      '<div class="c">Cód. venda: ' + esc(s.id) + '</div>' +
      '<div class="c">' + UI.dt(s.date) + '</div>' +
      '<div class="c">Operador: ' + esc(s.operator) + '</div>' +
      (s.customerName ? '<div class="c">Cliente: ' + esc(s.customerName) + '</div>' : '') +
      '<div class="sep"></div>' +
      '<table><tbody>' + items + '</tbody></table>' +
      '<div class="sep"></div>' +
      '<div class="r"><span>Subtotal</span><span>' + UI.num(s.subtotal) + '</span></div>' +
      (s.discount > 0 ? '<div class="r"><span>Desconto</span><span>' + UI.num(s.discount) + '</span></div>' : '') +
      '<div class="r b"><span>TOTAL</span><span>' + UI.num(s.total) + '</span></div>' +
      '<div class="sep"></div>' + pays +
      (db.config.taxRegime ? '<div class="sep"></div><div class="c" style="font-size:9px">' + esc(db.config.taxRegime) + ' · Documento auxiliar de venda</div>' : '') +
      '<div class="c" style="margin-top:6px">' + esc(c.receiptFooter) + '</div>';

    UI.printHTML(html, Number(c.printWidth) || 80);
  }

  /* ---------------- peso Inicial ---------------- */
  function requireShift() {
    var db = Store.db;
    if (db.shift) return Promise.resolve(true);
    return new Promise(function (resolve) {
      UI.modal({
        title: 'Abrir caixa', icon: 'wallet', size: 'sm',
        body: '<div class="modal-note">O fundo de caixa é a quantia inicial no gaveteiro. Ela será usada como base na conferência do fechamento.</div>' +
          '<div class="form-grid mt-2">' +
          UI.field('Fundo inicial (R$)', 'opening', db.config.cashOpening || 0, { type: 'money', step: '0.01', min: 0, full: true }) +
          '</div>',
        confirmText: 'Abrir caixa',
        onConfirm: function (root) {
          var d = UI.formData(root);
          Store.openShift(UI.parseNum(d.opening));
          global.App.rerender();
          global.App.refreshShiftUI();
          UI.toast('Caixa aberto com fundo de ' + money(UI.parseNum(d.opening)) + '.', 'ok');
          resolve(true);
        },
        onClose: function () { resolve(false); }
      });
    });
  }

  /* ---------------- render principal (layout Vértice: 3 colunas) ---------------- */
  function render() {
    var db = Store.db;
    var methods = db.config.paymentMethods || [];
    if (methods.indexOf(payMethod) === -1) payMethod = methods[0] || 'Dinheiro';
    var active = db.products.filter(function (p) { return p.active; }).length;

    return '' +
    /* ================= COLUNA 1 · CATÁLOGO ================= */
    '<div class="v-col">' +
      '<div class="v-col-head">' +
        '<span class="v-label">Catálogo</span>' +
        '<span class="v-count v-mono">' + active + ' produtos</span>' +
      '</div>' +
      '<div class="v-search">' +
        '<div class="v-search-box">' + icon('Search', 15) +
          '<input id="pdvSearch" placeholder="Código de barras ou nome" autocomplete="off" autofocus>' +
          '<span class="v-kbd">F2</span>' +
        '</div>' +
      '</div>' +
      '<div class="v-cats" id="pdvCats"></div>' +
      '<div class="v-list" id="pdvGrid"></div>' +
    '</div>' +

    /* ================= COLUNA 2 · VENDA EM ANDAMENTO ================= */
    '<div class="v-col">' +
      '<div class="v-col-head">' +
        '<div><div class="v-label">Venda em andamento</div>' +
        '<div class="v-label-sub" id="cartCount">0 itens no carrinho</div></div>' +
        '<span class="v-count v-mono" id="saleNum">#—</span>' +
      '</div>' +
      '<div class="v-cart" id="cartList"></div>' +
      '<div class="v-hotkeys">' +
        '<button class="v-hk" id="btnClear" title="Cancelar venda">' + icon('Tag', 13) + '<b>F1</b> Desconto</button>' +
        '<button class="v-hk" id="btnFocus" title="Focar busca">' + icon('Search', 13) + '<b>F2</b> Busca</button>' +
        '<button class="v-hk" id="btnHold" title="Suspender venda">' + icon('Pause', 13) + '<b>F3</b> Suspender</button>' +
        '<button class="v-hk" id="btnCancel" title="Cancelar venda">' + icon('X', 13) + '<b>F4</b> Cancelar</button>' +
      '</div>' +
    '</div>' +

    /* ================= COLUNA 3 · RESUMO E PAGAMENTO ================= */
    '<div class="v-col">' +
      '<div class="v-pay">' +
        '<div class="v-sum-head"><span class="v-label">Resumo</span>' + icon('Package', 15, 1.6) + '</div>' +
        '<div id="totalsBox"></div>' +

        '<div class="v-disc-row">' +
          '<input id="discInput" inputmode="decimal" placeholder="Desconto R$ 0,00" title="Desconto (F1)">' +
          '<button class="v-quick" id="btnMaxDisc" style="padding:0 11px;font-size:11px">Máx</button>' +
        '</div>' +

        '<span class="v-pay-lbl">Forma de pagamento</span>' +
        '<div class="v-pays" id="payMethods"></div>' +
        '<div class="v-quick" id="quickCash" style="display:none"></div>' +

        '<div class="v-cash-row">' +
          '<input id="payInput" inputmode="decimal" placeholder="0,00">' +
          '<button id="btnAddPart" title="Adicionar forma de pagamento">' + icon('Plus', 16) + '</button>' +
        '</div>' +
        '<div class="change-box" id="changeBox"></div>' +
        '<div class="pay-parts" id="payParts"></div>' +

        '<div class="row tight" style="gap:6px;margin-top:9px">' +
          '<button class="v-hk" id="btnExact" style="flex:1">' + icon('CheckCircle', 13) + ' Pagar exato</button>' +
          '<button class="v-hk" id="btnPix" style="flex:1">' + icon('QrCode', 13) + ' Pix QR</button>' +
        '</div>' +

        '<button class="v-cust" id="btnCustomer">' +
          '<span>' + icon('UserPlus', 15) + ' <b id="custName">Cliente</b></span><em id="custHint">Identificar</em>' +
        '</button>' +

        '<button class="v-finish" id="btnCheckout" disabled>' + icon('CheckCircle', 16) + ' Finalizar venda</button>' +
        '<div class="v-finish-hint">F9 ou Enter · confirmar pagamento</div>' +
      '</div>' +
    '</div>';
  }

  /* Envolve o PDV no grid de 3 colunas + barra de atalhos, e liga o tema Vértice. */
  function renderWrapped() {
    document.body.classList.add('vertice');
    var html =
      '<div class="v-grid">' + render() + '</div>' +
      '<div class="v-bar">' +
        '<span>' + icon('Lock', 11) + ' <b>' + esc(Store.db.shift ? Store.db.shift.operator : 'Caixa fechado') + '</b></span>' +
        '<span><b>F1</b> Desconto</span><span><b>F2</b> Focar leitor</span>' +
        '<span><b>F5</b> Cliente</span><span><b>F6</b> Suspender</span>' +
        '<span><b>F7</b> Trocar método</span><span><b>F8</b> Valor recebido</span>' +
        '<span><b>F9</b> Finalizar</span><span><b>F10</b> Cupom</span><span><b>F11</b> Balança</span>' +
        (Store.db.heldSales.length
          ? '<span>' + icon('Pause', 10) + ' <b id="heldInfo">' + Store.db.heldSales.length + '</b> suspensa(s)</span>' : '') +
        '<span class="right"><span class="dot"></span> MODO CAIXA</span>' +
      '</div>';
    return html;
  }

  function unwrap() { document.body.classList.remove('vertice'); }

  /* root: o container descartável criado por App.rerender(). Os listeners ficam
     presos a ele, então são descartados no próximo render (sem acúmulo). */
  function bind(root) {
    if (!root) return;

    root.addEventListener('click', function (e) {
      var cat = e.target.closest('[data-cat]');
      if (cat) { activeCategory = cat.dataset.cat; renderCategories(); renderCatalog(); return; }

      var add = e.target.closest('[data-add]');
      if (add) { addProduct(add.dataset.add); flash(add); return; }

      var q = e.target.closest('[data-q]');
      if (q) {
        var line = cart.find(function (i) { return i.id === q.dataset.id; });
        if (line) setQty(line.id, line.qty + Number(q.dataset.q));
        return;
      }
      var del = e.target.closest('[data-del]');
      if (del) { removeLine(del.dataset.del); return; }

      var pr = e.target.closest('[data-price]');
      if (pr) { setLinePrice(pr.dataset.price); return; }

      var wt = e.target.closest('[data-weight]');
      if (wt) { setWeight(wt.dataset.weight); return; }

      var pm = e.target.closest('[data-method]');
      if (pm) { payMethod = pm.dataset.method; payInput = ''; renderPayment(); return; }

      var cash = e.target.closest('[data-cash]');
      if (cash) { payInput = String(cash.dataset.cash).replace('.', ','); renderPayment(); focusPay(); return; }

      var rm = e.target.closest('[data-rmpay]');
      if (rm) { removePayPart(Number(rm.dataset.rmpay)); return; }
    });

    root.addEventListener('input', function (e) {
      if (e.target.id === 'pdvSearch') { productQuery = e.target.value; renderCatalog(); return; }
      if (e.target.id === 'payInput') { payInput = e.target.value; renderChange(); updateCheckoutState(); return; }
      if (e.target.id === 'discInput') { saleDiscount = UI.parseNum(e.target.value); renderTotals(); renderChange(); updateCheckoutState(); return; }
    });

    root.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.qty) setQty(e.target.dataset.qty, e.target.value);
    });

    var search = $('#pdvSearch');
    if (search) {
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleScan(search.value);
          search.value = '';
          productQuery = '';
          renderCatalog();
        }
        if (e.key === 'Escape') { search.value = ''; productQuery = ''; renderCatalog(); }
        if (e.key === 'ArrowDown' || e.key === 'F3') { e.preventDefault(); focusPay(); }
      });
    }

    var payIn = $('#payInput');
    if (payIn) {
      payIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (UI.parseNum(payIn.value) > 0) { addPayPart(); focusSearch(); }
          else finishSale();
        }
        if (e.key === 'Escape') { payInput = ''; payIn.value = ''; renderChange(); focusSearch(); }
      });
    }

    var disc = $('#discInput');
    if (disc) {
      disc.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); focusSearch(); }
      });
    }

    var b = function (id, fn) { var n = $('#' + id); if (n) n.onclick = fn; };
    b('btnClear',    function () { var d = $('#discInput'); if (d) { d.focus(); d.select(); } });
    b('btnFocus',    focusSearch);
    b('btnCancel',   function () { clearSale(true); });
    b('btnHold',     holdSale);
    b('btnAddPart',  function () { addPayPart(); focusSearch(); });
    b('btnCheckout', finishSale);
    b('btnCustomer', pickCustomer);
    b('btnExact', function () {
      var rem = remaining();
      if (rem <= 0) { UI.toast('O total já está coberto.', 'info'); return; }
      payInput = String(rem).replace('.', ',');
      renderPayment();
      focusPay();
    });
    b('btnMaxDisc', function () {
      saleDiscount = Math.min(subtotal(), Number(Store.db.config.maxDiscount) || 0);
      renderTotals(); renderChange(); updateCheckoutState();
    });
    b('btnPix', function () {
      if (total() <= 0) { UI.toast('Adicione itens à venda.', 'warn'); return; }
      payMethod = 'Pix'; payInput = ''; renderPayment();
      showPixDialog();
    });
    b('btnSup',   function () { cashMovement('Entrada'); });
    b('btnSang',  function () { cashMovement('Saída'); });
    b('btnResume', resumeSale);

    renderAll();
    setTimeout(focusSearch, 40);
  }

  /* O botão de finalizar só libera quando o valor digitado + as partes já
     adicionadas cobrem o total. Sem isso, digitar o valor exato nunca liberaria. */
  function canCheckout() {
    if (!cart.length) return false;
    if (payParts.length + (UI.parseNum(payInput) > 0 ? 1 : 0) <= 0) return false;
    return paidSoFar() + 0.001 >= total();
  }

  function updateCheckoutState() {
    var btn = $('#btnCheckout');
    if (btn) btn.disabled = !canCheckout();
  }

  function flash(elm) {
    if (!elm) return;
    elm.style.transform = 'scale(.92)';
    setTimeout(function () { elm.style.transform = ''; }, 110);
  }

  function focusPay() {
    var i = $('#payInput');
    if (i) i.focus();
  }

  function showPixDialog() {
    var amount = total();
    var txid = String(Store.nextId('sale'));
    var payload = UI.pixPayload(amount, txid);
    UI.modal({
      title: 'Pix — ' + money(amount), icon: 'pix', size: 'sm', footer: false,
      body: '<div class="pix-card"><div class="pix-qr" id="pixQrBox"></div>' +
        '<div class="small muted" style="margin-bottom:8px">O cliente escaneia e paga. Confirme o crédito no app bancário antes de finalizar.</div>' +
        '<button class="btn primary block" id="btnCopyPix">' + icon('copy', 15) + ' Copiar Pix copia e cola</button></div>' +
        '<div class="modal-note">' + icon('info', 12) + ' Configure a chave Pix em <b>Configurações → Fiscal</b>. O QR é estático: serve para qualquer valor.</div>',
      onMount: function (root, close) {
        var box = root.querySelector('#pixQrBox');
        if (payload) {
          /* QR.render devolve true/false; o fallback mostra o copia-e-cola se
             algum dia o gerador falhar, para o vendedor nunca ficar sem saída. */
          var drew = global.QR && global.QR.render(box, payload, {
            tamanho: 190, escuro: '#0d1520', claro: '#ffffff'
          });
          if (!drew) {
            box.innerHTML = '<div class="pix-copy">' + esc(payload) + '</div>';
            if (global.console) console.warn('[Pix] gerador de QR indisponível; mostrando copia e cola.');
          }
        } else {
          box.innerHTML = '<div class="tiny muted" style="padding:16px">Chave Pix não configurada.<br>Vá em Configurações → Fiscal.</div>';
        }
        var cp = root.querySelector('#btnCopyPix');
        if (cp && payload) {
          cp.onclick = function () {
            UI.copyPix(payload).then(function () { UI.toast('Código Pix copiado.', 'ok'); })
              .catch(function () { UI.toast('Não foi possível copiar. Selecione o texto manualmente.', 'warn'); });
          };
        } else if (cp) { cp.disabled = true; }
      }
    });
  }

  /* ---------------- atalhos de teclado ---------------- */
  function keys(e) {
    if (!Store.currentUser()) return;
    var inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    var onPdv = location.hash.slice(1) === 'pdv' || location.hash === '' || location.hash === '#';

    // atalhos globais
    if (e.key === 'F12' || (e.key === 'F4' && e.ctrlKey)) { e.preventDefault(); global.App.go('settings'); return; }
    if (e.key === 'F2' && onPdv) { e.preventDefault(); focusSearch(); return; }

    if (!onPdv) return;

    switch (e.key) {
      case 'F1': e.preventDefault(); var d = $('#discInput'); if (d) { d.focus(); d.select(); } break;
      case 'F2': e.preventDefault(); focusSearch(); break;
      case 'F3': e.preventDefault(); holdSale(); break;
      case 'F4': e.preventDefault(); clearSale(true); break;
      case 'F5': e.preventDefault(); pickCustomer(); break;
      case 'F6': e.preventDefault(); resumeSale(); break;
      case 'F7': e.preventDefault(); cycleMethod(); break;
      case 'F8': e.preventDefault(); focusPay(); break;
      case 'F9': e.preventDefault(); finishSale(); return;
      case 'F10': e.preventDefault(); lastReceipt(); return;
      case 'F11': e.preventDefault(); quickWeight(); return;
      case 'F12': e.preventDefault(); global.App.go('settings'); return;
      case 'Escape':
        if (!inInput) clearSale(false);
        break;
    }

    // atalhos de forma de pagamento: D=Pix, C=Crédito, E=Débito, T=troco
    if (!inInput && !e.ctrlKey && !e.altKey) {
      var map = { d: 'Débito', c: 'Crédito', t: 'Dinheiro', p: 'Pix', x: 'Crediário' };
      var m = map[(e.key || '').toLowerCase()];
      var methods = Store.db.config.paymentMethods || [];
      if (m && methods.indexOf(m) > -1) { payMethod = m; payInput = ''; renderPayment(); }
    }

    // Enter no leitor quando não há texto
    if (e.key === 'Enter' && !inInput) { focusSearch(); }
  }

  function cycleMethod() {
    var methods = Store.db.config.paymentMethods || [];
    var i = methods.indexOf(payMethod);
    payMethod = methods[(i + 1) % methods.length];
    payInput = '';
    renderPayment();
  }

  function quickWeight() {
    var last = cart[cart.length - 1];
    if (!last) { UI.toast('Adicione um produto primeiro.', 'info'); return; }
    setWeight(last.id);
  }

  function lastReceipt() {
    var s = Store.db.sales[0];
    if (!s) { UI.toast('Nenhuma venda registrada ainda.', 'info'); return; }
    printReceipt(s.id);
  }

  /* ---------------- API pública ---------------- */
  global.PDV = {
    render: renderWrapped, bind: bind, keys: keys, focusSearch: focusSearch, leave: unwrap,
    addProduct: addProduct, setQty: setQty, removeLine: removeLine,
    clearSale: clearSale, finishSale: finishSale, voidSale: voidSale,
    cashMovement: cashMovement, printReceipt: printReceipt,
    requireShift: requireShift, holdSale: holdSale, resumeSale: resumeSale,
    setWeight: setWeight, handleScan: handleScan,
    subtotal: subtotal, total: total, get cart() { return cart; }
  };
})(window);

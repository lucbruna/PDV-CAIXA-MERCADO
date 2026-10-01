/* ==========================================================================
   pdv.js — Frente de caixa reformulada.
   Layout de 3 zonas: busca/leitor (topo) · catálogo (esq) · venda+pagamento (dir).
   Tudo com teclado: F1-F12, atalhos de pagamento, keypad de dinheiro.
   ========================================================================== */
(function (global) {
  'use strict';

  var UI = global.UI, Store = global.Store, $ = UI.$, esc = UI.esc, money = UI.money, icon = UI.icon;
  var el = UI.el, iconEl = UI.iconEl, frag = UI.frag;

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

  /* Devolve o NÓ do cartão. Nome, emoji, código e categoria entram como texto
     (textContent), então nada digitado no cadastro consegue virar marcação. */
  function prodCard(p) {
    var out = p.stock <= 0;
    var low = !out && p.stock <= p.min;
    var stockTxt = out ? 'Esgotado' : (p.unit === 'kg' ? p.stock + ' kg' : p.stock + ' un');
    var card = el('button', { class: 'v-prod', 'data-add': p.id, title: p.name }, [
      el('span', { class: 'v-prod-info' }, [
        el('span', { class: 'v-prod-name' }, [
          el('span', { class: 'v-prod-emoji' }, p.emoji),
          p.name
        ]),
        el('span', { class: 'v-prod-meta v-mono' }, [
          p.code || p.barcode || '',
          el('em', null, '·'),
          Store.categoryOf(p.category).name
        ])
      ]),
      el('span', { class: 'v-prod-right' }, [
        el('span', { class: 'v-prod-price v-mono' }, (function () {
          var unidade = p.unit === 'kg'
            ? el('em', { style: { 'font-size': '9px', 'font-weight': '400', opacity: '.55' } }, '/kg') : null;
          if (!Store.promoVigente(p)) return [money(p.price), unidade];
          return [
            el('span', { style: { color: 'var(--accent-3)' } }, money(p.promoPrice)),
            el('em', { style: { 'font-size': '9px', 'text-decoration': 'line-through', opacity: '.6', 'margin-left': '4px' } }, money(p.price)),
            unidade
          ];
        })()),
        el('span', { class: 'v-prod-add' }, [iconEl('Plus', 11), ' Adicionar']),
        el('span', { class: 'v-prod-stock' }, stockTxt)
      ])
    ]);
    var cls = 'v-prod-stock' + (out ? ' out' : low ? ' low' : '');
    card.querySelector('.v-prod-stock').setAttribute('class', cls);
    if (out) card.disabled = true;
    return card;
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
      UI.fill(g, el('div', { class: 'empty' }, [
        el('span', { class: 'ico' }, iconEl('Search', 30)),
        el('b', null, 'Nenhum produto encontrado'),
        'Ajuste a busca ou cadastre o produto.'
      ]));
      return;
    }
    UI.fill(g, list.map(prodCard));
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
    var nodes = [el('button', { class: 'v-cat' + (activeCategory === 'all' ? ' active' : ''), 'data-cat': 'all' }, [
      'Todos ', el('b', null, String(nActive))
    ])];
    db.categories.forEach(function (c) {
      if (!counts[c.id]) return;
      nodes.push(el('button', { class: 'v-cat' + (activeCategory === c.id ? ' active' : ''), 'data-cat': c.id }, [
        c.emoji + ' ' + c.name + ' ',
        el('b', null, String(counts[c.id]))
      ]));
    });
    UI.fill(bar, nodes);
  }

  /* ---------------- carrinho ---------------- */
  function cartLineNode(item) {
    var p = Store.db.products.find(function (x) { return x.id === item.id; });
    var flagged = p && item.qty > p.stock;
    return el('div', { class: 'v-line' + (flagged ? ' flagged' : '') }, [
      el('span', { class: 'v-line-main' }, [
        el('span', { class: 'v-line-ico' }, iconEl('ShoppingBag', 15)),
        el('span', { style: { 'min-width': '0' } }, [
          el('span', { class: 'v-line-name' }, item.name),
          el('span', { class: 'v-line-sub v-mono' }, [money(item.price) + ' / ' + (item.unit || 'un')])
        ])
      ]),
      el('span', { class: 'v-line-right' }, [
        el('span', { class: 'v-qty' }, [
          el('button', { 'data-q': '-1', 'data-id': item.id, 'aria-label': 'Diminuir' }, iconEl('Minus', 12)),
          el('input', { type: 'text', inputmode: 'decimal', value: item.qty, 'data-qty': item.id, 'aria-label': 'Quantidade' }),
          el('button', { 'data-q': '1', 'data-id': item.id, 'aria-label': 'Aumentar' }, iconEl('Plus', 12))
        ]),
        el('span', { class: 'v-line-total v-mono' }, money(item.price * item.qty)),
        el('span', { style: { display: 'flex', 'flex-direction': 'column', gap: '2px' } }, [
          p && p.unit === 'kg' ? el('button', { class: 'v-del', 'data-weight': item.id, title: 'Definir peso (kg)' }, iconEl('Scale', 13)) : null,
          el('button', { class: 'v-del', 'data-del': item.id, title: 'Remover' }, iconEl('Trash2', 14))
        ]),
        el('span', { class: 'v-tools' }, [
          el('button', { 'data-price': item.id, title: 'Alterar preço' }, iconEl('Tag', 12))
        ])
      ])
    ]);
  }

  function renderCart() {
    var box = $('#cartList');
    if (!box) return;
    if (!cart.length) {
      UI.fill(box, el('div', { class: 'empty' }, [
        el('span', { class: 'ico' }, iconEl('ShoppingCart', 28)),
        el('b', null, 'Carrinho vazio'),
        'Escaneie um código ou toque em "Adicionar".'
      ]));
    } else {
      UI.fill(box, cart.map(cartLineNode));
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
    var rows = [el('div', { class: 'v-sum-row' }, [el('span', null, 'Subtotal'), el('b', { class: 'v-mono' }, money(sub))])];
    if (d > 0) rows.push(el('div', { class: 'v-sum-row disc' }, [el('span', null, 'Desconto'), el('b', { class: 'v-mono' }, '− ' + money(d))]));
    if (creditPart() > 0) rows.push(el('div', { class: 'v-sum-row' }, [el('span', null, 'Crediário'), el('b', { class: 'v-mono' }, money(creditPart()))]));
    rows.push(el('div', { class: 'v-sum-row' }, [el('span', null, 'Itens'), el('b', { class: 'v-mono' }, String(itemCount()))]));
    rows.push(el('div', { class: 'v-total' }, [
      el('div', { class: 'v-total-lbl' }, 'Total a pagar'),
      el('div', { class: 'v-total-val v-mono' }, money(total()))
    ]));
    UI.fill(t, rows);

    var dInput = $('#discInput');
    if (dInput && document.activeElement !== dInput) dInput.value = d > 0 ? String(d).replace('.', ',') : '';
  }

  var PAY_ICON = { 'Dinheiro': 'Banknote', 'Pix': 'QrCode', 'Débito': 'CreditCard', 'Crédito': 'CreditCard', 'Crediário': 'HandCoins' };

  function renderPayment() {
    var methods = Store.db.config.paymentMethods || [];
    var box = $('#payMethods');
    if (box) {
      UI.fill(box, methods.map(function (m) {
        return el('button', { class: 'v-pay-m' + (payMethod === m ? ' active' : ''), 'data-method': m }, [
          iconEl(PAY_ICON[m] || 'CreditCard', 14), el('span', null, m)
        ]);
      }));
    }

    var cash = $('#quickCash');
    if (cash) {
      var t = total();
      var opts = [];
      [5, 10, 20, 50, 100].forEach(function (v) { if (t > 0 && v >= Math.ceil(t)) opts.push(v); });
      if (t > 0) opts.push(Math.ceil(t));
      opts = opts.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 5);
      UI.fill(cash, opts.map(function (v) {
        return el('button', { 'data-cash': v }, money(v));
      }));
      cash.style.display = payMethod === 'Dinheiro' && t > 0 ? 'grid' : 'none';
    }

    var inp = $('#payInput');
    if (inp) {
      inp.placeholder = payMethod === 'Dinheiro' ? 'Valor recebido' : money(remaining());
      if (document.activeElement !== inp) inp.value = payInput;
    }

    var parts = $('#payParts');
    if (parts) {
      UI.fill(parts, payParts.map(function (p, i) {
        return el('div', { class: 'v-part' }, [
          el('span', null, p.method),
          el('span', { style: { display: 'flex', 'align-items': 'center', gap: '6px' } }, [
            el('b', { class: 'v-mono' }, money(p.amount)),
            el('button', { class: 'v-del', 'data-rmpay': String(i) }, iconEl('X', 12))
          ])
        ]);
      }));
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
    UI.fill(box, [
      el('span', null, ready ? 'Troco' : 'Falta receber'),
      el('b', { class: 'v-mono' }, money(ready ? changeDue() : remaining()))
    ]);
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
      body: el('div', { class: 'list-plain' }, [
        el('button', { class: 'list-item', 'data-pick': '', style: { 'text-align': 'left' } }, [
          el('span', { class: 'thumb-emoji' }, iconEl('X', 15)),
          el('span', { class: 'grow' }, [
            el('b', null, 'Consumidor não identificado'),
            el('small', null, 'Venda avulsa, sem crediário')
          ])
        ])
      ].concat(db.customers.map(function (c) {
        var lim = Number(c.debtLimit) || 0;
        var sub = (c.phone || 'sem telefone') + (c.debt ? ' · deve ' + money(c.debt) : '') + (lim ? ' · limite ' + money(lim) : '');
        return el('button', { class: 'list-item', 'data-pick': c.id, style: { 'text-align': 'left' } }, [
          el('span', { class: 'avatar' }, c.name.slice(0, 2).toUpperCase()),
          el('span', { class: 'grow' }, [el('b', null, c.name), el('small', null, sub)])
        ]);
      }))),
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
      cart.push({ id: p.id, name: p.name, emoji: p.emoji, price: Store.precoVigente(p), cost: Number(p.cost), qty: 1, unit: p.unit });
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
      if (p) antes.estoque.push({ p: p, stock: p.stock, stockDeposit: p.stockDeposit, stockSales: p.stockSales });
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
      payments: parts.map(function (p) {
        var formaNormalizada = String(p.method).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        var externo = formaNormalizada === 'Pix' || formaNormalizada === 'Debito' || formaNormalizada === 'Credito';
        return { method: p.method, amount: p.amount, confirmedBy: externo && u ? u.name : null, confirmedById: externo && u ? u.id : null, confirmedAt: externo ? new Date().toISOString() : null };
      }),
      status: 'Concluída'
    };

    // baixa de estoque
    sale.items.forEach(function (i) {
      var p = db.products.find(function (x) { return x.id === i.id; });
      if (p) {
        if (p.stockSales != null || p.stockDeposit != null) {
          var sala = Math.max(0, Number(p.stockSales) || 0), baixa = Math.min(sala, i.qty);
          p.stockSales = Math.round((sala - baixa) * 1000) / 1000;
          if (p.stockDeposit != null) p.stockDeposit = Math.round(((Number(p.stockDeposit) || 0) - (i.qty - baixa)) * 1000) / 1000;
        }
        p.stock = Math.round((p.stock - i.qty) * 1000) / 1000;
      }
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
      antes.estoque.forEach(function (r) { r.p.stock = r.stock; r.p.stockDeposit = r.stockDeposit; r.p.stockSales = r.stockSales; });
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

    /* Envia ao servidor DEPOIS de confirmar a gravacao local. A ordem e o
       que importa: o local ja tem a venda, entao uma falha de rede aqui
       vira aviso, nunca perda. E o cupom sai na hora -- o caixa nao espera
       o mini PC responder. */
    if (Store.temServidor && Store.temServidor()) {
      Store.enviarVenda(sale).then(function (r) {
        if (r && r.ok) {
          if (r.repetida) return; // reenvio idempotente, nada a dizer
          if (r.divergentes && r.divergentes.length) {
            UI.toast('Estoque negativo em ' + r.divergentes.length + ' item(ns). O gerente foi avisado para reconciliar.', 'warn', 6000);
          }
          Store.puxarDoServidor(); // o estoque autoritativo volta do servidor
        } else if (r && r.enfileirada) {
          UI.toast('Servidor fora do ar — venda #' + id + ' guardada e será enviada depois.', 'warn', 6000);
        } else if (r && r.erro) {
          UI.toast('Servidor: ' + r.erro, 'warn', 6000);
        }
      }).catch(function () { /* nunca derruba o caixa */ });
    }

    UI.toast('Venda #' + id + ' concluída · ' + money(totalV) + (change > 0 ? ' · troco ' + money(change) : ''), 'ok', 4200);

    UI.confirm({
      title: 'Venda #' + id + ' registrada', kind: 'ok', confirmText: 'Imprimir cupom',
      html: 'Total <strong>' + money(totalV) + '</strong> · ' + sale.items.length + ' itens' +
        (change > 0 ? '<br>Troco <strong>' + money(change) + '</strong>' : ''),
      onConfirm: function () { printReceipt(id); }
    });
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
      /* O servidor e quem tem a verdade do estoque. Um estorno que o servidor
         recusou NAO pode ser dado por bom só no caixa que fez a venda: os
         outros 4 continuariam vendo a mercadoria e poderiam vendê-la de novo.
         Por isso a chamada vem ANTES de tocar no local. */
      if (Store.temServidor && Store.temServidor()) {
        return API.estornar(id, reason).then(function (r) {
          if (r && r.ok) return true;
          if (r && r.enfileirada) {
            UI.toast('Servidor fora do ar — estorno guardado e será enviado depois.', 'warn', 6000);
            return true;
          }
          UI.toast('Estorno recusado pelo servidor: ' + ((r && r.erro) || 'erro') + ' Nada foi alterado.', 'err', 7000);
          return false;
        });
      }
      return true;
    }).then(function (podeSeguir) {
      if (podeSeguir === false) return;
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
      body: frag(
        el('div', { class: 'form-grid' }, [
          UI.fieldEl('Valor (R$)', 'amount', '', { type: 'money', step: '0.01', min: 0, placeholder: '0,00' }),
          UI.fieldEl('Motivo', 'reason', '', { placeholder: type === 'Entrada' ? 'Ex.: troco inicial' : 'Ex.: pagar fornecedor', full: true })
        ]),
        type === 'Entrada' ? null : el('div', { class: 'modal-note warn' },
          'Sangrias são registradas na auditoria do turno. Informe o motivo com clareza.')
      ),
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
        return el('div', { class: 'list-item' }, [
          el('span', { class: 'thumb-emoji' }, iconEl('cart2', 17)),
          el('span', { class: 'grow' }, [
            el('b', null, h.items.length + ' itens · ' + money(h.total)),
            el('small', null, UI.dt(h.date))
          ]),
          el('button', { class: 'btn sm primary', 'data-resume': h.id }, 'Retomar'),
          el('button', { class: 'btn sm danger', 'data-drop': h.id }, 'Descartar')
        ]);
      }),
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
        body: frag(
          el('div', { class: 'modal-note' }, 'O fundo de caixa é a quantia inicial no gaveteiro. Ela será usada como base na conferência do fechamento.'),
          el('div', { class: 'form-grid mt-2' }, [
            UI.fieldEl('Fundo inicial (R$)', 'opening', db.config.cashOpening || 0, { type: 'money', step: '0.01', min: 0, full: true })
          ])
        ),
        confirmText: 'Abrir caixa',
        onMount: function (root, close) { root._closeShiftOpen = close; },
        onConfirm: function (root) {
          var d = UI.formData(root), opening = UI.parseNum(d.opening);
          var finish = function (turno) {
            Store.openShift(opening, turno || null);
            global.App.rerender(); global.App.refreshShiftUI();
            UI.toast('Caixa aberto com fundo de ' + money(opening) + '.', 'ok');
            resolve(true); root._closeShiftOpen();
          };
          if (API.estado && API.estado.online && API.abrirTurno) {
            API.abrirTurno(Store.uid('sh'), opening).then(function (r) {
              if (!r.ok) { UI.toast(r.erro, 'err', 6000); return; }
              finish(r.turno);
            });
            return false;
          }
          finish(null);
          return false;
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

    return frag(
      /* ================= COLUNA 1 · CATÁLOGO ================= */
      el('div', { class: 'v-col' }, [
        el('div', { class: 'v-col-head' }, [
          el('span', { class: 'v-label' }, 'Catálogo'),
          el('span', { class: 'v-count v-mono' }, active + ' produtos')
        ]),
        el('div', { class: 'v-search' }, el('div', { class: 'v-search-box' }, [
          iconEl('Search', 15),
          el('input', { id: 'pdvSearch', placeholder: 'Código de barras ou nome', autocomplete: 'off', autofocus: '' }),
          el('span', { class: 'v-kbd' }, 'F2')
        ])),
        el('div', { class: 'v-cats', id: 'pdvCats' }),
        el('div', { class: 'v-list', id: 'pdvGrid' })
      ]),

      /* ================= COLUNA 2 · VENDA EM ANDAMENTO ================= */
      el('div', { class: 'v-col' }, [
        el('div', { class: 'v-col-head' }, [
          el('div', null, [
            el('div', { class: 'v-label' }, 'Venda em andamento'),
            el('div', { class: 'v-label-sub', id: 'cartCount' }, '0 itens no carrinho')
          ]),
          el('span', { class: 'v-count v-mono', id: 'saleNum' }, '#—')
        ]),
        el('div', { class: 'v-cart', id: 'cartList' }),
        el('div', { class: 'v-hotkeys' }, [
          el('button', { class: 'v-hk', id: 'btnClear', title: 'Cancelar venda' }, [iconEl('Tag', 13), el('b', null, 'F1'), ' Desconto']),
          el('button', { class: 'v-hk', id: 'btnFocus', title: 'Focar busca' }, [iconEl('Search', 13), el('b', null, 'F2'), ' Busca']),
          el('button', { class: 'v-hk', id: 'btnHold', title: 'Suspender venda' }, [iconEl('Pause', 13), el('b', null, 'F3'), ' Suspender']),
          el('button', { class: 'v-hk', id: 'btnCancel', title: 'Cancelar venda' }, [iconEl('X', 13), el('b', null, 'F4'), ' Cancelar'])
        ])
      ]),

      /* ================= COLUNA 3 · RESUMO E PAGAMENTO ================= */
      el('div', { class: 'v-col' }, [
        el('div', { class: 'v-pay' }, [
          el('div', { class: 'v-sum-head' }, [el('span', { class: 'v-label' }, 'Resumo'), iconEl('Package', 15, 1.6)]),
          el('div', { id: 'totalsBox' }),
          el('div', { class: 'v-disc-row' }, [
            el('input', { id: 'discInput', inputmode: 'decimal', placeholder: 'Desconto R$ 0,00', title: 'Desconto (F1)' }),
            el('button', { class: 'v-quick', id: 'btnMaxDisc', style: { padding: '0 11px', 'font-size': '11px' } }, 'Máx')
          ]),
          el('span', { class: 'v-pay-lbl' }, 'Forma de pagamento'),
          el('div', { class: 'v-pays', id: 'payMethods' }),
          el('div', { class: 'v-quick', id: 'quickCash', style: { display: 'none' } }),
          el('div', { class: 'v-cash-row' }, [
            el('input', { id: 'payInput', inputmode: 'decimal', placeholder: '0,00' }),
            el('button', { id: 'btnAddPart', title: 'Adicionar forma de pagamento' }, iconEl('Plus', 16))
          ]),
          el('div', { class: 'change-box', id: 'changeBox' }),
          el('div', { class: 'pay-parts', id: 'payParts' }),
          el('div', { class: 'row tight', style: { gap: '6px', 'margin-top': '9px' } }, [
            el('button', { class: 'v-hk', id: 'btnExact', style: { flex: '1' } }, [iconEl('CheckCircle', 13), ' Pagar exato']),
            el('button', { class: 'v-hk', id: 'btnPix', style: { flex: '1' } }, [iconEl('QrCode', 13), ' Pix QR'])
          ]),
          el('button', { class: 'v-cust', id: 'btnCustomer' }, [
            el('span', null, [iconEl('UserPlus', 15), ' ', el('b', { id: 'custName' }, 'Cliente')]),
            el('em', { id: 'custHint' }, 'Identificar')
          ]),
          el('button', { class: 'v-finish', id: 'btnCheckout', disabled: true }, [iconEl('CheckCircle', 16), ' Finalizar venda']),
          el('div', { class: 'v-finish-hint' }, 'F9 ou Enter · confirmar pagamento')
        ])
      ])
    );
  }

  /* Envolve o PDV no grid de 3 colunas + barra de atalhos, e liga o tema Vértice. */
  function renderWrapped() {
    document.body.classList.add('vertice');
    return frag(
      el('div', { class: 'v-grid' }, render()),
      el('div', { class: 'v-bar' }, [
        el('span', null, [iconEl('Lock', 11), ' ', el('b', null, Store.db.shift ? Store.db.shift.operator : 'Caixa fechado')]),
        el('span', null, [el('b', null, 'F1'), ' Desconto']),
        el('span', null, [el('b', null, 'F2'), ' Focar leitor']),
        el('span', null, [el('b', null, 'F5'), ' Cliente']),
        el('span', null, [el('b', null, 'F6'), ' Suspender']),
        el('span', null, [el('b', null, 'F7'), ' Trocar método']),
        el('span', null, [el('b', null, 'F8'), ' Valor recebido']),
        el('span', null, [el('b', null, 'F9'), ' Finalizar']),
        el('span', null, [el('b', null, 'F10'), ' Cupom']),
        el('span', null, [el('b', null, 'F11'), ' Balança']),
        Store.db.heldSales.length
          ? el('span', null, [iconEl('Pause', 10), ' ', el('b', { id: 'heldInfo' }, String(Store.db.heldSales.length)), ' suspensa(s)'])
          : null,
        el('span', { class: 'right' }, [el('span', { class: 'dot' }), ' MODO CAIXA'])
      ])
    );
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
      body: frag(
        el('div', { class: 'pix-card' }, [
          el('div', { class: 'pix-qr', id: 'pixQrBox' }),
          el('div', { class: 'small muted', style: { 'margin-bottom': '8px' } },
            'O cliente escaneia e paga. Confirme o crédito no app bancário antes de finalizar.'),
          el('button', { class: 'btn primary block', id: 'btnCopyPix' }, [iconEl('copy', 15), ' Copiar Pix copia e cola'])
        ]),
        el('div', { class: 'modal-note' }, [
          iconEl('info', 12), ' Configure a chave Pix em ',
          el('b', null, 'Configurações → Fiscal'),
          '. O QR é estático: serve para qualquer valor.'
        ])
      ),
      onMount: function (root, close) {
        var box = root.querySelector('#pixQrBox');
        if (payload) {
          /* QR.render devolve true/false; o fallback mostra o copia-e-cola se
             algum dia o gerador falhar, para o vendedor nunca ficar sem saída. */
          var drew = global.QR && global.QR.render(box, payload, {
            tamanho: 190, escuro: '#0d1520', claro: '#ffffff'
          });
          if (!drew) {
            UI.fill(box, el('div', { class: 'pix-copy' }, payload));
            if (global.console) console.warn('[Pix] gerador de QR indisponível; mostrando copia e cola.');
          }
        } else {
          UI.fill(box, el('div', { class: 'tiny muted', style: { padding: '16px' } }, [
            'Chave Pix não configurada.', el('br'), 'Vá em Configurações → Fiscal.'
          ]));
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

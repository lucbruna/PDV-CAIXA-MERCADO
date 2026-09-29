/* ==========================================================================
   store.js — Camada de dados, persistência e estado global.
   Sem dependências. Tudo em localStorage sob a chave STORAGE_KEY.
   ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'sudam_gestao_v3';
  var LEGACY_KEY  = 'sudam_gestao_v2';

  /* ---------------- utilidades ---------------- */
  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  var CATEGORIES = [
    { id:'bebidas',  name:'Bebidas',      emoji:'🥤', color:'#3b82f6' },
    { id:'mercearia',name:'Mercearia',    emoji:'🍚', color:'#f59e0b' },
    { id:'padaria',  name:'Padaria',      emoji:'🥖', color:'#a855f7' },
    { id:'acougue',  name:'Açougue',      emoji:'🥩', color:'#ef4444' },
    { id:'hortifruti',name:'Hortifruti', emoji:'🍎', color:'#22c55e' },
    { id:'limpeza',  name:'Limpeza',      emoji:'🧴', color:'#06b6d4' },
    { id:'higiene',  name:'Higiene',      emoji:'🧼', color:'#ec4899' },
    { id:'congelados',name:'Congelados',  emoji:'🧊', color:'#14b8a6' },
    { id:'petiscos', name:'Petiscos',     emoji:'🍿', color:'#f97316' },
    { id:'infantil', name:'Infantil',     emoji:'🍼', color:'#8b5cf6' },
    { id:'casa',     name:'Casa',         emoji:'🏠', color:'#64748b' }
  ];

  /* Catálogo inicial — mercadinho de bairro. Valores plausíveis de 2026. */
  function seedProducts() {
    var raw = [
      // code, nome, categoria, custo, preço, estoque, mín, un, emoji, fornecedor, ncm, validade
      ['7891000055541','Água Mineral Crystal 500ml','bebidas',1.10,2.50,240,48,'un','💧','Fonte Natural','2201.10.00',''],
      ['7891000055565','Refrigerante Coca-Cola 2L','bebidas',6.40,9.90,36,12,'un','🥤','Bebidas do Sul','2202.10.00','2026-11-30'],
      ['7891000055572','Refrigerante Guaraná 2L','bebidas',4.80,7.50,40,12,'un','🥤','Bebidas do Sul','2202.10.00','2026-10-15'],
      ['7891000055589','Cerveja Brahma Lata 350ml','bebidas',2.60,4.50,96,24,'un','🍺','Cervejaria Sul','2202.10.00',''],
      ['7891000055596','Suco de Laranja Integral 1L','bebidas',4.20,7.90,18,6,'un','🧃','Pomar do Vale','2009.11.00','2026-09-28'],
      ['7891000055609','Água Tônica Schweppes 350ml','bebidas',2.10,3.80,30,12,'un','🥤','Bebidas do Sul','2202.10.00',''],
      ['7891910000197','Açúcar Cristal Union 1kg','mercearia',3.20,5.20,80,20,'un','🧂','Atacado Central','1701.99.00',''],
      ['7891910000203','Arroz Tipo 1 Tio João 5kg','mercearia',19.90,29.90,26,8,'un','🍚','Atacado Central','1006.30.21',''],
      ['7891910000210','Feijão Carioca 1kg','mercearia',6.40,9.90,44,12,'un','🫘','Atacado Central','0713.33.99',''],
      ['7891910000227','Óleo de Soja Liza 900ml','mercearia',4.10,6.80,42,12,'un','🫗','Atacado Central','1507.90.00',''],
      ['7891910000234','Macarrão Espaguete 500g','mercearia',2.30,4.20,54,15,'un','🍝','Atacado Central','1902.19.00',''],
      ['7891910000241','Farinha de Mandioca 1kg','mercearia',4.20,7.50,32,10,'un','🥣','Atacado Central','1106.10.00',''],
      ['7891910000258','Café Melitta Torrado e Moído 500g','mercearia',8.90,14.90,28,10,'un','☕','Distribuidora Café','0901.21.00','2027-01-15'],
      ['7891910000265','Leite Integral Itambé 1L','mercearia',4.20,6.70,40,15,'un','🥛','LaticíniosSul','0401.10.00','2026-09-20'],
      ['7891910000272','Manteiga Com Flora 200g','mercearia',9.80,15.90,14,6,'un','🧈','Laticínios Sul','0401.30.00','2026-12-05'],
      ['7891910000289','Queijo Mussarela Fatiado 150g','mercearia',7.40,12.90,20,8,'un','🧀','Laticínios Sul','0406.10.00','2026-09-22'],
      ['7891000310014','Pão Francês Kg','padaria',0.00,18.90,40,5,'kg','🥖','Padaria Pão Vivo','1905.20.00',''],
      ['7891000310021','Pão de Forma Pullman 500g','padaria',5.20,9.90,12,6,'un','🍞','Padaria Pão Vivo','1905.20.00','2026-09-19'],
      ['7891000310038','Bolo de Cenoura Fatia','padaria',3.10,7.50,8,4,'un','🍰','Padaria Pão Vivo','1905.20.00',''],
      ['7891000310045','Croissant Recheado','padaria',2.40,6.00,10,5,'un','🥐','Padaria Pão Vivo','1905.20.00',''],
      ['7891000310052','Pão de Queijo 100g','padaria',1.80,3.50,22,10,'un','🧀','Padaria Pão Vivo','1905.20.00',''],
      ['7898800500019','Picanha Bovina Resfriada kg','acougue',39.90,64.90,18,4,'kg','🥩','Frigorífico Sul','0201.30.00','2026-09-17'],
      ['7898800500026','Frango Resfriado Inteiro kg','acougue',11.90,19.90,22,5,'kg','🍗','Frigorífico Sul','0207.14.00','2026-09-18'],
      ['7898800500033','Linguiça Calabresa kg','acougue',17.90,29.90,12,4,'kg','🌭','Frigorífico Sul','1601.00.00',''],
      ['7898800500040','Carne Moída 500g','acougue',9.80,16.90,16,6,'un','🥩','Frigorífico Sul','0201.30.00','2026-09-17'],
      ['7898800500057','Costela Bovina kg','acougue',29.90,49.90,9,3,'kg','🍖','Frigorífico Sul','0201.30.00','2026-09-17'],
      ['7891000440011','Banana Prata kg','hortifruti',4.20,7.90,25,8,'kg','🍌','Horta do Vale','0803.90.00',''],
      ['7891000440028','Tomate Italiano kg','hortifruti',6.10,10.90,18,6,'kg','🍅','Horta do Vale','0702.00.00',''],
      ['7891000440035','Batata Inglesa kg','hortifruti',3.60,7.20,30,10,'kg','🥔','Horta do Vale','0701.90.00',''],
      ['7891000440042','Cebola kg','hortifruti',3.10,6.40,20,8,'kg','🧅','Horta do Vale','0702.00.00',''],
      ['7891000440059','Maçã Nacional kg','hortifruti',8.90,14.90,12,5,'kg','🍎','Horta do Vale','0808.10.00',''],
      ['7891000440066','Alface Crespa','hortifruti',2.20,4.50,8,4,'un','🥬','Horta do Vale','0705.11.00',''],
      ['7891000440073','Cenoura kg','hortifruti',3.40,6.90,14,6,'kg','🥕','Horta do Vale','0709.21.00',''],
      ['7891000550010','Detergente Ypê Neutro 500ml','limpeza',2.10,4.20,45,15,'un','🧴','Higiene Union','3402.20.00',''],
      ['7891000550018','Sabão em Pó Omo 1kg','limpeza',9.80,16.90,16,6,'un','🧼','Higiene Union','3402.20.00',''],
      ['7891000550025','Água Sanitária 1L','limpeza',3.20,6.50,20,8,'un','🧴','Higiene Union','2829.00.00',''],
      ['7891000550032','Papel Higiênico Neve 12un','limpeza',11.40,22.90,14,6,'un','🧻','Higiene Union','4818.10.00',''],
      ['7891000550049','Desinfetante Puro 500ml','limpeza',3.40,7.20,18,8,'un','🧴','Higiene Union','3808.94.00',''],
      ['7891000550056','Esponja Fibra 3un','limpeza',1.40,3.50,30,10,'un','🧽','Higiene Union','6804.00.00',''],
      ['7891000550063','Saco de Lixo 100L 10un','limpeza',9.90,18.90,10,5,'un','🗑️','Higiene Union','3923.21.00',''],
      ['7891000660010','Creme Dental Colgate 90g','higiene',3.90,8.20,22,8,'un','🦷','Higiene Union','3306.20.00','2027-06-30'],
      ['7891000660018','Sabonete Facial Nivea 100g','higiene',3.20,7.50,20,8,'un','🧼','Higiene Union','3401.11.00','2027-03-20'],
      ['7891000660025','Fio Dental Oral-B 100m','higiene',4.10,9.90,14,6,'un','🪥','Higiene Union','3306.21.00',''],
      ['7891000660032','Desodorante Aerosol 150ml','higiene',8.40,15.90,16,6,'un','🧴','Higiene Union','3303.00.00',''],
      ['7891000660049','Papel Toalha 2un','higiene',5.10,10.90,18,8,'un','🧻','Higiene Union','4818.10.00',''],
      ['7891000660056','Shampoo Anticaspa 400ml','higiene',12.90,22.90,8,4,'un','🧴','Higiene Union','3305.10.00',''],
      ['7891000770018','Sorvete Kibon 1,5L','congelados',11.90,21.90,9,4,'un','🍨','Distribuidora Sul','2105.10.00','2027-01-30'],
      ['7891000770025','Pizza Sadia Congelada 460g','congelados',9.40,17.90,7,4,'un','🍕','Distribuidora Sul','1905.20.00','2026-11-10'],
      ['7891000770032','Batata Frita McCain 150g','congelados',8.20,15.90,12,5,'un','🍟','Distribuidora Sul','2004.10.00',''],
      ['7891000770049','Pão de Queijo Congelado 300g','congelados',7.90,14.90,10,5,'un','🧀','Distribuidora Sul','1905.20.00',''],
      ['7891000770056','Lasanha Bolonhesa 500g','congelados',13.90,24.90,6,3,'un','🍝','Distribuidora Sul','1902.20.00',''],
      ['7891000880016','Pipoca de Microondas 100g','petiscos',2.40,5.90,24,10,'un','🍿','Distribuidora Sul','1904.20.00',''],
      ['7891000880023','Batata de pacote 150g','petiscos',5.20,9.90,20,8,'un','🥔','Distribuidora Sul','2005.20.00',''],
      ['7891000880030','Chocolate Nescau 370g','petiscos',13.90,24.90,10,4,'un','🍫','Distribuidora Sul','1806.32.00',''],
      ['7891000880047','Biscoito Recheado Mais 140g','petiscos',2.90,6.20,18,8,'un','🍪','Distribuidora Sul','1905.20.00',''],
      ['7891000880054','Salgadinho Cheetos 43g','petiscos',2.10,4.90,26,12,'un','🌽','Distribuidora Sul','1905.20.00',''],
      ['7891000990012','Fórmula Infantil 1º Estágio 900g','infantil',28.90,49.90,6,3,'un','🍼','Distribuidora Sul','2106.90.90','2026-12-20'],
      ['7891000990029','Fralda P/M 30un','infantil',19.90,34.90,5,2,'un','👶','Distribuidora Sul','4818.20.00',''],
      ['7891000990036','Lenço Umedecido 96un','infantil',8.90,16.90,12,5,'un','🧻','Distribuidora Sul','3306.20.00',''],
      ['7891001000011','Papel Toalha 2 Rolos','casa',4.90,9.90,15,6,'un','🧻','Higiene Union','4818.10.00',''],
      ['7891001000028','Sabao em Barra 4un','casa',7.40,13.90,9,4,'un','🧼','Higiene Union','3401.11.00',''],
      ['7891001000035','Vela 7 Dias 4un','casa',4.20,9.50,8,4,'un','🕯️','Higiene Union','3406.00.00',''],
      ['7891001000042','Pilha AAA Duracell Blister','casa',9.90,18.90,7,3,'un','🔋','Higiene Union','8506.10.00','2029-12-31'],
      ['7891001000059','Bateria 9V Panasonic','casa',6.40,12.90,10,4,'un','🔋','Higiene Union','8506.10.00','2028-06-30']
    ];
    return raw.map(function (r, i) {
      return {
        id: 'p' + String(i + 1).padStart(3, '0'),
        code: r[0],
        barcode: r[0],
        name: r[1],
        category: r[2],
        cost: r[3],
        price: r[4],
        stock: r[5],
        min: r[6],
        unit: r[7],
        emoji: r[8],
        supplier: r[9],
        ncm: r[10],
        cfop: '5102',
        csosn: '102',
        expiry: r[11],
        lot: r[11] ? 'L' + new Date().getFullYear() + String(Math.floor(Math.random() * 900) + 100) : '',
        active: true,
        createdAt: new Date().toISOString()
      };
    });
  }

  function freshDb() {
    return {
      version: 3,
      products: seedProducts(),
      customers: [],
      sales: [],
      entries: [],
      shifts: [],
      shift: null,
      suppliers: [],
      purchases: [],
      payables: [],
      quotes: [],
      heldSales: [],
      categories: CATEGORIES.slice(),
      counters: { sale: 1001, entry: 5001 },
      operator: 'Administrador',
      config: defaultConfig(),
      auth: { users: [], currentId: null },
      loyalty: { enabled: true, pointsPerReal: 1, redeemRate: 0.01 }
    };
  }

  function defaultConfig() {
    return {
      storeName: 'Mercadinho Sudam II',
      cnpj: '00.000.000/0001-00',
      ie: '123.456.789.111',
      address: 'Rua das Palmeiras, 250 — Centro',
      phone: '(11) 3333-4444',
      receiptFooter: 'Obrigado pela preferência! Volte sempre.',
      maxDiscount: 100,
      paymentMethods: ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Crediário'],
      theme: 'dark',
      taxRegime: 'Simples Nacional',
      cashOpening: 50,
      printWidth: 80,
      allowNegativeStock: false,
      requireCustomerOnCredit: true,
      blocksale: { enabled: false, minMarginPct: 0 },
      pix: { provider: '', pixKey: '', city: '', apiUrl: '', clientId: '', secretConfigured: false }
    };
  }

  /* ---------------- migração v2 -> v3 ---------------- */
  function migrate(raw) {
    var base = freshDb();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    /* Cópia rasa só das chaves que EXISTEM no formato novo. Sem isso o
       Object.assign abaixo despeja lixo do localStorage por cima do base e o
       app quebra ao renderizar sem nenhuma exceção visível (tela preta).
       Qualquer chave desconhecida do arquivo salvo é ignorada. */
    var known = Object.keys(base);
    var out = {};
    known.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k];
    });
    var db = Object.assign({}, base, out);
    db.version = 3;

    /* Cada coleção precisa ser um array de objetos utilizáveis: um array
       contendo null/strings quebra todo .map() das views.
       A ordem importa: `auth` precisa ser validado ANTES de qualquer coisa
       que leia db.auth.users, senão o acesso lança no meio da migração e o
       Store fica carregado porém sem db — tela preta. */
    if (!db.auth || typeof db.auth !== 'object' || Array.isArray(db.auth)) db.auth = { users: [], currentId: null };
    if (!Array.isArray(db.auth.users)) db.auth.users = [];

    function cleanList(v, fallback) {
      if (!Array.isArray(v)) return fallback.slice();
      return v.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); });
    }
    ['products','customers','sales','entries','shifts','suppliers','purchases','payables','quotes','heldSales','categories']
      .forEach(function (k) { db[k] = cleanList(db[k], base[k]); });
    db.auth.users = cleanList(db.auth.users, []);
    /* cada usuário precisa de username/passHash utilizáveis, senão o login
       compara contra undefined e rejeita toda senha silenciosamente. */
    db.auth.users = db.auth.users.filter(function (u) {
      return typeof u.username === 'string' && u.username && typeof u.passHash === 'string' && u.passHash;
    });
    db.auth.users.forEach(function (u) {
      if (typeof u.id !== 'string' || !u.id) u.id = 'u_' + u.username;
      if (typeof u.name !== 'string' || !u.name) u.name = u.username;
      if (u.role !== 'admin' && u.role !== 'caixa') u.role = 'caixa';
      u.active = u.active !== false;
    });

    /* vendas também carregam itens/pagamentos: sem array, a reimpressão do
       cupom quebra no meio da operação. */
    db.sales = db.sales.map(function (s) {
      if (!Array.isArray(s.items)) s.items = [];
      if (!Array.isArray(s.payments)) s.payments = [];
      if (s.items.some(function (i) { return !i || typeof i !== 'object'; })) {
        s.items = s.items.filter(function (i) { return i && typeof i === 'object'; });
      }
      s.total = Number(s.total) || 0;
      s.change = Number(s.change) || 0;
      return s;
    });
    db.heldSales = db.heldSales.map(function (h) {
      if (!Array.isArray(h.items)) h.items = [];
      h.items = h.items.filter(function (i) { return i && typeof i === 'object'; });
      return h;
    });

    if (!db.categories || !db.categories.length) db.categories = CATEGORIES.slice();
    if (!db.counters || typeof db.counters !== 'object') db.counters = { sale: 1001, entry: 5001 };
    if (typeof db.counters.sale !== 'number' || !isFinite(db.counters.sale)) db.counters.sale = 1001;
    if (typeof db.counters.entry !== 'number' || !isFinite(db.counters.entry)) db.counters.entry = 5001;
    if (!db.auth || typeof db.auth !== 'object') db.auth = { users: [], currentId: null };
    if (!Array.isArray(db.auth.users)) db.auth.users = [];
    if (typeof db.auth.currentId !== 'string') db.auth.currentId = null;
    if (!db.loyalty || typeof db.loyalty !== 'object') db.loyalty = { enabled: true, pointsPerReal: 1, redeemRate: 0.01 };

    /* config: mescla com padrões, e só aceita tipos úteis */
    db.config = Object.assign({}, defaultConfig(), (raw.config && typeof raw.config === 'object') ? raw.config : {});
    db.config.pix = Object.assign({}, defaultConfig().pix,
      (raw.config && raw.config.pix && typeof raw.config.pix === 'object') ? raw.config.pix : {});
    if (typeof db.config.storeName !== 'string' || !db.config.storeName) db.config.storeName = defaultConfig().storeName;
    if (db.config.theme !== 'light' && db.config.theme !== 'dark') db.config.theme = defaultConfig().theme;
    ['maxDiscount','cashOpening','printWidth'].forEach(function (k) {
      var n = Number(db.config[k]);
      db.config[k] = isFinite(n) ? n : defaultConfig()[k];
    });
    if (!Array.isArray(db.config.paymentMethods) || !db.config.paymentMethods.length) {
      db.config.paymentMethods = defaultConfig().paymentMethods.slice();
    }

    // migração de campos antigos (min -> min, ok) e novos
    db.products = db.products.map(function (p) {
      if (typeof p.id !== 'string' || !p.id) p.id = 'p' + Math.random().toString(36).slice(2, 9);
      p.cost = Number(p.cost) || 0;
      p.price = Number(p.price) || 0;
      p.stock = Number(p.stock) || 0;
      p.min = Number(p.min != null ? p.min : p.minStock) || 0;
      p.unit = p.unit || 'un';
      p.name = String(p.name || 'Sem nome');
      p.emoji = p.emoji || '📦';
      p.active = p.active !== false;
      p.code = p.code || p.barcode || p.id;
      p.barcode = p.barcode || p.code || '';
      p.ncm = p.ncm || '';
      p.cfop = p.cfop || '5102';
      p.csosn = p.csosn || '102';
      p.expiry = p.expiry || '';
      return p;
    });

    /* Índice por id: várias views fazem find() por produto em cada linha do
       carrinho. Sem ids únicos isso devolve o item errado em silêncio. */
    var seen = {};
    db.products.forEach(function (p) {
      while (seen[p.id]) p.id = p.id + '_' + Math.random().toString(36).slice(2, 5);
      seen[p.id] = true;
    });

    // v2 usava nextId global
    if (raw.nextId) {
      var maxSale = db.sales.reduce(function (m, s) { return Math.max(m, parseInt(s.id, 10) || 0); }, 0);
      db.counters.sale = Math.max(raw.nextId, maxSale + 1);
      db.counters.entry = raw.nextId + 1000;
    }
    db.nextId = undefined;

    // usuários antigos: {name, username, passwordHash, role}
    db.auth.users = db.auth.users.map(function (u) {
      return {
        id: u.id || uid('u'),
        name: u.name,
        username: u.username,
        passHash: u.passHash || u.passwordHash || '',
        role: u.role || 'caixa',
        active: u.active !== false,
        createdAt: u.createdAt || new Date().toISOString()
      };
    });

    // turnos antigos
    db.shifts = db.shifts.map(function (s) {
      s.sales = s.sales || [];
      s.movements = s.movements || [];
      s.opening = Number(s.opening) || 0;
      s.cashExpected = Number(s.cashExpected) || 0;
      return s;
    });

    return db;
  }

  /* ---------------- carga / gravação ---------------- */
  var db;
  function load() {
    var raw = null;
    try {
      var v3 = localStorage.getItem(STORAGE_KEY);
      if (v3) raw = JSON.parse(v3);
      if (!raw) {
        var v2 = localStorage.getItem(LEGACY_KEY);
        if (v2) raw = JSON.parse(v2);
      }
    } catch (e) {
      /* JSON inválido: mantém o texto original para diagnóstico e recomeça
         do zero em vez de travar a tela. */
      try { localStorage.setItem(STORAGE_KEY + '_invalido_backup', localStorage.getItem(STORAGE_KEY) || ''); } catch (e2) {}
      raw = null;
    }

    /* Última rede de proteção: mesmo que a migração lance sobre algum formato
       inesperado, o app precisa de um db utilizável. Sem db, TODA view quebra
       e o operador vê apenas a tela preta. */
    try {
      db = migrate(raw);
      if (!db || typeof db !== 'object' || !Array.isArray(db.products)) throw new Error('migrate devolveu estrutura inválida');
    } catch (e3) {
      if (console) console.error('[store] migração falhou, recriando do zero:', e3);
      try { localStorage.setItem(STORAGE_KEY + '_migrate_erro_' + Date.now(), String(e3 && e3.message)); } catch (e4) {}
      db = freshDb();
      seedUsers();
    }

    /* Usuários são o portão de entrada: sem eles NINGUÉM entra e o operador
       fica preso numa tela de login que sempre recusa a senha. O seed só
       rodava quando a chave não existia, então um arquivo corrompido que
       preservasse a chave mas trouxesse auth vazio deixava o sistema
       inutilizável sem nenhuma pista na tela. */
    if (!db.auth.users.length) {
      seedUsers();
      // restaura a sessão se havia um currentId válido no arquivo salvo
      try {
        var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && saved.auth && typeof saved.auth.currentId === 'string') {
          var found = db.auth.users.filter(function (u) { return u.id === saved.auth.currentId; })[0];
          if (found) db.auth.currentId = found.id;
        }
      } catch (e) {}
    }

    // primeira execução (sem arquivo nenhum): grava o seed
    if (!localStorage.getItem(STORAGE_KEY)) save();
    return db;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.error('Falha ao salvar', e);
      return false;
    }
  }

  /* Gravação com desfazer.
     save() sozinha devolve false EM SILÊNCIO quando o armazenamento estoura
     (cota do localStorage, ~5 MB). Isso é o pior tipo de falha num caixa:
     a venda aparecia na tela, o troco saía, e o registro sumia ao fechar o
     o navegador — sem aviso e sem erro. commit() exige que o chamador diga
     como devolver o estado e, se a gravação falhar, desfaz na mesma hora:
     a venda nunca chega a ser vista pelo operador. */
  function commit(undo) {
    if (save()) return true;
    if (typeof undo === 'function') {
      try { undo(); }
      catch (e) { if (console) console.error('[store] não foi possível desfazer a operação:', e); }
    }
    return false;
  }

  /* Espaço em uso, para o sistema avisar o caixa ANTES de a venda travar.
     Mede o tamanho do que VAI ser gravado, e não o do último save certo:
     quando a gravação acaba de falhar, o valor no disco é o anterior e
     mostraria um_percentage_ que não tem nada a ver com o problema. */
  function usage() {
    var bytes;
    try { bytes = JSON.stringify(db).length; }
    catch (e) { return null; }
    /* Medido no Chromium: setItem passa com 5000 KB e estoura com 5100 KB,
       então 5000 KB é o teto pratico (o resto da cota fica com o navegador). */
    var limite = 5000 * 1024;
    return {
      bytes: bytes, limite: limite, pct: bytes / limite, livre: limite - bytes,
      mb: (bytes / 1048576).toFixed(2), limiteMB: (limite / 1048576).toFixed(2)
    };
  }

  /* ---------------- usuários ---------------- */

  /* O login local (FNV) segue existindo para quando o servidor esta fora do
     ar -- e assim o caixa nao fica preso numa tela que sempre recusa. Mas
     quando ha servidor, quem autentica e ele (scrypt, no mini PC).
     Store.login tenta o servidor primeiro e so cai no local se a chamada
     nao tiver resposta de rede. */
  function loginServidor(usuario, senha) {
    if (typeof API === 'undefined' || !API.login) {
      return Promise.resolve({ erro: 'Sem servidor disponivel.' });
    }
    return API.login(usuario, senha).then(function (r) {
      if (r && r.ok) return { usuario: r.usuario || { username: usuario, role: 'caixa' } };
      return { erro: (r && r.erro) || 'Não foi possível entrar.' };
    }).catch(function () {
      // Excecao aqui (ex.: API indefinido no meio do caminho) e tratada
      // como "sem servidor": quem decide o fallback e loginComServidor.
      return null;
    });
  }

  function hashPass(pass) {
    // FNV-1a + sal fixo — ofuscação local, não é criptografia de servidor.
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    var s = 'sudam::' + pass + '::pdv';
    for (var i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i); h1 = (h1 * 0x01000193) >>> 0;
      h2 = ((h2 << 5) - h2 + s.charCodeAt(i)) >>> 0;
    }
    return h1.toString(36) + '.' + h2.toString(36) + '.' + s.length;
  }

  function seedUsers() {
    db.auth.users = [
      { id: 'u_admin', name: 'Administrador', username: 'admin',  passHash: hashPass('1234'), role: 'admin',   active: true, createdAt: new Date().toISOString() },
      { id: 'u_caixa1', name: 'Caixa 1',       username: 'caixa1', passHash: hashPass('0000'), role: 'caixa',   active: true, createdAt: new Date().toISOString() }
    ];
  }

  function currentUser() {
    if (!db.auth.currentId) return null;
    return db.auth.users.find(function (u) { return u.id === db.auth.currentId && u.active; }) || null;
  }

  function login(username, pass) {
    var u = db.auth.users.find(function (x) {
      return x.username.toLowerCase() === String(username || '').trim().toLowerCase() && x.active;
    });
    if (!u) return null;
    if (u.passHash !== hashPass(pass)) return null;
    db.auth.currentId = u.id;
    save();
    return u;
  }

  /* Login com servidor em primeiro lugar. Mantem a assinatura antiga de
     Store.login (sincrona, local) para as views que ja chamam direto, e
     adiciona este caminho para o app.js, que pode aguardar.

     Ordem: servidor (scrypt) -> local (FNV). So cai no local quando o
     servidor nao respondeu de rede; se ele respondeu recusando, a recusa
     vale e o login local nao acontece. Sem isso, um usuario apagado no
     servidor ainda entraria pela porta dos fundos. */
  function loginComServidor(username, pass) {
    if (!temServidor()) {
      var l = login(username, pass);
      return Promise.resolve(l ? { ok: true, usuario: l } : { ok: false, erro: 'Usuário ou senha incorretos.' });
    }
    return loginServidor(username, pass).then(function (res) {
      if (res && !res.erro) {
        // Sincroniza o usuario no cache local para currentUser() funcionar.
        var u = db.auth.users.find(function (x) {
          return x.username.toLowerCase() === String(username || '').trim().toLowerCase() && x.active;
        });
        if (u) { db.auth.currentId = u.id; save(); }
        return { ok: true, usuario: res };
      }
      if (res && res.erro) return { ok: false, erro: res.erro };
      // Sem resposta do servidor: modo local, para o caixa nao ficar preso.
      var l = login(username, pass);
      return l
        ? { ok: true, usuario: l, local: true }
        : { ok: false, erro: 'Servidor fora do ar e senha local não confere.' };
    });
  }

  function logout() { db.auth.currentId = null; save(); }

  function can(perm) {
    var u = currentUser();
    if (!u) return false;
    if (u.role === 'admin') return true;
    if (u.role === 'gerente') return ['pdv','sales','products','customers','finance','reports','stock','purchases','payables'].indexOf(perm) > -1;
    return u.role === 'caixa' ? ['pdv','sales','customers'].indexOf(perm) > -1 : ['pdv','products','stock'].indexOf(perm) > -1;
  }

  /* ---------------- turnos de caixa ---------------- */
  function openShift(opening) {
    var u = currentUser();
    var s = {
      id: uid('sh'),
      operatorId: u ? u.id : null,
      operator: u ? u.name : (db.operator || 'Operador'),
      openedAt: new Date().toISOString(),
      closedAt: null,
      opening: Number(opening) || 0,
      cashExpected: Number(opening) || 0,
      sales: [],
      movements: [],
      counted: null,
      difference: null,
      blind: false
    };
    db.shifts.unshift(s);
    db.shift = s;
    save();
    return s;
  }

  function closeShift(counted, blind) {
    if (!db.shift) return null;
    var s = db.shift;
    s.closedAt = new Date().toISOString();
    s.counted = Number(counted);
    s.blind = !!blind;
    s.difference = blind ? null : Math.round((Number(counted) - s.cashExpected) * 100) / 100;
    db.shift = null;
    save();
    return s;
  }

  function nextId(kind) {
    if (kind === 'sale') return db.counters.sale++;
    return db.counters.entry++;
  }

  /* ---------------- helpers de calculo ---------------- */
  function marginOf(p) {
    if (!p || !p.cost) return 0;
    return Math.round(((p.price - p.cost) / p.cost) * 1000) / 10;
  }

  function productByBarcode(code) {
    var c = String(code || '').trim();
    if (!c) return null;
    return db.products.find(function (p) {
      return (p.barcode && String(p.barcode).trim() === c) ||
             (p.code && String(p.code).trim() === c) ||
             String(p.id) === c;
    }) || null;
  }

  function categoryOf(id) {
    return db.categories.find(function (c) { return c.id === id; }) || { id: id, name: id || 'Sem categoria', emoji: '📦', color: '#64748b' };
  }

  /* ---------------- export / import ---------------- */
  function exportJSON() { return JSON.stringify(db, null, 2); }

  function importJSON(text) {
    var parsed = JSON.parse(text);
    db = migrate(parsed);
    save();
    return db;
  }

  function resetData(keepUsers) {
    var users = keepUsers ? db.auth.users : null;
    db = freshDb();
    if (users) db.auth.users = users;
    save();
    return db;
  }

  /* ---------------- ponte com o servidor ----------------
   *
   * Estas funcoes sao a ligacao que faltava entre o app e o mini PC. Todas
   * sao defensivas: se API nao existir (app aberto direto do disco) ou o
   * servidor nao responder, elas devolvem um resultado neutro em vez de
   * lancar. Um erro de rede nao pode derrubar a tela de venda. */

  function temServidor() {
    return typeof API !== 'undefined' && !!API.status;
  }

  /* Baixa produtos/clientes/config do servidor e substitui o local. Chamado
     depois do login, para que os 5 caixas partam da mesma verdade. */
  function puxarDoServidor() {
    if (!temServidor()) return Promise.resolve({ ok: false, motivo: 'sem servidor' });
    return API.base().then(function (b) {
      if (!b) return { ok: false, motivo: 'sem resposta' };
      if (Array.isArray(b.produtos) && b.produtos.length) db.products = b.produtos;
      if (Array.isArray(b.clientes)) db.customers = b.clientes;
      if (Array.isArray(b.fornecedores) && b.fornecedores.length) db.suppliers = b.fornecedores;
      if (b.config) db.config = Object.assign({}, db.config, b.config);
      if (typeof b.proximoSeq === 'number' && b.proximoSeq > (db.counters.sale || 0)) {
        db.counters.sale = b.proximoSeq;
      }
      save();
      return { ok: true, produtos: db.products.length, clientes: db.customers.length };
    }).catch(function () { return { ok: false, motivo: 'erro' }; });
  }

  /* Envia uma venda. Quem chama decide o que fazer com o resultado: a venda
     ja foi registrada localmente, entao falha aqui vira aviso, nao erro. */
  function enviarVenda(venda) {
    if (!temServidor()) return Promise.resolve({ ok: false, motivo: 'sem servidor' });
    return API.venda(venda).catch(function () { return { ok: false, motivo: 'erro' }; });
  }

  function sincronizar(colecao, lista) {
    if (!temServidor()) return Promise.resolve({ ok: false, motivo: 'sem servidor' });
    return API.salvar(colecao, lista).catch(function () { return { ok: false, motivo: 'erro' }; });
  }

  function migrarParaServidor() {
    if (!temServidor()) return Promise.resolve({ ok: false, erro: 'Servidor indisponível.' });
    return API.migrar(db);
  }

  global.Store = {
    STORAGE_KEY: STORAGE_KEY,
    CATEGORIES: CATEGORIES,
    load: load,
    save: save,
  commit: commit,
  usage: usage,
    get db() { return db; },
    set db(v) { db = v; },
    hashPass: hashPass,
    seedUsers: seedUsers,
    currentUser: currentUser,
    login: login,
    loginComServidor: loginComServidor,
    loginServidor: loginServidor,
    logout: logout,
    temServidor: temServidor,
    puxarDoServidor: puxarDoServidor,
    enviarVenda: enviarVenda,
    sincronizar: sincronizar,
    migrarParaServidor: migrarParaServidor,
    can: can,
    openShift: openShift,
    closeShift: closeShift,
    nextId: nextId,
    marginOf: marginOf,
    productByBarcode: productByBarcode,
    categoryOf: categoryOf,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetData: resetData,
    migrate: migrate,
    defaultConfig: defaultConfig,
    uid: uid
  };
})(window);

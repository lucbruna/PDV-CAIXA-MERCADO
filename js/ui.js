/* ==========================================================================
   ui.js — Kernel de interface: formatação, DOM, modais, toasts, gráficos, Pix.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- ícones (SVG inline, sem dependência externa) ---------------- */
  var P = {
    home:'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
    cart:'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6M9 21h.01M17 21h.01',
    receipt:'M5 3v18l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V3H5ZM9 8h6M9 12h6M9 16h4',
    box:'M12 2 3 7v10l9 5 9-5V7l-9-5ZM3 7l9 5 9-5M12 12v10',
    users:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75',
    wallet:'M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M3 7h16a2 2 0 0 1 2 2v2h-5a2 2 0 0 0 0 4h5v2',
    chart:'M3 3v18h18M7 15l4-5 3 3 5-7',
    gear:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
    truck:'M3 7h11v9H3V7ZM14 10h4l3 3v3h-7v-6ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    invoice:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h4',
    tag:'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 8.5h.01',
    star:'m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1L12 2Z',
    calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    scan:'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6',
    money:'M2 7h20v12H2V7ZM12 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 9.5v.01M18 14.5v.01',
    card:'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6ZM2 10h20M6 15h4',
    pix:'M12 2 4 7v10l8 5 8-5V7l-8-5ZM8.5 12h7M12 8.5v7',
    debt:'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    moon:'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    sun:'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    plus:'M12 5v14M5 12h14',
    minus:'M5 12h14',
    edit:'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z',
    trash:'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
    x:'M18 6 6 18M6 6l12 12',
    check:'m20 6-11 11-5-5',
    alert:'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
    search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
    down:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    up:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    user:'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    lock:'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4',
    print:'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8Z',
    refresh:'M21 2v6h-6M3 22v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L21 8M21 15a9 9 0 0 1-14.9 3.4L3 16',
    save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8',
    eye:'M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    filter:'M22 3H2l8 9.5V19l4 2v-8.5L22 3Z',
    weight:'M6.5 7h11M5 7l-3 13a1 1 0 0 0 1 1.2h18a1 1 0 0 0 1-1.2L19 7M9 11.5a3 3 0 0 1 6 0',
    layers:'m12 2 10 5-10 5L2 7l10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
    clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
    target:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    arrowR:'M5 12h14M12 5l7 7-7 7',
    arrowL:'M19 12H5M12 19l-7-7 7-7',
    copy:'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 15h6M9 11h3',
    bank:'M3 21h18M4 10v8M9 10v8M15 10v8M20 10v8M2 10 12 3l10 7H2Z',
    cart2:'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6',
    key:'M15 7a4 4 0 1 0-3.9 5L9 14.1V17H6v3H3v-3.6l5.1-5.1A4 4 0 0 1 15 7ZM17 6h.01',
    percent:'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    history:'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2'
  };

  /* Ícones lucide extraídos do design system Lucide (24x24, stroke).
     Mesma API de icon() — usados no PDV com o visual Vértice. */
  var L = {
    "Search": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><path d=\"m21 21-4.3-4.3\"/>",
        "Trash2": "<path d=\"M3 6h18\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\"/><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\"/>",
        "Plus": "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
        "Minus": "<path d=\"M5 12h14\"/>",
        "ShoppingBag": "<path d=\"M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z\"/><path d=\"M3 6h18\"/><path d=\"M16 10a4 4 0 0 1-8 0\"/>",
        "Tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
        "Pause": "<rect width=\"4\" height=\"16\" x=\"6\" y=\"4\"/><rect width=\"4\" height=\"16\" x=\"14\" y=\"4\"/>",
        "X": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>",
        "QrCode": "<rect width=\"5\" height=\"5\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"5\" height=\"5\" x=\"16\" y=\"3\" rx=\"1\"/><rect width=\"5\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\"/><path d=\"M21 16h-3a2 2 0 0 0-2 2v3\"/><path d=\"M21 21v.01\"/><path d=\"M12 7v3a2 2 0 0 1-2 2H7\"/><path d=\"M3 12h.01\"/><path d=\"M12 3h.01\"/><path d=\"M12 16v.01\"/><path d=\"M16 12h1\"/><path d=\"M21 12v.01\"/><path d=\"M12 21v-1\"/>",
        "CreditCard": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"5\" rx=\"2\"/><line x1=\"2\" x2=\"22\" y1=\"10\" y2=\"10\"/>",
        "Banknote": "<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><path d=\"M6 12h.01M18 12h.01\"/>",
        "UserPlus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><line x1=\"19\" x2=\"19\" y1=\"8\" y2=\"14\"/><line x1=\"22\" x2=\"16\" y1=\"11\" y2=\"11\"/>",
        "CheckCircle": "<path d=\"M21.801 10A10 10 0 1 1 17 3.335\"/><path d=\"m9 11 3 3L22 4\"/>",
        "Package": "<path d=\"m7.5 4.27 9 5.15\"/><path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/><path d=\"m3.3 7 8.7 5 8.7-5\"/><path d=\"M12 22V12\"/>",
        "Check": "<path d=\"M20 6 9 17l-5-5\"/>",
        "ChevronDown": "<path d=\"m6 9 6 6 6-6\"/>",
        "ChevronRight": "<path d=\"m9 18 6-6-6-6\"/>",
        "AlertTriangle": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/>",
        "Printer": "<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\"/><rect width=\"12\" height=\"8\" x=\"6\" y=\"14\" rx=\"1\"/>",
        "Lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
        "Unlock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/>",
        "Wallet": "<path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\"/><path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\"/>",
        "Layers": "<path d=\"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z\"/><path d=\"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65\"/><path d=\"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65\"/>",
        "Scale": "<path d=\"m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z\"/><path d=\"m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z\"/><path d=\"M7 21h10\"/><path d=\"M12 3v18\"/><path d=\"M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2\"/>",
        "Percent": "<line x1=\"19\" x2=\"5\" y1=\"5\" y2=\"19\"/><circle cx=\"6.5\" cy=\"6.5\" r=\"2.5\"/><circle cx=\"17.5\" cy=\"17.5\" r=\"2.5\"/>",
        "Clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>",
        "RefreshCw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>",
        "ArrowUp": "<path d=\"m5 12 7-7 7 7\"/><path d=\"M12 19V5\"/>",
        "ArrowDown": "<path d=\"M12 5v14\"/><path d=\"m19 12-7 7-7-7\"/>",
        "Sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41\"/>",
        "Moon": "<path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\"/>",
        "LogOut": "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/><polyline points=\"16 17 21 12 16 7\"/><line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\"/>",
        "Settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
        "Home": "<path d=\"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><polyline points=\"9 22 9 12 15 12 15 22\"/>",
        "ShoppingCart": "<circle cx=\"8\" cy=\"21\" r=\"1\"/><circle cx=\"19\" cy=\"21\" r=\"1\"/><path d=\"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12\"/>",
        "Receipt": "<path d=\"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z\"/><path d=\"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8\"/><path d=\"M12 17.5v-11\"/>",
        "Box": "<path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/><path d=\"m3.3 7 8.7 5 8.7-5\"/><path d=\"M12 22V12\"/>",
        "Users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>",
        "Truck": "<path d=\"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2\"/><path d=\"M15 18H9\"/><path d=\"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14\"/><circle cx=\"17\" cy=\"18\" r=\"2\"/><circle cx=\"7\" cy=\"18\" r=\"2\"/>",
        "FileText": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\"/><path d=\"M14 2v4a2 2 0 0 0 2 2h4\"/><path d=\"M10 9H8\"/><path d=\"M16 13H8\"/><path d=\"M16 17H8\"/>",
        "BarChart3": "<path d=\"M3 3v18h18\"/><path d=\"M18 17V9\"/><path d=\"M13 17V5\"/><path d=\"M8 17v-3\"/>",
        "PieChart": "<path d=\"M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>",
        "HandCoins": "<path d=\"M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17\"/><path d=\"m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-3-3l-3.6 3.4\"/><circle cx=\"16\" cy=\"7\" r=\"2\"/>",
        "Landmark": "<line x1=\"3\" x2=\"21\" y1=\"22\" y2=\"22\"/><line x1=\"6\" x2=\"6\" y1=\"18\" y2=\"11\"/><line x1=\"10\" x2=\"10\" y1=\"18\" y2=\"11\"/><line x1=\"14\" x2=\"14\" y1=\"18\" y2=\"11\"/><line x1=\"18\" x2=\"18\" y1=\"18\" y2=\"11\"/><polygon points=\"12 2 20 7 4 7\"/>",
        "UserCog": "<path d=\"M10 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z\"/><path d=\"M13.7 21a2 2 0 0 0 .3-.9 1.95 1.95 0 0 0 .1-.9 1.95 1.95 0 0 0-1-1.7 2 2 0 0 0-.9-.3H9a2 2 0 0 0-1 1.7 1.95 1.95 0 0 0 .1.9 2 2 0 0 0 .3.9\"/><path d=\"M2 18a2 2 0 0 0 2 2\"/><path d=\"M20 18a2 2 0 0 0-2 2\"/><path d=\"M14 18a2 2 0 0 0-2-2\"/><path d=\"M18 18a2 2 0 0 0 2-2\"/><path d=\"M20 14a2 2 0 0 0-2-2\"/><path d=\"M16 14a2 2 0 0 0-2-2\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
        "Save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"/><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"/>",
        "Info": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>",
        "Eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
        "Copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
        "Upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"17 8 12 3 7 8\"/><line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\"/>",
        "Download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\"/>",
        "Pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>",
        "Filter": "<polygon points=\"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3\"/>",
        "Target": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"6\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>",
        "History": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/><path d=\"M12 7v5l4 2\"/>",
        "ArrowRight": "<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>",
        "Menu": "<path d=\"M4 12h16\"/><path d=\"M4 6h16\"/><path d=\"M4 18h16\"/>",
        "User": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>"
  };

  function icon(name, size, sw) {
    var raw = P[name] || L[name];
    var s = size || 16;
    if (!raw) return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '"></svg>';
    var attrs = 'viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="' + (sw || 1.9) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    // mapas P: um path único com comandos separados por " M"; mapas L: markup lucide crua
    if (L[name] && !P[name]) return '<svg ' + attrs + '>' + raw + '</svg>';
    return '<svg ' + attrs + '>' +
      raw.split(' M').map(function (seg, i) { return (i ? '<path d="M' : '<path d="') + seg + '"/>'; }).join('') +
      '</svg>';
  }

  /* ---------------- formatação ---------------- */
  var BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var NUM2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function money(n) { return BRL.format(Number(n) || 0); }
  function num(n) { return NUM2.format(Number(n) || 0); }
  function pct(n) { return (Number(n) || 0).toFixed(1).replace('.', ',') + '%'; }

  function parseNum(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    s = s.replace(/[^\d,.-]/g, '');
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function dt(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d)) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function dateOnly(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR');
  }
  function today() { return new Date().toDateString(); }
  function daysBetween(a, b) {
    return Math.ceil((new Date(b) - new Date(a)) / 86400000);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- DOM ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------------- toasts ---------------- */
  function toast(msg, kind, ms) {
    var wrap = $('#toastWrap');
    if (!wrap) {
      wrap = el('div', { id: 'toastWrap', class: 'toast-wrap' });
      document.body.appendChild(wrap);
    }
    var k = kind || 'ok';
    var ic = k === 'ok' ? 'check' : k === 'err' ? 'alert' : k === 'warn' ? 'alert' : 'info';
    var t = el('div', { class: 'toast ' + k }, icon(ic, 17) + '<span>' + esc(msg) + '</span>');
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 220);
    }, ms || 3200);
  }

  /* ---------------- modal ---------------- */
  var modalStack = [];

  function modal(opts) {
    var ov = el('div', { class: 'overlay' });
    var m = el('div', { class: 'modal ' + (opts.size ? 'w-' + opts.size : '') });

    var head = '';
    if (opts.title) {
      head = '<div class="modal-head"><div><h2>' + icon(opts.icon || 'info', 17) + esc(opts.title) + '</h2>' +
        (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
        '<button class="icon-btn" data-close aria-label="Fechar">' + icon('x', 17) + '</button></div>';
    }

    var tabs = '';
    if (opts.tabs && opts.tabs.length) {
      tabs = '<div class="modal-tabs">' + opts.tabs.map(function (t, i) {
        return '<button class="mtab' + (i === 0 ? ' active' : '') + '" data-tab="' + esc(t.id) + '">' +
          (t.icon ? icon(t.icon, 15) : '') + esc(t.label) + '</button>';
      }).join('') + '</div>';
    }

    var body = '<div class="modal-body">' + (opts.body || '') + '</div>';

    var foot = '';
    if (opts.footer !== false) {
      foot = '<div class="modal-foot">' +
        (opts.footLeft ? '<div class="left">' + opts.footLeft + '</div>' : '') +
        '<button class="btn ghost" data-close>Cancelar</button>' +
        (opts.confirmText ? '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-confirm>' + esc(opts.confirmText) + '</button>' : '') +
        '</div>';
    }

    m.innerHTML = head + tabs + body + foot;
    ov.appendChild(m);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });

    function close() {
      var i = modalStack.indexOf(close);
      if (i > -1) modalStack.splice(i, 1);
      ov.classList.remove('show');
      setTimeout(function () { ov.remove(); }, 200);
      if (opts.onClose) opts.onClose();
    }

    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('[data-close]')) { close(); return; }
      var tab = e.target.closest('.mtab');
      if (tab) {
        $$('.mtab', m).forEach(function (b) { b.classList.toggle('active', b === tab); });
        $$('.mpane', m).forEach(function (p) { p.classList.toggle('active', p.dataset.pane === tab.dataset.tab); });
        return;
      }
      if (e.target.closest('[data-confirm]')) {
        if (!opts.onConfirm || opts.onConfirm(m) !== false) close();
      }
    });

    if (opts.onMount) opts.onMount(m, close);
    var first = m.querySelector('input:not([type=hidden]),select,textarea');
    if (first && !opts.noFocus) setTimeout(function () { first.focus(); }, 60);

    modalStack.push(close);
    return { root: m, overlay: ov, close: close };
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      var kind = opts.kind || 'info';
      var ic = kind === 'danger' ? 'alert' : kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info';
      // Guard: um Promise só resolve uma vez. close() dispara onClose, então sem
      // esta trava o resolve(false) do onClose venceria o resolve(true) do botão.
      var settled = false;
      function done(v) { if (settled) return; settled = true; resolve(v); }

      modal({
        title: null, size: 'sm', body: '',
        // footer:false — o confirm cria o proprio rodape em onMount. Sem isso o
        // modal.js ainda renderiza um "Cancelar" extra que fecha o dialogo sozinho.
        footer: false,
        body: '<div class="confirm-box"><div class="confirm-icon ' + kind + '">' + icon(ic, 23) + '</div>' +
          '<h3 style="margin:0 0 9px;font-size:16px;font-weight:800">' + esc(opts.title) + '</h3>' +
          '<p>' + (opts.html || esc(opts.message || '')) + '</p></div>',
        footer: false,
        onMount: function (root, close) {
          var bar = el('div', { class: 'modal-foot' });
          bar.innerHTML = '<button class="btn ghost" data-no>Cancelar</button>' +
            '<button class="btn ' + (kind === 'danger' ? 'danger' : 'primary') + '" data-yes>' + esc(opts.confirmText || 'Confirmar') + '</button>';
          root.appendChild(bar);
          bar.querySelector('[data-no]').onclick = function () { done(false); close(); };
          bar.querySelector('[data-yes]').onclick = function () { done(true); close(); };
          setTimeout(function () { bar.querySelector('[data-yes]').focus(); }, 60);
        },
        onClose: function () { done(false); }
      });
    });
  }

  function promptText(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (settled) return; settled = true; resolve(v); }

      modal({
        title: opts.title, icon: opts.icon || 'edit', size: 'sm',
        body: '<div class="form-grid"><div class="full"><label class="lbl">' + esc(opts.label || 'Valor') + '</label>' +
          '<input class="field" id="__prompt" ' +
          /* number nativo rejeita "40,5"; para valores em pt-BR usamos text+inputmode */
          ((opts.type === 'number' || opts.type === 'money') ? 'type="text" inputmode="decimal" autocomplete="off"' : 'type="' + esc(opts.type || 'text') + '"') +
          (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + ' value="' + esc(opts.value || '') + '"></div></div>' +
          (opts.hint ? '<div class="modal-note">' + esc(opts.hint) + '</div>' : ''),
        confirmText: opts.confirmText || 'Confirmar',
        danger: opts.danger,
        onMount: function (root) {
          var i = root.querySelector('#__prompt');
          if (opts.type === 'number' || opts.type === 'money') i.value = opts.value != null ? opts.value : '';
          if (opts.select) {
            i.outerHTML = '<select class="field" id="__prompt">' + opts.select.map(function (o) {
              return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
            }).join('') + '</select>';
          }
          i.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              done(i.value);
              root.closest('.overlay').querySelector('[data-confirm]').click();
            }
          });
        },
        onConfirm: function (root) {
          var v = root.querySelector('#__prompt').value;
          if (opts.required && !String(v).trim()) { toast('Preencha o campo.', 'err'); return false; }
          done(v);
        },
        onClose: function () { done(null); }
      });
    });
  }

  /* ---------------- form helpers ---------------- */
  function formData(root) {
    var out = {};
    $$('input,select,textarea', root).forEach(function (f) {
      if (!f.name) return;
      if (f.type === 'checkbox') out[f.name] = f.checked;
      else if (f.type === 'radio') { if (f.checked) out[f.name] = f.value; }
      else if (f.type === 'number') out[f.name] = parseNum(f.value);
      else out[f.name] = f.value;
    });
    return out;
  }

  function field(label, name, value, opts) {
    opts = opts || {};
    var v = esc(value == null ? '' : value);
    var input;
    if (opts.type === 'select') {
      input = '<select class="field" name="' + name + '">' + (opts.options || []).map(function (o) {
        var val = o.value != null ? o.value : o;
        var lb = o.label != null ? o.label : o;
        return '<option value="' + esc(val) + '"' + (String(val) === String(value) ? ' selected' : '') + '>' + esc(lb) + '</option>';
      }).join('') + '</select>';
    } else if (opts.type === 'textarea') {
      input = '<textarea class="field" name="' + name + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.placeholder || '') + '">' + v + '</textarea>';
    } else {
      /* 'money' usa text+inputmode em vez de type=number: o number nativo
         REJEITA "40,5" (exige ponto) e devolve string vazia, o que quebrava o
         preenchimento automático de valores em pt-BR. parseNum() lê os dois. */
      var type = opts.type === 'money' ? 'text' : (opts.type || 'text');
      var extra = opts.type === 'money' ? ' inputmode="decimal" autocomplete="off"' : '';
      input = '<input class="field" name="' + name + '" type="' + type + '" value="' + v + '"' +
        (opts.step ? ' step="' + opts.step + '"' : '') + (opts.min != null ? ' min="' + opts.min + '"' : '') +
        (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
        (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') + extra + '>';
    }
    return '<div' + (opts.full ? ' class="full"' : '') + '><label class="lbl">' + esc(label) + '</label>' + input +
      (opts.hint ? '<div class="tiny muted" style="margin-top:4px">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }

  function checkbox(label, name, checked, hint) {
    return '<div class="full"><label class="check"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>' +
      (hint ? '<div class="tiny muted" style="margin-top:4px;margin-left:24px">' + esc(hint) + '</div>' : '') + '</div>';
  }

  /* ---------------- gráficos SVG ---------------- */
  var PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4'];

  function lineChart(data, opts) {
    opts = opts || {};
    var W = 700, H = opts.height || 190, P = { t: 14, r: 12, b: 26, l: 44 };
    if (!data.length) return '<div class="empty">Sem dados para o gráfico.</div>';
    var max = Math.max.apply(null, data.map(function (d) { return d.v; }).concat([1]));
    var innerW = W - P.l - P.r, innerH = H - P.t - P.b;
    var step = data.length > 1 ? innerW / (data.length - 1) : 0;

    var pts = data.map(function (d, i) {
      var x = P.l + (data.length > 1 ? i * step : innerW / 2);
      var y = P.t + innerH - (d.v / max) * innerH;
      return { x: x, y: y, d: d };
    });

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (P.t + innerH) + ' L' + pts[0].x.toFixed(1) + ' ' + (P.t + innerH) + ' Z';

    var grid = [0, 0.5, 1].map(function (f) {
      var y = P.t + innerH - f * innerH;
      return '<line x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (P.l - 7) + '" y="' + (y + 3) + '" fill="var(--text-3)" font-size="9" text-anchor="end">' + shortMoney(max * f) + '</text>';
    }).join('');

    var dots = pts.map(function (p) {
      return '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>' +
        esc(p.d.l + ': ' + money(p.d.v)) + '</title></circle>';
    }).join('');

    var labels = data.map(function (d, i) {
      if (data.length > 12 && i % 2) return '';
      var x = pts[i].x;
      return '<text x="' + x + '" y="' + (H - 7) + '" fill="var(--text-3)" font-size="9" text-anchor="middle">' + esc(d.l) + '</text>';
    }).join('');

    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="height:' + H + 'px">' +
      '<defs><linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".3"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#lg1)"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + '</svg></div>';
  }

  function barChart(data, opts) {
    opts = opts || {};
    if (!data.length) return '<div class="empty">Sem dados para o gráfico.</div>';
    var max = Math.max.apply(null, data.map(function (d) { return d.v; }).concat([1]));
    return '<div class="bar-list">' + data.map(function (d, i) {
      var c = d.c || PALETTE[i % PALETTE.length];
      return '<div class="bar-row"><span class="nm" title="' + esc(d.l) + '">' + esc(d.l) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + Math.max(2, (d.v / max) * 100) + '%;background:' + c + '"></span></span>' +
        '<span class="vl">' + (opts.fmt === 'count' ? d.v : money(d.v)) + '</span></div>';
    }).join('') + '</div>';
  }

  function donutChart(data) {
    var total = data.reduce(function (a, d) { return a + d.v; }, 0);
    if (!total) return '<div class="empty">Sem dados.</div>';
    var R = 52, C = 2 * Math.PI * R, off = 0;
    var segs = data.map(function (d, i) {
      var frac = d.v / total;
      var s = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + (d.c || PALETTE[i % PALETTE.length]) +
        '" stroke-width="17" stroke-dasharray="' + (frac * C).toFixed(2) + ' ' + C.toFixed(2) +
        '" stroke-dashoffset="' + (-off * C).toFixed(2) + '" transform="rotate(-90 70 70)"><title>' + esc(d.l + ': ' + money(d.v) + ' (' + pct(frac * 100) + ')') + '</title></circle>';
      off += frac;
      return s;
    }).join('');
    return '<div class="row" style="gap:18px;align-items:center">' +
      '<svg width="140" height="140" viewBox="0 0 140 140" style="flex-shrink:0">' + segs +
      '<text x="70" y="66" text-anchor="middle" fill="var(--text-3)" font-size="9" font-weight="700">TOTAL</text>' +
      '<text x="70" y="82" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="800">' + shortMoney(total) + '</text></svg>' +
      '<div style="flex:1;min-width:120px"><div class="legend">' + data.map(function (d, i) {
        return '<span><i style="background:' + (d.c || PALETTE[i % PALETTE.length]) + '"></i>' + esc(d.l) + ' <b class="num" style="color:var(--text)">' + pct(d.v / total * 100) + '</b></span>';
      }).join('') + '</div></div></div>';
  }

  function shortMoney(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000000) return 'R$' + (n / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (Math.abs(n) >= 1000) return 'R$' + (n / 1000).toFixed(1).replace('.', ',') + 'k';
    return 'R$' + n.toFixed(0);
  }

  function sparkline(values, color) {
    if (!values.length) return '';
    var W = 100, H = 30, max = Math.max.apply(null, values.concat([1]));
    var pts = values.map(function (v, i) {
      return (values.length > 1 ? (i / (values.length - 1)) * W : W / 2).toFixed(1) + ' ' + (H - (v / max) * (H - 4) - 2).toFixed(1);
    });
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  /* ---------------- Pix BR Code ---------------- */
  function pixCrc(payload) {
    var crc = 0xFFFF;
    for (var i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
    }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }

  function tlv(id, val) {
    if (val == null || val === '') return '';
    var v = String(val);
    return String(id).length + String(id) + String(v.length).padStart(2, '0') + v;
  }

  function normalizePixKey(key) {
    var k = String(key || '').trim();
    if (!k) return '';
    if (/^\d{11}$/.test(k)) return k;
    if (/^\d{10,14}$/.test(k)) return '+55' + k;
    var norm = k.toUpperCase()
      .replace(/[^A-Z0-9@.+-]/g, '')
      .replace(/[+.-]/g, '');
    if (/^\d+$/.test(norm) && norm.length > 10) {
      if (norm.length === 11) return norm;
      return '+55' + norm;
    }
    return k;
  }

  /** Gera payload Pix copia-e-cola (BR Code) estático. */
  function pixPayload(amount, txid) {
    var db = global.Store.db;
    var cfg = (db && db.config && db.config.pix) || {};
    var key = normalizePixKey(cfg.pixKey);
    if (!key) return '';

    var name = (db.config.storeName || 'LOJA').toUpperCase().slice(0, 25);
    var city = (cfg.city || 'SAO PAULO').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 15) || 'SAO PAULO';
    var amt = round2(amount);
    var id = '***';

    var mai =
      tlv('00', 'BR.GOV.BCB.PIX') +
      tlv('01', key) +
      tlv('02', amt > 0 ? amt.toFixed(2) : '') +
      tlv('03', amt > 0 ? 'SUDAM' + txid : '') +
      tlv('04', amt > 0 ? 'PDV' + txid : '') +
      tlv('05', name) +
      tlv('06', city) +
      tlv('07', '***');

    return mai + '6304' + pixCrc(mai + '6304') + id;
  }

  function renderPixQr(container, amount, txid) {
    if (!container) return;
    var payload = pixPayload(amount, txid);
    container.innerHTML = '';
    if (!payload) {
      container.innerHTML = '<div class="tiny muted" style="padding:14px">Configure a chave Pix em Configurações → Fiscal.</div>';
      return;
    }
    /* QR.render já faz o try/catch e devolve false em falha — o fallback
       copia-e-cola abaixo só entra se o gerador realmente não existir. */
    var drew = global.QR && global.QR.render(container, payload, {
      tamanho: 170, escuro: '#0d1520', claro: '#ffffff'
    });
    if (drew) { container.dataset.payload = payload; return; }
    var pre = document.createElement('div');
    pre.className = 'pix-copy';
    pre.textContent = payload;
    container.appendChild(pre);
    container.dataset.payload = payload;
  }

  function copyPix(payload) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(payload);
    }
    var ta = document.createElement('textarea');
    ta.value = payload; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); document.body.removeChild(ta); return Promise.resolve(); }
    catch (e) { document.body.removeChild(ta); return Promise.reject(e); }
  }

  /* ---------------- impressão ---------------- */
  function printHTML(html, widthMm) {
    var w = window.open('', '_blank', 'width=420,height=680');
    if (!w) { toast('Permita pop-ups para este site para imprimir.', 'warn'); return false; }
    var mm = widthMm || 80;
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Impressão</title>' +
      '<style>' +
      '@page{size:' + mm + 'mm auto;margin:2mm}' +
      'body{font:11.5px/1.35 "Consolas",monospace;margin:0;padding:2mm;color:#000;width:' + (mm - 6) + 'mm}' +
      '.c{text-align:center}.r{display:flex;justify-content:space-between;gap:4px;margin:2px 0}' +
      '.sep{border-top:1px dashed #000;margin:6px 0}.b{font-weight:700;font-size:12.5px}' +
      'table{width:100%;border-collapse:collapse;font-size:10.5px}td{padding:1px 0;vertical-align:top}' +
      'td:last-child{text-align:right;white-space:nowrap}' +
      'button{margin:8px auto;display:block;padding:7px 16px;font:inherit;cursor:pointer}' +
      '@media print{button{display:none}}' +
      '</style></head><body>' + html +
      '<button onclick="window.print()">Imprimir</button>' +
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},180)})<\/script>' +
      '</body></html>');
    w.document.close();
    return true;
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
  }

  function downloadCSV(filename, rows) {
    download(filename, '\uFEFF' + toCSV(rows), 'text/csv;charset=utf-8');
  }

  /* ---------------- utilidades de UI ---------------- */
  function openImportDialog(onLoad) {
    var inp = $('#importFile');
    if (!inp) {
      inp = el('input', { type: 'file', accept: '.json,application/json', id: 'importFile', style: 'display:none' });
      document.body.appendChild(inp);
    }
    inp.value = '';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { onLoad(String(fr.result)); };
      fr.readAsText(f);
    };
    inp.click();
  }

  function downloadBackup() {
    var db = global.Store.db;
    download('sudam-backup-' + new Date().toISOString().slice(0, 10) + '.json', global.Store.exportJSON(), 'application/json');
    toast('Backup exportado. Guarde o arquivo em local seguro.', 'ok');
  }

  global.UI = {
    icon: icon, PALETTE: PALETTE, LUCIDE: L,
    money: money, num: num, pct: pct, parseNum: parseNum, round2: round2,
    dt: dt, dateOnly: dateOnly, today: today, daysBetween: daysBetween, esc: esc,
    $: $, $$: $$, el: el,
    toast: toast, modal: modal, confirm: confirm, promptText: promptText,
    formData: formData, field: field, checkbox: checkbox,
    lineChart: lineChart, barChart: barChart, donutChart: donutChart, sparkline: sparkline, shortMoney: shortMoney,
    pixPayload: pixPayload, renderPixQr: renderPixQr, copyPix: copyPix, normalizePixKey: normalizePixKey,
    printHTML: printHTML, download: download, downloadCSV: downloadCSV,
    openImportDialog: openImportDialog, downloadBackup: downloadBackup
  };
})(window);

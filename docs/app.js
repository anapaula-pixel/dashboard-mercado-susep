/* Mercado Akad: dashboard de dados do SES/SUSEP.
   Lê data/ses.json (gerado por scripts/build_data.py) e calcula tudo no navegador. */
(function () {
  "use strict";

  const AKAD = "02798";
  const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const CORES_CONC = ["--s1", "--s2", "--s3", "--s4"];
  // Mosaico do Brasil: [UF, linha, coluna]
  const MOSAICO = [
    ["RR", 0, 2], ["AP", 0, 4],
    ["AM", 1, 1], ["PA", 1, 3], ["MA", 1, 4], ["CE", 1, 5], ["RN", 1, 6],
    ["AC", 2, 0], ["RO", 2, 1], ["MT", 2, 2], ["TO", 2, 3], ["PI", 2, 4], ["PE", 2, 5], ["PB", 2, 6],
    ["MS", 3, 2], ["GO", 3, 3], ["DF", 3, 4], ["BA", 3, 5], ["AL", 3, 6],
    ["SP", 4, 3], ["MG", 4, 4], ["ES", 4, 5], ["SE", 4, 6],
    ["PR", 5, 3], ["RJ", 5, 4],
    ["SC", 6, 3],
    ["RS", 7, 3],
  ];

  let D = null;          // dados brutos
  const S = {            // estado da tela
    aba: "geral",
    periodo: "ytd",
    ano: null,
    de: null,
    ate: null,
    linha: "todas",
    concSels: null,
    pilha: [],
    ufMetrica: "share",
    uf: "todos",
    ufOrdR: "merc",
    ufTodos: false,
    rankOrd: { col: "pos", dir: 1 },
    geralOrd: "pe",
    geralTab: null,
    geralModo: "resumo",
    geralSel: null,
  };
  let IDX = null;        // índices derivados

  const $ = (s, el = document) => el.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Formatação ---------- */
  const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  function reais(vMil) {
    if (vMil == null || !isFinite(vMil)) return "–";
    const a = Math.abs(vMil);
    if (a >= 1e6) return "R$ " + nf1.format(vMil / 1e6) + " bi";
    if (a >= 1e3) return "R$ " + nf1.format(vMil / 1e3) + " mi";
    return "R$ " + nf0.format(vMil) + " mil";
  }
  function reaisCurto(vMil) {
    const a = Math.abs(vMil);
    if (a >= 1e6) return nf1.format(vMil / 1e6) + " bi";
    if (a >= 1e3) return nf0.format(vMil / 1e3) + " mi";
    return nf0.format(vMil) + " mil";
  }
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? "–" : x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%");
  function cresc(cur, prev) {
    if (prev == null || prev <= 0 || cur == null || cur <= 0) return null;
    return (cur / prev - 1) * 100;
  }
  function varHtml(x, sufixo = "%", d = 1) {
    if (x == null || !isFinite(x)) return '<span class="var zero">–</span>';
    if (sufixo === "%" && x > 999) return '<span class="var up" title="Base de comparação muito pequena">> +999%</span>';
    const cls = Math.abs(x) < 0.05 ? "zero" : x > 0 ? "up" : "down";
    const sinal = x > 0 ? "+" : x < 0 ? "−" : "";
    const v = Math.abs(x).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
    return `<span class="var ${cls}">${sinal}${v}${sufixo}</span>`;
  }
  const ppHtml = (x) => varHtml(x, " p.p.", 1);
  function mesLabel(i, longo) {
    const m = D.meses[i];
    const mm = +m.slice(4) - 1;
    return longo ? `${MESES_PT[mm]}/${m.slice(0, 4)}` : `${MESES_PT[mm]}/${m.slice(2, 4)}`;
  }
  function periodoLabel(a, b) {
    const ma = D.meses[a], mb = D.meses[b];
    if (ma.slice(0, 4) === mb.slice(0, 4)) {
      if (ma.endsWith("01") && mb.endsWith("12")) return ma.slice(0, 4);
      return `${MESES_PT[+ma.slice(4) - 1]}–${MESES_PT[+mb.slice(4) - 1]}/${mb.slice(0, 4)}`;
    }
    return `${mesLabel(a, true)} a ${mesLabel(b, true)}`;
  }

  function nomeBonito(n) {
    let s = n.replace(/\s+/g, " ").trim()
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\b(S\.?\s?\/?A\.?|SA)\s*$/i, "")
      .replace(/[\s,.-]+$/, "").trim();
    const peq = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
    return s.split(" ").map((w, i) => {
      const W = w.toUpperCase();
      if (i > 0 && peq.has(W)) return W.toLowerCase();
      if (W.length <= 3 && /^[A-Z&]+$/.test(W)) return W;
      return W.charAt(0) + W.slice(1).toLowerCase();
    }).join(" ");
  }

  /* ---------- Índices ---------- */
  function montarIndices() {
    const nR = D.ramos.length;
    const porRamo = Array.from({ length: nR }, () => []);
    for (const r of D.seg) porRamo[r[2]].push(r);
    const ramoIdx = Object.fromEntries(D.ramos.map((r, i) => [r[0], i]));
    const linhas = D.linhas.map((l) => ({ ...l, idx: l.ramos.map((c) => ramoIdx[c]).filter((x) => x != null) }));
    const linhaPorId = Object.fromEntries(linhas.map((l) => [l.id, l]));
    const akadCi = D.cias.findIndex((c) => c[0] === AKAD);
    const ufaPorRamo = Array.from({ length: nR }, () => []);
    for (const r of D.ufa) ufaPorRamo[r[1]].push(r);
    const ufmPorRamo = Array.from({ length: nR }, () => []);
    for (const r of D.ufm) ufmPorRamo[r[1]].push(r);
    IDX = { porRamo, ramoIdx, linhas, linhaPorId, akadCi, ufaPorRamo, ufmPorRamo, todos: D.ramos.map((_, i) => i) };
    montarEntidades();
  }
  function montarEntidades() {
    // concorrentes sempre por seguradora
    const chave = new Array(D.cias.length);
    const nome = new Map();
    D.cias.forEach((c, i) => {
      const [cod, n] = c;
      chave[i] = cod;
      nome.set(cod, cod === AKAD ? "Akad" : nomeBonito(n));
    });
    IDX.chave = chave;
    IDX.nome = nome;
  }
  const nomeEnt = (k) => IDX.nome.get(k) || k;

  /* ---------- Período ---------- */
  function periodo() {
    const ult = D.meses.length - 1;
    const anoUlt = D.meses[ult].slice(0, 4);
    let a, b;
    if (S.periodo === "ytd") {
      a = D.meses.indexOf(anoUlt + "01"); b = ult;
    } else if (S.periodo === "12m") {
      b = ult; a = Math.max(0, ult - 11);
    } else if (S.periodo === "ano") {
      a = D.meses.indexOf(S.ano + "01"); b = D.meses.indexOf(S.ano + "12");
      if (b < 0) b = ult;
    } else {
      a = Math.min(S.de, S.ate); b = Math.max(S.de, S.ate);
    }
    const pa = a - 12, pb = b - 12;
    return { a, b, pa: pa >= 0 ? pa : null, pb: pa >= 0 ? pb : null };
  }

  /* ---------- Agregações ---------- */
  // Soma por entidade: [pe, pg, so, dc]
  function agg(ramos, a, b) {
    const m = new Map();
    if (a == null) return m;
    for (const ri of ramos) {
      for (const r of IDX.porRamo[ri]) {
        if (r[0] < a || r[0] > b) continue;
        const k = IDX.chave[r[1]];
        let x = m.get(k);
        if (!x) { x = [0, 0, 0, 0]; m.set(k, x); }
        x[0] += r[3]; x[1] += r[4]; x[2] += r[5]; x[3] += r[6];
      }
    }
    return m;
  }
  function total(m) {
    const t = [0, 0, 0, 0];
    for (const x of m.values()) for (let i = 0; i < 4; i++) t[i] += x[i];
    return t;
  }
  function ranking(m) {
    return [...m.entries()].filter(([, x]) => x[0] > 0).sort((p, q) => q[1][0] - p[1][0]).map(([k]) => k);
  }
  // Resumo de um conjunto de ramos no período e no comparativo
  function resumo(ramos, P) {
    const cur = agg(ramos, P.a, P.b);
    const prev = agg(ramos, P.pa, P.pb);
    const tc = total(cur), tp = total(prev);
    const rk = ranking(cur), rkp = ranking(prev);
    return { cur, prev, tc, tp, rk, rkp };
  }
  function infoEnt(R, k) {
    const c = R.cur.get(k) || [0, 0, 0, 0];
    const p = R.prev.get(k) || [0, 0, 0, 0];
    const share = R.tc[0] > 0 && c[0] > 0 ? (c[0] / R.tc[0]) * 100 : null;
    const shareP = R.tp[0] > 0 && p[0] > 0 ? (p[0] / R.tp[0]) * 100 : null;
    const pos = R.rk.indexOf(k);
    const posP = R.rkp.indexOf(k);
    return {
      pe: c[0], pg: c[1], so: c[2], dc: c[3], peP: p[0],
      cresc: cresc(c[0], p[0]),
      share, shareP, dShare: share != null && shareP != null ? share - shareP : null,
      pos: pos >= 0 ? pos + 1 : null, posP: posP >= 0 ? posP + 1 : null,
      sin: c[1] > 0 ? (c[2] / c[1]) * 100 : null,
      com: c[1] > 0 ? (c[3] / c[1]) * 100 : null,
    };
  }
  // Série mensal por entidade (pe)
  function serieMensal(ramos, chaves) {
    const n = D.meses.length;
    const mercado = new Float64Array(n);
    const ent = new Map(chaves.map((k) => [k, new Float64Array(n)]));
    for (const ri of ramos) for (const r of IDX.porRamo[ri]) {
      mercado[r[0]] += r[3];
      const s = ent.get(IDX.chave[r[1]]);
      if (s) s[r[0]] += r[3];
    }
    return { mercado, ent };
  }
  const movel12 = (arr) => {
    const out = new Array(arr.length).fill(null);
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
      s += arr[i];
      if (i >= 12) s -= arr[i - 12];
      if (i >= 11) out[i] = s;
    }
    return out;
  };
  function porAno(arr) {
    const anos = new Map();
    arr.forEach((v, i) => { const y = D.meses[i].slice(0, 4); anos.set(y, (anos.get(y) || 0) + v); });
    return anos;
  }

  /* ---------- Chips e células ---------- */
  function chipPos(pos, n) {
    if (!pos) return '<span class="chip">sem prêmio</span>';
    if (pos === 1) return '<span class="chip lider">1º · líder</span>';
    if (pos <= 3) return `<span class="chip top">${pos}º</span>`;
    return `<span class="chip">${pos}º${n ? ` de ${n}` : ""}</span>`;
  }
  function deltaPos(pos, posP) {
    if (!pos || !posP || pos === posP) return "";
    const d = posP - pos;
    return d > 0 ? ` <span class="var up" title="Subiu ${d} posição(ões)">▲${d}</span>` : ` <span class="var down" title="Caiu ${-d} posição(ões)">▼${-d}</span>`;
  }

  /* ---------- Gráficos (SVG) ---------- */
  const tip = () => $("#tip");
  function mostrarTip(html, ev) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    t.style.left = Math.max(8, x) + "px";
    t.style.top = Math.max(8, y) + "px";
  }
  const esconderTip = () => { tip().hidden = true; };

  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  /** Gráfico de linhas. opts: {series:[{nome,cor,valores}], fmt, fmtEixo, banda:[a,b], inicio} */
  function linhas(el, opts) {
    const W = Math.max(320, el.clientWidth || 600), H = opts.altura || 260;
    const m = { t: 10, r: 14, b: 26, l: 52 };
    const n = D.meses.length;
    const i0 = opts.inicio || 0;
    let max = 0, min = 0;
    for (const s of opts.series) for (let i = i0; i < n; i++) { const v = s.valores[i]; if (v != null) { max = Math.max(max, v); min = Math.min(min, v); } }
    const passo = niceMax((max * 1.02) / 4);
    max = passo * 4;
    min = min < 0 ? -Math.ceil(-min / passo) * passo : 0;
    const X = (i) => m.l + ((i - i0) / Math.max(1, n - 1 - i0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - min) / (max - min)) * (H - m.t - m.b);
    let g = "";
    if (opts.banda) {
      const [a, b] = opts.banda;
      if (b >= i0) g += `<rect x="${X(Math.max(a, i0)) - 2}" y="${m.t}" width="${Math.max(4, X(b) - X(Math.max(a, i0)) + 4)}" height="${H - m.t - m.b}" fill="var(--surface-2)"/>`;
    }
    const nT = Math.round((max - min) / passo);
    for (let k = 0; k <= nT; k++) {
      const v = min + passo * k;
      const y = Y(v);
      g += `<line class="${v === 0 ? "base" : "grid"}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      g += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${opts.fmtEixo(v)}</text>`;
    }
    // rótulos de ano
    for (let i = i0; i < n; i++) {
      if (D.meses[i].endsWith("01")) {
        const x = X(i);
        g += `<line class="grid" x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 4}"/>`;
        if (X(i) < W - 30) g += `<text x="${x + 3}" y="${H - 8}">${D.meses[i].slice(0, 4)}</text>`;
      }
    }
    for (const s of opts.series) {
      let d = "", on = false;
      for (let i = i0; i < n; i++) {
        const v = s.valores[i];
        if (v == null) { on = false; continue; }
        d += (on ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1);
        on = true;
      }
      g += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="${s.grossa ? 2.5 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      // ponto final
      for (let i = n - 1; i >= i0; i--) if (s.valores[i] != null) {
        g += `<circle cx="${X(i)}" cy="${Y(s.valores[i])}" r="4" fill="${s.cor}" stroke="var(--surface)" stroke-width="2"/>`;
        break;
      }
    }
    g += `<line class="cross" id="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
    g += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="hit"/>`;
    const leg = opts.series.length > 1
      ? `<ul class="legenda">${opts.series.map((s) => `<li><i style="background:${s.cor}"></i>${esc(s.nome)}</li>`).join("")}</ul>` : "";
    el.innerHTML = `${leg}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.rotulo || "Gráfico de linhas")}">${g}</svg>`;
    const svg = el.querySelector("svg"), hit = svg.querySelector(".hit"), cross = svg.querySelector("#cross");
    hit.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.round(i0 + ((px - m.l) / (W - m.l - m.r)) * (n - 1 - i0));
      if (i < i0 || i >= n) return;
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      const linhasTip = opts.series.map((s) => `<div class="lin"><span><i style="background:${s.cor}"></i>${esc(s.nome)}</span><b>${s.valores[i] == null ? "–" : opts.fmt(s.valores[i])}</b></div>`).join("");
      mostrarTip(`<div><b>${opts.tituloTip ? opts.tituloTip(i) : mesLabel(i, true)}</b></div>${linhasTip}`, ev);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); esconderTip(); });
  }

  /** Barras verticais. opts: {rotulos, valores, cor, fmt, notas} */
  function barras(el, opts) {
    const W = Math.max(280, el.clientWidth || 500), H = opts.altura || 220;
    const m = { t: 18, r: 8, b: 26, l: 8 };
    const n = opts.valores.length;
    const max = niceMax(Math.max(1, ...opts.valores) * 1.08);
    const bw = (W - m.l - m.r) / n;
    const Y = (v) => m.t + (1 - Math.max(0, v) / max) * (H - m.t - m.b);
    let g = `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    opts.valores.forEach((v, i) => {
      const x = m.l + i * bw + bw * 0.18, w = bw * 0.64, y = Y(v), h = H - m.b - y;
      const parcial = opts.parcial && opts.parcial[i];
      g += `<path d="M${x} ${H - m.b}V${y + Math.min(4, h)}q0 -4 4 -4h${w - 8}q4 0 4 4V${H - m.b}Z" fill="${opts.cor}" ${parcial ? 'fill-opacity=".45"' : ""}/>`;
      g += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(opts.rotulos[i])}${parcial ? "*" : ""}</text>`;
      if (i === n - 1 || i === 0 || n <= 8) g += `<text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" style="fill:var(--ink-2)">${opts.fmtCurto(v)}</text>`;
      g += `<rect x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}" fill="transparent" data-i="${i}" class="hitb"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.rotulo || "Gráfico de barras")}">${g}</svg>`;
    el.querySelectorAll(".hitb").forEach((r) => {
      r.addEventListener("mousemove", (ev) => {
        const i = +r.dataset.i;
        mostrarTip(`<b>${esc(opts.rotulos[i])}</b>${opts.parcial && opts.parcial[i] ? ` <span>(${esc(opts.parcial[i])})</span>` : ""}<div>${opts.fmt(opts.valores[i])}</div>${opts.extra ? opts.extra(i) : ""}`, ev);
      });
      r.addEventListener("mouseleave", esconderTip);
    });
  }

  /** Produção da Akad no ramo: barras por mês (últimos 24 meses até o fim do período) ou por ano; GWP ou market share */
  const TONS_ANO = ["#E3175E", "#EE7EA5", "#F9C9DA"]; // ano mais recente -> mais antigo
  function inicioProdPadrao(fim, peq) {
    const janAnt = D.meses.indexOf(`${+D.meses[fim].slice(0, 4) - 1}01`);
    return peq ? Math.max(0, fim - 11) : Math.max(0, janAnt >= 0 ? janAnt : fim - 23);
  }
  function graficoProducao(el, sm, P) {
    const met = S.prodMet || "gwp", vis = S.prodVis || "mes";
    const A = Array.from(sm.ent.get(AKAD)), T = Array.from(sm.mercado);
    const W = Math.max(280, el.clientWidth || 600), peq = W < 560, H = peq ? 230 : 280;
    const m = { t: vis === "ano" ? (peq ? 26 : 46) : 14, r: 6, b: vis === "mes" ? 36 : 22, l: 40 };
    const fim = P.b;
    let itens = [];
    if (vis === "mes") {
      // início escolhido pela pessoa; sem escolha: janeiro do ano anterior (no celular, últimos 12 meses)
      const escolhido = S.prodIni ? D.meses.indexOf(S.prodIni) : -1;
      const ini = escolhido >= 0 && escolhido <= fim ? escolhido : inicioProdPadrao(fim, peq);
      for (let i = ini; i <= fim; i++) {
        const ym = D.meses[i];
        const sh = T[i] > 0 ? (A[i] / T[i]) * 100 : null;
        const iP = i - 12;
        itens.push({ ym, l1: MESES_PT[+ym.slice(4) - 1], l2: ym.slice(0, 4), ano: ym.slice(0, 4), v: met === "gwp" ? A[i] : sh, a: A[i], sh,
          tit: mesLabel(i, true), cr: iP >= 0 ? cresc(A[i], A[iP]) : null, dsh: iP >= 0 && T[iP] > 0 && sh != null ? sh - (A[iP] / T[iP]) * 100 : null, refP: iP >= 0 ? mesLabel(iP, true) : null });
      }
      const anos = [...new Set(itens.map((x) => x.ano))].reverse();
      // até 3 anos: tons fixos; mais anos: degradê do rosa claro ao magenta (mais recente = mais forte)
      const tom = (k) => {
        if (anos.length <= TONS_ANO.length) return TONS_ANO[k];
        const t = 1 - k / (anos.length - 1), c0 = [0xFB, 0xD9, 0xE5], c1 = [0xE3, 0x17, 0x5E];
        return "#" + c0.map((v, j) => Math.round(v + (c1[j] - v) * t).toString(16).padStart(2, "0")).join("");
      };
      itens.forEach((x) => { x.cor = tom(anos.indexOf(x.ano)); });
    } else {
      const yFim = D.meses[fim].slice(0, 4), mFim = +D.meses[fim].slice(4);
      const anos = [...new Set(D.meses.map((x) => x.slice(0, 4)))].filter((y) => y <= yFim);
      const soma = (y, ate) => { let a = 0, t = 0; D.meses.forEach((ym, i) => { if (ym.slice(0, 4) === y && +ym.slice(4) <= ate && i <= fim) { a += A[i]; t += T[i]; } }); return [a, t]; };
      anos.forEach((y, k) => {
        const parc = y === yFim && mFim < 12;
        const [a, t] = soma(y, parc ? mFim : 12);
        const sh = t > 0 ? (a / t) * 100 : null;
        let cr = null, dsh = null;
        if (k > 0) { const [ap, tp] = soma(anos[k - 1], parc ? mFim : 12); cr = cresc(a, ap); dsh = sh != null && tp > 0 ? sh - (ap / tp) * 100 : null; }
        itens.push({ l1: y + (parc ? "*" : ""), v: met === "gwp" ? a : sh, a, sh, cr, dsh, parc, tit: parc ? `${y} (jan a ${MESES_PT[mFim - 1]})` : y, refP: k > 0 ? (parc ? `jan a ${MESES_PT[mFim - 1]}/${anos[k - 1]}` : anos[k - 1]) : null, cor: y === yFim ? TONS_ANO[0] : "#F5B3CA" });
      });
    }
    const vals = itens.map((x) => x.v || 0);
    const vMax = Math.max(met === "gwp" ? 1 : 0.5, ...vals) * 1.05;
    const passo = niceMax(vMax / 4);
    const nT = Math.max(1, Math.ceil(vMax / passo));
    const max = passo * nT;
    const Y = (v) => m.t + (1 - Math.max(0, v) / max) * (H - m.t - m.b);
    const fmtE = (v) => (v === 0 ? "0" : met === "gwp" ? reaisCurto(v) : nf0.format(v) + "%");
    const fmtV = (v) => (met === "gwp" ? reais(v) : pct(v));
    let g = "";
    for (let k = 0; k <= nT; k++) { const v = passo * k, y = Y(v); g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${fmtE(v)}</text>`; }
    const bw = (W - m.l - m.r) / itens.length;
    const cada = vis === "mes" ? [1, 2, 3, 4, 6, 12].find((c) => c * bw >= 30) || 12 : 1; // muitos meses: rótulo a cada N meses, sempre incluindo janeiro
    itens.forEach((x, i) => {
      const w = bw * (vis === "ano" ? 0.6 : 0.7), bx = m.l + i * bw + (bw - w) / 2, y = Y(x.v || 0), h = H - m.b - y;
      if (h > 0) g += `<path d="M${bx} ${H - m.b}V${y + Math.min(3, h)}q0 -3 3 -3h${w - 6}q3 0 3 3V${H - m.b}Z" fill="${x.cor}"/>`;
      if (cada === 1 || (MESES_PT.indexOf(x.l1) % cada === 0)) g += `<text x="${bx + w / 2}" y="${H - m.b + 15}" text-anchor="middle" class="pr-l1">${esc(x.l1)}</text>`;
      if (x.l2 && ((!peq && cada === 1) || i === 0 || x.l1 === "jan")) g += `<text x="${bx + w / 2}" y="${H - m.b + 28}" text-anchor="middle" class="pr-l2">${x.l2}</text>`;
      if (vis === "ano") {
        const d = met === "gwp" ? x.cr : x.dsh;
        if (!peq) g += `<text x="${bx + w / 2}" y="${y - (d != null ? 28 : 6)}" text-anchor="middle" class="pr-val">${x.v == null ? "–" : met === "gwp" ? reaisCurto(x.v) : pct(x.v)}</text>`;
        if (d != null && isFinite(d)) {
          const txt = met === "gwp" ? (d > 999 ? "> +999%" : (d >= 0 ? "+" : "−") + nf0.format(Math.abs(d)) + "%") : (d >= 0 ? "+" : "−") + nf1.format(Math.abs(d)) + (peq ? "" : " p.p.");
          const pw = txt.length * 6.4 + 12;
          g += `<rect x="${bx + w / 2 - pw / 2}" y="${y - 22}" width="${pw}" height="16" rx="8" class="${d >= 0 ? "pr-up" : "pr-dn"}"/><text x="${bx + w / 2}" y="${y - 10.5}" text-anchor="middle" class="pr-pill ${d >= 0 ? "pr-up" : "pr-dn"}">${txt}</text>`;
        }
      }
      g += `<rect x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}" fill="transparent" data-i="${i}" class="hitb"/>`;
    });
    g += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Produção da Akad ${vis === "mes" ? "por mês" : "por ano"}">${g}</svg>`;
    const sinal = (v, suf, d = 1) => (v > 999 && suf === "%" ? "> +999%" : (v > 0 ? "+" : v < 0 ? "−" : "") + (d ? nf1 : nf0).format(Math.abs(v)) + suf);
    el.querySelectorAll(".hitb").forEach((r) => {
      const x = itens[+r.dataset.i];
      const html = `<b>${esc(x.tit)}</b><div>GWP da Akad: ${reais(x.a)}</div><div>Market share: ${pctPart(x.sh)}</div>${x.refP ? `<div>vs. ${esc(x.refP)}: ${x.cr != null ? sinal(x.cr, "%") : "–"} no GWP${x.dsh != null ? `, ${sinal(x.dsh, " p.p.")} no share` : ""}</div>` : ""}`;
      r.addEventListener("mousemove", (ev) => mostrarTip(html, ev));
      r.addEventListener("mouseleave", esconderTip);
    });
    return itens;
  }

  // Selo da posição da Akad ao lado do nome: medalha para 1º, 2º e 3º; número simples nos demais
  const MED_POS = { 1: ["#F5C542", "#C78800", "ouro"], 2: ["#E0E0E0", "#757575", "prata"], 3: ["#E8A87C", "#9C5A2E", "bronze"] };
  function seloPosicao(pos) {
    if (!pos) return "";
    if (MED_POS[pos]) {
      const [f, s] = MED_POS[pos];
      return `<span class="selo-pos med" aria-label="${pos}º lugar no mercado"><svg width="26" height="28" viewBox="0 0 24 26" aria-hidden="true"><path class="fita" d="M7 1l3 8M17 1l-3 8" stroke="#1C4173" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16" r="7.5" fill="${f}" stroke="${s}" stroke-width="1.4"/><text x="12" y="19.2" text-anchor="middle" font-family="Poppins, sans-serif" font-weight="700" font-size="9" fill="#212121">${pos}</text></svg></span>`;
    }
    return `<span class="selo-pos num" aria-label="${pos}º lugar no mercado">${pos}</span>`;
  }

  /* ---------- Visão geral ---------- */
  // Textos de ajuda contextual (abrem no "?" ao lado de cada indicador)
  const AJUDA = {
    premio: "GWP (Gross Written Premium): valor das apólices emitidas no período, antes de descontar resseguro. Na base da SUSEP aparece como prêmio emitido. É a medida de tamanho usada para participação e ranking.",
    share: "Participação de mercado: GWP da Akad dividido pelo GWP de todas as seguradoras no mesmo ramo e no mesmo período.",
    pp: "Variação em pontos percentuais (p.p.): diferença entre a participação atual e a do mesmo período do ano anterior. Ex.: de 10% para 12% = +2 p.p.",
    cresc: "Crescimento: quanto o GWP da Akad subiu ou caiu contra os mesmos meses do ano anterior. Olha só para a Akad, sem comparar com o mercado.",
    pos: "Posição: lugar da Akad no ranking de GWP entre as seguradoras com prêmio positivo no ramo e no período. \"de N\" é o número dessas seguradoras.",
    mov: "Movimento: quantas posições a Akad subiu (▲) ou caiu (▼) no ranking em relação ao mesmo período do ano anterior.",
    sin: "Sinistralidade: sinistro ocorrido dividido pelo prêmio ganho (a parte do prêmio que corresponde ao tempo de cobertura já decorrido). Ex.: 60% quer dizer que, a cada R$ 100 de prêmio ganho, R$ 60 foram para sinistros. Quanto menor, melhor.",
    lider: "Ramos em que a Akad tem o maior GWP no período.",
    ref: "A seguradora com o maior GWP no ramo no período. Quando é a Akad, passe o mouse no nome para ver quem vem em 2º.",
    vsMerc: "Compara o crescimento do prêmio da Akad com o do mercado. Quando a Akad cresce mais que o mercado, a participação sobe; quando cresce menos, cai.",
    frente: "Em quantos ramos a Akad está melhor colocada que essa seguradora, contando só os ramos em que as duas vendem.",
    status: "A SUSEP publica os dados de cada mês com cerca de dois meses de atraso e às vezes corrige meses anteriores. Uma vez por dia (agendado para as 9h, mas pode atrasar algumas horas) o painel consulta a base da SUSEP e se atualiza sozinho quando há dados novos.",
    tPeso: "Quanto esse ramo representa do GWP total da Akad no período: GWP da Akad no ramo dividido pelo GWP da Akad em todos os ramos.",
    tShare: "Market share da Akad no ramo no período escolhido: GWP da Akad dividido pelo GWP de todas as seguradoras no ramo.",
    tPP: "Quanto a fatia da Akad mudou contra os mesmos meses do ano anterior, em pontos percentuais. Ex.: de 10% para 12% = +2 p.p.",
    tRank: "Lugar da Akad no ranking de GWP do ramo. \"de N\" é quantas seguradoras venderam no ramo no período.",
    tMov: "Quantas posições a Akad subiu (▲) ou caiu (▼) no ranking contra os mesmos meses do ano anterior. \"novo\": a Akad não vendia no ramo no ano anterior.",
    tPe: "Quanto a Akad vendeu no ramo no período escolhido (GWP, em reais).",
    tDpe: "Quanto a Akad vendeu a mais (▲) ou a menos (▼) que nos mesmos meses do ano anterior, em reais.",
    tCresc: "A mesma diferença em porcentagem: quanto as vendas da Akad cresceram ou caíram contra os mesmos meses do ano anterior.",
    tVs: "Se as vendas da Akad cresceram mais (acima) ou menos (abaixo) que as do mercado no ramo. Acima do mercado, a fatia da Akad sobe.",
    tMerc: "Quanto todas as seguradoras juntas venderam no ramo no período escolhido, incluindo a Akad. Mostra o tamanho do ramo.",
    tCrescM: "Quanto o ramo inteiro cresceu ou caiu, em porcentagem, contra os mesmos meses do ano anterior.",
    tRefShare: "Market share do maior concorrente no ramo no período escolhido.",
    universo: "Sobre os dados desta página:",
    ufBase: "Os valores por estado são de prêmio direto, a informação que a SUSEP publica por UF. Por isso o total pode ficar um pouco diferente do GWP da Visão geral. A comparação é com os mesmos meses do ano anterior.",
    ufConc: "Quanto das vendas da Akad (prêmio direto) está concentrado em cada estado. Os 5 maiores:",
    ufCresc: "Estados em que as vendas da Akad foram maiores que nos mesmos meses do ano anterior:",
    ufShareMapa: "Market share = prêmio direto da Akad no estado ÷ prêmio direto de todas as seguradoras no mesmo estado, somando os ramos e os meses escolhidos nos filtros. Ex.: se o mercado vendeu R$ 100 mi em SP e a Akad R$ 2 mi, o market share em SP é 2%. Por estado a SUSEP publica só o prêmio direto, por isso o número pode ser diferente do market share por GWP das outras telas. Quanto mais escuro o estado, maior a participação.",
    ufMelhor: "O estado em que a Akad tem a maior fatia do mercado, considerando só estados com pelo menos 0,5% do mercado dos ramos.",
    ufVs: "Market share da Akad no estado dividido pela média dela no país. 2,0x = o dobro da média; abaixo de 1,0x = mais fraca que a média.",
    ufPos: "Lugar da Akad entre as seguradoras com prêmio no estado, nos ramos selecionados. A SUSEP publica esse ranking por estado só em base anual.",
    trBcg: "Matriz BCG (Boston Consulting Group), adaptada. Cruza duas perguntas: o mercado do ramo está crescendo? E a Akad tem posição forte nele? Crescimento: quanto o mercado do ramo cresceu nos últimos 12 meses contra os 12 meses anteriores; a linha é a média dos ramos acompanhados. Posição forte: Akad entre as 5 maiores seguradoras do ramo. Na BCG original, só o líder do mercado conta como posição forte; adaptamos porque os ramos da Akad são fragmentados, com 20 a 60 seguradoras, e estar no top 5 já significa escala relevante. A posição e o tamanho da bolha seguem o período escolhido no filtro.",
    ccTipos: "Share: market share médio da seguradora nos ramos em que a Akad vende, dando mais peso aos ramos que mais pesam na carteira da Akad (assim um ramo enorme em que a Akad quase não atua, como Prestamista, não domina o número). Variação: diferença desse share contra os 12 meses anteriores. Confronto direto: aparecem no top 5 junto com a Akad em mais ramos. Ganhando espaço: mais aumentaram esse share. Perfil parecido: carteira com distribuição entre os 22 ramos parecida com a da Akad.",
    ccTop5: "Em quantos dos ramos em que a Akad vende ela está entre as 5 maiores seguradoras por GWP nos últimos 12 meses. Cada quadrado é um desses ramos, com a posição da Akad, em ordem de peso na carteira. Passe o mouse para ver os detalhes.",
    ccPerdeu: "Ramos em que o market share da Akad caiu mais de 0,05 p.p. nos últimos 12 meses contra os 12 anteriores. A porcentagem soma o peso desses ramos no GWP da Akad, para mostrar se a perda está nos ramos que mais importam.",
    ccSinCom: "Sinistro ocorrido mais custo de comercialização (comissão do corretor, agenciamento, pró-labore e outros custos de venda), divididos pelo prêmio ganho. Mostra quanto do prêmio já sai antes das despesas administrativas e do resseguro. O mercado é calculado nos mesmos ramos da Akad. Quanto menor, melhor.",
    ccGanho: "Diferença do market share da Akad em cada ramo nos últimos 12 meses contra os 12 anteriores, em pontos percentuais (p.p.). Peso na carteira: quanto o ramo representa do GWP da Akad. Quem mais ganhou: a seguradora que mais aumentou o market share no ramo.",
    ccFicha: "Todos os ramos em que a seguradora vende, do maior para o menor GWP. Posição e variação no ranking do ramo, market share e variação em p.p., crescimento do GWP, sinistralidade (com a do mercado no ramo ao lado), custo de comercialização e a posição da Akad no mesmo ramo.",
    ccComp: "Últimos 12 meses até o fim do período escolhido. Sinistralidade e custo de comercialização são calculados sobre o prêmio ganho; resseguro cedido, sobre o GWP. Em ramos pequenos esses índices oscilam bastante.",
    ccCom: "Custo de comercialização: o que a SUSEP chama de despesa de comercialização. É principalmente a comissão paga ao corretor, mais agenciamento, pró-labore e outros custos de venda. Calculado sobre o prêmio ganho, por isso fica próximo, mas não igual, ao percentual de comissão negociado.",
    ccRes: "Parte do GWP repassada a resseguradoras (prêmio de resseguro cedido ÷ GWP). Quanto maior, mais a seguradora depende de resseguro para aceitar o risco.",
    trCresc: "Quanto o mercado do ramo cresceu nos últimos 12 meses até o fim do período escolhido, contra os 12 meses anteriores. É o crescimento usado para posicionar o ramo na matriz.",
    trRel: "GWP da Akad dividido pelo GWP do maior concorrente no ramo. 1x = mesmo tamanho; acima de 1x, a Akad lidera; 0,25x = a Akad tem um quarto do tamanho do maior concorrente.",
    shareTot: "Participação de mercado: GWP da Akad somado nos ramos em que ela atua, dividido pelo GWP de todas as seguradoras nesses mesmos ramos, no período escolhido.",
  };
  const ajuda = (k, rot) => `<button type="button" class="ajuda" data-ajuda="${k}" aria-label="O que é ${esc(rot)}?">?</button>`;
  function ligarAjuda() {
    if (ligarAjuda.ok) return;
    ligarAjuda.ok = true;
    const abrir = (b) => {
      const r = b.getBoundingClientRect();
      const extra = b.dataset.lista ? `<div class="tip-lista">${b.dataset.lista.split("|").map((x) => `<div>${esc(x)}</div>`).join("")}</div>` : "";
      mostrarTip(`<div style="max-width:280px">${esc(AJUDA[b.dataset.ajuda] || "")}${extra}</div>`, { clientX: r.left, clientY: r.bottom });
    };
    document.addEventListener("mouseover", (e) => { const b = e.target.closest?.(".ajuda"); if (b) abrir(b); });
    document.addEventListener("mouseout", (e) => { if (e.target.closest?.(".ajuda")) esconderTip(); });
    document.addEventListener("focusin", (e) => { const b = e.target.closest?.(".ajuda"); if (b) abrir(b); });
    document.addEventListener("focusout", (e) => { if (e.target.closest?.(".ajuda")) esconderTip(); });
    document.addEventListener("click", (e) => { const b = e.target.closest?.(".ajuda"); if (b) { e.preventDefault(); e.stopPropagation(); abrir(b); } }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") esconderTip(); });
  }

  // Participação com distinção entre zero, valor muito pequeno e ausência
  function pctPart(x) {
    if (x == null || !isFinite(x)) return "–";
    if (x > 0 && x < 0.05) return "< 0,1%";
    return pct(x);
  }
  // Variação em p.p. com seta e sinal (não depende só de cor)
  function rsSeta(x) {
    if (x == null || !isFinite(x)) return '<span class="var zero" title="Sem base de comparação">–</span>';
    if (Math.abs(x) < 0.5) return '<span class="var zero"><span aria-hidden="true">=</span> R$ 0</span>';
    return x > 0
      ? `<span class="var up"><span aria-hidden="true">▲</span> +${reais(x)}</span>`
      : `<span class="var down"><span aria-hidden="true">▼</span> −${reais(-x)}</span>`;
  }
  function ppSeta(x) {
    if (x == null || !isFinite(x)) return '<span class="var zero" title="Sem base de comparação">–</span>';
    const a = Math.abs(x);
    const d = a > 0 && a < 0.05 ? 2 : 1;
    const v = a.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
    if (a < 0.005) return `<span class="var zero"><span aria-hidden="true">=</span> 0,0 p.p.</span>`;
    return x > 0
      ? `<span class="var up"><span aria-hidden="true">▲</span> +${v} p.p.</span>`
      : `<span class="var down"><span aria-hidden="true">▼</span> −${v} p.p.</span>`;
  }
  // Crescimento em tom neutro: crescer não é sempre bom nem cair sempre ruim
  function crescNeutro(x) {
    if (x == null || !isFinite(x)) return '<span class="neutro zero" title="Sem base de comparação">–</span>';
    if (x > 999) return '<span class="neutro" title="Base de comparação muito pequena">> +999%</span>';
    const s = x > 0 ? "+" : x < 0 ? "−" : "";
    return `<span class="neutro">${s}${nf1.format(Math.abs(x))}%</span>`;
  }
  function movHtml(pos, posP) {
    if (!pos) return '<span class="mov zero">–</span>';
    if (!posP) return '<span class="mov zero" title="Sem prêmio no período anterior">novo</span>';
    const d = posP - pos;
    if (d === 0) return '<span class="mov zero" title="Mesma posição"><span aria-hidden="true">=</span></span>';
    return d > 0
      ? `<span class="mov up" title="Subiu ${d} posição(ões)"><span aria-hidden="true">▲</span>${d}</span>`
      : `<span class="mov down" title="Caiu ${-d} posição(ões)"><span aria-hidden="true">▼</span>${-d}</span>`;
  }
  function vsMercado(ac, mc) {
    if (ac == null || mc == null || !isFinite(ac) || !isFinite(mc)) return "";
    const g = ac - mc;
    if (Math.abs(g) < 0.05) return '<span class="vs">igual ao mercado</span>';
    return `<span class="vs">${g > 0 ? "acima" : "abaixo"} do mercado</span>`;
  }
  // Próxima execução do workflow: todo dia 12:00 UTC (9h em Brasília)
  function proximaVerificacao() {
    const agora = new Date();
    const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12, 0, 0));
    if (agora >= d) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const fmtDataHora = (d) => d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  function dadosGeral(P) {
    const RT = resumo(IDX.todos, P);
    const ak = infoEnt(RT, AKAD);
    const sinM = RT.tc[1] > 0 ? (RT.tc[2] / RT.tc[1]) * 100 : null;
    const linhas = IDX.linhas.map((l) => {
      const R = resumo(l.idx, P);
      const a = infoEnt(R, AKAD);
      const lider = R.rk[0];
      const vice = R.rk[1];
      const ref = lider === AKAD ? vice : lider;
      const refInfo = ref ? infoEnt(R, ref) : null;
      return { l, R, a, lider, ref, refInfo, mercado: R.tc[0], mercadoP: R.tp[0], n: R.rk.length,
        crescM: cresc(R.tc[0], R.tp[0]), sinM: R.tc[1] > 0 ? (R.tc[2] / R.tc[1]) * 100 : null,
        temAkad: a.pe > 0, dPos: a.pos && a.posP ? a.posP - a.pos : null,
        dPe: R.tp[0] > 0 && ((a.pe || 0) > 0 || (a.peP || 0) > 0) ? (a.pe || 0) - (a.peP || 0) : null };
    });
    const lidera = linhas.filter((x) => x.a.pos === 1);
    const top3 = linhas.filter((x) => x.a.pos && x.a.pos <= 3);
    const comDelta = linhas.filter((x) => x.a.dShare != null && x.a.pe > 0);
    const ganhos = [...comDelta].sort((p, q) => q.a.dShare - p.a.dShare).slice(0, 3).filter((x) => x.a.dShare > 0);
    const perdas = [...comDelta].sort((p, q) => p.a.dShare - q.a.dShare).slice(0, 3).filter((x) => x.a.dShare < 0);
    return { RT, ak, sinM, linhas, lidera, top3, ganhos, perdas, comPremio: linhas.filter((x) => x.temAkad).length };
  }

  function abrirLinha(id) {
    S.geralSel = id;
    abrirDe("linhas", () => { S.linha = id; });
  }
  // Navegação de detalhe: lembra de onde veio para mostrar "Voltar"
  const NOME_ABA = { geral: "Visão geral", linhas: "Ramos", conc: "Concorrentes", uf: "Por estado" };
  function abrirDe(destino, antes) {
    S.pilha.push({ aba: S.aba, linha: S.linha, y: window.scrollY, rotulo: S.aba === "linhas" ? (S.linha === "todas" ? "Todos os ramos" : nomeSel(S.linha)) : NOME_ABA[S.aba] });
    if (antes) antes();
    try { history.pushState(null, "", "#" + destino); } catch (e) { /* ignora */ }
    if (destino === S.aba) { render(); window.scrollTo({ top: 0 }); } else irPara(destino, true);
  }
  function voltar() {
    const v = S.pilha.pop();
    if (!v) return;
    S.linha = v.linha;
    try { history.replaceState(null, "", "#" + v.aba); } catch (e) { /* ignora */ }
    if (v.aba === S.aba) render(); else irPara(v.aba, true);
    requestAnimationFrame(() => window.scrollTo({ top: v.y }));
  }

  // Posição sempre no mesmo formato: "2º de 32"
  function posChip(pos, n) {
    if (!pos) return '<span class="pchip">sem prêmio</span>';
    if (n === 1) return '<span class="pchip">única</span>';
    return `<span class="pchip${pos === 1 ? " lider" : ""}">${pos}º <span>de ${n}</span>${pos === 1 ? " · líder" : ""}</span>`;
  }
  function vsTexto(ac, mc) {
    if (ac == null || mc == null || !isFinite(ac) || !isFinite(mc)) return '<span class="vs0">–</span>';
    const g = ac - mc;
    if (Math.abs(g) < 0.05) return '<span class="vs0">igual</span>';
    return g > 0 ? '<span class="vs0"><span aria-hidden="true">↑</span> acima</span>' : '<span class="vs0"><span aria-hidden="true">↓</span> abaixo</span>';
  }

  function renderGeral() {
    ligarAjuda();
    const P = periodo();
    const el = $("#aba-geral");
    const G = dadosGeral(P);
    const { RT, ak, sinM, linhas, lidera, top3, ganhos, perdas } = G;
    const nL = IDX.linhas.length, nR = D.ramos.length;
    const per = periodoLabel(P.a, P.b), perP = P.pa != null ? periodoLabel(P.pa, P.pb) : null;
    window.__geral = G; // usado na verificação automática

    const contexto = `
      <div class="cab-aba cab-geral">
        <div>
          <h2>Visão geral</h2>
          <p>Acompanhe o desempenho da Akad nos ${nL} ramos em que atua, com base nos <a href="https://www2.susep.gov.br/menuestatistica/ses/principal.aspx" target="_blank" rel="noopener">dados oficiais da SUSEP</a>. <button type="button" class="ajuda" data-ajuda="universo" data-lista="${esc(`Período: ${per}${perP ? `, comparado com ${perP}` : ""}.|Ramos: os ${nL} códigos SUSEP em que a Akad atua. Os indicadores somam todos eles.|Fonte: Sistema de Estatísticas (SES) da SUSEP, base completa, consultada uma vez por dia.`)}" aria-label="Sobre os dados">?</button></p>
        </div>
      </div>`;

    if (!(RT.tc[0] > 0)) {
      el.innerHTML = `${contexto}<div class="card vazio-bloco"><h2>Sem dados para este período</h2><p>A base da SUSEP não tem GWP nos ramos acompanhados entre ${per}. Escolha outro período no filtro de período.</p></div>`;
      return;
    }

    // A. Panorama: participação, vendas da Akad e sinistros, cada um com sua comparação
    const crescMerc = cresc(RT.tc[0], RT.tp[0]);

    // Variação dos KPIs: seta, sinal e cor pelo efeito (bom em verde, ruim em vermelho)
    const varKpi = (x, unid, ruimSeSobe) => {
      if (x == null || !isFinite(x)) return '<span class="kc-var zero">–</span>';
      if (unid === "%" && x > 999) return '<span class="kc-var bom">↑ > 999%</span>';
      const v = nf1.format(Math.abs(x)) + (unid === "pp" ? " p.p." : "%");
      if (Math.abs(x) < 0.05) return `<span class="kc-var zero">= ${v}</span>`;
      const bom = ruimSeSobe ? x < 0 : x > 0;
      return `<span class="kc-var ${bom ? "bom" : "ruim"}">${x > 0 ? "↑" : "↓"} ${v}</span>`;
    };

    // A1. Vendas da Akad
    const cardVendas = `
      <section class="card kc" aria-label="GWP da Akad">
        <h2 class="kc-tit">GWP da Akad ${ajuda("premio", "GWP")}</h2>
        <div class="kc-linha"><span class="kc-val">${reais(ak.pe)}</span>${varKpi(ak.cresc, "%")}</div>
        <p class="kc-aux">${ak.peP > 0 ? `${reais(ak.peP)} em ${perP}` : "Sem prêmio no período anterior para comparar"}</p>
      </section>`;

    // A2. Participação de mercado
    const cardPart = `
      <section class="card kc" aria-label="Participação de mercado">
        <h2 class="kc-tit">Participação de mercado <button type="button" class="ajuda" data-ajuda="shareTot" data-lista="${esc(`Tamanho do mercado nos ${nL} ramos em que a Akad atua: ${reais(RT.tc[0])}${crescMerc != null ? ` (${crescMerc > 0 ? "+" : crescMerc < 0 ? "−" : ""}${nf1.format(Math.abs(crescMerc))}% contra ${perP})` : ""}. Não inclui ramos em que a Akad não atua.`)}" aria-label="O que é participação de mercado?">?</button></h2>
        <div class="kc-linha"><span class="kc-val">${pct(ak.share, 2)}</span>${varKpi(ak.dShare, "pp")}</div>
        <p class="kc-aux">${ak.shareP != null ? `${pct(ak.shareP, 2)} em ${perP}` : "Sem participação no período anterior para comparar"}</p>
      </section>`;

    // A3. Sinistralidade: comparação com a própria Akad (subir é ruim)
    const pAk = RT.prev.get(AKAD);
    const sinP = pAk && pAk[1] > 0 ? (pAk[2] / pAk[1]) * 100 : null;
    const dSin = ak.sin != null && sinP != null ? ak.sin - sinP : null;
    const cardSin = `
      <section class="card kc" aria-label="Sinistralidade">
        <h2 class="kc-tit">Sinistralidade ${ajuda("sin", "sinistralidade")}</h2>
        <div class="kc-linha"><span class="kc-val">${pct(ak.sin)}</span>${varKpi(dSin, "pp", true)}</div>
        <p class="kc-aux">${sinP != null ? `${pct(sinP)} em ${perP}` : "Sem período anterior para comparar"}</p>
      </section>`;

    // A4. Evolução das vendas: mesmo recorte de meses em cada ano
    const hist = [];
    for (let k = 0; P.a - 12 * k >= 0; k++) {
      const a = P.a - 12 * k, b = P.b - 12 * k;
      const m = agg(IDX.todos, a, b).get(AKAD);
      hist.unshift({ a, b, v: m ? m[0] : 0, sel: k === 0 });
    }
    // Anos posteriores ao período escolhido também aparecem (mesmo recorte de meses)
    for (let k = 1; P.b + 12 * k <= D.meses.length - 1; k++) {
      const a = P.a + 12 * k, b = P.b + 12 * k;
      const m = agg(IDX.todos, a, b).get(AKAD);
      hist.push({ a, b, v: m ? m[0] : 0, sel: false });
    }
    hist.forEach((h, i) => { h.cr = i > 0 ? cresc(h.v, hist[i - 1].v) : null; });
    const mesmoAno = D.meses[P.a].slice(0, 4) === D.meses[P.b].slice(0, 4);
    const rotH = (h) => (mesmoAno ? D.meses[h.b].slice(0, 4) : `até ${mesLabel(h.b)}`);
    const recorte = S.periodo === "12m" ? `12 meses até ${MESES_PT[+D.meses[P.b].slice(4) - 1]} de cada ano`
      : mesmoAno && !(D.meses[P.a].endsWith("01") && D.meses[P.b].endsWith("12")) ? `${MESES_PT[+D.meses[P.a].slice(4) - 1]} a ${MESES_PT[+D.meses[P.b].slice(4) - 1]} de cada ano`
      : mesmoAno ? "ano completo" : "mesmo intervalo de meses, ano a ano";
    const maxH = Math.max(1, ...hist.map((h) => h.v));
    const barrasH = hist.map((h, i) => {
      const atual = h.sel;
      const crTxt = h.cr == null ? "–" : h.cr > 999 ? "> +999%" : `${h.cr > 0 ? "+" : h.cr < 0 ? "−" : ""}${nf1.format(Math.abs(h.cr))}%`;
      return `<li class="ev${atual ? " atual" : ""}" aria-label="${esc(periodoLabel(h.a, h.b))}: ${reais(h.v)}, crescimento ${crTxt}">
        <span class="ev-trilho" aria-hidden="true"><i style="height:${Math.max(h.v > 0 ? 2 : 0, (h.v / maxH) * 100)}%"></i>${h.cr == null ? "" : `<span class="ev-cr ${h.cr >= 0 ? "sobe" : "cai"}" style="bottom:calc(${Math.max(h.v > 0 ? 2 : 0, (h.v / maxH) * 100)}% + 6px)">${crTxt}</span>`}</span>
        <span class="ev-val" aria-hidden="true">${reaisCurto(h.v)}</span>
        <span class="ev-rot" aria-hidden="true">${rotH(h)}</span>
      </li>`;
    }).join("");
    const cardEvo = `
      <section class="card kc kc-evo" aria-label="GWP ano a ano">
        <div class="kc-cab"><h2 class="kc-tit">GWP ano a ano</h2><span class="kc-aux">${recorte}</span></div>
        <ol class="ev-lista" aria-label="GWP da Akad por ano">${barrasH}</ol>
      </section>`;

    // A5. Onde está o GWP da Akad: os 5 maiores ramos da carteira
    const carteira = linhas.filter((x) => x.a.pe > 0).sort((p, q) => q.a.pe - p.a.pe);
    const top5 = carteira.slice(0, 5);
    const pesoTop = ak.pe > 0 ? (top5.reduce((t, x) => t + x.a.pe, 0) / ak.pe) * 100 : null;
    const maxPeso = top5.length ? top5[0].a.pe : 1;
    const cardCart = `
      <section class="card kc kc-cart" aria-label="Onde está o GWP da Akad">
        <div class="kc-cab"><h2 class="kc-tit">Onde está o GWP da Akad</h2><span class="kc-aux">top 5 ramos</span></div>
        <ul class="ct-lista">${top5.map((x) => `
          <li><button type="button" class="ct-item" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: ${pctPart((x.a.pe / ak.pe) * 100)} do GWP da Akad, ${reais(x.a.pe)}. Abrir detalhe">
            <span class="ct-nome">${esc(x.l.nome)}</span>
            <span class="ct-tr" aria-hidden="true"><i style="width:${(x.a.pe / maxPeso) * 100}%"></i></span>
            <span class="ct-pct" title="${reais(x.a.pe)} em ${per}">${nf1.format((x.a.pe / ak.pe) * 100)}%</span>
          </button></li>`).join("")}
        </ul>
        <p class="kc-aux ct-nota">${pesoTop != null ? `Esses ${top5.length} ramos somam ${nf0.format(pesoTop)}% do GWP da Akad.` : ""}</p>
      </section>`;

    const panorama = `
      <div class="pan">
        <div class="kpi3">${cardVendas}${cardPart}${cardSin}</div>
        <div class="pan-baixo">${cardEvo}${cardCart}</div>
      </div>`;

    // B. Movimentos
    const item = (x, tipo) => `
      <li><button type="button" class="mv-item" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: participação ${pctPart(x.a.share)}, abrir detalhe">
        <span class="mv-nome">${esc(x.l.nome)}</span>
        <span class="mv-val">${tipo === "lider" ? `<b>${pctPart(x.a.share)}</b> de market share` : `${pctPart(x.a.shareP)} <span aria-hidden="true">→</span> <b>${pctPart(x.a.share)}</b>`}</span>
        <span class="mv-var mv-gwp" data-tip="${esc(`<b>GWP da Akad em ${esc(x.l.nome)}</b><div>${per}: ${reais(x.a.pe)}</div>${x.a.peP > 0 ? `<div>${perP}: ${reais(x.a.peP)}</div>` : ""}${x.a.cresc != null ? `<div>Variação: ${x.a.cresc > 999 ? "> +999" : (x.a.cresc > 0 ? "+" : x.a.cresc < 0 ? "−" : "") + nf1.format(Math.abs(x.a.cresc))}%</div>` : ""}<div>Market share: ${pctPart(x.a.share)}${x.a.dShare != null ? ` (${x.a.dShare > 0 ? "+" : x.a.dShare < 0 ? "−" : ""}${nf1.format(Math.abs(x.a.dShare))} p.p.)` : ""}</div>`)}">${reais(x.a.pe)}</span>
      </button></li>`;
    const ICO_MV = {
      lider: '<svg width="18" height="20" viewBox="0 0 24 26" aria-hidden="true"><path class="fita" d="M7 1l3 8M17 1l-3 8" stroke="#1C4173" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16" r="7.5" fill="#F5C542" stroke="#C78800" stroke-width="1.4"/><text x="12" y="19.2" text-anchor="middle" font-family="Poppins, sans-serif" font-weight="700" font-size="9" fill="#212121">1</text></svg>',
      g: '<span class="mv-ico up" aria-hidden="true">↑</span>',
      p: '<span class="mv-ico down" aria-hidden="true">↓</span>',
    };
    const coluna = (tit, lst, tipo, vazio) => `
      <div class="mv-col">
        <h3>${ICO_MV[tipo]}<span class="mv-tit">${tit}</span><span class="mv-col-rot" title="GWP da Akad no ramo em ${per}">GWP</span></h3>
        ${lst.length ? `<ul>${lst.map((x) => item(x, tipo)).join("")}</ul>` : `<p class="mv-vazio">${vazio}</p>`}
      </div>`;
    const movimentos = `
      <section class="card sec" aria-labelledby="h-mov">
        <h2 id="h-mov" class="sec-tit">Destaques do período</h2>
        <div class="mv-grade">
          ${coluna("Onde a Akad lidera", lidera, "lider", "A Akad não lidera nenhum ramo no período.")}
          ${coluna("Mais ganharam market share", ganhos, "g", "Nenhum ramo ganhou market share no período.")}
          ${coluna("Mais perderam market share", perdas, "p", "Nenhum ramo perdeu market share no período.")}
        </div>
      </section>`;

    // C. Participação por ramo: uma única tabela. "Resumo" e "Detalhado" têm as mesmas linhas,
    // a mesma ordem e as mesmas colunas-base; o Detalhado só acrescenta colunas.
    const modo = S.geralModo === "detalhado" ? "detalhado" : "resumo";
    const det = modo === "detalhado";
    const ORD_TAB = { pe: { col: "pe", dir: -1 }, pos: { col: "pos", dir: 1 }, share: { col: "share", dir: -1 }, ganho: { col: "dShare", dir: -1 } };
    const T = S.geralTab || (ORD_TAB[S.geralOrd] || ORD_TAB.pe);
    const val = (x, c) => ({
      nome: x.l.nome, pos: x.a.pos, mov: x.dPos, share: x.temAkad ? x.a.share : null, dShare: x.a.dShare, pe: x.temAkad ? x.a.pe : null,
      dPe: x.dPe, cresc: x.a.cresc, vs: x.a.cresc != null && x.crescM != null ? x.a.cresc - x.crescM : null,
      peso: x.temAkad && x.a.pe > 0 ? x.a.pe : null, mercado: x.mercado, crescM: x.crescM, refShare: x.refInfo ? x.refInfo.share : null,
    }[c]);
    const ordenar = (lst) => [...lst].sort((p, q) => {
      if (T.col === "nome") return p.l.nome.localeCompare(q.l.nome, "pt-BR") * T.dir;
      const va = val(p, T.col), vb = val(q, T.col);
      if (va == null && vb == null) return (q.a.share || 0) - (p.a.share || 0);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * T.dir || ((q.a.share || 0) - (p.a.share || 0));
    });
    const disputa = ordenar(linhas.filter((x) => x.temAkad && x.n > 1));
    // Ramos com prêmio da Akad entram todos na mesma ordem (inclusive onde ela é a única seguradora)
    const comAkad = ordenar(linhas.filter((x) => x.temAkad));
    const semA = ordenar(linhas.filter((x) => !x.temAkad));
    // Escala definida só pelas linhas com concorrência (o 100% do DPEM não achata as demais)
    const base = [];
    disputa.forEach((x) => { if (x.a.share != null) base.push(x.a.share); if (x.a.shareP != null) base.push(x.a.shareP); });
    const passoEsc = Math.min(25, niceMax((Math.max(1, ...base) * 1.05) / 4));
    const escMax = passoEsc * 4;
    const W = (v) => Math.min(100, (v / escMax) * 100);
    const ticks = [0, 1, 2, 3, 4].map((f) => passoEsc * f);
    const nCols = det ? 8 : 5;
    const totAk = linhas.reduce((t, x) => t + (x.temAkad && x.a.pe > 0 ? x.a.pe : 0), 0);
    const pesoDe = (x) => x.temAkad && totAk > 0 ? Math.max(0, x.a.pe) / totAk * 100 : null;
    const pesoMax = Math.max(1, ...linhas.map((x) => pesoDe(x) || 0));
    const nomeCurto = (t) => t.replace(/\b(Companhia de Seguros Gerais|Companhia de Seguros|Cia de Seguros|Seguradora|Seguros Brasil|Seguros Gerais|Seguros Corporativos|Seguros)\b/gi, "").replace(/\s+/g, " ").trim() || t;
    const barra = (x) => {
      const a = x.a;
      if (!x.temAkad) return `<span class="pb-track"><span class="pb-semtxt" title="${x.n ? `${x.n} seguradoras com prêmio no ramo` : "sem dados de mercado"}">Akad sem prêmio</span></span>`;
      const est = a.share != null && a.share >= escMax;
      const estP = a.shareP != null && a.shareP >= escMax;
      return `<span class="pb-track">
          <span class="pb-fill${est ? " est" : ""}" style="width:${W(a.share || 0)}%"></span>
          ${a.shareP != null ? `<span class="pb-ant${estP ? " est" : ""}" style="left:${W(a.shareP)}%" title="${perP}: ${pctPart(a.shareP)}"></span>` : ""}
          ${est ? `<span class="pb-quebra">${x.n === 1 ? "única no ramo" : "fora da escala"}</span>` : ""}
        </span>`;
    };
    const seloPos = seloPosicao;
    // Posição + variação no ranking ao lado do nome; o detalhe ("2º de 20") aparece ao passar o mouse
    const posGrp = (x) => {
      if (!x.a.pos) return "";
      const d = x.a.posP ? x.a.posP - x.a.pos : null;
      const sub = d == null ? `Sem prêmio em ${perP || "período anterior"}` : d === 0 ? `Mesma posição de ${perP}` : `${d > 0 ? "Subiu" : "Caiu"} ${Math.abs(d)} ${Math.abs(d) === 1 ? "posição" : "posições"} contra ${perP} (era ${x.a.posP}º)`;
      const tipH = `<b>${x.a.pos}º de ${x.n}</b><div>${x.n === 1 ? "Única seguradora com prêmio no ramo" : `${x.n} seguradoras com prêmio no ramo`}</div><div>${sub}</div>`;
      return `<span class="pos-grp" data-tip="${esc(tipH)}">${seloPos(x.a.pos)}${movHtml(x.a.pos, x.a.posP).replace(/ title="[^"]*"/, "")}</span>`;
    };
    const linhaTab = (x, grupo) => `
            <tr data-linha="${x.l.id}" class="${grupo}${S.geralSel === x.l.id ? " sel" : ""}${x.temAkad ? "" : " semak"}">
              <td class="nome"><div class="nome-in"><div><button type="button" class="lk" data-abrir="${x.l.id}">${esc(x.l.nome)}</button><span class="sub">${x.l.ramos.join(", ")}</span></div>${posGrp(x)}</div></td>
              ${det ? "" : `<td class="barra g1" title="${esc(x.temAkad ? `Market share em ${per}: ${pctPart(x.a.share)}${x.a.shareP != null && perP ? `\nEm ${perP}: ${pctPart(x.a.shareP)}` : ""}${x.a.dShare != null ? `\nVariação: ${x.a.dShare > 0 ? "+" : x.a.dShare < 0 ? "−" : ""}${nf1.format(Math.abs(x.a.dShare))} p.p.` : ""}` : "Akad sem prêmio no período")}">${barra(x)}</td>`}
              <td class="n${det ? " g1" : ""}" title="${esc(x.a.dShare != null ? `Variação: ${x.a.dShare > 0 ? "+" : x.a.dShare < 0 ? "−" : ""}${nf1.format(Math.abs(x.a.dShare))} p.p. contra ${perP}` : "")}"><b>${x.temAkad ? pctPart(x.a.share) : "–"}</b></td>
              <td class="n g1">${x.temAkad ? reais(x.a.pe) : '<span class="sub-i">sem prêmio</span>'}</td>
              <td class="n peso">${pesoDe(x) != null ? `<span class="peso-in"><span class="peso-bar"><i style="width:${pesoDe(x) / pesoMax * 100}%"></i></span>${pesoDe(x) < 0.05 && pesoDe(x) > 0 ? "&lt;0,1%" : nf1.format(pesoDe(x)) + "%"}</span>` : "–"}</td>
              ${det ? `<td class="n">${rsSeta(x.dPe)}</td>
              <td class="n">${crescNeutro(x.a.cresc)}</td>
              <td class="n g1">${x.mercado > 0 ? reais(x.mercado) : '<span class="sub-i">sem dados</span>'}</td>
              <td class="g1 ref" title="${x.lider === AKAD ? (x.ref ? `2º lugar: ${esc(nomeEnt(x.ref))}` : "Única seguradora no ramo") : x.lider != null ? esc(nomeEnt(x.lider)) : ""}">${x.lider === AKAD ? '<b class="lid-ak">Akad</b>' : x.lider != null ? esc(nomeCurto(nomeEnt(x.lider))) : '<span class="sub-i">sem dados</span>'}</td>` : ""}
            </tr>`;
    const grupoTab = (tit, lst, cls) => lst.length ? `<tr class="tg-sep" aria-hidden="true"><td colspan="${nCols}">${tit}</td></tr>${lst.map((x) => linhaTab(x, cls)).join("")}` : "";
    const th = (c, rot, cls = "", aj) => `<th class="ord ${cls}" data-col="${c}" ${T.col === c ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">${rot}</button>${aj ? " " + ajuda(aj, rot) : ""}</th>`;
    const corpoHtml = `
        <div class="tab-wrap"><table class="tg tg-part ${det ? "tg-det" : "tg-res"}">
          <thead>
            <tr class="grupo">
              <th rowspan="2" class="ord" data-col="nome" ${T.col === "nome" ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><div class="th-ramo"><button type="button">Ramo</button><span class="th-pos"><button type="button" class="th-pos-btn" data-col="pos"${T.col === "pos" ? ` aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}>Posição${T.col === "pos" ? (T.dir < 0 ? " ↓" : " ↑") : ""}</button></span></div></th>
              <th colspan="${det ? 1 : 2}" class="g">Market share da Akad</th>
              <th colspan="${det ? 4 : 2}" class="g">Vendas da Akad</th>
              ${det ? `<th class="g">Mercado do ramo</th>
              <th class="g">Quem lidera ${ajuda("ref", "quem lidera")}</th>` : ""}
            </tr>
            <tr>
              ${det ? "" : `<th class="barra g1" aria-hidden="true"><span class="pb-eixo">${ticks.filter((t, k) => !det || k % 2 === 0).map((t) => `<i style="left:${(t / escMax) * 100}%">${nf0.format(t)}%</i>`).join("")}</span></th>`}
              ${th("share", "Atual", det ? "n g1" : "n", "tShare")}
              ${th("pe", "GWP", "n g1")}${th("peso", "Peso na carteira", "n", "tPeso")}
              ${det ? `${th("dPe", "Variação (R$)", "n")}${th("cresc", "Variação (%)", "n")}
              ${th("mercado", "Total", "n g1", "tMerc")}
              <th class="g1">Seguradora</th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${comAkad.map((x) => linhaTab(x, x.n === 1 ? "suave" : "")).join("")}
            ${grupoTab("Sem prêmio da Akad no período", semA, "sem")}
          </tbody>
        </table></div>`;

    const ordAtivo = Object.keys(ORD_TAB).find((k) => ORD_TAB[k].col === T.col && ORD_TAB[k].dir === T.dir);
    const ORD_ROT = { pe: "Maior GWP", pos: "Melhor posição no ranking", share: "Maior market share", ganho: "Mais ganhou market share" };
    const ordSel = `<select id="pr-ord" class="pr-sel" aria-label="Ordenar ramos por">
      ${ordAtivo ? "" : `<option value="" selected>${{ nome: "Ramo", dShare: "Variação do market share", mov: "Variação no ranking", pe: "GWP da Akad", dPe: "Variação do GWP (R$)", cresc: "Variação do GWP (%)", vs: "vs. mercado", peso: "Peso na carteira", mercado: "Mercado do ramo", crescM: "Variação do mercado (%)", refShare: "Market share do concorrente", share: "Market share", pos: "Posição no ranking (do último ao 1º)" }[T.col] || "Coluna da tabela"}</option>`}
      ${Object.keys(ORD_ROT).map((k) => `<option value="${k}"${ordAtivo === k ? " selected" : ""}>${ORD_ROT[k]}</option>`).join("")}
    </select>`;
    const modoBtn = (k, rot) => `<button type="button" data-modo="${k}" aria-pressed="${modo === k}">${rot}</button>`;
    const participacao = `
      <section class="card sec" aria-labelledby="h-pbar">
        <div class="sec-cab pr-cab">
          <h2 id="h-pbar" class="sec-tit">Participação por ramo</h2>
          <div class="pr-ctrls">
            <div class="seg-ctrl ctrl-modo" role="group" aria-label="Nível de detalhe">${modoBtn("resumo", "Resumo")}${modoBtn("detalhado", "Detalhado")}</div>
            <label class="pr-ord"><span class="ctrl-rot">Ordenar por</span>${ordSel}</label>
            ${det ? "" : `<p class="legenda-pb legenda-topo pr-leg"><span class="lg-i"><span class="lg-fill"></span>Market share em ${per}</span>${perP ? `<span class="lg-i"><span class="lg-ant"></span>Como estava em ${perP}</span>` : ""}</p>`}
          </div>
        </div>
        ${corpoHtml}
      </section>`;

    el.innerHTML = contexto + panorama + movimentos + participacao;

    // Interações: um clique em qualquer linha (destaques, gráfico ou tabela) abre o detalhe
    el.querySelectorAll(".mv-item, .lk, .ct-item").forEach((b) => b.addEventListener("click", () => abrirLinha(b.dataset.linha || b.dataset.abrir)));
    el.querySelectorAll(".mv-gwp, .pos-grp").forEach((g) => {
      g.addEventListener("mouseenter", (ev) => mostrarTip(g.dataset.tip, ev));
      g.addEventListener("mousemove", (ev) => mostrarTip(g.dataset.tip, ev));
      g.addEventListener("mouseleave", esconderTip);
    });
    el.querySelectorAll("tbody tr[data-linha]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button")) abrirLinha(tr.dataset.linha); }));
    // Destaque sincronizado entre destaques, gráfico e tabela
    const hl = (id, on) => el.querySelectorAll(`[data-linha="${id}"]`).forEach((n) => n.classList.toggle("hl", on));
    el.querySelectorAll("tbody tr[data-linha], .mv-item").forEach((n) => {
      n.addEventListener("mouseenter", () => hl(n.dataset.linha, true));
      n.addEventListener("mouseleave", () => hl(n.dataset.linha, false));
      n.addEventListener("focusin", () => hl(n.dataset.linha, true));
      n.addEventListener("focusout", () => hl(n.dataset.linha, false));
    });
    el.querySelector("#pr-ord")?.addEventListener("change", (e) => { if (!e.target.value) return; S.geralOrd = e.target.value; S.geralTab = null; renderGeral(); el.querySelector("#pr-ord")?.focus(); });
    el.querySelectorAll(".ctrl-modo button").forEach((b) => b.addEventListener("click", () => { S.geralModo = b.dataset.modo; renderGeral(); el.querySelector(`.ctrl-modo [data-modo="${b.dataset.modo}"]`)?.focus(); }));
    const porColuna = (c, foco) => {
      const padrao = c === "pos" || c === "nome" ? 1 : -1;
      const atual = S.geralTab || (ORD_TAB[S.geralOrd] || ORD_TAB.pe);
      S.geralTab = { col: c, dir: atual.col === c ? -atual.dir : padrao };
      const k = Object.keys(ORD_TAB).find((o) => ORD_TAB[o].col === c && ORD_TAB[o].dir === S.geralTab.dir);
      if (k) S.geralOrd = k;
      renderGeral();
      el.querySelector(foco)?.focus();
    };
    el.querySelectorAll("th.ord").forEach((thEl) => thEl.querySelector("button").addEventListener("click", () => porColuna(thEl.dataset.col, `th[data-col="${thEl.dataset.col}"] button`)));
    el.querySelector(".th-pos-btn")?.addEventListener("click", () => porColuna("pos", ".th-pos-btn"));
  }

  /* ---------- Linhas de produto ---------- */
  function ramosDaSel(sel) {
    if (sel === "todas") return IDX.todos;
    if (sel.startsWith("m:")) return idsDaSel(sel).flatMap((x) => IDX.linhaPorId[x].idx);
    if (sel.startsWith("r:")) return [IDX.ramoIdx[sel.slice(2)]];
    return IDX.linhaPorId[sel].idx;
  }
  function nomeSel(sel) {
    if (sel === "todas") return `Todos os ${IDX.linhas.length} ramos acompanhados`;
    if (sel.startsWith("m:")) {
      const g = grupoDaSel(sel);
      if (g) return g.nome;
      const ns = idsDaSel(sel).map((x) => IDX.linhaPorId[x].nome);
      return ns.length <= 3 ? ns.slice(0, -1).join(", ") + " e " + ns[ns.length - 1] : `${ns.length} ramos: ${ns.slice(0, 3).join(", ")} e mais ${ns.length - 3}`;
    }
    if (sel.startsWith("r:")) { const c = sel.slice(2); return `${D.ramos[IDX.ramoIdx[c]][1]} (código ${c})`; }
    return IDX.linhaPorId[sel].nome;
  }
  // Página "Todos os ramos": um card por ramo, com o que ele cobre e onde a Akad está
  // Todos os ramos: matriz BCG adaptada (crescimento do mercado em 12 meses x posição da Akad no ranking) e tabela comparativa
  // Crescimento do mercado: 12 meses até o fim do período contra os 12 meses anteriores
  function cresc12(ramos, b) {
    if (b < 23) return null;
    const ag = total(agg(ramos, b - 11, b))[0], an = total(agg(ramos, b - 23, b - 12))[0];
    if (!(ag > 0) || !(an > 0)) return null;
    return (ag / an - 1) * 100;
  }
  const QUAD = {
    est: { nome: "Estrelas", um: "Estrela", cor: "#319C00", tit: "#319C00", crit: "Top 5 • mercado em alta", desc: "Negócio forte em mercado em expansão. Pede investimento para acompanhar o crescimento e manter a posição." },
    vac: { nome: "Vacas leiteiras", um: "Vaca leiteira", cor: "#1C4173", tit: "#1C4173", crit: "Top 5 • mercado lento", desc: "Negócio forte em mercado maduro. Gera mais resultado do que consome; a estratégia é defender a posição." },
    int: { nome: "Pontos de interrogação", um: "Ponto de interrogação", cor: "#E3175E", tit: "#E3175E", crit: "Fora do top 5 • mercado em alta", desc: "Mercado atrativo, mas a posição ainda é pequena. Pode virar Estrela se ganhar espaço; exige escolher onde apostar." },
    aba: { nome: "Abacaxis", um: "Abacaxi", cor: "#9E9E9E", tit: "#616161", crit: "Fora do top 5 • mercado lento", desc: "Posição pequena em mercado lento. A estratégia é rever a presença e manter só o que dá resultado." },
  };
  const QORD = ["est", "vac", "int", "aba"];
  const TOP_N = 5;
  const POS_Q = { est: [0, 0], int: [1, 0], vac: [0, 1], aba: [1, 1] };
  const miniQ = (k) => `<svg width="25" height="25" viewBox="0 0 25 25" aria-hidden="true">${Object.entries(POS_Q).map(([kk, [x, y]]) => `<rect x="${1 + x * 12}" y="${1 + y * 12}" width="11" height="11" rx="2" fill="${kk === k ? QUAD[k].cor : "var(--line)"}"/>`).join("")}</svg>`;
  const rotCurto = (n) => n.replace("RC Executivos (D&O)", "D&O").replace("Riscos Nomeados e Operacionais", "RNO")
    .replace("Transporte Internacional", "Transp. Internacional").replace("Transporte Nacional", "Transp. Nacional")
    .replace("Garantia Setor ", "Garantia ").replace("Prestamista Individual", "Prestamista Ind.").replace("Prestamista Coletivo", "Prestamista Col.");
  const fmtX = (v) => (v >= 10 || Number.isInteger(v) ? nf0.format(v) : v >= 1 ? nf1.format(v) : v >= 0.1 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : v >= 0.01 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "< 0,01") + "x";

  function renderCatalogo(el, P) {
    const per = periodoLabel(P.a, P.b);
    const abrirR = (id) => abrirDe("linhas", () => { S.linha = id; });
    const curto = (t) => t.replace(/\b(Companhia de Seguros Gerais|Companhia de Seguros|Cia de Seguros|Seguradora|Seguros Brasil|Seguros Gerais|Seguros Corporativos|Seguros)\b/gi, "").replace(/\s+/g, " ").trim() || t;
    // mercado somado dos ramos acompanhados: define o corte de crescimento
    const RT = resumo(IDX.linhas.flatMap((l) => l.idx), P);
    const cMed = cresc12(IDX.linhas.flatMap((l) => l.idx), P.b);
    const corteY = cMed != null ? cMed : 0;
    const per12 = P.b >= 11 ? `${mesLabel(P.b - 11, true)} a ${mesLabel(P.b, true)}` : "";
    const itens = IDX.linhas.map((l) => {
      const R = resumo(l.idx, P);
      const a = infoEnt(R, AKAD);
      const crM = cresc12(l.idx, P.b);
      const novo = crM != null && crM > 999;
      const lid = R.rk[0];
      const conc = R.rk.find((k) => k !== AKAD);
      const peC = conc != null ? (R.cur.get(conc) || [0])[0] : 0;
      const rel = a.pe > 0 ? (peC > 0 ? a.pe / peC : Infinity) : null;
      let q = null;
      const top = a.pos != null && a.pos <= TOP_N;
      if (a.pe > 0 && crM != null) q = top ? (crM >= corteY ? "est" : "vac") : (crM >= corteY ? "int" : "aba");
      return { l, R, a, crM, novo, lid, conc, rel, q, merc: R.tc[0], n: R.rk.length, akLidera: lid === AKAD && a.pe > 0, tem: a.pe > 0 };
    });
    const naMatriz = itens.filter((x) => x.q);
    const fora = itens.filter((x) => !x.q);
    const totA = naMatriz.reduce((s, x) => s + x.a.pe, 0);

    // ----- quadrantes: parte do GWP da Akad em cada um
    const porQ = QORD.map((k) => {
      const lst = naMatriz.filter((x) => x.q === k);
      const pe = lst.reduce((s, x) => s + x.a.pe, 0);
      return { k, n: lst.length, part: totA > 0 ? (pe / totA) * 100 : 0 };
    });
    const colsQ = porQ.map((g) => `
      <div class="tr-qc" data-q="${g.k}">
        <div class="tr-qh">${miniQ(g.k)}<b style="color:${QUAD[g.k].tit}">${QUAD[g.k].nome}</b></div>
        <div class="tr-ql" style="background:${QUAD[g.k].cor}"></div>
        <p class="tr-qcrit">${QUAD[g.k].crit}</p>
        <p class="tr-qd">${QUAD[g.k].desc}</p>
        <p class="tr-qv"><b>${pct(g.part)}</b> do GWP da Akad · ${g.n} ${g.n === 1 ? "ramo" : "ramos"}</p>
      </div>`).join("");

    // ----- tabela comparativa
    if (!S.trOrd) S.trOrd = { col: "merc", dir: -1 };
    if (!S.trFiltro) S.trFiltro = "todos";
    const filtros = [["todos", "Todos", () => true], ...QORD.map((k) => [k, QUAD[k].nome, (x) => x.q === k]), ["lider", "Akad lidera", (x) => x.akLidera], ["sem", "Sem prêmio", (x) => !x.tem]]
      .filter(([k, , f]) => k === "todos" || itens.some(f));
    if (!filtros.some(([k]) => k === S.trFiltro)) S.trFiltro = "todos";
    const val = {
      nome: (x) => x.l.nome, q: (x) => (x.q ? QORD.indexOf(x.q) : 9), merc: (x) => x.merc, crM: (x) => x.crM,
      share: (x) => x.a.share, dShare: (x) => x.a.dShare, pos: (x) => x.a.pos, rel: (x) => (x.rel === Infinity ? 1e9 : x.rel),
    };
    const ths = [["nome", "Ramo", ""], ["q", "Quadrante", ""], ["merc", "Mercado", "n", "tMerc"], ["crM", "Cresc. do mercado (12 meses)", "n", "trCresc"], ["share", "Market share", "n", "tShare"], ["dShare", "Variação", "n", "tPP"], ["pos", "Posição", "n", "tRank"], ["rel", "Share relativo", "n", "trRel"], [null, "Quem lidera", ""]];
    const tagQ = (x) => x.q ? `<span class="tr-tag" style="--c:${QUAD[x.q].cor}"><i></i>${QUAD[x.q].um}</span>` : `<span class="sub-i">${x.tem ? "sem histórico" : "sem prêmio"}</span>`;
    const linhaTr = (x) => `
      <tr data-linha="${x.l.id}" data-q="${x.q || ""}" data-lider="${x.akLidera ? 1 : 0}" data-sem="${x.tem ? 0 : 1}" data-busca="${esc((x.l.nome + " " + x.l.ramos.join(" ")).toLowerCase())}">
        <td class="nome"><button type="button" class="lk" data-abrir="${x.l.id}">${esc(x.l.nome)}</button><span class="sub">${x.l.ramos.join(", ")}</span></td>
        <td>${tagQ(x)}</td>
        <td class="n">${x.merc > 0 ? reais(x.merc) : '<span class="sub-i">sem dados</span>'}</td>
        <td class="n">${x.crM == null ? '<span class="sub-i" title="Sem histórico suficiente">sem histórico</span>' : x.novo ? '<span class="sub-i" title="O ramo quase não tinha prêmio nos 12 meses anteriores">ramo novo</span>' : crescNeutro(x.crM)}</td>
        <td class="n"><b>${x.tem ? pctPart(x.a.share) : "–"}</b></td>
        <td class="n">${x.tem ? ppSeta(x.a.dShare) : '<span class="var zero">–</span>'}</td>
        <td class="n">${x.a.pos ? `${x.a.pos}º <span class="sub-i">de ${x.n}</span>` : '<span class="sub-i">–</span>'}</td>
        <td class="n">${x.rel == null ? '<span class="sub-i">–</span>' : x.rel === Infinity ? "única" : fmtX(x.rel)}</td>
        <td class="ref" title="${x.lid != null ? esc(x.lid === AKAD ? (x.conc != null ? `2º lugar: ${nomeEnt(x.conc)}` : "Única seguradora no ramo") : nomeEnt(x.lid)) : ""}">${x.lid == null ? '<span class="sub-i">sem dados</span>' : x.lid === AKAD ? '<b class="lid-ak">Akad</b>' : esc(curto(nomeEnt(x.lid)))}</td>
      </tr>`;
    const ordenar = () => {
      const { col, dir } = S.trOrd;
      const f = val[col];
      return [...itens].sort((p, q) => {
        const va = f(p), vb = f(q);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return typeof va === "string" ? va.localeCompare(vb, "pt-BR") * dir : (va - vb) * dir;
      });
    };

    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>Todos os ramos</h2>
          <p>Compare os ${IDX.linhas.length} mercados em que a Akad atua e descubra onde ela está forte, onde perde espaço e onde há oportunidade.</p>
        </div>
      </div>
      <section class="tr-card tr-bcg" aria-labelledby="h-bcg">
        <h3 id="h-bcg" class="tr-tit">Matriz BCG dos ramos ${ajuda("trBcg", "matriz BCG")}</h3>
        <p class="tr-sub">Cada bolha é um ramo e o tamanho é o GWP da Akad em ${per}. O crescimento do mercado considera os últimos 12 meses${per12 ? ` (${per12})` : ""}. Clique numa bolha para abrir o ramo.</p>
        <div class="tr-mat" id="tr-mat"></div>
        ${fora.length ? `<p class="tr-rodape">Fora da matriz: ${fora.map((x) => esc(rotCurto(x.l.nome)) + (x.tem ? " (sem histórico)" : " (Akad sem prêmio)")).join(", ")}.</p>` : ""}
        <div class="tr-qs">
          <h4 class="tr-qtit">O que significa cada quadrante</h4>
          <div class="tr-q4">${colsQ}</div>
        </div>
      </section>
      <section class="tr-card" aria-labelledby="h-comp">
        <div class="tr-cab tr-cab-t"><h3 id="h-comp" class="tr-tit">Comparativo dos ramos</h3>
          <div class="tr-ctrls">
            <label class="rc-busca"><input type="search" id="tr-q" aria-label="Buscar ramo por nome ou código" placeholder="Buscar por nome ou código" value="${esc(S.rcBusca || "")}" autocomplete="off"></label>
            <label class="pr-ord"><span class="ctrl-rot">Mostrar</span><select id="tr-f" class="pr-sel" aria-label="Filtrar ramos">
              ${filtros.map(([k, n, f]) => `<option value="${k}"${S.trFiltro === k ? " selected" : ""}>${n} (${itens.filter(f).length})</option>`).join("")}
            </select></label>
          </div>
        </div>
        <div class="tab-wrap"><table class="tr-tab">
          <thead><tr>${ths.map(([c, r, cls, aj]) => c ? `<th class="ord ${cls}" data-col="${c}"${S.trOrd.col === c ? ` aria-sort="${S.trOrd.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">${r}</button>${aj ? " " + ajuda(aj, r) : ""}</th>` : `<th>${r}</th>`).join("")}</tr></thead>
          <tbody>${ordenar().map(linhaTr).join("")}</tbody>
        </table></div>
        <p class="rc-vazio" hidden>Nenhum ramo encontrado com esse filtro.</p>
      </section>`;

    // ----- desenho da matriz (SVG na largura real do card, para o texto não encolher)
    const host = el.querySelector("#tr-mat");
    const W = Math.max(300, Math.round(host.clientWidth || 700));
    const peq = W < 560;
    const H = peq ? 400 : 470;
    const L = 52, Rr = 14, T = 12, B = 46;
    const nMax = Math.max(10, ...naMatriz.map((x) => x.n));
    const lx0 = Math.log(0.8), lx1 = Math.log(nMax * 1.25);
    const xs = (p) => L + ((Math.log(p) - lx0) / (lx1 - lx0)) * (W - L - Rr);
    const crs = naMatriz.filter((x) => !x.novo).map((x) => x.crM);
    const ymaxR = Math.max(corteY + 10, ...crs.filter((v) => v < 60));
    const ymin = Math.floor((Math.min(corteY - 10, ...crs) - 5) / 10) * 10;
    const ymax = Math.ceil((ymaxR + 5) / 10) * 10;
    const ys = (v) => { v = Math.max(ymin, Math.min(v, ymax)); return H - B - ((v - ymin) / (ymax - ymin)) * (H - B - T); };
    const xc = xs(TOP_N + 0.5), yc = ys(corteY);
    const isDark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    const fundo = isDark ? { est: "rgba(49,156,0,.14)", int: "rgba(227,23,94,.12)", vac: "rgba(124,151,184,.16)", aba: "rgba(158,158,158,.10)" } : { est: "#F1FCEB", int: "#FFF2F6", vac: "#EEF3F8", aba: "#F7F7F7" };
    const corQ = (k) => (isDark && k === "vac" ? "#7C97B8" : QUAD[k].cor);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Matriz BCG: crescimento do mercado de cada ramo contra a posição da Akad no ranking">`;
    s += `<rect x="${L}" y="${T}" width="${xc - L}" height="${yc - T}" fill="${fundo.est}"/><rect x="${xc}" y="${T}" width="${W - Rr - xc}" height="${yc - T}" fill="${fundo.int}"/><rect x="${L}" y="${yc}" width="${xc - L}" height="${H - B - yc}" fill="${fundo.vac}"/><rect x="${xc}" y="${yc}" width="${W - Rr - xc}" height="${H - B - yc}" fill="${fundo.aba}"/>`;
    const passo = ymax - ymin > 60 ? 20 : 10;
    for (let v = Math.ceil(ymin / passo) * passo; v <= ymax; v += passo) s += `<line x1="${L}" x2="${W - Rr}" y1="${ys(v)}" y2="${ys(v)}" class="tr-grid"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end" class="tr-ax">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%</text>`;
    for (const p of (peq ? [1, 2, 5, 10, 20, 50] : [1, 2, 3, 5, 10, 20, 50])) if (p <= nMax * 1.2) s += `<text x="${xs(p)}" y="${H - B + 16}" text-anchor="middle" class="tr-ax">${p}º</text>`;
    s += `<line x1="${xc}" x2="${xc}" y1="${T}" y2="${H - B}" class="tr-corte"/><line x1="${L}" x2="${W - Rr}" y1="${yc}" y2="${yc}" class="tr-corte"/>`;
    s += `<text x="${xc + 5}" y="${H - B - 6}" class="tr-ax">top ${TOP_N}</text><text x="${W - Rr - 6}" y="${yc - 6}" text-anchor="end" class="tr-ax">média dos ${IDX.linhas.length} ramos: ${cMed != null ? (cMed >= 0 ? "+" : "−") + nf1.format(Math.abs(cMed)) + "%" : "–"}</text>`;
    s += `<text x="${(W + L) / 2}" y="${H - 6}" text-anchor="middle" class="tr-ax-t">Posição da Akad no ranking do ramo →</text>`;
    s += `<text transform="translate(12,${(H - B + T) / 2}) rotate(-90)" text-anchor="middle" class="tr-ax-t">Crescimento do mercado, últimos 12 meses →</text>`;
    const ocup = [];
    const qLab = { est: [L + 8, yc - 8, "start"], int: [W - Rr - 8, T + 16, "end"], vac: [L + 8, H - B - 8, "start"], aba: [W - Rr - 8, H - B - 8, "end"] };
    for (const k of QORD) {
      const [x, y, anc] = qLab[k];
      const w = QUAD[k].nome.length * 7.8;
      const x0 = anc === "start" ? x : x - w;
      ocup.push([x0, y - 12, x0 + w, y + 2]);
      s += `<text x="${x}" y="${y}" text-anchor="${anc}" class="tr-q" fill="${k === "aba" ? "var(--ink-2)" : corQ(k)}">${QUAD[k].nome.toUpperCase()}</text>`;
    }
    const maxA = Math.max(...naMatriz.map((x) => x.a.pe));
    const rMax = peq ? 20 : 28;
    const circ = [];
    const ord = [...naMatriz].sort((p, q) => q.a.pe - p.a.pe);
    for (const x of ord) {
      // área da bolha proporcional ao GWP; ramos empatados na mesma posição ficam levemente afastados
      const r = Math.max(3.5, Math.sqrt(x.a.pe / maxA) * rMax);
      const emp = ord.filter((o) => o.a.pos === x.a.pos);
      const cx = xs(x.a.pos) + (emp.indexOf(x) - (emp.length - 1) / 2) * 18, cy = ys(x.novo ? ymax : x.crM);
      x._b = [cx, cy, r];
      circ.push([cx, cy, r]);
      s += `<circle class="tr-b" data-linha="${x.l.id}" data-q="${x.q}" cx="${cx}" cy="${cy}" r="${r}" fill="${corQ(x.q)}" fill-opacity=".3" stroke="${corQ(x.q)}" stroke-width="1.5" tabindex="0" role="button" aria-label="${esc(x.l.nome)}: ${QUAD[x.q].nome}"/>`;
    }
    const bate = (b) => ocup.some((p) => !(b[2] < p[0] || b[0] > p[2] || b[3] < p[1] || b[1] > p[3]))
      || circ.some(([cx, cy, r]) => b[0] < cx + r * 0.6 && b[2] > cx - r * 0.6 && b[1] < cy + r * 0.6 && b[3] > cy - r * 0.6)
      || b[0] < L + 2 || b[2] > W - Rr - 2 || b[1] < T || b[3] > H - B;
    let rotulos = "";
    for (const x of ord) {
      const [cx, cy, r] = x._b;
      const t = rotCurto(x.l.nome) + (x.novo ? " (ramo novo) ↑" : x.crM > ymax ? " ↑" : "");
      const w = t.length * 6.2;
      for (const [anc, tx, ty] of [["start", cx + r + 3, cy + 4], ["end", cx - r - 3, cy + 4], ["middle", cx, cy - r - 4], ["middle", cx, cy + r + 12], ["start", cx + r + 2, cy - r], ["start", cx + r + 2, cy + r + 8]]) {
        const x0 = anc === "start" ? tx : anc === "end" ? tx - w : tx - w / 2;
        const b = [x0, ty - 10, x0 + w, ty + 2];
        if (!bate(b)) { ocup.push(b); rotulos += `<text x="${tx}" y="${ty}" text-anchor="${anc}" class="tr-rot" data-linha="${x.l.id}">${esc(t)}</text>`; break; }
      }
    }
    host.innerHTML = s + rotulos + "</svg>";

    // ----- interações
    const tipB = (x) => `<b>${esc(x.l.nome)}</b><div style="color:${corQ(x.q)};font-weight:600">${QUAD[x.q].nome}</div>
      <div>Posição da Akad: ${x.a.pos}º de ${x.n}${x.lid !== AKAD && x.lid != null ? ` (líder: ${esc(curto(nomeEnt(x.lid)))})` : ""}</div>
      <div>Crescimento do mercado em 12 meses: ${x.novo ? "ramo novo" : (x.crM > 0 ? "+" : x.crM < 0 ? "−" : "") + nf1.format(Math.abs(x.crM)) + "%"}</div>
      <div>GWP da Akad: ${reais(x.a.pe)} · market share ${pctPart(x.a.share)}</div>
      <div>Mercado no período: ${reais(x.merc)}</div>`;
    const porId = Object.fromEntries(itens.map((x) => [x.l.id, x]));
    const hlQ = (q) => { host.querySelector("svg").classList.toggle("foco", !!q); host.querySelectorAll(".tr-b").forEach((c) => c.classList.toggle("on", c.dataset.q === q)); };
    host.querySelectorAll(".tr-b, .tr-rot").forEach((c) => {
      const x = porId[c.dataset.linha];
      c.addEventListener("mouseenter", (ev) => { mostrarTip(tipB(x), ev); host.querySelector(`.tr-b[data-linha="${x.l.id}"]`).classList.add("hov"); });
      c.addEventListener("mousemove", (ev) => mostrarTip(tipB(x), ev));
      c.addEventListener("mouseleave", () => { esconderTip(); host.querySelectorAll(".hov").forEach((n) => n.classList.remove("hov")); });
      c.addEventListener("click", () => abrirR(x.l.id));
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirR(x.l.id); } });
    });
    el.querySelectorAll(".tr-qc").forEach((n) => {
      n.addEventListener("mouseenter", () => hlQ(n.dataset.q));
      n.addEventListener("mouseleave", () => hlQ(null));
    });
    const aplicar = () => {
      const q = (S.rcBusca || "").trim().toLowerCase();
      const f = S.trFiltro;
      let n = 0;
      el.querySelectorAll(".tr-tab tbody tr").forEach((tr) => {
        const okF = f === "todos" || (f === "lider" ? tr.dataset.lider === "1" : f === "sem" ? tr.dataset.sem === "1" : tr.dataset.q === f);
        const ok = okF && (!q || tr.dataset.busca.includes(q));
        tr.hidden = !ok; if (ok) n++;
      });
      el.querySelector(".rc-vazio").hidden = n > 0;
    };
    el.querySelector("#tr-q").addEventListener("input", (e) => { S.rcBusca = e.target.value; aplicar(); });
    el.querySelector("#tr-f").addEventListener("change", (e) => { S.trFiltro = e.target.value; aplicar(); });
    el.querySelectorAll(".tr-tab th.ord > button:not(.ajuda)").forEach((b) => b.addEventListener("click", () => {
      const c = b.parentElement.dataset.col;
      S.trOrd = S.trOrd.col === c ? { col: c, dir: -S.trOrd.dir } : { col: c, dir: c === "nome" || c === "q" || c === "pos" ? 1 : -1 };
      renderCatalogo(el, P);
    }));
    el.querySelectorAll(".tr-tab tbody tr").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest(".ajuda")) abrirR(tr.dataset.linha); }));
    aplicar();
  }

  function renderLinhas() {
    const P = periodo();
    const el = $("#aba-linhas");
    if (S.linha === "todas") return renderCatalogo(el, P);
    const ramos = ramosDaSel(S.linha);
    const R = resumo(ramos, P);
    const ak = infoEnt(R, AKAD);
    const sinM = R.tc[1] > 0 ? (R.tc[2] / R.tc[1]) * 100 : null;
    const comM = R.tc[1] > 0 ? (R.tc[3] / R.tc[1]) * 100 : null;
    const top = R.rk.filter((k) => k !== AKAD).slice(0, 4);

    // tabela de ranking
    const lista = R.rk.slice(0, 15);
    if (!lista.includes(AKAD) && R.cur.has(AKAD)) lista.push(AKAD);
    const linhasTab = lista.map((k) => ({ k, ...infoEnt(R, k) }));
    const o = S.rankOrd;
    const perR = P.pa != null ? periodoLabel(P.pa, P.pb) : "período anterior";
    linhasTab.sort((p, q) => {
      const va = p[o.col], vb = q[o.col];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * o.dir;
    });

    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>${esc(nomeSel(S.linha))}</h2>
          <p>${S.linha === "todas" ? `Soma dos ${IDX.linhas.length} ramos acompanhados. Escolha um ramo no filtro para ver o detalhe.` : (ramos.length > 1 ? `Valores somados de ${ramos.length} ramos. Códigos SUSEP: ` : "Código SUSEP: ") + ramos.map((i) => esc(D.ramos[i][0] + " " + D.ramos[i][1])).join(" · ")}</p>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi destaque"><span class="rot">Posição da Akad</span><span class="val">${ak.pos ? ak.pos + "º" : "–"} <small style="font-size:.9rem;color:var(--muted)">de ${R.rk.length}</small></span><span class="det">${ak.posP ? `No ano anterior: ${ak.posP}º` : "Sem prêmio no ano anterior"}</span></div>
        <div class="kpi"><span class="rot">Participação Akad</span><span class="val">${pct(ak.share)}</span><span class="det">${ppHtml(ak.dShare)} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">GWP Akad</span><span class="val">${reais(ak.pe)}</span><span class="det">${varHtml(ak.cresc)} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Mercado</span><span class="val">${reais(R.tc[0])}</span><span class="det">${varHtml(cresc(R.tc[0], R.tp[0]))} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Sinistralidade</span><span class="val">${pct(ak.sin)}</span><span class="det">Mercado: ${pct(sinM)}</span></div>
        <div class="kpi"><span class="rot">Despesa comercial</span><span class="val">${pct(ak.com)}</span><span class="det">Mercado: ${pct(comM)} (÷ prêmio ganho)</span></div>
      </div>
      <div class="grade">
        <div class="bloco c12">
          <div class="bloco-cab pr-cab"><div><h2>Produção da Akad em ${esc(nomeSel(S.linha))}</h2><p class="nota" id="g-prod-nota"></p></div>
            <div class="pr-btns">
              <div class="seg-ctrl" role="group" aria-label="Medida">${[["gwp", "GWP"], ["share", "Market share"]].map(([k, r]) => `<button type="button" data-pmet="${k}" aria-pressed="${(S.prodMet || "gwp") === k}">${r}</button>`).join("")}</div>
              <div class="seg-ctrl" role="group" aria-label="Período">${[["mes", "Por mês"], ["ano", "Por ano"]].map(([k, r]) => `<button type="button" data-pvis="${k}" aria-pressed="${(S.prodVis || "mes") === k}">${r}</button>`).join("")}</div>
              <label class="pr-ord pr-desde"${(S.prodVis || "mes") === "mes" ? "" : " hidden"}><span class="ctrl-rot">Desde</span><select id="g-prod-ini" class="pr-sel" aria-label="Mostrar meses desde"></select></label>
            </div>
          </div>
          <div class="pr-leg" id="g-prod-leg"></div>
          <div class="graf" id="g-prod"></div>
        </div>
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Tamanho do mercado por ano</h2><p class="nota">GWP de todas as seguradoras no ramo. * ano parcial</p></div>
          <div class="graf" id="g-merc"></div>
        </div>
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Ranking do período</h2><p class="nota">Clique num concorrente para ver o detalhe. Clique no título da coluna para ordenar.</p></div>
          <div class="tab-wrap"><table class="rk-tab">
            <thead><tr>
              <th class="rk-seg"><div class="th-ramo"><span>Seguradora</span><span class="th-pos"><button type="button" class="th-pos-btn" data-col="pos"${o.col === "pos" ? ` aria-sort="${o.dir < 0 ? "descending" : "ascending"}"` : ""}>Posição${o.col === "pos" ? (o.dir < 0 ? " ↓" : " ↑") : ""}</button></span></div></th>
              <th class="n ord" data-col="pe">GWP</th><th class="n ord" data-col="share">Market share</th>
              <th class="n ord" data-col="dShare">Variação do share</th><th class="n ord" data-col="cresc">Crescimento</th>
              <th class="n ord" data-col="sin">Sinistralidade</th><th class="n ord" data-col="com">Desp. comercial</th>
            </tr></thead>
            <tbody>${linhasTab.map((x) => `
              <tr class="${x.k === AKAD ? "akad" : "clic"}" data-ent="${esc(x.k)}">
                <td class="nome"><div class="nome-in"><span>${esc(nomeEnt(x.k))}</span>${x.pos ? `<span class="pos-grp" data-tip="${esc(`<b>${x.pos}º de ${R.rk.length}</b><div>${!x.posP ? `Sem prêmio em ${perR}` : x.posP === x.pos ? `Mesma posição de ${perR}` : `${x.posP > x.pos ? "Subiu" : "Caiu"} ${Math.abs(x.posP - x.pos)} ${Math.abs(x.posP - x.pos) === 1 ? "posição" : "posições"} contra ${perR} (era ${x.posP}º)`}</div>`)}">${seloPosicao(x.pos)}${movHtml(x.pos, x.posP).replace(/ title="[^"]*"/, "")}</span>` : ""}</div></td>
                <td class="n">${reais(x.pe)}</td>
                <td class="n">${pct(x.share)}<span class="barrinha" style="width:${Math.max(2, Math.min(60, (x.share || 0) * 1.2))}px;${x.k === AKAD ? "" : "background:var(--axis)"}"></span></td>
                <td class="n">${ppHtml(x.dShare)}</td>
                <td class="n">${varHtml(x.cresc)}</td>
                <td class="n">${pct(x.sin)}</td>
                <td class="n">${pct(x.com)}</td>
              </tr>`).join("")}
            </tbody>
          </table></div>
        </div>
      </div>`;

    el.querySelectorAll(".rk-tab .pos-grp").forEach((g) => {
      g.addEventListener("mousemove", (ev) => mostrarTip(g.dataset.tip, ev));
      g.addEventListener("mouseleave", esconderTip);
    });
    el.querySelectorAll(".rk-tab th.ord, .rk-tab .th-pos-btn").forEach((th) => {
      if (th.tagName === "TH" && th.dataset.col === o.col) th.setAttribute("aria-sort", o.dir < 0 ? "descending" : "ascending");
      th.addEventListener("click", () => {
        const c = th.dataset.col;
        S.rankOrd = { col: c, dir: S.rankOrd.col === c ? -S.rankOrd.dir : (c === "pos" ? 1 : -1) };
        renderLinhas();
      });
    });
    el.querySelectorAll("tr.clic[data-ent]").forEach((tr) => tr.addEventListener("click", () => {
      S.ccAbrir = tr.dataset.ent;
      abrirDe("conc");
    }));

    // gráficos
    const chaves = [AKAD, ...top];
    const sm = serieMensal(ramos, chaves);
    const desenharProd = () => {
      const itens = graficoProducao($("#g-prod"), sm, P);
      const vis = S.prodVis || "mes", met = S.prodMet || "gwp";
      const fimLab = mesLabel(P.b, true);
      $("#g-prod-nota").textContent = vis === "mes"
        ? `${met === "gwp" ? "GWP" : "Market share"} por mês, de ${itens[0].tit} a ${fimLab}.`
        : `${met === "gwp" ? "GWP" : "Market share"} por ano.${itens.some((x) => x.parc) ? ` * ano parcial, comparado com os mesmos meses do ano anterior.` : ""}`;
      const anos = vis === "mes" ? [...new Set(itens.map((x) => x.ano))] : [];
      const selIni = $("#g-prod-ini");
      selIni.closest(".pr-desde").hidden = vis !== "mes";
      if (vis === "mes") {
        const iniAtual = D.meses.indexOf(itens.length ? itens[0].ym : "");
        let opts = "";
        for (let y = +D.meses[P.b].slice(0, 4); y >= +D.meses[0].slice(0, 4); y--) {
          let o = "";
          for (let i = P.b; i >= 0; i--) if (+D.meses[i].slice(0, 4) === y) o = `<option value="${D.meses[i]}"${i === iniAtual ? " selected" : ""}>${mesLabel(i, true)}</option>` + o;
          if (o) opts += `<optgroup label="${y}">${o}</optgroup>`;
        }
        selIni.innerHTML = opts;
      }
      $("#g-prod-leg").innerHTML = anos.map((y) => `<span><i style="background:${itens.find((x) => x.ano === y).cor}"></i>${y}</span>`).join("");
    };
    desenharProd();
    $("#g-prod-ini").addEventListener("change", (e) => { S.prodIni = e.target.value; desenharProd(); });
    el.querySelectorAll("[data-pmet],[data-pvis]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.pmet) S.prodMet = b.dataset.pmet; else S.prodVis = b.dataset.pvis;
      el.querySelectorAll("[data-pmet]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.pmet === (S.prodMet || "gwp"))));
      el.querySelectorAll("[data-pvis]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.pvis === (S.prodVis || "mes"))));
      desenharProd();
    }));
    const anosM = porAno(Array.from(sm.mercado));
    const rot = [...anosM.keys()];
    const ultMes = D.meses[D.meses.length - 1];
    const parcial = rot.map((y) => (y === ultMes.slice(0, 4) && !ultMes.endsWith("12") ? `até ${MESES_PT[+ultMes.slice(4) - 1]}` : null));
    barras($("#g-merc"), { rotulos: rot, valores: rot.map((y) => anosM.get(y)), cor: css("--mercado"), fmt: reais, fmtCurto: reaisCurto, parcial, rotulo: "Mercado por ano" });
  }

  /* ---------- Concorrentes ---------- */
  const MAX_CONC = 4;
  function concorrentesPadrao(P, n) {
    const cont = new Map();
    for (const l of IDX.linhas) {
      const R = resumo(l.idx, P);
      if (!R.cur.has(AKAD)) continue;
      R.rk.filter((k) => k !== AKAD).slice(0, 5).forEach((k, i) => cont.set(k, (cont.get(k) || 0) + 5 - i));
    }
    return [...cont.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  }
  const corEnt = (i) => (i === 0 ? css("--akad") : css(CORES_CONC[(i - 1) % CORES_CONC.length]));
  const bolinha = (i) => `<i class="bol" style="background:${corEnt(i)}" aria-hidden="true"></i>`;

  // Concorrentes: quem disputa com a Akad, quem ganhou espaço, comparação lado a lado e estados
  // Agrega 12 meses por seguradora: [GWP, prêmio ganho, sinistro, despesa comercial, resseguro cedido]
  function agg5(ramos, a, b) {
    const m = new Map();
    if (a < 0) return m;
    for (const ri of ramos) for (const r of IDX.porRamo[ri]) {
      if (r[0] < a || r[0] > b) continue;
      const k = IDX.chave[r[1]];
      let x = m.get(k); if (!x) { x = [0, 0, 0, 0, 0]; m.set(k, x); }
      x[0] += r[3]; x[1] += r[4]; x[2] += r[5]; x[3] += r[6]; x[4] += r[7] || 0;
    }
    return m;
  }
  const soma5 = (m) => { const t = [0, 0, 0, 0, 0]; for (const x of m.values()) for (let i = 0; i < 5; i++) t[i] += x[i]; return t; };
  const rkDe = (m) => [...m.entries()].filter(([, x]) => x[0] > 0).sort((p, q) => q[1][0] - p[1][0]).map(([k]) => k);
  const nomeC = (k) => (k === AKAD ? "Akad" : nomeCurtoCia(nomeEnt(k)));

  const ABREV_RAMO = { rcpro: "RC Prof.", do: "D&O", rcg: "RC Geral", emp: "Empresarial", rno: "Riscos Nom.", equip: "Equipam.", eng: "Engenharia", transpnac: "Transp. Nac.", transpint: "Transp. Int.", garpub: "Gar. Pública", garpriv: "Gar. Privada", fianca: "Fiança", prestcol: "Prest. Col.", prestind: "Prest. Ind." };
  function renderConc() {
    ligarAjuda();
    const P = periodo();
    const el = $("#aba-conc");
    const b = P.b, a12 = b - 11;
    const per12 = a12 >= 0 ? `${mesLabel(a12, true)} a ${mesLabel(b, true)}` : "";
    const ramosSel = ramosDaSel(S.linha);
    const linhasSel = IDX.linhas.filter((l) => l.idx.some((i) => ramosSel.includes(i)));
    const umRamo = linhasSel.length === 1;
    const shareDe = (m, t, k) => (t > 0 ? (((m.get(k) || [0])[0]) / t) * 100 : 0);
    const gw = (m, k) => Math.max(0, (m.get(k) || [0])[0]);
    const sgn = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
    const ppTxt = (v) => (Math.abs(v) < 0.05 ? "0,0 p.p." : `${sgn(v)}${nf1.format(Math.abs(v))} p.p.`);
    const bi2 = (v, curto) => (v >= 1e6 ? `${curto ? "" : "R$ "}${(v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bi` : curto ? reaisCurto(v) : reais(v));
    const clsV = (v, lim = 0.05) => (v > lim ? "up" : v < -lim ? "dn" : "zero");

    // ----- por ramo: 12 meses e 12 anteriores
    const porL = linhasSel.map((l) => {
      const c = agg5(l.idx, a12, b), p = agg5(l.idx, a12 - 12, b - 12);
      const tc = soma5(c)[0], tp = soma5(p)[0];
      const rk = rkDe(c), rkp = rkDe(p);
      return { l, c, p, tc, tp, rk, rkp, ak: gw(c, AKAD), akp: gw(p, AKAD), pos: rk.indexOf(AKAD) + 1, posP: rkp.indexOf(AKAD) + 1, sh: shareDe(c, tc, AKAD), shP: tp > 0 ? shareDe(p, tp, AKAD) : null };
    });
    const atua = porL.filter((x) => x.ak > 0).sort((p, q) => q.ak - p.ak);
    const akT = atua.reduce((s, x) => s + x.ak, 0);
    const akTp = porL.reduce((s, x) => s + x.akp, 0);
    atua.forEach((x) => { x.peso = akT > 0 ? (x.ak / akT) * 100 : 0; x.d = x.shP != null ? x.sh - x.shP : null; });
    const nomeSelR = S.linha === "todas" ? `em todos os ${atua.length} ramos em que a Akad vende` : umRamo ? `em ${esc(linhasSel[0].nome)}` : `em ${esc(nomeSel(S.linha))}`;

    if (!atua.length) {
      el.innerHTML = `<div class="cab-aba"><div><h2>Concorrentes</h2><p>A Akad não tem prêmio ${S.linha === "todas" ? "no período" : `em ${esc(nomeSel(S.linha))}`} nos últimos 12 meses (${per12}). Escolha outro ramo no filtro.</p></div></div>`;
      return;
    }

    // ----- cards
    const ramosAk = atua.flatMap((x) => x.l.idx.filter((i) => ramosSel.includes(i)));
    const X = soma5(new Map(atua.map((x, i) => [i, x.c.get(AKAD) || [0, 0, 0, 0, 0]])));
    const MT = soma5(agg5(ramosAk, a12, b));
    const sinA = X[1] > 0 ? (X[2] / X[1]) * 100 : null, comA = X[1] > 0 ? (X[3] / X[1]) * 100 : null;
    const sinM = MT[1] > 0 ? (MT[2] / MT[1]) * 100 : null, comM = MT[1] > 0 ? (MT[3] / MT[1]) * 100 : null;
    const crA = cresc(akT, akTp);
    const hb = (rot, v, mx, cor, txt, forte) => `<div class="c2-hb"><span class="c2-hl">${rot}</span><span class="c2-ht"><i style="width:${mx > 0 ? (Math.max(0, v) / mx) * 100 : 0}%;background:${cor}"></i></span><span class="c2-hv${forte ? " b" : ""}">${txt}</span></div>`;
    const card = (tit, num, desc, vis, aj) => `<div class="c2-kc"><p class="c2-kt">${tit}${aj ? " " + ajuda(aj, tit) : ""}</p><p class="c2-kn">${num}</p><p class="c2-kd">${desc}</p><div class="c2-kv">${vis}</div></div>`;
    const mxG = Math.max(akT, akTp);
    const k1 = card(umRamo ? "GWP da Akad no ramo" : "GWP da Akad", bi2(akT),
      crA == null ? "sem prêmio nos 12 meses anteriores" : `<b class="${crA < 0 ? "dn" : "up"}">${crA < 0 ? "▼" : "▲"} ${crA > 999 ? "> 999" : nf1.format(Math.abs(crA))}%</b> em 12 meses`,
      hb("12 meses antes", akTp, mxG, "#F9C9DA", bi2(akTp, true)) + hb("Últimos 12 meses", akT, mxG, "var(--akad)", bi2(akT, true), true));
    let k2, k3;
    if (umRamo) {
      const x = atua[0];
      const dP = x.posP ? x.posP - x.pos : null;
      k2 = card("Posição da Akad", `${x.pos}º <small>de ${x.rk.length}</small>`, dP == null ? "sem prêmio nos 12 meses anteriores" : dP === 0 ? "mesma posição de 12 meses antes" : `<b class="${dP > 0 ? "up" : "dn"}">${dP > 0 ? "▲ subiu" : "▼ caiu"} ${Math.abs(dP)}</b> (era ${x.posP}º)`,
        `<div class="c2-rk">${x.rk.slice(0, Math.min(10, x.rk.length)).map((k, i) => `<span class="${k === AKAD ? "on" : ""}" title="${i + 1}º ${esc(nomeC(k))}">${i + 1}</span>`).join("")}</div>`);
      const mxS = Math.max(x.sh, x.shP || 0);
      k3 = card("Market share da Akad", pctPart(x.sh), x.d == null ? "sem prêmio nos 12 meses anteriores" : `<b class="${clsV(x.d)}">${x.d < -0.05 ? "▼ " : x.d > 0.05 ? "▲ " : ""}${ppTxt(x.d)}</b> em 12 meses`,
        hb("12 meses antes", x.shP || 0, mxS, "#F9C9DA", pctPart(x.shP)) + hb("Últimos 12 meses", x.sh, mxS, "var(--akad)", pctPart(x.sh), true));
    } else {
      const top5 = atua.filter((x) => x.pos && x.pos <= 5);
      const lid = atua.filter((x) => x.pos === 1).map((x) => esc(x.l.nome));
      k2 = card("Akad no top 5", `${top5.length} <small>de ${atua.length} ramos</small>`, top5.length ? `lidera ${lid.length === 0 ? "nenhum deles" : lid.length === 1 ? "1 deles" : `${lid.length} deles`}` : "não está no top 5 de nenhum ramo",
        `<div class="c2-tl">${top5.map((x) => `<span class="${x.pos === 1 ? "lid" : ""}" data-tip="${esc(`<b>${esc(x.l.nome)}</b><div>Akad ${x.pos}º de ${x.rk.length}</div><div>Peso na carteira: ${nf1.format(x.peso)}%</div>`)}"><b>${esc(ABREV_RAMO[x.l.id] || x.l.nome).replace(/-/g, "\u2011")}</b><i>${x.pos}º</i></span>`).join("")}</div>
         <p class="c2-lg"><i style="background:var(--akad)"></i>1º lugar <i class="c2-lg25"></i>2º a 5º<span class="c2-lgd">ordem: peso na carteira</span></p>`, "ccTop5");
      const lost = atua.filter((x) => x.d != null && x.d < -0.05), won = atua.filter((x) => x.d != null && x.d > 0.05);
      const pl = lost.reduce((s, x) => s + x.peso, 0), pw = won.reduce((s, x) => s + x.peso, 0), pe = Math.max(0, 100 - pl - pw);
      k3 = card("Perdeu market share em", `${lost.length} <small>de ${atua.length} ramos</small>`, `que somam <b>${nf0.format(pl)}%</b> do faturamento da Akad`,
        `<div class="c2-seg"><i style="width:${pl}%;background:var(--ruim)"></i><i style="width:${pw}%;background:var(--bom)"></i><i style="width:${pe}%;background:var(--axis)"></i></div>
         <p class="c2-lg"><i style="background:var(--ruim)"></i>Perdeu ${nf0.format(pl)}% <i style="background:var(--bom)"></i>Ganhou ${nf0.format(pw)}% <i style="background:var(--axis)"></i>Estável</p>`, "ccPerdeu");
    }
    const stk = (rot, s, c, forte) => `<div class="c2-hb"><span class="c2-hl">${rot}</span><span class="c2-ht"><i style="width:${Math.min(100, s || 0)}%;background:var(--mercado)"></i><i style="width:${Math.min(100 - Math.min(100, s || 0), c || 0)}%;background:#7C97B8"></i></span><span class="c2-hv${forte ? " b" : ""}">${s == null ? "–" : nf0.format(s + c) + "%"}</span></div>`;
    const k4 = card("Sinistralidade + comercialização", sinA == null ? "–" : `${nf0.format(sinA + comA)}%`,
      sinA == null ? "sem prêmio ganho no período" : `a cada R$ 100 de prêmio ganho, R$ ${nf0.format(sinA)} foram para sinistros e R$ ${nf0.format(comA)} para comercialização`,
      stk("Mercado", sinM, comM) + stk("Akad", sinA, comA, true) + `<p class="c2-lg"><i style="background:var(--mercado)"></i>Sinistros <i style="background:#7C97B8"></i>Comercialização</p>`, "ccSinCom");

    // ----- quem são os concorrentes (share médio ponderado pelo peso na carteira da Akad)
    const todosL = IDX.linhas.map((l) => agg5(l.idx, a12, b));
    const akVec = todosL.map((m) => gw(m, AKAD));
    const nAk = Math.sqrt(akVec.reduce((s, v) => s + v * v, 0));
    const ents = new Set(); for (const x of atua) { for (const k of x.c.keys()) if (k !== AKAD) ents.add(k); for (const k of x.p.keys()) if (k !== AKAD) ents.add(k); }
    const info = [...ents].map((k) => {
      const ws = atua.reduce((s, x) => s + (x.peso / 100) * shareDe(x.c, x.tc, k), 0);
      const wsp = atua.reduce((s, x) => s + (x.peso / 100) * shareDe(x.p, x.tp, k), 0);
      const h2h = atua.filter((x) => { const i = x.rk.indexOf(k); return i > -1 && i < 5 && x.pos && x.pos <= 5; }).length;
      const v = todosL.map((m) => gw(m, k));
      const nv = Math.sqrt(v.reduce((s, y) => s + y * y, 0));
      const sim = nAk && nv ? v.reduce((s, y, i) => s + y * akVec[i], 0) / (nAk * nv) : 0;
      return { k, ws, dws: ws - wsp, h2h, sim };
    });
    const minWs = umRamo ? 0.5 : 0.8;
    const usados = new Set();
    const tomar = (lst, n) => { const r = lst.filter((x) => !usados.has(x.k) && x.ws >= minWs).slice(0, n); r.forEach((x) => usados.add(x.k)); return r; };
    const direto = tomar([...info].sort((p, q) => (q.h2h - p.h2h) || (q.ws - p.ws)), 4);
    const ganhando = tomar(info.filter((x) => x.dws > 0.05).sort((p, q) => q.dws - p.dws), 4);
    const parecido = tomar(info.filter((x) => x.sim >= 0.45).sort((p, q) => q.sim - p.sim), 4);
    const linC = (x) => `<div class="c2-rw"><button type="button" class="c2-nm" data-ficha="${esc(x.k)}">${esc(nomeC(x.k))}</button><span class="c2-v">${pctPart(x.ws)}</span><span class="c2-v ${clsV(x.dws)}">${ppTxt(x.dws)}</span></div>`;
    const ICO_C = {
      direto: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
      parecido: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
      ganhando: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    };
    const colC = (tit, cor, crit, lst, vz, ico) => `<div class="c2-col"><p class="c2-ch"><span class="c2-ico" style="--c:${cor}" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_C[ico]}</svg></span>${tit}</p><p class="c2-crit">${crit}</p>
      ${lst.length ? `<div class="c2-rw c2-rh"><span></span><span class="c2-v">Share</span><span class="c2-v">Variação</span></div>${lst.map(linC).join("")}` : `<p class="c2-vz">${vz}</p>`}</div>`;
    const bQuem = `
      <section class="c2-sec" aria-labelledby="h-c2a">
        <h3 id="h-c2a" class="c2-tit">Quem são os concorrentes ${ajuda("ccTipos", "tipos de concorrente")}</h3>
        <p class="c2-sub">${umRamo ? `Market share em ${esc(linhasSel[0].nome)} e variação em 12 meses.` : "Share médio nos ramos da Akad, dando mais peso aos ramos que mais pesam na carteira dela, e variação em 12 meses."} Clique num nome para abrir a ficha do concorrente.</p>
        <div class="c2-g3">
          ${colC("Confronto direto", "var(--akad)", umRamo ? "As maiores do ramo junto com a Akad" : "Dividem o top 5 com a Akad em mais ramos", direto, "Nenhuma seguradora no top 5 junto com a Akad.", "direto")}
          ${colC("Perfil parecido", "var(--cc-link)", "Carteira com o mix de ramos mais parecido com o da Akad", parecido, "Nenhuma seguradora com carteira parecida.", "parecido")}
          ${colC("Ganhando espaço", "#C78800", umRamo ? "Mais ganharam market share no ramo" : "Mais ganharam share nos ramos da Akad", ganhando, "Nenhuma seguradora relevante ganhou espaço.", "ganhando")}
        </div>
      </section>`;

    // ----- quem ganhou e quem perdeu espaço
    const deltas = (x) => { const ks = new Set([...x.c.keys(), ...x.p.keys()]); return [...ks].map((k) => ({ k, d: shareDe(x.c, x.tc, k) - (x.tp > 0 ? shareDe(x.p, x.tp, k) : 0) })).filter((y) => Math.abs(y.d) >= 0.05); };
    const quemNm = (y) => `<button type="button" class="c2-nm c2-who" data-ficha="${esc(y.k)}">${esc(nomeC(y.k))}</button> <b class="${y.d > 0 ? "up" : "dn"}">${ppTxt(y.d)}</b>`;
    let corpoGP;
    if (umRamo) {
      const ds = deltas(atua[0]).filter((y) => y.k !== AKAD);
      const gan = ds.filter((y) => y.d > 0).sort((p, q) => q.d - p.d).slice(0, 5), per = ds.filter((y) => y.d < 0).sort((p, q) => p.d - q.d).slice(0, 5);
      const x = atua[0];
      corpoGP = `<p class="c2-akd">Akad: <b class="${clsV(x.d || 0)}">${x.d == null ? "sem prêmio nos 12 meses anteriores" : ppTxt(x.d)}</b> de market share</p>
        <div class="c2-g2"><div><p class="c2-lt">Mais ganharam</p>${gan.map((y) => `<div class="c2-pp">${quemNm(y)}</div>`).join("") || '<p class="c2-vz">Ninguém ganhou espaço.</p>'}</div>
        <div><p class="c2-lt">Mais perderam</p>${per.map((y) => `<div class="c2-pp">${quemNm(y)}</div>`).join("") || '<p class="c2-vz">Ninguém perdeu espaço.</p>'}</div></div>`;
    } else {
      const N_VIS = 10;
      const vis = S.ccTodos ? atua : atua.slice(0, N_VIS);
      const mxD = Math.max(0.5, ...atua.slice(0, N_VIS).map((x) => Math.abs(x.d || 0))) * 1.15;
      const pesoMx = atua[0].peso;
      const lin = (x) => {
        const ds = deltas(x).filter((y) => y.k !== AKAD && y.d > 0).sort((p, q) => q.d - p.d);
        const w = x.d == null ? 0 : Math.min(50, (Math.abs(x.d) / mxD) * 50);
        const fora = x.d != null && (Math.abs(x.d) / mxD) * 50 > 50;
        return `<div class="c2-dv" role="row">
          <span class="c2-rn" role="cell"><button type="button" class="c2-lk" data-abrir="${x.l.id}">${esc(x.l.nome)}</button></span>
          <span class="c2-pw" role="cell"><span class="c2-pb"><i style="width:${(x.peso / pesoMx) * 100}%"></i></span>${x.peso < 0.05 ? "&lt; 0,1%" : nf1.format(x.peso) + "%"}</span>
          <span class="c2-tr" role="cell" aria-hidden="true"><i class="c2-z"></i>${x.d != null && Math.abs(x.d) >= 0.05 ? `<i class="c2-bar ${x.d < 0 ? "neg" : "pos"}${fora ? " fora" : ""}" style="width:${w}%;${x.d < 0 ? "right" : "left"}:50%"></i>` : ""}</span>
          <span class="c2-dvv ${clsV(x.d || 0)}" role="cell">${x.d == null ? "novo" : ppTxt(x.d)}</span>
          <span class="c2-whoc" role="cell">${ds.length ? quemNm(ds[0]) : '<span class="c2-vz">–</span>'}</span>
        </div>`;
      };
      corpoGP = `<div class="c2-dvt" role="table" aria-label="Variação do market share da Akad por ramo">
        <div class="c2-dv c2-dvh" role="row"><span role="columnheader">Ramo</span><span role="columnheader" class="r">Peso na carteira ${ajuda("tPeso", "peso na carteira")}</span><span role="columnheader" class="c">perdeu ← Akad → ganhou</span><span role="columnheader" class="r">Akad</span><span role="columnheader">Quem mais ganhou</span></div>
        ${vis.map(lin).join("")}</div>
        ${atua.length > N_VIS ? `<button type="button" class="c2-mais" id="c2-mais" aria-expanded="${S.ccTodos ? "true" : "false"}">${S.ccTodos ? "Mostrar só os 10 maiores ↑" : `Ver todos os ${atua.length} ramos ↓`}</button>` : ""}`;
    }
    const bGP = `
      <section class="c2-sec" aria-labelledby="h-c2b">
        <h3 id="h-c2b" class="c2-tit">Quem ganhou e quem perdeu espaço ${ajuda("ccGanho", "ganhos e perdas")}</h3>
        <p class="c2-sub">${umRamo ? `Variação de market share em ${esc(linhasSel[0].nome)}, nos últimos 12 meses contra os 12 anteriores.` : "Variação do market share da Akad em cada ramo, do ramo que mais pesa na carteira para o que menos pesa."}</p>
        <div class="c2-card">${corpoGP}</div>
      </section>`;

    el.innerHTML = `
      <div class="cab-aba"><div><h2>Concorrentes</h2><p>Quem disputa mercado com a Akad e quem está ganhando espaço. Últimos 12 meses (${per12}) contra os 12 anteriores, ${nomeSelR}.</p></div></div>
      <div class="c2-kcs">${k1}${k2}${k3}${k4}</div>
      ${bQuem}${bGP}
      <div id="c2-ficha-host"></div>`;

    el.querySelectorAll("[data-tip]").forEach((g) => {
      g.addEventListener("mouseenter", (ev) => mostrarTip(g.dataset.tip, ev));
      g.addEventListener("mousemove", (ev) => mostrarTip(g.dataset.tip, ev));
      g.addEventListener("mouseleave", () => esconderTip());
    });
    el.querySelectorAll(".c2-lk").forEach((bt) => bt.addEventListener("click", () => abrirLinha(bt.dataset.abrir)));
    el.querySelectorAll("[data-ficha]").forEach((bt) => bt.addEventListener("click", () => abrirFicha(bt.dataset.ficha, bt)));
    if (S.ccAbrir) { const k = S.ccAbrir; S.ccAbrir = null; setTimeout(() => abrirFicha(k, null), 0); }
    el.querySelector("#c2-mais")?.addEventListener("click", () => { S.ccTodos = !S.ccTodos; renderConc(); el.querySelector("#c2-mais")?.focus(); });

    // ----- ficha do concorrente (abre ao clicar num nome)
    function abrirFicha(k, origem) {
      const host = el.querySelector("#c2-ficha-host");
      const rows = [];
      let G = [0, 0, 0, 0, 0], Gp = 0;
      IDX.linhas.forEach((l) => {
        const c = agg5(l.idx, a12, b), p = agg5(l.idx, a12 - 12, b - 12);
        const x = c.get(k), xp = gw(p, k);
        Gp += xp;
        if (!x || x[0] <= 0) return;
        for (let i = 0; i < 5; i++) G[i] += x[i];
        const tc = soma5(c), tp = soma5(p)[0];
        const rk = rkDe(c), rkp = rkDe(p);
        rows.push({ l, g: x[0], pos: rk.indexOf(k) + 1, posP: rkp.indexOf(k) + 1, sh: shareDe(c, tc[0], k), dsh: tp > 0 ? shareDe(c, tc[0], k) - shareDe(p, tp, k) : null, cr: cresc(x[0], xp),
          sin: x[1] > 0 ? (x[2] / x[1]) * 100 : null, com: x[1] > 0 ? (x[3] / x[1]) * 100 : null, msin: tc[1] > 0 ? (tc[2] / tc[1]) * 100 : null, akPos: rk.indexOf(AKAD) + 1 });
      });
      rows.sort((p, q) => q.g - p.g);
      const crG = cresc(G[0], Gp);
      const sinCel = (r) => {
        if (r.sin == null) return "–";
        const c = r.msin == null ? "" : r.sin > r.msin + 5 ? "dn" : r.sin < r.msin - 5 ? "up" : "";
        return `<span class="${c}">${nf0.format(r.sin)}%</span> <span class="c2-mm">${r.msin == null ? "" : nf0.format(r.msin) + "%"}</span>`;
      };
      host.innerHTML = `<div class="c2-dim" data-fechar></div>
        <aside class="c2-dr" role="dialog" aria-modal="true" aria-labelledby="c2-fn" tabindex="-1">
          <div class="c2-drh"><div><p class="c2-fk">Concorrente</p><h3 id="c2-fn" class="c2-fn">${esc(nomeC(k))}</h3><p class="c2-fs">${esc(nomeEnt(k))}</p></div><button type="button" class="c2-x" data-fechar aria-label="Fechar ficha">×</button></div>
          <div class="c2-fm">
            <div><span>GWP 12 meses</span><b>${reais(G[0])}</b></div>
            <div><span>Crescimento</span><b class="${crG == null ? "" : crG < 0 ? "dn" : "up"}">${crG == null ? "–" : crG > 999 ? "> +999%" : sgn(crG) + nf1.format(Math.abs(crG)) + "%"}</b></div>
            <div><span>Sinistralidade</span><b>${G[1] > 0 ? nf0.format((G[2] / G[1]) * 100) + "%" : "–"}</b></div>
            <div><span>Comercialização</span><b>${G[1] > 0 ? nf0.format((G[3] / G[1]) * 100) + "%" : "–"}</b></div>
          </div>
          <p class="c2-ft">Por ramo ${ajuda("ccFicha", "tabela da ficha")}</p>
          <div class="tab-wrap"><table class="c2-at"><thead><tr><th>Ramo</th><th class="n">GWP</th><th class="n">Posição</th><th class="n">Share</th><th class="n">Var. share</th><th class="n">Cresc.</th><th class="n">Sinistralidade <small>(mercado)</small></th><th class="n">Comerc.</th><th class="n">Akad</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="clic" data-abrir="${r.l.id}" tabindex="0"><td class="c2-atn">${esc(r.l.nome)}</td><td class="n">${reais(r.g)}</td><td class="n"><b>${r.pos}º</b> ${movHtml(r.pos, r.posP).replace(/ title="[^"]*"/, "")}</td><td class="n">${pctPart(r.sh)}</td>
            <td class="n ${r.dsh == null ? "" : clsV(r.dsh)}">${r.dsh == null ? "–" : ppTxt(r.dsh)}</td><td class="n ${r.cr == null ? "" : r.cr < 0 ? "dn" : "up"}">${r.cr == null ? "novo" : r.cr > 999 ? "> +999%" : sgn(r.cr) + nf0.format(Math.abs(r.cr)) + "%"}</td>
            <td class="n">${sinCel(r)}</td><td class="n">${r.com == null ? "–" : nf0.format(r.com) + "%"}</td><td class="n">${r.akPos ? r.akPos + "º" : "–"}</td></tr>`).join("")}</tbody></table></div>
          <p class="c2-fnota">Últimos 12 meses (${per12}) contra os 12 anteriores, em todos os ramos em que a seguradora vende. Sinistralidade em verde quando está 5 p.p. ou mais abaixo da do mercado no ramo, e em vermelho quando está 5 p.p. ou mais acima. Clique num ramo para abrir a visão do ramo.</p>
        </aside>`;
      document.body.classList.add("c2-trava");
      const dr = host.querySelector(".c2-dr");
      const fechar = () => { host.innerHTML = ""; document.body.classList.remove("c2-trava"); document.removeEventListener("keydown", tecla); origem?.focus(); };
      const tecla = (e) => { if (e.key === "Escape") fechar(); };
      document.addEventListener("keydown", tecla);
      host.querySelectorAll("[data-fechar]").forEach((x) => x.addEventListener("click", fechar));
      host.querySelectorAll("tr[data-abrir]").forEach((tr) => {
        const ir = () => { const id = tr.dataset.abrir; host.innerHTML = ""; document.body.classList.remove("c2-trava"); document.removeEventListener("keydown", tecla); abrirLinha(id); };
        tr.addEventListener("click", ir);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } });
      });
      dr.focus();
    }
  }

  /* ---------- Por estado ---------- */
  function rampa(t, base) {
    // t em [0,1] -> mistura da superfície até a cor base
    const sup = css("--surface-2");
    const h2r = (h) => { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
    const a = h2r(sup), b = h2r(base);
    const k = 0.12 + 0.88 * Math.max(0, Math.min(1, t));
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return { bg: `rgb(${c.join(",")})`, fg: lum > 0.55 ? "#212121" : "#FFFFFF" };
  }

  const UF_NOME = { AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins" };
  const nomeCurtoCia = (t) => t.replace(/\b(Companhia de Seguros Gerais|Companhia de Seguros|Cia de Seguros|Seguradora|Seguros Brasil|Seguros Gerais|Seguros Corporativos|Seguros)\b/gi, "").replace(/\s+/g, " ").trim() || t;

  function renderUF() {
    const P = periodo();
    const el = $("#aba-uf");
    const ramos = ramosDaSel(S.linha);
    const setR = new Set(ramos);
    const per = periodoLabel(P.a, P.b), perP = P.pa != null ? periodoLabel(P.pa, P.pb) : null;
    const emCur = (m) => m >= P.a && m <= P.b, emPrev = (m) => P.pa != null && m >= P.pa && m <= P.pb;

    // Por estado (prêmio direto): mercado e Akad, período atual e anterior
    const cur = D.ufs.map(() => [0, 0]), prev = D.ufs.map(() => [0, 0]);
    // Por estado e ramo da tela (linha): mercado e Akad no período atual
    const linhasSel = IDX.linhas.filter((l) => l.idx.some((ri) => setR.has(ri)));
    const ufLinha = D.ufs.map(() => new Map());
    for (const l of linhasSel) for (const ri of l.idx) {
      if (!setR.has(ri)) continue;
      for (const r of IDX.ufmPorRamo[ri]) {
        if (emCur(r[0])) {
          cur[r[2]][0] += r[3]; cur[r[2]][1] += r[4];
          const v = ufLinha[r[2]].get(l.id) || [0, 0]; v[0] += r[3]; v[1] += r[4]; ufLinha[r[2]].set(l.id, v);
        } else if (emPrev(r[0])) { prev[r[2]][0] += r[3]; prev[r[2]][1] += r[4]; }
      }
    }
    const totM = cur.reduce((s, x) => s + x[0], 0), totA = cur.reduce((s, x) => s + x[1], 0);
    const MED = totM > 0 ? (totA / totM) * 100 : null;

    // Ranking anual por estado (base anual da SUSEP, ano do fim do período)
    const ano = +D.meses[P.b].slice(0, 4);
    const ult = D.meses[D.meses.length - 1];
    const anoTxt = ano === +ult.slice(0, 4) && !ult.endsWith("12") ? `${ano} (jan–${MESES_PT[+ult.slice(4) - 1]})` : String(ano);
    const rkUF = D.ufs.map(() => new Map());
    const rkUFL = D.ufs.map(() => new Map()); // uf -> linha -> Map(ent -> v)
    const linhaDoRamo = new Map(); linhasSel.forEach((l) => l.idx.forEach((ri) => linhaDoRamo.set(ri, l.id)));
    for (const ri of ramos) for (const r of IDX.ufaPorRamo[ri]) {
      if (r[0] !== ano) continue;
      const e = IDX.chave[r[3]];
      rkUF[r[2]].set(e, (rkUF[r[2]].get(e) || 0) + r[4]);
      const lid = linhaDoRamo.get(ri); if (!lid) continue;
      let m = rkUFL[r[2]].get(lid); if (!m) { m = new Map(); rkUFL[r[2]].set(lid, m); }
      m.set(e, (m.get(e) || 0) + r[4]);
    }
    const ordena = (m) => [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    const UF = D.ufs.map((u, i) => {
      const [m, a] = cur[i], [mp, ap] = prev[i];
      const rk = ordena(rkUF[i]);
      const top = [...ufLinha[i].entries()].filter(([, v]) => v[1] > 0).sort((x, y) => y[1][1] - x[1][1])[0];
      return {
        i, u, nome: UF_NOME[u] || u, merc: m, akad: a, share: m > 0 ? (a / m) * 100 : null,
        cres: cresc(a, ap), pct: totA > 0 ? (a / totA) * 100 : null,
        vsMed: m > 0 && MED ? ((a / m) * 100) / MED : null,
        topRamo: top ? IDX.linhaPorId[top[0]].nome : null,
        lider: rk.length ? rk[0][0] : null, pos: rk.findIndex(([e]) => e === AKAD) + 1, nRk: rk.length,
      };
    });
    const sinal = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
    const cresTxt = (x) => (x == null ? "–" : x > 999 ? "> +999%" : `${sinal(x)}${nf1.format(Math.abs(x))}%`);
    const varCor = (x) => (x == null || !isFinite(x) ? '<span class="uf-var zero">–</span>' : `<span class="uf-var ${x >= 0.05 ? "bom" : x <= -0.05 ? "ruim" : "zero"}">${x > 0 ? "↑" : x < 0 ? "↓" : "="} ${cresTxt(x).replace(/^[+−]/, "")}</span>`);
    const xMed = (v) => (v == null ? "–" : `${nf1.format(v)}x`);
    const xCls = (v) => (v == null ? "" : v >= 1.2 ? "bom" : v < 0.9 ? "ruim" : "");
    const nomeLider = (e) => (e === AKAD ? '<b class="ak">Akad</b>' : e ? esc(nomeCurtoCia(nomeEnt(e))) : "–");

    const sel = S.uf === "todos" || S.uf == null ? null : +S.uf;
    const notaBase = `<button type="button" class="ajuda" data-ajuda="ufBase" aria-label="Sobre os dados por estado">?</button>`;
    const subtitulo = `Veja onde a Akad vende, onde é mais forte e onde há espaço para crescer. ${notaBase}`;

    if (!(totM > 0)) {
      el.innerHTML = `<div class="cab-aba"><div><h2>Desempenho por estado</h2><p>${subtitulo}</p></div></div><div class="card vazio-bloco"><h2>Sem dados para este período</h2></div>`;
      return;
    }

    if (sel == null) {
      // ---------- Visão do Brasil ----------
      const comAkad = UF.filter((x) => x.akad > 0).sort((a, b) => b.akad - a.akad);
      const top3 = comAkad.slice(0, 3);
      const cresceram = UF.filter((x) => x.cres != null && x.cres > 0).sort((a, b) => b.cres - a.cres);
      const relevantes = UF.filter((x) => x.akad > 0 && x.merc >= totM * 0.005);
      const melhor = [...relevantes].sort((a, b) => b.share - a.share)[0];
      const forte = relevantes.filter((x) => x.vsMed >= 1.2).sort((a, b) => b.vsMed - a.vsMed).slice(0, 5);
      const potencial = (x) => (x.merc * (MED - x.share)) / 100;
      const espaco = UF.filter((x) => x.share != null && x.share < MED && x.merc >= totM * 0.02).sort((a, b) => potencial(b) - potencial(a)).slice(0, 4);

      const met = "share";
      const valMet = (x) => (met === "share" ? x.share : met === "akad" ? x.akad : x.cres);
      const vals = UF.map(valMet).filter((v) => v != null && isFinite(v));
      const maxV = Math.max(0.0001, ...vals.map((v) => Math.abs(Math.min(v, met === "cres" ? 200 : Infinity))));
      const corMet = (x) => {
        const v = valMet(x);
        if (v == null || !isFinite(v)) return { bg: "var(--grid)", fg: "var(--muted)" };
        if (met === "cres") return rampa(Math.min(Math.abs(v), 200) / maxV, v >= 0 ? "#319C00" : "#E01B1B");
        return rampa(v / maxV, met === "share" ? css("--akad") : css("--mercado"));
      };
      const rotMet = (x) => (met === "share" ? pct(x.share) : met === "akad" ? (x.akad > 0 ? reaisCurto(x.akad) : "–") : cresTxt(x.cres));
      const ufBtn = (x, extra) => `<button type="button" class="uf-li" data-uf="${x.i}"><span class="uf-sig">${x.u}</span><span class="uf-li-n">${esc(x.nome)}<small>market share ${pct(x.share, 2)} · mercado de ${reais(x.merc)}</small></span>${extra}</button>`;
      const verTodos = !!S.ufTodos;
      const tabela = [...UF].sort((a, b) => b.akad - a.akad || b.merc - a.merc);

      el.innerHTML = `
        <div class="cab-aba"><div><h2>Desempenho por estado</h2><p>${subtitulo}</p></div></div>
        <div class="uf-kpis">
          <section class="card uf-k"><h2 class="uf-kt">Concentração <button type="button" class="ajuda" data-ajuda="ufConc" data-lista="${esc(comAkad.slice(0, 5).map((x) => `${x.nome}: ${pct(x.pct)} das vendas da Akad`).join("|"))}" aria-label="O que é concentração?">?</button></h2>
            <div class="uf-kl"><span class="uf-kv">${pct(top3[0]?.pct)}</span><span class="uf-ks">em ${top3[0]?.u || "–"}</span></div>
            <p class="uf-ka">${top3.map((x) => x.u).join(", ")} somam ${pct(top3.reduce((s, x) => s + x.pct, 0))} das vendas da Akad</p></section>
          <section class="card uf-k"><h2 class="uf-kt">Estados em crescimento <button type="button" class="ajuda" data-ajuda="ufCresc" data-lista="${esc(cresceram.length ? cresceram.map((x) => `${x.nome}: ${cresTxt(x.cres)}`).join("|") : "Nenhum estado")}" aria-label="Quais estados cresceram?">?</button></h2>
            <div class="uf-kl"><span class="uf-kv">${cresceram.length}</span><span class="uf-ks">de ${UF.length}</span></div>
            <p class="uf-ka">Estados com vendas da Akad maiores que em ${perP || "o período anterior"}</p></section>
          <section class="card uf-k"><h2 class="uf-kt">Maior market share <button type="button" class="ajuda" data-ajuda="ufMelhor" aria-label="O que é maior market share?">?</button></h2>
            <div class="uf-kl"><span class="uf-kv">${melhor ? pct(melhor.share, 2) : "–"}</span><span class="uf-ks">${melhor ? `no ${melhor.u}` : ""}</span></div>
            <p class="uf-ka">Média da Akad no país: ${pct(MED, 2)}</p></section>
        </div>
        <div class="uf-meio">
          <section class="card uf-c">
            <div class="uf-cab"><h2 class="uf-tit">Market share da Akad por estado ${ajuda("ufShareMapa", "market share por estado")}</h2></div>
            <p class="uf-nota uf-conta">Prêmio direto da Akad no estado ÷ prêmio direto de todas as seguradoras no estado, nos ramos e no período do filtro. Média da Akad no país: ${pct(MED, 2)}.</p>
            <div class="mapa" id="mapa"></div>
            <p class="uf-nota">Clique num estado para ver o que mais se vende nele.</p>
          </section>
          <section class="card uf-c">
            <div class="uf-cab"><h2 class="uf-tit">Onde a Akad está</h2><span class="uf-nota">comparado à média da Akad no país (${pct(MED, 2)})</span></div>
            <h3 class="uf-h3"><i class="bom">↑</i>Mais forte que a média</h3>
            ${forte.length ? forte.map((x) => ufBtn(x, `<b class="uf-x bom">${xMed(x.vsMed)} a média</b>`)).join("") : '<p class="uf-nota">Nenhum estado relevante acima de 1,2x a média.</p>'}
            <h3 class="uf-h3" style="margin-top:18px"><i class="op">◎</i>Mercados grandes abaixo da média</h3>
            ${espaco.length ? espaco.map((x) => ufBtn(x, `<b class="uf-x op" title="Quanto a Akad venderia a mais no estado com a mesma participação que tem no país">+${reais(potencial(x))}</b>`)).join("") : '<p class="uf-nota">Nenhum mercado grande abaixo da média.</p>'}
            <p class="uf-nota" style="margin-top:12px">Valor em magenta: quanto a Akad venderia a mais no estado se tivesse ali a mesma participação que tem na média do país.</p>
          </section>
        </div>
        <section class="card uf-c">
          <div class="uf-cab"><h2 class="uf-tit">Todos os estados</h2><span class="uf-nota">ordenado por vendas da Akad · quem lidera com base em ${anoTxt}</span></div>
          <div class="tab-wrap"><table class="uf-tab">
            <thead><tr><th>Estado</th><th class="n">Vendas Akad</th><th class="n">Variação</th><th class="n">% das vendas Akad</th><th class="n">Market share</th><th class="n">vs. média ${ajuda("ufVs", "vs. média")}</th><th>Principal ramo da Akad</th><th>Quem lidera no estado</th></tr></thead>
            <tbody>${tabela.slice(0, verTodos ? 99 : 10).map((x) => `
              <tr class="clic" data-uf="${x.i}"><td><b>${x.u}</b> <span class="sub-i">${esc(x.nome)}</span></td>
              <td class="n">${x.akad > 0 ? reais(x.akad) : '<span class="sub-i">sem vendas</span>'}</td><td class="n">${varCor(x.cres)}</td>
              <td class="n">${x.akad > 0 ? pct(x.pct) : "–"}</td><td class="n"><b>${x.akad > 0 ? pct(x.share, 2) : "–"}</b></td>
              <td class="n"><span class="uf-x ${xCls(x.vsMed)}">${x.akad > 0 ? xMed(x.vsMed) : "–"}</span></td>
              <td>${x.topRamo ? esc(x.topRamo) : "–"}</td><td>${nomeLider(x.lider)}</td></tr>`).join("")}</tbody>
          </table></div>
          ${tabela.length > 10 ? `<button type="button" class="uf-mais" id="uf-mais">${verTodos ? "Mostrar só os 10 maiores" : `Ver todos os ${tabela.length} estados`}</button>` : ""}
        </section>`;

      const mapa = $("#mapa");
      const maxEsc = met === "share" ? pct(maxV) : met === "akad" ? reaisCurto(maxV) : "";
      mapa.innerHTML = MOSAICO.map(([u, r, c]) => {
        const x = UF.find((y) => y.u === u);
        const { bg, fg } = corMet(x);
        return `<button type="button" class="uf" style="grid-row:${r + 1};grid-column:${c + 1};background:${bg};color:${fg}" data-uf="${x.i}" aria-label="${esc(x.nome)}: market share ${pct(x.share)}, vendas da Akad ${reais(x.akad)}">${u}<small>${rotMet(x)}</small></button>`;
      }).join("");
      mapa.insertAdjacentHTML("afterend", met === "cres" ? '<div class="escala"><span class="uf-var ruim">caiu</span><span class="grad" style="background:linear-gradient(90deg,#E01B1B,#F5F5F5,#319C00)"></span><span class="uf-var bom">cresceu</span></div>'
        : `<div class="escala"><span>${met === "share" ? "0%" : "menor"}</span><span class="grad" style="background:linear-gradient(90deg, ${rampa(0, met === "share" ? css("--akad") : css("--mercado")).bg}, ${rampa(1, met === "share" ? css("--akad") : css("--mercado")).bg})"></span><span>${maxEsc}</span></div>`);
      mapa.querySelectorAll(".uf").forEach((b) => {
        b.addEventListener("mousemove", (ev) => {
          const x = UF[+b.dataset.uf];
          mostrarTip(`<b>${esc(x.nome)}</b><div>Vendas da Akad: ${reais(x.akad)} (${cresTxt(x.cres)})</div><div>Market share: ${pct(x.share, 2)}</div><div>Mercado: ${reais(x.merc)}</div>`, ev);
        });
        b.addEventListener("mouseleave", esconderTip);
      });
      el.querySelectorAll("[data-uf]").forEach((b) => b.addEventListener("click", () => { esconderTip(); S.uf = String(b.dataset.uf); render(); window.scrollTo({ top: 0 }); }));
      $("#uf-mais")?.addEventListener("click", () => { S.ufTodos = !S.ufTodos; renderUF(); });
      return;
    }

    // ---------- Um estado ----------
    const x = UF[sel];
    const ordR = S.ufOrdR === "akad" ? "akad" : "merc";
    const totUF = x.merc;
    const linhas = linhasSel.map((l) => {
      const v = ufLinha[sel].get(l.id) || [0, 0];
      const rk = ordena(rkUFL[sel].get(l.id) || new Map());
      return { l, merc: v[0], akad: v[1], share: v[0] > 0 ? (v[1] / v[0]) * 100 : null, pEst: totUF > 0 ? (v[0] / totUF) * 100 : null,
        pos: rk.findIndex(([e]) => e === AKAD) + 1, lider: rk.length ? rk[0][0] : null };
    }).filter((y) => y.merc > 0 || y.akad > 0)
      .sort((a, b) => (ordR === "akad" ? b.akad - a.akad || b.merc - a.merc : b.merc - a.merc));
    const maxM = Math.max(1, ...linhas.map((y) => y.merc));
    el.innerHTML = `
      <div class="cab-aba"><div><a href="#uf" class="uf-volta" id="uf-volta"><span aria-hidden="true">←</span> Todos os estados</a><h2>${esc(x.nome)}</h2><p>O que mais se vende no estado, entre os ramos em que a Akad atua, e a posição da Akad em cada um. ${notaBase}</p></div></div>
      <div class="uf-kpis">
        <section class="card uf-k"><h2 class="uf-kt">Vendas da Akad em ${x.u}</h2>
          <div class="uf-kl"><span class="uf-kv">${reais(x.akad)}</span>${varCor(x.cres)}</div>
          <p class="uf-ka">${pct(x.pct)} das vendas da Akad no país</p></section>
        <section class="card uf-k"><h2 class="uf-kt">Market share em ${x.u}</h2>
          <div class="uf-kl"><span class="uf-kv">${pct(x.share, 2)}</span><span class="uf-x ${xCls(x.vsMed)}">${xMed(x.vsMed)} a média</span></div>
          <p class="uf-ka">Média da Akad no país: ${pct(MED, 2)}</p></section>
        <section class="card uf-k"><h2 class="uf-kt">Posição no estado <button type="button" class="ajuda" data-ajuda="ufPos" aria-label="Como é calculada a posição?">?</button></h2>
          <div class="uf-kl"><span class="uf-kv">${x.pos ? `${x.pos}º` : "–"}</span><span class="uf-ks">${x.nRk ? `de ${x.nRk}` : ""}</span></div>
          <p class="uf-ka">Quem lidera: ${nomeLider(x.lider)} · base ${anoTxt}</p></section>
      </div>
      <section class="card uf-c">
        <div class="uf-cab"><h2 class="uf-tit">O que mais se vende em ${x.u}</h2>
          <div class="seg-ctrl uf-ord" role="group" aria-label="Ordenar ramos"><button type="button" data-o="merc" aria-pressed="${ordR === "merc"}">Maior mercado</button><button type="button" data-o="akad" aria-pressed="${ordR === "akad"}">Maiores vendas da Akad</button></div></div>
        <div class="tab-wrap"><table class="uf-tab">
          <thead><tr><th>Ramo</th><th>Tamanho do mercado</th><th class="n">Mercado</th><th class="n">% do estado</th><th class="n">Vendas Akad</th><th class="n">Share Akad</th><th class="n">Posição Akad</th><th>Quem lidera</th></tr></thead>
          <tbody>${linhas.map((y) => `
            <tr class="clic${y.lider === AKAD ? " lid" : ""}" data-abrir="${y.l.id}"><td><b>${esc(y.l.nome)}</b> <span class="sub-i">${y.l.ramos.join(", ")}</span></td>
            <td class="uf-bar-td"><span class="uf-bar"><i style="width:${(y.merc / maxM) * 100}%"></i></span></td>
            <td class="n">${reais(y.merc)}</td><td class="n">${pctPart(y.pEst)}</td>
            <td class="n">${y.akad > 0 ? reais(y.akad) : '<span class="sub-i">não vende</span>'}</td>
            <td class="n"><b>${y.akad > 0 ? pctPart(y.share) : "–"}</b></td>
            <td class="n">${y.pos ? `${y.pos}º` : "–"}</td><td>${nomeLider(y.lider)}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="uf-nota">Posição e quem lidera com base em ${anoTxt}. Clique num ramo para ver o detalhe nacional.</p>
      </section>`;
    $("#uf-volta").addEventListener("click", (e) => { e.preventDefault(); S.uf = "todos"; render(); });
    el.querySelectorAll(".uf-ord button").forEach((b) => b.addEventListener("click", () => { S.ufOrdR = b.dataset.o; renderUF(); }));
    el.querySelectorAll("tr[data-abrir]").forEach((tr) => tr.addEventListener("click", () => abrirDe("linhas", () => { S.linha = tr.dataset.abrir; })));
  }

  /* ---------- Navegação e filtros ---------- */
  const ABAS = ["geral", "linhas", "conc", "uf"];
  // Quais filtros cada página usa (o período vale para todas)
  const FILTROS_ABA = { geral: [], linhas: ["linha"], conc: ["linha"], uf: ["linha", "uf"] };

  function irPara(aba, manterVoltar) {
    if (!manterVoltar) S.pilha = [];
    S.aba = aba;
    document.body.dataset.aba = aba;
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.aba === aba) { a.setAttribute("aria-current", "page"); const n = a.parentElement; if (n.scrollWidth > n.clientWidth) n.scrollLeft = a.offsetLeft - (n.clientWidth - a.offsetWidth) / 2; } else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".aba").forEach((s) => { s.hidden = s.id !== "aba-" + aba; });
    if (location.hash.slice(1) !== aba) { try { history.replaceState(null, "", "#" + aba); } catch (e) { /* ignora */ } }
    render();
    window.scrollTo({ top: 0 });
  }
  function render() {
    esconderTip();
    atualizarFiltros();
    const vt = $("#voltar");
    const topo = S.pilha[S.pilha.length - 1];
    vt.hidden = !(topo && (topo.aba !== S.aba || topo.linha !== S.linha));
    if (!vt.hidden) vt.innerHTML = `<span aria-hidden="true">←</span> Voltar para ${esc(topo.rotulo)}`;
    ({ geral: renderGeral, linhas: renderLinhas, conc: renderConc, uf: renderUF })[S.aba]();
  }

  // Busca sem diferenciar acento e maiúscula
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  /** Campo de seleção com busca (combobox acessível). */
  function combo(host, cfg) {
    const id = cfg.id;
    const atual = () => cfg.opcoes.find((o) => o.v === cfg.valor());
    host.innerHTML = `
      <div class="cb">
        <input id="${id}" class="cb-in" type="text" role="combobox" autocomplete="off" spellcheck="false"
          aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-lista" placeholder="${esc(cfg.placeholder || "Buscar")}">
        <span class="cb-seta" aria-hidden="true"></span>
        <ul id="${id}-lista" class="cb-lista" role="listbox" hidden></ul>
      </div>`;
    const inp = host.querySelector("input"), lista = host.querySelector("ul");
    let filtradas = [], ativo = -1, aberto = false;
    const mostrarValor = () => { const o = atual(); inp.value = o ? o.t : ""; };
    const desenhar = () => {
      lista.innerHTML = filtradas.length
        ? filtradas.map((o, i) => `<li id="${id}-op-${i}" role="option" class="cb-op${o.ind ? " ind" : ""}${o.v === cfg.valor() ? " sel" : ""}${i === ativo ? " ativo" : ""}" aria-selected="${o.v === cfg.valor()}" data-i="${i}"><span>${esc(o.t)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</li>`).join("")
        : '<li class="cb-vazio" role="presentation">Nada encontrado</li>';
      inp.setAttribute("aria-activedescendant", ativo >= 0 ? `${id}-op-${ativo}` : "");
      const el = lista.querySelector(".ativo");
      if (el) el.scrollIntoView({ block: "nearest" });
    };
    const filtrar = (q) => {
      const n = norm(q.trim());
      filtradas = n ? cfg.opcoes.filter((o) => norm(o.t + " " + (o.sub || "")).includes(n)) : cfg.opcoes.slice();
      ativo = filtradas.findIndex((o) => o.v === cfg.valor());
      if (ativo < 0 && filtradas.length) ativo = 0;
      desenhar();
    };
    const abrir = () => { if (aberto) return; aberto = true; lista.hidden = false; inp.setAttribute("aria-expanded", "true"); host.querySelector(".cb").classList.add("aberto"); filtrar(""); inp.select(); };
    const fechar = () => { aberto = false; lista.hidden = true; inp.setAttribute("aria-expanded", "false"); host.querySelector(".cb").classList.remove("aberto"); mostrarValor(); };
    const escolher = (o) => { if (!o) return; const mudou = o.v !== cfg.valor(); fechar(); inp.value = o.t; if (mudou) cfg.aoEscolher(o.v); };
    inp.addEventListener("focus", abrir);
    inp.addEventListener("click", abrir);
    inp.addEventListener("input", () => { if (!aberto) abrir(); filtrar(inp.value); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!aberto) abrir(); ativo = Math.min(filtradas.length - 1, ativo + 1); desenhar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); ativo = Math.max(0, ativo - 1); desenhar(); }
      else if (e.key === "Enter") { e.preventDefault(); if (aberto) escolher(filtradas[ativo]); else abrir(); }
      else if (e.key === "Escape") { e.preventDefault(); fechar(); inp.blur(); }
      else if (e.key === "Tab") { fechar(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) fechar(); }, 120));
    lista.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const li = e.target.closest("[data-i]");
      if (li) escolher(filtradas[+li.dataset.i]);
    });
    mostrarValor();
  }

  /** Seleção múltipla com busca: chips + lista com caixas de marcar. */
  function comboMulti(host, cfg) {
    const id = cfg.id;
    const nome = (v) => (cfg.opcoes.find((o) => o.v === v) || { t: v }).t;
    const curto = (t) => t.replace(/\b(Companhia de Seguros Gerais|Companhia de Seguros|Cia de Seguros|Seguradora|Seguros Brasil|Seguros Gerais|Seguros)\b/gi, "").replace(/\s+/g, " ").trim() || t;
    host.innerHTML = `
      <div class="cbm">
        <div class="cbm-chips"></div>
        <div class="cb">
          <input id="${id}" class="cb-in" type="text" role="combobox" autocomplete="off" spellcheck="false"
            aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-lista" aria-describedby="${id}-lim">
          <span class="cb-seta" aria-hidden="true"></span>
          <ul id="${id}-lista" class="cb-lista" role="listbox" aria-multiselectable="true" hidden></ul>
        </div>
        <span id="${id}-lim" class="sr"></span>
      </div>`;
    const inp = host.querySelector("input"), lista = host.querySelector("ul"), chips = host.querySelector(".cbm-chips"), lim = host.querySelector(`#${id}-lim`);
    let filtradas = [], ativo = -1, aberto = false;
    const vals = () => cfg.valores() || [];
    const cheio = () => vals().length >= cfg.max;
    const desenharChips = () => {
      chips.innerHTML = vals().map((v, i) => `<span class="cbm-chip"><i class="bol" style="background:${corEnt(i + 1)}" aria-hidden="true"></i><span title="${esc(nome(v))}">${esc(curto(nome(v)))}</span><button type="button" data-rm="${esc(v)}" aria-label="Remover ${esc(nome(v))}">×</button></span>`).join("");
      inp.placeholder = cheio() ? `Limite de ${cfg.max}: remova uma para trocar` : (cfg.placeholder || "Buscar");
      lim.textContent = `${vals().length} de ${cfg.max} selecionadas.`;
    };
    const desenhar = () => {
      const on = new Set(vals());
      lista.innerHTML = filtradas.length
        ? filtradas.map((o, i) => { const sel = on.has(o.v), bloq = !sel && cheio();
            return `<li id="${id}-op-${i}" role="option" class="cb-op cbm-op${sel ? " sel" : ""}${bloq ? " bloq" : ""}${i === ativo ? " ativo" : ""}" aria-selected="${sel}" aria-disabled="${bloq}" data-i="${i}"><span><i class="cx" aria-hidden="true"></i>${esc(o.t)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</li>`; }).join("")
        : '<li class="cb-vazio" role="presentation">Nada encontrado</li>';
      inp.setAttribute("aria-activedescendant", ativo >= 0 ? `${id}-op-${ativo}` : "");
      lista.querySelector(".ativo")?.scrollIntoView({ block: "nearest" });
    };
    const filtrar = (q) => {
      const n = norm(q.trim());
      filtradas = n ? cfg.opcoes.filter((o) => norm(o.t + " " + (o.sub || "")).includes(n)) : cfg.opcoes.slice();
      ativo = filtradas.length ? 0 : -1;
      desenhar();
    };
    const abrir = () => { if (aberto) return; aberto = true; lista.hidden = false; inp.setAttribute("aria-expanded", "true"); host.querySelector(".cb").classList.add("aberto"); filtrar(""); };
    const fechar = () => { aberto = false; lista.hidden = true; inp.setAttribute("aria-expanded", "false"); host.querySelector(".cb").classList.remove("aberto"); inp.value = ""; };
    let pendente = false;
    const aplicar = (v) => { pendente = true; cfg.aoMudar(v); desenharChips(); };
    const alternar = (o) => {
      if (!o) return;
      const atual = vals();
      if (atual.includes(o.v)) aplicar(atual.filter((x) => x !== o.v));
      else if (!cheio()) aplicar([...atual, o.v]);
      desenhar();
    };
    inp.addEventListener("focus", abrir);
    inp.addEventListener("click", abrir);
    inp.addEventListener("input", () => { if (!aberto) abrir(); filtrar(inp.value); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!aberto) abrir(); ativo = Math.min(filtradas.length - 1, ativo + 1); desenhar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); ativo = Math.max(0, ativo - 1); desenhar(); }
      else if (e.key === "Enter") { e.preventDefault(); if (aberto) alternar(filtradas[ativo]); else abrir(); }
      else if (e.key === "Escape") { e.preventDefault(); fechar(); inp.blur(); }
      else if (e.key === "Backspace" && !inp.value && vals().length) { aplicar(vals().slice(0, -1)); if (aberto) desenhar(); }
      else if (e.key === "Tab") { fechar(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) { fechar(); if (pendente) { pendente = false; render(); } } }, 120));
    lista.addEventListener("mousedown", (e) => { e.preventDefault(); const li = e.target.closest("[data-i]"); if (li) alternar(filtradas[+li.dataset.i]); });
    chips.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { aplicar(vals().filter((x) => x !== b.dataset.rm)); document.getElementById(id)?.focus(); } });
    desenharChips();
  }

  // Grupos de ramos (atalhos no filtro)
  const GRUPOS_RAMOS = [
    { id: "transportador", nome: "Transportador", ids: ["rctrc", "rcdc"] },
  ];
  // Seleção de ramos: "todas", um id de ramo, ou "m:id1,id2,..." para vários
  function idsDaSel(sel) {
    if (!sel || sel === "todas") return [];
    if (sel.startsWith("m:")) return sel.slice(2).split(",").filter((x) => IDX.linhaPorId[x]);
    return [sel];
  }
  function selDeIds(ids) {
    const ord = IDX.linhas.map((l) => l.id).filter((x) => ids.includes(x));
    if (!ord.length || ord.length === IDX.linhas.length) return "todas";
    return ord.length === 1 ? ord[0] : "m:" + ord.join(",");
  }
  const grupoDaSel = (sel) => { const ids = idsDaSel(sel); return GRUPOS_RAMOS.find((g) => g.ids.length === ids.length && g.ids.every((x) => ids.includes(x))); };

  function opcoesLinhaFiltro() {
    const op = [{ v: "todas", t: `Todos os ${IDX.linhas.length} ramos`, sub: "soma de todos" }];
    // grupos: aparecem logo abaixo de "Todos"; os ramos do grupo continuam disponíveis sozinhos na lista
    for (const g of GRUPOS_RAMOS) op.push({ v: selDeIds(g.ids), t: g.nome, sub: g.ids.map((x) => IDX.linhaPorId[x].nome).join(" + ") });
    for (const l of IDX.linhas) {
      op.push({ v: l.id, t: l.nome, sub: (l.ramos.length > 1 ? "códigos " : "código ") + l.ramos.join(", ") });
      if (l.ramos.length > 1) for (const c of l.ramos) op.push({ v: "r:" + c, t: D.ramos[IDX.ramoIdx[c]][1], sub: "código " + c, ind: true });
    }
    return op;
  }

  function atualizarFiltros() {
    const usa = FILTROS_ABA[S.aba] || [];
    $("#fg-linha").hidden = !usa.includes("linha");
    $("#fg-conc").hidden = !usa.includes("conc");
    $("#fg-uf").hidden = !usa.includes("uf");
    if (usa.includes("uf") && document.activeElement?.id !== "cb-uf-in") {
      const ops = [{ v: "todos", t: "Todos os estados" }, ...D.ufs.map((u, i) => ({ v: String(i), t: UF_NOME[u] || u, sub: u })).sort((a, b) => a.t.localeCompare(b.t, "pt-BR"))];
      combo($("#cb-uf"), { id: "cb-uf-in", opcoes: ops, valor: () => String(S.uf), placeholder: "Buscar estado", aoEscolher: (v) => { S.uf = v; render(); } });
    }
    $("#fg-nota").hidden = true; // o contexto da Visão geral fica no cabeçalho da página
    // Período
    const P = periodo();
    $("#pp-main").textContent = periodoLabel(P.a, P.b);
    $("#pp-sub").textContent = P.pa != null ? `vs. ${periodoLabel(P.pa, P.pb)}` : "sem comparativo";
    document.querySelectorAll("#pop-periodo [data-p]").forEach((b) => {
      const on = b.dataset.p === S.periodo && (S.periodo !== "ano" || b.dataset.ano === String(S.ano));
      b.setAttribute("aria-pressed", String(on));
    });
    // Linha ou ramo
    if (usa.includes("linha") && document.activeElement?.id !== "cb-linha-in") {
      combo($("#cb-linha"), { id: "cb-linha-in", opcoes: opcoesLinhaFiltro(), valor: () => S.linha, placeholder: "Buscar ramo ou código SUSEP", aoEscolher: (v) => { S.linha = v; render(); } });
    }
    // Concorrentes (lista ordenada pelo prêmio nos ramos acompanhados, no período)
    if (usa.includes("conc") && document.activeElement?.id !== "cb-conc-in") {
      const RT = resumo(IDX.todos, P);
      const ents = RT.rk.filter((k) => k !== AKAD);
      if (!S.concSels) S.concSels = concorrentesPadrao(P, 3);
      const opcoes = ents.map((k) => ({ v: k, t: nomeEnt(k), sub: `${RT.rk.indexOf(k) + 1}º · ${reais(RT.cur.get(k)[0])}` }));
      for (const k of S.concSels) if (!ents.includes(k)) opcoes.unshift({ v: k, t: nomeEnt(k), sub: "sem prêmio no período" });
      comboMulti($("#cb-conc"), { id: "cb-conc-in", opcoes, max: MAX_CONC, valores: () => S.concSels, placeholder: "Adicionar seguradora", aoMudar: (v) => { S.concSels = v; render(); } });
    }
  }

  // Selo no topo: até que mês vão os dados, quando consultamos a SUSEP e quando é a próxima consulta
  function ultimaVerificacao() {
    const d = proximaVerificacao();
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  function desenharStatus(ultima, falhou) {
    const ult = D.meses.length - 1;
    const dm = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const hm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const mudou = new Date(D.gerado);
    const lista = [
      ultima ? `Última consulta à SUSEP: ${dm(ultima)} às ${hm(ultima)}${falhou ? " (com erro)" : ""}.` : null,
      `Os números mudaram pela última vez em ${dm(mudou)}.`,
    ].filter(Boolean).join("|");
    const quando = ultima || mudou;
    $("#status").innerHTML = `
      <span class="st-item st-dado"><i class="st-dot${falhou ? " alerta" : ""}" aria-hidden="true"></i>Dados até <b>${mesLabel(ult, true)}</b></span>
      <span class="st-sep" aria-hidden="true">·</span>
      <span class="st-item">${falhou ? "Erro na atualização de" : "Atualizado em"} <b>${dm(quando)}</b></span>
      <button type="button" class="ajuda st-ajuda" data-ajuda="status" data-lista="${esc(lista)}" aria-label="Como funciona a atualização?">?</button>`;
  }
  function montarStatus() {
    ligarAjuda();
    desenharStatus(null, false);
    // Consulta real: última execução do robô no GitHub (se a API responder)
    fetch("https://api.github.com/repos/anapaula-pixel/dashboard-mercado-susep/actions/workflows/atualizar-dados.yml/runs?per_page=1&status=completed", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const run = j && j.workflow_runs && j.workflow_runs[0];
        if (!run) return;
        desenharStatus(new Date(run.updated_at), run.conclusion !== "success");
      })
      .catch(() => {});
  }

  function montarFiltros() {
    const anos = [...new Set(D.meses.map((m) => m.slice(0, 4)))];
    const ult = D.meses.length - 1;
    const anoUlt = D.meses[ult].slice(0, 4);
    const fechados = anos.filter((y) => D.meses.includes(y + "12"));
    S.ano = fechados[fechados.length - 1] || anoUlt;
    S.ate = ult; S.de = Math.max(0, ult - 11);
    const mesUlt = MESES_PT[+D.meses[ult].slice(4) - 1];
    const optsMes = D.meses.map((m, i) => `<option value="${i}">${mesLabel(i, true)}</option>`).reverse().join("");

    $("#pop-periodo").innerHTML = `
      <div class="pp-sec">
        <h3>Atalhos</h3>
        <div class="pp-chips">
          <button type="button" data-p="ytd"><b>Acumulado de ${anoUlt}</b><small>jan a ${mesUlt}</small></button>
          <button type="button" data-p="12m"><b>Últimos 12 meses</b><small>${mesLabel(Math.max(0, ult - 11))} a ${mesLabel(ult)}</small></button>
        </div>
      </div>
      <div class="pp-sec">
        <h3>Ano completo</h3>
        <div class="pp-anos">${fechados.slice().reverse().map((y) => `<button type="button" data-p="ano" data-ano="${y}">${y}</button>`).join("")}</div>
      </div>
      <div class="pp-sec">
        <h3>Personalizado</h3>
        <div class="pp-custom">
          <label>De <select id="pp-de">${optsMes}</select></label>
          <label>Até <select id="pp-ate">${optsMes}</select></label>
          <button type="button" class="pp-aplicar" id="pp-aplicar">Aplicar</button>
        </div>
      </div>
      <p class="pp-nota">A comparação é sempre com o mesmo período do ano anterior.</p>`;
    $("#pp-de").value = S.de; $("#pp-ate").value = S.ate;

    const btn = $("#pp-btn"), pop = $("#pop-periodo");
    const abrir = () => { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); (pop.querySelector('[aria-pressed="true"]') || pop.querySelector("button")).focus(); };
    const fechar = (foco) => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); if (foco) btn.focus(); };
    btn.addEventListener("click", () => (pop.hidden ? abrir() : fechar(false)));
    document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest("#pop-periodo") && !e.target.closest("#pp-btn")) fechar(false); });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); fechar(true); } });
    pop.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
      S.periodo = b.dataset.p;
      if (b.dataset.ano) S.ano = b.dataset.ano;
      fechar(true); render();
    }));
    $("#pp-aplicar").addEventListener("click", () => {
      S.periodo = "custom"; S.de = +$("#pp-de").value; S.ate = +$("#pp-ate").value;
      fechar(true); render();
    });

    document.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      // o filtro de ramo é compartilhado entre as páginas: ao trocar pelo menu, mantém o ramo escolhido
      irPara(a.dataset.aba);
    }));
    // Voltar do navegador: desfaz o último "abrir detalhe"; senão, segue o endereço
    window.addEventListener("popstate", () => {
      const h = location.hash.slice(1);
      const topo = S.pilha[S.pilha.length - 1];
      if (topo && topo.aba === h) voltar();
      else if (ABAS.includes(h) && h !== S.aba) irPara(h);
    });
    $("#voltar").addEventListener("click", (e) => { e.preventDefault(); voltar(); });

    const gerado = new Date(D.gerado);
    montarStatus();
    $(".rodape").innerHTML = `
      <div class="rod-in">
        <div class="rod-marca">
          <b>Inteligência de Mercado SUSEP</b>
          <span>Painel da Akad Seguros com dados públicos do mercado de seguros.</span>
        </div>
        <div class="rod-col">
          <h2>Como funciona</h2>
          <ul>
            <li>Uma vez por dia o painel consulta a base oficial da SUSEP e se atualiza sozinho.</li>
            <li>Os números comparam o período escolhido no filtro com os mesmos meses do ano anterior.</li>
          </ul>
        </div>
        <div class="rod-col">
          <h2>Fonte e conceitos</h2>
          <p>SUSEP, Sistema de Estatísticas (SES), base completa. <a href="https://www2.susep.gov.br/menuestatistica/ses/principal.aspx" target="_blank" rel="noopener">Abrir o SES no site da SUSEP <span aria-hidden="true">↗</span></a></p>
          <ul>
            <li>GWP = prêmio emitido. Por estado, a SUSEP só publica o prêmio direto.</li>
            <li>Sinistralidade = sinistro ocorrido ÷ prêmio ganho.</li>
            <li>Valores em reais correntes, sem correção pela inflação.</li>
          </ul>
        </div>
      </div>`;
  }


  let tRes = null;
  window.addEventListener("resize", () => { clearTimeout(tRes); tRes = setTimeout(render, 150); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", render);

  async function iniciar() {
    $("#aba-geral").innerHTML = '<p class="carregando">Carregando dados…</p>';
    try {
      const r = await fetch("data/ses.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      D = await r.json();
    } catch (e) {
      $("#aba-geral").innerHTML = `<p class="carregando">Não foi possível carregar os dados (${esc(e.message)}). Tente recarregar a página.</p>`;
      return;
    }
    montarIndices();
    montarFiltros();
    const h = (location.hash || "").slice(1);
    irPara(["geral", "linhas", "conc", "uf"].includes(h) ? h : "geral");
  }
  iniciar();
})();

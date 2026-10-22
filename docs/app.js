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
    ufSel: null,
    rankOrd: { col: "pe", dir: -1 },
    geralOrd: "share",
    geralTab: null,
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

  /* ---------- Visão geral ---------- */
  // Textos de ajuda contextual (abrem no "?" ao lado de cada indicador)
  const AJUDA = {
    premio: "Prêmio emitido: valor das apólices emitidas no período, antes de descontar resseguro. É a medida de tamanho usada para participação e ranking.",
    share: "Participação de mercado: prêmio emitido da Akad dividido pelo prêmio emitido de todas as seguradoras no mesmo ramo e no mesmo período.",
    pp: "Variação em pontos percentuais (p.p.): diferença entre a participação atual e a do mesmo período do ano anterior. Ex.: de 10% para 12% = +2 p.p.",
    cresc: "Crescimento: quanto o prêmio emitido da Akad subiu ou caiu contra os mesmos meses do ano anterior. Olha só para a Akad, sem comparar com o mercado.",
    pos: "Posição: lugar da Akad no ranking de prêmio emitido entre as seguradoras com prêmio positivo no ramo e no período. \"de N\" é o número dessas seguradoras.",
    mov: "Movimento: quantas posições a Akad subiu (▲) ou caiu (▼) no ranking em relação ao mesmo período do ano anterior.",
    sin: "Sinistralidade: sinistro ocorrido dividido pelo prêmio ganho (a parte do prêmio que corresponde ao tempo de cobertura já decorrido). Ex.: 60% quer dizer que, a cada R$ 100 de prêmio ganho, R$ 60 foram para sinistros. Quanto menor, melhor.",
    lider: "Ramos em que a Akad tem o maior prêmio emitido no período.",
    ref: "Seguradora de referência: a líder do ramo. Quando a Akad lidera, aparece a vice-líder.",
    vsMerc: "Compara o crescimento do prêmio da Akad com o do mercado. Quando a Akad cresce mais que o mercado, a participação sobe; quando cresce menos, cai.",
    frente: "Em quantos ramos a Akad está melhor colocada que essa seguradora, contando só os ramos em que as duas vendem.",
    status: "A SUSEP publica os dados de cada mês com cerca de dois meses de atraso e às vezes corrige meses anteriores. Toda segunda-feira, às 9h, o painel consulta a base da SUSEP e se atualiza sozinho quando há dados novos.",
    universo: "Os ramos da SUSEP em que a Akad atua, cada um com seu código oficial. Os indicadores do topo somam todos eles.",
  };
  const ajuda = (k, rot) => `<button type="button" class="ajuda" data-ajuda="${k}" aria-label="O que é ${esc(rot)}?">?</button>`;
  function ligarAjuda() {
    if (ligarAjuda.ok) return;
    ligarAjuda.ok = true;
    const abrir = (b) => {
      const r = b.getBoundingClientRect();
      mostrarTip(`<div style="max-width:260px">${esc(AJUDA[b.dataset.ajuda] || "")}</div>`, { clientX: r.left, clientY: r.bottom });
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
  // Próxima execução do workflow: segunda-feira 12:00 UTC (9h em Brasília)
  function proximaVerificacao() {
    const agora = new Date();
    const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12, 0, 0));
    let add = (1 - d.getUTCDay() + 7) % 7;
    if (add === 0 && agora >= d) add = 7;
    d.setUTCDate(d.getUTCDate() + add);
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
        temAkad: a.pe > 0, dPos: a.pos && a.posP ? a.posP - a.pos : null };
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

    const contexto = "";

    if (!(RT.tc[0] > 0)) {
      el.innerHTML = `${contexto}<div class="card vazio-bloco"><h2>Sem dados para este período</h2><p>A base da SUSEP não tem prêmio emitido nos ramos acompanhados entre ${per}. Escolha outro período no filtro de período.</p></div>`;
      return;
    }

    // A. Panorama: participação, vendas da Akad e sinistros, cada um com sua comparação
    const crescMerc = cresc(RT.tc[0], RT.tp[0]);

    // A1. Participação (aqui sim compara com o mercado)
    let frase = "";
    if (ak.cresc != null && crescMerc != null && ak.dShare != null) {
      const fa = `O prêmio da Akad ${ak.cresc >= 0 ? "cresceu" : "caiu"} ${nf1.format(Math.abs(ak.cresc))}%`;
      const fm = `o do mercado ${crescMerc >= 0 ? "cresceu" : "caiu"} ${nf1.format(Math.abs(crescMerc))}%`;
      const fim = Math.abs(ak.dShare) < 0.05
        ? "Por isso a participação ficou praticamente igual."
        : ak.dShare > 0 ? "Como a Akad foi melhor que o mercado, a fatia dela aumentou."
        : "Como a Akad foi pior que o mercado, a fatia dela diminuiu.";
      frase = `${fa}, enquanto ${fm}. ${fim}`;
    }
    const blocoPart = `
      <div class="pz pz-part">
        <h2 class="pz-tit">Participação de mercado ${ajuda("share", "participação de mercado")}</h2>
        <div class="hero-linha"><span class="hero-val">${pct(ak.share, 2)}</span><span class="hero-var">${ppSeta(ak.dShare)} ${ajuda("pp", "variação em pontos percentuais")}</span></div>
        <p class="pz-ant">${ak.shareP != null ? `Era <b>${pct(ak.shareP, 2)}</b> em ${perP}` : "Sem participação no período anterior para comparar"}</p>
        ${frase ? `<p class="hero-frase">${frase}</p>` : ""}
        <dl class="pz-fatos">
          <div><dt>Mercado nos ${nL} ramos</dt><dd>${reais(RT.tc[0])} <span class="pz-cr">${crescNeutro(crescMerc)}</span></dd></div>
          <div><dt>Posição da Akad ${ajuda("pos", "posição")}</dt><dd>${ak.pos ? `${ak.pos}º lugar` : "sem prêmio"}${ak.posP && ak.pos ? ` <span class="pz-cr">era ${ak.posP}º</span>` : ""}</dd></div>
          <div><dt>Liderança ${ajuda("lider", "liderança")}</dt><dd>${lidera.length} de ${nL} ramos <span class="pz-cr">top 3 em ${top3.length}</span></dd></div>
        </dl>
      </div>`;

    // A2. Vendas da Akad: mesmo recorte de meses em cada ano, sem olhar o mercado
    const hist = [];
    for (let k = 0; P.a - 12 * k >= 0; k++) {
      const a = P.a - 12 * k, b = P.b - 12 * k;
      const m = agg(IDX.todos, a, b).get(AKAD);
      hist.unshift({ a, b, v: m ? m[0] : 0 });
    }
    hist.forEach((h, i) => { h.cr = i > 0 ? cresc(h.v, hist[i - 1].v) : null; });
    const mesmoAno = D.meses[P.a].slice(0, 4) === D.meses[P.b].slice(0, 4);
    const rotH = (h) => (mesmoAno ? D.meses[h.b].slice(0, 4) : `até ${mesLabel(h.b)}`);
    const recorte = S.periodo === "12m" ? `12 meses até ${MESES_PT[+D.meses[P.b].slice(4) - 1]} de cada ano`
      : mesmoAno && !(D.meses[P.a].endsWith("01") && D.meses[P.b].endsWith("12")) ? `${MESES_PT[+D.meses[P.a].slice(4) - 1]} a ${MESES_PT[+D.meses[P.b].slice(4) - 1]} de cada ano`
      : mesmoAno ? "ano completo" : "mesmo intervalo de meses, ano a ano";
    const maxH = Math.max(1, ...hist.map((h) => h.v));
    const barrasH = hist.map((h, i) => {
      const atual = i === hist.length - 1;
      const crTxt = h.cr == null ? "–" : h.cr > 999 ? "> +999%" : `${h.cr > 0 ? "+" : h.cr < 0 ? "−" : ""}${nf1.format(Math.abs(h.cr))}%`;
      return `<li class="vh${atual ? " atual" : ""}" aria-label="${esc(periodoLabel(h.a, h.b))}: ${reais(h.v)}, crescimento ${crTxt}">
        <span class="vh-cr${h.cr == null ? " zero" : ""}" aria-hidden="true">${h.cr == null ? "&nbsp;" : `<span class="vh-seta">${h.cr >= 0 ? "▲" : "▼"} </span>` + crTxt}</span>
        <span class="vh-trilho" aria-hidden="true"><i style="height:${Math.max(h.v > 0 ? 2 : 0, (h.v / maxH) * 100)}%"></i></span>
        <span class="vh-val" aria-hidden="true">${reaisCurto(h.v)}</span>
        <span class="vh-rot" aria-hidden="true">${rotH(h)}</span>
      </li>`;
    }).join("");
    const blocoVendas = `
      <div class="pz pz-vendas">
        <h2 class="pz-tit">Vendas da Akad ${ajuda("premio", "prêmio emitido")}</h2>
        <div class="hero-linha"><span class="hero-val hv-m">${reais(ak.pe)}</span><span class="hero-var">${crescNeutro(ak.cresc)} ${ajuda("cresc", "crescimento")}</span></div>
        <p class="pz-ant">${ak.peP > 0 ? `Era <b>${reais(ak.peP)}</b> em ${perP}` : "Sem prêmio no período anterior para comparar"}</p>
        <p class="pz-leg">Prêmio emitido e crescimento contra o ano anterior, ${recorte}</p>
        <ol class="vh-lista" aria-label="Prêmio emitido da Akad por ano">${barrasH}</ol>
      </div>`;

    // A3. Sinistros: comparação principal com a própria Akad
    const pAk = RT.prev.get(AKAD);
    const sinP = pAk && pAk[1] > 0 ? (pAk[2] / pAk[1]) * 100 : null;
    const em100 = (s) => (s == null ? "–" : `R$ ${nf0.format(s)}`);
    const dSin = ak.sin != null && sinP != null ? ak.sin - sinP : null;
    const blocoSin = `
      <div class="pz pz-sin">
        <h2 class="pz-tit">Sinistros ${ajuda("sin", "sinistralidade")}</h2>
        <div class="sin-grade">
          <div>
            <p class="sin-frase">${ak.sin != null ? `A cada <b>R$ 100</b> de prêmio ganho, <b>${em100(ak.sin)}</b> viraram sinistro.` : "Sem prêmio ganho no período para calcular."}</p>
            <p class="pz-ant">${sinP != null ? `Em ${perP} eram <b>${em100(sinP)}</b>, ${dSin == null || Math.abs(dSin) < 0.05 ? "praticamente o mesmo custo" : dSin > 0 ? "então o custo de sinistros aumentou" : "então o custo de sinistros diminuiu"}.` : "Sem período anterior para comparar."} Esse número se chama sinistralidade: <b>${pct(ak.sin)}</b>.</p>
          </div>
          <div class="sin-comp">
            <div class="sc-l"><span>Akad, ${per}</span><b>${pct(ak.sin)}</b></div>
            <div class="sc-l"><span>Akad, ${perP || "período anterior"}</span><b>${pct(sinP)}</b></div>
            ${dSin != null ? `<div class="sc-l sc-d"><span>Diferença</span><b>${dSin > 0 ? "+" : dSin < 0 ? "−" : ""}${nf1.format(Math.abs(dSin))} p.p. ${Math.abs(dSin) < 0.05 ? "" : dSin > 0 ? "(pior)" : "(melhor)"}</b></div>` : ""}
            <div class="sc-l sc-m"><span>Mercado, mesmos ramos</span><b>${pct(sinM)}</b></div>
            <p class="sc-nota">O mercado vende outra mistura de ramos, então use como referência, não como meta.</p>
          </div>
        </div>
      </div>`;

    const panorama = `
      <div class="pan-cards">
        <section class="card sec" aria-label="Vendas da Akad">${blocoVendas}</section>
        <section class="card sec" aria-label="Participação de mercado">${blocoPart}</section>
      </div>
      <section class="card sec" aria-label="Sinistros">${blocoSin}</section>`;

    // B. Movimentos
    const item = (x, tipo) => `
      <li><button type="button" class="mv-item" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: participação ${pctPart(x.a.share)}, abrir detalhe">
        <span class="mv-nome">${esc(x.l.nome)}</span>
        <span class="mv-val">${tipo === "lider" ? `<b>${pctPart(x.a.share)}</b> de participação` : `${pctPart(x.a.shareP)} <span aria-hidden="true">→</span> <b>${pctPart(x.a.share)}</b>`}</span>
        <span class="mv-var">${tipo === "lider" ? (x.n === 1 ? '<span class="vs0">única seguradora</span>' : ppSeta(x.a.dShare)) : ppSeta(x.a.dShare)}</span>
      </button></li>`;
    const coluna = (tit, lst, tipo, vazio) => `
      <div class="mv-col">
        <h3>${tit}</h3>
        ${lst.length ? `<ul>${lst.map((x) => item(x, tipo)).join("")}</ul>` : `<p class="mv-vazio">${vazio}</p>`}
      </div>`;
    const movimentos = `
      <section class="card sec" aria-labelledby="h-mov">
        <h2 id="h-mov" class="sec-tit">Movimentos de participação</h2>
        <div class="mv-grade">
          ${coluna("Onde a Akad lidera", lidera, "lider", "A Akad não lidera nenhum ramo no período.")}
          ${coluna("Maiores ganhos", ganhos, "g", "Nenhum ramo ganhou participação no período.")}
          ${coluna("Maiores perdas", perdas, "p", "Nenhum ramo perdeu participação no período.")}
        </div>
      </section>`;

    // C. Barras horizontais de participação
    const ord = S.geralOrd || "share";
    const disputa = linhas.filter((x) => x.temAkad && x.n > 1);
    const semConc = linhas.filter((x) => x.temAkad && x.n === 1);
    const semA = linhas.filter((x) => !x.temAkad);
    const cmp = {
      share: (p, q) => (q.a.share || 0) - (p.a.share || 0),
      ganho: (p, q) => (q.a.dShare ?? -1e9) - (p.a.dShare ?? -1e9),
      perda: (p, q) => (p.a.dShare ?? 1e9) - (q.a.dShare ?? 1e9),
      pos: (p, q) => (p.a.pos || 999) - (q.a.pos || 999) || (q.a.share || 0) - (p.a.share || 0),
    }[ord];
    disputa.sort(cmp);
    // Escala definida só pelas linhas com concorrência (o 100% do DPEM não achata as demais)
    const base = [];
    disputa.forEach((x) => { if (x.a.share != null) base.push(x.a.share); if (x.a.shareP != null) base.push(x.a.shareP); });
    const passoEsc = niceMax((Math.max(1, ...base) * 1.05) / 4);
    const escMax = passoEsc * 4;
    const W = (v) => Math.min(100, (v / escMax) * 100);
    const ticks = [0, 1, 2, 3, 4].map((f) => passoEsc * f);
    const ordBtn = (k, rot) => `<button type="button" data-ord="${k}" aria-pressed="${ord === k}">${rot}</button>`;
    const barRow = (x, suave) => {
      const a = x.a;
      const est = a.share != null && a.share >= escMax;
      const estP = a.shareP != null && a.shareP >= escMax;
      const sel = S.geralSel === x.l.id ? " sel" : "";
      if (!x.temAkad) {
        return `<li><button type="button" class="pb sem${sel}" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: Akad sem prêmio no período. Abrir detalhe">
          <span class="pb-nome"><b>${esc(x.l.nome)}</b><small>${x.l.ramos.join(", ")}</small></span>
          <span class="pb-track"><span class="pb-semtxt">Akad sem prêmio no período${x.n ? ` · ${x.n} seguradoras com prêmio` : " · sem dados de mercado"}</span></span>
          <span class="pb-val">–</span><span class="pb-var">${ppSeta(null)}</span><span class="pb-pos">${posChip(null)}</span>
        </button></li>`;
      }
      return `<li><button type="button" class="pb${suave ? " suave" : ""}${sel}" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: participação ${pctPart(a.share)}, variação ${a.dShare == null ? "sem comparação" : nf1.format(a.dShare) + " pontos percentuais"}, posição ${a.pos} de ${x.n}. Abrir detalhe">
        <span class="pb-nome"><b>${esc(x.l.nome)}</b><small>${x.l.ramos.join(", ")}</small></span>
        <span class="pb-track">
          <span class="pb-fill${est ? " est" : ""}" style="width:${W(a.share || 0)}%"></span>
          ${a.shareP != null ? `<span class="pb-ant${estP ? " est" : ""}" style="left:${W(a.shareP)}%" title="${perP}: ${pctPart(a.shareP)}"></span>` : ""}
          ${est ? `<span class="pb-quebra">${x.n === 1 ? "única seguradora no ramo" : "fora da escala"}</span>` : ""}
        </span>
        <span class="pb-val">${pctPart(a.share)}</span>
        <span class="pb-var">${ppSeta(a.dShare)}</span>
        <span class="pb-pos">${posChip(a.pos, x.n)} ${movHtml(a.pos, a.posP)}</span>
      </button></li>`;
    };
    const grupoExtra = (tit, lst, suave) => lst.length ? `<li class="pb-grupo" aria-hidden="true">${tit}</li>${lst.map((x) => barRow(x, suave)).join("")}` : "";
    const grafico = `
      <section class="card sec" aria-labelledby="h-pbar">
        <div class="sec-cab">
          <div>
            <h2 id="h-pbar" class="sec-tit">Participação por ramo</h2>
            <p class="sec-sub">Quanto do mercado de cada ramo é da Akad. Clique num ramo para ver o detalhe.</p>
            <p class="legenda-pb legenda-topo"><span class="lg-i"><span class="lg-fill"></span>Participação em ${per}</span>${perP ? `<span class="lg-i"><span class="lg-ant"></span>Como estava em ${perP}</span>` : ""}<span class="lg-i"><b>▲▼</b>&nbsp;subiu ou caiu no ranking</span></p>
          </div>
          <div class="ctrl-ord"><span class="ctrl-rot">Ordenar por</span>
            <div class="seg-ctrl" role="group" aria-label="Ordenar gráfico">
              ${ordBtn("share", "Participação")}${ordBtn("ganho", "Maior ganho")}${ordBtn("perda", "Maior perda")}${ordBtn("pos", "Posição")}
            </div>
          </div>
        </div>
        <div class="pb-cab" aria-hidden="true">
          <span>Ramo</span>
          <span class="pb-eixo">${ticks.map((t) => `<i style="left:${(t / escMax) * 100}%">${nf0.format(t)}%</i>`).join("")}</span>
          <span class="n">Atual</span><span class="n">Variação</span><span>Posição</span>
        </div>
        <ul class="pb-lista">
          ${disputa.map((x) => barRow(x, false)).join("")}
          ${grupoExtra("Sem concorrência no período", semConc, true)}
          ${grupoExtra("Sem prêmio da Akad no período", semA, true)}
        </ul>
      </section>`;

    // D. Tabela analítica
    const T = S.geralTab || { col: "pos", dir: 1 };
    const val = (x, c) => ({
      nome: x.l.nome, pos: x.a.pos, mov: x.dPos, share: x.a.share, dShare: x.a.dShare, pe: x.temAkad ? x.a.pe : null,
      cresc: x.a.cresc, vs: x.a.cresc != null && x.crescM != null ? x.a.cresc - x.crescM : null,
      mercado: x.mercado, crescM: x.crescM, refShare: x.refInfo ? x.refInfo.share : null,
    }[c]);
    const tab = [...linhas].sort((p, q) => {
      if (T.col === "nome") return p.l.nome.localeCompare(q.l.nome, "pt-BR") * T.dir;
      const va = val(p, T.col), vb = val(q, T.col);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * T.dir || ((q.a.share || 0) - (p.a.share || 0));
    });
    const th = (c, rot, cls = "") => `<th class="ord ${cls}" data-col="${c}" ${T.col === c ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">${rot}</button></th>`;
    const tabela = `
      <section class="card sec" aria-labelledby="h-tab">
        <div class="sec-cab">
          <div>
            <h2 id="h-tab" class="sec-tit">Tabela analítica</h2>
            <p class="sec-sub">Todos os ramos e indicadores. Clique no título de uma coluna para ordenar e no nome do ramo para abrir o detalhe.</p>
          </div>
        </div>
        <div class="tab-wrap"><table class="tg">
          <thead>
            <tr class="grupo">
              <th rowspan="2" class="ord" data-col="nome" ${T.col === "nome" ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">Ramo</button></th>
              <th colspan="2" class="g">Posição Akad</th>
              <th colspan="2" class="g">Participação</th>
              <th colspan="3" class="g">Prêmio emitido Akad</th>
              <th colspan="2" class="g">Mercado</th>
              <th colspan="2" class="g">Referência ${ajuda("ref", "seguradora de referência")}</th>
            </tr>
            <tr>
              ${th("pos", "Lugar", "n")}${th("mov", "Mov.", "n")}
              ${th("share", "Atual", "n g1")}${th("dShare", "Var. p.p.", "n")}
              ${th("pe", "Valor", "n g1")}${th("cresc", "Cresc.", "n")}${th("vs", "vs. mercado", "")}
              ${th("mercado", "Valor", "n g1")}${th("crescM", "Cresc.", "n")}
              <th class="g1">Seguradora</th>${th("refShare", "Part.", "n")}
            </tr>
          </thead>
          <tbody>${tab.map((x) => `
            <tr data-linha="${x.l.id}" class="${S.geralSel === x.l.id ? "sel" : ""}${x.temAkad ? "" : " semak"}">
              <td class="nome"><button type="button" class="lk" data-abrir="${x.l.id}">${esc(x.l.nome)}</button><span class="sub">${x.l.ramos.join(", ")}</span></td>
              <td class="n">${x.a.pos ? `${x.a.pos}º <span class="sub-i">de ${x.n}</span>` : '<span class="sub-i">sem prêmio</span>'}</td>
              <td class="n">${movHtml(x.a.pos, x.a.posP)}</td>
              <td class="n g1"><b>${x.temAkad ? pctPart(x.a.share) : "–"}</b></td>
              <td class="n">${ppSeta(x.a.dShare)}</td>
              <td class="n g1">${x.temAkad ? reais(x.a.pe) : '<span class="sub-i">sem prêmio</span>'}</td>
              <td class="n">${crescNeutro(x.a.cresc)}</td>
              <td>${vsTexto(x.a.cresc, x.crescM)}</td>
              <td class="n g1">${x.mercado > 0 ? reais(x.mercado) : '<span class="sub-i">sem dados</span>'}</td>
              <td class="n">${crescNeutro(x.crescM)}</td>
              <td class="g1 ref">${x.ref ? `${esc(nomeEnt(x.ref))} <span class="sub-i">${x.lider === AKAD ? "vice-líder" : "líder"}</span>` : '<span class="sub-i">não há outra seguradora</span>'}</td>
              <td class="n">${x.refInfo ? pctPart(x.refInfo.share) : "–"}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <p class="leg-tab">– sem base de comparação ou não se aplica · "sem prêmio": a Akad não emitiu prêmio positivo no ramo no período · "&lt; 0,1%": participação positiva, abaixo de 0,1% · "vs. mercado": se o prêmio da Akad cresceu acima ou abaixo do mercado no ramo · crescimento em cor neutra: o ganho competitivo é medido pela variação de participação.</p>
      </section>`;

    el.innerHTML = contexto + panorama + movimentos + grafico + tabela;

    // Interações: um clique em qualquer linha (destaques, gráfico ou tabela) abre o detalhe
    el.querySelectorAll(".mv-item, .pb, .lk").forEach((b) => b.addEventListener("click", () => abrirLinha(b.dataset.linha || b.dataset.abrir)));
    el.querySelectorAll("tbody tr[data-linha]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button")) abrirLinha(tr.dataset.linha); }));
    // Destaque sincronizado entre destaques, gráfico e tabela
    const hl = (id, on) => el.querySelectorAll(`[data-linha="${id}"]`).forEach((n) => n.classList.toggle("hl", on));
    el.querySelectorAll(".pb, tbody tr[data-linha], .mv-item").forEach((n) => {
      n.addEventListener("mouseenter", () => hl(n.dataset.linha, true));
      n.addEventListener("mouseleave", () => hl(n.dataset.linha, false));
      n.addEventListener("focusin", () => hl(n.dataset.linha, true));
      n.addEventListener("focusout", () => hl(n.dataset.linha, false));
    });
    el.querySelectorAll(".ctrl-ord button").forEach((b) => b.addEventListener("click", () => { S.geralOrd = b.dataset.ord; renderGeral(); el.querySelector(`.ctrl-ord [data-ord="${b.dataset.ord}"]`)?.focus(); }));
    el.querySelectorAll("th.ord").forEach((thEl) => thEl.querySelector("button").addEventListener("click", () => {
      const c = thEl.dataset.col;
      const padrao = c === "pos" || c === "nome" ? 1 : -1;
      const atual = S.geralTab || { col: "pos", dir: 1 };
      S.geralTab = { col: c, dir: atual.col === c ? -atual.dir : padrao };
      renderGeral();
      el.querySelector(`th[data-col="${c}"] button`)?.focus();
    }));
  }

  /* ---------- Linhas de produto ---------- */
  function ramosDaSel(sel) {
    if (sel === "todas") return IDX.todos;
    if (sel.startsWith("r:")) return [IDX.ramoIdx[sel.slice(2)]];
    return IDX.linhaPorId[sel].idx;
  }
  function nomeSel(sel) {
    if (sel === "todas") return `Todos os ${IDX.linhas.length} ramos acompanhados`;
    if (sel.startsWith("r:")) { const c = sel.slice(2); return `${D.ramos[IDX.ramoIdx[c]][1]} (código ${c})`; }
    return IDX.linhaPorId[sel].nome;
  }
  // Página "Todos os ramos": um card por ramo, com o que ele cobre e onde a Akad está
  function renderCatalogo(el, P) {
    const per = periodoLabel(P.a, P.b);
    const cards = IDX.linhas.map((l) => {
      const R = resumo(l.idx, P);
      const a = infoEnt(R, AKAD);
      const lider = R.rk[0];
      const crM = cresc(R.tc[0], R.tp[0]);
      const ak = a.pos
        ? `<span class="rc-pos${a.pos === 1 ? " lider" : ""}">${a.pos}º <small>de ${R.rk.length}</small></span><span class="rc-sh">${pctPart(a.share)} do mercado</span>`
        : `<span class="rc-sem">Akad sem prêmio no período</span>`;
      return `<li><button type="button" class="rc" data-abrir="${l.id}" aria-label="${esc(l.nome)}, abrir detalhe">
        <span class="rc-cab"><b>${esc(l.nome)}</b><small>Código SUSEP ${l.ramos.join(", ")}</small></span>
        <span class="rc-desc">${esc(l.desc || "")}</span>
        <span class="rc-dados">
          <span class="rc-d"><small>Mercado</small><b>${R.tc[0] > 0 ? reais(R.tc[0]) : "sem prêmio"}</b>${crM != null ? `<i>${crescNeutro(crM)}</i>` : ""}</span>
          <span class="rc-d"><small>Líder</small><b>${lider ? esc(lider === AKAD ? "Akad" : nomeEnt(lider)) : "–"}</b></span>
          <span class="rc-d rc-akad"><small>Akad</small>${ak}</span>
        </span>
        <span class="rc-ir" aria-hidden="true">Ver detalhe →</span>
      </button></li>`;
    }).join("");
    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>Todos os ramos</h2>
          <p>Os ${IDX.linhas.length} ramos da SUSEP em que a Akad atua, ${per}. Clique num ramo para ver o detalhe.</p>
        </div>
      </div>
      <ul class="rc-grade">${cards}</ul>`;
    el.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => { abrirDe("linhas", () => { S.linha = b.dataset.abrir; }); }));
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
          <p>${S.linha === "todas" ? `Soma dos ${IDX.linhas.length} ramos acompanhados. Escolha um ramo no filtro para ver o detalhe.` : (ramos.length > 1 ? "Códigos SUSEP: " : "Código SUSEP: ") + ramos.map((i) => esc(D.ramos[i][0] + " " + D.ramos[i][1])).join(" · ")}</p>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi destaque"><span class="rot">Posição da Akad</span><span class="val">${ak.pos ? ak.pos + "º" : "–"} <small style="font-size:.9rem;color:var(--muted)">de ${R.rk.length}</small></span><span class="det">${ak.posP ? `No ano anterior: ${ak.posP}º` : "Sem prêmio no ano anterior"}</span></div>
        <div class="kpi"><span class="rot">Participação Akad</span><span class="val">${pct(ak.share)}</span><span class="det">${ppHtml(ak.dShare)} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Prêmio emitido Akad</span><span class="val">${reais(ak.pe)}</span><span class="det">${varHtml(ak.cresc)} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Mercado</span><span class="val">${reais(R.tc[0])}</span><span class="det">${varHtml(cresc(R.tc[0], R.tp[0]))} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Sinistralidade</span><span class="val">${pct(ak.sin)}</span><span class="det">Mercado: ${pct(sinM)}</span></div>
        <div class="kpi"><span class="rot">Despesa comercial</span><span class="val">${pct(ak.com)}</span><span class="det">Mercado: ${pct(comM)} (÷ prêmio ganho)</span></div>
      </div>
      <div class="grade">
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Participação no mercado, 12 meses móveis</h2><p class="nota">Akad e os 4 maiores concorrentes do período. Área sombreada = período selecionado.</p></div>
          <div class="graf" id="g-share"></div>
        </div>
        <div class="bloco c6">
          <div class="bloco-cab"><h2>Tamanho do mercado por ano</h2><p class="nota">Prêmio emitido. * ano parcial</p></div>
          <div class="graf" id="g-merc"></div>
        </div>
        <div class="bloco c6">
          <div class="bloco-cab"><h2>Prêmio emitido Akad por ano</h2><p class="nota">* ano parcial</p></div>
          <div class="graf" id="g-akad"></div>
        </div>
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Ranking do período</h2><p class="nota">Clique num concorrente para ver o detalhe. Clique no título da coluna para ordenar.</p></div>
          <div class="tab-wrap"><table>
            <thead><tr>
              <th class="n ord" data-col="pos">#</th><th>Seguradora</th>
              <th class="n ord" data-col="pe">Prêmio emitido</th><th class="n ord" data-col="share">Participação</th>
              <th class="n ord" data-col="dShare">Variação</th><th class="n ord" data-col="cresc">Crescimento</th>
              <th class="n ord" data-col="sin">Sinistralidade</th><th class="n ord" data-col="com">Desp. comercial</th>
            </tr></thead>
            <tbody>${linhasTab.map((x) => `
              <tr class="${x.k === AKAD ? "akad" : "clic"}" data-ent="${esc(x.k)}">
                <td class="n">${x.pos || "–"}${deltaPos(x.pos, x.posP)}</td>
                <td class="nome">${esc(nomeEnt(x.k))}</td>
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

    el.querySelectorAll("th.ord").forEach((th) => {
      if (th.dataset.col === o.col) th.setAttribute("aria-sort", o.dir < 0 ? "descending" : "ascending");
      th.addEventListener("click", () => {
        const c = th.dataset.col;
        S.rankOrd = { col: c, dir: S.rankOrd.col === c ? -S.rankOrd.dir : (c === "pos" ? 1 : -1) };
        renderLinhas();
      });
    });
    el.querySelectorAll("tr.clic[data-ent]").forEach((tr) => tr.addEventListener("click", () => {
      S.concSels = [tr.dataset.ent, ...(S.concSels || []).filter((x) => x !== tr.dataset.ent)].slice(0, MAX_CONC);
      abrirDe("conc");
    }));

    // gráficos
    const chaves = [AKAD, ...top];
    const sm = serieMensal(ramos, chaves);
    const merc12 = movel12(Array.from(sm.mercado));
    const series = chaves.map((k, i) => {
      const e12 = movel12(Array.from(sm.ent.get(k)));
      return {
        nome: nomeEnt(k), cor: i === 0 ? css("--akad") : css(CORES_CONC[i - 1]), grossa: i === 0,
        valores: e12.map((v, j) => (v == null || !merc12[j] || merc12[j] <= 0 ? null : (v / merc12[j]) * 100)),
      };
    });
    linhas($("#g-share"), {
      series, banda: [P.a, P.b], inicio: 11, rotulo: "Participação de mercado em 12 meses móveis",
      fmt: (v) => pct(v), fmtEixo: (v) => nf0.format(v) + "%",
      tituloTip: (i) => `12 meses até ${mesLabel(i, true)}`,
    });
    const anosM = porAno(Array.from(sm.mercado));
    const anosA = porAno(Array.from(sm.ent.get(AKAD)));
    const rot = [...anosM.keys()];
    const ultMes = D.meses[D.meses.length - 1];
    const parcial = rot.map((y) => (y === ultMes.slice(0, 4) && !ultMes.endsWith("12") ? `até ${MESES_PT[+ultMes.slice(4) - 1]}` : null));
    barras($("#g-merc"), { rotulos: rot, valores: rot.map((y) => anosM.get(y)), cor: css("--mercado"), fmt: reais, fmtCurto: reaisCurto, parcial, rotulo: "Mercado por ano" });
    barras($("#g-akad"), {
      rotulos: rot, valores: rot.map((y) => anosA.get(y) || 0), cor: css("--akad"), fmt: reais, fmtCurto: reaisCurto, parcial, rotulo: "Akad por ano",
      extra: (i) => { const y = rot[i]; const s = anosM.get(y) > 0 ? ((anosA.get(y) || 0) / anosM.get(y)) * 100 : null; return `<div>Participação: ${pct(s)}</div>`; },
    });
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

  function renderConc() {
    ligarAjuda();
    const P = periodo();
    const el = $("#aba-conc");
    const sel = S.concSels.filter((k) => k !== AKAD && IDX.nome.has(k));
    const ents = [AKAD, ...sel];
    const ramosSel = ramosDaSel(S.linha);
    const Rsel = resumo(ramosSel, P);
    const per = periodoLabel(P.a, P.b), perP = P.pa != null ? periodoLabel(P.pa, P.pb) : null;

    // por ramo, para a matriz e para "Akad à frente em"
    const porRamo = IDX.linhas.map((l) => {
      const R = resumo(l.idx, P);
      return { l, n: R.rk.length, info: ents.map((k) => infoEnt(R, k)) };
    }).filter((x) => x.info.some((i) => i.pe > 0));
    const frenteDe = (j) => {
      const ambos = porRamo.filter((x) => x.info[0].pe > 0 && x.info[j].pe > 0);
      return { n: ambos.length, akad: ambos.filter((x) => x.info[0].pos < x.info[j].pos).length };
    };

    if (!sel.length) {
      el.innerHTML = `<div class="card vazio-bloco"><h2>Escolha concorrentes</h2><p>Use o campo Concorrentes, no filtro acima, para escolher até ${MAX_CONC} seguradoras e comparar com a Akad.</p></div>`;
      return;
    }

    const linhasTab = ents.map((k, i) => {
      const x = infoEnt(Rsel, k);
      const f = i > 0 ? frenteDe(i) : null;
      return `<tr class="${i === 0 ? "akad" : ""}">
        <td class="nome">${bolinha(i)}<b>${esc(nomeEnt(k))}</b></td>
        <td class="n">${x.pe > 0 ? reais(x.pe) : "–"}</td>
        <td class="n">${crescNeutro(x.cresc)}</td>
        <td class="n">${pctPart(x.share)}</td>
        <td class="n">${ppSeta(x.dShare)}</td>
        <td>${chipPos(x.pos)}${deltaPos(x.pos, x.posP)}</td>
        <td class="n">${f ? (f.n ? `<b>${f.akad}</b> de ${f.n}` : '<span class="vs0">sem disputa</span>') : '<span class="vs0">referência</span>'}</td>
      </tr>`;
    }).join("");

    const cab = (t, a) => `<th class="n">${t}${a ? " " + ajuda(a[0], a[1]) : ""}</th>`;
    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>Akad × ${sel.length} ${sel.length === 1 ? "concorrente" : "concorrentes"}</h2>
          <p>${esc(nomeSel(S.linha))} · ${per}${perP ? ` comparado com ${perP}` : ""}</p>
        </div>
      </div>

      <section class="card cs">
        <div class="cs-cab"><span class="cs-n">1</span><div><h2>Resumo no período</h2><p>Tamanho, crescimento e fatia de mercado de cada seguradora.</p></div></div>
        <div class="tab-wrap"><table class="tc">
          <thead><tr><th>Seguradora</th>${cab("Prêmio emitido", ["premio", "prêmio emitido"])}${cab("Crescimento", ["cresc", "crescimento"])}${cab("Participação", ["share", "participação"])}${cab("Var. participação", ["pp", "variação em pontos percentuais"])}<th>Posição ${ajuda("pos", "posição")}</th>${cab("Akad à frente em", ["frente", "Akad à frente"])}</tr></thead>
          <tbody>${linhasTab}</tbody>
        </table></div>
      </section>

      <section class="card cs">
        <div class="cs-cab"><span class="cs-n">2</span><div><h2>Evolução do prêmio</h2><p>Cada ponto soma os 12 meses anteriores. A faixa azul é o período escolhido.</p></div></div>
        <div class="graf" id="g-conc"></div>
      </section>

      <section class="card cs">
        <div class="cs-cab"><span class="cs-n">3</span><div><h2>Posição em cada ramo</h2><p>Lugar no ranking do ramo e participação. Fundo destacado: melhor colocado entre os comparados.</p></div></div>
        <div class="tab-wrap"><table class="tm">
          <thead><tr><th>Ramo</th>${ents.map((k, i) => `<th class="tm-e">${bolinha(i)}${esc(nomeEnt(k))}</th>`).join("")}</tr></thead>
          <tbody>${porRamo.map((x) => {
            const posicoes = x.info.map((i) => i.pos || Infinity);
            const melhor = Math.min(...posicoes);
            return `<tr><td class="nome"><b>${esc(x.l.nome)}</b><span class="sub">${x.n} seguradoras</span></td>${x.info.map((i, j) => `
              <td class="tm-c${i.pos && i.pos === melhor ? " melhor" : ""}">${i.pos ? `<b>${i.pos}º</b><span>${pctPart(i.share)}</span>` : '<span class="vs0">sem prêmio</span>'}</td>`).join("")}</tr>`;
          }).join("")}</tbody>
        </table></div>
      </section>

      <section class="card cs">
        <div class="cs-cab"><span class="cs-n">4</span><div><h2>Participação por estado</h2><p id="nota-uf-conc"></p></div></div>
        <div id="t-uf-conc"></div>
      </section>`;

    const sm = serieMensal(ramosSel, ents);
    linhas($("#g-conc"), {
      series: ents.map((k, i) => ({ nome: nomeEnt(k), cor: corEnt(i), valores: movel12(Array.from(sm.ent.get(k))), grossa: i === 0 })),
      banda: [P.a, P.b], inicio: 11, fmt: reais, fmtEixo: reaisCurto, rotulo: "Prêmio em 12 meses móveis",
      tituloTip: (i) => `12 meses até ${mesLabel(i, true)}`,
    });

    // Estados (base anual do ano final do período)
    const ano = +D.meses[P.b].slice(0, 4);
    const ult = D.meses[D.meses.length - 1];
    const parc = ano === +ult.slice(0, 4) && !ult.endsWith("12") ? ` (jan a ${MESES_PT[+ult.slice(4) - 1]})` : "";
    const idx = new Map(ents.map((k, i) => [k, i]));
    const porUf = new Map();
    for (const ri of ramosSel) for (const r of IDX.ufaPorRamo[ri]) {
      if (r[0] !== ano) continue;
      let x = porUf.get(r[2]); if (!x) { x = { tot: 0, v: ents.map(() => 0) }; porUf.set(r[2], x); }
      x.tot += r[4];
      const j = idx.get(IDX.chave[r[3]]);
      if (j != null) x.v[j] += r[4];
    }
    const lst = [...porUf.entries()].filter(([, x]) => x.v.some((v) => v > 0))
      .sort((p, q) => q[1].v.reduce((s, v) => s + v, 0) - p[1].v.reduce((s, v) => s + v, 0)).slice(0, 10);
    $("#nota-uf-conc").textContent = `Fatia de cada seguradora no estado, em ${ano}${parc}. Os 10 estados onde o grupo comparado mais vende.`;
    $("#t-uf-conc").innerHTML = lst.length ? `<div class="tab-wrap"><table class="tm">
      <thead><tr><th>UF</th><th class="n">Mercado</th>${ents.map((k, i) => `<th class="tm-e">${bolinha(i)}${esc(nomeEnt(k))}</th>`).join("")}</tr></thead>
      <tbody>${lst.map(([u, x]) => {
        const sh = x.v.map((v) => (x.tot > 0 && v > 0 ? (v / x.tot) * 100 : null));
        const m = Math.max(...sh.map((s) => s || 0));
        return `<tr><td><b>${D.ufs[u]}</b></td><td class="n">${reais(x.tot)}</td>${sh.map((s) => `<td class="tm-c${s && s === m ? " melhor" : ""}">${s != null ? `<b>${pctPart(s)}</b>` : '<span class="vs0">–</span>'}</td>`).join("")}</tr>`;
      }).join("")}</tbody>
    </table></div>` : '<p class="vazio">Sem dados por estado para estas seguradoras.</p>';
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
    return { bg: `rgb(${c.join(",")})`, fg: lum > 0.55 ? "#16202E" : "#FFFFFF" };
  }

  function renderUF() {
    const P = periodo();
    const el = $("#aba-uf");
    const ramos = ramosDaSel(S.linha);
    const cur = new Map(), prev = new Map();
    for (const ri of ramos) for (const r of IDX.ufmPorRamo[ri]) {
      const tgt = r[0] >= P.a && r[0] <= P.b ? cur : P.pa != null && r[0] >= P.pa && r[0] <= P.pb ? prev : null;
      if (!tgt) continue;
      const x = tgt.get(r[2]) || [0, 0, 0, 0];
      x[0] += r[3]; x[1] += r[4]; x[2] += r[5]; x[3] += r[6];
      tgt.set(r[2], x);
    }
    const linhasUF = D.ufs.map((u, i) => {
      const c = cur.get(i) || [0, 0, 0, 0], p = prev.get(i) || [0, 0, 0, 0];
      const sh = c[0] > 0 ? (c[1] / c[0]) * 100 : null, shP = p[0] > 0 ? (p[1] / p[0]) * 100 : null;
      return { i, u, merc: c[0], akad: c[1], share: sh, dShare: sh != null && shP != null ? sh - shP : null, crescM: cresc(c[0], p[0]), crescA: cresc(c[1], p[1]) };
    });
    const totM = linhasUF.reduce((s, x) => s + x.merc, 0);
    const totA = linhasUF.reduce((s, x) => s + x.akad, 0);

    // líder por UF (base anual do ano final)
    const ano = +D.meses[P.b].slice(0, 4);
    const lid = new Map();
    for (const ri of ramos) for (const r of IDX.ufaPorRamo[ri]) {
      if (r[0] !== ano) continue;
      let m = lid.get(r[2]); if (!m) { m = new Map(); lid.set(r[2], m); }
      const e = IDX.chave[r[3]];
      m.set(e, (m.get(e) || 0) + r[4]);
    }
    const topUF = (i) => { const m = lid.get(i); if (!m) return []; const t = [...m.values()].reduce((s, v) => s + v, 0); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([e, v]) => ({ e, v, s: t > 0 ? (v / t) * 100 : null })); };

    const met = S.ufMetrica;
    const valMet = (x) => (met === "share" ? x.share : met === "merc" ? x.merc : x.crescM);
    const vals = linhasUF.map(valMet).filter((v) => v != null && isFinite(v));
    const maxV = Math.max(0.0001, ...vals.map((v) => Math.abs(v)));
    const base = met === "share" ? css("--akad") : css("--mercado");

    const ord = [...linhasUF].sort((a, b) => b.merc - a.merc);
    const sel = S.ufSel;
    const ult = D.meses[D.meses.length - 1];
    const parc = ano === +ult.slice(0, 4) && !ult.endsWith("12") ? ` (jan–${MESES_PT[+ult.slice(4) - 1]})` : "";

    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>Participação por estado</h2>
          <p>Prêmio direto por UF, ${periodoLabel(P.a, P.b)}. Akad tem ${pct(totM > 0 ? (totA / totM) * 100 : null)} do mercado destes ramos no país, por esta base.</p>
        </div>
        <div class="ctrl">
          <div class="campo"><label>Colorir por</label>
            <div class="seg-ctrl" role="group" aria-label="Métrica do mapa">
              <button type="button" data-m="share" aria-pressed="${met === "share"}">Participação Akad</button>
              <button type="button" data-m="merc" aria-pressed="${met === "merc"}">Tamanho do mercado</button>
            </div>
          </div>
        </div>
      </div>
      <div class="bloco">
        <div class="mapa-wrap">
          <div>
            <div class="mapa" id="mapa"></div>
            <div class="escala"><span>${met === "share" ? "0%" : "menor"}</span><span class="grad" style="background:linear-gradient(90deg, ${rampa(0, base).bg}, ${rampa(1, base).bg})"></span><span>${met === "share" ? pct(maxV) : "maior"}</span></div>
          </div>
          <div id="uf-detalhe"></div>
        </div>
      </div>
      <div class="bloco">
        <div class="bloco-cab"><h2>Todos os estados</h2><p class="nota">Líder no estado com base em ${ano}${parc}. Clique numa UF para ver as maiores seguradoras.</p></div>
        <div class="tab-wrap"><table>
          <thead><tr><th>UF</th><th class="n">Mercado</th><th class="n">Cresc. mercado</th><th class="n">Akad</th><th class="n">Cresc. Akad</th><th class="n">Part. Akad</th><th class="n">Variação</th><th>Líder no estado</th></tr></thead>
          <tbody>${ord.map((x) => { const t = topUF(x.i)[0]; return `<tr class="clic ${sel === x.i ? "akad" : ""}" data-uf="${x.i}">
            <td><b>${x.u}</b></td><td class="n">${reais(x.merc)}</td><td class="n">${varHtml(x.crescM)}</td><td class="n">${reais(x.akad)}</td><td class="n">${varHtml(x.crescA)}</td>
            <td class="n">${pct(x.share)}</td><td class="n">${ppHtml(x.dShare)}</td>
            <td>${t ? `${esc(nomeEnt(t.e))} <span class="sub">${pct(t.s)}</span>` : "–"}</td></tr>`; }).join("")}</tbody>
        </table></div>
      </div>`;

    const mapa = $("#mapa");
    mapa.innerHTML = MOSAICO.map(([u, r, c]) => {
      const x = linhasUF.find((y) => y.u === u);
      const v = valMet(x);
      const { bg, fg } = v == null ? { bg: "var(--grid)", fg: "var(--muted)" } : rampa(Math.abs(v) / maxV, base);
      const rot = met === "share" ? pct(x.share) : reaisCurto(x.merc);
      return `<button type="button" class="uf" style="grid-row:${r + 1};grid-column:${c + 1};background:${bg};color:${fg}" data-uf="${x.i}" aria-pressed="${sel === x.i}" aria-label="${u}: ${met === "share" ? "participação Akad " + pct(x.share) : "mercado " + reais(x.merc)}">${u}<small>${rot}</small></button>`;
    }).join("");
    mapa.querySelectorAll(".uf").forEach((b) => {
      b.addEventListener("click", () => { S.ufSel = +b.dataset.uf; renderUF(); });
      b.addEventListener("mousemove", (ev) => {
        const x = linhasUF[+b.dataset.uf];
        mostrarTip(`<b>${x.u}</b><div>Mercado: ${reais(x.merc)} ${x.crescM != null ? "(" + (x.crescM > 0 ? "+" : "") + nf1.format(x.crescM) + "%)" : ""}</div><div>Akad: ${reais(x.akad)}</div><div>Participação Akad: ${pct(x.share)}</div>`, ev);
      });
      b.addEventListener("mouseleave", esconderTip);
    });
    el.querySelectorAll("tr[data-uf]").forEach((tr) => tr.addEventListener("click", () => { S.ufSel = +tr.dataset.uf; renderUF(); }));
    el.querySelectorAll(".seg-ctrl button").forEach((b) => b.addEventListener("click", () => { S.ufMetrica = b.dataset.m; renderUF(); }));

    const det = $("#uf-detalhe");
    const ui = sel != null ? sel : ord[0].i;
    const x = linhasUF[ui];
    const t = topUF(ui).slice(0, 8);
    const akPos = topUF(ui).findIndex((y) => y.e === AKAD);
    det.innerHTML = `
      <h3 style="font-size:1rem;margin-bottom:4px">${x.u}: maiores seguradoras em ${ano}${parc}</h3>
      <p class="nota" style="margin:0 0 10px">Mercado no período: ${reais(x.merc)} · Akad: ${reais(x.akad)} (${pct(x.share)})${akPos >= 0 ? ` · ${akPos + 1}º lugar no estado` : ""}</p>
      ${t.length ? `<div class="tab-wrap"><table><thead><tr><th class="n">#</th><th>Seguradora</th><th class="n">Prêmio</th><th class="n">Part.</th></tr></thead>
      <tbody>${t.map((y, j) => `<tr class="${y.e === AKAD ? "akad" : ""}"><td class="n">${j + 1}</td><td class="nome">${esc(nomeEnt(y.e))}</td><td class="n">${reais(y.v)}</td><td class="n">${pct(y.s)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="vazio">Sem dados para este estado.</p>'}`;
  }

  /* ---------- Navegação e filtros ---------- */
  const ABAS = ["geral", "linhas", "conc", "uf"];
  // Quais filtros cada página usa (o período vale para todas)
  const FILTROS_ABA = { geral: [], linhas: ["linha"], conc: ["conc", "linha"], uf: ["linha"] };

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

  function opcoesLinhaFiltro() {
    const op = [{ v: "todas", t: `Todos os ${IDX.linhas.length} ramos`, sub: "soma de todos" }];
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
    $("#fg-nota").hidden = S.aba !== "geral";
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
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  function desenharStatus(ultima, falhou) {
    const ult = D.meses.length - 1;
    const prox = proximaVerificacao();
    const dia = (d) => d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
    const hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("#status").innerHTML = `
      <span class="st-item st-dado"><i class="st-dot${falhou ? " alerta" : ""}" aria-hidden="true"></i>Dados até <b>${mesLabel(ult, true)}</b></span>
      <span class="st-item">${falhou ? "Última consulta com erro em" : "Consultado na SUSEP em"} <b>${dia(ultima)}</b></span>
      <span class="st-item">Próxima consulta <b>${dia(prox)}, ${hora(prox)}</b></span>
      <button type="button" class="ajuda st-ajuda" data-ajuda="status" aria-label="Como funciona a atualização?">?</button>`;
  }
  function montarStatus() {
    ligarAjuda();
    const gerado = new Date(D.gerado);
    const base = ultimaVerificacao();
    desenharStatus(gerado > base ? gerado : base, false);
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
      if (a.dataset.aba === "linhas") S.linha = "todas"; // pelo menu, Ramos abre a visão de todos os ramos
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
    $("#rodape-txt").innerHTML = `Fonte: SUSEP, Sistema de Estatísticas (SES), base completa. Valores em reais correntes, sem correção pela inflação. Nacional: prêmio emitido; por estado: prêmio direto (a SUSEP só publica esse por UF). Sinistralidade = sinistro ocorrido ÷ prêmio ganho. Dados mensais podem ser recarregados pela SUSEP. Base gerada em ${gerado.toLocaleString("pt-BR")}.`;
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

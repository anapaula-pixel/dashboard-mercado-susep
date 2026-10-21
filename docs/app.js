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
    visao: "cia",
    linhaSel: "rcpro",
    concSel: null,
    concLinha: "todas",
    ufLinha: "todas",
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
    // cia -> chave da entidade conforme a visão (seguradora ou grupo)
    const chave = new Array(D.cias.length);
    const nome = new Map();
    D.cias.forEach((c, i) => {
      const [cod, n, g] = c;
      if (S.visao === "grupo" && g && cod !== AKAD) {
        chave[i] = "g:" + g;
        nome.set("g:" + g, nomeBonito(g));
      } else {
        chave[i] = cod;
        nome.set(cod, cod === AKAD ? "Akad" : nomeBonito(n));
      }
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
    share: "Participação de mercado: prêmio emitido da Akad dividido pelo prêmio emitido de todas as seguradoras na mesma linha e no mesmo período.",
    pp: "Variação em pontos percentuais (p.p.): diferença entre a participação atual e a do mesmo período do ano anterior. Ex.: de 10% para 12% = +2 p.p.",
    cresc: "Crescimento: variação percentual do prêmio emitido contra o mesmo período do ano anterior. A Akad pode crescer e ainda perder participação, se o mercado crescer mais.",
    pos: "Posição: lugar da Akad no ranking de prêmio emitido entre as seguradoras com prêmio positivo na linha e no período. \"de N\" é o número dessas seguradoras.",
    mov: "Movimento: quantas posições a Akad subiu (▲) ou caiu (▼) no ranking em relação ao mesmo período do ano anterior.",
    sin: "Sinistralidade: sinistro ocorrido dividido pelo prêmio ganho. Mede custo de sinistros, não tamanho. O mix de ramos da Akad é diferente do mercado, então compare com cuidado.",
    lider: "Linhas de produto em que a Akad tem o maior prêmio emitido no período.",
    ref: "Seguradora de referência: a líder da linha. Quando a Akad lidera, aparece a vice-líder.",
    vsMerc: "Compara o crescimento do prêmio da Akad com o do mercado. Quando a Akad cresce mais que o mercado, a participação sobe; quando cresce menos, cai.",
    universo: "A Akad é acompanhada em 14 linhas de produto, que somam 22 ramos SUSEP. Os indicadores do topo somam todos os 22 ramos.",
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
    S.linhaSel = id;
    S.geralSel = id;
    irPara("linhas");
  }

  function renderGeral() {
    ligarAjuda();
    const P = periodo();
    const el = $("#aba-geral");
    const G = dadosGeral(P);
    const { RT, ak, sinM, linhas, lidera, top3, ganhos, perdas } = G;
    const nL = IDX.linhas.length, nR = D.ramos.length;
    const per = periodoLabel(P.a, P.b), perP = P.pa != null ? periodoLabel(P.pa, P.pb) : null;
    const visao = S.visao === "grupo" ? "Grupo econômico" : "Seguradora";
    const gerado = new Date(D.gerado);
    window.__geral = G; // usado na verificação automática

    const contexto = `
      <div class="ctx" role="region" aria-label="Contexto da análise">
        <dl class="ctx-lista">
          <div><dt>Analisando</dt><dd>${per}</dd></div>
          <div><dt>Comparado com</dt><dd>${perP || "sem período anterior na base"}</dd></div>
          <div><dt>Concorrentes por</dt><dd>${visao}</dd></div>
          <div><dt>Universo ${ajuda("universo", "universo")}</dt><dd>${nL} linhas de produto · ${nR} ramos SUSEP</dd></div>
        </dl>
        <dl class="ctx-lista ctx-dados">
          <div><dt>Dados SUSEP até</dt><dd>${mesLabel(D.meses.length - 1, true)}</dd></div>
          <div><dt>Atualizado em</dt><dd>${gerado.toLocaleDateString("pt-BR")}</dd></div>
          <div><dt>Próxima verificação</dt><dd>${fmtDataHora(proximaVerificacao())}</dd></div>
        </dl>
      </div>`;

    if (!(RT.tc[0] > 0)) {
      el.innerHTML = `${contexto}<div class="vazio-bloco"><h2>Sem dados para este período</h2><p>A base da SUSEP não tem prêmio emitido nos ramos acompanhados entre ${per}. Escolha outro período no filtro acima.</p></div>`;
      return;
    }

    // A. Panorama
    const crescA = ak.cresc, crescMerc = cresc(RT.tc[0], RT.tp[0]);
    let frase = "";
    if (crescA != null && crescMerc != null && ak.dShare != null) {
      const fa = `O prêmio da Akad ${crescA >= 0 ? "cresceu" : "caiu"} ${nf1.format(Math.abs(crescA))}%`;
      const fm = `o mercado ${crescMerc >= 0 ? "cresceu" : "caiu"} ${nf1.format(Math.abs(crescMerc))}%`;
      const fim = Math.abs(ak.dShare) < 0.05
        ? (Math.abs(crescA - crescMerc) < 0.5 ? "Os dois andaram no mesmo ritmo, e a participação ficou estável."
          : `A Akad teve desempenho ${crescA > crescMerc ? "acima" : "abaixo"} do mercado, mas a diferença quase não mexeu na participação.`)
        : ak.dShare > 0 ? "A Akad teve desempenho acima do mercado, por isso ganhou participação."
        : "A Akad teve desempenho abaixo do mercado, por isso perdeu participação.";
      frase = `${fa} e ${fm}. ${fim}`;
    }
    const maxHero = Math.max(ak.share || 0, ak.shareP || 0) || 1;
    const panorama = `
      <section class="pan" aria-labelledby="h-pan">
        <h2 id="h-pan" class="sec-tit">Panorama do mercado</h2>
        <div class="pan-grade">
          <div class="pan-hero">
            <span class="rot">Participação da Akad ${ajuda("share", "participação de mercado")}</span>
            <div class="hero-linha"><span class="hero-val">${pct(ak.share, 2)}</span><span class="hero-var">${ppSeta(ak.dShare)} ${ajuda("pp", "variação em pontos percentuais")}</span></div>
            ${ak.shareP != null ? `
            <div class="hero-comp" aria-hidden="true">
              <div class="hc-l"><span>${perP}</span><span class="hc-t"><i style="width:${(ak.shareP / maxHero) * 100}%" class="hc-ant"></i></span><b>${pct(ak.shareP, 2)}</b></div>
              <div class="hc-l"><span>${per}</span><span class="hc-t"><i style="width:${((ak.share || 0) / maxHero) * 100}%" class="hc-at"></i></span><b>${pct(ak.share, 2)}</b></div>
            </div>` : ""}
            ${frase ? `<p class="hero-frase">${frase}</p>` : ""}
            <p class="hero-sub">${ak.pos ? `${ak.pos}º lugar no somatório dos ${nR} ramos` : "Sem prêmio no período"} ${ajuda("pos", "posição")}</p>
          </div>
          <div class="pan-kpis">
            <div class="mk">
              <span class="rot">Prêmio emitido Akad ${ajuda("premio", "prêmio emitido")}</span>
              <span class="mk-val">${reais(ak.pe)}</span>
              <span class="mk-det">${crescNeutro(ak.cresc)} contra ${perP || "o ano anterior"} ${ajuda("cresc", "crescimento")}</span>
            </div>
            <div class="mk">
              <span class="rot">Prêmio emitido do mercado</span>
              <span class="mk-val">${reais(RT.tc[0])}</span>
              <span class="mk-det">${crescNeutro(crescMerc)} contra ${perP || "o ano anterior"}</span>
            </div>
            <div class="mk">
              <span class="rot">Liderança ${ajuda("lider", "liderança")}</span>
              <span class="mk-val">${lidera.length} ${lidera.length === 1 ? "linha" : "linhas"}</span>
              <span class="mk-det">de ${nL} acompanhadas · Akad tem prêmio em ${G.comPremio} · top 3 em ${top3.length}</span>
            </div>
          </div>
          <div class="pan-tec">
            <span class="rot">Indicador técnico</span>
            <span><b>Sinistralidade</b> ${ajuda("sin", "sinistralidade")} Akad <b>${pct(ak.sin)}</b> · mercado <b>${pct(sinM)}</b></span>
            <span class="nota">O mix de ramos do mercado é diferente do da Akad.</span>
          </div>
        </div>
      </section>`;

    // B. Movimentos
    const item = (x, tipo) => `
      <li><button type="button" class="mv-item" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: participação ${pctPart(x.a.share)}, abrir detalhe">
        <span class="mv-nome">${esc(x.l.nome)}</span>
        <span class="mv-val">${tipo === "lider" ? `<b>${pctPart(x.a.share)}</b>` : `${pctPart(x.a.shareP)} <span aria-hidden="true">→</span> <b>${pctPart(x.a.share)}</b>`}</span>
        <span class="mv-var">${tipo === "lider" ? (x.n === 1 ? '<span class="nota">única seguradora</span>' : ppSeta(x.a.dShare)) : ppSeta(x.a.dShare)}</span>
      </button></li>`;
    const coluna = (tit, help, lst, tipo, vazio) => `
      <div class="mv-col">
        <h3>${tit} ${help}</h3>
        ${lst.length ? `<ul>${lst.map((x) => item(x, tipo)).join("")}</ul>` : `<p class="mv-vazio">${vazio}</p>`}
      </div>`;
    const movimentos = `
      <section class="movs" aria-labelledby="h-mov">
        <h2 id="h-mov" class="sec-tit">Movimentos de participação</h2>
        <div class="mv-grade">
          ${coluna("Onde a Akad lidera", ajuda("lider", "liderança"), lidera, "lider", "A Akad não lidera nenhuma linha no período.")}
          ${coluna("Maiores ganhos", ajuda("pp", "variação em pontos percentuais"), ganhos, "g", "Nenhuma linha ganhou participação no período.")}
          ${coluna("Maiores perdas", "", perdas, "p", "Nenhuma linha perdeu participação no período.")}
        </div>
      </section>`;

    // C. Barras horizontais de participação
    const ord = S.geralOrd || "share";
    const comA = linhas.filter((x) => x.temAkad);
    const semA = linhas.filter((x) => !x.temAkad);
    const cmp = {
      share: (p, q) => (q.a.share || 0) - (p.a.share || 0),
      ganho: (p, q) => (q.a.dShare ?? -1e9) - (p.a.dShare ?? -1e9),
      perda: (p, q) => (p.a.dShare ?? 1e9) - (q.a.dShare ?? 1e9),
      pos: (p, q) => (p.a.pos || 999) - (q.a.pos || 999) || (q.a.share || 0) - (p.a.share || 0),
    }[ord];
    const barrasLinhas = [...comA.sort(cmp), ...semA];
    // Escala sem distorção: linhas com ~100% (monopólio, como DPEM) não definem o eixo
    const base = [];
    linhas.forEach((x) => { if (x.a.share != null && x.a.share < 99.5) base.push(x.a.share); if (x.a.shareP != null && x.a.shareP < 99.5) base.push(x.a.shareP); });
    const passoEsc = niceMax((Math.max(1, ...base) * 1.05) / 4);
    const escMax = passoEsc * 4;
    const W = (v) => Math.min(100, (v / escMax) * 100);
    const ticks = [0, 1, 2, 3, 4].map((f) => passoEsc * f);
    const ordBtn = (k, rot) => `<button type="button" data-ord="${k}" aria-pressed="${ord === k}">${rot}</button>`;
    const barRow = (x) => {
      const a = x.a;
      const est = a.share != null && a.share >= escMax;
      const estP = a.shareP != null && a.shareP >= escMax;
      const sel = S.geralSel === x.l.id ? " sel" : "";
      if (!x.temAkad) {
        return `<li><button type="button" class="pb sem${sel}" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: Akad sem prêmio no período. Abrir detalhe">
          <span class="pb-nome"><b>${esc(x.l.nome)}</b><small>${x.l.ramos.join(", ")}</small></span>
          <span class="pb-track"><span class="pb-semtxt">Akad sem prêmio no período${x.n ? ` · ${x.n} seguradoras com prêmio` : " · sem dados de mercado"}</span></span>
          <span class="pb-val">–</span><span class="pb-var">${ppSeta(null)}</span><span class="pb-pos"><span class="chip">sem prêmio</span></span>
        </button></li>`;
      }
      return `<li><button type="button" class="pb${sel}" data-linha="${x.l.id}" aria-label="${esc(x.l.nome)}: participação ${pctPart(a.share)}, variação ${a.dShare == null ? "sem comparação" : nf1.format(a.dShare) + " pontos percentuais"}, posição ${a.pos} de ${x.n}. Abrir detalhe">
        <span class="pb-nome"><b>${esc(x.l.nome)}</b><small>${x.l.ramos.join(", ")}</small></span>
        <span class="pb-track">
          <span class="pb-fill${est ? " est" : ""}" style="width:${W(a.share || 0)}%"></span>
          ${a.shareP != null ? `<span class="pb-ant${estP ? " est" : ""}" style="left:${W(a.shareP)}%" title="${perP}: ${pctPart(a.shareP)}"></span>` : ""}
          ${est ? `<span class="pb-quebra">${x.n === 1 ? "única seguradora no ramo" : "fora da escala"}</span>` : ""}
        </span>
        <span class="pb-val">${pctPart(a.share)}</span>
        <span class="pb-var">${ppSeta(a.dShare)}</span>
        <span class="pb-pos">${chipPos(a.pos, x.n)} ${movHtml(a.pos, a.posP)}</span>
      </button></li>`;
    };
    const grafico = `
      <section class="pbar" aria-labelledby="h-pbar">
        <div class="sec-cab">
          <div>
            <h2 id="h-pbar" class="sec-tit">Participação por linha de produto</h2>
            <p class="nota">Barra = participação em ${per}. Traço = participação em ${perP || "período anterior (sem dados)"}. Clique numa linha para abrir o detalhe.</p>
          </div>
          <div class="ctrl-ord"><span class="rot">Ordenar por</span>
            <div class="seg-ctrl" role="group" aria-label="Ordenar gráfico">
              ${ordBtn("share", "Participação")}${ordBtn("ganho", "Maior ganho")}${ordBtn("perda", "Maior perda")}${ordBtn("pos", "Posição")}
            </div>
          </div>
        </div>
        <div class="pb-cab" aria-hidden="true">
          <span>Linha</span>
          <span class="pb-eixo">${ticks.map((t) => `<i style="left:${(t / escMax) * 100}%">${nf0.format(t)}%</i>`).join("")}</span>
          <span class="n">Atual</span><span class="n">Variação</span><span>Posição</span>
        </div>
        <ul class="pb-lista">${barrasLinhas.map(barRow).join("")}</ul>
        <p class="legenda-pb"><span class="lg-fill"></span> participação atual <span class="lg-ant"></span> participação no período de comparação · <span aria-hidden="true">▲▼</span> variação em p.p. · ▲▼ ao lado da posição = movimento no ranking</p>
      </section>`;

    // D. Tabela analítica
    const T = S.geralTab || { col: "pos", dir: 1 };
    const val = (x, c) => ({
      nome: x.l.nome, pos: x.a.pos, mov: x.dPos, share: x.a.share, dShare: x.a.dShare, pe: x.temAkad ? x.a.pe : null,
      cresc: x.a.cresc, mercado: x.mercado, crescM: x.crescM, refShare: x.refInfo ? x.refInfo.share : null,
    }[c]);
    const tab = [...linhas].sort((p, q) => {
      if (T.col === "nome") return p.l.nome.localeCompare(q.l.nome, "pt-BR") * T.dir;
      const va = val(p, T.col), vb = val(q, T.col);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * T.dir || ((q.a.share || 0) - (p.a.share || 0));
    });
    const th = (c, rot, cls = "", h = "") => `<th class="ord ${cls}" data-col="${c}" ${T.col === c ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">${rot}</button>${h}</th>`;
    const tabela = `
      <section class="tab-an" aria-labelledby="h-tab">
        <div class="sec-cab">
          <div>
            <h2 id="h-tab" class="sec-tit">Tabela analítica</h2>
            <p class="nota">Todas as linhas e indicadores. Clique no título de uma coluna para ordenar e no nome da linha para abrir o detalhe.</p>
          </div>
        </div>
        <div class="tab-wrap"><table class="tg">
          <thead>
            <tr class="grupo">
              <th rowspan="2" class="ord ${T.col === "nome" ? "" : ""}" data-col="nome" ${T.col === "nome" ? `aria-sort="${T.dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button">Linha</button></th>
              <th colspan="2" class="g">Posição Akad ${ajuda("pos", "posição")}</th>
              <th colspan="2" class="g">Participação ${ajuda("share", "participação")}</th>
              <th colspan="2" class="g">Prêmio emitido Akad ${ajuda("cresc", "crescimento")}</th>
              <th colspan="2" class="g">Mercado</th>
              <th colspan="2" class="g">Referência ${ajuda("ref", "seguradora de referência")}</th>
            </tr>
            <tr>
              ${th("pos", "Lugar", "n")}${th("mov", "Mov.", "n")}
              ${th("share", "Atual", "n g1")}${th("dShare", "Var. p.p.", "n")}
              ${th("pe", "Valor", "n g1")}${th("cresc", "Cresc.", "n")}
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
              <td class="n">${crescNeutro(x.a.cresc)}${vsMercado(x.a.cresc, x.crescM)}</td>
              <td class="n g1">${x.mercado > 0 ? reais(x.mercado) : '<span class="sub-i">sem dados</span>'}</td>
              <td class="n">${crescNeutro(x.crescM)}</td>
              <td class="g1">${x.ref ? `${esc(nomeEnt(x.ref))} <span class="sub">${x.lider === AKAD ? "vice-líder" : "líder"}</span>` : '<span class="sub-i">não há outra seguradora</span>'}</td>
              <td class="n">${x.refInfo ? pctPart(x.refInfo.share) : "–"}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <p class="nota leg-tab">– sem base de comparação ou não se aplica · "sem prêmio" = a Akad não emitiu prêmio positivo na linha no período · "&lt; 0,1%" = participação positiva, mas abaixo de 0,1% · crescimento em cinza neutro: crescer não é bom nem ruim por si só, o que indica ganho competitivo é a variação de participação.</p>
      </section>`;

    el.innerHTML = contexto + panorama + movimentos + grafico + tabela;

    // Interações: um clique em qualquer linha (destaques, gráfico ou tabela) abre o detalhe
    el.querySelectorAll(".mv-item, .pb, .lk").forEach((b) => b.addEventListener("click", () => abrirLinha(b.dataset.linha || b.dataset.abrir)));
    el.querySelectorAll("tbody tr[data-linha]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button")) abrirLinha(tr.dataset.linha); }));
    // Destaque sincronizado entre gráfico e tabela
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
    if (sel.startsWith("r:")) return [IDX.ramoIdx[sel.slice(2)]];
    return IDX.linhaPorId[sel].idx;
  }
  function nomeSel(sel) {
    if (sel.startsWith("r:")) { const c = sel.slice(2); return `${c} ${D.ramos[IDX.ramoIdx[c]][1]}`; }
    return IDX.linhaPorId[sel].nome;
  }
  function opcoesLinhas(sel, comTodas) {
    let h = comTodas ? `<option value="todas" ${sel === "todas" ? "selected" : ""}>Todos os ${D.ramos.length} ramos</option>` : "";
    for (const l of IDX.linhas) {
      h += `<option value="${l.id}" ${sel === l.id ? "selected" : ""}>${esc(l.nome)}</option>`;
      if (l.ramos.length > 1) for (const c of l.ramos) {
        const v = "r:" + c;
        h += `<option value="${v}" ${sel === v ? "selected" : ""}>   ${c} ${esc(D.ramos[IDX.ramoIdx[c]][1])}</option>`;
      }
    }
    return h;
  }

  function renderLinhas() {
    const P = periodo();
    const el = $("#aba-linhas");
    const ramos = ramosDaSel(S.linhaSel);
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
          <h2>${esc(nomeSel(S.linhaSel))}</h2>
          <p>${ramos.map((i) => esc(D.ramos[i][0] + " " + D.ramos[i][1])).join(" · ")}</p>
        </div>
        <div class="ctrl">
          <div class="campo"><label for="f-linha">Linha ou ramo</label><select id="f-linha">${opcoesLinhas(S.linhaSel, false)}</select></div>
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
              <th class="n ord" data-col="pos">#</th><th>${S.visao === "grupo" ? "Grupo / seguradora" : "Seguradora"}</th>
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
      S.concSel = tr.dataset.ent;
      S.concLinha = S.linhaSel;
      irPara("conc");
    }));
    $("#f-linha").addEventListener("change", (e) => { S.linhaSel = e.target.value; renderLinhas(); });

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
  function concorrentePadrao(P) {
    const cont = new Map();
    for (const l of IDX.linhas) {
      const R = resumo(l.idx, P);
      if (!R.cur.has(AKAD)) continue;
      R.rk.filter((k) => k !== AKAD).slice(0, 5).forEach((k, i) => cont.set(k, (cont.get(k) || 0) + 5 - i));
    }
    return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  function renderConc() {
    const P = periodo();
    const el = $("#aba-conc");
    const RT = resumo(IDX.todos, P);
    const ents = RT.rk.filter((k) => k !== AKAD);
    if (!S.concSel || !IDX.nome.has(S.concSel) || S.concSel === AKAD) S.concSel = concorrentePadrao(P) || ents[0];
    const k = S.concSel;
    const ramosSel = S.concLinha === "todas" ? IDX.todos : ramosDaSel(S.concLinha);
    const Rsel = resumo(ramosSel, P);
    const c = infoEnt(Rsel, k), a = infoEnt(Rsel, AKAD);

    const porLinha = IDX.linhas.map((l) => {
      const R = resumo(l.idx, P);
      return { l, c: infoEnt(R, k), a: infoEnt(R, AKAD), n: R.rk.length };
    }).filter((x) => x.c.pe > 0 || x.a.pe > 0);
    const frente = porLinha.filter((x) => x.c.pe > 0 && x.a.pe > 0);
    const concFrente = frente.filter((x) => (x.c.pos || 999) < (x.a.pos || 999)).length;

    // opções: concorrentes ordenados pelo prêmio nos ramos acompanhados
    const opts = ents.map((e) => `<option value="${esc(e)}" ${e === k ? "selected" : ""}>${esc(nomeEnt(e))}</option>`).join("");

    el.innerHTML = `
      <div class="cab-aba">
        <div>
          <h2>${esc(nomeEnt(k))} × Akad</h2>
          <p>Como o concorrente está crescendo e onde disputa com a Akad, ${periodoLabel(P.a, P.b)}.</p>
        </div>
        <div class="ctrl">
          <div class="campo"><label for="f-conc">Concorrente</label><select id="f-conc">${opts}</select></div>
          <div class="campo"><label for="f-conc-linha">Linha ou ramo</label><select id="f-conc-linha">${opcoesLinhas(S.concLinha, true)}</select></div>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="rot">Prêmio ${esc(nomeEnt(k))}</span><span class="val">${reais(c.pe)}</span><span class="det">${varHtml(c.cresc)} contra o ano anterior</span></div>
        <div class="kpi destaque"><span class="rot">Prêmio Akad</span><span class="val">${reais(a.pe)}</span><span class="det">${varHtml(a.cresc)} contra o ano anterior</span></div>
        <div class="kpi"><span class="rot">Participação do concorrente</span><span class="val">${pct(c.share)}</span><span class="det">${ppHtml(c.dShare)} · Akad: ${pct(a.share)} (${ppHtml(a.dShare)})</span></div>
        <div class="kpi"><span class="rot">Disputa direta</span><span class="val">${frente.length - concFrente} de ${frente.length}</span><span class="det">linhas em que a Akad está à frente</span></div>
      </div>
      <div class="grade">
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Prêmio emitido, 12 meses móveis</h2><p class="nota">${esc(S.concLinha === "todas" ? `Todos os ${D.ramos.length} ramos acompanhados` : nomeSel(S.concLinha))}. Área sombreada = período selecionado.</p></div>
          <div class="graf" id="g-conc"></div>
        </div>
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Linha a linha</h2><p class="nota">Só linhas em que pelo menos um dos dois tem prêmio no período.</p></div>
          <div class="tab-wrap"><table>
            <thead><tr>
              <th>Linha</th>
              <th class="n">${esc(nomeEnt(k))}</th><th class="n">Cresc.</th><th class="n">Part.</th><th>Posição</th>
              <th class="n">Akad</th><th class="n">Cresc.</th><th class="n">Part.</th><th>Posição</th>
              <th>Quem está à frente</th>
            </tr></thead>
            <tbody>${porLinha.map((x) => {
              const af = (x.a.pos || 999) < (x.c.pos || 999);
              return `<tr>
                <td class="nome"><b>${esc(x.l.nome)}</b></td>
                <td class="n">${x.c.pe > 0 ? reais(x.c.pe) : "–"}</td><td class="n">${varHtml(x.c.cresc)}</td><td class="n">${pct(x.c.share)}</td><td>${chipPos(x.c.pos)}${deltaPos(x.c.pos, x.c.posP)}</td>
                <td class="n">${x.a.pe > 0 ? reais(x.a.pe) : "–"}</td><td class="n">${varHtml(x.a.cresc)}</td><td class="n">${pct(x.a.share)}</td><td>${chipPos(x.a.pos)}${deltaPos(x.a.pos, x.a.posP)}</td>
                <td>${!(x.c.pe > 0) ? "Só a Akad atua" : !(x.a.pe > 0) ? "Só o concorrente atua" : af ? '<span class="chip lider">Akad</span>' : '<span class="chip top">Concorrente</span>'}</td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>
        </div>
        <div class="bloco c12">
          <div class="bloco-cab"><h2>Onde o concorrente vende</h2><p class="nota" id="nota-uf-conc"></p></div>
          <div id="t-uf-conc"></div>
        </div>
      </div>`;

    $("#f-conc").addEventListener("change", (e) => { S.concSel = e.target.value; renderConc(); });
    $("#f-conc-linha").addEventListener("change", (e) => { S.concLinha = e.target.value; renderConc(); });

    const sm = serieMensal(ramosSel, [k, AKAD]);
    linhas($("#g-conc"), {
      series: [
        { nome: nomeEnt(k), cor: css("--s1"), valores: movel12(Array.from(sm.ent.get(k))) },
        { nome: "Akad", cor: css("--akad"), valores: movel12(Array.from(sm.ent.get(AKAD))), grossa: true },
      ],
      banda: [P.a, P.b], inicio: 11, fmt: reais, fmtEixo: reaisCurto, rotulo: "Prêmio em 12 meses móveis",
      tituloTip: (i) => `12 meses até ${mesLabel(i, true)}`,
    });

    // UF do concorrente (base anual do ano final do período)
    const ano = +D.meses[P.b].slice(0, 4);
    const ult = D.meses[D.meses.length - 1];
    const parc = ano === +ult.slice(0, 4) && !ult.endsWith("12") ? ` (jan–${MESES_PT[+ult.slice(4) - 1]})` : "";
    const porUf = new Map();
    for (const ri of ramosSel) for (const r of IDX.ufaPorRamo[ri]) {
      if (r[0] !== ano) continue;
      const e = IDX.chave[r[3]];
      if (e !== k && e !== AKAD) {
        const x = porUf.get(r[2]) || [0, 0, 0]; x[2] += r[4]; porUf.set(r[2], x); continue;
      }
      const x = porUf.get(r[2]) || [0, 0, 0];
      if (e === k) x[0] += r[4]; else x[1] += r[4];
      x[2] += r[4];
      porUf.set(r[2], x);
    }
    const lst = [...porUf.entries()].filter(([, x]) => x[0] > 0).sort((p, q) => q[1][0] - p[1][0]).slice(0, 10);
    const totC = [...porUf.values()].reduce((s, x) => s + x[0], 0);
    $("#nota-uf-conc").textContent = `10 estados com mais prêmio direto do concorrente em ${ano}${parc}. Fonte: SES por UF.`;
    $("#t-uf-conc").innerHTML = lst.length ? `<div class="tab-wrap"><table>
      <thead><tr><th>UF</th><th class="n">${esc(nomeEnt(k))}</th><th class="n">% do concorrente</th><th class="n">Part. no estado</th><th class="n">Akad</th><th class="n">Part. Akad no estado</th></tr></thead>
      <tbody>${lst.map(([u, x]) => `<tr><td><b>${D.ufs[u]}</b></td><td class="n">${reais(x[0])}</td><td class="n">${pct(totC > 0 ? (x[0] / totC) * 100 : null)}</td><td class="n">${pct(x[2] > 0 ? (x[0] / x[2]) * 100 : null)}</td><td class="n">${reais(x[1])}</td><td class="n">${pct(x[2] > 0 ? (x[1] / x[2]) * 100 : null)}</td></tr>`).join("")}</tbody>
    </table></div>` : '<p class="vazio">Sem dados por estado para este concorrente.</p>';
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
    const ramos = S.ufLinha === "todas" ? IDX.todos : ramosDaSel(S.ufLinha);
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
          <div class="campo"><label for="f-uf-linha">Linha ou ramo</label><select id="f-uf-linha">${opcoesLinhas(S.ufLinha, true)}</select></div>
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
    $("#f-uf-linha").addEventListener("change", (e) => { S.ufLinha = e.target.value; renderUF(); });

    const det = $("#uf-detalhe");
    const ui = sel != null ? sel : ord[0].i;
    const x = linhasUF[ui];
    const t = topUF(ui).slice(0, 8);
    const akPos = topUF(ui).findIndex((y) => y.e === AKAD);
    det.innerHTML = `
      <h3 style="font-size:1rem;margin-bottom:4px">${x.u}: maiores seguradoras em ${ano}${parc}</h3>
      <p class="nota" style="margin:0 0 10px">Mercado no período: ${reais(x.merc)} · Akad: ${reais(x.akad)} (${pct(x.share)})${akPos >= 0 ? ` · ${akPos + 1}º lugar no estado` : ""}</p>
      ${t.length ? `<div class="tab-wrap"><table><thead><tr><th class="n">#</th><th>${S.visao === "grupo" ? "Grupo / seguradora" : "Seguradora"}</th><th class="n">Prêmio</th><th class="n">Part.</th></tr></thead>
      <tbody>${t.map((y, j) => `<tr class="${y.e === AKAD ? "akad" : ""}"><td class="n">${j + 1}</td><td class="nome">${esc(nomeEnt(y.e))}</td><td class="n">${reais(y.v)}</td><td class="n">${pct(y.s)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="vazio">Sem dados para este estado.</p>'}`;
  }

  /* ---------- Navegação e filtros ---------- */
  function irPara(aba) {
    S.aba = aba;
    document.querySelectorAll(".abas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
    document.querySelectorAll(".aba").forEach((s) => { s.hidden = s.id !== "aba-" + aba; });
    try { history.replaceState(null, "", "#" + aba); } catch (e) { /* ignora */ }
    render();
    window.scrollTo({ top: 0 });
  }
  function render() {
    const P = periodo();
    $("#periodo-txt").innerHTML = `<b>${periodoLabel(P.a, P.b)}</b>${P.pa != null ? ` comparado com ${periodoLabel(P.pa, P.pb)}` : " (sem comparativo)"}`;
    esconderTip();
    ({ geral: renderGeral, linhas: renderLinhas, conc: renderConc, uf: renderUF })[S.aba]();
  }

  function montarFiltros() {
    const anos = [...new Set(D.meses.map((m) => m.slice(0, 4)))];
    const ult = D.meses[D.meses.length - 1];
    const anosFechados = anos.filter((y) => D.meses.includes(y + "12"));
    S.ano = anosFechados[anosFechados.length - 1] || anos[anos.length - 1];
    $("#f-ano").innerHTML = anos.slice().reverse().map((y) => `<option value="${y}" ${y === S.ano ? "selected" : ""}>${y}${D.meses.includes(y + "12") ? "" : " (parcial)"}</option>`).join("");
    const optsMes = D.meses.map((m, i) => `<option value="${i}">${mesLabel(i, true)}</option>`).reverse().join("");
    $("#f-de").innerHTML = optsMes; $("#f-ate").innerHTML = optsMes;
    S.ate = D.meses.length - 1; S.de = Math.max(0, S.ate - 11);
    $("#f-de").value = S.de; $("#f-ate").value = S.ate;

    const sync = () => {
      $("#c-ano").hidden = S.periodo !== "ano";
      $("#c-de").hidden = S.periodo !== "custom";
      $("#c-ate").hidden = S.periodo !== "custom";
    };
    $("#f-periodo").addEventListener("change", (e) => { S.periodo = e.target.value; sync(); render(); });
    $("#f-ano").addEventListener("change", (e) => { S.ano = e.target.value; render(); });
    $("#f-de").addEventListener("change", (e) => { S.de = +e.target.value; render(); });
    $("#f-ate").addEventListener("change", (e) => { S.ate = +e.target.value; render(); });
    $("#f-visao").addEventListener("change", (e) => { S.visao = e.target.value; montarEntidades(); S.concSel = null; render(); });
    document.querySelectorAll(".abas button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.aba)));
    sync();

    const gerado = new Date(D.gerado);
    $("#fonte-resumo").textContent = `Dados do SES/SUSEP até ${mesLabel(D.meses.length - 1, true)} · atualizado em ${gerado.toLocaleDateString("pt-BR")}`;
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

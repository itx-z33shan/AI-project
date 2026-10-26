/* ==========================================================================
   CyberTrail · AI-Assisted Cyber Investigation Lab
   Application logic
   ========================================================================== */
"use strict";

const NS = "http://www.w3.org/2000/svg";
const ALGO_ORDER = ["bfs", "dfs", "ucs", "greedy", "astar", "hill"];

const ALGO_INFO = {
  bfs: {
    desc: "Breadth-First Search expands level by level using a FIFO queue. It reaches the target with the fewest links, but ignores review-effort differences.",
    frontier: "QUEUE (FIFO): ordered by discovery time · Uninformed search",
    gnf: "BFS does not evaluate cost. It expands in hop order, so g(n)/h(n)/f(n) are not used."
  },
  dfs: {
    desc: "Depth-First Search dives deep along one branch using a LIFO stack. It needs little memory but may find a longer, more costly route.",
    frontier: "STACK (LIFO): last discovered, first expanded · Uninformed search",
    gnf: "DFS does not evaluate cost. It follows one branch to a dead end before backtracking."
  },
  ucs: {
    desc: "Uniform-Cost Search expands the lowest accumulated effort g(n) first. For positive edge costs it finds the least-effort route.",
    frontier: "MIN-HEAP: ordered by g(n) = accumulated review effort · Uninformed search",
    gnf: "g(n) = accumulated review effort · h(n) = 0 · f(n) = g(n)"
  },
  greedy: {
    desc: "Greedy Best-First follows the heuristic h(n) — estimated hops to the goal — and ignores effort already spent.",
    frontier: "MIN-HEAP: ordered by h(n) = estimated hops to goal · Informed search",
    gnf: "g(n) = accumulated effort · h(n) = reverse hops × min cost · f(n) ignored by Greedy"
  },
  astar: {
    desc: "A* expands by f(n)=g(n)+h(n), balancing effort spent and estimated effort remaining. With an admissible heuristic it is optimal.",
    frontier: "MIN-HEAP: ordered by f(n) = g(n) + h(n) · Informed search",
    gnf: "g(n) = accumulated effort · h(n) = reverse hops × min cost · f(n) = g(n) + h(n)"
  },
  hill: {
    desc: "Hill Climbing only steps to a strictly closer neighbour. It is cheap but can stop at a local optimum or follow a decoy into a dead end.",
    frontier: "NEIGHBOUR SEARCH: pick the closest adjacent node · Local search",
    gnf: "No global frontier. It uses geometric proximity to the target, not g(n)/h(n)/f(n)."
  }
};

const COMPARISON = {
  bfs: { family: "Uninformed", eval: "FIFO queue by hop depth", optimal: "Fewest links", usesG: "No", notes: "Ignores edge costs" },
  dfs: { family: "Uninformed", eval: "LIFO stack (depth-first)", optimal: "No", usesG: "No", notes: "Low memory; path not optimal" },
  ucs: { family: "Uninformed", eval: "Min-heap by g(n)", optimal: "Yes (positive costs)", usesG: "Yes", notes: "Least accumulated effort" },
  greedy: { family: "Informed", eval: "Min-heap by h(n)", optimal: "No", usesG: "No", notes: "Goal-directed; can be costly" },
  astar: { family: "Informed", eval: "Min-heap by f = g + h", optimal: "Yes (admissible h)", usesG: "Yes", notes: "Balanced and optimal" },
  hill: { family: "Local", eval: "Closest neighbour", optimal: "No", usesG: "No", notes: "Can stall at a local optimum" }
};

const SPEED = { slow: 1400, medium: 650, fast: 220 };

/* ---------------- State ---------------- */
let scenarios = [];
let algorithms = {};
let scenario = null;
let results = {};
let selectedNodeId = null;
let activeAlgorithm = "astar";

let playbackTrace = [];
let playbackIndex = 0;
let isPlaying = false;
let playbackTimer = null;
let currentSpeed = "medium";
let currentRunResult = null;

let raceData = null, raceTimer = null, raceIndex = 0, racePlaying = false;
let challengeState = null;
let heatmapEnabled = false;

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const byId = id => scenario && scenario.nodes.find(n => n.id === id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function colorType(t) {
  return {
    "Alert": "#ed6974",
    "Identity": "#aa8bf5",
    "Critical Asset": "#48daab",
    "Server": "#51a9f5",
    "Endpoint": "#5eb2fc",
    "Process": "#f5af4c",
    "Network": "#55bed1"
  }[t] || "#5eb2fc";
}

function algoName(id) { return (algorithms[id] && algorithms[id].name) || id; }

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("is-visible"), 2800);
}

/* ---------------- Graph building ---------------- */
let _markerHost = null;
function ensureDefs() {
  if (_markerHost) return;
  const host = svgEl("svg");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const defs = svgEl("defs");
  const mk = (id, fill, w) => {
    const m = svgEl("marker", { id, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: w, markerHeight: w, orient: "auto" });
    m.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill }));
    defs.appendChild(m);
  };
  mk("arrow", "#3b5368", 5);
  mk("arrowChosen", "#2dd4bf", 6);
  mk("arrowRoute", "#5eead4", 6.5);
  mk("arrowRejected", "#fb7185", 6);
  host.appendChild(defs);
  document.body.appendChild(host);
  _markerHost = host;
}

function ensureZoomLayer(svg) {
  let zl = svg.querySelector("#zoomLayer");
  if (!zl) {
    zl = svgEl("g");
    zl.setAttribute("id", "zoomLayer");
    svg.insertBefore(zl, svg.querySelector(".edgesLayer") || null);
  }
  ["edgesLayer", "crossLayer", "nodesLayer"].forEach(cls => {
    const g = svg.querySelector("." + cls);
    if (g && g.parentNode !== zl) zl.appendChild(g);
  });
  return zl;
}

function buildGraph(svg, sc, opts) {
  opts = opts || {};
  ensureDefs();
  const zl = ensureZoomLayer(svg);
  const layers = {
    edges: svg.querySelector(".edgesLayer") || (() => { const g = svgEl("g", { class: "edgesLayer" }); zl.appendChild(g); return g; })(),
    cross: svg.querySelector(".crossLayer") || (() => { const g = svgEl("g", { class: "crossLayer" }); zl.appendChild(g); return g; })(),
    nodes: svg.querySelector(".nodesLayer") || (() => { const g = svgEl("g", { class: "nodesLayer" }); zl.appendChild(g); return g; })()
  };
  layers.edges.innerHTML = "";
  layers.cross.innerHTML = "";
  layers.nodes.innerHTML = "";

  const edgePaths = {};
  const edgeGeo = {};
  const nodesMap = Object.fromEntries(sc.nodes.map(n => [n.id, n]));

  sc.edges.forEach((e, idx) => {
    const a = nodesMap[e.from], b = nodesMap[e.to];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const x1 = a.x + ux * 49, y1 = a.y + uy * 25;
    const x2 = b.x - ux * 51, y2 = b.y - uy * 26;
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2 + (idx % 2 ? 9 : -9);
    const key = e.from + ">" + e.to;
    edgeGeo[key] = { x1, y1, x2, y2, midX, midY };

    const g = svgEl("g", { class: "edge-group" });
    const title = svgEl("title");
    title.textContent = `${e.relation} · review effort ${e.cost}m · confidence ${Math.round(e.confidence * 100)}%`;
    const path = svgEl("path", { class: "edge", d: `M${x1},${y1} L${x2},${y2}` });
    path.style.markerEnd = "url(#arrow)";
    const bg = svgEl("rect", { class: "edge-label-bg", x: midX - 12, y: midY - 7, width: 24, height: 14, rx: 4 });
    const label = svgEl("text", { class: "edge-label", x: midX, y: midY + 0.5 });
    label.textContent = e.cost + "m";
    g.append(title, path, bg, label);
    layers.edges.appendChild(g);
    edgePaths[key] = path;
  });

  const nodeRefs = {};
  sc.nodes.forEach(n => {
    const g = svgEl("g", { class: "node", transform: `translate(${n.x - 52}, ${n.y - 27})` });
    const title = svgEl("title");
    title.textContent = `${n.name} (${n.type})\n${n.detail}`;
    const rect = svgEl("rect", { width: 104, height: 54, rx: 9 });
    const dot = svgEl("circle", { cx: 16, cy: 17, r: 5, fill: colorType(n.type) });
    const nt = svgEl("text", { class: "n-title", x: 55, y: 26 });
    nt.textContent = n.name;
    const ty = svgEl("text", { class: "n-type", x: 55, y: 42 });
    ty.textContent = n.type;
    const src = svgEl("text", { x: 4, y: -7, fill: "#2dd4bf", "font-size": 8.5, "font-weight": 800 });
    src.textContent = "SOURCE"; src.style.display = "none";
    const tgt = svgEl("text", { x: 52, y: -7, fill: "#a78bf5", "font-size": 8.5, "font-weight": 800, "text-anchor": "middle" });
    tgt.textContent = "TARGET"; tgt.style.display = "none";
    const radar = svgEl("circle", { class: "expanding-radar", cx: 52, cy: 27, r: 45 });
    radar.style.display = "none";
    g.append(title, rect, dot, nt, ty, src, tgt, radar);
    if (opts.onNodeClick) g.style.cursor = "pointer";
    g.addEventListener("click", () => opts.onNodeClick && opts.onNodeClick(n.id));
    layers.nodes.appendChild(g);
    nodeRefs[n.id] = { g, rect, radar, src, tgt, id: n.id };
  });

  svg._graph = { sc, edgePaths, edgeGeo, nodeRefs, layers, minCost: sc.edges.length ? Math.min(...sc.edges.map(e => Number(e.cost))) : 1 };
  return svg._graph;
}

/* ---------------- Frame rendering ---------------- */
function renderFrame(svg, frame, opts) {
  opts = opts || {};
  const cache = svg._graph;
  if (!cache) return;
  const { edgePaths, edgeGeo, nodeRefs, layers } = cache;
  const startId = opts.startId;
  const goalId = opts.goalId;

  const finalSet = new Set();
  const fr = frame.finalRoute;
  if (fr && fr.length > 1) for (let i = 0; i < fr.length - 1; i++) finalSet.add(fr[i] + ">" + fr[i + 1]);

  cache.sc.edges.forEach(e => {
    const key = e.from + ">" + e.to;
    const path = edgePaths[key];
    if (!path) return;
    const ev = frame.edgeStates ? frame.edgeStates[key] : null;
    let cls = "edge";
    let marker = "url(#arrow)";
    if (finalSet.has(key)) { cls = "edge final-route"; marker = "url(#arrowRoute)"; }
    else if (ev) {
      if (ev.decision === "rejected") { cls = "edge rejected"; marker = "url(#arrowRejected)"; }
      else if (ev.decision === "chosen") { cls = "edge chosen"; marker = "url(#arrowChosen)"; }
    }
    path.setAttribute("class", cls);
    path.style.markerEnd = marker;
  });

  layers.cross.innerHTML = "";
  cache.sc.edges.forEach(e => {
    const key = e.from + ">" + e.to;
    if (finalSet.has(key)) return;
    const ev = frame.edgeStates ? frame.edgeStates[key] : null;
    if (!ev || !edgeGeo[key]) return;
    if (ev.decision === "rejected") renderRejectedMarker(layers.cross, edgeGeo[key].midX, edgeGeo[key].midY, ev.reason, e, svg.id);
    else if (ev.decision === "chosen") renderChosenMarker(layers.cross, edgeGeo[key].midX, edgeGeo[key].midY, ev.reason, e);
  });

  cache.sc.nodes.forEach(n => {
    const ref = nodeRefs[n.id];
    if (!ref) return;
    let cls = "node";
    if (n.id === startId) cls += " source";
    if (n.id === goalId) cls += " target";
    if (opts.selectedId === n.id) cls += " selected";
    if (frame.exploredNodes && frame.exploredNodes.has(n.id)) cls += " explored";
    if (frame.finalRoute && frame.finalRoute.includes(n.id)) cls += " onroute";
    ref.g.setAttribute("class", cls);
    ref.src.style.display = n.id === startId ? "" : "none";
    ref.tgt.style.display = n.id === goalId ? "" : "none";
    ref.radar.style.display = frame.expandingNode === n.id ? "" : "none";
  });

  if (opts.heatmap) applyHeatmap(cache, goalId);
  else clearHeatmap(cache);
}

function renderRejectedMarker(container, cx, cy, reason, edge, svgId) {
  const g = svgEl("g", { class: "cross-group" });
  let short = reason || "Pruned / suboptimal";
  if (short.length > 34) short = short.slice(0, 32) + "…";
  const w = Math.max(94, short.length * 5.7 + 24);
  const half = w / 2;
  const pillY = cy > 280 ? -18 : 22;
  g.innerHTML =
    `<circle class="cross-badge-circle" cx="${cx}" cy="${cy}" r="9"/>` +
    `<line class="cross-line" x1="${cx - 3.6}" y1="${cy - 3.6}" x2="${cx + 3.6}" y2="${cy + 3.6}"/>` +
    `<line class="cross-line" x1="${cx + 3.6}" y1="${cy - 3.6}" x2="${cx - 3.6}" y2="${cy + 3.6}"/>` +
    `<g transform="translate(${cx}, ${cy + pillY})">` +
    `<rect class="reason-pill-bg" x="${-half}" y="-9" width="${w}" height="18" rx="9"/>` +
    `<text class="reason-pill-text" x="0" y="0">✕ ${esc(short)}</text></g>` +
    `<title>REJECTED LINK: ${esc(edge.from)} → ${esc(edge.to)}\nReason: ${esc(reason)}\nReview cost: ${edge.cost}m</title>`;
  container.appendChild(g);
}

function renderChosenMarker(container, cx, cy, reason, edge) {
  const g = svgEl("g", { class: "cross-group" });
  let short = reason || "Active branch";
  if (short.length > 32) short = short.slice(0, 30) + "…";
  const w = Math.max(82, short.length * 5.6 + 24);
  const half = w / 2;
  const pillY = cy > 280 ? 22 : -18;
  g.innerHTML =
    `<g transform="translate(${cx}, ${cy + pillY})">` +
    `<rect class="chosen-pill-bg" x="${-half}" y="-9" width="${w}" height="18" rx="9"/>` +
    `<text class="chosen-pill-text" x="0" y="0">✔ ${esc(short)}</text></g>` +
    `<title>CHOSEN BRANCH: ${esc(edge.from)} → ${esc(edge.to)}\nReason: ${esc(reason)}</title>`;
  container.appendChild(g);
}

/* ---------------- Heatmap ---------------- */
function hopDistances(sc, goalId) {
  const incoming = {};
  sc.nodes.forEach(n => incoming[n.id] = []);
  sc.edges.forEach(e => incoming[e.to].push(e.from));
  const dist = {};
  if (!(goalId in incoming)) return dist;
  dist[goalId] = 0;
  const q = [goalId];
  while (q.length) {
    const c = q.shift();
    for (const p of incoming[c]) if (!(p in dist)) { dist[p] = dist[c] + 1; q.push(p); }
  }
  return dist;
}

function heatColor(hops, maxH) {
  const t = maxH > 0 ? Math.min(1, hops / maxH) : 0; // 0 = goal, 1 = farthest
  const hue = 20 + 155 * t; // warm (red) at goal → cool (teal) far away
  return `hsl(${hue.toFixed(0)} 68% 55%)`;
}

function applyHeatmap(cache, goalId) {
  const dist = hopDistances(cache.sc, goalId);
  const vals = Object.values(dist);
  const maxH = vals.length ? Math.max(...vals) : 0;
  for (const ref of Object.values(cache.nodeRefs)) ref.rect.style.fill = heatColor(dist.get(ref.id) || 0, maxH);
}

function clearHeatmap(cache) {
  for (const ref of Object.values(cache.nodeRefs)) ref.rect.style.fill = "";
}

/* ---------------- Zoom & pan ---------------- */
function initZoom(svg) {
  if (svg._zoomInit) return;
  svg._zoomInit = true;
  const zl = () => svg.querySelector("#zoomLayer");
  svg._zoom = { scale: 1, tx: 0, ty: 0 };
  const apply = () => {
    const z = svg._zoom, layer = zl();
    if (layer) layer.setAttribute("transform", `translate(${z.tx.toFixed(2)},${z.ty.toFixed(2)}) scale(${z.scale.toFixed(3)})`);
  };
  svg._applyZoom = apply;
  const clamp = v => Math.max(0.6, Math.min(3, v));
  const zoomBy = factor => {
    const z = svg._zoom, old = z.scale, nz = clamp(old * factor);
    z.tx = 560 - (560 - z.tx) * (nz / old);
    z.ty = 285 - (285 - z.ty) * (nz / old);
    z.scale = nz;
    apply();
  };
  svg._zoomBy = zoomBy;
  $("zoomInBtn").addEventListener("click", () => zoomBy(1.2));
  $("zoomOutBtn").addEventListener("click", () => zoomBy(1 / 1.2));
  $("zoomResetBtn").addEventListener("click", () => { svg._zoom = { scale: 1, tx: 0, ty: 0 }; apply(); });

  let dragging = false, startX = 0, startY = 0, moved = false, startTx = 0, startTy = 0;
  svg.addEventListener("mousedown", ev => {
    if (ev.button !== 0) return;
    dragging = true; moved = false;
    startX = ev.clientX; startY = ev.clientY;
    startTx = svg._zoom.tx; startTy = svg._zoom.ty;
    svg.classList.add("is-dragging");
  });
  window.addEventListener("mousemove", ev => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const k = 1120 / (rect.width || 1120);
    const dx = (ev.clientX - startX) * k, dy = (ev.clientY - startY) * k;
    if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
    svg._zoom.tx = startTx + dx; svg._zoom.ty = startTy + dy;
    apply();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    svg.classList.remove("is-dragging");
  });
  // suppress click-to-inspect after a drag
  svg.addEventListener("click", ev => { if (moved) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  svg.classList.add("zoomable");
}

/* ---------------- Init ---------------- */
async function init() {
  try {
    const [sRes, aRes] = await Promise.all([fetch("/api/scenarios"), fetch("/api/algorithms")]);
    scenarios = await sRes.json();
    algorithms = await aRes.json();
    scenario = scenarios[0];

    $("scenario").innerHTML = scenarios.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");

    // strategy chips
    $("algorithmChips").innerHTML = ALGO_ORDER.filter(a => algorithms[a]).map(a =>
      `<button type="button" class="chip${a === activeAlgorithm ? " is-active" : ""}" data-algo="${a}">
        <span>${esc(algoName(a))}</span><span class="chip-fam">${esc(algorithms[a].family)}</span>
      </button>`).join("");
    $("algorithmChips").querySelectorAll(".chip").forEach(c =>
      c.addEventListener("click", () => setActiveAlgorithm(c.dataset.algo)));

    // race selects
    const opts = ALGO_ORDER.filter(a => algorithms[a]).map(a => `<option value="${a}">${esc(algoName(a))}</option>`).join("");
    $("raceA").innerHTML = opts; $("raceB").innerHTML = opts;
    $("raceA").value = "astar"; $("raceB").value = "bfs";

    buildGraph($("graph"), scenario, { onNodeClick: inspect });
    buildGraph($("graphInternals"), scenario, {});
    initZoom($("graph"));
    renderScenario();
    renderComparisonTable();
    setupTabs();
    setupKeyboard();
    setupModals();
    setActiveAlgorithm(activeAlgorithm);
    updateCaseFile();
  } catch (e) {
    toast("Unable to load: " + e.message);
  }
}

function renderComparisonTable() {
  const body = $("comparisonTable").querySelector("tbody");
  body.innerHTML = ALGO_ORDER.filter(a => algorithms[a]).map(a => {
    const c = COMPARISON[a];
    return `<tr>
      <td><span class="algoname">${esc(algoName(a))}</span></td>
      <td><span class="fam">${esc(c.family)}</span></td>
      <td>${esc(c.eval)}</td>
      <td>${esc(c.optimal)}</td>
      <td>${c.usesG}</td>
      <td style="white-space:normal">${esc(c.notes)}</td>
    </tr>`;
  }).join("");
}

function renderScenario() {
  selectedNodeId = null;
  const sSel = $("startNode"), gSel = $("goalNode");
  const opts = scenario.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)} · ${esc(n.type)}</option>`).join("");
  sSel.innerHTML = opts; gSel.innerHTML = opts;
  sSel.value = scenario.start; gSel.value = scenario.goal;
  $("graphTitle").textContent = scenario.name;
  $("graphDescription").textContent = scenario.description;
  resetPlayback();
  updateTags();
  updateCaseFile();
  $("inspector").innerHTML = "<strong>Click a node in the graph</strong><p>Inspect its telemetry metadata and quickly set it as source or target.</p>";
  renderStaticGraph();
}

function updateTags() {
  const s = byId($("startNode").value), g = byId($("goalNode").value);
  $("startTag").textContent = "SOURCE: " + (s ? s.name.toUpperCase() : "—");
  $("goalTag").textContent = "TARGET: " + (g ? g.name.toUpperCase() : "—");
}

function updateCaseFile() {
  const s = byId($("startNode").value), g = byId($("goalNode").value);
  $("caseFileText").textContent = `${scenario.name} · ${s ? s.name : "?"} → ${g ? g.name : "?"}`;
}

function renderStaticGraph() {
  const frame = { exploredNodes: new Set([$("startNode").value]), expandingNode: null, edgeStates: {}, finalRoute: null };
  renderFrame($("graph"), frame, { startId: $("startNode").value, goalId: $("goalNode").value, selectedId: selectedNodeId });
  renderFrame($("graphInternals"), frame, { startId: $("startNode").value, goalId: $("goalNode").value, heatmap: heatmapEnabled });
}

/* ---------------- Algorithm selection ---------------- */
function setActiveAlgorithm(alg) {
  if (!algorithms[alg]) return;
  activeAlgorithm = alg;
  $("algorithmChips").querySelectorAll(".chip").forEach(c => c.classList.toggle("is-active", c.dataset.algo === alg));
  $("algInfo").textContent = ALGO_INFO[alg].desc;
  const r = results[alg];
  if (r) { displayMetrics(r); showResults(); }
  else $("mAlgo").textContent = algoName(alg);
  if (r && r.trace) setupPlayback(r.trace, r);
  else if (playbackTrace.length === 0) renderStaticGraph();
}

/* ---------------- Playback ---------------- */
function getFrameForStep(res, stepIndex) {
  const startId = $("startNode").value;
  const explored = new Set([startId]);
  const edgeStates = {};
  const trace = (res && res.trace) || [];
  const maxIdx = Math.min(Math.max(0, stepIndex), trace.length - 1);
  for (let i = 0; i <= maxIdx; i++) {
    const s = trace[i];
    if (s && s.node) explored.add(s.node);
    if (s && s.evaluations) s.evaluations.forEach(ev => { edgeStates[ev.from + ">" + ev.to] = ev; });
  }
  const complete = trace.length > 0 && stepIndex >= trace.length - 1;
  return {
    exploredNodes: explored,
    expandingNode: complete ? null : trace[maxIdx] && trace[maxIdx].node,
    edgeStates,
    finalRoute: (complete && res && res.found) ? res.path : null
  };
}

function setupPlayback(trace, result) {
  playbackTrace = trace || [];
  currentRunResult = result;
  playbackIndex = 0;
  $("videoScrubber").max = Math.max(0, playbackTrace.length - 1);
  $("videoScrubber").value = 0;
  renderPlaybackStep(0);
  videoPlay();
}

function renderPlaybackStep(idx) {
  if (!playbackTrace.length) return;
  playbackIndex = Math.max(0, Math.min(idx, playbackTrace.length - 1));
  const step = playbackTrace[playbackIndex];
  const frame = getFrameForStep(currentRunResult, playbackIndex);
  const startId = $("startNode").value, goalId = $("goalNode").value;
  renderFrame($("graph"), frame, { startId, goalId, selectedId: selectedNodeId });
  renderFrame($("graphInternals"), frame, { startId, goalId, heatmap: heatmapEnabled });
  updateScrubberUI();
  updateTelemetryBanner(step, playbackIndex >= playbackTrace.length - 1);
  updateInternals(step);
}

function updateScrubberUI() {
  const total = playbackTrace.length;
  const cur = total ? playbackIndex + 1 : 0;
  $("stepCounter").textContent = `Step ${cur} / ${total}`;
  $("videoScrubber").value = playbackIndex;
  const badge = $("playbackBadge");
  if (isPlaying) { badge.textContent = "Playing"; badge.className = "status-badge"; }
  else if (total && playbackIndex >= total - 1) { badge.textContent = "Complete"; badge.className = "status-badge"; }
  else { badge.textContent = "Paused"; badge.className = "status-badge paused"; }
  const pb = $("btnPlayPause");
  pb.textContent = isPlaying ? "⏸ Pause" : "▶ Play";
  pb.classList.toggle("is-playing", isPlaying);
}

function updateTelemetryBanner(step, finalStep) {
  const textEl = $("telemetryText"), iconEl = $("telemetryIcon");
  if (finalStep) {
    if (currentRunResult && currentRunResult.found) {
      const goal = byId(currentRunResult.path.slice(-1)[0]);
      iconEl.textContent = "✓"; iconEl.style.color = "#4ade80"; iconEl.style.background = "rgba(74,222,128,.14)";
      textEl.innerHTML = `<b>Target reached.</b> Route verified to <b>${esc(goal ? goal.name : "")}</b> with <b>${currentRunResult.review_cost}m</b> review effort across <b>${currentRunResult.hops}</b> evidence links.`;
      addLogEntry(`<b>Goal reached</b> · ${esc(goal ? goal.name : "")} via ${esc(algoName(currentRunResult.algorithm))} | ${currentRunResult.path.map(id => esc(byId(id) ? byId(id).name : id)).join(" → ")} | ${currentRunResult.review_cost}m`);
    } else {
      iconEl.textContent = "✕"; iconEl.style.color = "#fb7185"; iconEl.style.background = "rgba(251,113,133,.14)";
      textEl.innerHTML = `<b>Search halted:</b> ${esc((currentRunResult && currentRunResult.note) || "No route could be found to the target asset.")}`;
    }
    return;
  }
  iconEl.textContent = "⚡"; iconEl.style.color = "#2dd4bf"; iconEl.style.background = "rgba(45,212,191,.14)";
  const name = step.node_name || (byId(step.node) && byId(step.node).name) || step.node;
  const evals = step.evaluations || [];
  const chosen = evals.filter(e => e.decision === "chosen");
  const rejected = evals.filter(e => e.decision === "rejected");
  let txt = `<b>Step ${step.step}:</b> Expanded <b>${esc(name)}</b>. `;
  if (chosen.length) txt += `<span style="color:#2dd4bf">✔ Picked ${chosen.map(c => esc(byId(c.to) ? byId(c.to).name : c.to)).join(", ")}</span> `;
  if (rejected.length) txt += `<span style="color:#fb7185">✕ Pruned ${rejected.map(r => `${esc(byId(r.to) ? byId(r.to).name : r.to)} (${esc(r.reason)})`).join("; ")}</span>`;
  if (!evals.length) txt += step.summary || "Inspecting telemetry…";
  textEl.innerHTML = txt;
  addLogEntry(`<b>${esc(name)}</b> · ${esc(step.summary || txt.replace(/<[^>]+>/g, ""))}`);
}

function addLogEntry(html) {
  const log = $("investigationLog");
  const empty = log.querySelector(".empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  li.innerHTML = html;
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

function videoPlay() {
  if (isPlaying) return;
  if (playbackTrace.length && playbackIndex >= playbackTrace.length - 1) { playbackIndex = 0; renderPlaybackStep(0); }
  isPlaying = true; updateScrubberUI(); scheduleNextStep();
}
function videoPause() { isPlaying = false; if (playbackTimer) clearTimeout(playbackTimer); updateScrubberUI(); }
function videoTogglePlay() { isPlaying ? videoPause() : videoPlay(); }
function videoReplay() { videoPause(); playbackIndex = 0; renderPlaybackStep(0); videoPlay(); }
function videoStepNext() { videoPause(); if (playbackIndex < playbackTrace.length - 1) renderPlaybackStep(playbackIndex + 1); }
function videoStepPrev() { videoPause(); if (playbackIndex > 0) renderPlaybackStep(playbackIndex - 1); }
function videoSeek(v) { videoPause(); renderPlaybackStep(parseInt(v, 10)); }
function scheduleNextStep() {
  if (!isPlaying) return;
  playbackTimer = setTimeout(() => {
    if (!isPlaying) return;
    if (playbackIndex < playbackTrace.length - 1) { playbackIndex++; renderPlaybackStep(playbackIndex); scheduleNextStep(); }
    else videoPause();
  }, SPEED[currentSpeed]);
}
function setSpeed(spd) {
  currentSpeed = spd;
  ["slow", "medium", "fast"].forEach(s => {
    const el = $("spd" + s.charAt(0).toUpperCase() + s.slice(1));
    const on = s === spd; el.classList.toggle("is-active", on); el.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (isPlaying) { if (playbackTimer) clearTimeout(playbackTimer); scheduleNextStep(); }
}
function resetPlayback() {
  videoPause();
  playbackTrace = []; playbackIndex = 0; currentRunResult = null;
  $("videoScrubber").max = 0; $("videoScrubber").value = 0;
  $("stepCounter").textContent = "Step 0 / 0";
  $("playbackBadge").textContent = "Standby"; $("playbackBadge").className = "status-badge";
  $("telemetryText").innerHTML = "<b>Ready:</b> Run a search to trace the path, branching decisions and pruned links.";
  $("telemetryIcon").textContent = "⚡"; $("telemetryIcon").style.color = "#2dd4bf"; $("telemetryIcon").style.background = "rgba(45,212,191,.14)";
  $("investigationLog").innerHTML = '<li class="empty">No investigation steps yet. Select source and target, then run a search.</li>';
}

function updateInternals(step) {
  const alg = activeAlgorithm;
  $("intAlgoTag").textContent = "STRATEGY: " + algoName(alg).toUpperCase();
  const info = ALGO_INFO[alg] || ALGO_INFO.astar;
  $("frontierView").textContent = info.frontier;
  const explored = new Set([$("startNode").value]);
  for (let i = 0; i <= playbackIndex; i++) if (playbackTrace[i] && playbackTrace[i].node) explored.add(playbackTrace[i].node);
  $("visitedView").textContent = "{ " + Array.from(explored).join(", ") + " }";
  $("gnfView").textContent = info.gnf;
}

/* ---------------- Search ---------------- */
async function runSearch(algs) {
  busyState(true);
  videoPause();
  $("resultsArea").innerHTML = '<div class="empty">Evaluating the evidence graph and tracking decisions…</div>';
  ["mHops", "mCost", "mExpanded"].forEach(id => $(id).textContent = "—");
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_id: scenario.id,
        start: $("startNode").value,
        goal: $("goalNode").value,
        algorithms: algs
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    results = data.results;
    showResults();
    const chosen = results[activeAlgorithm] || results[algs[0]];
    if (chosen) {
      displayMetrics(chosen);
      if (chosen.trace) setupPlayback(chosen.trace, chosen);
    }
  } catch (e) {
    toast(e.message);
    $("resultsArea").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally {
    busyState(false);
  }
}

function displayMetrics(r) {
  if (!r) return;
  $("mAlgo").textContent = r.name;
  $("mHops").textContent = r.found ? r.hops : "No path";
  $("mCost").textContent = r.found ? `${r.review_cost}m` : "—";
  $("mExpanded").textContent = r.expanded_count;
  $("concept").textContent = r.note;
}

function showResults() {
  const rows = ALGO_ORDER.filter(a => results[a]).map(a => {
    const r = results[a];
    return `<tr data-clickable data-algo="${a}" class="${a === activeAlgorithm ? "selected-row" : ""}">
      <td><span class="algoname">${esc(r.name)}</span><span class="fam">${esc(r.family)}</span></td>
      <td><span class="outcome ${r.found ? "" : "fail"}">${r.found ? "Path found" : "No path"}</span></td>
      <td>${r.found ? r.hops : "—"}</td>
      <td>${r.found ? r.review_cost + "m" : "—"}</td>
      <td>${r.expanded_count}</td>
      <td>${r.elapsed_ms} ms</td>
      <td style="white-space:normal">${esc(r.guarantee)}</td>
    </tr>`;
  }).join("");
  $("resultsArea").innerHTML = `<div class="table-wrap"><table class="result-table">
    <thead><tr>
      <th>Strategy</th><th>Outcome</th><th>Links</th><th>Review effort</th>
      <th>Expanded</th><th>Runtime</th><th>Theoretical guarantee</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  $("resultsArea").querySelectorAll("tr[data-clickable]").forEach(tr =>
    tr.addEventListener("click", () => selectResult(tr.dataset.algo)));
  $("resultMeta").textContent = `${Object.keys(results).length} strategy result(s) · click a row to replay`;
}

function selectResult(alg) {
  setActiveAlgorithm(alg);
  const r = results[alg];
  if (r) { displayMetrics(r); if (r.trace) setupPlayback(r.trace, r); }
}

function busyState(b) {
  ["runBtn", "compareBtn"].forEach(id => $(id).disabled = b);
  $("runBtn").textContent = b ? "Searching…" : "Run search";
}

/* ---------------- Inspector ---------------- */
function inspect(id) {
  selectedNodeId = id;
  const n = byId(id);
  if (!n) return;
  $("inspector").innerHTML =
    `<strong style="color:${colorType(n.type)}">${esc(n.name)} · ${esc(n.type)}</strong>` +
    `<p>${esc(n.detail)}</p>` +
    `<div class="microbuttons">
      <button class="micro" type="button" data-set="${esc(id)}" data-side="start">Set as source</button>
      <button class="micro" type="button" data-set="${esc(id)}" data-side="goal">Set as target</button>
    </div>`;
  $("inspector").querySelectorAll("[data-set]").forEach(b =>
    b.addEventListener("click", () => setEndpoint(b.dataset.set, b.dataset.side)));
  if (playbackTrace.length) renderPlaybackStep(playbackIndex);
  else renderStaticGraph();
}

function setEndpoint(id, side) {
  if (side === "start") $("startNode").value = id; else $("goalNode").value = id;
  resetPlayback(); updateTags(); updateCaseFile(); renderStaticGraph();
  toast(`${byId(id).name} set as ${side}`);
}

/* ---------------- Tabs ---------------- */
function setupTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  btns.forEach(btn => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
  document.querySelector(".tabs").addEventListener("keydown", ev => {
    const btns = Array.from(document.querySelectorAll(".tab-btn"));
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      const next = btns[(i + (ev.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      next.focus(); activateTab(next.dataset.tab);
    }
  });
}

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    const on = p.id === "tab-" + name;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  if (name === "challenge") initChallenge();
}

/* ---------------- Keyboard ---------------- */
function setupKeyboard() {
  window.addEventListener("keydown", ev => {
    const tag = (ev.target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (ev.code === "Space") { ev.preventDefault(); videoTogglePlay(); }
    else if (ev.code === "ArrowRight") { ev.preventDefault(); videoStepNext(); }
    else if (ev.code === "ArrowLeft") { ev.preventDefault(); videoStepPrev(); }
    else if (ev.code === "KeyR") { ev.preventDefault(); videoReplay(); }
    else if (ev.key === "Escape") { closeModals(); }
  });
}

/* ---------------- Modals ---------------- */
function setupModals() {
  document.querySelectorAll("[data-close]").forEach(el =>
    el.addEventListener("click", () => closeModal(el.dataset.close)));
  $("tourBtn").addEventListener("click", () => openModal("tourModal"));
  $("raceBtn").addEventListener("click", runRace);
  $("raceReplayBtn").addEventListener("click", raceReplay);
  $("racePlayBtn").addEventListener("click", raceTogglePlay);
  $("exportBtn").addEventListener("click", exportLabReport);
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
function closeModals() { $("tourModal").hidden = true; if (!raceData) $("raceModal").hidden = true; }

/* ---------------- Race ---------------- */
async function runRace() {
  const a = $("raceA").value, b = $("raceB").value;
  if (a === b) { toast("Pick two different strategies for the race."); return; }
  $("raceTitle").textContent = `${algoName(a)} vs ${algoName(b)}`;
  $("raceAName").textContent = algoName(a);
  $("raceBName").textContent = algoName(b);
  $("raceAExp").textContent = "Loading…"; $("raceBExp").textContent = "Loading…";
  $("raceACost").textContent = "—"; $("raceBCost").textContent = "—";
  openModal("raceModal");
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: scenario.id, start: $("startNode").value, goal: $("goalNode").value, algorithms: [a, b] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Race failed");
    raceData = {
      a: { res: data.results[a], svg: "raceSvgA", exp: "raceAExp", cost: "raceACost" },
      b: { res: data.results[b], svg: "raceSvgB", exp: "raceBExp", cost: "raceBCost" }
    };
    ["raceSvgA", "raceSvgB"].forEach(id => buildGraph($(id), scenario, {}));
    raceReplay();
  } catch (e) {
    toast("Race failed: " + e.message);
    closeModal("raceModal");
  }
}

function raceReplay() {
  racePlaying = false;
  if (raceTimer) clearTimeout(raceTimer);
  raceIndex = 0;
  raceRender();
  raceTogglePlay();
}

function raceTogglePlay() {
  if (!raceData) return;
  if (racePlaying) {
    racePlaying = false; if (raceTimer) clearTimeout(raceTimer);
    $("racePlayBtn").textContent = "▶ Play";
  } else {
    const max = Math.max((raceData.a.res.trace || []).length, (raceData.b.res.trace || []).length);
    if (raceIndex >= max - 1 && max > 0) raceIndex = 0;
    racePlaying = true;
    $("racePlayBtn").textContent = "⏸ Pause";
    raceStep();
  }
}

function raceStep() {
  if (!racePlaying || !raceData) return;
  raceRender();
  const max = Math.max((raceData.a.res.trace || []).length, (raceData.b.res.trace || []).length);
  if (raceIndex < max - 1) { raceIndex++; raceTimer = setTimeout(raceStep, 500); }
  else { racePlaying = false; $("racePlayBtn").textContent = "▶ Play"; }
}

function raceRender() {
  if (!raceData) return;
  ["a", "b"].forEach(key => {
    const rd = raceData[key], res = rd.res;
    const trace = res.trace || [];
    const frame = getFrameForStep(res, Math.min(raceIndex, trace.length - 1));
    renderFrame($(rd.svg), frame, { startId: $("startNode").value, goalId: $("goalNode").value });
    const total = res.expanded_count || trace.length;
    $(rd.exp).textContent = frame.isComplete ? `${res.expanded_count} (final)` : `${frame.exploredNodes.size} / ${total}`;
    if (frame.isComplete) {
      $(rd.cost).innerHTML = res.found
        ? `<b style="color:#4ade80">${res.review_cost}m · ${res.hops} hops</b>`
        : `<b style="color:#fb7185">No path found</b>`;
    } else {
      $(rd.cost).textContent = "Searching…";
    }
  });
}

/* ---------------- Challenge ---------------- */
function initChallenge() {
  const sel = $("challengeScenario");
  if (!sel.options.length && scenarios.length) {
    sel.innerHTML = scenarios.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  }
  if (scenario) sel.value = scenario.id;
  populateChallengeNodes();
  buildGraph($("graphChallenge"), challengeScenario(), { onNodeClick: challengeClick });
  renderChallenge();
}

function challengeScenario() {
  return scenarios.find(s => s.id === $("challengeScenario").value) || scenario;
}

function populateChallengeNodes() {
  const sc = challengeScenario();
  const opts = sc.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)} · ${esc(n.type)}</option>`).join("");
  $("challengeStart").innerHTML = opts; $("challengeGoal").innerHTML = opts;
  $("challengeStart").value = sc.start; $("challengeGoal").value = sc.goal;
  challengeTags();
}

function challengeTags() {
  const s = byId($("challengeStart").value), g = byId($("challengeGoal").value);
  $("challengeTags").textContent = `START: ${s ? s.name.toUpperCase() : "—"} · GOAL: ${g ? g.name.toUpperCase() : "—"}`;
}

function startChallenge() {
  const sc = challengeScenario();
  challengeState = { sc, built: [sc.start] };
  challengeTags();
  renderChallenge();
  $("challengeResult").textContent = "Challenge started. Click nodes to extend your route from the start.";
  $("challengeResult").className = "challenge-result";
}

function challengeClick(id) {
  if (!challengeState) { startChallenge(); return; }
  const { sc, built } = challengeState;
  const last = built[built.length - 1];
  if (id === last) return;
  if (built.includes(id)) { toast("That node is already in your path."); return; }
  const edge = sc.edges.find(e => e.from === last && e.to === id);
  if (!edge) { toast("No evidence link there — you can only follow forward links."); return; }
  built.push(id);
  renderChallenge();
}

function renderChallenge() {
  const svg = $("graphChallenge");
  const cache = svg._graph;
  if (!cache) return;
  const sc = (challengeState && challengeState.sc) || cache.sc;
  const built = (challengeState && challengeState.built) || [sc.start];
  const startId = $("challengeStart").value, goalId = $("challengeGoal").value;
  const pathSet = new Set();
  for (let i = 0; i < built.length - 1; i++) pathSet.add(built[i] + ">" + built[i + 1]);
  const visited = new Set(built);

  sc.edges.forEach(e => {
    const key = e.from + ">" + e.to;
    const path = cache.edgePaths[key];
    if (!path) return;
    let cls = "edge";
    let marker = "url(#arrow)";
    if (pathSet.has(key)) { cls = "edge chosen"; marker = "url(#arrowChosen)"; }
    path.setAttribute("class", cls);
    path.style.markerEnd = marker;
  });
  cache.layers.cross.innerHTML = "";
  cache.sc.nodes.forEach(n => {
    const ref = cache.nodeRefs[n.id];
    if (!ref) return;
    let cls = "node";
    if (n.id === startId) cls += " source";
    if (n.id === goalId) cls += " target";
    if (visited.has(n.id)) cls += " visited";
    if (n.id === built[built.length - 1]) cls += " selected";
    ref.g.setAttribute("class", cls);
    ref.src.style.display = n.id === startId ? "" : "none";
    ref.tgt.style.display = n.id === goalId ? "" : "none";
    ref.radar.style.display = "none";
  });

  // UI summary
  const names = built.map(id => (byId(id) ? byId(id).name : id));
  $("challengePath").innerHTML = "Path: " + names.map(n => `<b>${esc(n)}</b>`).join(" → ");
  const cost = built.slice(1).reduce((sum, id, i) => {
    const e = sc.edges.find(ed => ed.from === built[i] && ed.to === id);
    return sum + (e ? Number(e.cost) : 0);
  }, 0);
  $("challengeHops").textContent = built.length - 1;
  $("challengeCost").textContent = cost + "m";
}

function challengeUndo() {
  if (!challengeState || challengeState.built.length <= 1) return;
  challengeState.built.pop();
  renderChallenge();
  $("challengeResult").textContent = "";
}

function challengeCheck() {
  if (!challengeState) { toast("Start the challenge first."); return; }
  const { sc, built } = challengeState;
  const goal = $("challengeGoal").value;
  if (built.length < 2) { setChallengeMsg("Build a path of at least two nodes.", true); return; }
  if (built[built.length - 1] !== goal) { setChallengeMsg(`Your path does not reach the goal. Extend it to <b>${esc(byId(goal) ? byId(goal).name : goal)}</b>.`, true); return; }
  const cost = built.slice(1).reduce((sum, id, i) => {
    const e = sc.edges.find(ed => ed.from === built[i] && ed.to === id);
    return sum + (e ? Number(e.cost) : 0);
  }, 0);
  setChallengeMsg(`Your path reaches the goal! <b>Total review effort ${cost}m</b> over ${built.length - 1} link(s). Compare with the revealed optimum.`, false);
}

async function challengeReveal() {
  const sc = challengeScenario();
  const s = $("challengeStart").value, g = $("challengeGoal").value;
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: sc.id, start: s, goal: g, algorithms: ["astar", "ucs"] })
    });
    const data = await res.json();
    const best = (data.results.astar && data.results.astar.found) ? data.results.astar : data.results.ucs;
    if (best && best.found) {
      setChallengeMsg(`Optimal (A*/UCS): <b>${best.path.map(id => esc(byId(id) ? byId(id).name : id)).join(" → ")}</b> · ${best.review_cost}m · ${best.hops} links`, false);
    } else {
      setChallengeMsg("No route was found by the optimal strategies.", true);
    }
  } catch (e) { toast("Reveal failed: " + e.message); }
}

function setChallengeMsg(html, isError) {
  const el = $("challengeResult");
  el.innerHTML = html;
  el.className = "challenge-result" + (isError ? " error" : "");
}

/* ---------------- Export ---------------- */
function exportLabReport() {
  const r = results[activeAlgorithm];
  if (!r) { toast("Run a search first to export a lab report."); return; }
  const start = byId($("startNode").value), goal = byId($("goalNode").value);
  const path = r.found ? r.path.map(id => esc(byId(id) ? byId(id).name : id)).join(" → ") : "No path";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>CyberTrail Lab Report</title>
<style>body{font-family:Inter,Arial,sans-serif;background:#0b1522;color:#e6eef6;padding:40px;line-height:1.6}
h1{color:#2dd4bf;margin-bottom:4px}h2{margin-top:28px}table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border:1px solid #1f3242;padding:10px;text-align:left}th{background:#102033}
code{background:#111b2b;padding:2px 6px;border-radius:4px}.muted{color:#7d8ba1}</style></head>
<body><h1>CyberTrail · Investigation Lab Report</h1><p class="muted">Synthetic evidence graph · decision-support and search education</p>
<h2>Investigation</h2>
<p><b>Scenario:</b> ${esc(scenario.name)}<br><b>Route:</b> ${esc(start ? start.name : "?")} → ${esc(goal ? goal.name : "?")}<br>
<b>Strategy:</b> ${esc(r.name)} (${esc(r.family)})</p>
<h2>Results</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
<tr><td>Outcome</td><td>${r.found ? "Path found" : "No path"}</td></tr>
<tr><td>Evidence links</td><td>${r.found ? r.hops : "—"}</td></tr>
<tr><td>Review effort</td><td>${r.found ? r.review_cost + "m" : "—"}</td></tr>
<tr><td>Nodes expanded</td><td>${r.expanded_count}</td></tr>
<tr><td>Runtime</td><td>${r.elapsed_ms} ms</td></tr>
<tr><td>Theoretical guarantee</td><td>${esc(r.guarantee)}</td></tr>
<tr><td>Route</td><td>${path}</td></tr>
</tbody></table>
<h2>Interpretation</h2><p>${esc(r.note)}</p>
<p class="muted" style="margin-top:30px">Generated by CyberTrail · AI-Assisted Cyber Investigation Lab · CSC262</p>
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "cybertrail-lab-report.html";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Lab report downloaded.");
}

/* ---------------- Wire up controls ---------------- */
$("scenario").addEventListener("change", e => {
  scenario = scenarios.find(s => s.id === e.target.value);
  buildGraph($("graph"), scenario, { onNodeClick: inspect });
  buildGraph($("graphInternals"), scenario, {});
  resetPlayback();
  renderScenario();
});

$("startNode").addEventListener("change", () => { resetPlayback(); updateTags(); updateCaseFile(); renderStaticGraph(); });
$("goalNode").addEventListener("change", () => { resetPlayback(); updateTags(); updateCaseFile(); renderStaticGraph(); });
$("runBtn").addEventListener("click", () => runSearch([activeAlgorithm]));
$("compareBtn").addEventListener("click", () => runSearch(ALGO_ORDER.filter(a => algorithms[a])));
$("btnPlayPause").addEventListener("click", videoTogglePlay);
$("btnReplay").addEventListener("click", videoReplay);
$("btnStepNext").addEventListener("click", videoStepNext);
$("btnStepPrev").addEventListener("click", videoStepPrev);
$("videoScrubber").addEventListener("input", e => videoSeek(e.target.value));
$("spdSlow").addEventListener("click", () => setSpeed("slow"));
$("spdMed").addEventListener("click", () => setSpeed("medium"));
$("spdFast").addEventListener("click", () => setSpeed("fast"));
$("heatmapToggle").addEventListener("change", e => {
  heatmapEnabled = e.target.checked;
  if (playbackTrace.length) renderPlaybackStep(playbackIndex);
  else renderStaticGraph();
});

$("challengeScenario").addEventListener("change", () => { populateChallengeNodes(); buildGraph($("graphChallenge"), challengeScenario(), { onNodeClick: challengeClick }); startChallenge(); });
$("challengeStart").addEventListener("change", () => { challengeTags(); renderChallenge(); });
$("challengeGoal").addEventListener("change", () => { challengeTags(); renderChallenge(); });
$("challengeStartBtn").addEventListener("click", startChallenge);
$("challengeUndoBtn").addEventListener("click", challengeUndo);
$("challengeResetBtn").addEventListener("click", () => { startChallenge(); });
$("challengeCheckBtn").addEventListener("click", challengeCheck);
$("challengeRevealBtn").addEventListener("click", challengeReveal);

init();

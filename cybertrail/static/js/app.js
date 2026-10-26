/* ════════════════════════════════════════════════════════════════════
   CyberTrail — front-end controller
   Vanilla JS + SVG, no build step and no external dependencies.
   ════════════════════════════════════════════════════════════════════ */

"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 620;
const NODE_R = 26;

const TYPE_COLORS = {
  alert: "#fb7185",
  endpoint: "#60a5fa",
  account: "#c084fc",
  network: "#a78bfa",
  evidence: "#fbbf24",
  server: "#2dd4bf",
  storage: "#34d399",
  app: "#f472b6",
  asset: "#f87171",
};

const state = {
  scenarios: [],
  algorithms: [],
  scenario: null,
  start: null,
  goal: null,
  selectedAlgo: "astar",
  searchPayload: null,
  activeAlgoId: null,
  view: { k: 1, x: 0, y: 0 },
  animToken: 0,
  animTimer: null,
  expandedSet: new Set(),
};

/* ─────────────────────────── Tiny helpers ─────────────────────────── */

const $ = (id) => document.getElementById(id);

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  if (parent) parent.appendChild(node);
  return node;
}

function htmlEl(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function toast(message, kind = "error") {
  const wrap = $("toasts");
  const toastNode = htmlEl("div", `toast ${kind}`, wrap);
  const icon = htmlEl("span", "toast-icon", toastNode);
  icon.innerHTML =
    kind === "success"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.1"/></svg>';
  const msg = htmlEl("span", null, toastNode);
  msg.textContent = message;
  setTimeout(() => {
    toastNode.classList.add("leaving");
    setTimeout(() => toastNode.remove(), 320);
  }, 4600);
}

function setProgress(active) {
  const bar = $("progress-bar");
  bar.classList.toggle("active", active);
  bar.style.width = active ? "72%" : "100%";
  if (!active) setTimeout(() => { bar.style.width = "0%"; }, 450);
}

function fmtRuntime(ms) {
  if (ms < 0.005) return "<0.01 ms";
  return `${ms.toFixed(2)} ms`;
}

function confidenceClass(c) {
  if (c >= 0.85) return "conf-high";
  if (c >= 0.65) return "conf-mid";
  return "conf-low";
}

function algoTagClass(algo) {
  if (algo.id === "hill") return "tag-incomplete";
  return algo.optimal ? "tag-optimal" : "tag-weak";
}

function speedToMs(value) {
  // Slider 1..10 -> 780ms..110ms between expansion steps.
  return Math.round(780 - ((value - 1) * 670) / 9);
}

/* ─────────────────────────── Data loading ─────────────────────────── */

async function boot() {
  try {
    const [scenariosRes, algoRes] = await Promise.all([
      fetch("/api/scenarios"),
      fetch("/api/algorithms"),
    ]);
    state.scenarios = await scenariosRes.json();
    state.algorithms = await algoRes.json();

    renderScenarioList();
    renderAlgorithmList();
    selectScenario(state.scenarios[0].id, { fit: false });
    wireEvents();

    requestAnimationFrame(() => fitView());
    checkHealth();
  } catch (err) {
    toast("Failed to load CyberTrail data. Is the Flask server running?");
    setHealth(false);
  }
}

async function checkHealth() {
  try {
    const res = await fetch("/health");
    const body = await res.json();
    setHealth(body.status === "ok");
  } catch {
    setHealth(false);
  }
}

function setHealth(online) {
  const dot = $("health-dot");
  dot.classList.toggle("online", online);
  dot.classList.toggle("offline", !online);
  $("health-label").textContent = online ? "API online" : "API offline";
}

/* ─────────────────────────── Sidebar render ─────────────────────────── */

function renderScenarioList() {
  const wrap = $("scenario-list");
  wrap.innerHTML = "";
  state.scenarios.forEach((scenario) => {
    const card = htmlEl("button", "scenario-card", wrap);
    card.type = "button";
    card.dataset.id = scenario.id;
    card.innerHTML = `
      <span class="sc-name"></span>
      <span class="sc-brief"></span>
      <span class="sc-stats">
        <span>${scenario.node_count} nodes</span>
        <span>${scenario.edge_count} links</span>
      </span>`;
    card.querySelector(".sc-name").textContent = scenario.name;
    card.querySelector(".sc-brief").textContent = scenario.brief;
    card.addEventListener("click", () => selectScenario(scenario.id));
  });
}

function renderAlgorithmList() {
  const wrap = $("algo-list");
  wrap.innerHTML = "";
  state.algorithms.forEach((algo) => {
    const card = htmlEl("button", "algo-card", wrap);
    card.type = "button";
    card.dataset.id = algo.id;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(algo.id === state.selectedAlgo));
    card.title = algo.description;
    card.innerHTML = `
      <span class="algo-glyph"></span>
      <span class="algo-main">
        <span class="algo-name"></span>
        <span class="algo-eval"></span>
      </span>
      <span class="algo-tag ${algoTagClass(algo)}"></span>`;
    card.querySelector(".algo-glyph").textContent = algo.short;
    card.querySelector(".algo-name").textContent = algo.name;
    card.querySelector(".algo-eval").textContent = algo.evaluation;
    card.querySelector(".algo-tag").textContent = algo.optimal
      ? "Optimal"
      : algo.id === "hill" ? "Incomplete" : "Heuristic";
    card.addEventListener("click", () => {
      state.selectedAlgo = algo.id;
      syncAlgorithmCards();
    });
  });
  syncAlgorithmCards();
}

function syncAlgorithmCards() {
  document.querySelectorAll(".algo-card").forEach((card) => {
    const active = card.dataset.id === state.selectedAlgo;
    card.classList.toggle("active", active);
    card.setAttribute("aria-checked", String(active));
  });
}

function syncScenarioCards() {
  document.querySelectorAll(".scenario-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.id === state.scenario.id);
  });
}

function renderLegend() {
  const list = $("legend-list");
  list.innerHTML = "";
  const usedTypes = [...new Set(state.scenario.nodes.map((n) => n.type))];
  usedTypes.forEach((type) => {
    const li = htmlEl("li", null, list);
    const dot = htmlEl("span", "type-dot", li);
    dot.style.background = TYPE_COLORS[type] || "#94a3b8";
    dot.style.boxShadow = `0 0 8px ${TYPE_COLORS[type] || "#94a3b8"}66`;
    li.append(document.createTextNode(state.scenario.node_types[type] || type));
  });
}

function renderEndpointSelects() {
  const startSel = $("start-select");
  const goalSel = $("goal-select");
  startSel.innerHTML = "";
  goalSel.innerHTML = "";
  state.scenario.nodes.forEach((node) => {
    const o1 = htmlEl("option", null, startSel);
    o1.value = node.id;
    o1.textContent = node.label;
    const o2 = htmlEl("option", null, goalSel);
    o2.value = node.id;
    o2.textContent = node.label;
  });
  startSel.value = state.start;
  goalSel.value = state.goal;
}

/* ─────────────────────────── Scenario / graph ─────────────────────────── */

function selectScenario(id, { fit = true } = {}) {
  state.animToken++;
  clearTimeout(state.animTimer);
  state.scenario = state.scenarios.find((s) => s.id === id);
  state.start = state.scenario.default_start;
  state.goal = state.scenario.default_goal;
  state.searchPayload = null;
  state.activeAlgoId = null;
  state.expandedSet = new Set();
  $("replay-btn").disabled = true;

  syncScenarioCards();
  renderEndpointSelects();
  renderLegend();
  renderCrumb();
  renderGraph();
  renderEmptyResults();
  $("stage-hint").classList.remove("hidden");
  if (fit) requestAnimationFrame(() => fitView());
}

function renderCrumb() {
  const crumb = $("crumb");
  const startNode = state.scenario.nodes.find((n) => n.id === state.start);
  const goalNode = state.scenario.nodes.find((n) => n.id === state.goal);
  crumb.innerHTML = `
    <b class="crumb-source"></b>
    <span class="arrow">→</span>
    <b class="crumb-goal"></b>
    <span class="crumb-muted" style="margin-left:8px"></span>`;
  crumb.querySelector(".crumb-source").textContent = startNode.label;
  crumb.querySelector(".crumb-goal").textContent = goalNode.label;
  crumb.querySelector(".crumb-muted").textContent = state.scenario.name;
}

function renderGraph() {
  const edgesLayer = $("edges-layer");
  const labelsLayer = $("cost-labels-layer");
  const nodesLayer = $("nodes-layer");
  edgesLayer.innerHTML = "";
  labelsLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  const nodeById = Object.fromEntries(state.scenario.nodes.map((n) => [n.id, n]));

  // Edges
  state.scenario.edges.forEach((edge) => {
    const a = nodeById[edge.source];
    const b = nodeById[edge.target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const x1 = a.x + ux * (NODE_R + 3);
    const y1 = a.y + uy * (NODE_R + 3);
    const x2 = b.x - ux * (NODE_R + 6);
    const y2 = b.y - uy * (NODE_R + 6);

    const group = svgEl("g", { class: "edge-group" }, edgesLayer);
    group.dataset.source = edge.source;
    group.dataset.target = edge.target;
    svgEl("line", { class: "edge-hit", x1, y1, x2, y2 }, group);
    const line = svgEl(
      "line",
      { class: "edge-line", x1, y1, x2, y2, "marker-end": "url(#arrow-default)" },
      group
    );
    group._line = line;

    group.addEventListener("mouseenter", (e) => showEdgeTooltip(e, edge, a, b));
    group.addEventListener("mousemove", (e) => moveEdgeTooltip(e));
    group.addEventListener("mouseleave", hideEdgeTooltip);

    // Cost pill, offset perpendicularly so it clears the line.
    const mx = (a.x + b.x) / 2 - uy * 11;
    const my = (a.y + b.y) / 2 + ux * 11;
    const pill = svgEl("g", { class: "cost-pill", transform: `translate(${mx},${my})` }, labelsLayer);
    const w = 26;
    svgEl("rect", { x: -w / 2, y: -9, width: w, height: 18 }, pill);
    svgEl("text", { x: 0, y: 0.5, text: String(edge.cost) }, pill);
    group._pill = pill;
  });

  // Nodes
  state.scenario.nodes.forEach((node) => {
    const color = TYPE_COLORS[node.type] || "#94a3b8";
    const group = svgEl(
      "g",
      { class: "node-group", transform: `translate(${node.x},${node.y})`, tabindex: 0, role: "button" },
      nodesLayer
    );
    group.dataset.id = node.id;
    group.setAttribute("aria-label", `${node.label} — ${state.scenario.node_types[node.type]}`);

    svgEl("circle", { class: "node-ring", r: NODE_R + 6 }, group);
    const circle = svgEl("circle", { class: "node-circle", r: NODE_R }, group);
    circle.style.stroke = color;
    const icon = svgEl(
      "use",
      { class: "node-icon", href: `#icon-${node.type}`, x: -10, y: -10, width: 20, height: 20 },
      group
    );
    icon.style.color = color;
    svgEl("text", { class: "node-label", y: NODE_R + 20, text: node.label }, group);

    group.addEventListener("pointerdown", (e) => e.stopPropagation());
    group.addEventListener("click", (e) => {
      if (dragState.suppressClick) return;
      openNodePopover(node, e);
    });
    group.addEventListener("mouseenter", () => highlightRelated(node.id));
    group.addEventListener("mouseleave", clearRelated);
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const rect = group.getBoundingClientRect();
        openNodePopover(node, { clientX: rect.left + rect.width / 2, clientY: rect.top });
      }
    });
  });

  applyEndpointClasses();
  applyViewTransform();
}

function applyEndpointClasses() {
  document.querySelectorAll(".node-group").forEach((g) => {
    g.classList.toggle("source", g.dataset.id === state.start);
    g.classList.toggle("goal", g.dataset.id === state.goal);
  });
}

function highlightRelated(nodeId) {
  document.querySelectorAll(".edge-group").forEach((g) => {
    const related = g.dataset.source === nodeId || g.dataset.target === nodeId;
    g.classList.toggle("related", related);
    g.classList.toggle("dimmed", !related);
  });
  document.querySelectorAll(".cost-pill").forEach((p) => p.classList.add("dimmed"));
  document.querySelectorAll(".node-group").forEach((g) => {
    if (g.dataset.id === nodeId) return;
    const connected = state.scenario.edges.some(
      (e) =>
        (e.source === nodeId && e.target === g.dataset.id) ||
        (e.target === nodeId && e.source === g.dataset.id)
    );
    g.classList.toggle("dimmed", !connected);
  });
}

function clearRelated() {
  document.querySelectorAll(".edge-group, .node-group, .cost-pill").forEach((n) =>
    n.classList.remove("related", "dimmed")
  );
  // Re-apply traversal dimming if an animation finished.
  if (state.activeAlgoId && state.searchPayload) {
    const result = getActiveResult();
    if (result && state.expandedSet.size && !animationRunning()) {
      applyTraversalDim(result);
    }
  }
}

/* ─────────────────────────── Edge tooltip ─────────────────────────── */

function showEdgeTooltip(evt, edge, a, b) {
  const tip = $("edge-tooltip");
  const pct = Math.round(edge.confidence * 100);
  tip.innerHTML = `
    <div class="tt-title"></div>
    <div class="tt-row"><span>Link</span><span></span></div>
    <div class="tt-row"><span>Review cost</span><span>${edge.cost}</span></div>
    <div class="tt-row"><span>Confidence</span><span class="conf-pill ${confidenceClass(edge.confidence)}">${pct}%</span></div>`;
  tip.querySelector(".tt-title").textContent = edge.relationship;
  tip.querySelector(".tt-row span:last-child").textContent = `${a.id} → ${b.id}`;
  tip.hidden = false;
  moveEdgeTooltip(evt);
}

function moveEdgeTooltip(evt) {
  const tip = $("edge-tooltip");
  const wrap = $("canvas-wrap").getBoundingClientRect();
  let x = evt.clientX - wrap.left + 14;
  let y = evt.clientY - wrap.top + 14;
  const maxX = wrap.width - tip.offsetWidth - 8;
  const maxY = wrap.height - tip.offsetHeight - 8;
  x = Math.max(8, Math.min(x, maxX));
  y = Math.max(8, Math.min(y, maxY));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideEdgeTooltip() {
  $("edge-tooltip").hidden = true;
}

/* ─────────────────────────── Node popover ─────────────────────────── */

function openNodePopover(node, evt) {
  const popover = $("node-popover");
  $("popover-title").textContent = node.label;
  popover.hidden = false;

  const wrap = $("canvas-wrap").getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let x = evt.clientX - wrap.left - width / 2;
  let y = evt.clientY - wrap.top - height - 46;
  x = Math.max(8, Math.min(x, wrap.width - width - 8));
  y = Math.max(8, y);
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;

  popover.querySelectorAll(".popover-btn").forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      if (action === "source") {
        if (node.id === state.goal) state.goal = state.start;
        state.start = node.id;
      } else {
        if (node.id === state.start) state.start = state.goal;
        state.goal = node.id;
      }
      popover.hidden = true;
      onEndpointChanged();
    };
  });
}

function closePopover() {
  $("node-popover").hidden = true;
}

/* ─────────────────────────── Pan & zoom ─────────────────────────── */

const dragState = { active: false, moved: false, suppressClick: false, lastX: 0, lastY: 0 };

function toSvgPoint(clientX, clientY) {
  const svg = $("graph-svg");
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function applyViewTransform() {
  const { k, x, y } = state.view;
  $("viewport").setAttribute("transform", `translate(${x},${y}) scale(${k})`);
}

function zoomAt(factor, centerClient) {
  const svg = $("graph-svg");
  const rect = svg.getBoundingClientRect();
  const cx = centerClient?.x ?? rect.left + rect.width / 2;
  const cy = centerClient?.y ?? rect.top + rect.height / 2;
  const p = toSvgPoint(cx, cy);
  const kOld = state.view.k;
  const kNew = Math.min(4, Math.max(0.3, kOld * factor));
  state.view.x = p.x - ((p.x - state.view.x) / kOld) * kNew;
  state.view.y = p.y - ((p.y - state.view.y) / kOld) * kNew;
  state.view.k = kNew;
  applyViewTransform();
}

function fitView() {
  const wrap = $("canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  if (!rect.width) return;
  const k = Math.min(rect.width / VIEW_W, rect.height / VIEW_H) * 0.94;
  state.view.k = k;
  state.view.x = (rect.width - VIEW_W * k) / 2;
  state.view.y = (rect.height - VIEW_H * k) / 2;
  applyViewTransform();
}

function wirePanZoom() {
  const wrap = $("canvas-wrap");

  wrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".node-popover") || e.target.closest("button")) return;
    dragState.active = true;
    dragState.moved = false;
    dragState.lastX = e.clientX;
    dragState.lastY = e.clientY;
    wrap.setPointerCapture(e.pointerId);
    closePopover();
    hideEdgeTooltip();
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!dragState.active) return;
    const dx = e.clientX - dragState.lastX;
    const dy = e.clientY - dragState.lastY;
    if (Math.abs(e.clientX - dragState.lastX) + Math.abs(e.clientY - dragState.lastY) > 0) {
      dragState.moved = true;
      wrap.classList.add("dragging");
      const before = toSvgPoint(dragState.lastX, dragState.lastY);
      const after = toSvgPoint(e.clientX, e.clientY);
      state.view.x += after.x - before.x;
      state.view.y += after.y - before.y;
      applyViewTransform();
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
    }
  });

  wrap.addEventListener("pointerup", (e) => {
    if (!dragState.active) return;
    dragState.active = false;
    wrap.classList.remove("dragging");
    if (dragState.moved) {
      dragState.suppressClick = true;
      setTimeout(() => (dragState.suppressClick = false), 0);
    }
  });

  wrap.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(factor, { x: e.clientX, y: e.clientY });
    },
    { passive: false }
  );

  $("zoom-in-btn").addEventListener("click", () => zoomAt(1.25));
  $("zoom-out-btn").addEventListener("click", () => zoomAt(0.8));
  $("zoom-fit-btn").addEventListener("click", () => fitView());
}

/* ─────────────────────────── Search ─────────────────────────── */

async function runSearch(algorithmIds) {
  if (state.start === state.goal) {
    toast("Start and target must be different nodes.");
    return;
  }
  setProgress(true);
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_id: state.scenario.id,
        start: state.start,
        goal: state.goal,
        algorithms: algorithmIds,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      toast(payload.error || "Search request failed.");
      return;
    }
    state.searchPayload = payload;
    $("stage-hint").classList.add("hidden");
    renderResults();

    const preferred =
      payload.results.find((r) => r.algorithm === "astar" && r.reachable) ||
      payload.results.find((r) => r.reachable) ||
      payload.results[0];
    playResult(preferred.algorithm);
  } catch {
    toast("Network error while contacting the search API.");
  } finally {
    setProgress(false);
  }
}

function getActiveResult() {
  if (!state.searchPayload) return null;
  return state.searchPayload.results.find((r) => r.algorithm === state.activeAlgoId) || null;
}

function algoMeta(id) {
  return state.algorithms.find((a) => a.id === id);
}

/* ─────────────────────────── Animation engine ─────────────────────────── */

function animationRunning() {
  return state.animTimer !== null;
}

function clearTraversalVisuals() {
  state.animToken++;
  clearTimeout(state.animTimer);
  state.animTimer = null;
  state.expandedSet = new Set();
  document
    .querySelectorAll(".node-group")
    .forEach((g) => g.classList.remove("explored", "route", "stuck", "dimmed"));
  document.querySelectorAll(".edge-group").forEach((g) => {
    g.classList.remove("explored", "route", "dimmed");
    g._line.setAttribute("marker-end", "url(#arrow-default)");
  });
  document.querySelectorAll(".cost-pill").forEach((p) => p.classList.remove("route", "dimmed"));
  applyEndpointClasses();
}

function playResult(algorithmId) {
  const result = state.searchPayload.results.find((r) => r.algorithm === algorithmId);
  if (!result) return;
  clearTraversalVisuals();
  state.activeAlgoId = algorithmId;
  syncSelectedRow();

  const token = state.animToken;
  const interval = speedToMs(Number($("speed-range").value));
  let i = 0;

  const step = () => {
    if (token !== state.animToken) return;
    if (i < result.expanded.length) {
      const nodeId = result.expanded[i];
      state.expandedSet.add(nodeId);
      markNode(nodeId, "explored");
      markIncomingEdge(nodeId);
      i += 1;
      state.animTimer = setTimeout(step, interval);
    } else {
      state.animTimer = null;
      finishTraversal(token, result);
    }
  };
  step();
}

function markNode(nodeId, cls) {
  const g = document.querySelector(`.node-group[data-id="${CSS.escape(nodeId)}"]`);
  if (g) g.classList.add(cls);
}

function markIncomingEdge(nodeId) {
  const edge = state.scenario.edges.find(
    (e) => e.target === nodeId && state.expandedSet.has(e.source)
  );
  if (!edge) return;
  const group = document.querySelector(
    `.edge-group[data-source="${CSS.escape(edge.source)}"][data-target="${CSS.escape(nodeId)}"]`
  );
  if (group && !group.classList.contains("route")) {
    group.classList.add("explored");
    group._line.setAttribute("marker-end", "url(#arrow-explored)");
  }
}

function later(token, fn, ms) {
  state.animTimer = setTimeout(() => {
    if (token === state.animToken) fn();
    state.animTimer = null;
  }, ms);
}

function finishTraversal(token, result) {
  if (result.reachable) {
    result.path.forEach((nodeId, idx) => {
      later(token, () => {
        markNode(nodeId, "route");
      }, idx * 110);
    });
    result.path.slice(1).forEach((targetId, idx) => {
      const sourceId = result.path[idx];
      later(token, () => {
        const group = document.querySelector(
          `.edge-group[data-source="${CSS.escape(sourceId)}"][data-target="${CSS.escape(targetId)}"]`
        );
        if (group) {
          group.classList.remove("explored");
          group.classList.add("route");
          group._line.setAttribute("marker-end", "url(#arrow-path)");
          group._pill.classList.add("route");
        }
      }, 200 + idx * 110);
    });
    later(token, () => applyTraversalDim(result), 300 + result.path.length * 110);
  } else if (result.stuck_at) {
    later(token, () => markNode(result.stuck_at, "stuck"), 120);
    later(token, () => applyTraversalDim(result), 300);
  } else {
    later(token, () => applyTraversalDim(result), 120);
  }
  $("replay-btn").disabled = false;
}

function applyTraversalDim(result) {
  const involved = new Set([...result.expanded, ...result.path, state.start, state.goal]);
  document.querySelectorAll(".node-group").forEach((g) => {
    g.classList.toggle("dimmed", !involved.has(g.dataset.id));
  });
  const routeEdges = new Set(result.path.slice(1).map((t, i) => `${result.path[i]}→${t}`));
  document.querySelectorAll(".edge-group").forEach((g) => {
    const key = `${g.dataset.source}→${g.dataset.target}`;
    g.classList.toggle("dimmed", !routeEdges.has(key) && !g.classList.contains("explored"));
  });
  document.querySelectorAll(".cost-pill").forEach((p) => {
    p.classList.toggle("dimmed", !p.classList.contains("route"));
  });
}

/* ─────────────────────────── Results panel ─────────────────────────── */

function renderEmptyResults() {
  $("results-meta").textContent = "";
  $("results-body").innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>
      </svg>
      <h3>No search yet</h3>
      <p>Pick a scenario, endpoints and an algorithm, then run a single search or compare all six methods.</p>
    </div>`;
}

function renderResults() {
  const payload = state.searchPayload;
  const body = $("results-body");
  body.innerHTML = "";
  $("results-meta").textContent =
    `${payload.results.length} algorithm${payload.results.length > 1 ? "s" : ""} · ${state.scenario.id}`;

  if (payload.results.length > 1) {
    body.appendChild(buildCompareTable(payload.results));
  }
  const active =
    payload.results.find((r) => r.algorithm === state.activeAlgoId) || payload.results[0];
  const detail = buildDetailCard(active, payload.results);
  detail.classList.add("result-detail");
  body.appendChild(detail);
}

function buildCompareTable(results) {
  const reachable = results.filter((r) => r.reachable);
  const minCost = Math.min(...reachable.map((r) => r.path_cost));
  const minExpanded = Math.min(...reachable.map((r) => r.expanded_count));
  const minRuntime = Math.min(...reachable.map((r) => r.runtime_ms));

  const wrap = htmlEl("div", null);
  const table = htmlEl("table", "compare-table", wrap);
  table.innerHTML = `
    <thead><tr>
      <th>Algorithm</th><th>Guarantee</th><th>Links</th><th>Cost</th><th>Expanded</th><th>Runtime</th>
    </tr></thead>`;
  const tbody = htmlEl("tbody", null, table);

  results.forEach((r) => {
    const meta = algoMeta(r.algorithm);
    const tr = htmlEl("tr", "compare-row", tbody);
    tr.dataset.algo = r.algorithm;
    if (r.algorithm === state.activeAlgoId) tr.classList.add("selected");
    tr.addEventListener("click", () => playResult(r.algorithm));

    const tdAlgo = htmlEl("td", "cell-algo", tr);
    tdAlgo.textContent = meta.short;
    const tdGuarantee = htmlEl("td", null, tr);
    const tag = htmlEl("span", `mini-tag ${algoTagClass(meta)}`, tdGuarantee);
    tag.textContent = meta.optimal ? "Optimal" : r.algorithm === "hill" ? "Incomplete" : "Heuristic";

    const tdLinks = htmlEl("td", null, tr);
    const tdCost = htmlEl("td", null, tr);
    const tdExp = htmlEl("td", null, tr);
    const tdTime = htmlEl("td", null, tr);

    if (!r.reachable) {
      const fail = htmlEl("span", "mini-tag tag-incomplete", tdLinks);
      fail.textContent = r.status === "local_optimum" ? "Local optimum" : "Dead end";
      tdCost.textContent = "—";
      tdExp.textContent = String(r.expanded_count);
      tdTime.textContent = fmtRuntime(r.runtime_ms);
      tdCost.classList.add("cell-fail");
    } else {
      tdLinks.textContent = r.path_links;
      tdCost.textContent = r.path_cost;
      tdExp.textContent = r.expanded_count;
      tdTime.textContent = fmtRuntime(r.runtime_ms);
      if (r.path_cost === minCost) tdCost.classList.add("best-cell");
      if (r.expanded_count === minExpanded) tdExp.classList.add("best-cell");
      if (r.runtime_ms === minRuntime) tdTime.classList.add("best-cell");
    }
  });
  return wrap;
}

function syncSelectedRow() {
  document.querySelectorAll(".compare-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.algo === state.activeAlgoId);
  });
  const active = getActiveResult();
  if (active) {
    const body = $("results-body");
    const existing = body.querySelector(".result-detail");
    if (existing) {
      const next = buildDetailCard(active, state.searchPayload.results);
      next.classList.add("result-detail");
      existing.replaceWith(next);
    }
  }
}

function buildDetailCard(result, allResults) {
  const meta = algoMeta(result.algorithm);
  const reachable = allResults.filter((r) => r.reachable);
  const minCost = reachable.length ? Math.min(...reachable.map((r) => r.path_cost)) : null;
  const minExpanded = reachable.length ? Math.min(...reachable.map((r) => r.expanded_count)) : null;

  const card = htmlEl("div", "result-head");
  card.innerHTML = `
    <div class="rh-top">
      <h3></h3>
      <span class="algo-tag ${algoTagClass(meta)}"></span>
    </div>
    <div class="rh-family"></div>
    <p></p>
    <span class="rh-eval"></span>`;
  card.querySelector("h3").textContent = meta.name;
  card.querySelector(".algo-tag").textContent = meta.guarantee;
  card.querySelector(".rh-family").textContent = `${meta.family} family`;
  card.querySelector("p").textContent = meta.description;
  card.querySelector(".rh-eval").textContent = `Evaluation: ${meta.evaluation}`;

  const wrap = htmlEl("div", null);
  wrap.appendChild(card);

  if (!result.reachable) {
    const warning = htmlEl("div", "warning-banner", wrap);
    const stuckLabel = result.stuck_at
      ? state.scenario.nodes.find((n) => n.id === result.stuck_at)?.label || result.stuck_at
      : null;
    warning.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 16.5v.1"/></svg>`;
    const text = htmlEl("span", null, warning);
    text.textContent =
      result.status === "local_optimum"
        ? `Local optimum at ${stuckLabel}: no adjacent node looks closer to the target. The search is incomplete.`
        : result.status === "dead_end"
          ? `Dead end at ${stuckLabel}: the trail runs out before reaching the target — a classic Hill Climbing failure.`
          : "Target is unreachable from the selected start node in this graph.";
  }

  const metrics = htmlEl("div", "metrics", wrap);
  const compareMode = allResults.length > 1;
  metrics.appendChild(
    metricCard("Path links", result.reachable ? result.path_links : "—", null, false)
  );
  metrics.appendChild(
    metricCard(
      "Review cost",
      result.reachable ? result.path_cost : "—",
      "effort",
      compareMode && result.reachable && result.path_cost === minCost
    )
  );
  metrics.appendChild(
    metricCard(
      "Expanded",
      result.expanded_count,
      "nodes",
      compareMode && result.reachable && result.expanded_count === minExpanded
    )
  );
  metrics.appendChild(
    metricCard("Runtime", fmtRuntime(result.runtime_ms), null, false)
  );

  if (result.reachable && result.path.length) {
    const routeBlock = htmlEl("div", "route-block", wrap);
    htmlEl("h4", null, routeBlock).textContent = "Selected route";
    const chips = htmlEl("div", "route-chips", routeBlock);
    result.path.forEach((nodeId, idx) => {
      if (idx > 0) htmlEl("span", "chip-arrow", chips).textContent = "→";
      const node = state.scenario.nodes.find((n) => n.id === nodeId);
      const chip = htmlEl(
        "span",
        `chip ${nodeId === state.start ? "chip-source" : nodeId === state.goal ? "chip-goal" : ""}`,
        chips
      );
      chip.textContent = node.label;
    });
  }
  return wrap;
}

function metricCard(label, value, unit, isBest) {
  const card = htmlEl("div", `metric ${isBest ? "is-best" : ""}`);
  const l = htmlEl("div", "m-label", card);
  l.textContent = label;
  if (isBest) {
    const crown = htmlEl("span", "m-crown", l);
    crown.textContent = " best";
  }
  const v = htmlEl("div", "m-value", card);
  v.textContent = value;
  if (unit) {
    const u = htmlEl("span", "m-unit", v);
    u.textContent = unit;
  } else if (label === "Review cost" || label === "Path links") {
    v.classList.add("teal");
  }
  return card;
}

/* ─────────────────────────── Endpoint changes ─────────────────────────── */

function onEndpointChanged() {
  $("start-select").value = state.start;
  $("goal-select").value = state.goal;
  renderCrumb();
  applyEndpointClasses();
  // Existing results no longer match the selected endpoints.
  state.searchPayload = null;
  state.activeAlgoId = null;
  state.animToken++;
  clearTimeout(state.animTimer);
  state.animTimer = null;
  $("replay-btn").disabled = true;
  clearTraversalVisuals();
  renderEmptyResults();
  $("stage-hint").classList.remove("hidden");
}

/* ─────────────────────────── Events & init ─────────────────────────── */

function wireEvents() {
  wirePanZoom();

  $("start-select").addEventListener("change", (e) => {
    if (e.target.value === state.goal) state.goal = state.start === e.target.value ? state.goal : state.start;
    state.start = e.target.value;
    if (state.start === state.goal) state.goal = state.scenario.nodes.find((n) => n.id !== state.start).id;
    onEndpointChanged();
  });

  $("goal-select").addEventListener("change", (e) => {
    state.goal = e.target.value;
    if (state.start === state.goal) state.start = state.scenario.nodes.find((n) => n.id !== state.goal).id;
    onEndpointChanged();
  });

  $("swap-btn").addEventListener("click", () => {
    [state.start, state.goal] = [state.goal, state.start];
    onEndpointChanged();
  });

  $("run-btn").addEventListener("click", () => runSearch([state.selectedAlgo]));
  $("compare-btn").addEventListener("click", () => runSearch(state.algorithms.map((a) => a.id)));
  $("replay-btn").addEventListener("click", () => {
    const result = getActiveResult();
    if (result) playResult(result.algorithm);
  });

  const range = $("speed-range");
  const label = $("speed-label");
  const updateSpeed = () => {
    const v = Number(range.value);
    label.textContent = v <= 3 ? "Slow" : v <= 6 ? "Normal" : v <= 8 ? "Fast" : "Turbo";
    range.style.background = `linear-gradient(90deg, var(--teal) 0 ${((v - 1) / 9) * 100}%, #26344d ${((v - 1) / 9) * 100}% 100%)`;
  };
  range.addEventListener("input", updateSpeed);
  updateSpeed();

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#node-popover")) closePopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopover();
  });

  window.addEventListener("resize", () => {
    // Keep the graph visible; only re-fit automatically if nothing was run.
    if (!state.searchPayload) fitView();
  });
}

document.addEventListener("DOMContentLoaded", boot);

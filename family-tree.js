const VERSION = "26-07-07-9";
let stateRef;
let templateText = "";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
const NODE_W = 210;
const NODE_H = 92;
const GAP_X = 38;
const GAP_Y = 74;
const PAD = 28;

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch(`./family-tree.html?v=${VERSION}`);
  if (!response.ok) throw new Error("Could not load Family Tree template.");
  templateText = await response.text();
  return templateText;
}

function personById(id) {
  return stateRef.people.find(person => person.person_id === id) || null;
}

function addEdge(edges, from, to, label, type = "solid") {
  if (!from || !to || from === to) return;
  const key = `${from}|${to}|${label}|${type}`;
  if (!edges.some(edge => edge.key === key)) edges.push({ key, from, to, label, type });
}

function buildGraph() {
  const used = new Set();
  const edges = [];
  const familyEdges = [];
  for (const applicant of stateRef.applicants) {
    const child = applicant.person_id;
    if (!child) continue;
    used.add(child);
    if (applicant.father_person_id) { used.add(applicant.father_person_id); addEdge(edges, applicant.father_person_id, child, "Father"); familyEdges.push([applicant.father_person_id, child]); }
    if (applicant.mother_person_id) { used.add(applicant.mother_person_id); addEdge(edges, applicant.mother_person_id, child, "Mother"); familyEdges.push([applicant.mother_person_id, child]); }
    if (applicant.spouse_person_id) { used.add(applicant.spouse_person_id); addEdge(edges, child, applicant.spouse_person_id, "Spouse"); familyEdges.push([child, applicant.spouse_person_id]); }
  }
  const familyConnected = connectedSets([...used], familyEdges);
  for (const applicant of stateRef.applicants) {
    const mapper = applicant.mapper_person_id;
    const child = applicant.person_id;
    if (!mapper || !child || mapper === child) continue;
    const sameFamily = familyConnected.some(set => set.has(mapper) && set.has(child));
    if (!sameFamily) { used.add(mapper); addEdge(edges, mapper, child, "Mapper", "dashed"); }
  }
  const nodes = [...used].map(id => personById(id)).filter(Boolean);
  return { nodes, edges };
}

function connectedSets(nodeIds, rawEdges) {
  const adj = new Map(nodeIds.map(id => [id, new Set()]));
  for (const [a, b] of rawEdges) {
    if (!a || !b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  const seen = new Set();
  const sets = [];
  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const set = new Set();
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      set.add(cur);
      for (const nxt of adj.get(cur) || []) if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
    }
    sets.push(set);
  }
  return sets;
}

function components(graph) {
  return connectedSets(graph.nodes.map(person => person.person_id), graph.edges.map(edge => [edge.from, edge.to])).map(set => ({ set, nodes: graph.nodes.filter(person => set.has(person.person_id)), edges: graph.edges.filter(edge => set.has(edge.from) && set.has(edge.to)) }));
}

function levelsFor(comp) {
  const ids = comp.nodes.map(person => person.person_id);
  const parentEdges = comp.edges.filter(edge => edge.label === "Father" || edge.label === "Mother");
  const parents = new Set(parentEdges.map(edge => edge.from));
  const children = new Set(parentEdges.map(edge => edge.to));
  const roots = ids.filter(id => parents.has(id) && !children.has(id));
  const level = new Map(ids.map(id => [id, 0]));
  const queue = roots.length ? roots.slice() : ids.slice(0, 1);
  for (const root of queue) level.set(root, 0);
  while (queue.length) {
    const cur = queue.shift();
    const curLevel = level.get(cur) || 0;
    for (const edge of parentEdges.filter(e => e.from === cur)) {
      const next = curLevel + 1;
      if ((level.get(edge.to) ?? -1) < next) { level.set(edge.to, next); queue.push(edge.to); }
    }
  }
  for (let i = 0; i < 4; i++) {
    for (const edge of comp.edges.filter(e => e.label === "Spouse")) {
      const a = level.get(edge.from) ?? 0;
      const b = level.get(edge.to) ?? a;
      const lv = Math.max(a, b);
      level.set(edge.from, lv);
      level.set(edge.to, lv);
    }
  }
  const min = Math.min(...[...level.values()]);
  if (min !== 0) for (const id of ids) level.set(id, (level.get(id) || 0) - min);
  return level;
}

function parentKey(personId, edges) {
  const fathers = edges.filter(edge => edge.to === personId && edge.label === "Father").map(edge => edge.from).sort().join("+");
  const mothers = edges.filter(edge => edge.to === personId && edge.label === "Mother").map(edge => edge.from).sort().join("+");
  return `${fathers}|${mothers}`;
}

function layoutComponent(comp) {
  const level = levelsFor(comp);
  const rows = new Map();
  for (const person of comp.nodes) {
    const lv = level.get(person.person_id) || 0;
    if (!rows.has(lv)) rows.set(lv, []);
    rows.get(lv).push(person);
  }
  for (const [lv, row] of rows) {
    row.sort((a, b) => {
      const ak = parentKey(a.person_id, comp.edges);
      const bk = parentKey(b.person_id, comp.edges);
      if (ak !== bk) return ak.localeCompare(bk);
      return (a.name || "").localeCompare(b.name || "");
    });
    const spouseEdges = comp.edges.filter(edge => edge.label === "Spouse");
    for (const edge of spouseEdges) {
      const ai = row.findIndex(p => p.person_id === edge.from);
      const bi = row.findIndex(p => p.person_id === edge.to);
      if (ai >= 0 && bi >= 0 && Math.abs(ai - bi) > 1) {
        const [spouse] = row.splice(bi, 1);
        const insertAt = row.findIndex(p => p.person_id === edge.from) + 1;
        row.splice(insertAt, 0, spouse);
      }
    }
  }
  const maxCols = Math.max(...[...rows.values()].map(row => row.length), 1);
  const width = PAD * 2 + maxCols * NODE_W + (maxCols - 1) * GAP_X;
  const maxLevel = Math.max(...[...rows.keys()], 0);
  const height = PAD * 2 + (maxLevel + 1) * NODE_H + maxLevel * GAP_Y;
  const pos = new Map();
  for (const [lv, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const rowWidth = row.length * NODE_W + Math.max(0, row.length - 1) * GAP_X;
    let x = (width - rowWidth) / 2;
    const y = PAD + lv * (NODE_H + GAP_Y);
    for (const person of row) {
      pos.set(person.person_id, { x, y, person });
      x += NODE_W + GAP_X;
    }
  }
  return { width, height, pos };
}

function displayName(person) {
  const name = person.name || "Unnamed";
  return person.epic_number ? `${name} (${person.epic_number})` : name;
}

function nodeHtml(item) {
  const p = item.person;
  const lines = [displayName(p)];
  if (p.state_2002 || p.district_2002) lines.push([p.state_2002, p.district_2002].filter(Boolean).join(", "));
  if (p.ac_no_2002 || p.part_no_2002 || p.sl_no_2002) {
    const parts = [];
    if (p.ac_no_2002) parts.push(`AC: ${p.ac_no_2002}`);
    if (p.part_no_2002) parts.push(`Part: ${p.part_no_2002}`);
    if (p.sl_no_2002) parts.push(`Serial: ${p.sl_no_2002}`);
    lines.push(parts.join(", "));
  }
  return `<div class="ft-node" style="left:${item.x}px;top:${item.y}px"><div>${lines.map(esc).join("</div><div>")}</div></div>`;
}

function edgeSvg(edge, pos) {
  const a = pos.get(edge.from);
  const b = pos.get(edge.to);
  if (!a || !b) return "";
  const dashed = edge.type === "dashed" ? ` stroke-dasharray="7 5"` : "";
  let x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
  if (edge.label === "Spouse") { x1 = a.x + NODE_W; y1 = a.y + NODE_H / 2; x2 = b.x; y2 = b.y + NODE_H / 2; }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ft-line"${dashed}/><text x="${mx}" y="${my - 5}" class="ft-label">${esc(edge.label)}</text>`;
}

function renderComponent(comp, index) {
  const layout = layoutComponent(comp);
  const lines = comp.edges.map(edge => edgeSvg(edge, layout.pos)).join("");
  const nodes = [...layout.pos.values()].map(nodeHtml).join("");
  return `<section class="ft-component"><div class="ft-title">Family Tree ${index + 1}</div><div class="ft-canvas" style="width:${layout.width}px;height:${layout.height}px"><svg class="ft-svg" width="${layout.width}" height="${layout.height}">${lines}</svg>${nodes}</div></section>`;
}

function render() {
  const wrap = $("#familyTreeWrap");
  if (!wrap) return;
  const graph = buildGraph();
  if (!graph.nodes.length) {
    wrap.innerHTML = `<div class="empty">No connected family data available to show.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="ft-scroll">${components(graph).map(renderComponent).join("")}</div>`;
}

export async function initFamilyTree(state) {
  stateRef = state;
  const panel = $("#familyTreeTab");
  if (!panel) return;
  panel.innerHTML = await getTemplate();
  render();
}

export function renderFamilyTree() {
  render();
}

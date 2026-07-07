const VERSION = "26-07-07-12";
let stateRef;
let templateText = "";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
const NODE_W = 220;
const NODE_H = 94;
const GAP_X = 44;
const GAP_Y = 86;
const PAD = 32;
const MALE_COLOR = "#2563eb";
const FEMALE_COLOR = "#db2777";

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch(`./family-tree.html?v=${VERSION}`);
  if (!response.ok) throw new Error("Could not load Family Tree template.");
  templateText = await response.text();
  return templateText;
}

function personById(id) { return stateRef.people.find(person => person.person_id === id) || null; }
function edgeKey(from, to, label, type) { return `${from}|${to}|${label}|${type}`; }
function addEdge(edges, from, to, label, type = "solid") {
  if (!from || !to || from === to) return;
  const key = edgeKey(from, to, label, type);
  if (!edges.some(edge => edge.key === key)) edges.push({ key, from, to, label, type });
}

function connectedSets(nodeIds, rawEdges) {
  const adj = new Map(nodeIds.map(id => [id, new Set()]));
  for (const [a, b] of rawEdges) {
    if (!a || !b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
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

function buildGraph() {
  const used = new Set();
  const edges = [];
  const familyEdges = [];
  const gender = new Map();
  for (const applicant of stateRef.applicants) {
    const child = applicant.person_id;
    if (!child) continue;
    used.add(child);
    if (applicant.father_person_id) {
      used.add(applicant.father_person_id);
      gender.set(applicant.father_person_id, "male");
      addEdge(edges, applicant.father_person_id, child, "Father");
      familyEdges.push([applicant.father_person_id, child]);
    }
    if (applicant.mother_person_id) {
      used.add(applicant.mother_person_id);
      gender.set(applicant.mother_person_id, "female");
      addEdge(edges, applicant.mother_person_id, child, "Mother");
      familyEdges.push([applicant.mother_person_id, child]);
    }
    if (applicant.spouse_person_id) {
      used.add(applicant.spouse_person_id);
      addEdge(edges, child, applicant.spouse_person_id, "Spouse");
      familyEdges.push([child, applicant.spouse_person_id]);
    }
  }
  const familyConnected = connectedSets([...used], familyEdges);
  for (const applicant of stateRef.applicants) {
    const mapper = applicant.mapper_person_id;
    const child = applicant.person_id;
    if (!mapper || !child || mapper === child) continue;
    const sameFamily = familyConnected.some(set => set.has(mapper) && set.has(child));
    if (!sameFamily) {
      used.add(mapper);
      addEdge(edges, mapper, child, applicant.mapper_relationship || "Mapper", "dashed");
    }
  }
  const nodes = [...used].map(id => personById(id)).filter(Boolean);
  return { nodes, edges, gender };
}

function components(graph) {
  return connectedSets(graph.nodes.map(person => person.person_id), graph.edges.map(edge => [edge.from, edge.to])).map(set => ({
    set,
    nodes: graph.nodes.filter(person => set.has(person.person_id)),
    edges: graph.edges.filter(edge => set.has(edge.from) && set.has(edge.to)),
    gender: graph.gender
  }));
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
  for (let i = 0; i < 5; i++) {
    for (const edge of comp.edges.filter(e => e.label === "Spouse")) {
      const lv = Math.max(level.get(edge.from) ?? 0, level.get(edge.to) ?? 0);
      level.set(edge.from, lv); level.set(edge.to, lv);
    }
  }
  const min = Math.min(...[...level.values()]);
  if (min !== 0) for (const id of ids) level.set(id, (level.get(id) || 0) - min);
  return level;
}

function parentKey(personId, edges) {
  const father = edges.find(edge => edge.to === personId && edge.label === "Father")?.from || "";
  const mother = edges.find(edge => edge.to === personId && edge.label === "Mother")?.from || "";
  return `${father}|${mother}`;
}

function layoutComponent(comp) {
  const level = levelsFor(comp);
  const rows = new Map();
  for (const person of comp.nodes) {
    const lv = level.get(person.person_id) || 0;
    if (!rows.has(lv)) rows.set(lv, []);
    rows.get(lv).push(person);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => {
      const ak = parentKey(a.person_id, comp.edges);
      const bk = parentKey(b.person_id, comp.edges);
      if (ak !== bk) return ak.localeCompare(bk);
      return (a.name || "").localeCompare(b.name || "");
    });
    for (const edge of comp.edges.filter(edge => edge.label === "Spouse")) {
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

function displayName(person) { return person.epic_number ? `${person.name || "Unnamed"} (${person.epic_number})` : (person.name || "Unnamed"); }
function userIcon(kind) {
  if (!kind) return "";
  const color = kind === "male" ? MALE_COLOR : FEMALE_COLOR;
  return `<svg class="ft-user-icon" viewBox="0 0 24 24" aria-hidden="true" style="color:${color}"><path fill="currentColor" d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5Zm0 2c-4.42 0-8 2.24-8 5v1.25c0 .41.34.75.75.75h14.5c.41 0 .75-.34.75-.75V19c0-2.76-3.58-5-8-5Z"/></svg>`;
}

function nodeHtml(item, genderMap) {
  const p = item.person;
  const lines = [];
  const title = `<div class="ft-node-title">${userIcon(genderMap.get(p.person_id))}<span>${esc(displayName(p))}</span></div>`;
  if (p.state_2002 || p.district_2002) lines.push([p.state_2002, p.district_2002].filter(Boolean).join(", "));
  if (p.ac_no_2002 || p.part_no_2002 || p.sl_no_2002) {
    const parts = [];
    if (p.ac_no_2002) parts.push(`AC: ${p.ac_no_2002}`);
    if (p.part_no_2002) parts.push(`Part: ${p.part_no_2002}`);
    if (p.sl_no_2002) parts.push(`Serial: ${p.sl_no_2002}`);
    lines.push(parts.join(", "));
  }
  return `<div class="ft-node" style="left:${item.x}px;top:${item.y}px">${title}${lines.map(row => `<div>${esc(row)}</div>`).join("")}</div>`;
}

function parentGroups(edges) {
  const map = new Map();
  const childIds = [...new Set(edges.filter(edge => edge.label === "Father" || edge.label === "Mother").map(edge => edge.to))];
  for (const child of childIds) {
    const father = edges.find(edge => edge.to === child && edge.label === "Father")?.from || "";
    const mother = edges.find(edge => edge.to === child && edge.label === "Mother")?.from || "";
    const key = `${father}|${mother}`;
    if (!map.has(key)) map.set(key, { father, mother, children: [] });
    map.get(key).children.push(child);
  }
  return [...map.values()];
}

function parentConnectorSvg(group, pos) {
  const parents = [group.father, group.mother].filter(Boolean).map(id => pos.get(id)).filter(Boolean);
  const children = group.children.map(id => pos.get(id)).filter(Boolean);
  if (!parents.length || !children.length) return "";
  const pxs = parents.map(p => p.x + NODE_W / 2);
  const cxs = children.map(c => c.x + NODE_W / 2);
  const parentY = Math.max(...parents.map(p => p.y + NODE_H));
  const childTopY = Math.min(...children.map(c => c.y));
  const jointX = (Math.min(...pxs) + Math.max(...pxs)) / 2;
  const parentLineY = parentY + 12;
  const busY = childTopY - 24;
  let svg = "";
  if (parents.length > 1) svg += `<line x1="${Math.min(...pxs)}" y1="${parentLineY}" x2="${Math.max(...pxs)}" y2="${parentLineY}" class="ft-line"/>`;
  svg += `<line x1="${jointX}" y1="${parents.length > 1 ? parentLineY : parentY}" x2="${jointX}" y2="${busY}" class="ft-line"/>`;
  if (children.length > 1) svg += `<line x1="${Math.min(...cxs)}" y1="${busY}" x2="${Math.max(...cxs)}" y2="${busY}" class="ft-line"/>`;
  for (const cx of cxs) svg += `<line x1="${cx}" y1="${busY}" x2="${cx}" y2="${childTopY}" class="ft-line"/>`;
  return svg;
}

function spouseSvg(edge, pos) {
  const a = pos.get(edge.from); const b = pos.get(edge.to);
  if (!a || !b) return "";
  const y = a.y + NODE_H / 2;
  const x1 = a.x < b.x ? a.x + NODE_W : b.x + NODE_W;
  const x2 = a.x < b.x ? b.x : a.x;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="ft-line"/>`;
}

function mapperSvg(edge, pos) {
  const a = pos.get(edge.from); const b = pos.get(edge.to);
  if (!a || !b) return "";
  const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ft-line" stroke-dasharray="7 5"/><text x="${mx}" y="${my - 5}" class="ft-label">${esc(edge.label)}</text>`;
}

function renderComponent(comp, index) {
  const layout = layoutComponent(comp);
  const parentLines = parentGroups(comp.edges).map(group => parentConnectorSvg(group, layout.pos)).join("");
  const spouseLines = comp.edges.filter(edge => edge.label === "Spouse").map(edge => spouseSvg(edge, layout.pos)).join("");
  const mapperLines = comp.edges.filter(edge => edge.type === "dashed").map(edge => mapperSvg(edge, layout.pos)).join("");
  const nodes = [...layout.pos.values()].map(item => nodeHtml(item, comp.gender)).join("");
  return `<section class="ft-component"><div class="ft-title">Family Tree ${index + 1}</div><div class="ft-canvas" style="width:${layout.width}px;height:${layout.height}px"><svg class="ft-svg" width="${layout.width}" height="${layout.height}">${parentLines}${spouseLines}${mapperLines}</svg>${nodes}</div></section>`;
}

function render() {
  const wrap = $("#familyTreeWrap");
  if (!wrap) return;
  ensureExportButtons();
  const graph = buildGraph();
  if (!graph.nodes.length) { wrap.innerHTML = `<div class="empty">No connected family data available to show.</div>`; return; }
  wrap.innerHTML = `<div class="ft-scroll">${components(graph).map(renderComponent).join("")}</div>`;
}

function familyTreeFileName(ext) { return `SIR_Family_Tree_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.${ext}`; }
function exportStyles() { return `body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#17221d}.export-wrap{padding:20px;background:#fff}.ft-scroll{display:grid;gap:1rem;overflow:visible}.ft-component{border:1.5px solid #c8d8d0;border-radius:12px;background:#fbfdfc;padding:.65rem;overflow:visible;margin-bottom:16px}.ft-title{color:#195b45;font-weight:900;margin-bottom:.45rem}.ft-canvas{position:relative;background:#fff;border:1.5px solid #c8d8d0;border-radius:12px;overflow:hidden}.ft-svg{position:absolute;inset:0;z-index:1}.ft-line{stroke:#195b45;stroke-width:2;fill:none}.ft-label{font-size:12px;font-weight:900;fill:#195b45;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}.ft-node{position:absolute;width:220px;min-height:94px;z-index:2;border:1.5px solid #195b45;border-radius:12px;background:#f6fbf8;color:#17221d;padding:.52rem .6rem;box-shadow:0 1px 5px rgba(0,0,0,.08);font-size:.82rem;font-weight:800;display:grid;align-content:center;gap:.16rem;overflow-wrap:anywhere}.ft-node-title{display:flex;align-items:center;gap:.32rem;font-size:.92rem;color:#195b45;font-weight:900}.ft-user-icon{width:1.05em;height:1.05em;flex:0 0 auto}`; }
function exportHtml() {
  const source = $("#familyTreeWrap");
  if (!source || !source.textContent.trim()) throw new Error("No family tree available to export.");
  const width = Math.max(900, source.scrollWidth + 40);
  const height = Math.max(700, source.scrollHeight + 40);
  return { html: `<div xmlns="http://www.w3.org/1999/xhtml"><style>${exportStyles()}</style><div class="export-wrap">${source.innerHTML}</div></div>`, width, height };
}
function exportImage() {
  try {
    const { html, width, height } = exportHtml();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url);
      const link = document.createElement("a"); link.download = familyTreeFileName("png"); link.href = canvas.toDataURL("image/png"); link.click();
    };
    image.onerror = () => { URL.revokeObjectURL(url); alert("Could not export image on this browser. Try Export PDF."); };
    image.src = url;
  } catch (error) { alert(error.message || "Could not export family tree image."); }
}
function exportPdf() {
  try {
    const source = $("#familyTreeWrap");
    if (!source || !source.textContent.trim()) throw new Error("No family tree available to export.");
    const win = window.open("", "_blank");
    if (!win) throw new Error("Popup blocked. Allow popups and try again.");
    win.document.write(`<!doctype html><html><head><title>SIR Family Tree</title><style>@page{size:A4 landscape;margin:10mm}${exportStyles()}.print-toolbar{position:sticky;top:0;background:#fff;padding:8px;border-bottom:1px solid #c8d8d0;z-index:10}.print-toolbar button{background:#195b45;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:800}.print-content{padding:10mm}@media print{.print-toolbar{display:none}}</style></head><body><div class="print-toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="print-content"><h2>SIR Family Tree</h2>${source.innerHTML}</div></body></html>`);
    win.document.close();
  } catch (error) { alert(error.message || "Could not export family tree PDF."); }
}
function ensureExportButtons() {
  const section = $("#familyTreeSection") || $("#familyTreeTab");
  if (!section || $("#exportFamilyTreeImageBtn")) return;
  const actions = document.createElement("div");
  actions.className = "tree-export-actions";
  actions.innerHTML = `<button id="exportFamilyTreeImageBtn" type="button" class="secondary">Export Image</button><button id="exportFamilyTreePdfBtn" type="button" class="secondary">Export PDF</button>`;
  actions.style.display = "flex"; actions.style.gap = ".4rem"; actions.style.flexWrap = "wrap"; actions.style.margin = ".35rem 0 .6rem";
  const note = section.querySelector(".tree-note"); const head = section.querySelector(".section-head");
  if (note) note.insertAdjacentElement("afterend", actions); else if (head) head.insertAdjacentElement("afterend", actions); else section.prepend(actions);
}
function bindExportButtons() { ensureExportButtons(); $("#exportFamilyTreeImageBtn")?.addEventListener("click", exportImage); $("#exportFamilyTreePdfBtn")?.addEventListener("click", exportPdf); }

export async function initFamilyTree(state) {
  stateRef = state;
  const panel = $("#familyTreeTab");
  if (!panel) return;
  panel.innerHTML = await getTemplate();
  bindExportButtons();
  render();
}
export function renderFamilyTree() { render(); }

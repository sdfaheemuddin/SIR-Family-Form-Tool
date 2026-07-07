const VERSION = "26-07-07-8";
let stateRef;
let templateText = "";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch(`./family-tree.html?v=${VERSION}`);
  if (!response.ok) throw new Error("Could not load Family Tree template.");
  templateText = await response.text();
  return templateText;
}

function personById(id) {
  return stateRef.people.find(person => person.person_id === id) || {};
}

function personTitle(person) {
  return person?.name || "Unnamed";
}

function personSub(person) {
  const rows = [];
  if (person?.epic_number) rows.push(`EPIC ${person.epic_number}`);
  if (person?.name_as_per_2002) rows.push(`2002: ${person.name_as_per_2002}`);
  if (person?.ac_no_2002 || person?.part_no_2002 || person?.sl_no_2002) rows.push(`AC ${person.ac_no_2002 || "-"} · Part ${person.part_no_2002 || "-"} · Sl ${person.sl_no_2002 || "-"}`);
  return rows;
}

function nodeCard(person, role, extra = "") {
  if (!person?.person_id) return `<div class="diagram-node missing"><div class="node-role">${esc(role)}</div><div class="node-name">Not selected</div></div>`;
  return `<div class="diagram-node"><div class="node-role">${esc(role)}</div><div class="node-name">${esc(personTitle(person))}</div>${extra ? `<div class="node-chip">${esc(extra)}</div>` : ""}${personSub(person).map(row => `<div class="node-detail">${esc(row)}</div>`).join("")}</div>`;
}

function applicantDiagram(applicant, index) {
  const applicantPerson = personById(applicant.person_id);
  const father = personById(applicant.father_person_id);
  const mother = personById(applicant.mother_person_id);
  const spouse = personById(applicant.spouse_person_id);
  const mapper = personById(applicant.mapper_person_id);
  const relation = applicant.mapper_relationship || "Mapper";
  const mapperExtra = mapper.person_id === applicantPerson.person_id ? "Same as applicant" : relation;
  return `<section class="applicant-diagram"><div class="diagram-title"><span>${index + 1}. ${esc(personTitle(applicantPerson))}</span><small>${esc(applicantPerson.epic_number || "")}</small></div><div class="diagram-row parent-row">${nodeCard(father, "Father")}${nodeCard(mother, "Mother")}</div><div class="diagram-join"></div><div class="diagram-row applicant-row">${nodeCard(applicantPerson, "Applicant", relation === "Self" ? "Self mapping" : "")}</div><div class="diagram-row lower-row">${nodeCard(spouse, "Spouse")}${nodeCard(mapper, "Mapping Person", mapperExtra)}</div></section>`;
}

function render() {
  const wrap = $("#familyTreeWrap");
  if (!wrap) return;
  if (!stateRef.applicants.length) {
    wrap.innerHTML = `<div class="empty">No applicants available to show family tree.</div>`;
    return;
  }
  wrap.innerHTML = `<div class="family-tree-all">${stateRef.applicants.map(applicantDiagram).join("")}</div>`;
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

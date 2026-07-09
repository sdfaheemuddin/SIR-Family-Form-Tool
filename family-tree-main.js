import "./family-tree.js?v=26-07-08-15";
import { loadState } from "./storage.js";
import { formatAadhaar } from "./core.js";

const PANEL_KEY = "sir_family_tree_selected_panel";
const state = loadState();
const canvas = document.getElementById("familyTreeCanvas");
const panel = document.getElementById("ftSelectedPanel");
const panelTitle = document.getElementById("ftSelectedTitle");
const panelContent = document.getElementById("ftSelectedContent");
const panelButton = document.getElementById("ftToggleDetailsPanel");

let selectedPersonId = "";
let panelEnabled = localStorage.getItem(PANEL_KEY) === "1";
let enhancing = false;

function dmy(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function trunc(value, limit = 25) {
  const text = String(value || "").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function personById(id) {
  return state.people.find(person => person.person_id === id) || null;
}

function applicantByPersonId(id) {
  return state.applicants.find(applicant => applicant.person_id === id) || null;
}

function splitNameEpic(text) {
  const raw = String(text || "").trim();
  const match = raw.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) return { name: raw, epic: "" };
  return { name: match[1].trim(), epic: match[2].trim() };
}

function stateDistrict(person) {
  return [person?.state_2002, person?.district_2002].filter(Boolean).join(", ");
}

function acPartSerial(person) {
  return [
    person?.ac_no_2002 ? `AC: ${person.ac_no_2002}` : "",
    person?.part_no_2002 ? `Part: ${person.part_no_2002}` : "",
    person?.sl_no_2002 ? `Serial: ${person.sl_no_2002}` : ""
  ].filter(Boolean).join(", ");
}

function actionIcon(action, x, label, symbol, dataAttr) {
  return `<g class="ft-action" data-ft-action="${action}" ${dataAttr} tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title><rect class="ft-action-bg" x="${x}" y="6" width="19" height="19" rx="5"></rect><text class="ft-action-symbol" x="${x + 9.5}" y="20" text-anchor="middle">${esc(symbol)}</text></g>`;
}

function selectedCell(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<div class="ft-selected-cell"><span class="ft-selected-label">${esc(label)}</span><span class="ft-selected-value">${esc(text)}</span></div>`;
}

function renderSelectedPanel() {
  if (!panel || !panelButton || !panelTitle || !panelContent) return;

  panelButton.textContent = panelEnabled ? "Hide selected details" : "Show selected details";
  if (!panelEnabled) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  if (!selectedPersonId) {
    panelTitle.textContent = "Selected details";
    panelContent.innerHTML = `<div class="ft-selected-cell"><span class="ft-selected-value">Select a person box to view details.</span></div>`;
    return;
  }

  const person = personById(selectedPersonId);
  const applicant = applicantByPersonId(selectedPersonId);
  const cells = [
    selectedCell("Name", person?.name),
    selectedCell("Current EPIC", person?.epic_number),
    selectedCell("Phone", applicant?.phone_number),
    selectedCell("Aadhaar", applicant?.aadhaar_number ? formatAadhaar(applicant.aadhaar_number) : ""),
    selectedCell("Date of Birth", applicant?.date_of_birth ? dmy(applicant.date_of_birth) : ""),
    selectedCell("State / District", stateDistrict(person)),
    selectedCell("AC / Part / Serial", acPartSerial(person)),
    selectedCell("2002 Name", person?.name_as_per_2002),
    selectedCell("2002 EPIC", person?.epic_number_2002),
    selectedCell("Relative", person?.relative_name_2002)
  ].join("");

  panelTitle.textContent = person?.name || "Selected details";
  panelContent.innerHTML = cells || `<div class="ft-selected-cell"><span class="ft-selected-value">No details available.</span></div>`;
}

function enhanceTree() {
  if (enhancing) return;
  enhancing = true;

  try {
    const svg = canvas?.querySelector("svg.family-tree-svg");
    if (!svg) return;

    svg.querySelectorAll(".ft-person").forEach(nodeEl => {
      nodeEl.querySelectorAll("[data-ft-name-line],[data-ft-epic-line],[data-ft-2002-line],.ft-action").forEach(el => el.remove());
      nodeEl.querySelectorAll(".ft-meta:not([data-ft-epic-line])").forEach(el => { el.style.display = "none"; });

      const originalName = nodeEl.querySelector(".ft-name:not([data-ft-name-line])");
      if (originalName) originalName.style.display = "none";

      const personId = nodeEl.getAttribute("data-node-id") || "";
      const person = personById(personId);
      const applicant = applicantByPersonId(personId);
      const parsed = splitNameEpic(originalName?.textContent || "");
      const name = person?.name || parsed.name || "Unknown";
      const epic = person?.epic_number || parsed.epic || "";
      const sd = stateDistrict(person);
      const aps = acPartSerial(person);
      const nameX = Number(originalName?.getAttribute("x")) || 14;

      nodeEl.insertAdjacentHTML("beforeend", `<text class="ft-name" data-ft-name-line="1" x="${nameX}" y="20">${esc(trunc(name, 24))}</text>`);
      if (epic) nodeEl.insertAdjacentHTML("beforeend", `<text class="ft-meta" data-ft-epic-line="1" x="${nameX}" y="36">${esc(trunc(epic, 28))}</text>`);
      if (sd) nodeEl.insertAdjacentHTML("beforeend", `<text class="ft-meta" data-ft-2002-line="1" x="${nameX}" y="54">${esc(trunc(sd, 32))}</text>`);
      if (aps) nodeEl.insertAdjacentHTML("beforeend", `<text class="ft-meta" data-ft-2002-line="1" x="${nameX}" y="70">${esc(trunc(aps, 36))}</text>`);

      let actions = "";
      if (applicant) actions += actionIcon("applicant", 204, "Edit applicant details", "✎", `data-edit-applicant="${esc(applicant.applicant_id)}"`);
      if (person) actions += actionIcon("person", 227, "Edit people details", "▤", `data-edit-person="${esc(person.person_id)}"`);
      if (actions) nodeEl.insertAdjacentHTML("beforeend", actions);
    });
  } finally {
    enhancing = false;
  }

  renderSelectedPanel();
}

function initFamilyTreeMain() {
  if (!canvas) return;

  panelButton?.addEventListener("click", () => {
    panelEnabled = !panelEnabled;
    localStorage.setItem(PANEL_KEY, panelEnabled ? "1" : "0");
    renderSelectedPanel();
  });

  canvas.addEventListener("click", event => {
    if (event.target.closest?.(".ft-action")) return;
    const personGroup = event.target.closest?.(".ft-person");
    if (!personGroup) return;

    selectedPersonId = personGroup.getAttribute("data-node-id") || "";
    panelEnabled = true;
    localStorage.setItem(PANEL_KEY, "1");
    setTimeout(renderSelectedPanel, 0);
  }, true);

  document.addEventListener("sir:data-changed", () => {
    if (document.querySelector(".native-applicant-popup,.native-person-popup")) return;
    setTimeout(() => window.location.reload(), 160);
  });

  new MutationObserver(() => enhanceTree()).observe(canvas, { childList: true });
  setTimeout(enhanceTree, 100);
  renderSelectedPanel();
}

initFamilyTreeMain();

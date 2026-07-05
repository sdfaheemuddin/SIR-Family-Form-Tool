// Main UI rendering and non-popup actions.
import { buildReadonly, formatAadhaar, onlyDigits } from "./core.js";
import { backupState, clearState } from "./storage.js";
import { downloadJson, parseImportFile, sirFileBaseFromState } from "./importExport.js";
import { generatePdf, generateOfflinePdf } from "./pdf.js";

let stateRef;
let commitRef;
let modalDepth = 0;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function clean(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function dmy(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || "");
}

function onlyValidPhoto(src) {
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(src || ""));
}

function safeFilePart(value) {
  return String(value || "applicant")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "applicant";
}

function personById(id) {
  return stateRef.people.find(person => person.person_id === id) || {};
}

function personName(id) {
  return personById(id).name || "";
}

function personEpic(id) {
  return personById(id).epic_number || "";
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 2200);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  });
  children.forEach(child => node.append(child));
  return node;
}

function openModal(title, content) {
  modalDepth += 1;
  const root = $("#modalRoot");
  const backdrop = el("div", { class: "modal-backdrop" });
  backdrop.style.zIndex = String(1000 + modalDepth * 20);
  const modal = el("div", { class: "modal" });
  const close = el("button", {
    type: "button",
    class: "small secondary",
    text: "Close",
    onclick: () => closeModal(backdrop)
  });
  modal.append(el("div", { class: "modal-head" }, [el("h3", { text: title }), close]), content);
  backdrop.append(modal);
  root.append(backdrop);
  return backdrop;
}

function closeModal(backdrop) {
  backdrop?.remove();
  modalDepth = Math.max(0, modalDepth - 1);
}

function photoDownloadBlock(applicant, name) {
  if (!onlyValidPhoto(applicant.photo_data)) return "";
  return `<section class="read-section photo-read-section"><h4>Applicant Photo</h4><div class="readonly-photo-box"><img class="readonly-photo" src="${esc(applicant.photo_data)}" alt="Applicant photo"><a class="button-link small" href="${esc(applicant.photo_data)}" download="${esc(safeFilePart(name))}_photo.jpg">Download Photo</a></div></section>`;
}

function readCell(label, value, copy = true, display = value) {
  const cleanValue = clean(value);
  return `<div class="copy-table-cell ${copy ? "" : "no-copy"}" ${copy ? `role="button" tabindex="0" data-copy="${esc(cleanValue)}"` : ""}><div class="copy-table-label">${esc(label)}</div><div class="copy-table-value">${esc(display)}</div></div>`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(clean(value));
  } catch {
    const temp = document.createElement("textarea");
    temp.value = clean(value);
    document.body.append(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
  toast("Copied.");
}

function renderPeople() {
  const wrap = $("#peopleTableWrap");
  if (!stateRef.people.length) {
    wrap.innerHTML = `<div class="empty">No people saved yet.</div>`;
    return;
  }
  wrap.innerHTML = `<table><thead><tr><th>Name</th><th>EPIC</th><th>2002 Details</th><th>Actions</th></tr></thead><tbody>${stateRef.people.map(person => `<tr><td>${esc(person.name)}</td><td>${esc(person.epic_number)}</td><td>${person.is_2002_available ? `<span class="badge">Yes</span><br>${esc(person.state_2002)}, ${esc(person.district_2002)}<br>AC ${esc(person.ac_no_2002)}${person.ac_name_2002 ? "-" + esc(person.ac_name_2002) : ""}, Part ${esc(person.part_no_2002)}, Sl ${esc(person.sl_no_2002)}` : "No"}</td><td><div class="row-actions"><button class="small secondary" data-edit-person="${esc(person.person_id)}">Edit</button><button class="small danger" data-delete-person="${esc(person.person_id)}">Delete</button></div></td></tr>`).join("")}</tbody></table>`;
  wrap.querySelectorAll("[data-delete-person]").forEach(button => {
    button.addEventListener("click", () => deletePerson(button.dataset.deletePerson));
  });
}

function renderApplicants() {
  const wrap = $("#applicantTableWrap");
  if (!stateRef.applicants.length) {
    wrap.innerHTML = `<div class="empty">No applicants saved yet.</div>`;
    return;
  }
  wrap.innerHTML = `<table><thead><tr><th>Applicant</th><th>DOB</th><th>Mapper</th><th>Relation</th><th>Phone</th><th>Aadhaar</th><th>Status</th><th>Actions</th></tr></thead><tbody>${stateRef.applicants.map(applicant => `<tr><td>${esc(personName(applicant.person_id))}<br><small>${esc(personEpic(applicant.person_id))}</small></td><td>${esc(dmy(applicant.date_of_birth))}</td><td>${esc(personName(applicant.mapper_person_id))}</td><td>${esc(applicant.mapper_relationship)}</td><td>${/^\d{10}$/.test(applicant.phone_number) ? `<a href="https://wa.me/91${esc(applicant.phone_number)}?text=${encodeURIComponent("SIR acknowledgement")}" target="_blank" rel="noopener">${esc(applicant.phone_number)}</a>` : esc(applicant.phone_number)}</td><td>${esc(formatAadhaar(applicant.aadhaar_number))}</td><td><label class="checkbox-line compact"><input type="checkbox" data-toggle-status="${esc(applicant.applicant_id)}" ${applicant.status_completed ? "checked" : ""}><span>${applicant.status_completed ? "Completed" : "Pending"}</span></label></td><td><div class="row-actions"><button class="small secondary" data-edit-applicant="${esc(applicant.applicant_id)}">Edit</button><button class="small danger" data-delete-applicant="${esc(applicant.applicant_id)}">Delete</button></div></td></tr>`).join("")}</tbody></table>`;

  wrap.querySelectorAll("[data-delete-applicant]").forEach(button => {
    button.addEventListener("click", () => deleteApplicant(button.dataset.deleteApplicant));
  });
  wrap.querySelectorAll("[data-toggle-status]").forEach(input => {
    input.addEventListener("change", () => {
      const applicant = stateRef.applicants.find(row => row.applicant_id === input.dataset.toggleStatus);
      if (!applicant) return;
      applicant.status_completed = input.checked;
      commitRef();
      renderReadonlyPicker();
    });
  });
}

function renderAll() {
  renderPeople();
  renderApplicants();
  renderReadonlyPicker();
}

function pendingApplicants() {
  return stateRef.applicants.filter(applicant => !applicant.status_completed);
}

function renderReadonlyPicker() {
  const select = $("#readonlyApplicantSelect");
  const rows = pendingApplicants();
  select.innerHTML = `<option value="">Select applicant</option>` + rows.map(applicant => `<option value="${esc(applicant.applicant_id)}">${esc(personName(applicant.person_id) || "Unnamed applicant")}</option>`).join("");
  const previous = select.dataset.selected || "";
  select.value = rows.some(applicant => applicant.applicant_id === previous) ? previous : (rows[0]?.applicant_id || "");
  select.dataset.selected = select.value;
  renderReadonlyCard(select.value);
  syncReadonlyButtons();
}

function syncReadonlyButtons() {
  const hasSelection = Boolean($("#readonlyApplicantSelect")?.value);
  $("#markCompleteBtn").disabled = !hasSelection;
  $("#nextApplicantBtn").disabled = pendingApplicants().length < 2;
  const edit = $("#readonlyEditApplicantBtn");
  if (edit) edit.disabled = !hasSelection;
}

function renderReadonlyCard(applicantId) {
  const box = $("#readonlyCard");
  const applicant = stateRef.applicants.find(row => row.applicant_id === applicantId);
  if (!applicant) {
    box.innerHTML = `<div class="empty">Select applicant to view copy-ready details.</div>`;
    return;
  }
  const data = buildReadonly(applicant, stateRef.people);
  const name = data.applicant_name || "Applicant";
  const phone = onlyDigits(data["Phone Number"]);
  const aadhaar = onlyDigits(data["Aadhaar Number"]);
  box.innerHTML = `<div class="read-card enhanced-read-card"><h3>${esc(name)}</h3><div class="copy-help">Click on text to copy</div>${photoDownloadBlock(applicant, name)}<section class="read-section"><div class="copy-table-grid two-cols">${readCell("EPIC ID", data["EPIC ID"])}${readCell("Phone Number", phone)}</div></section><section class="read-section"><h4>Mapping Details</h4><div class="copy-table-grid two-cols">${readCell("Type", data["Mapping Type"], false)}${readCell("Relationship", data["Mapping Relation"], false)}</div><div class="copy-table-grid two-cols">${readCell("State", data["Mapping State"], false)}${readCell("District", data["Mapping District"], false)}</div><div class="copy-table-grid three-cols">${readCell("AC No", data["Mapping AC No Display"], false)}${readCell("Part No", data["Mapping Part No"], false)}${readCell("Sl No", data["Mapping Serial No"], false)}</div><div class="copy-table-grid four-cols">${readCell("Mapper Name", data["Mapper Name as per 2002"] || data["Mapping Name"], false)}${readCell("2002 EPIC Number", data["Mapper 2002 EPIC Number"], false)}${readCell("Relative", data["Mapper Relative Name"], false)}${readCell("Relation with Relative", data["Mapper Relationship with Relative"], false)}</div></section><section class="read-section"><h4>Applicant Details</h4><div class="copy-table-grid two-cols">${readCell("Date of Birth", dmy(data["Date of Birth"]))}${readCell("Aadhaar Number", aadhaar, true, formatAadhaar(aadhaar))}</div><h5>Father</h5><div class="copy-table-grid two-cols">${readCell("Name", data["Father’s Name"])}${readCell("EPIC Number", data["Father’s EPIC Number"])}</div><h5>Mother</h5><div class="copy-table-grid two-cols">${readCell("Name", data["Mother’s Name"])}${readCell("EPIC Number", data["Mother’s EPIC Number"])}</div><h5>Spouse</h5><div class="copy-table-grid two-cols">${readCell("Name", data["Spouse’s Name"])}${readCell("EPIC Number", data["Spouse’s EPIC Number"])}</div></section></div>`;
  box.querySelectorAll("[data-copy]").forEach(node => {
    node.addEventListener("click", () => copyText(node.dataset.copy));
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        copyText(node.dataset.copy);
      }
    });
  });
}

function deletePerson(personId) {
  const used = stateRef.applicants.some(applicant => [applicant.person_id, applicant.mapper_person_id, applicant.father_person_id, applicant.mother_person_id, applicant.spouse_person_id].filter(Boolean).includes(personId));
  if (used) {
    toast("Cannot delete: person is used in applicants.");
    return;
  }
  if (!confirm(`Delete person ${personName(personId)}?`)) return;
  stateRef.people = stateRef.people.filter(person => person.person_id !== personId);
  commitRef();
  renderAll();
}

function deleteApplicant(applicantId) {
  const applicant = stateRef.applicants.find(row => row.applicant_id === applicantId);
  if (!confirm(`Delete applicant ${personName(applicant?.person_id)}?`)) return;
  stateRef.applicants = stateRef.applicants.filter(row => row.applicant_id !== applicantId);
  commitRef();
  renderAll();
}

function selectNext(currentId = "") {
  const rows = pendingApplicants();
  const select = $("#readonlyApplicantSelect");
  if (!rows.length) {
    select.dataset.selected = "";
    renderReadonlyPicker();
    toast("All applicants completed.");
    return;
  }
  const index = rows.findIndex(applicant => applicant.applicant_id === currentId);
  select.dataset.selected = rows[index >= 0 ? (index + 1) % rows.length : 0].applicant_id;
  renderReadonlyPicker();
}

function markComplete() {
  const id = $("#readonlyApplicantSelect").value;
  const applicant = stateRef.applicants.find(row => row.applicant_id === id);
  if (!applicant) return;
  applicant.status_completed = true;
  commitRef();
  renderApplicants();
  selectNext(id);
}

function relatedPersonIds(applicant) {
  return [applicant.person_id, applicant.mapper_person_id, applicant.father_person_id, applicant.mother_person_id, applicant.spouse_person_id].filter(Boolean);
}

function lockedPeople(source, applicantIds) {
  const selected = new Set(applicantIds);
  const people = new Set();
  source.applicants.forEach(applicant => {
    if (selected.has(applicant.applicant_id)) relatedPersonIds(applicant).forEach(id => people.add(id));
  });
  return people;
}

function filteredState(source, applicantIds, personIds = []) {
  const selectedApplicants = new Set(applicantIds);
  const selectedPeople = new Set(personIds);
  const applicants = source.applicants.filter(applicant => selectedApplicants.has(applicant.applicant_id));
  applicants.forEach(applicant => relatedPersonIds(applicant).forEach(id => selectedPeople.add(id)));
  return {
    people: source.people.filter(person => selectedPeople.has(person.person_id)),
    applicants
  };
}

function selectionModal({ title, actionLabel, source, includePeople, onConfirm }) {
  const selectedApplicants = new Set(source.applicants.map(applicant => applicant.applicant_id));
  const manualPeople = new Set(includePeople ? source.people.map(person => person.person_id) : []);
  const body = el("div", { class: "selection-modal-content" });
  const backdrop = openModal(title, body);

  function render() {
    const locked = includePeople ? lockedPeople(source, selectedApplicants) : new Set();
    const allSelected = source.applicants.every(applicant => selectedApplicants.has(applicant.applicant_id)) && (!includePeople || source.people.every(person => locked.has(person.person_id) || manualPeople.has(person.person_id)));
    body.innerHTML = `<div class="selection-summary">Select records to use. Related people are checked and locked.</div><label class="checkbox-line selection-master"><input type="checkbox" data-all ${allSelected ? "checked" : ""}><span>Select all / Unselect all</span></label><div class="selection-lists ${includePeople ? "with-people" : ""}"><section class="selection-group"><h4>Applicants</h4>${source.applicants.map(applicant => `<label class="selection-item"><input type="checkbox" data-app="${esc(applicant.applicant_id)}" ${selectedApplicants.has(applicant.applicant_id) ? "checked" : ""}><span>${esc((source.people.find(person => person.person_id === applicant.person_id) || {}).name || "Unnamed applicant")}<small>${esc((source.people.find(person => person.person_id === applicant.person_id) || {}).epic_number || "")}</small></span></label>`).join("") || `<div class="empty">No applicants.</div>`}</section>${includePeople ? `<section class="selection-group"><h4>People Data</h4>${source.people.map(person => { const lockedItem = locked.has(person.person_id); const checked = lockedItem || manualPeople.has(person.person_id); return `<label class="selection-item ${lockedItem ? "disabled" : ""}"><input type="checkbox" data-person="${esc(person.person_id)}" ${checked ? "checked" : ""} ${lockedItem ? "disabled" : ""}><span>${esc(person.name || "Unnamed person")}<small>${esc(person.epic_number || person.epic_number_2002 || "")}${lockedItem ? " — required by selected applicant" : ""}</small></span></label>`; }).join("") || `<div class="empty">No people.</div>`}</section>` : ""}</div><div class="selection-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="button" data-ok>${esc(actionLabel)}</button></div>`;

    body.querySelector("[data-all]").addEventListener("change", event => {
      selectedApplicants.clear();
      manualPeople.clear();
      if (event.target.checked) {
        source.applicants.forEach(applicant => selectedApplicants.add(applicant.applicant_id));
        if (includePeople) source.people.forEach(person => manualPeople.add(person.person_id));
      }
      render();
    });
    body.querySelectorAll("[data-app]").forEach(input => {
      input.addEventListener("change", () => {
        input.checked ? selectedApplicants.add(input.dataset.app) : selectedApplicants.delete(input.dataset.app);
        render();
      });
    });
    body.querySelectorAll("[data-person]").forEach(input => {
      input.addEventListener("change", () => {
        input.checked ? manualPeople.add(input.dataset.person) : manualPeople.delete(input.dataset.person);
        render();
      });
    });
    body.querySelector("[data-cancel]").addEventListener("click", () => closeModal(backdrop));
    body.querySelector("[data-ok]").addEventListener("click", () => {
      const lockedIds = includePeople ? lockedPeople(source, selectedApplicants) : new Set();
      const people = new Set([...manualPeople, ...lockedIds]);
      if (!selectedApplicants.size && !people.size) {
        toast("Select at least one record.");
        return;
      }
      closeModal(backdrop);
      onConfirm([...selectedApplicants], [...people]);
    });
  }

  render();
}

function exportSelection() {
  selectionModal({
    title: "Export JSON",
    actionLabel: "Export JSON",
    source: stateRef,
    includePeople: true,
    onConfirm: (applicantIds, personIds) => {
      const selected = filteredState(stateRef, applicantIds, personIds);
      const blob = new Blob([JSON.stringify({ people_database: selected.people, applicant_database: selected.applicants }, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${sirFileBaseFromState(selected)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  });
}

async function importSelection(file) {
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    selectionModal({
      title: "Import JSON",
      actionLabel: "Import Selected",
      source: imported,
      includePeople: true,
      onConfirm: (applicantIds, personIds) => {
        backupState(stateRef);
        const selected = filteredState(imported, applicantIds, personIds);
        const people = new Map(stateRef.people.map(person => [person.person_id, person]));
        selected.people.forEach(person => people.set(person.person_id, person));
        const applicants = new Map(stateRef.applicants.map(applicant => [applicant.applicant_id, applicant]));
        selected.applicants.forEach(applicant => applicants.set(applicant.applicant_id, applicant));
        stateRef.people = [...people.values()];
        stateRef.applicants = [...applicants.values()];
        commitRef();
        renderAll();
        toast("Selected data imported.");
      }
    });
  } catch (error) {
    alert(error.message || "Import failed.");
  } finally {
    $("#importJsonInput").value = "";
  }
}

function pdfSelection(offline) {
  selectionModal({
    title: offline ? "Offline Form PDF" : "Online Form PDF",
    actionLabel: offline ? "Create Offline PDF" : "Create Online PDF",
    source: stateRef,
    includePeople: false,
    onConfirm: applicantIds => {
      const selected = filteredState(stateRef, applicantIds, stateRef.people.map(person => person.person_id));
      selected.applicants = selected.applicants.map(applicant => ({ ...applicant, export_to_pdf: true }));
      offline ? generateOfflinePdf(selected) : generatePdf(selected);
    }
  });
}

function clearAll() {
  if (confirm("Before clearing, export a JSON backup now? Press OK to export, Cancel to continue without exporting.")) downloadJson(stateRef);
  if (!confirm("Clear all people and applicants from this device? This cannot be undone unless you have a JSON backup.")) return;
  backupState(stateRef);
  stateRef.people = [];
  stateRef.applicants = [];
  clearState();
  renderAll();
  toast("All data cleared. A local backup was stored.");
}

function initTabs() {
  $$('[data-tab-target]').forEach(button => {
    button.addEventListener("click", () => {
      $$(".tab-btn").forEach(tab => tab.classList.toggle("active", tab === button));
      $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === button.dataset.tabTarget));
    });
  });
}

function initZoom() {
  const key = "sir_family_forms_zoom";
  const apply = value => {
    const zoom = Math.min(1.3, Math.max(0.8, Number(value) || 1));
    document.documentElement.style.setProperty("--app-zoom", zoom);
    localStorage.setItem(key, zoom);
  };
  apply(localStorage.getItem(key) || 1);
  $("#zoomOutBtn")?.addEventListener("click", () => apply((Number(localStorage.getItem(key) || 1) - 0.1).toFixed(2)));
  $("#zoomResetBtn")?.addEventListener("click", () => apply(1));
  $("#zoomInBtn")?.addEventListener("click", () => apply((Number(localStorage.getItem(key) || 1) + 0.1).toFixed(2)));
}

function addVersion() {
  if (!$("#appVersionBadge")) document.body.append(el("div", { id: "appVersionBadge", text: "Version 26-07-06" }));
}

export function initUI(state, commit) {
  stateRef = state;
  commitRef = commit;
  initTabs();
  initZoom();
  addVersion();
  $("#exportJsonBtn").addEventListener("click", exportSelection);
  $("#importJsonInput").addEventListener("change", event => importSelection(event.target.files[0]));
  $("#generatePdfBtn").addEventListener("click", () => pdfSelection(false));
  $("#offlinePdfBtn").addEventListener("click", () => pdfSelection(true));
  $("#clearDataBtn").addEventListener("click", clearAll);
  $("#readonlyApplicantSelect").addEventListener("change", event => {
    event.target.dataset.selected = event.target.value;
    renderReadonlyCard(event.target.value);
    syncReadonlyButtons();
  });
  $("#markCompleteBtn").addEventListener("click", markComplete);
  $("#nextApplicantBtn").addEventListener("click", () => selectNext($("#readonlyApplicantSelect").value));
  renderAll();
}

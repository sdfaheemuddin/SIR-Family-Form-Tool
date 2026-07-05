import { allReadonly, buildReadonly, formatAadhaar, onlyDigits } from "./core.js";
import { parseImportFile, sirFileBaseFromState } from "./importExport.js";
import { generatePdf, generateOfflinePdf } from "./pdf.js";

const VERSION = "26-07-06";
const WA_MESSAGE = "SIR acknowledgement";
let stateRef;
let commitRef;
let isApplying = false;
let selectionWired = false;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function cleanText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function formatDateForDisplay(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
}

function safePhotoSrc(value) {
  const src = String(value || "");
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src) ? src : "";
}

function photoExtension(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpe?g|webp|gif);base64,/i);
  if (!match) return "jpg";
  const type = match[1].toLowerCase();
  return type === "jpeg" ? "jpg" : type;
}

function safeFilePart(value) {
  return String(value || "applicant").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "applicant";
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => box.classList.remove("show"), 2400);
}

async function copyText(value) {
  const text = cleanText(value);
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.append(temp);
      temp.focus();
      temp.select();
      document.execCommand("copy");
      temp.remove();
    }
    toast("Copied.");
  } catch (err) {
    console.error("Copy failed", err);
    toast("Copy failed. Please copy manually.");
  }
}

function copyCell(label, value, displayValue = value) {
  const clean = cleanText(value);
  return `
    <div class="copy-table-cell" role="button" tabindex="0" data-copy-value="${esc(clean)}">
      <div class="copy-table-label">${esc(label)}</div>
      <div class="copy-table-value">${esc(displayValue)}</div>
    </div>`;
}

function valueCell(label, value, displayValue = value) {
  return `
    <div class="copy-table-cell no-copy">
      <div class="copy-table-label">${esc(label)}</div>
      <div class="copy-table-value">${esc(displayValue)}</div>
    </div>`;
}

function photoBlock(applicant, applicantName) {
  const photo = safePhotoSrc(applicant.photo_data);
  if (!photo) return "";
  const fileName = `${safeFilePart(applicantName)}_photo.${photoExtension(photo)}`;
  return `
    <section class="read-section photo-read-section">
      <h4>Applicant Photo</h4>
      <div class="readonly-photo-box">
        <img class="readonly-photo" src="${esc(photo)}" alt="Applicant photo">
        <a class="button-link small" href="${esc(photo)}" download="${esc(fileName)}">Download Photo</a>
      </div>
    </section>`;
}

function renderEnhancedReadonlyCard() {
  const box = $("#readonlyCard");
  const select = $("#readonlyApplicantSelect");
  if (!box || !select) return;
  const applicant = stateRef.applicants.find(a => a.applicant_id === select.value);
  if (!applicant) return;
  if (box.dataset.enhancedApplicantId === applicant.applicant_id && box.querySelector(".enhanced-read-card")) return;

  const data = buildReadonly(applicant, stateRef.people);
  const applicantName = data.applicant_name || "Applicant";
  const dobDisplay = formatDateForDisplay(data["Date of Birth"] || applicant.date_of_birth);
  const phone = onlyDigits(data["Phone Number"]);
  const aadhaarDigits = onlyDigits(data["Aadhaar Number"]);

  box.innerHTML = `
    <div class="read-card enhanced-read-card">
      <h3>${esc(applicantName)}</h3>
      <div class="copy-help">Click on text to copy</div>
      ${photoBlock(applicant, applicantName)}
      <section class="read-section">
        <div class="copy-table-grid two-cols">
          ${copyCell("EPIC ID", data["EPIC ID"])}
          ${copyCell("Phone Number", phone)}
        </div>
      </section>
      <section class="read-section">
        <h4>Mapping Details</h4>
        <div class="copy-table-grid two-cols">
          ${valueCell("Type", data["Mapping Type"])}
          ${valueCell("Relationship", data["Mapping Relation"])}
        </div>
        <div class="copy-table-grid two-cols">
          ${valueCell("State", data["Mapping State"])}
          ${valueCell("District", data["Mapping District"])}
        </div>
        <div class="copy-table-grid three-cols">
          ${valueCell("AC No", data["Mapping AC No Display"])}
          ${valueCell("Part No", data["Mapping Part No"])}
          ${valueCell("Sl No", data["Mapping Serial No"])}
        </div>
        <div class="copy-table-grid four-cols">
          ${valueCell("Mapper Name", data["Mapper Name as per 2002"] || data["Mapping Name"] || "")}
          ${valueCell("2002 EPIC Number", data["Mapper 2002 EPIC Number"] || "")}
          ${valueCell("Relative", data["Mapper Relative Name"] || "")}
          ${valueCell("Relation with Relative", data["Mapper Relationship with Relative"] || "")}
        </div>
      </section>
      <section class="read-section">
        <h4>Applicant Details</h4>
        <div class="copy-table-grid two-cols">
          ${copyCell("Date of Birth", dobDisplay)}
          ${copyCell("Aadhaar Number", aadhaarDigits, formatAadhaar(aadhaarDigits))}
        </div>
        <h5>Father</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Father’s Name"])}
          ${copyCell("EPIC Number", data["Father’s EPIC Number"])}
        </div>
        <h5>Mother</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Mother’s Name"])}
          ${copyCell("EPIC Number", data["Mother’s EPIC Number"])}
        </div>
        <h5>Spouse</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Spouse’s Name"])}
          ${copyCell("EPIC Number", data["Spouse’s EPIC Number"])}
        </div>
      </section>
    </div>`;
  box.dataset.enhancedApplicantId = applicant.applicant_id;
  box.querySelectorAll("[data-copy-value]").forEach(node => {
    const handler = () => copyText(node.dataset.copyValue || "");
    node.addEventListener("click", handler);
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  });
}

function personName(sourceState, id) {
  return sourceState.people.find(p => p.person_id === id)?.name || "Unnamed person";
}

function applicantName(sourceState, applicant) {
  return personName(sourceState, applicant.person_id) || "Unnamed applicant";
}

function relatedPersonIds(applicant) {
  return [applicant.person_id, applicant.mapper_person_id, applicant.father_person_id, applicant.mother_person_id, applicant.spouse_person_id].filter(Boolean);
}

function selectedRelatedPeople(sourceState, selectedApplicantIds) {
  const selected = new Set(selectedApplicantIds);
  const ids = new Set();
  sourceState.applicants.forEach(applicant => {
    if (selected.has(applicant.applicant_id)) relatedPersonIds(applicant).forEach(id => ids.add(id));
  });
  return ids;
}

function filteredState(sourceState, selectedApplicantIds, selectedPersonIds) {
  const appIds = new Set(selectedApplicantIds);
  const personIds = new Set(selectedPersonIds);
  const applicants = sourceState.applicants.filter(a => appIds.has(a.applicant_id));
  applicants.forEach(a => relatedPersonIds(a).forEach(id => personIds.add(id)));
  const people = sourceState.people.filter(p => personIds.has(p.person_id));
  return { people, applicants };
}

function pdfState(sourceState, selectedApplicantIds) {
  const picked = filteredState(sourceState, selectedApplicantIds, sourceState.people.map(p => p.person_id));
  picked.applicants = picked.applicants.map(a => ({ ...a, export_to_pdf: true }));
  return picked;
}

function downloadFilteredJson(sourceState, selectedApplicantIds, selectedPersonIds) {
  const picked = filteredState(sourceState, selectedApplicantIds, selectedPersonIds);
  const payload = {
    people_database: picked.people,
    applicant_database: picked.applicants,
    readonly_applicant_data: allReadonly(picked.applicants, picked.people)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sirFileBaseFromState(picked)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function mergeImportedData(imported, selectedApplicantIds, selectedPersonIds) {
  const appIds = new Set(selectedApplicantIds);
  const personIds = new Set(selectedPersonIds);
  imported.applicants.forEach(a => { if (appIds.has(a.applicant_id)) relatedPersonIds(a).forEach(id => personIds.add(id)); });
  const peopleById = new Map(stateRef.people.map(p => [p.person_id, p]));
  imported.people.forEach(p => { if (personIds.has(p.person_id)) peopleById.set(p.person_id, p); });
  const applicantsById = new Map(stateRef.applicants.map(a => [a.applicant_id, a]));
  imported.applicants.forEach(a => { if (appIds.has(a.applicant_id)) applicantsById.set(a.applicant_id, a); });
  stateRef.people = Array.from(peopleById.values());
  stateRef.applicants = Array.from(applicantsById.values());
  commitRef?.();
  toast("Selected data imported.");
  setTimeout(() => window.location.reload(), 500);
}

function openSelectionModal({ title, actionLabel, sourceState, includePeople = false, onConfirm }) {
  const root = $("#modalRoot") || document.body;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal selection-modal";
  backdrop.append(modal);
  root.append(backdrop);

  const selectedApplicants = new Set(sourceState.applicants.map(a => a.applicant_id));
  const manualPeople = new Set(includePeople ? sourceState.people.map(p => p.person_id) : []);

  function render() {
    const lockedPeople = includePeople ? selectedRelatedPeople(sourceState, selectedApplicants) : new Set();
    const allApplicantChecked = sourceState.applicants.length > 0 && sourceState.applicants.every(a => selectedApplicants.has(a.applicant_id));
    const allPeopleChecked = !includePeople || sourceState.people.every(p => lockedPeople.has(p.person_id) || manualPeople.has(p.person_id));
    const allChecked = allApplicantChecked && allPeopleChecked;
    modal.innerHTML = `
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="small secondary" data-close-selection>Close</button>
      </div>
      <div class="selection-summary">Select the records to use. Related people are locked when an applicant is selected.</div>
      <label class="checkbox-line selection-master">
        <input type="checkbox" data-select-all ${allChecked ? "checked" : ""}>
        <span>Select all / Unselect all</span>
      </label>
      <div class="selection-lists ${includePeople ? "with-people" : ""}">
        <section class="selection-group">
          <h4>Applicants</h4>
          ${sourceState.applicants.length ? sourceState.applicants.map(a => `
            <label class="selection-item">
              <input type="checkbox" data-applicant-choice="${esc(a.applicant_id)}" ${selectedApplicants.has(a.applicant_id) ? "checked" : ""}>
              <span>${esc(applicantName(sourceState, a))}<small>${esc(sourceState.people.find(p => p.person_id === a.person_id)?.epic_number || "")}</small></span>
            </label>`).join("") : `<div class="empty">No applicants available.</div>`}
        </section>
        ${includePeople ? `<section class="selection-group">
          <h4>People Data</h4>
          ${sourceState.people.length ? sourceState.people.map(p => {
            const locked = lockedPeople.has(p.person_id);
            const checked = locked || manualPeople.has(p.person_id);
            return `
              <label class="selection-item ${locked ? "disabled" : ""}">
                <input type="checkbox" data-person-choice="${esc(p.person_id)}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""}>
                <span>${esc(p.name || "Unnamed person")}<small>${esc(p.epic_number || p.epic_number_2002 || "")}${locked ? " — required by selected applicant" : ""}</small></span>
              </label>`;
          }).join("") : `<div class="empty">No people data available.</div>`}
        </section>` : ""}
      </div>
      <div class="selection-actions">
        <button type="button" class="secondary" data-close-selection>Cancel</button>
        <button type="button" data-confirm-selection>${esc(actionLabel)}</button>
      </div>`;

    modal.querySelectorAll("[data-close-selection]").forEach(btn => btn.addEventListener("click", () => backdrop.remove()));
    modal.querySelector("[data-select-all]")?.addEventListener("change", event => {
      const checked = event.target.checked;
      selectedApplicants.clear();
      if (checked) sourceState.applicants.forEach(a => selectedApplicants.add(a.applicant_id));
      manualPeople.clear();
      if (checked && includePeople) sourceState.people.forEach(p => manualPeople.add(p.person_id));
      render();
    });
    modal.querySelectorAll("[data-applicant-choice]").forEach(input => input.addEventListener("change", event => {
      if (event.target.checked) selectedApplicants.add(event.target.dataset.applicantChoice);
      else selectedApplicants.delete(event.target.dataset.applicantChoice);
      render();
    }));
    modal.querySelectorAll("[data-person-choice]").forEach(input => input.addEventListener("change", event => {
      if (event.target.checked) manualPeople.add(event.target.dataset.personChoice);
      else manualPeople.delete(event.target.dataset.personChoice);
      render();
    }));
    modal.querySelector("[data-confirm-selection]")?.addEventListener("click", () => {
      const lockedPeople = includePeople ? selectedRelatedPeople(sourceState, selectedApplicants) : new Set();
      const selectedPeople = new Set([...manualPeople, ...lockedPeople]);
      if (!selectedApplicants.size && !selectedPeople.size) {
        toast("Select at least one record.");
        return;
      }
      backdrop.remove();
      onConfirm([...selectedApplicants], [...selectedPeople]);
    });
  }
  render();
}

function handleExportClick(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  openSelectionModal({
    title: "Export JSON",
    actionLabel: "Export JSON",
    sourceState: stateRef,
    includePeople: true,
    onConfirm: (appIds, personIds) => {
      downloadFilteredJson(stateRef, appIds, personIds);
      toast("Selected JSON exported.");
    }
  });
}

function handlePdfClick(event, offline = false) {
  event.preventDefault();
  event.stopImmediatePropagation();
  openSelectionModal({
    title: offline ? "Offline Form PDF" : "Online Form PDF",
    actionLabel: offline ? "Create Offline PDF" : "Create Online PDF",
    sourceState: stateRef,
    includePeople: false,
    onConfirm: appIds => {
      const picked = pdfState(stateRef, appIds);
      if (offline) generateOfflinePdf(picked);
      else generatePdf(picked);
      toast("Selected PDF print page opened.");
    }
  });
}

async function handleImportChange(event) {
  event.stopImmediatePropagation();
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    input.value = "";
    openSelectionModal({
      title: "Import JSON",
      actionLabel: "Import Selected",
      sourceState: imported,
      includePeople: true,
      onConfirm: (appIds, personIds) => mergeImportedData(imported, appIds, personIds)
    });
  } catch (err) {
    console.error("Import failed", err);
    input.value = "";
    alert(err.message || "Import failed.");
  }
}

function wireSelectionActions() {
  if (selectionWired) return;
  $("#exportJsonBtn")?.addEventListener("click", handleExportClick, true);
  $("#generatePdfBtn")?.addEventListener("click", event => handlePdfClick(event, false), true);
  $("#offlinePdfBtn")?.addEventListener("click", event => handlePdfClick(event, true), true);
  $("#importJsonInput")?.addEventListener("change", handleImportChange, true);
  selectionWired = true;
}

function setupTabs() {
  const main = document.querySelector("main.grid");
  const readonly = $("#readonlySection");
  const applicants = $("#applicantsSection");
  const people = $("#peopleSection");
  if (!main || !readonly || !applicants || !people || $(".app-tabs")) return;
  main.classList.remove("grid");
  main.classList.add("tabbed-main");
  const tabs = document.createElement("div");
  tabs.className = "app-tabs";
  tabs.innerHTML = `
    <button type="button" class="tab-btn active" data-tab-target="readonlyTab">Applicant Data</button>
    <button type="button" class="tab-btn" data-tab-target="databaseTab">Database</button>`;
  const readonlyTab = document.createElement("div");
  readonlyTab.id = "readonlyTab";
  readonlyTab.className = "tab-panel active";
  const databaseTab = document.createElement("div");
  databaseTab.id = "databaseTab";
  databaseTab.className = "tab-panel database-grid";
  main.innerHTML = "";
  main.append(tabs, readonlyTab, databaseTab);
  readonlyTab.append(readonly);
  databaseTab.append(applicants, people);
  tabs.addEventListener("click", event => {
    const btn = event.target.closest("[data-tab-target]");
    if (!btn) return;
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === btn.dataset.tabTarget));
  });
}

function updateStaticLabels() {
  const peopleTitle = $("#peopleSection h2");
  const applicantTitle = $("#applicantsSection h2");
  const readonlyTitle = $("#readonlySection h2");
  if (peopleTitle) peopleTitle.textContent = "People Database";
  if (applicantTitle) applicantTitle.textContent = "Applicant Database";
  if (readonlyTitle) readonlyTitle.textContent = "Applicant Data";
  const pickerLabel = $("#readonlySection .readonly-picker .stacked");
  if (pickerLabel) {
    const textNode = Array.from(pickerLabel.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes("Select incomplete applicant"));
    if (textNode) textNode.textContent = "Select applicant ";
  }
}

function addNewApplicantButton() {
  const actions = $(".readonly-actions-bottom");
  if (!actions || $("#readonlyNewApplicantBtn")) return;
  const btn = document.createElement("button");
  btn.id = "readonlyNewApplicantBtn";
  btn.type = "button";
  btn.className = "secondary";
  btn.textContent = "New Applicant";
  btn.addEventListener("click", () => $("#addApplicantBtn")?.click());
  actions.append(btn);
}

function addVersionBadge() {
  if ($("#appVersionBadge")) return;
  const badge = document.createElement("div");
  badge.id = "appVersionBadge";
  badge.textContent = `Version ${VERSION}`;
  document.body.append(badge);
}

function updateWhatsappLinks() {
  $$("a[href^='https://wa.me/91']").forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set("text", WA_MESSAGE);
    link.href = url.toString();
  });
}

function move2002EpicToLast() {
  $$(".details-2002").forEach(box => {
    const epicLabel = Array.from(box.querySelectorAll(".stacked span")).find(span => span.textContent.trim() === "2002 EPIC number");
    const epicWrap = epicLabel?.closest(".stacked");
    if (epicWrap && epicWrap !== box.lastElementChild) box.append(epicWrap);
  });
}

function applyEnhancements() {
  if (isApplying) return;
  isApplying = true;
  setupTabs();
  updateStaticLabels();
  addNewApplicantButton();
  addVersionBadge();
  updateWhatsappLinks();
  move2002EpicToLast();
  wireSelectionActions();
  renderEnhancedReadonlyCard();
  isApplying = false;
}

export function initEnhancements(state, commit) {
  stateRef = state;
  commitRef = commit;
  applyEnhancements();
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(applyEnhancements, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

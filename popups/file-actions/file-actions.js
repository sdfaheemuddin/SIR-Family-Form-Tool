import { backupState } from "../../storage.js";
import { parseImportFile, sirFileBaseFromState } from "../../importExport.js";
import { generatePdf, generateOfflinePdf } from "../../pdf.js";
import { onlyDigits } from "../../core.js";

let modalDepth = 0;

const $ = selector => document.querySelector(selector);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
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

function hasAadhaar(applicant) {
  return onlyDigits(applicant?.aadhaar_number || "").length === 12;
}

function selectionModal({ title, actionLabel, source, includePeople, requireAadhaar = false, onConfirm }) {
  const eligibleApplicants = applicant => !requireAadhaar || hasAadhaar(applicant);
  const selectedApplicants = new Set(source.applicants.filter(eligibleApplicants).map(applicant => applicant.applicant_id));
  const manualPeople = new Set(includePeople ? source.people.map(person => person.person_id) : []);
  const body = el("div", { class: "selection-modal-content" });
  const backdrop = openModal(title, body);

  function render() {
    const locked = includePeople ? lockedPeople(source, selectedApplicants) : new Set();
    const selectableApplicants = source.applicants.filter(eligibleApplicants);
    const allSelected = selectableApplicants.length > 0 && selectableApplicants.every(applicant => selectedApplicants.has(applicant.applicant_id)) && (!includePeople || source.people.every(person => locked.has(person.person_id) || manualPeople.has(person.person_id)));
    body.innerHTML = `<div class="selection-summary">Select records to use. Related people are checked and locked.</div><label class="checkbox-line selection-master"><input type="checkbox" data-all ${allSelected ? "checked" : ""}><span>Select all / Unselect all</span></label><div class="selection-lists ${includePeople ? "with-people" : ""}"><section class="selection-group"><h4>Applicants</h4>${source.applicants.map(applicant => { const eligible = eligibleApplicants(applicant); const person = source.people.find(row => row.person_id === applicant.person_id) || {}; return `<label class="selection-item ${eligible ? "" : "disabled"}"><input type="checkbox" data-app="${esc(applicant.applicant_id)}" ${selectedApplicants.has(applicant.applicant_id) ? "checked" : ""} ${eligible ? "" : "disabled"}><span>${esc(person.name || "Unnamed applicant")}<small>${esc(person.epic_number || "")}${eligible ? "" : " — Aadhaar number not provided, it's mandatory for online."}</small></span></label>`; }).join("") || `<div class="empty">No applicants.</div>`}</section>${includePeople ? `<section class="selection-group"><h4>People Data</h4>${source.people.map(person => { const lockedItem = locked.has(person.person_id); const checked = lockedItem || manualPeople.has(person.person_id); return `<label class="selection-item ${lockedItem ? "disabled" : ""}"><input type="checkbox" data-person="${esc(person.person_id)}" ${checked ? "checked" : ""} ${lockedItem ? "disabled" : ""}><span>${esc(person.name || "Unnamed person")}<small>${esc(person.epic_number || person.epic_number_2002 || "")}${lockedItem ? " — required by selected applicant" : ""}</small></span></label>`; }).join("") || `<div class="empty">No people.</div>`}</section>` : ""}</div><div class="selection-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="button" data-ok>${esc(actionLabel)}</button></div>`;

    body.querySelector("[data-all]").addEventListener("change", event => {
      selectedApplicants.clear();
      manualPeople.clear();
      if (event.target.checked) {
        selectableApplicants.forEach(applicant => selectedApplicants.add(applicant.applicant_id));
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
        alert("Select at least one record.");
        return;
      }
      closeModal(backdrop);
      onConfirm([...selectedApplicants], [...people]);
    });
  }

  render();
}

function exportSelection(state) {
  selectionModal({
    title: "Export JSON",
    actionLabel: "Export JSON",
    source: state,
    includePeople: true,
    onConfirm: (applicantIds, personIds) => {
      const selected = filteredState(state, applicantIds, personIds);
      const blob = new Blob([JSON.stringify({ people_database: selected.people, applicant_database: selected.applicants }, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${sirFileBaseFromState(selected)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  });
}

async function importSelection(file, state, commit, renderAll, toast) {
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    selectionModal({
      title: "Import JSON",
      actionLabel: "Import Selected",
      source: imported,
      includePeople: true,
      onConfirm: (applicantIds, personIds) => {
        backupState(state);
        const selected = filteredState(imported, applicantIds, personIds);
        const people = new Map(state.people.map(person => [person.person_id, person]));
        selected.people.forEach(person => people.set(person.person_id, person));
        const applicants = new Map(state.applicants.map(applicant => [applicant.applicant_id, applicant]));
        selected.applicants.forEach(applicant => applicants.set(applicant.applicant_id, applicant));
        state.people = [...people.values()];
        state.applicants = [...applicants.values()];
        commit();
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

function pdfSelection(offline, state) {
  selectionModal({
    title: offline ? "Offline Form PDF" : "Online Form PDF",
    actionLabel: offline ? "Create Offline PDF" : "Create Online PDF",
    source: state,
    includePeople: false,
    requireAadhaar: !offline,
    onConfirm: applicantIds => {
      const selected = filteredState(state, applicantIds, state.people.map(person => person.person_id));
      selected.applicants = selected.applicants.map(applicant => ({ ...applicant, export_to_pdf: true }));
      offline ? generateOfflinePdf(selected) : generatePdf(selected);
    }
  });
}

export function initFileActions({ state, commit, renderAll, toast }) {
  $("#exportJsonBtn").addEventListener("click", () => exportSelection(state));
  $("#importJsonInput").addEventListener("change", event => importSelection(event.target.files[0], state, commit, renderAll, toast));
  $("#generatePdfBtn").addEventListener("click", () => pdfSelection(false, state));
  $("#offlinePdfBtn").addEventListener("click", () => pdfSelection(true, state));
}

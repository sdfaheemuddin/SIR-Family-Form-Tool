import { RELATIONSHIPS, blankApplicant, formatAadhaar, has2002Details, hasEpic, normalizeApplicant, onlyDigits, validateApplicant } from "../core.js";
import { openPersonPopup } from "./person-popup.js?v=26-07-06-add-new-person";
import { openPhotoPopup } from "./photo-popup.js";

const ADD_NEW = "__add_new__";
let stateRef;
let commitRef;
let templateText = "";

const $ = (selector, root = document) => root.querySelector(selector);

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch("./popups/applicant-popup.html?v=26-07-06-add-new-person");
  if (!response.ok) throw new Error("Could not load Applicant popup template.");
  templateText = await response.text();
  return templateText;
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 2200);
}

function openShell(title) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop native-applicant-popup";
  backdrop.innerHTML = `<div class="modal"><div class="modal-head"><h3>${title}</h3><button type="button" class="small secondary" data-close>Close</button></div><div data-body></div></div>`;
  backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());
  $("#modalRoot").append(backdrop);
  return backdrop;
}

function optionList({ filter = null, exclude = new Set(), add = true, blank = true, force = [] } = {}) {
  const forced = force.map(id => stateRef.people.find(p => p.person_id === id)).filter(Boolean);
  const forcedIds = new Set(forced.map(p => p.person_id));
  const rows = stateRef.people
    .filter(p => !forcedIds.has(p.person_id))
    .filter(p => !filter || filter(p))
    .filter(p => !exclude.has(p.person_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    blank ? `<option value="">Select</option>` : "",
    add ? `<option value="${ADD_NEW}">Add New</option>` : "",
    ...forced.concat(rows).map(p => `<option value="${p.person_id}">${p.name}${p.epic_number ? " — " + p.epic_number : ""}${has2002Details(p) ? " — 2002" : ""}</option>`)
  ].join("");
}

function keep(select, value) {
  if (value && [...select.options].some(option => option.value === value)) select.value = value;
}

function safeChoice(value, exclude) {
  return value && !exclude.has(value) ? value : "";
}

function disableSelect(select, disabled) {
  select.disabled = Boolean(disabled);
  select.closest("label")?.classList.toggle("disabled-field", Boolean(disabled));
}

function syncPhoto(form, photoData) {
  const preview = $("[data-photo-preview]", form);
  const remove = $("[data-remove-photo]", form);
  preview.hidden = !photoData;
  remove.hidden = !photoData;
  if (photoData) preview.src = photoData;
  else preview.removeAttribute("src");
}

function setSelects(form, draft, forcedValues = null) {
  const applicant = form.elements.person_id;
  const relation = form.elements.mapper_relationship;
  const mapper = form.elements.mapper_person_id;
  const father = form.elements.father_person_id;
  const mother = form.elements.mother_person_id;
  const spouse = form.elements.spouse_person_id;
  const usedApplicants = new Set(stateRef.applicants.filter(a => a.applicant_id !== draft.applicant_id).map(a => a.person_id));
  const old = forcedValues || {
    applicant: applicant.value,
    mapper: mapper.value,
    father: father.value,
    mother: mother.value,
    spouse: spouse.value
  };

  applicant.innerHTML = optionList({ filter: hasEpic, exclude: usedApplicants, force: old.applicant ? [old.applicant] : [] });
  keep(applicant, old.applicant);
  const applicantId = applicant.value || "";

  if (relation.value === "Self") {
    mapper.innerHTML = optionList({ add: false, blank: false, force: applicantId ? [applicantId] : [] });
    mapper.value = applicantId || "";
    disableSelect(mapper, true);
  } else {
    mapper.innerHTML = optionList({ filter: has2002Details, force: old.mapper ? [old.mapper] : [] });
    keep(mapper, old.mapper);
    disableSelect(mapper, false);
  }
  const mapperId = mapper.value || "";

  if (relation.value === "Father" && mapperId) {
    father.innerHTML = optionList({ add: false, blank: false, force: [mapperId] });
    father.value = mapperId;
    disableSelect(father, true);
  } else {
    const fatherExclude = new Set([applicantId, old.mother, old.spouse].filter(Boolean));
    const fatherValue = safeChoice(old.father, fatherExclude);
    father.innerHTML = optionList({ exclude: fatherExclude, force: fatherValue ? [fatherValue] : [] });
    keep(father, fatherValue);
    disableSelect(father, false);
  }
  const fatherId = father.value || "";

  if (relation.value === "Mother" && mapperId) {
    mother.innerHTML = optionList({ add: false, blank: false, force: [mapperId] });
    mother.value = mapperId;
    disableSelect(mother, true);
  } else {
    const motherExclude = new Set([applicantId, fatherId, old.spouse].filter(Boolean));
    const motherValue = safeChoice(old.mother, motherExclude);
    mother.innerHTML = optionList({ exclude: motherExclude, force: motherValue ? [motherValue] : [] });
    keep(mother, motherValue);
    disableSelect(mother, false);
  }
  const motherId = mother.value || "";

  const spouseExclude = new Set([applicantId, mapperId, fatherId, motherId].filter(Boolean));
  const spouseValue = safeChoice(old.spouse, spouseExclude);
  spouse.innerHTML = optionList({ exclude: spouseExclude, force: spouseValue ? [spouseValue] : [] });
  keep(spouse, spouseValue);
}

async function handleAddNew(select, form, draft) {
  if (select.value !== ADD_NEW) return false;
  select.value = "";
  const isApplicant = select.name === "person_id";
  const isMapper = select.name === "mapper_person_id";
  await openPersonPopup({
    fromApplicant: isApplicant,
    fromMapper: isMapper,
    onSaved: person => {
      if (!person) return;
      setSelects(form, draft);
      select.value = person.person_id;
      setSelects(form, draft);
    }
  });
  return true;
}

export async function openApplicantPopup(applicantId = "") {
  const existing = stateRef.applicants.find(a => a.applicant_id === applicantId);
  const draft = existing ? { ...existing } : blankApplicant();
  const shell = openShell(existing ? "Edit Applicant" : "Add Applicant");
  shell.querySelector("[data-body]").innerHTML = await getTemplate();
  const form = shell.querySelector("form");
  const errorBox = form.querySelector("[data-error]");
  let photoData = draft.photo_data || "";

  form.elements.mapper_relationship.innerHTML = `<option value="">Select</option>` + RELATIONSHIPS.map(r => `<option value="${r}">${r}</option>`).join("");
  form.elements.mapper_relationship.value = draft.mapper_relationship || "";
  form.elements.phone_number.value = draft.phone_number || "";
  form.elements.aadhaar_number.value = formatAadhaar(draft.aadhaar_number || "");
  form.elements.date_of_birth.value = draft.date_of_birth || "";
  setSelects(form, draft, {
    applicant: draft.person_id || "",
    mapper: draft.mapper_person_id || "",
    father: draft.father_person_id || "",
    mother: draft.mother_person_id || "",
    spouse: draft.spouse_person_id || ""
  });
  syncPhoto(form, photoData);

  form.elements.phone_number.addEventListener("input", () => {
    form.elements.phone_number.value = onlyDigits(form.elements.phone_number.value).slice(0, 10);
  });
  form.elements.aadhaar_number.addEventListener("input", () => {
    form.elements.aadhaar_number.value = formatAadhaar(form.elements.aadhaar_number.value);
  });
  form.elements.photo_file.addEventListener("change", async () => {
    const file = form.elements.photo_file.files?.[0];
    if (!file) return;
    try {
      photoData = await openPhotoPopup(file);
      syncPhoto(form, photoData);
      toast("Photo added to popup. Click Save Applicant to save.");
    } catch (error) {
      if (error.message !== "Photo cancelled.") toast(error.message || "Could not add photo.");
    } finally {
      form.elements.photo_file.value = "";
    }
  });
  $("[data-remove-photo]", form).addEventListener("click", () => { photoData = ""; syncPhoto(form, photoData); });
  $("[data-cancel]", form).addEventListener("click", () => shell.remove());

  [form.elements.person_id, form.elements.mapper_person_id, form.elements.father_person_id, form.elements.mother_person_id, form.elements.spouse_person_id].forEach(select => {
    select.addEventListener("change", async () => {
      if (await handleAddNew(select, form, draft)) return;
      setSelects(form, draft);
    });
  });
  form.elements.mapper_relationship.addEventListener("change", () => setSelects(form, draft));

  form.addEventListener("submit", event => {
    event.preventDefault();
    const applicant = normalizeApplicant({
      ...draft,
      person_id: form.elements.person_id.value,
      mapper_relationship: form.elements.mapper_relationship.value,
      mapper_person_id: form.elements.mapper_person_id.value,
      phone_number: form.elements.phone_number.value,
      aadhaar_number: form.elements.aadhaar_number.value,
      date_of_birth: form.elements.date_of_birth.value,
      father_person_id: form.elements.father_person_id.value,
      mother_person_id: form.elements.mother_person_id.value,
      spouse_person_id: form.elements.spouse_person_id.value,
      photo_data: photoData
    });
    const result = validateApplicant(applicant, stateRef.people, stateRef.applicants, applicant.applicant_id);
    errorBox.style.display = result.errors.length ? "block" : "none";
    errorBox.textContent = result.errors.join("\n");
    if (result.errors.length) return;
    if (result.duplicateAadhaarApplicant && !confirm("Another applicant has the same Aadhaar number. Save anyway?")) return;
    const index = stateRef.applicants.findIndex(a => a.applicant_id === applicant.applicant_id);
    if (index >= 0) stateRef.applicants[index] = applicant;
    else stateRef.applicants.push(applicant);
    commitRef();
    shell.remove();
    toast("Applicant saved.");
    location.reload();
  });
}

export function initApplicantPopupOverrides(state, commit) {
  stateRef = state;
  commitRef = commit;
  document.addEventListener("click", event => {
    const addButton = event.target.closest("#addApplicantBtn,#readonlyNewApplicantBtn");
    const editButton = event.target.closest("[data-edit-applicant],#readonlyEditApplicantBtn");
    if (!addButton && !editButton) return;
    event.preventDefault();
    event.stopPropagation();
    let id = editButton?.dataset.editApplicant || "";
    if (editButton && editButton.id === "readonlyEditApplicantBtn") id = $("#readonlyApplicantSelect")?.value || "";
    if (editButton && !id) return toast("Select an applicant first.");
    openApplicantPopup(id).catch(error => {
      console.error(error);
      alert(error.message || "Could not open Applicant popup.");
    });
  }, true);
}

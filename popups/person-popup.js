import { blankPerson, has2002Details, normalizeEpic, normalizePerson, validatePerson } from "../core.js";

let stateRef;
let commitRef;
let templateText = "";

const VERSION = "26-07-07";
const $ = (selector, root = document) => root.querySelector(selector);

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch(`./popups/person-popup.html?v=${VERSION}`);
  if (!response.ok) throw new Error("Could not load People popup template.");
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

function showModal(title) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop native-person-popup";
  backdrop.innerHTML = `<div class="modal"><div class="modal-head"><h3>${title}</h3><button type="button" class="small secondary" data-close>Close</button></div><div data-body></div></div>`;
  backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());
  $("#modalRoot").append(backdrop);
  return backdrop;
}

function setField(form, name, value) {
  const field = form.elements[name];
  if (!field) return;
  if (field.type === "checkbox") field.checked = Boolean(value);
  else field.value = value || "";
}

function readPerson(form, draft) {
  return normalizePerson({
    ...draft,
    name: form.elements.name.value,
    epic_number: form.elements.epic_number.value,
    allow_nonstandard_epic: form.elements.allow_nonstandard_epic.checked,
    is_2002_available: form.elements.is_2002_available.checked,
    state_2002: form.elements.state_2002.value,
    district_2002: form.elements.district_2002.value,
    ac_name_2002: form.elements.ac_name_2002.value,
    ac_no_2002: form.elements.ac_no_2002.value,
    part_no_2002: form.elements.part_no_2002.value,
    sl_no_2002: form.elements.sl_no_2002.value,
    name_as_per_2002: form.elements.name_as_per_2002.value,
    relative_name_2002: form.elements.relative_name_2002.value,
    relative_relationship_2002: form.elements.relative_relationship_2002.value,
    epic_number_2002: form.elements.epic_number_2002.value
  });
}

function sync2002(form) {
  const enabled = form.elements.is_2002_available.checked;
  form.querySelector("[data-details-2002]").hidden = !enabled;
  ["state_2002", "district_2002", "ac_no_2002", "part_no_2002", "sl_no_2002"].forEach(name => {
    form.elements[name].required = enabled;
  });
}

function hasEpicValidationError(errors) {
  return errors.some(error => /EPIC/i.test(error) && !/2002/i.test(error));
}

export async function openPersonPopup(options = {}) {
  const personId = typeof options === "string" ? options : (options.personId || "");
  const activeState = options.state || stateRef;
  const activeCommit = options.commit || commitRef;
  if (!activeState || !activeCommit) throw new Error("People popup is not initialized.");

  const fromMapper = Boolean(options.fromMapper);
  const fromApplicant = Boolean(options.fromApplicant);
  const onSaved = typeof options.onSaved === "function" ? options.onSaved : null;
  const existing = activeState.people.find(p => p.person_id === personId);
  const draft = existing ? { ...existing } : blankPerson();
  const modal = showModal(existing ? "Edit Person" : "Add Person");
  modal.querySelector("[data-body]").innerHTML = await getTemplate();
  const form = modal.querySelector("form");
  const errorBox = form.querySelector("[data-error]");
  const overrideRule = form.querySelector("[data-override-rule]");
  const epicLabel = form.querySelector("[data-epic-label]");
  const nameWarning = form.querySelector("[data-name-warning]");

  const normalizeNameKey = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const syncDuplicateNameWarning = () => {
    if (!nameWarning) return;
    if (existing) {
      nameWarning.hidden = true;
      nameWarning.textContent = "";
      return;
    }
    const nameKey = normalizeNameKey(form.elements.name.value);
    if (!nameKey) {
      nameWarning.hidden = true;
      nameWarning.textContent = "";
      return;
    }
    const duplicate = activeState.people.find(person => normalizeNameKey(person.name) === nameKey);
    if (!duplicate) {
      nameWarning.hidden = true;
      nameWarning.textContent = "";
      return;
    }
    const epicPart = duplicate.epic_number ? ` (EPIC: ${duplicate.epic_number})` : "";
    nameWarning.hidden = false;
    nameWarning.textContent = `Warning: A person with this name already exists: ${duplicate.name}${epicPart}. Please verify before saving.`;
  };

  form.elements.epic_number.required = fromApplicant;
  if (epicLabel) {
    epicLabel.classList.toggle("required", fromApplicant);
  }

  Object.entries(draft).forEach(([key, value]) => setField(form, key, value));
  if (draft.allow_nonstandard_epic) overrideRule.hidden = false;
  if (fromMapper) {
    form.elements.is_2002_available.checked = true;
    form.elements.is_2002_available.disabled = true;
  }
  sync2002(form);

  form.elements.epic_number.addEventListener("input", () => {
    form.elements.epic_number.value = normalizeEpic(form.elements.epic_number.value);
  });
  form.elements.name.addEventListener("input", syncDuplicateNameWarning);
  form.elements.epic_number_2002.addEventListener("input", () => {
    form.elements.epic_number_2002.value = normalizeEpic(form.elements.epic_number_2002.value);
  });
  form.elements.is_2002_available.addEventListener("change", () => sync2002(form));
  form.querySelector("[data-cancel]").addEventListener("click", () => modal.remove());
  syncDuplicateNameWarning();

  form.addEventListener("submit", event => {
    event.preventDefault();
    const person = readPerson(form, draft);
    const errors = validatePerson(person, { requireEpic: fromApplicant, people: activeState.people, editingId: person.person_id });
    if (hasEpicValidationError(errors) && !person.allow_nonstandard_epic) overrideRule.hidden = false;
    errorBox.style.display = errors.length ? "block" : "none";
    errorBox.textContent = errors.join("\n");
    if (errors.length) return;
    const index = activeState.people.findIndex(p => p.person_id === person.person_id);
    if (index >= 0) activeState.people[index] = person;
    else activeState.people.push(person);
    activeCommit();
    modal.remove();
    toast("Person saved.");
    if (onSaved) onSaved(fromMapper && !has2002Details(person) ? null : person, person);
    document.dispatchEvent(new CustomEvent("sir:data-changed"));
  });
}

export function initPersonPopupOverrides(state, commit) {
  stateRef = state;
  commitRef = commit;
  const addButton = $("#addPersonBtn");
  if (addButton) addButton.onclick = () => openPersonPopup({ state, commit });
  document.addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit-person]");
    if (!editButton) return;
    event.preventDefault();
    event.stopPropagation();
    openPersonPopup({ personId: editButton.dataset.editPerson, state, commit });
  }, true);
}

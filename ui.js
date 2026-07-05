// UI rendering, modals, copy buttons, and user actions.
import {
  RELATIONSHIPS,
  blankApplicant,
  blankPerson,
  buildReadonly,
  formatAadhaar,
  has2002Details,
  hasEpic,
  normalizeApplicant,
  normalizeEpic,
  normalizePerson,
  onlyDigits,
  personReferences,
  validateApplicant,
  validateMappingNames,
  validatePerson
} from "./core.js";
import { backupState, clearState } from "./storage.js";
import { downloadJson, parseImportFile } from "./importExport.js";
import { generatePdf, generateOfflinePdf } from "./pdf.js";

const ADD_NEW = "__add_new__";

let stateRef;
let commitRef;
let modalDepth = 0;

const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  });
  children.forEach(child => node.append(child));
  return node;
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function cleanCopyText(value) {
  // Copy only the visible value: no tabs, no new lines, no accidental extra spaces.
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
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

function photoBlock(applicant, applicantName) {
  const photo = safePhotoSrc(applicant.photo_data);
  if (!photo) return "";
  const fileName = `${safeFilePart(applicantName)}_photo.${photoExtension(photo)}`;
  return `
    <section class="read-section photo-read-section">
      <h4>Applicant Photo</h4>
      <div class="readonly-photo-box">
        <img class="readonly-photo" src="${escapeHtml(photo)}" alt="Applicant photo">
        <a class="button-link small" href="${escapeHtml(photo)}" download="${escapeHtml(fileName)}">Download Photo</a>
      </div>
    </section>`;
}



function readPhotoAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read photo file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function toast(message) {
  console.log(message);
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.remove("show"), 2600);
}

function showErrors(box, errors) {
  box.style.display = errors.length ? "block" : "none";
  box.textContent = errors.join("\n");
}

function personName(id) {
  return stateRef.people.find(p => p.person_id === id)?.name || "";
}

function personEpic(id) {
  return stateRef.people.find(p => p.person_id === id)?.epic_number || "";
}

function renderAll() {
  renderPeople();
  renderApplicants();
  renderReadonlyPicker();
}

function renderPeople() {
  const wrap = $("#peopleTableWrap");
  if (!stateRef.people.length) {
    wrap.innerHTML = `<div class="empty">No people saved yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Name</th><th>EPIC</th><th>2002 Details</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${stateRef.people.map(p => `
          <tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.epic_number)}</td>
            <td>${p.is_2002_available ? `<span class="badge">Yes</span><br>${escapeHtml(p.state_2002)}, ${escapeHtml(p.district_2002)}<br>AC ${escapeHtml(p.ac_no_2002)}${p.ac_name_2002 ? "-" + escapeHtml(p.ac_name_2002) : ""}, Part ${escapeHtml(p.part_no_2002)}, Sl ${escapeHtml(p.sl_no_2002)}` : "No"}</td>
            <td>
              <div class="row-actions">
                <button class="small secondary" data-edit-person="${p.person_id}">Edit</button>
                <button class="small danger" data-delete-person="${p.person_id}">Delete</button>
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll("[data-edit-person]").forEach(btn =>
    btn.addEventListener("click", () => openPersonModal({ personId: btn.dataset.editPerson }))
  );
  wrap.querySelectorAll("[data-delete-person]").forEach(btn =>
    btn.addEventListener("click", () => deletePerson(btn.dataset.deletePerson))
  );
}

function renderApplicants() {
  const wrap = $("#applicantTableWrap");
  if (!stateRef.applicants.length) {
    wrap.innerHTML = `<div class="empty">No applicants saved yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>PDF</th><th>Applicant</th><th>DOB</th><th>Mapper</th><th>Relation</th><th>Phone</th><th>Aadhaar</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${stateRef.applicants.map(a => `
          <tr>
            <td>
              <label class="checkbox-line compact" title="Include in Online/Offline PDF">
                <input type="checkbox" data-toggle-export-pdf="${a.applicant_id}" ${a.export_to_pdf !== false ? "checked" : ""}>
              </label>
            </td>
            <td>${escapeHtml(personName(a.person_id))}<br><small>${escapeHtml(personEpic(a.person_id))}</small></td>
            <td>${escapeHtml(a.date_of_birth)}</td>
            <td>${escapeHtml(personName(a.mapper_person_id))}</td>
            <td>${escapeHtml(a.mapper_relationship)}</td>
            <td>${/^\d{10}$/.test(a.phone_number) ? `<a href="https://wa.me/91${escapeHtml(a.phone_number)}" target="_blank" rel="noopener">${escapeHtml(a.phone_number)}</a>` : escapeHtml(a.phone_number)}</td>
            <td>${escapeHtml(a.aadhaar_number)}</td>
            <td>
              <label class="checkbox-line compact">
                <input type="checkbox" data-toggle-status="${a.applicant_id}" ${a.status_completed ? "checked" : ""}>
                <span>${a.status_completed ? "Completed" : "Pending"}</span>
              </label>
            </td>
            <td>
              <div class="row-actions">
                <button class="small secondary" data-edit-applicant="${a.applicant_id}">Edit</button>
                <button class="small danger" data-delete-applicant="${a.applicant_id}">Delete</button>
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll("[data-edit-applicant]").forEach(btn =>
    btn.addEventListener("click", () => openApplicantModal(btn.dataset.editApplicant))
  );
  wrap.querySelectorAll("[data-delete-applicant]").forEach(btn =>
    btn.addEventListener("click", () => deleteApplicant(btn.dataset.deleteApplicant))
  );
  wrap.querySelectorAll("[data-toggle-status]").forEach(box =>
    box.addEventListener("change", () => toggleApplicantStatus(box.dataset.toggleStatus, box.checked))
  );
  wrap.querySelectorAll("[data-toggle-export-pdf]").forEach(box =>
    box.addEventListener("change", () => toggleApplicantPdfExport(box.dataset.toggleExportPdf, box.checked))
  );
}

function pendingApplicants() {
  return stateRef.applicants.filter(a => !a.status_completed);
}

function renderReadonlyPicker() {
  const select = $("#readonlyApplicantSelect");
  const pending = pendingApplicants();
  select.innerHTML = `<option value="">Select applicant</option>` + pending.map(a =>
    `<option value="${escapeHtml(a.applicant_id)}">${escapeHtml(personName(a.person_id) || "Unnamed applicant")}</option>`
  ).join("");
  const selected = select.dataset.selected || "";
  if (pending.some(a => a.applicant_id === selected)) select.value = selected;
  else select.value = pending[0]?.applicant_id || "";
  select.dataset.selected = select.value;
  renderReadonlyCard(select.value);
  syncReadonlyButtons();
}

function syncReadonlyButtons() {
  const hasSelection = Boolean($("#readonlyApplicantSelect")?.value);
  const markBtn = $("#markCompleteBtn");
  const nextBtn = $("#nextApplicantBtn");
  if (markBtn) markBtn.disabled = !hasSelection;
  if (nextBtn) nextBtn.disabled = pendingApplicants().length < 2;
}

function copyValueHtml(value, displayValue = value) {
  const clean = cleanCopyText(value);
  return `<a href="#" class="copy-link read-value" data-copy="${encodeURIComponent(clean)}" title="Tap to copy">${escapeHtml(displayValue)}</a>`;
}

function readField(label, value, canCopy = true, options = {}) {
  const displayValue = options.displayValue ?? value;
  const copyValue = options.copyValue ?? value;
  const valueHtml = canCopy ? copyValueHtml(copyValue, displayValue) : (options.valueHtml ?? escapeHtml(displayValue));
  return `
    <div class="read-field ${canCopy ? "" : "no-copy"}">
      <span class="read-label">${escapeHtml(label)}</span>
      ${canCopy ? valueHtml : `<span class="read-value">${valueHtml}</span>`}
    </div>`;
}

function renderReadonlyCard(applicantId) {
  const box = $("#readonlyCard");
  const applicant = stateRef.applicants.find(a => a.applicant_id === applicantId);
  if (!applicant) {
    box.innerHTML = `<div class="empty">Select an incomplete applicant to view copy-ready details.</div>`;
    return;
  }
  const data = buildReadonly(applicant, stateRef.people);
  const phone = onlyDigits(data["Phone Number"]);
  const aadhaarDigits = onlyDigits(data["Aadhaar Number"]);
  const applicantName = data.applicant_name || "Applicant";
  box.innerHTML = `
    <div class="read-card">
      <h3>${escapeHtml(applicantName)}</h3>
      ${photoBlock(applicant, applicantName)}

      <section class="read-section two-col">
        ${readField("EPIC ID", data["EPIC ID"], true)}
        ${readField("Phone Number", phone, true, { copyValue: phone })}
      </section>

      <section class="read-section">
        <h4>Mapping Details</h4>
        <div class="read-line one">${readField("Type", data["Mapping Type"], false)}</div>
        <div class="read-line two">
          ${readField("State", data["Mapping State"], false)}
          ${readField("District", data["Mapping District"], false)}
        </div>
        <div class="read-line three">
          ${readField("AC No", data["Mapping AC No Display"], false)}
          ${readField("Part No", data["Mapping Part No"], false)}
          ${readField("Sl No", data["Mapping Serial No"], false)}
        </div>
        <div class="read-line two">
          ${readField("Relationship", data["Mapping Relation"], false)}
          ${readField("Name", data["Mapping Name"], false)}
        </div>
      </section>

      <section class="read-section">
        <h4>Applicant Details</h4>
        <div class="read-line two">
          ${readField("Date of Birth", data["Date of Birth"], false)}
          ${readField("Aadhaar Number", aadhaarDigits, true, { displayValue: formatAadhaar(aadhaarDigits), copyValue: aadhaarDigits })}
        </div>
        <h5>Father</h5>
        <div class="read-line two">
          ${readField("Name", data["Father’s Name"], true)}
          ${readField("EPIC Number", data["Father’s EPIC Number"], true)}
        </div>
        <h5>Mother</h5>
        <div class="read-line two">
          ${readField("Name", data["Mother’s Name"], true)}
          ${readField("EPIC Number", data["Mother’s EPIC Number"], true)}
        </div>
        <h5>Spouse</h5>
        <div class="read-line two">
          ${readField("Name", data["Spouse’s Name"], true)}
          ${readField("EPIC Number", data["Spouse’s EPIC Number"], true)}
        </div>
      </section>
    </div>`;
  box.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", async (event) => {
    event.preventDefault();
    const value = cleanCopyText(decodeURIComponent(btn.dataset.copy || ""));
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const temp = document.createElement("textarea");
        temp.value = value;
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
  }));
}

function openModal(title, contentNode) {
  modalDepth += 1;
  const root = $("#modalRoot");
  const backdrop = el("div", { class: "modal-backdrop" });
  backdrop.style.zIndex = String(1000 + modalDepth * 20);
  const modal = el("div", { class: "modal" });
  const close = el("button", { class: "small secondary", text: "Close", onclick: () => closeModal(backdrop) });
  const head = el("div", { class: "modal-head" }, [el("h3", { text: title }), close]);
  modal.append(head, contentNode);
  backdrop.append(modal);
  root.append(backdrop);
  return backdrop;
}

function closeModal(backdrop) {
  backdrop.remove();
  modalDepth = Math.max(0, modalDepth - 1);
}

function addInput(parent, label, name, value = "", type = "text", required = false) {
  const wrap = el("label", { class: "stacked" });
  const span = el("span", { text: label, class: required ? "required" : "" });
  // Randomized name + autocomplete off prevents Chrome from showing old form-fill values.
  const inputName = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const input = el("input", {
    name: inputName,
    type,
    value,
    autocomplete: type === "date" ? "off" : "new-password",
    autocorrect: "off",
    autocapitalize: "words",
    spellcheck: "false",
    "data-field": name
  });
  input.required = Boolean(required);
  input._labelSpan = span;
  wrap.append(span, input);
  parent.append(wrap);
  return input;
}

function addCheckbox(parent, label, name, checked = false) {
  const wrap = el("label", { class: "checkbox-line" });
  const input = el("input", { name, type: "checkbox" });
  input.checked = Boolean(checked);
  wrap.append(input, el("span", { text: label }));
  parent.append(wrap);
  return input;
}

function selectOptions({ includeAddNew = false, filter = null, allowBlank = true, excludePersonIds = new Set() } = {}) {
  const list = (filter ? stateRef.people.filter(filter) : stateRef.people)
    .filter(p => !excludePersonIds.has(p.person_id))
    .sort((a, b) => Number(has2002Details(a)) - Number(has2002Details(b)) || a.name.localeCompare(b.name));
  return [
    allowBlank ? `<option value="">Select</option>` : "",
    includeAddNew ? `<option value="${ADD_NEW}">Add New</option>` : "",
    ...list.map(p => `<option value="${escapeHtml(p.person_id)}">${escapeHtml(p.name)}${p.epic_number ? " — " + escapeHtml(p.epic_number) : ""}${has2002Details(p) ? " — 2002" : ""}</option>`)
  ].join("");
}

function addPeopleSelect(parent, label, name, value, options = {}) {
  const wrap = el("label", { class: "stacked" });
  wrap.append(el("span", { text: label, class: options.required ? "required" : "" }));
  const select = el("select", { name });
  select.innerHTML = selectOptions(options);
  select.value = value || "";
  wrap.append(select);
  parent.append(wrap);
  return select;
}

function setSelectValueIfOption(select, value) {
  if (!value) return false;
  const exists = [...select.options].some(option => option.value === value);
  if (!exists) return false;
  select.value = value;
  return true;
}

function applyMappingAutofill({ applicantSel, mapperSel, relSel, fatherSel, motherSel, errorBox }) {
  const relationship = relSel.value;
  const mapperId = mapperSel.value;
  const applicantId = applicantSel.value;

  // Autofill parent/applicant fields from mapper relationship when possible.
  if (relationship === "Father" && mapperId) {
    fatherSel.value = mapperId;
  } else if (relationship === "Mother" && mapperId) {
    motherSel.value = mapperId;
  } else if (relationship === "Self") {
    if (applicantId && setSelectValueIfOption(mapperSel, applicantId)) {
      // Applicant already has 2002 details, so it can be mapper.
    } else if (mapperId && setSelectValueIfOption(applicantSel, mapperId)) {
      // Mapper can be applicant only when available in applicant dropdown.
    }
  }

  // Show an early helper error without blocking typing; final save validates again.
  const draftCheck = normalizeApplicant({
    person_id: applicantSel.value,
    mapper_person_id: mapperSel.value,
    mapper_relationship: relSel.value,
    father_person_id: fatherSel.value,
    mother_person_id: motherSel.value,
    phone_number: "x",
    aadhaar_number: "x",
    date_of_birth: "2000-01-01"
  });
  const relationErrors = validateMappingNames(draftCheck, stateRef.people);
  showErrors(errorBox, relationErrors);
}

function openPersonModal({ personId = "", onSaved = null, fromMapper = false, fromApplicant = false } = {}) {
  const existing = stateRef.people.find(p => p.person_id === personId);
  const draft = existing ? { ...existing } : blankPerson();
  if (fromMapper && !existing) draft.is_2002_available = true;

  const form = el("form", { autocomplete: "off" });
  const errorBox = el("div", { class: "error-box" });

  const basic = el("fieldset", { class: "fieldset" });
  basic.append(el("legend", { text: "Basic Details" }));
  const nameInput = addInput(basic, "Name (as per aadhaar)", "name", draft.name, "text", true);
  const epicRow = el("div", { class: "epic-inline" });
  const epicInput = addInput(epicRow, "Current EPIC number", "epic_number", draft.epic_number, "text", fromApplicant);
  epicInput.addEventListener("input", () => {
    epicInput.value = normalizeEpic(epicInput.value);
  });
  const epicOverride = addCheckbox(epicRow, "Override", "allow_nonstandard_epic", draft.allow_nonstandard_epic);
  basic.append(epicRow);

  const list2002 = el("fieldset", { class: "fieldset" });
  list2002.append(el("legend", { text: "2002 List Details" }));
  const is2002 = addCheckbox(list2002, "Name available in 2002 list", "is_2002_available", fromMapper ? true : draft.is_2002_available);
  if (fromMapper) {
    is2002.checked = true;
    is2002.disabled = true;
  }
  const details2002 = el("div", { class: "form-grid details-2002" });
  list2002.append(details2002);

  // Mandatory 2002 fields stay at the top.
  const state2002Input = addInput(details2002, "State", "state_2002", draft.state_2002);
  const district2002Input = addInput(details2002, "District", "district_2002", draft.district_2002);
  const acNameInput = addInput(details2002, "AC Name", "ac_name_2002", draft.ac_name_2002);
  const acInput = addInput(details2002, "AC No", "ac_no_2002", draft.ac_no_2002);
  const partInput = addInput(details2002, "Part No", "part_no_2002", draft.part_no_2002);
  const slInput = addInput(details2002, "Serial No", "sl_no_2002", draft.sl_no_2002);

  // Optional 2002 fields stay at the bottom.
  const nameAsPer2002Input = addInput(details2002, "Name as per 2002", "name_as_per_2002", draft.name_as_per_2002);
  const epic2002Input = addInput(details2002, "2002 EPIC number", "epic_number_2002", draft.epic_number_2002);
  epic2002Input.addEventListener("input", () => {
    epic2002Input.value = normalizeEpic(epic2002Input.value);
  });
  const relativeName2002Input = addInput(details2002, "Relative name", "relative_name_2002", draft.relative_name_2002);
  const relativeRelationship2002Input = addInput(details2002, "Relationship with relative", "relative_relationship_2002", draft.relative_relationship_2002);
  const relationListId = `relative_relation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  relativeRelationship2002Input.setAttribute("list", relationListId);
  relativeRelationship2002Input.insertAdjacentHTML("afterend", `
    <datalist id="${relationListId}">
      <option value="Father"></option>
      <option value="Husband"></option>
    </datalist>`);

  function sync2002Required() {
    details2002.hidden = !is2002.checked;
    [state2002Input, district2002Input, acInput, partInput, slInput].forEach(input => {
      input.required = is2002.checked;
      input._labelSpan?.classList.toggle("required", is2002.checked);
    });
  }
  is2002.addEventListener("change", sync2002Required);
  sync2002Required();

  const actions = el("div", { class: "modal-actions" });
  const cancel = el("button", { type: "button", class: "secondary", text: "Cancel" });
  const save = el("button", { type: "submit", text: "Save Person" });
  actions.append(cancel, save);
  form.append(errorBox, basic, list2002, actions);
  const backdrop = openModal(existing ? "Edit Person" : "Add Person", form);
  cancel.addEventListener("click", () => closeModal(backdrop));

  form.addEventListener("submit", event => {
    event.preventDefault();
    const person = normalizePerson({
      ...draft,
      name: nameInput.value,
      epic_number: epicInput.value,
      allow_nonstandard_epic: epicOverride.checked,
      is_2002_available: fromMapper ? true : is2002.checked,
      state_2002: state2002Input.value,
      district_2002: district2002Input.value,
      ac_name_2002: acNameInput.value,
      name_as_per_2002: nameAsPer2002Input.value,
      epic_number_2002: epic2002Input.value,
      relative_name_2002: relativeName2002Input.value,
      relative_relationship_2002: relativeRelationship2002Input.value,
      ac_no_2002: acInput.value,
      part_no_2002: partInput.value,
      sl_no_2002: slInput.value
    });

    const errors = validatePerson(person, { requireEpic: fromApplicant });
    showErrors(errorBox, errors);
    if (errors.length) return;

    const sameName = stateRef.people.find(p =>
      p.person_id !== person.person_id && p.name.toLowerCase() === person.name.toLowerCase()
    );
    if (sameName && !confirm(`A person named "${person.name}" already exists. Save anyway?`)) return;

    const idx = stateRef.people.findIndex(p => p.person_id === person.person_id);
    if (idx >= 0) stateRef.people[idx] = person;
    else stateRef.people.push(person);
    commitRef();
    renderAll();
    closeModal(backdrop);
    toast("Person saved.");

    if (onSaved) {
      if (fromMapper && !has2002Details(person)) {
        onSaved(null, person);
        toast("Person saved, but cannot be selected as mapper because 2002 details are missing.");
      } else {
        onSaved(person, person);
      }
    }
  });
}


function openApplicantModal(applicantId = "") {
  const existing = stateRef.applicants.find(a => a.applicant_id === applicantId);
  const draft = existing ? { ...existing } : blankApplicant();
  const form = el("form", { autocomplete: "off" });
  const errorBox = el("div", { class: "error-box" });
  const grid = el("div", { class: "form-grid" });

  const usedApplicantPeople = new Set(stateRef.applicants
    .filter(a => a.applicant_id !== draft.applicant_id)
    .map(a => a.person_id));

  const applicantSel = addPeopleSelect(grid, "Applicant Name", "person_id", draft.person_id, {
    includeAddNew: true,
    required: true,
    filter: hasEpic,
    excludePersonIds: usedApplicantPeople
  });

  // Relationship is intentionally before mapper name.
  const relWrap = el("label", { class: "stacked" });
  relWrap.append(el("span", { text: "Mapper Relationship", class: "required" }));
  const relSel = el("select", { name: "mapper_relationship" });
  relSel.innerHTML = `<option value="">Select</option>` + RELATIONSHIPS.map(r => `<option value="${r}">${r}</option>`).join("");
  relSel.value = draft.mapper_relationship || "";
  relWrap.append(relSel);
  grid.append(relWrap);

  const mapperSel = addPeopleSelect(grid, "Mapper Name", "mapper_person_id", draft.mapper_person_id, {
    includeAddNew: true,
    required: true,
    filter: has2002Details
  });

  const phoneInput = addInput(grid, "Phone Number", "phone_number", draft.phone_number, "tel", true);
  phoneInput.inputMode = "numeric";
  phoneInput.maxLength = 10;
  phoneInput.addEventListener("input", () => {
    phoneInput.value = onlyDigits(phoneInput.value).slice(0, 10);
  });

  const aadhaarInput = addInput(grid, "Aadhaar Number", "aadhaar_number", formatAadhaar(draft.aadhaar_number), "text", true);
  aadhaarInput.inputMode = "numeric";
  aadhaarInput.maxLength = 14;
  aadhaarInput.addEventListener("input", () => {
    aadhaarInput.value = formatAadhaar(aadhaarInput.value);
  });

  const dobInput = addInput(grid, "Date of Birth", "date_of_birth", draft.date_of_birth, "date", true);

  const fatherSel = addPeopleSelect(grid, "Father", "father_person_id", draft.father_person_id, {
    includeAddNew: true,
    required: true
  });
  const motherSel = addPeopleSelect(grid, "Mother", "mother_person_id", draft.mother_person_id, {
    includeAddNew: true,
    required: true
  });
  const spouseSel = addPeopleSelect(grid, "Spouse", "spouse_person_id", draft.spouse_person_id, {
    includeAddNew: true
  });

  let photoData = draft.photo_data || "";
  const photoWrap = el("div", { class: "stacked photo-field" });
  photoWrap.append(el("span", { text: "Applicant Photo (optional)" }));
  const photoInput = el("input", { type: "file", accept: "image/*", autocomplete: "off" });
  const photoPreview = el("img", { class: "photo-preview", alt: "Applicant photo preview" });
  const removePhotoBtn = el("button", { type: "button", class: "small secondary", text: "Remove Photo" });
  function syncPhotoPreview() {
    photoPreview.hidden = !photoData;
    removePhotoBtn.hidden = !photoData;
    if (photoData) photoPreview.src = photoData;
    else photoPreview.removeAttribute("src");
  }
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      photoData = await readPhotoAsDataUrl(file);
      syncPhotoPreview();
      toast("Photo added.");
    } catch (err) {
      console.error("Photo error", err);
      toast(err.message || "Could not add photo.");
    } finally {
      photoInput.value = "";
    }
  });
  removePhotoBtn.addEventListener("click", () => {
    photoData = "";
    syncPhotoPreview();
    toast("Photo removed.");
  });
  photoWrap.append(photoInput, photoPreview, removePhotoBtn);
  grid.append(photoWrap);
  syncPhotoPreview();


  const actions = el("div", { class: "modal-actions" });
  const cancel = el("button", { type: "button", class: "secondary", text: "Cancel" });
  const save = el("button", { type: "submit", text: "Save Applicant" });
  actions.append(cancel, save);
  form.append(errorBox, grid, actions);
  const backdrop = openModal(existing ? "Edit Applicant" : "Add Applicant", form);
  cancel.addEventListener("click", () => closeModal(backdrop));

  const selectMap = {
    person_id: applicantSel,
    mapper_person_id: mapperSel,
    father_person_id: fatherSel,
    mother_person_id: motherSel,
    spouse_person_id: spouseSel
  };

  function optionHtml(person) {
    return `<option value="${escapeHtml(person.person_id)}">${escapeHtml(person.name)}${person.epic_number ? " — " + escapeHtml(person.epic_number) : ""}${has2002Details(person) ? " — 2002" : ""}</option>`;
  }

  function peopleOptions({ includeAddNew = true, allowBlank = true, filter = null, exclude = new Set(), forceIds = [] } = {}) {
    const forced = forceIds
      .map(id => stateRef.people.find(p => p.person_id === id))
      .filter(Boolean);
    const forcedIds = new Set(forced.map(p => p.person_id));
    const list = stateRef.people
      .filter(p => !forcedIds.has(p.person_id))
      .filter(p => !filter || filter(p))
      .filter(p => !exclude.has(p.person_id))
      .sort((a, b) => Number(has2002Details(a)) - Number(has2002Details(b)) || a.name.localeCompare(b.name));
    return [
      allowBlank ? `<option value="">Select</option>` : "",
      includeAddNew ? `<option value="${ADD_NEW}">Add New</option>` : "",
      ...forced.map(optionHtml),
      ...list.map(optionHtml)
    ].join("");
  }

  function setDisabled(select, disabled) {
    select.disabled = Boolean(disabled);
    select.closest("label")?.classList.toggle("disabled-field", Boolean(disabled));
  }

  function keepValue(select, oldValue) {
    if (!oldValue) return;
    if ([...select.options].some(o => o.value === oldValue)) select.value = oldValue;
  }

  function refreshApplicantSelects() {
    const old = {
      person_id: applicantSel.value,
      mapper_person_id: mapperSel.value,
      father_person_id: fatherSel.value,
      mother_person_id: motherSel.value,
      spouse_person_id: spouseSel.value
    };

    applicantSel.innerHTML = peopleOptions({
      includeAddNew: true,
      filter: hasEpic,
      exclude: usedApplicantPeople,
      forceIds: old.person_id ? [old.person_id] : []
    });
    keepValue(applicantSel, old.person_id);

    const rel = relSel.value;
    const applicantId = applicantSel.value;

    if (rel === "Self") {
      mapperSel.innerHTML = applicantId
        ? peopleOptions({ includeAddNew: false, allowBlank: false, forceIds: [applicantId] })
        : `<option value="">Select applicant first</option>`;
      mapperSel.value = applicantId || "";
      setDisabled(mapperSel, true);
    } else {
      mapperSel.innerHTML = peopleOptions({ includeAddNew: true, filter: has2002Details });
      keepValue(mapperSel, old.mapper_person_id);
      setDisabled(mapperSel, false);
    }

    if (rel === "Father" && mapperSel.value) {
      fatherSel.innerHTML = peopleOptions({ includeAddNew: false, allowBlank: false, forceIds: [mapperSel.value] });
      fatherSel.value = mapperSel.value;
      setDisabled(fatherSel, true);
    } else {
      const exclude = new Set([applicantSel.value].filter(Boolean));
      if (rel !== "Father" && mapperSel.value) exclude.add(mapperSel.value);
      fatherSel.innerHTML = peopleOptions({ includeAddNew: true, exclude });
      keepValue(fatherSel, old.father_person_id);
      setDisabled(fatherSel, false);
    }

    if (rel === "Mother" && mapperSel.value) {
      motherSel.innerHTML = peopleOptions({ includeAddNew: false, allowBlank: false, forceIds: [mapperSel.value] });
      motherSel.value = mapperSel.value;
      setDisabled(motherSel, true);
    } else {
      const exclude = new Set([applicantSel.value, fatherSel.value].filter(Boolean));
      if (rel !== "Mother" && mapperSel.value) exclude.add(mapperSel.value);
      motherSel.innerHTML = peopleOptions({ includeAddNew: true, exclude });
      keepValue(motherSel, old.mother_person_id);
      setDisabled(motherSel, false);
    }

    const spouseExclude = new Set([applicantSel.value, mapperSel.value, fatherSel.value, motherSel.value].filter(Boolean));
    spouseSel.innerHTML = peopleOptions({ includeAddNew: true, exclude: spouseExclude });
    keepValue(spouseSel, old.spouse_person_id);

    applyMappingAutofill({ applicantSel, mapperSel, relSel, fatherSel, motherSel, errorBox });
  }

  function handleSelectChange(field, select) {
    if (select.value === ADD_NEW) {
      select.value = "";
      const isMapper = field === "mapper_person_id";
      const isApplicant = field === "person_id";
      openPersonModal({
        fromMapper: isMapper,
        fromApplicant: isApplicant,
        onSaved: (selectablePerson) => {
          refreshApplicantSelects();
          if (selectablePerson && [...selectMap[field].options].some(o => o.value === selectablePerson.person_id)) {
            selectMap[field].value = selectablePerson.person_id;
          }
          refreshApplicantSelects();
        }
      });
      return;
    }
    refreshApplicantSelects();
  }

  Object.entries(selectMap).forEach(([field, select]) => {
    select.addEventListener("change", () => handleSelectChange(field, select));
  });
  relSel.addEventListener("change", refreshApplicantSelects);

  function currentDraft() {
    return normalizeApplicant({
      ...draft,
      person_id: applicantSel.value,
      mapper_person_id: mapperSel.value,
      mapper_relationship: relSel.value,
      phone_number: onlyDigits(phoneInput.value),
      aadhaar_number: onlyDigits(aadhaarInput.value),
      date_of_birth: dobInput.value,
      father_person_id: fatherSel.value,
      mother_person_id: motherSel.value,
      spouse_person_id: spouseSel.value,
      photo_data: photoData,
      status_completed: draft.status_completed
    });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    refreshApplicantSelects();
    const applicant = currentDraft();
    const result = validateApplicant(applicant, stateRef.people, stateRef.applicants, applicant.applicant_id);
    showErrors(errorBox, result.errors);
    if (result.errors.length) return;

    if (result.duplicateAadhaarApplicant) {
      const other = personName(result.duplicateAadhaarApplicant.person_id) || "another applicant";
      if (!confirm(`Aadhaar number already exists for ${other}. Save duplicate anyway?`)) return;
    }

    const idx = stateRef.applicants.findIndex(a => a.applicant_id === applicant.applicant_id);
    if (idx >= 0) stateRef.applicants[idx] = applicant;
    else stateRef.applicants.push(applicant);
    commitRef();
    renderAll();
    closeModal(backdrop);
    toast("Applicant saved.");
  });

  refreshApplicantSelects();
}

function deletePerson(personId) {
  const refs = personReferences(personId, stateRef.applicants);
  if (refs.length) {
    toast("Cannot delete this person because one or more applicants reference them.");
    return;
  }
  const p = stateRef.people.find(x => x.person_id === personId);
  if (!confirm(`Delete ${p?.name || "this person"}?`)) return;
  stateRef.people = stateRef.people.filter(x => x.person_id !== personId);
  commitRef();
  renderAll();
  toast("Person deleted.");
}

function toggleApplicantStatus(applicantId, checked) {
  const applicant = stateRef.applicants.find(a => a.applicant_id === applicantId);
  if (!applicant) return;
  applicant.status_completed = Boolean(checked);
  commitRef();
  renderAll();
  toast(checked ? "Marked completed." : "Marked pending.");
}

function toggleApplicantPdfExport(applicantId, checked) {
  const applicant = stateRef.applicants.find(a => a.applicant_id === applicantId);
  if (!applicant) return;
  applicant.export_to_pdf = Boolean(checked);
  commitRef();
  toast(checked ? "Included in PDF export." : "Excluded from PDF export.");
}

function selectNextIncomplete(currentId = "") {
  const pending = pendingApplicants();
  const select = $("#readonlyApplicantSelect");
  if (!pending.length) {
    if (select) select.dataset.selected = "";
    renderReadonlyPicker();
    toast("All applicants completed.");
    return;
  }
  const currentIndex = pending.findIndex(a => a.applicant_id === currentId);
  const next = pending[currentIndex >= 0 ? (currentIndex + 1) % pending.length : 0];
  if (select) select.dataset.selected = next.applicant_id;
  renderReadonlyPicker();
}

function markReadonlyComplete() {
  const select = $("#readonlyApplicantSelect");
  const applicantId = select?.value || "";
  const applicant = stateRef.applicants.find(a => a.applicant_id === applicantId);
  if (!applicant) return;
  applicant.status_completed = true;
  commitRef();
  renderApplicants(); // Keep the Applicant Database status checkbox in sync immediately.
  selectNextIncomplete(applicantId);
  toast("Marked complete.");
}

function skipReadonlyApplicant() {
  const currentId = $("#readonlyApplicantSelect")?.value || "";
  selectNextIncomplete(currentId);
}


function deleteApplicant(applicantId) {
  const a = stateRef.applicants.find(x => x.applicant_id === applicantId);
  if (!confirm(`Delete applicant ${personName(a?.person_id) || ""}?`)) return;
  stateRef.applicants = stateRef.applicants.filter(x => x.applicant_id !== applicantId);
  commitRef();
  renderAll();
  toast("Applicant deleted.");
}

async function handleImport(file) {
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    backupState(stateRef);
    stateRef.people = imported.people;
    stateRef.applicants = imported.applicants;
    commitRef();
    renderAll();
    toast("Import successful. Previous data was backed up locally.");
  } catch (err) {
    console.error("Import failed", err);
    toast("Import failed. Existing data was not changed.");
    alert(err.message || "Import failed.");
  } finally {
    $("#importJsonInput").value = "";
  }
}

function clearAllData() {
  const exportFirst = confirm("Before clearing, export a JSON backup now? Press OK to export, Cancel to continue without exporting.");
  if (exportFirst) downloadJson(stateRef);
  if (!confirm("Clear all people and applicants from this device? This cannot be undone unless you have a JSON backup.")) return;
  backupState(stateRef);
  stateRef.people = [];
  stateRef.applicants = [];
  clearState();
  renderAll();
  toast("All data cleared. A local backup was stored before clearing.");
}


const ZOOM_KEY = "sir_family_forms_zoom";
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.3;

function applyZoom(value) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || 1));
  document.documentElement.style.setProperty("--app-zoom", String(zoom));
  localStorage.setItem(ZOOM_KEY, String(zoom));
}

function initZoomControls() {
  applyZoom(localStorage.getItem(ZOOM_KEY) || 1);
  $("#zoomOutBtn")?.addEventListener("click", () => {
    const current = Number(localStorage.getItem(ZOOM_KEY) || 1);
    applyZoom((current - 0.1).toFixed(2));
  });
  $("#zoomResetBtn")?.addEventListener("click", () => applyZoom(1));
  $("#zoomInBtn")?.addEventListener("click", () => {
    const current = Number(localStorage.getItem(ZOOM_KEY) || 1);
    applyZoom((current + 0.1).toFixed(2));
  });
}

export function initUI(state, commit) {
  stateRef = state;
  commitRef = commit;

  $("#addPersonBtn").addEventListener("click", () => openPersonModal());
  $("#addApplicantBtn").addEventListener("click", () => openApplicantModal());
  $("#exportJsonBtn").addEventListener("click", () => {
    downloadJson(stateRef);
    toast("JSON exported.");
  });
  $("#importJsonInput").addEventListener("change", event => handleImport(event.target.files[0]));
  $("#generatePdfBtn").addEventListener("click", () => {
    try {
      generatePdf(stateRef);
      toast("Online form PDF print page opened.");
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not generate PDF.");
    }
  });
  $("#offlinePdfBtn").addEventListener("click", () => {
    try {
      generateOfflinePdf(stateRef);
      toast("Offline form PDF print page opened.");
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not generate offline PDF.");
    }
  });
  $("#clearDataBtn").addEventListener("click", clearAllData);
  $("#readonlyApplicantSelect").addEventListener("change", event => {
    event.target.dataset.selected = event.target.value;
    renderReadonlyCard(event.target.value);
    syncReadonlyButtons();
  });
  $("#markCompleteBtn").addEventListener("click", markReadonlyComplete);
  $("#nextApplicantBtn").addEventListener("click", skipReadonlyApplicant);

  initZoomControls();
  renderAll();
}

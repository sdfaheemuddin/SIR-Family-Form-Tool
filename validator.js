// Shared validation for the full SIR Family Forms dataset.
import { validateApplicant, validatePerson } from "./core.js?v=26-07-08-19";

const DOB_MAX = "2009-12-31";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function personById(state, id) {
  return (state.people || []).find(person => person.person_id === id) || null;
}

function personLabel(state, id, fallback = "Unnamed") {
  const person = personById(state, id);
  if (!person) return fallback;
  return [person.name || fallback, person.epic_number ? `EPIC: ${person.epic_number}` : ""].filter(Boolean).join(" — ");
}

function addDateOfBirthErrors(applicant, errors) {
  if (applicant.date_of_birth && applicant.date_of_birth > DOB_MAX) {
    errors.push("Date of Birth must be on or before 31-12-2009.");
  }
}

function applicantReferencesPerson(applicant, personId) {
  return [applicant.person_id, applicant.mapper_person_id, applicant.father_person_id, applicant.mother_person_id, applicant.spouse_person_id]
    .filter(Boolean)
    .includes(personId);
}

export function validateState(state = {}) {
  const people = Array.isArray(state.people) ? state.people : [];
  const applicants = Array.isArray(state.applicants) ? state.applicants : [];
  const results = [];

  people.forEach((person, index) => {
    const errors = validatePerson(person, {
      people,
      editingId: person.person_id
    });
    if (errors.length) {
      results.push({
        type: "person",
        id: person.person_id,
        label: personLabel({ people }, person.person_id, `Person row ${index + 1}`),
        errors
      });
    }
  });

  applicants.forEach((applicant, index) => {
    const result = validateApplicant(applicant, people, applicants, applicant.applicant_id);
    const errors = [...result.errors];
    addDateOfBirthErrors(applicant, errors);
    if (errors.length) {
      results.push({
        type: "applicant",
        id: applicant.applicant_id,
        label: personLabel({ people }, applicant.person_id, `Applicant row ${index + 1}`),
        errors
      });
    }
  });

  const errorCount = results.reduce((sum, item) => sum + item.errors.length, 0);
  return {
    valid: errorCount === 0,
    errorCount,
    itemCount: results.length,
    results
  };
}

export function validatePersonSaveImpact(state = {}, personId = "") {
  const validation = validateState(state);
  if (!personId || validation.valid) return validation;

  const applicants = Array.isArray(state.applicants) ? state.applicants : [];
  const affectedApplicantIds = new Set(
    applicants
      .filter(applicant => applicantReferencesPerson(applicant, personId))
      .map(applicant => applicant.applicant_id)
  );

  const results = validation.results.filter(item =>
    (item.type === "person" && item.id === personId) ||
    (item.type === "applicant" && affectedApplicantIds.has(item.id))
  );
  const errorCount = results.reduce((sum, item) => sum + item.errors.length, 0);

  return {
    valid: errorCount === 0,
    errorCount,
    itemCount: results.length,
    results
  };
}

function closeModal(backdrop) {
  backdrop?.remove();
}

export function openValidationReport(state, options = {}) {
  const validation = options.validation || validateState(state);
  const root = document.getElementById("modalRoot");
  if (!root) {
    alert(validation.valid ? "Validation passed. All applicants are valid." : `Validation found ${validation.errorCount} issue(s).`);
    return validation;
  }

  const title = options.title || "Validator";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop validator-modal";
  backdrop.innerHTML = `<div class="modal">
    <div class="modal-head">
      <h3>${esc(title)}</h3>
      <button type="button" class="small secondary" data-close>Close</button>
    </div>
    <div class="validator-body"></div>
  </div>`;

  const body = backdrop.querySelector(".validator-body");
  if (validation.valid) {
    body.innerHTML = `<div class="message validator-ok">Validation passed. All applicants are valid.</div>`;
  } else {
    body.innerHTML = `<div class="error-box validator-summary" style="display:block">Validation found ${validation.errorCount} issue(s) in ${validation.itemCount} record(s). Fix these before saving/exporting.</div>
      <div class="validator-list">${validation.results.map(item => `<section class="validator-item">
        <h4>${esc(item.type === "applicant" ? "Applicant" : "People Data")}: ${esc(item.label)}</h4>
        <ul>${item.errors.map(error => `<li>${esc(error)}</li>`).join("")}</ul>
      </section>`).join("")}</div>`;
  }

  backdrop.querySelector("[data-close]").addEventListener("click", () => closeModal(backdrop));
  root.append(backdrop);
  return validation;
}

export function toastValidationStatus(state, toast) {
  const validation = validateState(state);
  if (validation.valid) toast?.("Validation passed.");
  else toast?.(`Validation found ${validation.errorCount} issue(s). Click Validate in Database.`);
  return validation;
}

// JSON backup import/export helpers.
import {
  allReadonly,
  normalizeApplicant,
  normalizePerson,
  validateApplicant,
  validateImportShape,
  validatePerson
} from "./core.js";

export function buildExportPayload(state) {
  return {
    people_database: state.people,
    applicant_database: state.applicants
  };
}

export function safeName(value) {
  return String(value || "NoApplicant")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "NoApplicant";
}

export function yymmddhhmm(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function sirFileBaseFromState(state, date = new Date()) {
  const readonlyRows = allReadonly(state.applicants || [], state.people || []);
  const first = readonlyRows[0]?.applicant_name || "NoApplicant";
  return `SIR2026_${safeName(first)}_${yymmddhhmm(date)}`;
}

export function downloadJson(state) {
  const payload = buildExportPayload(state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sirFileBaseFromState(state)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function parseImportFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file. Please select a valid backup JSON file.");
  }

  const shapeErrors = validateImportShape(data);
  if (shapeErrors.length) throw new Error(shapeErrors.join("\n"));

  const rawPeople = data.people_database;
  const oldPeopleById = new Map(rawPeople.map(p => [p.person_id, p]));
  const people = rawPeople.map(normalizePerson);
  const applicants = data.applicant_database.map(a => normalizeApplicant({
    ...a,
    date_of_birth: a.date_of_birth || oldPeopleById.get(a.person_id)?.date_of_birth || ""
  }));
  const errors = [];

  const personIds = new Set();
  people.forEach((p, i) => {
    validatePerson(p).forEach(e => errors.push(`Person row ${i + 1}: ${e}`));
    if (personIds.has(p.person_id)) errors.push(`Person row ${i + 1}: duplicate person_id.`);
    personIds.add(p.person_id);
  });

  const applicantIds = new Set();
  applicants.forEach((a, i) => {
    const result = validateApplicant(a, people, applicants, a.applicant_id);
    result.errors.forEach(e => errors.push(`Applicant row ${i + 1}: ${e}`));
    if (applicantIds.has(a.applicant_id)) errors.push(`Applicant row ${i + 1}: duplicate applicant_id.`);
    applicantIds.add(a.applicant_id);
  });

  if (errors.length) throw new Error(errors.join("\n"));
  return { people, applicants };
}

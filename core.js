// Data model, validation, and computed read-only records.
export const RELATIONSHIPS = ["Self", "Father", "Mother", "Grandfather", "Grandmother"];

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function normalizeEpic(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export function isStrictEpic(value) {
  return /^[A-Z]{3}\d{7}$/.test(normalizeEpic(value));
}

export function formatAadhaar(value) {
  return onlyDigits(value).slice(0, 12).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function blankPerson() {
  return {
    person_id: uid("person"),
    name: "",
    epic_number: "",
    allow_nonstandard_epic: false,
    is_2002_available: false,
    state_2002: "",
    district_2002: "",
    ac_name_2002: "",
    name_as_per_2002: "",
    epic_number_2002: "",
    relative_name_2002: "",
    relative_relationship_2002: "",
    ac_no_2002: "",
    part_no_2002: "",
    sl_no_2002: ""
  };
}

export function blankApplicant() {
  return {
    applicant_id: uid("applicant"),
    person_id: "",
    mapper_person_id: "",
    mapper_relationship: "",
    phone_number: "",
    aadhaar_number: "",
    date_of_birth: "",
    father_person_id: "",
    mother_person_id: "",
    spouse_person_id: "",
    photo_data: "",
    status_completed: false,
    export_to_pdf: true
  };
}

export function normalizePerson(input = {}) {
  return {
    person_id: String(input.person_id || uid("person")),
    name: String(input.name || "").trim(),
    epic_number: normalizeEpic(input.epic_number),
    allow_nonstandard_epic: Boolean(input.allow_nonstandard_epic),
    is_2002_available: Boolean(input.is_2002_available),
    state_2002: String(input.state_2002 || "").trim(),
    district_2002: String(input.district_2002 || "").trim(),
    ac_name_2002: String(input.ac_name_2002 || "").trim(),
    name_as_per_2002: String(input.name_as_per_2002 || "").trim(),
    epic_number_2002: normalizeEpic(input.epic_number_2002),
    relative_name_2002: String(input.relative_name_2002 || "").trim(),
    relative_relationship_2002: String(input.relative_relationship_2002 || "").trim(),
    ac_no_2002: String(input.ac_no_2002 || "").trim(),
    part_no_2002: String(input.part_no_2002 || "").trim(),
    sl_no_2002: String(input.sl_no_2002 || "").trim()
  };
}

export function normalizeApplicant(input = {}) {
  return {
    applicant_id: String(input.applicant_id || uid("applicant")),
    person_id: String(input.person_id || ""),
    mapper_person_id: String(input.mapper_person_id || ""),
    mapper_relationship: String(input.mapper_relationship || ""),
    phone_number: onlyDigits(input.phone_number).slice(0, 10),
    aadhaar_number: onlyDigits(input.aadhaar_number).slice(0, 12),
    date_of_birth: String(input.date_of_birth || "").trim(),
    father_person_id: String(input.father_person_id || ""),
    mother_person_id: String(input.mother_person_id || ""),
    spouse_person_id: String(input.spouse_person_id || ""),
    photo_data: String(input.photo_data || ""),
    status_completed: Boolean(input.status_completed),
    export_to_pdf: input.export_to_pdf === undefined ? true : Boolean(input.export_to_pdf)
  };
}

export function has2002Details(person) {
  return Boolean(
    person &&
    person.is_2002_available &&
    person.state_2002 &&
    person.district_2002 &&
    person.ac_no_2002 &&
    person.part_no_2002 &&
    person.sl_no_2002
  );
}

export function hasEpic(person) {
  return Boolean(person && person.epic_number);
}

function normKey(value) {
  return String(value || "").trim().toLowerCase();
}

function same2002Serial(a, b) {
  const pa = normalizePerson(a);
  const pb = normalizePerson(b);
  return Boolean(
    pa.state_2002 && pb.state_2002 && normKey(pa.state_2002) === normKey(pb.state_2002) &&
    pa.district_2002 && pb.district_2002 && normKey(pa.district_2002) === normKey(pb.district_2002) &&
    pa.ac_no_2002 && pb.ac_no_2002 && normKey(pa.ac_no_2002) === normKey(pb.ac_no_2002) &&
    pa.part_no_2002 && pb.part_no_2002 && normKey(pa.part_no_2002) === normKey(pb.part_no_2002) &&
    pa.sl_no_2002 && pb.sl_no_2002 && normKey(pa.sl_no_2002) === normKey(pb.sl_no_2002)
  );
}

export function validatePerson(person, options = {}) {
  const p = normalizePerson(person);
  const errors = [];
  if (!p.name) errors.push("Person name is mandatory.");
  if (options.requireEpic && !p.epic_number) errors.push("EPIC Number is mandatory for applicant name.");
  if (p.epic_number && !p.allow_nonstandard_epic && !isStrictEpic(p.epic_number)) {
    errors.push("EPIC Number must be 3 letters followed by 7 digits, or enable non-standard EPIC override.");
  }
  if (p.is_2002_available) {
    if (!p.state_2002) errors.push("State is mandatory when 2002 list is checked.");
    if (!p.district_2002) errors.push("District is mandatory when 2002 list is checked.");
    if (!p.ac_no_2002) errors.push("AC No is mandatory when 2002 list is checked.");
    if (!p.part_no_2002) errors.push("Part No is mandatory when 2002 list is checked.");
    if (!p.sl_no_2002) errors.push("Serial No is mandatory when 2002 list is checked.");
  }
  const people = Array.isArray(options.people) ? options.people.map(normalizePerson) : [];
  const editingId = options.editingId || p.person_id;
  if (p.epic_number && people.some(x => x.person_id !== editingId && x.epic_number && x.epic_number === p.epic_number)) {
    errors.push("Current EPIC Number must be unique.");
  }
  if (p.sl_no_2002 && people.some(x => x.person_id !== editingId && same2002Serial(p, x))) {
    errors.push("2002 Sl No must be unique for the same State, District, AC No and Part No.");
  }
  return errors;
}

export function validateMappingNames(applicant, people) {
  const a = normalizeApplicant(applicant);
  const byId = new Map(people.map(p => [p.person_id, p]));
  const errors = [];
  if (!a.mapper_relationship || !a.mapper_person_id) return errors;
  const mapper = byId.get(a.mapper_person_id);
  const applicantPerson = byId.get(a.person_id);
  const father = byId.get(a.father_person_id);
  const mother = byId.get(a.mother_person_id);
  if (a.mapper_relationship === "Self" && a.person_id && a.mapper_person_id !== a.person_id) errors.push(`Mapping relation is Self, so Mapping Name must be the applicant name${applicantPerson?.name ? ` (${applicantPerson.name})` : ""}.`);
  if (a.mapper_relationship === "Father" && a.father_person_id && a.mapper_person_id !== a.father_person_id) errors.push(`Mapping relation is Father, so Mapping Name must match Father${father?.name ? ` (${father.name})` : ""}.`);
  if (a.mapper_relationship === "Mother" && a.mother_person_id && a.mapper_person_id !== a.mother_person_id) errors.push(`Mapping relation is Mother, so Mapping Name must match Mother${mother?.name ? ` (${mother.name})` : ""}.`);
  if ((a.mapper_relationship === "Grandfather" || a.mapper_relationship === "Grandmother") && mapper) {
    if ([a.person_id, a.father_person_id, a.mother_person_id].filter(Boolean).includes(a.mapper_person_id)) errors.push(`Mapping relation is ${a.mapper_relationship}, so Mapping Name should be the applicant's ${a.mapper_relationship.toLowerCase()}, not applicant/father/mother.`);
  }
  return errors;
}

export function validateApplicant(applicant, people, applicants = [], editingId = "") {
  const a = normalizeApplicant(applicant);
  const errors = [];
  const byId = new Map(people.map(p => [p.person_id, p]));
  const person = byId.get(a.person_id);
  const mapper = byId.get(a.mapper_person_id);
  if (!a.person_id || !person) errors.push("Applicant name/person is mandatory.");
  if (person && !person.epic_number) errors.push("Applicant person must have an EPIC number.");
  if (!a.mapper_person_id || !mapper) errors.push("Mapper is mandatory.");
  if (mapper && !has2002Details(mapper)) errors.push("Mapper must have complete 2002 details.");
  if (!a.mapper_relationship || !RELATIONSHIPS.includes(a.mapper_relationship)) errors.push("Mapper relationship is mandatory.");
  if (!a.father_person_id || !byId.has(a.father_person_id)) errors.push("Father is mandatory.");
  if (!a.mother_person_id || !byId.has(a.mother_person_id)) errors.push("Mother is mandatory.");
  if (!a.phone_number) errors.push("Phone number is mandatory.");
  if (a.phone_number && !/^\d{10}$/.test(a.phone_number)) errors.push("Phone number must be exactly 10 digits.");
  if (a.aadhaar_number && !/^\d{12}$/.test(a.aadhaar_number)) errors.push("Aadhaar number must be exactly 12 digits.");
  if (!a.date_of_birth) errors.push("Date of Birth is mandatory.");
  if (a.spouse_person_id && !byId.has(a.spouse_person_id)) errors.push("Selected spouse was not found in People Database.");
  if (a.mapper_relationship === "Self") {
    if (a.mapper_person_id !== a.person_id) errors.push("For Self mapping, Mapper Name must be the same as Applicant Name.");
    if (person && !has2002Details(person)) errors.push("For Self mapping, the applicant must have complete 2002 details.");
  }
  if (a.mapper_relationship === "Father" && a.mapper_person_id !== a.father_person_id) errors.push("For Father mapping, Father must be auto-filled from Mapper Name.");
  if (a.mapper_relationship === "Mother" && a.mapper_person_id !== a.mother_person_id) errors.push("For Mother mapping, Mother must be auto-filled from Mapper Name.");
  if (a.father_person_id && a.father_person_id === a.person_id) errors.push("Father cannot be the same as Applicant Name.");
  if (a.mother_person_id && a.mother_person_id === a.person_id) errors.push("Mother cannot be the same as Applicant Name.");
  if (a.mother_person_id && a.mother_person_id === a.father_person_id) errors.push("Mother cannot be the same as Father.");
  if (a.spouse_person_id && [a.person_id, a.mapper_person_id, a.father_person_id, a.mother_person_id].includes(a.spouse_person_id)) errors.push("Spouse must be different from applicant, mapper, father, and mother.");
  errors.push(...validateMappingNames(a, people));
  const usedApplicant = applicants.find(x => x.applicant_id !== editingId && x.person_id && x.person_id === a.person_id);
  if (usedApplicant) errors.push("This person is already saved as an applicant.");
  const duplicate = applicants.find(x => x.applicant_id !== editingId && x.aadhaar_number && x.aadhaar_number === a.aadhaar_number);
  if (duplicate && a.aadhaar_number) errors.push("Aadhaar number must be unique.");
  return { errors, duplicateAadhaarApplicant: duplicate || null };
}

export function personReferences(personId, applicants) {
  return applicants.filter(a => [a.person_id, a.mapper_person_id, a.father_person_id, a.mother_person_id, a.spouse_person_id].filter(Boolean).includes(personId));
}

export function buildReadonly(applicant, people) {
  const byId = new Map(people.map(p => [p.person_id, p]));
  const person = byId.get(applicant.person_id) || {};
  const mapper = byId.get(applicant.mapper_person_id) || {};
  const father = byId.get(applicant.father_person_id) || {};
  const mother = byId.get(applicant.mother_person_id) || {};
  const spouse = byId.get(applicant.spouse_person_id) || {};
  return {
    applicant_id: applicant.applicant_id,
    applicant_name: person.name || "",
    "EPIC ID": person.epic_number || "",
    "Phone Number": applicant.phone_number || "",
    "Photo Data": applicant.photo_data || "",
    "Mapping Type": applicant.mapper_relationship === "Self" ? "Self" : "Mapping Parents",
    "Mapping State": mapper.state_2002 || "",
    "Mapping District": mapper.district_2002 || "",
    "Mapping AC Name": mapper.ac_name_2002 || "",
    "Mapping AC No": mapper.ac_no_2002 || "",
    "Mapping AC No Display": mapper.ac_name_2002 ? `${mapper.ac_no_2002 || ""}-${mapper.ac_name_2002}` : (mapper.ac_no_2002 || ""),
    "Mapping Part No": mapper.part_no_2002 || "",
    "Mapping Serial No": mapper.sl_no_2002 || "",
    "Mapping Relation": applicant.mapper_relationship || "",
    "Mapping Name": mapper.name || "",
    "Mapper Name as per 2002": mapper.name_as_per_2002 || "",
    "Mapper 2002 EPIC Number": mapper.epic_number_2002 || "",
    "Mapper Relative Name": mapper.relative_name_2002 || "",
    "Mapper Relationship with Relative": mapper.relative_relationship_2002 || "",
    "Date of Birth": applicant.date_of_birth || "",
    "Aadhaar Number": applicant.aadhaar_number || "",
    "Father’s Name": father.name || "",
    "Father’s EPIC Number": father.epic_number || "",
    "Mother’s Name": mother.name || "",
    "Mother’s EPIC Number": mother.epic_number || "",
    "Spouse’s Name": spouse.name || "",
    "Spouse’s EPIC Number": spouse.epic_number || "",
    "Aadhaar Number again": applicant.aadhaar_number || ""
  };
}

export function allReadonly(applicants, people) {
  return applicants.map(a => buildReadonly(a, people));
}

export function validateImportShape(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) errors.push("Imported JSON must be an object.");
  if (!Array.isArray(data?.people_database)) errors.push("people_database must be an array.");
  if (!Array.isArray(data?.applicant_database)) errors.push("applicant_database must be an array.");
  return errors;
}

// App bootstrapping.
import { loadState, saveState } from "./storage.js";
import { initUI } from "./ui.js";
import { normalizeApplicant, normalizePerson } from "./core.js";
import { initEnhancements } from "./enhancements3.js";

const loaded = loadState();
const rawPeople = Array.isArray(loaded.people) ? loaded.people : [];
const rawApplicants = Array.isArray(loaded.applicants) ? loaded.applicants : [];
const peopleById = new Map(rawPeople.map(p => [p.person_id, p]));

// Normalize and migrate old DOB from People to Applicant if present.
const state = {
  people: rawPeople.map(normalizePerson),
  applicants: rawApplicants.map(a => normalizeApplicant({
    ...a,
    date_of_birth: a.date_of_birth || peopleById.get(a.person_id)?.date_of_birth || ""
  }))
};

const commit = () => saveState(state);

window.addEventListener("error", event => console.error("App error", event.error));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
      .then(reg => console.log("Service worker registered", reg.scope))
      .catch(err => console.error("Service worker failed", err));
  });
}

commit(); // Save normalized/migrated structure.
initUI(state, commit);
initEnhancements(state, commit);

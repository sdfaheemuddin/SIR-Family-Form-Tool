// App bootstrapping.
import { loadState, saveState } from "./storage.js";
import { initUI } from "./ui.js";
import { normalizeApplicant, normalizePerson } from "./core.js";

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
window.addEventListener("unhandledrejection", event => console.error("App promise error", event.reason));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
      .then(reg => console.log("Service worker registered", reg.scope))
      .catch(err => console.error("Service worker failed", err));
  });
}

commit(); // Save normalized/migrated structure.
initUI(state, commit);

// Load enhancements after the base app is already interactive.
// If enhancement code fails, the original app buttons still work.
import("./enhancements3.js")
  .then(module => module.initEnhancements?.(state, commit))
  .catch(err => {
    console.error("Enhancements failed to load", err);
    const toast = document.querySelector("#toast");
    if (toast) {
      toast.textContent = "Enhancements failed to load. Base app is still usable.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 4000);
    }
  });

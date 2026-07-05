// Tiny localStorage wrapper. Keeps a backup before destructive imports.
const KEY = "sir_family_forms_state";
const BACKUP_KEY = "sir_family_forms_last_backup";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { people: [], applicants: [] };
    const data = JSON.parse(raw);
    return {
      people: Array.isArray(data.people) ? data.people : [],
      applicants: Array.isArray(data.applicants) ? data.applicants : []
    };
  } catch (err) {
    console.error("Failed to load saved state", err);
    return { people: [], applicants: [] };
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify({
    people: state.people || [],
    applicants: state.applicants || [],
    saved_at: new Date().toISOString()
  }));
}

export function backupState(state) {
  localStorage.setItem(BACKUP_KEY, JSON.stringify({
    people: state.people || [],
    applicants: state.applicants || [],
    backed_up_at: new Date().toISOString()
  }));
}

export function clearState() {
  localStorage.removeItem(KEY);
}

export function getLastBackup() {
  const raw = localStorage.getItem(BACKUP_KEY);
  return raw ? JSON.parse(raw) : null;
}

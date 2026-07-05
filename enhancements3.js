import { initEnhancements as initBaseEnhancements } from "./enhancements2.js";
import { backupState, clearState } from "./storage.js";
import { downloadJson } from "./importExport.js";

const MAX_PHOTO_BYTES = 1.8 * 1024 * 1024;
const OUT_W = 900;
const OUT_H = 1200;
const editedPhotoMap = new WeakMap();
let stateRef;
let commitRef;
let photoEnhancementsWired = false;
let fileReaderPatched = false;

const $ = sel => document.querySelector(sel);

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => box.classList.remove("show"), 2600);
}

function patchFileReaderForEditedPhotos() {
  if (fileReaderPatched) return;
  const original = FileReader.prototype.readAsDataURL;
  FileReader.prototype.readAsDataURL = function patchedReadAsDataURL(file) {
    if (file && editedPhotoMap.has(file)) {
      setTimeout(() => {
        Object.defineProperty(this, "result", { configurable: true, value: editedPhotoMap.get(file) });
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      }, 0);
      return;
    }
    return original.call(this, file);
  };
  fileReaderPatched = true;
}

function wireClearData() {
  const btn = $("#clearDataBtn");
  if (!btn || btn.dataset.enhancedClear === "1") return;
  btn.dataset.enhancedClear = "1";
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const exportFirst = confirm("Before clearing, export a JSON backup now? Press OK to export, Cancel to continue without exporting.");
    if (exportFirst) downloadJson(stateRef);
    if (!confirm("Clear all people and applicants from this device? This cannot be undone unless you have a JSON backup.")) return;
    backupState(stateRef);
    stateRef.people = [];
    stateRef.applicants = [];
    clearState();
    commitRef?.();
    toast("All data cleared. A backup was stored locally.");
    setTimeout(() => window.location.reload(), 350);
  }, true);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load image.")); };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
}

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

function drawOutput(img, settings, previewCanvas = null) {
  const canvas = previewCanvas || document.createElement("canvas");
  canvas.width = previewCanvas ? 270 : OUT_W;
  canvas.height = previewCanvas ? 360 : OUT_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: settings.cleanBg });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const ratio = 3 / 4;
  const cropH = Math.min(img.height / settings.zoom, img.width / ratio / settings.zoom);
  const cropW = cropH * ratio;
  const maxX = Math.max(0, (img.width - cropW) / 2);
  const maxY = Math.max(0, (img.height - cropH) / 2);
  const sx = (img.width - cropW) / 2 + maxX * settings.x / 100;
  const sy = (img.height - cropH) / 2 + maxY * settings.y / 100;
  ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

  if (settings.cleanBg) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const corner = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4) {
      const diff = Math.abs(d[i] - corner[0]) + Math.abs(d[i + 1] - corner[1]) + Math.abs(d[i + 2] - corner[2]);
      const bright = d[i] > 185 && d[i + 1] > 185 && d[i + 2] > 185;
      if (diff < 95 || bright) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas;
}

async function makePhotoDataUrl(img, settings) {
  const canvas = drawOutput(img, settings);
  for (const q of [0.9, 0.82, 0.74, 0.66, 0.58]) {
    const blob = await canvasToBlob(canvas, q);
    if (blob && blob.size <= MAX_PHOTO_BYTES) return blobToDataUrl(blob);
  }
  const small = document.createElement("canvas");
  small.width = 720;
  small.height = 960;
  const ctx = small.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, small.width, small.height);
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const blob = await canvasToBlob(small, 0.62);
  if (!blob || blob.size > MAX_PHOTO_BYTES) throw new Error("Could not compress photo below 1.8 MB. Please choose a smaller image.");
  return blobToDataUrl(blob);
}

async function openPhotoEditor(file) {
  const img = await loadImageFromFile(file);
  const settings = { zoom: 1, x: 0, y: 0, cleanBg: false };
  const root = $("#modalRoot") || document.body;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal photo-editor-modal";
  modal.innerHTML = `
    <div class="modal-head"><h3>Edit Applicant Photo</h3><button type="button" class="small secondary" data-photo-close>Close</button></div>
    <div class="photo-editor-body">
      <canvas class="photo-crop-canvas" width="270" height="360"></canvas>
      <div class="photo-editor-controls">
        <label class="stacked">Zoom <input type="range" min="1" max="3" step="0.01" value="1" data-photo-zoom></label>
        <label class="stacked">Move Left / Right <input type="range" min="-100" max="100" step="1" value="0" data-photo-x></label>
        <label class="stacked">Move Up / Down <input type="range" min="-100" max="100" step="1" value="0" data-photo-y></label>
        <button type="button" class="secondary" data-photo-bg>Remove background + white background</button>
        <div class="message">Photo will be attached to this applicant form in 3:4 ratio and below 1.8 MB. Click Save Applicant after using the photo.</div>
      </div>
    </div>
    <div class="modal-actions"><button type="button" class="secondary" data-photo-close>Cancel</button><button type="button" data-photo-use>Use Photo</button></div>`;
  backdrop.append(modal);
  root.append(backdrop);

  const canvas = modal.querySelector("canvas");
  const render = () => drawOutput(img, settings, canvas);
  render();
  modal.querySelector("[data-photo-zoom]").addEventListener("input", e => { settings.zoom = Number(e.target.value) || 1; render(); });
  modal.querySelector("[data-photo-x]").addEventListener("input", e => { settings.x = Number(e.target.value) || 0; render(); });
  modal.querySelector("[data-photo-y]").addEventListener("input", e => { settings.y = Number(e.target.value) || 0; render(); });
  modal.querySelector("[data-photo-bg]").addEventListener("click", event => { settings.cleanBg = !settings.cleanBg; event.currentTarget.classList.toggle("danger", settings.cleanBg); render(); });

  return new Promise((resolve, reject) => {
    modal.querySelectorAll("[data-photo-close]").forEach(btn => btn.addEventListener("click", () => { backdrop.remove(); reject(new Error("Photo cancelled.")); }));
    modal.querySelector("[data-photo-use]").addEventListener("click", async () => {
      try {
        const dataUrl = await makePhotoDataUrl(img, settings);
        backdrop.remove();
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function wirePhotoInputs() {
  if (photoEnhancementsWired) return;
  patchFileReaderForEditedPhotos();
  document.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== "file" || !String(input.accept || "").includes("image")) return;
    if (input.dataset.photoReady === "1") {
      input.dataset.photoReady = "";
      return;
    }
    const file = input.files?.[0];
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openPhotoEditor(file).then(dataUrl => {
      editedPhotoMap.set(file, dataUrl);
      input.dataset.photoReady = "1";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(err => {
      if (err?.message !== "Photo cancelled.") {
        console.error(err);
        alert(err.message || "Could not edit photo.");
      }
      input.value = "";
    });
  }, true);
  photoEnhancementsWired = true;
}

function moveReadonlyActionsTop() {
  const section = $("#readonlySection");
  const picker = $("#readonlySection .readonly-picker");
  if (!section || !picker) return;
  document.querySelector("#readonlyNewApplicantBtn")?.remove();
  let actions = $("#readonlyTopActions");
  if (!actions) {
    actions = document.createElement("div");
    actions.id = "readonlyTopActions";
    actions.className = "readonly-actions readonly-top-actions";
    actions.innerHTML = `<button type="button" id="readonlyTopNewApplicantBtn">New Applicant</button><button type="button" class="secondary" id="readonlyEditApplicantBtn">Edit</button>`;
    picker.before(actions);
    actions.querySelector("#readonlyTopNewApplicantBtn").addEventListener("click", () => $("#addApplicantBtn")?.click());
    actions.querySelector("#readonlyEditApplicantBtn").addEventListener("click", () => {
      const id = $("#readonlyApplicantSelect")?.value || "";
      if (!id) return toast("Select an applicant first.");
      const btn = document.querySelector(`[data-edit-applicant="${CSS.escape(id)}"]`);
      if (btn) btn.click();
      else toast("Open Database tab once, then try Edit again.");
    });
  }
  const editBtn = $("#readonlyEditApplicantBtn");
  if (editBtn) editBtn.disabled = !Boolean($("#readonlyApplicantSelect")?.value);
}

export function initEnhancements(state, commit) {
  stateRef = state;
  commitRef = commit;
  initBaseEnhancements(state, commit);
  wireClearData();
  wirePhotoInputs();
  moveReadonlyActionsTop();
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(moveReadonlyActionsTop, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

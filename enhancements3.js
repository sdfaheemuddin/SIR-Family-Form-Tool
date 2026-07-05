import { initEnhancements as initBaseEnhancements } from "./enhancements2.js";
import { backupState, clearState } from "./storage.js";
import { downloadJson } from "./importExport.js";

const MAX_PHOTO_BYTES = 1.8 * 1024 * 1024;
const OUT_W = 900;
const OUT_H = 1200;
let stateRef;
let commitRef;
let photoEnhancementsWired = false;

const $ = sel => document.querySelector(sel);

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => box.classList.remove("show"), 2600);
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
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas;
}

async function makePhotoFile(img, settings) {
  const canvas = drawOutput(img, settings);
  for (const q of [0.9, 0.82, 0.74, 0.66, 0.58]) {
    const blob = await canvasToBlob(canvas, q);
    if (blob && blob.size <= MAX_PHOTO_BYTES) return new File([blob], "applicant-photo.jpg", { type: "image/jpeg" });
  }
  const small = document.createElement("canvas");
  small.width = 720;
  small.height = 960;
  const ctx = small.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, small.width, small.height);
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const blob = await canvasToBlob(small, 0.62);
  return new File([blob], "applicant-photo.jpg", { type: "image/jpeg" });
}

async function openPhotoEditor(input, file) {
  const img = await loadImageFromFile(file);
  const settings = { zoom: 1, x: 0, y: 0, cleanBg: false };
  const root = $("#modalRoot") || document.body;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal photo-editor-modal";
  modal.innerHTML = `
    <div class="modal-head">
      <h3>Edit Applicant Photo</h3>
      <button type="button" class="small secondary" data-photo-close>Close</button>
    </div>
    <div class="photo-editor-body">
      <canvas class="photo-crop-canvas" width="270" height="360"></canvas>
      <div class="photo-editor-controls">
        <label class="stacked">Zoom <input type="range" min="1" max="3" step="0.01" value="1" data-photo-zoom></label>
        <label class="stacked">Move Left / Right <input type="range" min="-100" max="100" step="1" value="0" data-photo-x></label>
        <label class="stacked">Move Up / Down <input type="range" min="-100" max="100" step="1" value="0" data-photo-y></label>
        <button type="button" class="secondary" data-photo-bg>Remove background + white background</button>
        <div class="message">Photo will be saved as 3:4 ratio and compressed below 1.8 MB.</div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="secondary" data-photo-close>Cancel</button>
      <button type="button" data-photo-use>Use Photo</button>
    </div>`;
  backdrop.append(modal);
  root.append(backdrop);

  const canvas = modal.querySelector("canvas");
  const render = () => drawOutput(img, settings, canvas);
  render();

  modal.querySelector("[data-photo-zoom]").addEventListener("input", e => { settings.zoom = Number(e.target.value) || 1; render(); });
  modal.querySelector("[data-photo-x]").addEventListener("input", e => { settings.x = Number(e.target.value) || 0; render(); });
  modal.querySelector("[data-photo-y]").addEventListener("input", e => { settings.y = Number(e.target.value) || 0; render(); });
  modal.querySelector("[data-photo-bg]").addEventListener("click", () => { settings.cleanBg = !settings.cleanBg; render(); toast(settings.cleanBg ? "White background enabled." : "Background cleanup disabled."); });
  modal.querySelectorAll("[data-photo-close]").forEach(btn => btn.addEventListener("click", () => { input.value = ""; backdrop.remove(); }));
  modal.querySelector("[data-photo-use]").addEventListener("click", async () => {
    const editedFile = await makePhotoFile(img, settings);
    if (editedFile.size > MAX_PHOTO_BYTES) {
      alert("Could not compress photo below 1.8 MB. Please choose a smaller image.");
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(editedFile);
    input.dataset.photoReady = "1";
    input.files = dt.files;
    backdrop.remove();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function wirePhotoInputs() {
  if (photoEnhancementsWired) return;
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
    openPhotoEditor(input, file).catch(err => {
      console.error(err);
      input.value = "";
      alert(err.message || "Could not edit photo.");
    });
  }, true);
  photoEnhancementsWired = true;
}

export function initEnhancements(state, commit) {
  stateRef = state;
  commitRef = commit;
  initBaseEnhancements(state, commit);
  wireClearData();
  wirePhotoInputs();
}

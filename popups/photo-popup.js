const MAX_PHOTO_BYTES = 1.8 * 1024 * 1024;
let templateText = "";

const VERSION = "26-07-06-ui-polish";
const $ = (selector, root = document) => root.querySelector(selector);

async function getTemplate() {
  if (templateText) return templateText;
  const response = await fetch(`./popups/photo-popup.html?v=${VERSION}`);
  if (!response.ok) throw new Error("Could not load Photo popup template.");
  templateText = await response.text();
  return templateText;
}

function openShell() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop native-photo-popup";
  backdrop.innerHTML = `<div class="modal"><div class="modal-head"><h3>Edit Applicant Photo</h3><button type="button" class="small secondary" data-close>Close</button></div><div data-body></div></div>`;
  backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());
  $("#modalRoot").append(backdrop);
  return backdrop;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load photo.")); };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
}

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export async function openPhotoPopup(file) {
  const image = await loadImage(file);
  const shell = openShell();
  shell.querySelector("[data-body]").innerHTML = await getTemplate();
  const canvas = shell.querySelector("[data-canvas]");
  const settings = { zoom: 1, x: 0, y: 0, bg: false };

  function draw(out = canvas, width = 270, height = 360) {
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d", { willReadFrequently: settings.bg });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    const ratio = 0.75;
    const cropHeight = Math.min(image.height / settings.zoom, image.width / ratio / settings.zoom);
    const cropWidth = cropHeight * ratio;
    const baseX = (image.width - cropWidth) / 2;
    const baseY = (image.height - cropHeight) / 2;
    const sx = Math.max(0, Math.min(image.width - cropWidth, baseX - baseX * settings.x / 100));
    const sy = Math.max(0, Math.min(image.height - cropHeight, baseY + baseY * settings.y / 100));
    ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, width, height);
    if (settings.bg) {
      const data = ctx.getImageData(0, 0, width, height);
      const d = data.data;
      const c = [d[0], d[1], d[2]];
      for (let i = 0; i < d.length; i += 4) {
        const diff = Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);
        const bright = d[i] > 185 && d[i + 1] > 185 && d[i + 2] > 185;
        if (diff < 95 || bright) {
          d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
        }
      }
      ctx.putImageData(data, 0, 0);
    }
    return out;
  }

  draw();
  shell.querySelector("[data-zoom]").addEventListener("input", e => { settings.zoom = Number(e.target.value) || 1; draw(); });
  shell.querySelector("[data-x]").addEventListener("input", e => { settings.x = Number(e.target.value) || 0; draw(); });
  shell.querySelector("[data-y]").addEventListener("input", e => { settings.y = Number(e.target.value) || 0; draw(); });
  shell.querySelector("[data-bg]").addEventListener("click", e => { settings.bg = !settings.bg; e.currentTarget.classList.toggle("danger", settings.bg); draw(); });

  return new Promise((resolve, reject) => {
    shell.querySelector("[data-cancel]").addEventListener("click", () => { shell.remove(); reject(new Error("Photo cancelled.")); });
    shell.querySelector("[data-use]").addEventListener("click", async () => {
      try {
        let output = draw(document.createElement("canvas"), 900, 1200);
        let blob = null;
        for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
          blob = await canvasToBlob(output, quality);
          if (blob && blob.size <= MAX_PHOTO_BYTES) break;
        }
        if (!blob || blob.size > MAX_PHOTO_BYTES) {
          output = draw(document.createElement("canvas"), 720, 960);
          blob = await canvasToBlob(output, 0.62);
        }
        if (!blob || blob.size > MAX_PHOTO_BYTES) throw new Error("Could not compress photo below 1.8 MB.");
        const dataUrl = await blobToDataUrl(blob);
        shell.remove();
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    });
  });
}

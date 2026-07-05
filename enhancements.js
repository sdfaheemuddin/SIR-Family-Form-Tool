import { buildReadonly, formatAadhaar, onlyDigits } from "./core.js";

const VERSION = "26-07-06";
const WA_MESSAGE = "SIR acknowledgement";
let stateRef;
let isRenderingReadonly = false;
let enhanceTimer = 0;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function cleanText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function formatDateForDisplay(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return raw;
  return raw;
}

function safePhotoSrc(value) {
  const src = String(value || "");
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src) ? src : "";
}

function safeFilePart(value) {
  return String(value || "applicant").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "applicant";
}

function photoExtension(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpe?g|webp|gif);base64,/i);
  if (!match) return "jpg";
  const type = match[1].toLowerCase();
  return type === "jpeg" ? "jpg" : type;
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => box.classList.remove("show"), 2400);
}

async function copyText(value) {
  const text = cleanText(value);
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
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
}

function copyCell(label, value, displayValue = value) {
  const copyValue = cleanText(value);
  return `
    <div class="copy-table-cell" role="button" tabindex="0" data-copy-value="${esc(copyValue)}">
      <div class="copy-table-label">${esc(label)}</div>
      <div class="copy-table-value">${esc(displayValue)}</div>
    </div>`;
}

function valueCell(label, value, displayValue = value) {
  return `
    <div class="copy-table-cell no-copy">
      <div class="copy-table-label">${esc(label)}</div>
      <div class="copy-table-value">${esc(displayValue)}</div>
    </div>`;
}

function photoBlock(applicant, applicantName) {
  const photo = safePhotoSrc(applicant.photo_data);
  if (!photo) return "";
  const fileName = `${safeFilePart(applicantName)}_photo.${photoExtension(photo)}`;
  return `
    <section class="read-section photo-read-section">
      <h4>Applicant Photo</h4>
      <div class="readonly-photo-box">
        <img class="readonly-photo" src="${esc(photo)}" alt="Applicant photo">
        <a class="button-link small" href="${esc(photo)}" download="${esc(fileName)}">Download Photo</a>
      </div>
    </section>`;
}

function mapperSummary(data) {
  return `
    <div class="copy-table-grid mapper-summary-grid four-cols">
      ${valueCell("Mapper Name", data["Mapper Name as per 2002"] || data["Mapping Name"] || "")}
      ${valueCell("2002 EPIC Number", data["Mapper 2002 EPIC Number"] || "")}
      ${valueCell("Relative", data["Mapper Relative Name"] || "")}
      ${valueCell("Relation with Relative", data["Mapper Relationship with Relative"] || "")}
    </div>`;
}

function renderEnhancedReadonlyCard() {
  if (isRenderingReadonly) return;
  const box = $("#readonlyCard");
  const select = $("#readonlyApplicantSelect");
  if (!box || !select) return;
  const applicant = stateRef.applicants.find(a => a.applicant_id === select.value);
  if (!applicant) return;
  if (box.dataset.enhancedApplicantId === applicant.applicant_id && box.querySelector(".enhanced-read-card")) return;

  isRenderingReadonly = true;
  const data = buildReadonly(applicant, stateRef.people);
  const applicantName = data.applicant_name || "Applicant";
  const dobDisplay = formatDateForDisplay(data["Date of Birth"] || applicant.date_of_birth);
  const phone = onlyDigits(data["Phone Number"]);
  const aadhaarDigits = onlyDigits(data["Aadhaar Number"]);

  box.dataset.enhancedApplicantId = applicant.applicant_id;
  box.innerHTML = `
    <div class="read-card enhanced-read-card">
      <h3>${esc(applicantName)}</h3>
      <div class="copy-help">Click on text to copy</div>
      ${photoBlock(applicant, applicantName)}

      <section class="read-section">
        <div class="copy-table-grid two-cols">
          ${copyCell("EPIC ID", data["EPIC ID"])}
          ${copyCell("Phone Number", phone)}
        </div>
      </section>

      <section class="read-section">
        <h4>Mapping Details</h4>
        <div class="copy-table-grid two-cols">
          ${valueCell("Type", data["Mapping Type"])}
          ${valueCell("Relationship", data["Mapping Relation"])}
        </div>
        ${mapperSummary(data)}
        <div class="copy-table-grid two-cols">
          ${valueCell("State", data["Mapping State"])}
          ${valueCell("District", data["Mapping District"])}
        </div>
        <div class="copy-table-grid three-cols">
          ${valueCell("AC No", data["Mapping AC No Display"])}
          ${valueCell("Part No", data["Mapping Part No"])}
          ${valueCell("Sl No", data["Mapping Serial No"])}
        </div>
      </section>

      <section class="read-section">
        <h4>Applicant Details</h4>
        <div class="copy-table-grid two-cols">
          ${copyCell("Date of Birth", dobDisplay)}
          ${copyCell("Aadhaar Number", aadhaarDigits, formatAadhaar(aadhaarDigits))}
        </div>
        <h5>Father</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Father’s Name"])}
          ${copyCell("EPIC Number", data["Father’s EPIC Number"])}
        </div>
        <h5>Mother</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Mother’s Name"])}
          ${copyCell("EPIC Number", data["Mother’s EPIC Number"])}
        </div>
        <h5>Spouse</h5>
        <div class="copy-table-grid two-cols">
          ${copyCell("Name", data["Spouse’s Name"])}
          ${copyCell("EPIC Number", data["Spouse’s EPIC Number"])}
        </div>
      </section>
    </div>`;

  box.querySelectorAll("[data-copy-value]").forEach(node => {
    const handler = () => copyText(node.dataset.copyValue || "");
    node.addEventListener("click", handler);
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  });
  isRenderingReadonly = false;
}

function setupTabs() {
  const main = document.querySelector("main.grid");
  const readonly = $("#readonlySection");
  const applicants = $("#applicantsSection");
  const people = $("#peopleSection");
  if (!main || !readonly || !applicants || !people || $(".app-tabs")) return;

  main.classList.remove("grid");
  main.classList.add("tabbed-main");
  const tabs = document.createElement("div");
  tabs.className = "app-tabs";
  tabs.innerHTML = `
    <button type="button" class="tab-btn active" data-tab-target="readonlyTab">Applicant Data</button>
    <button type="button" class="tab-btn" data-tab-target="databaseTab">Database</button>`;

  const readonlyTab = document.createElement("div");
  readonlyTab.id = "readonlyTab";
  readonlyTab.className = "tab-panel active";
  const databaseTab = document.createElement("div");
  databaseTab.id = "databaseTab";
  databaseTab.className = "tab-panel database-grid";

  main.innerHTML = "";
  main.append(tabs, readonlyTab, databaseTab);
  readonlyTab.append(readonly);
  databaseTab.append(applicants, people);

  tabs.addEventListener("click", event => {
    const btn = event.target.closest("[data-tab-target]");
    if (!btn) return;
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === btn.dataset.tabTarget));
  });
}

function updateStaticLabels() {
  const peopleTitle = $("#peopleSection h2");
  const applicantTitle = $("#applicantsSection h2");
  const readonlyTitle = $("#readonlySection h2");
  if (peopleTitle) peopleTitle.textContent = "People Database";
  if (applicantTitle) applicantTitle.textContent = "Applicant Database";
  if (readonlyTitle) readonlyTitle.textContent = "Applicant Data";

  const pickerLabel = $("#readonlySection .readonly-picker .stacked");
  if (pickerLabel) {
    const textNode = Array.from(pickerLabel.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes("Select incomplete applicant"));
    if (textNode) textNode.textContent = "Select applicant ";
  }
}

function addNewApplicantButton() {
  const actions = $(".readonly-actions-bottom");
  if (!actions || $("#readonlyNewApplicantBtn")) return;
  const btn = document.createElement("button");
  btn.id = "readonlyNewApplicantBtn";
  btn.type = "button";
  btn.className = "secondary";
  btn.textContent = "New Applicant";
  btn.addEventListener("click", () => $("#addApplicantBtn")?.click());
  actions.append(btn);
}

function addVersionBadge() {
  if ($("#appVersionBadge")) return;
  const badge = document.createElement("div");
  badge.id = "appVersionBadge";
  badge.textContent = `Version ${VERSION}`;
  document.body.append(badge);
}

function updateWhatsappLinks() {
  $$("a[href^='https://wa.me/91']").forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set("text", WA_MESSAGE);
    link.href = url.toString();
  });
}

function move2002EpicToLast() {
  $$(".details-2002").forEach(box => {
    const epicLabel = Array.from(box.querySelectorAll(".stacked span")).find(span => span.textContent.trim() === "2002 EPIC number");
    const epicWrap = epicLabel?.closest(".stacked");
    if (epicWrap && epicWrap !== box.lastElementChild) box.append(epicWrap);
  });
}

function applyEnhancements() {
  setupTabs();
  updateStaticLabels();
  addNewApplicantButton();
  addVersionBadge();
  updateWhatsappLinks();
  move2002EpicToLast();
  renderEnhancedReadonlyCard();
}

function scheduleEnhancements() {
  window.clearTimeout(enhanceTimer);
  enhanceTimer = window.setTimeout(applyEnhancements, 30);
}

export function initEnhancements(state) {
  stateRef = state;
  applyEnhancements();
  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(document.body, { childList: true, subtree: true });
}

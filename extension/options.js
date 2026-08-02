const DEFAULT_KEYS = ["v", "s"];
const DEFAULT_TIMEOUT_MS = 700;

const firstKey = document.getElementById("first-key");
const secondKey = document.getElementById("second-key");
const timeout = document.getElementById("timeout");
const status = document.getElementById("status");
const firstPreview = document.getElementById("shortcut-preview");
const secondPreview = document.getElementById("second-preview");
const previewSeparator = document.getElementById("preview-separator");

document.getElementById("save").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", reset);
firstKey.addEventListener("input", normalizeInputs);
secondKey.addEventListener("input", normalizeInputs);

load();

async function load() {
  const settings = await chrome.storage.sync.get({
    vscShortcutKeys: DEFAULT_KEYS,
    vscShortcutTimeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const keys = sanitizeKeys(settings.vscShortcutKeys);
  firstKey.value = keys[0] || "";
  secondKey.value = keys[1] || "";
  timeout.value = String(settings.vscShortcutTimeoutMs || DEFAULT_TIMEOUT_MS);
  updatePreview();
}

async function save() {
  const keys = sanitizeKeys([firstKey.value, secondKey.value]);
  if (!keys.length) {
    status.textContent = "Choose at least one letter or number.";
    firstKey.focus();
    return;
  }
  await chrome.storage.sync.set({
    vscShortcutKeys: keys,
    vscShortcutTimeoutMs: Number(timeout.value),
  });
  status.textContent = "Saved ✓";
  setTimeout(() => { status.textContent = ""; }, 1800);
  updatePreview();
}

async function reset() {
  firstKey.value = DEFAULT_KEYS[0];
  secondKey.value = DEFAULT_KEYS[1];
  timeout.value = String(DEFAULT_TIMEOUT_MS);
  await save();
}

function normalizeInputs(event) {
  event.target.value = String(event.target.value || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-1);
  status.textContent = "";
  updatePreview();
}

function sanitizeKeys(values) {
  return (Array.isArray(values) ? values : DEFAULT_KEYS)
    .map((key) => String(key || "").toLowerCase())
    .filter((key) => /^[a-z0-9]$/.test(key))
    .slice(0, 2);
}

function updatePreview() {
  firstPreview.textContent = (firstKey.value || "?").toUpperCase();
  const hasSecond = Boolean(secondKey.value);
  secondPreview.textContent = hasSecond ? secondKey.value.toUpperCase() : "";
  secondPreview.hidden = !hasSecond;
  previewSeparator.hidden = !hasSecond;
}

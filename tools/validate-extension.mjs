import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "extension");
const manifestPath = join(extensionDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.permissions.includes("clipboardWrite"), "clipboardWrite permission is required");
assert(manifest.permissions.includes("offscreen"), "offscreen permission is required for reliable clipboard writes");
assert(!manifest.permissions.includes("downloads"), "downloads permission must not be present");
assert(!manifest.permissions.includes("tabs"), "tabs permission is intentionally unnecessary");
assert(manifest.host_permissions.includes("<all_urls>"), "<all_urls> is required by captureVisibleTab");
assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 1, "one content script entry is expected");

const referencedFiles = new Set([
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  "offscreen.html",
  "offscreen.js",
  ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean));

for (const relativePath of referencedFiles) {
  const info = await stat(join(extensionDir, relativePath));
  assert(info.isFile(), `${relativePath} must be a file`);
}

for (const script of ["background.js", "content.js", "frame-utils.js", "offscreen.js", "options.js"]) {
  execFileSync(process.execPath, ["--check", join(extensionDir, script)], { stdio: "inherit" });
}

console.log(`Validated Manifest V3 package (${referencedFiles.size} referenced files).`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

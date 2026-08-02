import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "extension");
const distDir = join(root, "dist");
const manifest = JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8"));
const output = join(distDir, `frame-screenshot-clipboard-v${manifest.version}.zip`);

await mkdir(distDir, { recursive: true });
await rm(output, { force: true });
execFileSync("zip", ["-q", "-r", output, "."], { cwd: extensionDir });
console.log(output);

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "assets", "icons");
const outputDir = join(root, "extension", "icons");

await mkdir(outputDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const filename = `icon${size}.png`;
  await copyFile(join(sourceDir, filename), join(outputDir, filename));
}

console.log("Installed the Frame icon set into extension/icons.");

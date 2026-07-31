import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixture");
const port = Number(process.env.VSC_FIXTURE_PORT || 4173);

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const body = await readFile(file);
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" }[extname(file)] || "application/octet-stream";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(body);
  } catch (_) {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Video fixture: http://127.0.0.1:${port}`);
});

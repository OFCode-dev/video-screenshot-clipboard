import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "extension", "icons");
await mkdir(outputDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const supersample = 4;
  const sourceSize = size * supersample;
  const pixels = new Uint8Array(sourceSize * sourceSize * 4);
  drawIcon(pixels, sourceSize);
  const downsampled = downsample(pixels, sourceSize, supersample);
  await writeFile(join(outputDir, `icon${size}.png`), encodePng(size, size, downsampled));
}

console.log("Generated extension icons.");

function drawIcon(pixels, size) {
  const radius = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedRect(x, y, 0, 0, size, size, radius)) continue;
      const t = (x + y) / (size * 2);
      setPixel(pixels, size, x, y, mix([79, 70, 229], [14, 165, 233], t));
    }
  }

  fillRoundedRect(pixels, size, size * 0.16, size * 0.24, size * 0.68, size * 0.48, size * 0.07, [255, 255, 255, 245]);
  fillRoundedRect(pixels, size, size * 0.21, size * 0.29, size * 0.58, size * 0.38, size * 0.045, [30, 41, 79, 255]);
  fillCircle(pixels, size, size * 0.5, size * 0.48, size * 0.13, [125, 211, 252, 255]);
  fillCircle(pixels, size, size * 0.5, size * 0.48, size * 0.07, [255, 255, 255, 255]);
  fillRoundedRect(pixels, size, size * 0.33, size * 0.17, size * 0.22, size * 0.11, size * 0.04, [255, 255, 255, 245]);

  fillRoundedRect(pixels, size, size * 0.58, size * 0.58, size * 0.27, size * 0.25, size * 0.055, [17, 24, 39, 245]);
  fillRoundedRect(pixels, size, size * 0.63, size * 0.53, size * 0.17, size * 0.09, size * 0.035, [255, 255, 255, 255]);
  drawLine(pixels, size, size * 0.64, size * 0.7, size * 0.69, size * 0.75, size * 0.035, [134, 239, 172, 255]);
  drawLine(pixels, size, size * 0.69, size * 0.75, size * 0.79, size * 0.64, size * 0.035, [134, 239, 172, 255]);
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.ceil(x + width);
  const bottom = Math.ceil(y + height);
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      if (insideRoundedRect(px, py, x, y, width, height, radius)) setPixel(pixels, size, px, py, color);
    }
  }
}

function insideRoundedRect(px, py, x, y, width, height, radius) {
  const cx = Math.max(x + radius, Math.min(px, x + width - radius));
  const cy = Math.max(y + radius, Math.min(py, y + height - radius));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function fillCircle(pixels, size, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(pixels, size, x, y, color);
    }
  }
}

function drawLine(pixels, size, x1, y1, x2, y2, width, color) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    fillCircle(pixels, size, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width, color);
  }
}

function setPixel(pixels, size, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3] ?? 255;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

function downsample(source, sourceSize, factor) {
  const targetSize = sourceSize / factor;
  const target = new Uint8Array(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const index = (((y * factor + sy) * sourceSize) + x * factor + sx) * 4;
          for (let channel = 0; channel < 4; channel++) totals[channel] += source[index + channel];
        }
      }
      const output = (y * targetSize + x) * 4;
      const samples = factor * factor;
      for (let channel = 0; channel < 4; channel++) target[output + channel] = Math.round(totals[channel] / samples);
    }
  }
  return target;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([uint32(data.length), body, uint32(crc32(body))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

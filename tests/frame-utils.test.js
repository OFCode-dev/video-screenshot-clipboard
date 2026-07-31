const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeBitmapCrop,
  fitWithin,
  intersectRect,
  isVideoReady,
} = require("../extension/frame-utils.js");

test("intersectRect keeps a fully visible video rectangle", () => {
  assert.deepEqual(
    intersectRect({ left: 10, top: 20, right: 210, bottom: 120 }, 800, 600),
    { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 }
  );
});

test("intersectRect clips a partially offscreen video", () => {
  assert.deepEqual(
    intersectRect({ left: -50, top: 500, right: 450, bottom: 700 }, 800, 600),
    { left: 0, top: 500, right: 450, bottom: 600, width: 450, height: 100 }
  );
});

test("computeBitmapCrop maps CSS pixels to a HiDPI screenshot", () => {
  const crop = computeBitmapCrop(
    1600,
    1200,
    800,
    600,
    { left: 100, top: 50, right: 700, bottom: 450 }
  );
  assert.equal(crop.sourceX, 200);
  assert.equal(crop.sourceY, 100);
  assert.equal(crop.sourceWidth, 1200);
  assert.equal(crop.sourceHeight, 800);
  assert.equal(crop.scaleX, 2);
  assert.equal(crop.scaleY, 2);
});

test("computeBitmapCrop rejects a video outside the viewport", () => {
  assert.throws(
    () => computeBitmapCrop(800, 600, 800, 600, { left: 900, top: 0, right: 1000, bottom: 100 }),
    /outside the visible viewport/
  );
});

test("fitWithin preserves aspect ratio under the canvas limit", () => {
  assert.deepEqual(fitWithin(20000, 10000, 16000), {
    width: 16000,
    height: 8000,
    scale: 0.8,
  });
  assert.deepEqual(fitWithin(1920, 1080, 16000), {
    width: 1920,
    height: 1080,
    scale: 1,
  });
});

test("isVideoReady requires decoded dimensions and current data", () => {
  assert.equal(isVideoReady({ videoWidth: 1920, videoHeight: 1080, readyState: 2 }), true);
  assert.equal(isVideoReady({ videoWidth: 0, videoHeight: 0, readyState: 0 }), false);
});

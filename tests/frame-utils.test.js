const test = require("node:test");
const assert = require("node:assert/strict");
const {
  advanceShortcutState,
  computeBitmapCrop,
  fitWithin,
  intersectRect,
  isVideoReady,
  shiftBelowRects,
  shiftLeftToAvoidRects,
  translateRectThroughFrame,
} = require("../extension/frame-utils.js");

test("shiftBelowRects drops a control under a pinned header", () => {
  const top = shiftBelowRects(12, 1200, 38, 38, 400, [
    { left: 0, top: 0, right: 1440, bottom: 84 },
  ]);
  assert.equal(top, 92);
});

test("shiftBelowRects clears stacked banners", () => {
  const top = shiftBelowRects(12, 1200, 38, 38, 400, [
    { left: 0, top: 0, right: 1440, bottom: 40 },
    { left: 0, top: 40, right: 1440, bottom: 120 },
  ]);
  assert.equal(top, 128);
});

test("shiftBelowRects leaves an unobstructed control untouched", () => {
  assert.equal(shiftBelowRects(200, 1200, 38, 38, 400, [
    { left: 0, top: 0, right: 1440, bottom: 84 },
  ]), 200);
});

test("shiftBelowRects never pushes a control past the video", () => {
  const top = shiftBelowRects(12, 1200, 38, 38, 30, [
    { left: 0, top: 0, right: 1440, bottom: 400 },
  ]);
  assert.equal(top, 30);
});

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

test("translateRectThroughFrame accumulates iframe position and borders", () => {
  assert.deepEqual(
    translateRectThroughFrame(
      { left: 10, top: 20, right: 310, bottom: 190 },
      { left: 100, top: 50 },
      640,
      360,
      2,
      3
    ),
    { left: 112, top: 73, right: 412, bottom: 243, width: 300, height: 170 }
  );
});

test("translateRectThroughFrame clips media to iframe content bounds", () => {
  assert.deepEqual(
    translateRectThroughFrame(
      { left: -20, top: 10, right: 700, bottom: 500 },
      { left: 100, top: 50 },
      640,
      360
    ),
    { left: 100, top: 60, right: 740, bottom: 410, width: 640, height: 350 }
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

test("shiftLeftToAvoidRects moves a control away from an occupied corner", () => {
  const left = shiftLeftToAvoidRects(
    100,
    20,
    38,
    38,
    12,
    [{ left: 112, top: 18, right: 138, bottom: 44 }],
    8
  );
  assert.equal(left, 54);
});

test("shiftLeftToAvoidRects keeps a free position unchanged", () => {
  const left = shiftLeftToAvoidRects(
    100,
    20,
    38,
    38,
    12,
    [{ left: 10, top: 100, right: 36, bottom: 126 }],
    8
  );
  assert.equal(left, 100);
});

test("advanceShortcutState triggers V then S inside the timeout", () => {
  const first = advanceShortcutState({ index: 0, lastAt: 0 }, "v", ["v", "s"], 1000, 700);
  assert.deepEqual(first, { index: 1, lastAt: 1000, triggered: false });
  const second = advanceShortcutState(first, "s", ["v", "s"], 1500, 700);
  assert.deepEqual(second, { index: 0, lastAt: 0, triggered: true });
});

test("advanceShortcutState rejects a sequence after the timeout", () => {
  const first = advanceShortcutState({ index: 0, lastAt: 0 }, "s", ["s", "s"], 1000, 500);
  const second = advanceShortcutState(first, "s", ["s", "s"], 1700, 500);
  assert.deepEqual(second, { index: 1, lastAt: 1700, triggered: false });
});

test("advanceShortcutState supports a single key", () => {
  assert.deepEqual(
    advanceShortcutState({ index: 0, lastAt: 0 }, "p", ["p"], 1000, 700),
    { index: 0, lastAt: 0, triggered: true }
  );
});

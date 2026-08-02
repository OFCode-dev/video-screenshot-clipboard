const test = require("node:test");
const assert = require("node:assert/strict");
const {
  advanceShortcutState,
  computeBitmapCrop,
  fitWithin,
  intersectRect,
  intersectRects,
  isVideoReady,
  rectsOverlap,
  reduceOverlayCandidates,
  rememberInlineStyle,
  restoreInlineStyles,
  sampleRectPoints,
  scrollOffsetToReveal,
  shiftBelowRects,
  shiftLeftToAvoidRects,
  stackAboveTarget,
  translateRectThroughFrame,
} = require("../extension/frame-utils.js");

// Minimal stand-ins for DOM nodes: enough to exercise containment and the
// inline-style bookkeeping without pulling in a browser environment.
function fakeElement(name, children = []) {
  const declarations = new Map();
  const element = {
    name,
    children,
    declarations,
    style: {
      getPropertyValue: (property) => (declarations.get(property) || {}).value || "",
      getPropertyPriority: (property) => (declarations.get(property) || {}).priority || "",
      setProperty: (property, value, priority = "") => declarations.set(property, { value, priority }),
      removeProperty: (property) => declarations.delete(property),
    },
    contains(other) {
      if (other === element) return true;
      return children.some((child) => child.contains(other));
    },
  };
  return element;
}

test("sampleRectPoints spreads probes across the whole visible video", () => {
  const points = sampleRectPoints({ left: 0, top: 0, right: 100, bottom: 100 }, 3, 3, 0);
  assert.equal(points.length, 9);
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points[4], { x: 50, y: 50 });
  assert.deepEqual(points[8], { x: 100, y: 100 });
});

test("sampleRectPoints ignores a collapsed rectangle", () => {
  assert.deepEqual(sampleRectPoints({ left: 10, top: 10, right: 10, bottom: 40 }), []);
});

test("stackAboveTarget keeps only what paints above the video", () => {
  const nav = fakeElement("nav");
  const hero = fakeElement("hero");
  const video = fakeElement("video");
  const backdrop = fakeElement("backdrop");
  // elementsFromPoint order is topmost first, so backdrop paints behind the
  // video even though the rectangles overlap.
  assert.deepEqual(stackAboveTarget([nav, hero, video, backdrop], video), [nav, hero]);
});

test("stackAboveTarget returns the whole stack when the video is not hit", () => {
  const cover = fakeElement("cover");
  const video = fakeElement("video");
  assert.deepEqual(stackAboveTarget([cover], video), [cover]);
});

test("reduceOverlayCandidates dedupes repeated probe hits", () => {
  const badge = fakeElement("badge");
  assert.deepEqual(reduceOverlayCandidates([badge, badge, badge]), [badge]);
});

test("reduceOverlayCandidates keeps the innermost overlay, not its container", () => {
  const headline = fakeElement("headline");
  const section = fakeElement("section", [headline]);
  assert.deepEqual(reduceOverlayCandidates([section, headline]), [headline]);
});

test("a full-bleed hero hides the copy above the video and keeps its ancestors", () => {
  const headline = fakeElement("headline");
  const cta = fakeElement("cta");
  const heroCopy = fakeElement("hero-copy", [headline, cta]);
  const navLink = fakeElement("nav-link");
  const nav = fakeElement("nav", [navLink]);
  const video = fakeElement("video");
  const videoWrap = fakeElement("video-wrap", [video]);
  const hero = fakeElement("hero", [videoWrap, heroCopy]);

  const above = stackAboveTarget([navLink, nav, headline, heroCopy, hero, videoWrap, video], video);
  // The content script drops anything that renders the video before reducing.
  const hideable = above.filter((element) => !element.contains(video));
  const reduced = reduceOverlayCandidates(hideable);

  assert.deepEqual(reduced, [navLink, headline]);
  assert.ok(!reduced.includes(hero));
  assert.ok(!reduced.includes(videoWrap));
  assert.ok(!reduced.includes(video));
});

test("rememberInlineStyle and restoreInlineStyles put an untouched element back", () => {
  const banner = fakeElement("banner");
  const entry = rememberInlineStyle(banner, "visibility");
  banner.style.setProperty("visibility", "hidden", "important");
  assert.equal(banner.style.getPropertyValue("visibility"), "hidden");

  restoreInlineStyles([entry]);
  assert.equal(banner.style.getPropertyValue("visibility"), "");
  assert.equal(banner.declarations.has("visibility"), false);
});

test("restoreInlineStyles preserves an existing declaration and its priority", () => {
  const banner = fakeElement("banner");
  banner.style.setProperty("visibility", "visible", "important");
  const entry = rememberInlineStyle(banner, "visibility");
  banner.style.setProperty("visibility", "hidden", "important");

  restoreInlineStyles([entry]);
  assert.equal(banner.style.getPropertyValue("visibility"), "visible");
  assert.equal(banner.style.getPropertyPriority("visibility"), "important");
});

test("restoreInlineStyles survives a partially recorded batch", () => {
  const kept = fakeElement("kept");
  const entry = rememberInlineStyle(kept, "visibility");
  kept.style.setProperty("visibility", "hidden", "important");
  restoreInlineStyles([null, entry, undefined]);
  assert.equal(kept.style.getPropertyValue("visibility"), "");
});

test("scrollOffsetToReveal leaves a fully visible player alone", () => {
  const offset = scrollOffsetToReveal({ left: 100, top: 100, right: 700, bottom: 500 }, 1000, 800);
  assert.deepEqual(offset, { x: 0, y: 0 });
});

test("scrollOffsetToReveal scrolls a player hanging off the bottom into view", () => {
  const offset = scrollOffsetToReveal({ left: 0, top: 500, right: 800, bottom: 1000 }, 1000, 800, 8);
  // Bringing the bottom in costs 208px, and the top can spare 492px, so the
  // cheaper move wins and the top edge stays on screen.
  assert.deepEqual(offset, { x: 0, y: 208 });
});

test("scrollOffsetToReveal pulls a player back from above the fold", () => {
  const offset = scrollOffsetToReveal({ left: 0, top: -120, right: 800, bottom: 300 }, 1000, 800, 8);
  assert.deepEqual(offset, { x: 0, y: -128 });
});

test("scrollOffsetToReveal aligns a player taller than the viewport to its top", () => {
  const offset = scrollOffsetToReveal({ left: 0, top: 200, right: 800, bottom: 1400 }, 1000, 800, 8);
  assert.deepEqual(offset, { x: 0, y: 192 });
});

test("intersectRects returns the shared area of an overlay and the video", () => {
  const overlap = intersectRects(
    { left: 100, top: 500, right: 900, bottom: 700 },
    { left: 0, top: 100, right: 800, bottom: 600 }
  );
  assert.deepEqual(overlap, { left: 100, top: 500, right: 800, bottom: 600, width: 700, height: 100 });
});

test("intersectRects reports no shared area for separated rectangles", () => {
  const overlap = intersectRects(
    { left: 0, top: 0, right: 100, bottom: 50 },
    { left: 0, top: 200, right: 100, bottom: 400 }
  );
  assert.equal(overlap.width * overlap.height, 0);
});

test("rectsOverlap separates a touching header from an overlapping one", () => {
  const video = { left: 0, top: 100, right: 800, bottom: 500 };
  assert.equal(rectsOverlap({ left: 0, top: 0, right: 800, bottom: 100 }, video), false);
  assert.equal(rectsOverlap({ left: 0, top: 0, right: 800, bottom: 140 }, video), true);
});

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

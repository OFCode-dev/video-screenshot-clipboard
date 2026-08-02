(function initFrameUtils(root, factory) {
  const api = factory();
  root.FrameUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFrameUtils() {
  "use strict";

  function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function intersectRect(rect, viewportWidth, viewportHeight) {
    const vw = Math.max(0, finite(viewportWidth));
    const vh = Math.max(0, finite(viewportHeight));
    const left = Math.max(0, finite(rect && rect.left));
    const top = Math.max(0, finite(rect && rect.top));
    const right = Math.min(vw, finite(rect && rect.right, left));
    const bottom = Math.min(vh, finite(rect && rect.bottom, top));

    return {
      left,
      top,
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function computeBitmapCrop(bitmapWidth, bitmapHeight, viewportWidth, viewportHeight, rect) {
    const bw = Math.max(1, Math.round(finite(bitmapWidth, 1)));
    const bh = Math.max(1, Math.round(finite(bitmapHeight, 1)));
    const vw = Math.max(1, finite(viewportWidth, 1));
    const vh = Math.max(1, finite(viewportHeight, 1));
    const visible = intersectRect(rect, vw, vh);

    if (visible.width < 1 || visible.height < 1) {
      throw new Error("Video is outside the visible viewport");
    }

    const scaleX = bw / vw;
    const scaleY = bh / vh;
    const sourceX = clamp(Math.round(visible.left * scaleX), 0, bw - 1);
    const sourceY = clamp(Math.round(visible.top * scaleY), 0, bh - 1);
    const sourceWidth = clamp(Math.round(visible.width * scaleX), 1, bw - sourceX);
    const sourceHeight = clamp(Math.round(visible.height * scaleY), 1, bh - sourceY);

    return {
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      visible,
      scaleX,
      scaleY,
    };
  }

  function translateRectThroughFrame(rect, frameRect, contentWidth, contentHeight, borderLeft = 0, borderTop = 0) {
    const frameLeft = finite(frameRect && frameRect.left) + Math.max(0, finite(borderLeft));
    const frameTop = finite(frameRect && frameRect.top) + Math.max(0, finite(borderTop));
    const frameRight = frameLeft + Math.max(0, finite(contentWidth));
    const frameBottom = frameTop + Math.max(0, finite(contentHeight));
    const left = Math.max(frameLeft, frameLeft + finite(rect && rect.left));
    const top = Math.max(frameTop, frameTop + finite(rect && rect.top));
    const right = Math.min(frameRight, frameLeft + finite(rect && rect.right));
    const bottom = Math.min(frameBottom, frameTop + finite(rect && rect.bottom));

    return {
      left,
      top,
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function fitWithin(width, height, maxDimension) {
    const w = Math.max(1, Math.round(finite(width, 1)));
    const h = Math.max(1, Math.round(finite(height, 1)));
    const limit = Math.max(1, Math.round(finite(maxDimension, 16384)));
    const scale = Math.min(1, limit / w, limit / h);
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      scale,
    };
  }

  function isVideoReady(video) {
    return Boolean(
      video &&
      finite(video.videoWidth) > 0 &&
      finite(video.videoHeight) > 0 &&
      finite(video.readyState) >= 2
    );
  }

  function shiftLeftToAvoidRects(left, top, width, height, minimumLeft, occupiedRects, gap = 8) {
    let candidateLeft = finite(left);
    const minLeft = finite(minimumLeft);
    const controlWidth = Math.max(1, finite(width, 1));
    const controlHeight = Math.max(1, finite(height, 1));
    const step = controlWidth + Math.max(0, finite(gap));
    const occupied = Array.isArray(occupiedRects) ? occupiedRects : [];

    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const candidate = {
        left: candidateLeft,
        top,
        right: candidateLeft + controlWidth,
        bottom: top + controlHeight,
      };
      if (!occupied.some((rect) => rectsOverlap(candidate, rect))) return candidateLeft;
      const shifted = Math.max(minLeft, candidateLeft - step);
      if (shifted === candidateLeft) return candidateLeft;
      candidateLeft = shifted;
    }
    return candidateLeft;
  }

  // Sites pin headers and banners over the top of a full-bleed video, so a
  // control anchored to the video's top edge lands on the site chrome instead
  // of on the video. Pushing it below those rectangles keeps it on the frame.
  function shiftBelowRects(top, left, width, height, maximumTop, occupiedRects, gap = 8) {
    let candidateTop = finite(top);
    const maxTop = finite(maximumTop);
    const controlWidth = Math.max(1, finite(width, 1));
    const controlHeight = Math.max(1, finite(height, 1));
    const spacing = Math.max(0, finite(gap));
    const occupied = Array.isArray(occupiedRects) ? occupiedRects : [];

    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const candidate = {
        left: finite(left),
        top: candidateTop,
        right: finite(left) + controlWidth,
        bottom: candidateTop + controlHeight,
      };
      const blocking = occupied.find((rect) => rectsOverlap(candidate, rect));
      if (!blocking) return candidateTop;
      const shifted = Math.min(maxTop, finite(blocking.bottom) + spacing);
      if (shifted <= candidateTop) return candidateTop;
      candidateTop = shifted;
    }
    return candidateTop;
  }

  // A visible-tab capture can only see the viewport, so a player hanging off the
  // edge would be cropped. This is the scroll delta that brings it back in; an
  // element larger than the viewport is aligned to its top-left instead.
  function scrollOffsetToReveal(rect, viewportWidth, viewportHeight, margin = 8) {
    const vw = Math.max(0, finite(viewportWidth));
    const vh = Math.max(0, finite(viewportHeight));
    const gap = Math.max(0, finite(margin, 8));
    const left = finite(rect && rect.left);
    const top = finite(rect && rect.top);
    const right = finite(rect && rect.right, left);
    const bottom = finite(rect && rect.bottom, top);

    return {
      x: axisOffsetToReveal(left, right, vw, gap),
      y: axisOffsetToReveal(top, bottom, vh, gap),
    };
  }

  function axisOffsetToReveal(start, end, viewport, gap) {
    if (end - start > viewport) return start - gap;
    if (end > viewport) return Math.min(start - gap, end - viewport + gap);
    if (start < 0) return start - gap;
    return 0;
  }

  function intersectRects(a, b) {
    const left = Math.max(finite(a && a.left), finite(b && b.left));
    const top = Math.max(finite(a && a.top), finite(b && b.top));
    const right = Math.min(finite(a && a.right, left), finite(b && b.right, left));
    const bottom = Math.min(finite(a && a.bottom, top), finite(b && b.bottom, top));

    return {
      left,
      top,
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  // A single centre probe misses full-bleed overlays whose text sits off to one
  // side, so the visible video area is sampled on a grid that includes its
  // corners and edges.
  function sampleRectPoints(rect, columns = 5, rows = 5, inset = 2) {
    const left = finite(rect && rect.left);
    const top = finite(rect && rect.top);
    const right = finite(rect && rect.right, left);
    const bottom = finite(rect && rect.bottom, top);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width < 1 || height < 1) return [];

    const columnCount = Math.max(2, Math.round(finite(columns, 5)));
    const rowCount = Math.max(2, Math.round(finite(rows, 5)));
    const pad = Math.min(Math.max(0, finite(inset, 2)), Math.min(width, height) / 4);
    const points = [];

    for (let row = 0; row < rowCount; row++) {
      for (let column = 0; column < columnCount; column++) {
        points.push({
          x: left + pad + ((width - pad * 2) * column) / (columnCount - 1),
          y: top + pad + ((height - pad * 2) * row) / (rowCount - 1),
        });
      }
    }
    return points;
  }

  // elementsFromPoint() returns hits in paint order, topmost first. Everything
  // listed before the video is painted above it; everything after is behind it
  // and must be left alone even though the rectangles overlap.
  function stackAboveTarget(stack, target) {
    const hits = Array.isArray(stack) ? stack : [];
    const above = [];
    for (const element of hits) {
      if (element === target) return above;
      above.push(element);
    }
    return above;
  }

  // Hiding a container also hides its children, so when both an overlay and one
  // of its ancestors are candidates only the innermost element is kept.
  function reduceOverlayCandidates(candidates) {
    const unique = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (candidate && !unique.includes(candidate)) unique.push(candidate);
    }
    return unique.filter((candidate) => !unique.some((other) => (
      other !== candidate &&
      typeof candidate.contains === "function" &&
      candidate.contains(other)
    )));
  }

  // The exact inline declaration is recorded, including its priority, so the
  // page can be put back the way it was instead of "close enough".
  function rememberInlineStyle(element, property) {
    return {
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restoreInlineStyles(entries) {
    const list = Array.isArray(entries) ? entries : [];
    for (let index = list.length - 1; index >= 0; index--) {
      const entry = list[index];
      if (!entry || !entry.element || !entry.element.style) continue;
      if (entry.value) entry.element.style.setProperty(entry.property, entry.value, entry.priority || "");
      else entry.element.style.removeProperty(entry.property);
    }
  }

  function rectsOverlap(a, b) {
    return Boolean(
      a && b &&
      finite(a.right) > finite(b.left) &&
      finite(a.left) < finite(b.right) &&
      finite(a.bottom) > finite(b.top) &&
      finite(a.top) < finite(b.bottom)
    );
  }

  function advanceShortcutState(state, pressedKey, keys, now, timeoutMs) {
    const sequence = Array.isArray(keys) ? keys : [];
    if (!sequence.length) return { index: 0, lastAt: 0, triggered: false };

    const timestamp = finite(now);
    const timeout = Math.max(100, finite(timeoutMs, 700));
    let index = Math.max(0, Math.round(finite(state && state.index)));
    let lastAt = finite(state && state.lastAt);

    if (index > 0 && timestamp - lastAt > timeout) index = 0;

    if (pressedKey === sequence[index]) {
      index += 1;
      if (index === sequence.length) return { index: 0, lastAt: 0, triggered: true };
      return { index, lastAt: timestamp, triggered: false };
    }

    if (pressedKey === sequence[0]) {
      if (sequence.length === 1) return { index: 0, lastAt: 0, triggered: true };
      return { index: 1, lastAt: timestamp, triggered: false };
    }

    return { index: 0, lastAt: 0, triggered: false };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  return {
    advanceShortcutState,
    clamp,
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
  };
});

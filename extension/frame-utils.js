(function initVideoFrameUtils(root, factory) {
  const api = factory();
  root.VideoFrameUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createVideoFrameUtils() {
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
    isVideoReady,
    rectsOverlap,
    shiftLeftToAvoidRects,
  };
});

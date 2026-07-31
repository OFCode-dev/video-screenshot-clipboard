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

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  return {
    clamp,
    computeBitmapCrop,
    fitWithin,
    intersectRect,
    isVideoReady,
  };
});

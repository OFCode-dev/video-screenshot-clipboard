// Frame Screenshot → Clipboard — content script.
// Finds HTML5 videos (including videos added by SPA navigation), places a
// small copy button over each visible player, and copies the current frame as
// PNG. Direct canvas capture preserves native video resolution. A visible-tab
// crop is used when the browser marks the video canvas as cross-origin.

(() => {
  "use strict";

  if (globalThis.__videoScreenshotClipboardLoaded) return;
  globalThis.__videoScreenshotClipboardLoaded = true;

  const Utils = globalThis.VideoFrameUtils;
  const MIN_VIDEO_WIDTH = 160;
  const MIN_VIDEO_HEIGHT = 90;
  const BUTTON_SIZE = 38;
  const BUTTON_INSET = 12;
  const MAX_CANVAS_DIMENSION = 16384;
  const DEFAULT_SHORTCUT_KEYS = ["v", "s"];
  const DEFAULT_SHORTCUT_TIMEOUT_MS = 700;
  const records = new Map();
  const observedRoots = new WeakSet();
  let layoutFrame = 0;
  let toastTimer = 0;
  let shortcutKeys = DEFAULT_SHORTCUT_KEYS;
  let shortcutTimeoutMs = DEFAULT_SHORTCUT_TIMEOUT_MS;
  let shortcutState = { index: 0, lastAt: 0 };

  const resizeObserver = new ResizeObserver(() => scheduleLayout());

  observeRoot(document);
  scanRoot(document);
  loadShortcutSettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (changes.vscShortcutKeys) shortcutKeys = sanitizeShortcutKeys(changes.vscShortcutKeys.newValue);
    if (changes.vscShortcutTimeoutMs) {
      shortcutTimeoutMs = sanitizeShortcutTimeout(changes.vscShortcutTimeoutMs.newValue);
    }
    shortcutState = { index: 0, lastAt: 0 };
  });

  document.addEventListener("keydown", handleShortcutKey, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "VSC_CAPTURE_PRIMARY" || window.top !== window) return false;
    const record = findPrimaryVideo();
    if (!record) {
      sendResponse({ ok: false, error: "No visible video" });
      return false;
    }
    copyCurrentFrame(record);
    sendResponse({ ok: true });
    return false;
  });

  addEventListener("scroll", scheduleLayout, true);
  addEventListener("resize", scheduleLayout, { passive: true });
  document.addEventListener("fullscreenchange", () => {
    relocateOverlays();
    scheduleLayout();
  });

  function scanRoot(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    if (root instanceof HTMLVideoElement) registerVideo(root);
    for (const video of root.querySelectorAll("video")) registerVideo(video);

    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        scanRoot(element.shadowRoot);
      }
    }
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanRoot(node);
        }
      }
      removeDisconnectedVideos();
      scheduleLayout();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function registerVideo(video) {
    if (!(video instanceof HTMLVideoElement) || records.has(video)) return;

    const host = document.createElement("div");
    host.className = "vsc-overlay-host";
    host.setAttribute("data-vsc-owned", "");

    const button = document.createElement("button");
    button.className = "vsc-copy-button";
    button.type = "button";
    button.title = "Copy current video frame";
    button.setAttribute("aria-label", "Copy current video frame to clipboard");
    button.innerHTML = cameraIcon();
    host.appendChild(button);
    document.documentElement.appendChild(host);

    const record = {
      video,
      host,
      button,
      busy: false,
    };
    records.set(video, record);
    resizeObserver.observe(video);

    video.addEventListener("play", scheduleLayout);
    video.addEventListener("playing", scheduleLayout);
    video.addEventListener("pause", scheduleLayout);
    video.addEventListener("ended", scheduleLayout);
    video.addEventListener("loadedmetadata", scheduleLayout);
    video.addEventListener("emptied", scheduleLayout);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      copyCurrentFrame(record);
    }, true);

    scheduleLayout();
  }

  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      updateLayouts();
    });
  }

  function updateLayouts() {
    const occupiedControlRects = findForeignScreenshotControlRects();
    for (const record of records.values()) {
      const { video, host } = record;
      if (!video.isConnected) continue;
      const rect = video.getBoundingClientRect();
      const largeEnough = rect.width >= MIN_VIDEO_WIDTH && rect.height >= MIN_VIDEO_HEIGHT;
      const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      // Keep the control available for every visible, usable video. Some
      // sites place a pointer-events layer above decorative or lazy videos,
      // so neither hover nor the media's paused state is a reliable signal
      // that the user can see the video.
      const shouldShow = largeEnough && onScreen;

      const baseLeft = Utils.clamp(
        rect.right - BUTTON_SIZE - BUTTON_INSET,
        BUTTON_INSET,
        Math.max(BUTTON_INSET, innerWidth - BUTTON_SIZE - BUTTON_INSET)
      );
      const top = Utils.clamp(
        rect.top + BUTTON_INSET,
        BUTTON_INSET,
        Math.max(BUTTON_INSET, innerHeight - BUTTON_SIZE - BUTTON_INSET)
      );
      const minimumLeft = Math.max(BUTTON_INSET, rect.left + BUTTON_INSET);
      const left = Utils.shiftLeftToAvoidRects(
        baseLeft,
        top,
        BUTTON_SIZE,
        BUTTON_SIZE,
        minimumLeft,
        occupiedControlRects
      );
      host.style.setProperty("transform", `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`, "important");
      host.classList.toggle("vsc-visible", shouldShow);
    }
  }

  function findForeignScreenshotControlRects() {
    const controls = document.querySelectorAll(
      ".ssbtn-default, .ssbtn-youtube, .ssbtn-vimeo, [class*='ssbtn-']"
    );
    const rects = [];
    for (const control of controls) {
      if (control.closest("[data-vsc-owned]")) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        rects.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        });
      }
    }
    return rects;
  }

  function relocateOverlays() {
    const fullscreen = document.fullscreenElement;
    for (const record of records.values()) {
      const parent = fullscreen && fullscreen !== record.video && fullscreen.contains(record.video)
        ? fullscreen
        : document.documentElement;
      if (record.host.parentNode !== parent) parent.appendChild(record.host);
    }
  }

  function removeDisconnectedVideos() {
    for (const [video, record] of records) {
      if (video.isConnected) continue;
      resizeObserver.unobserve(video);
      record.host.remove();
      records.delete(video);
    }
  }

  function findPrimaryVideo() {
    let winner = null;
    let winnerArea = 0;
    for (const record of records.values()) {
      if (!record.video.isConnected) continue;
      const rect = record.video.getBoundingClientRect();
      const visible = Utils.intersectRect(rect, innerWidth, innerHeight);
      const area = visible.width * visible.height;
      if (visible.width >= MIN_VIDEO_WIDTH && visible.height >= MIN_VIDEO_HEIGHT && area > winnerArea) {
        winner = record;
        winnerArea = area;
      }
    }
    return winner;
  }

  async function loadShortcutSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        vscShortcutKeys: DEFAULT_SHORTCUT_KEYS,
        vscShortcutTimeoutMs: DEFAULT_SHORTCUT_TIMEOUT_MS,
      });
      shortcutKeys = sanitizeShortcutKeys(settings.vscShortcutKeys);
      shortcutTimeoutMs = sanitizeShortcutTimeout(settings.vscShortcutTimeoutMs);
    } catch (_) {
      shortcutKeys = DEFAULT_SHORTCUT_KEYS;
      shortcutTimeoutMs = DEFAULT_SHORTCUT_TIMEOUT_MS;
    }
  }

  function handleShortcutKey(event) {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      isEditableTarget(event.target)
    ) return;

    const key = String(event.key || "").toLowerCase();
    if (!/^[a-z0-9]$/.test(key)) {
      shortcutState = { index: 0, lastAt: 0 };
      return;
    }

    const next = Utils.advanceShortcutState(
      shortcutState,
      key,
      shortcutKeys,
      Date.now(),
      shortcutTimeoutMs
    );
    shortcutState = { index: next.index, lastAt: next.lastAt };
    if (!next.triggered) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const record = findPrimaryVideo();
    if (record) copyCurrentFrame(record);
    else showToast("No visible video found", true);
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
  }

  function sanitizeShortcutKeys(value) {
    const keys = Array.isArray(value) ? value : DEFAULT_SHORTCUT_KEYS;
    const valid = keys
      .map((key) => String(key || "").toLowerCase())
      .filter((key) => /^[a-z0-9]$/.test(key))
      .slice(0, 2);
    return valid.length ? valid : DEFAULT_SHORTCUT_KEYS;
  }

  function sanitizeShortcutTimeout(value) {
    const timeout = Number(value);
    return [500, 700, 1000, 1500].includes(timeout) ? timeout : DEFAULT_SHORTCUT_TIMEOUT_MS;
  }

  async function copyCurrentFrame(record) {
    if (record.busy) return;
    record.busy = true;
    record.button.disabled = true;
    record.button.innerHTML = busyIcon();
    sendBadge("busy");
    scheduleLayout();

    try {
      if (!Utils.isVideoReady(record.video)) {
        throw new Error("Wait until the video has loaded a frame");
      }

      let blob;
      let method = "native frame";
      try {
        blob = await drawVideoFrame(record.video);
      } catch (directError) {
        console.debug("[Video Screenshot] Direct frame capture unavailable; using visible crop", directError);
        blob = await captureVisibleVideo(record.video);
        method = "visible frame";
      }

      await writePngToClipboard(blob);
      record.button.innerHTML = checkIcon();
      showToast(`Copied ${method} — ${describeBlob(blob)}`);
      sendBadge("success");
    } catch (error) {
      console.warn("[Video Screenshot]", error);
      record.button.innerHTML = errorIcon();
      showToast(friendlyError(error), true);
      sendBadge("error");
    } finally {
      setTimeout(() => {
        record.busy = false;
        record.button.disabled = false;
        record.button.innerHTML = cameraIcon();
        scheduleLayout();
      }, 1100);
    }
  }

  async function drawVideoFrame(video) {
    const fitted = Utils.fitWithin(video.videoWidth, video.videoHeight, MAX_CANVAS_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is unavailable");

    context.drawImage(video, 0, 0, fitted.width, fitted.height);
    return canvasToPng(canvas);
  }

  async function captureVisibleVideo(video) {
    // A child frame's rectangle is relative to that frame, while
    // captureVisibleTab returns the top-level viewport. Direct capture still
    // works in frames; only the cross-origin fallback is top-frame-only.
    if (window.top !== window) {
      throw new Error("Cross-origin video frames inside embedded players are not supported yet");
    }

    const rect = video.getBoundingClientRect();
    const viewportWidth = innerWidth;
    const viewportHeight = innerHeight;
    const visible = Utils.intersectRect(rect, viewportWidth, viewportHeight);
    if (visible.width < 2 || visible.height < 2) {
      throw new Error("The video is outside the visible viewport");
    }

    setOverlaysCaptureHidden(true);
    try {
      await nextFrames(2);
      const response = await chrome.runtime.sendMessage({ type: "VSC_CAPTURE_VISIBLE" });
      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || "Visible-tab capture failed");
      }

      const bitmap = await createImageBitmap(dataUrlToBlob(response.dataUrl));
      try {
        const crop = Utils.computeBitmapCrop(
          bitmap.width,
          bitmap.height,
          viewportWidth,
          viewportHeight,
          rect
        );
        const canvas = document.createElement("canvas");
        canvas.width = crop.sourceWidth;
        canvas.height = crop.sourceHeight;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(
          bitmap,
          crop.sourceX,
          crop.sourceY,
          crop.sourceWidth,
          crop.sourceHeight,
          0,
          0,
          crop.sourceWidth,
          crop.sourceHeight
        );
        return canvasToPng(canvas);
      } finally {
        bitmap.close();
      }
    } finally {
      setOverlaysCaptureHidden(false);
    }
  }

  function setOverlaysCaptureHidden(hidden) {
    for (const record of records.values()) {
      record.host.classList.toggle("vsc-capture-hidden", hidden);
    }
  }

  async function writePngToClipboard(blob) {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard access is unavailable");
    }
    const item = new ClipboardItem({ "image/png": blob });
    try {
      await navigator.clipboard.write([item]);
    } catch (firstError) {
      try {
        window.focus();
        await navigator.clipboard.write([item]);
      } catch (_) {
        throw firstError;
      }
    }
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The video frame could not be encoded"));
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, comma);
    const mimeMatch = /^data:([^;,]+)/.exec(header);
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeMatch?.[1] || "image/png" });
  }

  function showToast(text, isError = false) {
    let toast = document.querySelector(".vsc-toast-host[data-vsc-owned]");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "vsc-toast-host";
      toast.setAttribute("data-vsc-owned", "");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.documentElement.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.toggle("vsc-error", isError);
    requestAnimationFrame(() => toast.classList.add("vsc-show"));
    toastTimer = setTimeout(() => toast.classList.remove("vsc-show"), 2600);
  }

  function friendlyError(error) {
    const message = String((error && error.message) || error || "Copy failed");
    if (/clipboard|permission|notallowed/i.test(message)) {
      return "Could not write the video frame to the clipboard";
    }
    if (/loaded a frame|video.*load/i.test(message)) return "Wait until the video has loaded, then try again";
    if (/cross-origin|protected|security|tainted/i.test(message)) {
      return "This embedded or protected video cannot be captured";
    }
    if (/outside the visible/i.test(message)) return "Bring the video into view, then try again";
    return "Could not copy this video frame";
  }

  function describeBlob(blob) {
    const kilobytes = Math.max(1, Math.round(blob.size / 1024));
    return `${kilobytes} KB PNG`;
  }

  function sendBadge(status) {
    chrome.runtime.sendMessage({ type: "VSC_BADGE", status }).catch(() => undefined);
  }

  function nextFrames(count) {
    return new Promise((resolve) => {
      const step = (remaining) => {
        if (remaining <= 0) resolve();
        else requestAnimationFrame(() => step(remaining - 1));
      };
      step(count);
    });
  }

  function cameraIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  }

  function busyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 3a9 9 0 1 1-8.2 5.3"/></svg>';
  }

  function checkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.2 4.2L19 7"/></svg>';
  }

  function errorIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 7v6m0 4h.01"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
})();

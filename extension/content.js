// Frame Screenshot → Clipboard — content script.
// Finds HTML5 videos (including videos added by SPA navigation), places a
// small copy button over each visible player, and copies the current frame as
// PNG. Direct canvas capture preserves native video resolution. A visible-tab
// crop is used when the browser marks the video canvas as cross-origin.

(() => {
  "use strict";

  if (globalThis.__frameScreenshotClipboardLoaded) return;
  globalThis.__frameScreenshotClipboardLoaded = true;

  const Utils = globalThis.FrameUtils;
  const MIN_VIDEO_WIDTH = 160;
  const MIN_VIDEO_HEIGHT = 90;
  const BUTTON_SIZE = 38;
  const BUTTON_INSET = 12;
  const MAX_CANVAS_DIMENSION = 16384;
  const DEFAULT_SHORTCUT_KEYS = ["v", "s"];
  const DEFAULT_SHORTCUT_TIMEOUT_MS = 700;
  const FRAME_STATUS_HEARTBEAT_MS = 2000;
  const AMBIENT_RECHECK_MS = 1000;
  const MAX_OVERLAY_CANDIDATES = 300;
  const FRAME_BRIDGE_ID = `frame-screenshot:${chrome.runtime.id}`;
  const records = new Map();
  const observedRoots = new WeakSet();
  const searchableRoots = new Set();
  const geometryResolvers = new Map();
  const geometryForwarders = new Map();
  let layoutFrame = 0;
  let toastTimer = 0;
  let lastFrameStatus = "";
  let lastFrameStatusAt = 0;
  let shortcutKeys = DEFAULT_SHORTCUT_KEYS;
  let shortcutTimeoutMs = DEFAULT_SHORTCUT_TIMEOUT_MS;
  let shortcutState = { index: 0, lastAt: 0 };
  let pointerX = -1;
  let pointerY = -1;
  let ambientRecords = 0;
  let overlayCaptureStyles = [];

  const resizeObserver = new ResizeObserver(() => scheduleLayout());

  observeRoot(document);
  scanRoot(document);
  loadShortcutSettings();
  setInterval(scheduleLayout, FRAME_STATUS_HEARTBEAT_MS);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (changes.vscShortcutKeys) shortcutKeys = sanitizeShortcutKeys(changes.vscShortcutKeys.newValue);
    if (changes.vscShortcutTimeoutMs) {
      shortcutTimeoutMs = sanitizeShortcutTimeout(changes.vscShortcutTimeoutMs.newValue);
    }
    shortcutState = { index: 0, lastAt: 0 };
  });

  document.addEventListener("keydown", handleShortcutKey, true);
  addEventListener("message", handleFrameBridgeMessage);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "VSC_CLIPBOARD_WRITE") {
      // Relayed by the service worker for a frame that may not reach the
      // clipboard itself. Only the top frame is ever the focused document.
      if (window.top !== window) return false;
      writePngHere(dataUrlToBlob(message.dataUrl))
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    if (message?.type !== "VSC_CAPTURE_PRIMARY") return false;
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
  addEventListener("pointermove", handlePointerMove, { passive: true, capture: true });
  document.addEventListener("pointerleave", forgetPointer, true);
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
    searchableRoots.add(root);
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
    // A fixed element with auto offsets falls back to its static position, which
    // for the last child of <html> is the bottom of the document. Pin it to the
    // viewport origin so the transform alone decides where the control sits.
    host.style.setProperty("top", "0", "important");
    host.style.setProperty("left", "0", "important");

    const button = document.createElement("button");
    button.className = "vsc-copy-button";
    button.type = "button";
    button.setAttribute("data-vsc-owned", "");
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
    const now = Date.now();
    let largestVisibleArea = 0;
    let ambientCount = 0;
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
      const visible = Utils.intersectRect(rect, innerWidth, innerHeight);
      if (shouldShow) {
        largestVisibleArea = Math.max(largestVisibleArea, visible.width * visible.height);
      }

      if (shouldShow && attachYouTubeControl(record)) {
        host.classList.remove("vsc-visible");
        continue;
      }
      restoreOverlayControl(record);

      // Anchor to the part of the video the viewer can actually see, so a
      // player scrolled half out of view keeps its control on the frame.
      const baseLeft = Utils.clamp(
        visible.right - BUTTON_SIZE - BUTTON_INSET,
        BUTTON_INSET,
        Math.max(BUTTON_INSET, innerWidth - BUTTON_SIZE - BUTTON_INSET)
      );
      const lowestTop = Math.max(
        BUTTON_INSET,
        Math.min(innerHeight - BUTTON_SIZE - BUTTON_INSET, visible.bottom - BUTTON_SIZE - BUTTON_INSET)
      );
      const baseTop = Utils.clamp(visible.top + BUTTON_INSET, BUTTON_INSET, Math.max(BUTTON_INSET, lowestTop));
      const top = shouldShow
        ? Utils.shiftBelowRects(
            baseTop,
            baseLeft,
            BUTTON_SIZE,
            BUTTON_SIZE,
            lowestTop,
            findPinnedOverlayRectsAt(baseLeft, baseTop)
          )
        : baseTop;
      const minimumLeft = Math.max(BUTTON_INSET, visible.left + BUTTON_INSET);
      const left = Utils.shiftLeftToAvoidRects(
        baseLeft,
        top,
        BUTTON_SIZE,
        BUTTON_SIZE,
        minimumLeft,
        occupiedControlRects
      );

      const ambient = shouldShow && isAmbientVideo(record, rect, now);
      if (ambient) ambientCount++;
      const pointerNearby = ambient &&
        pointerX >= rect.left && pointerX <= rect.right &&
        pointerY >= rect.top && pointerY <= rect.bottom;

      host.style.setProperty("transform", `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`, "important");
      host.classList.toggle("vsc-visible", shouldShow);
      host.classList.toggle("vsc-ambient", ambient);
      host.classList.toggle("vsc-awake", pointerNearby);
    }
    ambientRecords = ambientCount;
    publishFrameStatus(largestVisibleArea);
  }

  // A decorative background video sits under the page content, so the control
  // would otherwise float over unrelated copy. Those controls stay dimmed until
  // the pointer reaches the video.
  function isAmbientVideo(record, rect, now) {
    if (record.ambientCheckedAt && now - record.ambientCheckedAt < AMBIENT_RECHECK_MS) {
      return Boolean(record.ambient);
    }
    record.ambientCheckedAt = now;
    record.ambient = detectAmbientVideo(record.video, rect);
    return record.ambient;
  }

  function detectAmbientVideo(video, rect) {
    const style = getComputedStyle(video);
    if (style.pointerEvents === "none") return true;
    const zIndex = Number.parseInt(style.zIndex, 10);
    if (Number.isFinite(zIndex) && zIndex < 0) return true;

    const x = Utils.clamp(rect.left + rect.width / 2, 1, Math.max(1, innerWidth - 1));
    const y = Utils.clamp(rect.top + rect.height / 2, 1, Math.max(1, innerHeight - 1));
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === video || video.contains(hit) || hit.contains(video)) return false;
    return !hit.closest("[data-vsc-owned]");
  }

  function findPinnedOverlayRectsAt(left, top) {
    const rects = [];
    const probes = [
      [left + BUTTON_SIZE / 2, top + BUTTON_SIZE / 2],
      [left + BUTTON_SIZE / 2, top + 1],
    ];
    for (const [x, y] of probes) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      for (const element of document.elementsFromPoint(x, y)) {
        if (element.closest("[data-vsc-owned]")) continue;
        const position = getComputedStyle(element).position;
        if (position !== "fixed" && position !== "sticky") continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        }
        break;
      }
    }
    return rects;
  }

  function handlePointerMove(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (ambientRecords > 0) scheduleLayout();
  }

  function forgetPointer() {
    pointerX = -1;
    pointerY = -1;
    if (ambientRecords > 0) scheduleLayout();
  }

  function attachYouTubeControl(record) {
    if (!/^(www\.)?youtube\.com$/i.test(location.hostname)) return false;
    const player = record.video.closest(".html5-video-player");
    const controls = player?.querySelector(".ytp-right-controls");
    if (!controls) return false;

    const otherOwnedControl = controls.querySelector("[data-vsc-youtube-control]");
    if (otherOwnedControl && otherOwnedControl !== record.button) return false;

    const rivalButton = controls.querySelector("button.screenshot-button.ytp-button:not([data-vsc-owned])");
    if (record.button.parentNode !== controls) {
      controls.insertBefore(record.button, rivalButton || controls.firstChild);
    }
    record.button.classList.remove("vsc-copy-button");
    record.button.classList.add("vsc-ytp-control", "ytp-button");
    record.button.setAttribute("data-vsc-youtube-control", "");
    record.inYouTubeControls = true;
    return true;
  }

  function restoreOverlayControl(record) {
    if (record.button.parentNode !== record.host) record.host.appendChild(record.button);
    record.button.classList.add("vsc-copy-button");
    record.button.classList.remove("vsc-ytp-control", "ytp-button", "vsc-capture-hidden");
    record.button.removeAttribute("data-vsc-youtube-control");
    record.inYouTubeControls = false;
  }

  function publishFrameStatus(area) {
    const roundedArea = Math.max(0, Math.round(area / 1000) * 1000);
    const status = String(roundedArea);
    const now = Date.now();
    if (status === lastFrameStatus && now - lastFrameStatusAt < 2000) return;
    lastFrameStatus = status;
    lastFrameStatusAt = now;
    chrome.runtime.sendMessage({
      type: "VSC_FRAME_STATUS",
      area: roundedArea,
      hasVideo: roundedArea > 0,
    }).catch(() => undefined);
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
      record.button.remove();
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
        console.debug("[Frame Screenshot] Direct frame capture unavailable", directError);
        try {
          // Still the whole frame at its own resolution — only the route differs.
          blob = await captureFromSource(record.video);
        } catch (sourceError) {
          console.debug("[Frame Screenshot] Source reload unavailable; using visible crop", sourceError);
          const capture = await captureVisibleVideo(record.video);
          blob = capture.blob;
          method = capture.partial ? "visible part only" : "visible frame";
        }
      }

      await writePngToClipboard(blob);
      record.button.innerHTML = checkIcon();
      showToast(`Copied ${method} — ${describeBlob(blob)}`);
      sendBadge("success");
    } catch (error) {
      console.warn("[Frame Screenshot]", error);
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

  // The page's canvas is tainted, but the media itself is usually served with
  // permissive CORS headers. Loading the same source into a private element
  // that asks for CORS gives a clean canvas — the whole frame at its own
  // resolution, no matter how much of the player the viewport shows.
  async function captureFromSource(video) {
    const source = video.currentSrc || video.src;
    if (!source || source.startsWith("blob:") || source.startsWith("data:")) {
      throw new Error("source/unavailable: this player streams its media, so it cannot be reloaded");
    }

    const clone = document.createElement("video");
    clone.crossOrigin = "anonymous";
    clone.preload = "auto";
    clone.muted = true;
    clone.playsInline = true;
    clone.setAttribute("data-vsc-owned", "");
    clone.style.cssText = "position:fixed!important;left:-99999px!important;top:0!important;" +
      "width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important";
    document.documentElement.appendChild(clone);

    try {
      await loadCloneFrame(clone, source, video.currentTime);
      return await drawVideoFrame(clone);
    } finally {
      clone.removeAttribute("src");
      clone.load();
      clone.remove();
    }
  }

  function loadCloneFrame(clone, source, currentTime, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => settle(new Error("source/timeout: the media did not decode in time")),
        timeoutMs
      );

      function settle(error) {
        clearTimeout(timer);
        clone.removeEventListener("loadeddata", onLoaded);
        clone.removeEventListener("seeked", onSeeked);
        clone.removeEventListener("error", onError);
        if (error) reject(error);
        else resolve();
      }
      function onLoaded() {
        const wanted = Number(currentTime);
        if (Number.isFinite(wanted) && wanted > 0 && Number.isFinite(clone.duration) && wanted < clone.duration) {
          clone.currentTime = wanted;
          return;
        }
        if (Utils.isVideoReady(clone)) settle();
      }
      function onSeeked() {
        if (Utils.isVideoReady(clone)) settle();
      }
      function onError() {
        settle(new Error("source/blocked: the media refused a cross-origin read"));
      }

      clone.addEventListener("loadeddata", onLoaded);
      clone.addEventListener("seeked", onSeeked);
      clone.addEventListener("error", onError);
      clone.src = source;
      clone.load();
    });
  }

  async function captureVisibleVideo(video) {
    const restoreScroll = revealVideo(video);
    try {
      await nextFrames(2);
      return await cropVisibleVideo(video);
    } finally {
      restoreScroll();
    }
  }

  // captureVisibleTab() only photographs the viewport, so a player hanging off
  // the edge would be cropped to whatever happens to be on screen. Scroll it in
  // when it fits and put the scroll position back afterwards.
  function revealVideo(video) {
    const rect = video.getBoundingClientRect();
    const offset = Utils.scrollOffsetToReveal(rect, innerWidth, innerHeight);
    if (!offset.x && !offset.y) return () => undefined;

    const previousX = scrollX;
    const previousY = scrollY;
    scrollBy({ left: offset.x, top: offset.y, behavior: "instant" });
    return () => scrollTo({ left: previousX, top: previousY, behavior: "instant" });
  }

  async function cropVisibleVideo(video) {
    const geometry = await getTopLevelGeometry(video.getBoundingClientRect());
    const rect = geometry.rect;
    const viewportWidth = geometry.viewportWidth;
    const viewportHeight = geometry.viewportHeight;
    const visible = Utils.intersectRect(rect, viewportWidth, viewportHeight);
    if (visible.width < 2 || visible.height < 2) {
      throw new Error("The video is outside the visible viewport");
    }

    return withIsolatedVideo(video, async () => {
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
        // Say so when only part of the player made it into the shot, instead of
        // letting a half frame look like the whole thing.
        const partial = crop.visible.width < rect.width - 1 || crop.visible.height < rect.height - 1;
        return { blob: await canvasToPng(canvas), partial };
      } finally {
        bitmap.close();
      }
    });
  }

  // captureVisibleTab() photographs the composited tab, so every pixel painted
  // over the video — hero copy, navigation, cookie banners — ends up inside the
  // crop. Cropping cannot pick a layer, so the elements painted above the video
  // are hidden for the length of the capture and then put back.
  async function withIsolatedVideo(video, capture) {
    const changes = [];
    setOverlaysCaptureHidden(true);
    try {
      for (const element of collectOverlayElements(video)) {
        // visibility keeps the element in the layout, so nothing reflows and the
        // video keeps the exact rectangle the crop was calculated from.
        changes.push(Utils.rememberInlineStyle(element, "visibility"));
        element.style.setProperty("visibility", "hidden", "important");
      }
      await nextFrames(3);
      return await capture();
    } finally {
      // Restoration is unconditional: a failed capture, a decode error or a
      // rejected clipboard write must never leave the page with hidden content.
      Utils.restoreInlineStyles(changes);
      setOverlaysCaptureHidden(false);
    }
  }

  function collectOverlayElements(video) {
    const visible = Utils.intersectRect(video.getBoundingClientRect(), innerWidth, innerHeight);
    const ancestors = composedAncestors(video);
    const candidates = [];

    // Two passes complement each other: probing points catches anything the
    // compositor puts on top, including shadow-DOM hosts, while walking the
    // tree catches boxes that sit between probes, such as a row of buttons.
    for (const point of Utils.sampleRectPoints(visible)) {
      for (const element of elementsAboveVideo(video, point)) {
        if (isHideableOverlay(element, video, ancestors)) candidates.push(element);
      }
    }
    for (const element of collectStructuralOverlays(video, visible, ancestors)) {
      if (isHideableOverlay(element, video, ancestors) && paintsAboveVideo(element, video, visible)) {
        candidates.push(element);
      }
    }
    return Utils.reduceOverlayCandidates(candidates);
  }

  // Descend from the document root, following only the branch that renders the
  // video. Every other box that overlaps the visible frame is an overlay, and
  // oversized wrappers are opened up so a whole page section is never hidden
  // when a single headline is the thing in the way.
  function collectStructuralOverlays(video, visible, ancestors) {
    const found = [];
    const queue = [document.documentElement];
    const frameArea = Math.max(1, visible.width * visible.height);

    for (let guard = 0; queue.length && guard < 4000 && found.length < MAX_OVERLAY_CANDIDATES; guard++) {
      const parent = queue.shift();
      for (const child of parent.children) {
        if (!(child instanceof Element) || child.hasAttribute("data-vsc-owned")) continue;
        const rect = child.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (!Utils.rectsOverlap(rect, visible)) continue;

        if (ancestors.has(child) || child.contains(video) || isFrameHostingVideo(child, video)) {
          queue.push(child);
          continue;
        }
        if (child.children.length && rect.width * rect.height > frameArea * 1.5) {
          queue.push(child);
          continue;
        }
        found.push(child);
      }
    }
    return found;
  }

  // Overlapping rectangles prove nothing about paint order — a decorative layer
  // can sit behind the video. The hit test at the overlapping area decides.
  function paintsAboveVideo(element, video, visible) {
    const overlap = Utils.intersectRects(element.getBoundingClientRect(), visible);
    if (overlap.width < 1 || overlap.height < 1) return false;

    const stack = document.elementsFromPoint(
      overlap.left + overlap.width / 2,
      overlap.top + overlap.height / 2
    );
    const target = stack.find((node) => node === video || video.contains(node));
    return Utils.stackAboveTarget(stack, target || video)
      .some((node) => node === element || element.contains(node));
  }

  function elementsAboveVideo(video, point) {
    const stack = document.elementsFromPoint(point.x, point.y);
    // A descendant of the video (its own controls, a poster wrapper) paints at
    // the same depth as the video, so the first one ends the "above" section.
    const target = stack.find((element) => element === video || video.contains(element));
    return Utils.stackAboveTarget(stack, target || video);
  }

  function isHideableOverlay(element, video, ancestors) {
    if (!(element instanceof Element)) return false;
    if (element === video || video.contains(element) || ancestors.has(element)) return false;
    if (element === document.documentElement || element === document.body) return false;
    if (element.closest("[data-vsc-owned]")) return false;
    if (isFrameHostingVideo(element, video)) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;

    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
    return true;
  }

  // Shadow roots break Node.contains(), so the chain that renders the video is
  // walked through host boundaries. Nothing on that chain may be hidden.
  function composedAncestors(node) {
    const chain = new Set();
    let current = node;
    for (let depth = 0; current && depth < 500; depth++) {
      chain.add(current);
      current = current.parentNode || current.host || null;
    }
    return chain;
  }

  function isFrameHostingVideo(element, video) {
    const tag = element.tagName;
    if (tag !== "IFRAME" && tag !== "FRAME") return false;
    let frameWindow = video.ownerDocument?.defaultView || null;
    for (let depth = 0; frameWindow && depth < 20; depth++) {
      if (element.contentWindow === frameWindow) return true;
      frameWindow = frameWindow.parent === frameWindow ? null : frameWindow.parent;
    }
    return false;
  }

  function getTopLevelGeometry(rect) {
    const serialized = serializeRect(rect);
    if (window.top === window) {
      return Promise.resolve({
        rect: serialized,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      });
    }

    const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        geometryResolvers.delete(requestId);
        reject(new Error("Could not locate the embedded video in the top-level page"));
      }, 1800);
      geometryResolvers.set(requestId, { resolve, timer });
      window.parent.postMessage({
        bridge: FRAME_BRIDGE_ID,
        type: "VSC_GEOMETRY_REQUEST",
        requestId,
        rect: serialized,
      }, "*");
    });
  }

  function handleFrameBridgeMessage(event) {
    const message = event.data;
    if (!message || message.bridge !== FRAME_BRIDGE_ID || !message.requestId) return;

    if (message.type === "VSC_GEOMETRY_REQUEST") {
      const frame = findFrameForWindow(event.source);
      if (!frame) return;
      const frameRect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const borderLeft = parseFloat(style.borderLeftWidth) || 0;
      const borderTop = parseFloat(style.borderTopWidth) || 0;
      const translated = Utils.translateRectThroughFrame(
        message.rect,
        frameRect,
        frame.clientWidth,
        frame.clientHeight,
        borderLeft,
        borderTop
      );

      if (window.top === window) {
        event.source.postMessage({
          bridge: FRAME_BRIDGE_ID,
          type: "VSC_GEOMETRY_RESULT",
          requestId: message.requestId,
          rect: translated,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        }, "*");
      } else {
        geometryForwarders.set(message.requestId, event.source);
        window.parent.postMessage({
          bridge: FRAME_BRIDGE_ID,
          type: "VSC_GEOMETRY_REQUEST",
          requestId: message.requestId,
          rect: translated,
        }, "*");
      }
      return;
    }

    if (message.type !== "VSC_GEOMETRY_RESULT" || event.source !== window.parent) return;
    const child = geometryForwarders.get(message.requestId);
    if (child) {
      geometryForwarders.delete(message.requestId);
      child.postMessage(message, "*");
      return;
    }

    const resolver = geometryResolvers.get(message.requestId);
    if (!resolver) return;
    geometryResolvers.delete(message.requestId);
    clearTimeout(resolver.timer);
    resolver.resolve({
      rect: serializeRect(message.rect),
      viewportWidth: Number(message.viewportWidth) || innerWidth,
      viewportHeight: Number(message.viewportHeight) || innerHeight,
    });
  }

  function findFrameForWindow(sourceWindow) {
    for (const root of searchableRoots) {
      for (const frame of root.querySelectorAll("iframe, frame")) {
        try {
          if (frame.contentWindow === sourceWindow) return frame;
        } catch (_) {
          // A cross-origin WindowProxy can still be compared by identity; if
          // a browser rejects access entirely, continue with the next frame.
        }
      }
    }
    return null;
  }

  function serializeRect(rect) {
    const left = Number(rect?.left) || 0;
    const top = Number(rect?.top) || 0;
    const right = Number(rect?.right) || left;
    const bottom = Number(rect?.bottom) || top;
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  // Inline declarations, not a class: the button resets itself with
  // `all: initial`, which restores visibility to visible and ignores the hidden
  // host, and a relayout can strip a class mid-capture. An inline !important
  // rule survives both, and the previous declarations are restored afterwards.
  function setOverlaysCaptureHidden(hidden) {
    Utils.restoreInlineStyles(overlayCaptureStyles);
    overlayCaptureStyles = [];
    if (!hidden) return;

    for (const record of records.values()) {
      for (const node of [record.host, record.button]) {
        overlayCaptureStyles.push(Utils.rememberInlineStyle(node, "visibility"));
        node.style.setProperty("visibility", "hidden", "important");
      }
    }
  }

  // navigator.clipboard.write() only succeeds in a focused document, which rules
  // out the service worker and offscreen documents entirely. The page itself is
  // focused while its own button is clicked, so it writes the frame directly. A
  // cross-origin iframe is blocked by Permissions Policy instead of by focus, so
  // it hands the PNG to the top frame through the service worker.
  async function writePngToClipboard(blob) {
    try {
      await writePngHere(blob);
      return;
    } catch (localError) {
      if (window.top === window) throw localError;

      const dataUrl = await blobToDataUrl(blob);
      const response = await chrome.runtime.sendMessage({ type: "VSC_COPY_PNG", dataUrl });
      if (!response?.ok) {
        throw new Error(
          `clipboard/top-frame: ${response?.error || "no response"} — ${localError.message}`
        );
      }
    }
  }

  async function writePngHere(blob) {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("clipboard/local: the Clipboard API is unavailable in this document");
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch (error) {
      throw new Error(`clipboard/local: ${error?.name || "Error"}: ${error?.message || error}`);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read the captured PNG"));
      reader.readAsDataURL(blob);
    });
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
    if (/protected|security|tainted/i.test(message)) {
      return "This protected video cannot be captured";
    }
    if (/embedded video|top-level page/i.test(message)) return "Could not locate this embedded video";
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

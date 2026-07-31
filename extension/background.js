// Frame Screenshot → Clipboard — Manifest V3 service worker.
// The content script captures origin-clean video frames itself. This worker
// only supplies the visible-tab fallback used when a cross-origin canvas is
// blocked by the page.

const CAPTURE_INTERVAL_MS = 550;
const FRAME_STATUS_TTL_MS = 5000;
let lastCaptureAt = 0;
let captureQueue = Promise.resolve();
const frameCandidates = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id) || !/^https?:/.test(tab.url || "")) {
    await flashBadge("error");
    return;
  }

  try {
    const frameId = selectCaptureFrame(tab.id);
    const options = Number.isInteger(frameId) ? { frameId } : undefined;
    const response = await chrome.tabs.sendMessage(tab.id, { type: "VSC_CAPTURE_PRIMARY" }, options);
    if (!response?.ok) await flashBadge("error");
  } catch (_) {
    await flashBadge("error");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "VSC_FRAME_STATUS") {
    rememberFrameStatus(message, sender);
    return false;
  }

  if (message?.type === "VSC_CAPTURE_VISIBLE") {
    captureQueue = captureQueue
      .catch(() => undefined)
      .then(() => captureVisibleForSender(sender));

    captureQueue
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
    return true;
  }

  if (message?.type === "VSC_BADGE") {
    flashBadge(message.status).catch(() => undefined);
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => frameCandidates.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") frameCandidates.delete(tabId);
});

function rememberFrameStatus(message, sender) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) return;

  let candidates = frameCandidates.get(tabId);
  if (!candidates) {
    candidates = new Map();
    frameCandidates.set(tabId, candidates);
  }
  if (!message.hasVideo || !(Number(message.area) > 0)) {
    candidates.delete(frameId);
    return;
  }
  candidates.set(frameId, {
    area: Number(message.area),
    seenAt: Date.now(),
  });
}

function selectCaptureFrame(tabId) {
  const candidates = frameCandidates.get(tabId);
  if (!candidates) return 0;

  const now = Date.now();
  let winnerFrameId = 0;
  let winnerArea = 0;
  for (const [frameId, candidate] of candidates) {
    if (now - candidate.seenAt > FRAME_STATUS_TTL_MS) {
      candidates.delete(frameId);
      continue;
    }
    if (candidate.area > winnerArea) {
      winnerArea = candidate.area;
      winnerFrameId = frameId;
    }
  }
  return winnerFrameId;
}

async function captureVisibleForSender(sender) {
  const sourceTab = sender.tab;
  if (!sourceTab || !Number.isInteger(sourceTab.id) || !Number.isInteger(sourceTab.windowId)) {
    throw new Error("No source tab is available");
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId: sourceTab.windowId });
  if (!activeTab || activeTab.id !== sourceTab.id) {
    throw new Error("The video tab is no longer active");
  }

  const waitMs = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastCaptureAt = Date.now();

  return chrome.tabs.captureVisibleTab(sourceTab.windowId, { format: "png" });
}

async function flashBadge(status) {
  const config = {
    success: { text: "✓", color: "#188038" },
    error: { text: "!", color: "#d93025" },
    busy: { text: "…", color: "#5f6368" },
  }[status];
  if (!config) return;

  await chrome.action.setBadgeBackgroundColor({ color: config.color });
  await chrome.action.setBadgeText({ text: config.text });
  if (status !== "busy") {
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2200);
  }
}

function safeError(error) {
  return String((error && error.message) || error || "Capture failed");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

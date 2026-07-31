// Video Screenshot → Clipboard — Manifest V3 service worker.
// The content script captures origin-clean video frames itself. This worker
// only supplies the visible-tab fallback used when a cross-origin canvas is
// blocked by the page.

const CAPTURE_INTERVAL_MS = 550;
let lastCaptureAt = 0;
let captureQueue = Promise.resolve();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id) || !/^https?:/.test(tab.url || "")) {
    await flashBadge("error");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "VSC_CAPTURE_PRIMARY" });
    if (!response?.ok) await flashBadge("error");
  } catch (_) {
    await flashBadge("error");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

// Writes PNG data from the extension service worker to the system clipboard.
// Keeping this operation in an extension document prevents website and iframe
// Permissions Policy rules from blocking the Clipboard API.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "VSC_OFFSCREEN_COPY_PNG") return false;

  copyPngDataUrl(message.dataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

async function copyPngDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Invalid PNG data");
  }
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard access is unavailable");
  }

  const blob = await fetch(dataUrl).then((response) => response.blob());
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function safeError(error) {
  return String((error && error.message) || error || "Clipboard write failed");
}

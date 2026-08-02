# Frame Screenshot → Clipboard

Copy the current frame of an HTML5 video straight to your clipboard. Hover a video, click the camera button, then paste the PNG anywhere—no editor, download, account, analytics, or server.

This is the third extension in the OFCode screenshot-to-clipboard family:

- [Quick Screenshot → Clipboard](https://github.com/OFCode-dev/quick-screenshot-clipboard) — visible tab
- [Stitch Screenshot → Clipboard](https://github.com/OFCode-dev/stitch-screenshot-clipboard) — scrolling page
- **Frame Screenshot → Clipboard** — current video frame

## How it works

1. The extension detects visible HTML5 `<video>` elements, including looped “moving photos,” videos added later by single-page apps, and players nested in open shadow roots or embedded frames.
2. A small camera button remains visible on every sufficiently large video currently in view.
3. Clicking the button first draws the decoded frame to a canvas at the video's native resolution.
4. If the page blocks that canvas as cross-origin, the extension captures the visible tab, translates nested-frame coordinates to the top-level viewport, and crops the exact video rectangle.
5. The PNG is written to the clipboard from the focused page itself, because `navigator.clipboard.write()` only succeeds in a focused document. A frame that cannot reach the clipboard — a cross-origin iframe, for instance — hands the PNG to the top frame of its own tab through the service worker. The image is never downloaded or uploaded.

The toolbar icon provides a second route: clicking it captures the largest visible video across the top-level page and its embedded players.

The default page shortcut is **V then S** within 0.7 seconds. Open the extension's Options page to choose a two-key sequence such as **S then S**, a single key such as **P**, or a different timing window. Shortcuts are ignored while typing in editable fields.

## Install for development

1. Run `npm run icons` and `npm run check`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `extension/` directory.
5. Open a normal HTTP(S) page containing a video and hover the player.

For a deterministic local video, run `npm run serve:fixture` and open `http://127.0.0.1:4173`.

## Permissions

| Permission | Why it is required |
|---|---|
| `clipboardWrite` | Writes the captured PNG to the clipboard. |
| `storage` | Syncs the user's shortcut keys and timing preference. |
| Access to all page URLs | Detects videos automatically and enables Chrome's visible-tab fallback when direct canvas capture is blocked. Chrome requires the literal `<all_urls>` host permission for page-button captures; file URLs still require the user's separate opt-in. |

The extension does not request `downloads` or analytics-related permissions.

## The screenshot family

**Frame** is the turquoise third sibling: Quick captures the visible tab, Stitch (fuchsia) captures the full page, and Frame captures the exact moment in a video. Its video-player, blue lens, and clipboard badge share the same soft 3D visual language without reusing either sibling's composition.

## Development

```sh
npm run icons
npm run check
npm run package
```

The store-ready ZIP is written to `dist/`.

## Known limitations

- DRM/EME-protected video may produce a black or unavailable frame by browser design.
- Browser-internal pages and the Chrome Web Store do not allow content scripts.
- A native video element used directly as the fullscreen element cannot host the overlay; fullscreen player containers such as YouTube's are supported.

## Privacy

All image processing happens locally in the current tab. No captured image, page URL, or usage event is stored or transmitted. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

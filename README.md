# Video Screenshot → Clipboard

Copy the current frame of an HTML5 video straight to your clipboard. Hover a video, click the camera button, then paste the PNG anywhere—no editor, download, account, analytics, or server.

This is the third extension in the OFCode screenshot-to-clipboard family:

- [Quick Screenshot → Clipboard](https://github.com/OFCode-dev/quick-screenshot-clipboard) — visible tab
- [Stitch Screenshot → Clipboard](https://github.com/OFCode-dev/stitch-screenshot-clipboard) — scrolling page
- **Video Screenshot → Clipboard** — current video frame

## How it works

1. The extension detects visible HTML5 `<video>` elements, including videos added later by single-page apps.
2. A small camera button remains visible while a video is playing and also appears when a paused video is hovered.
3. Clicking the button first draws the decoded frame to a canvas at the video's native resolution.
4. If the page blocks that canvas as cross-origin, the extension captures the visible tab and crops it to the video rectangle.
5. The PNG is written to the clipboard. It is never downloaded or uploaded.

The toolbar icon provides a second route: clicking it captures the largest visible video in the top-level page.

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
| Access to HTTP(S) pages | Detects videos automatically and enables the visible-tab fallback when direct canvas capture is blocked. |

The extension does not request `downloads`, `storage`, or analytics-related permissions.

## Development

```sh
npm run icons
npm run check
npm run package
```

The store-ready ZIP is written to `dist/`.

## Known limitations

- DRM/EME-protected video may produce a black or unavailable frame by browser design.
- Direct capture works inside frames, but the visible-tab fallback cannot yet crop a nested cross-origin iframe accurately.
- Browser-internal pages and the Chrome Web Store do not allow content scripts.
- A native video element used directly as the fullscreen element cannot host the overlay; fullscreen player containers such as YouTube's are supported.

## Privacy

All image processing happens locally in the current tab. No captured image, page URL, or usage event is stored or transmitted. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

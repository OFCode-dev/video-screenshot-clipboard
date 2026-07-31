# Manual test plan

## Core flow

- [ ] Camera button remains visible on every sufficiently large video currently in view.
- [ ] Camera button stays visible on a paused or lazy background video even when another page layer covers the video.
- [ ] When another screenshot extension occupies the upper-right corner, this extension shifts left instead of overlapping it.
- [ ] Default `V` then `S` triggers one capture within 0.7 seconds.
- [ ] `S` then `S` and single-key `P` can be saved from Options and work after saving.
- [ ] Shortcuts do not fire in inputs, textareas, selects, or editable content.
- [ ] Clicking the button copies a PNG without downloading a file.
- [ ] Clicking the toolbar icon captures the largest visible video, including one inside an embedded player.
- [ ] Pasting into Preview/Paint, Slack, Figma, ChatGPT, and a document works.
- [ ] Success toast and green `✓` badge appear.
- [ ] Clipboard denial shows a clear error and red `!` badge.
- [ ] A cross-origin iframe with clipboard Permissions Policy disabled still copies through the offscreen document.

## Video states

- [ ] Playing video captures the clicked moment.
- [ ] Paused video captures the paused frame.
- [ ] A recently seeked frame is captured after it decodes.
- [ ] Video with no decoded frame asks the user to wait.
- [ ] Muted autoplay video works.

## Layout

- [ ] Multiple videos have independent buttons.
- [ ] Button follows video during scroll and resize.
- [ ] Small decorative videos do not get a button.
- [ ] Partially offscreen video is handled cleanly.
- [ ] 100%, 125%, 150%, and 200% browser zoom crop correctly.
- [ ] Retina/HiDPI output is correctly aligned.
- [ ] Fullscreen player container keeps the button visible.

## Sites

- [ ] Local synthetic fixture: native 1280×720 frame.
- [ ] YouTube regular video and Shorts.
- [ ] Vimeo homepage/modal player: button appears and both direct and visible-tab fallback capture the correct frame.
- [ ] X/Twitter video.
- [ ] Reddit video.
- [ ] A page with a same-origin iframe.
- [ ] A page with a cross-origin embedded player.
- [ ] A video inside `about:blank`, `blob:`, or another origin-fallback frame.
- [ ] A looped hero “moving photo” implemented as HTML5 video.
- [ ] A DRM service fails honestly without saving or uploading anything.

## Lifecycle and safety

- [ ] SPA navigation discovers newly inserted videos.
- [ ] Removed videos also remove their overlay nodes.
- [ ] Repeated rapid clicks do not create concurrent captures.
- [ ] Switching tabs during fallback capture fails without capturing another tab.
- [ ] `chrome://` and Chrome Web Store pages remain untouched.
- [ ] No network request, local storage entry, download, or analytics event is produced.

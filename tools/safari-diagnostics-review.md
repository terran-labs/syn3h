# Safari black-screen investigation

The physical iPad failure is not reproduced on macOS Playwright WebKit 2388. This patch adds evidence collection, not a claimed fix for that failure. WebKit 2388 replaced cached 2368 during the authorized browser install; no project dependency changed.

## Device diagnostics

Current diagnostics use the shared performance panel through F3 or the ordinary UI control. The old `?diag=1` spelling remains an alias, not a requirement. Backend, available adapter information, texture limit, fallback and loss details reuse the selected renderer and startup record. Memory, where exposed by the browser, is an estimate rather than measured GPU memory.

`window.syn3hDiagnostics` remains a bounded compatibility snapshot for capture tools. It updates from the existing quality frame feed and renderer error/loss callbacks, without a global context patch or extra timer. Renderer errors are capped at twelve entries. Context counts are now explicitly untracked, and there is no separate lobby-context event collection. Submitted draws do not prove visible pixels; failures before Game construction cannot be captured by this path. The historical device evidence below predates this replacement.

`?webgl=1` retains the orchestrator's explicit backend override. `?gfx=0` now selects the safe quality budget; it previously was not parsed. Valid graphics URL values are 0, 1 and 2, still bounded by adapter classification and subsequent automatic step-down. Safari detection is exported and tested but unused: no automatic iOS backend change is enabled.

## Evidence

- Live lobby: `/tmp/syn3h-safari-live/ipad-lobby.png` and `iphone-lobby.png`. Both visibly render starfield and planets. Initial harness tried a hidden Enter World button; those game captures are not game acceptance evidence.
- Corrected local flow: Vehicle, Continue, Enter World. `/tmp/syn3h-safari-gpu/ipad-game.png` and `/tmp/syn3h-safari-gl/ipad-game.png`, with corresponding lobby captures and `results.json` in each directory.
- Both local backends: finite exposure about 0.574, sRGB output, four samples, 1024 x 1366 backing at renderer ratio 1 versus device ratio 2. WebGPU exposes Apple adapter information and texture limit 8192; WebGL limit 16384. No page or GPU errors in the captured flow.
- Both lobby graphics flags become false on Play. Eleven DOM canvases are not eleven GPU contexts: the planet cards copy from one shared WebGL canvas into 2D canvases.
- Chrome standard smoke: `/tmp/syn3h-safari-chrome.png`.

## Device-specific findings and remaining limits

The mobile budget caps pixel ratio at 1 and disables shadows. At an iPad CSS size of 1194 x 834 this means a game backing of 1194 x 834, provided classification succeeds. Desktop mode is detected using Macintosh user agent plus multiple touch points. The diagnostics show the actual result on the owner's device.

Antialiasing remains enabled, with four samples observed on macOS WebKit. Multiple color and depth attachments and intermediate targets can cost substantially more than a single canvas bitmap; the texture dimension limit alone cannot establish memory safety. No memory exhaustion or invalid exposure was observed. The desktop shadow presets are two 1024 maps, three 2048 maps, or four 2048 maps; mobile quality requests none.

The game initializes before the lobby, so their GPU resources coexist while the menu is visible. UX releases its contexts on Play, not before game initialization. A planet context is also acquired during imports, before the diagnostics observer starts. If the physical-device panel reports loss or exhaustion, UX and the composition root should defer lobby or game GPU allocation so those resources do not overlap. No speculative lifecycle change is included here.

The live HTTPS dev preview rendered its lobby in WebKit without module request or HMR socket errors. Local Vite rendered both backends. This does not rule out an iPad-specific dev-load or memory issue, and no frozen-production comparison was used to claim one. The next useful evidence is the owner's physical-device panel with normal settings, then explicit WebGL and safe graphics.

## Reproduction commands

Run `tools/heavy.sh node tools/safari-local-run.mjs` for sequential local WebKit backend captures followed by Chrome smoke. The runner closes its isolated Vite server and browsers. Run `tools/heavy.sh node tools/safari-capture.mjs URL OUTPUT both` for lobby and game captures at iPad and iPhone sizes. These are macOS browser engines with emulated viewports and touch, not physical iOS hardware.

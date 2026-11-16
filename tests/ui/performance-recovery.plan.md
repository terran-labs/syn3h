# Performance recommendation and context recovery fixture

Prepared only, unrun. Base f09502654233ac78effd522f52fe3b00d58cf680 is the clean root release-record commit inspected for this assignment. Separate worktree ux-performance-recovery; only this plan and performance-recovery.mjs are owned. Existing quality-card and About/nameplate/input work remain unchanged. No equivalent performance-recovery file existed before preparation.

## Actual source contract

PerformancePanel.ts:74-75 binds native Keep/Ignore and Switch/lower buttons to the real quality controller. Labels at 203-207 depend on the current offer. QualityController.frame at 894-920 takes actual eligibility from judge/loading/document.hidden. The history requires warmup and sustained slow samples; minimum level and ignored-session checks stay active. Ignore keeps the level and overrides and writes sessionStorage syn3h.performance.ignore. lowerRecommendedTier at 691-696 performs an explicit manual level change, pins the level, retains Auto off, and apply('player') clears overrides at 837-845. Medium lava.particleBudget is 960, unlike the staged 1200 override. The existing core tests cover controller calls but do not establish native button routing.

The new fixture uses separate fresh contexts for Keep and Switch so Ignore's session persistence does not suppress the second offer. It uses actual Performance card controls to select High, disable Auto, and enter a 1200 particle override. A temporary wrapper around the existing public quality.frame substitutes only frameMs=50/fps=20 for at most 600 ordinary calls; it preserves this, remaining arguments, actual eligibility and return value. It does not call frame in a synthetic loop, replace recommendation objects, alter clocks or invoke Keep/Switch controller methods directly. At least 200 eligible calls and an actual High-to-Medium offer are required. This is bounded controlled stimulus, not an FPS, frame-cost or performance measurement. It can affect real controller history and budget, intentionally, within the disposable context. Exhaustion fails; there is no repair or second stimulus. The wrapper restores before loss and in cleanup.

Keep must preserve the full quality state including override and suppress the offer through 60 further ordinary calls. Switch must select Medium, remain pinned with Auto off, clear overrides and apply the actual 960 preset. Native pointer clicks activate both buttons.

## Selected backend and actual loss

Game.ts:83-100 supports ?webgl=1 and installs the real renderer.onDeviceLost -> showRendererLost wiring. Installed three/src/renderers/webgl-fallback/WebGLBackend.js:227-247 acquires WebGL2 and listens to webglcontextlost. Calling the current canvas WebGL2 context's public WEBGL_lose_context.loseContext() induces the browser event through that existing backend. The fixture requires a live context and the extension; absence fails, with no fallback. It records the trusted loss event and isContextLost, then requires the actual loss alert and its native Reload button. It never directly calls showRendererLost/onDeviceLost, dispatches a fake context-loss event or disposes the renderer.

Reload must cause document navigation, a different performance.timeOrigin, disappearance of the old document's renderer reference, a selected live WebGL renderer, no stale loss alert, positive real draw calls and more than 30 advancing ordinary game ticks. Renderer identity is document-scoped object identity, not an invented renderer UUID. The installed common Renderer does not expose an asserted UUID. A fresh document cannot reuse the old document's JS renderer object; live context/draw/tick checks establish working replacement, not merely a new token. No manual fixedUpdate/render call is permitted.

Exactly one expected loss console error is checked against the complete installed Renderer._onDeviceLost message. A passive capture listener records actual statusMessage from the real webglcontextlost event; WebGLBackend supplies reason null and uses Unknown reason only for an empty statusMessage. The expected text is built from those fields, with the installed optional reason suffix. All console errors in that original epoch loss interval are retained and must equal exactly that one message. The allowance closes before native Reload; any error during recovery, including another loss message, fails. No startsWith allowance remains. Other console errors, page errors and provenance errors fail and persist. Context and browser cleanup errors stay nonpass; the original primary error remains recorded. Later asynchronous response work is drained after context closure and before final verdict. A killed fixture cannot guarantee its final receipt; external supervision remains required.

WebGPU coverage is BLOCKED, not silently substituted: installed WebGPUBackend.js:266-268 ignores device.lost reason destroyed. GPUDevice.destroy therefore does not test the application's real loss notice. No inspected supported API safely forces an unknown-reason WebGPU device reset. A browser/driver-supported loss facility would need a separately reviewed contract. This fixture explicitly selects WebGL from initial navigation; it does not claim WebGPU recovery or hardware reset coverage.

## Provenance and prerequisites before execution

Exact clean fixture HEAD, matching lock and installed dependency hashes must be verified by a separately reviewed existing bounded launcher. No launcher is prepared or allocated here. Required environment: SYN3H_URL, UX_SOURCE_SHA, fresh UX_EVIDENCE_DIR, UX_DOCUMENT_SHA256, UX_RENDERER_MANIFEST. Document bytes and the renderer manifest must be independently produced from the same isolated Vite serving configuration and reviewed before allocation. The manifest lists every relevant optimized renderer chunk as {path, sha256}; the setup review must independently bind their exact bytes and source maps to the installed Three backend sources pinned below. It must cover transitive renderer chunks, not merely the entry module. A self-observed response hash or a version label cannot supply this binding. The current fixture consumes the independently reviewed manifest, but does not replace that prerequisite review. Environment labels alone are not that proof. If current tooling cannot supply that binding, stop for setup review, not a guessed hash or relaxed assertion.

The fixture observes actual navigation documents and script responses. It binds main-frame navigation request, commit, one document response and an init-script document token/timeOrigin into a distinct epoch. Script requests are associated with that epoch when requested. Both initial and Reload epochs independently require exact document bytes, every declared renderer-chunk hash, and all six app TS source maps with a unique matching source identity and matching sourcesContent at that index. Cumulative flags and duplicate responses cannot satisfy another epoch. Unexpected navigation/frame/script provenance fails. HMR update/full-reload/prune messages fail. Response work drains after context closure and late errors are checked again after browser closure. HTTP 304 alone is insufficient: readable actual response bytes must still match. Missing maps/bodies, redirects, foreign scripts, service-worker responses or cache evidence fail. No raw-source refetch is used as execution proof. No production endpoint is probed.

Proposed future gate: one desktop installed Chrome process, two sequential contexts, explicit WebGL, shared 240-second fixture deadline including final closure, within a separately allocated reviewed supervisor budget. No current runtime is queued. Requires dedicated existing room/Vite setup, owned process/listener closure, no shared-preview reuse. Expected two cases: native Keep and native Switch plus real WebGL loss/Reload. No forced clicks or hidden-state bypass. Capability ceilings that cannot select High are failures requiring review, not silent lower-level substitution. Performance-card animation, viewport and actual native actionability remain runtime prerequisites.

## Limits and review

No WebGPU loss, physical device crash, phone/WebKit, performance benchmark, performance gain, broad native input or About safety acceptance. Controlled metrics are disclosed in every report. The prepared fixture has only syntax/whitespace inspection, not typecheck or execution. The existing quality-card fixture has older layout assumptions and broad control coverage; it is reference material, not evidence this new sequence passes.

## Source pins

- `src/core/Game.ts`: `26be098fb86fdee6243f0901c99aedea39a1d381643b68e5828c20039ca12278`
- `src/core/quality.ts`: `e796a76f1ed60c17ee545daa31ca2d4890125f7ff4a8093e13d520dcd7b44e05`
- `src/core/performanceHistory.ts`: `52d9944ddc4a1e53686ef746a4a9a110ef0745f606759b84de128a429f5ec2c5`
- `src/core/diagnostics.ts`: `561f303a4a116e9c777c61fb0eff760e48fb17464435404628fc9972995fadf4`
- `src/ui/PerformancePanel.ts`: `545ab69c58ec64749b3140677025be2fbc8c1a245d6852d48ec3e6897ebd33fc`
- `src/core/renderOptions.ts`: `396f4a735ff179224d8830370a9de8a238e1201294453a9c5088cb1b03bc7992`
- `tests/core/performance.test.ts`: `f865105b6b8f9c5a887c4f076e628a39c198fbcf4133ce3160054a5fd260a396`
- `tests/core/performance-diagnostics.test.ts`: `51349d4c42c2aae8171e0b7c55fcd7267cf0f5e4875bf40ec37a133c143c5bb1`
- `tests/core/renderer-startup.test.ts`: `7404fce6b4bb3abe0a2ed4e47cbdfcf6e77807f430b65cfa42b211a6f37c5a78`
- `tests/ui/quality-card.mjs`: `8e927e8760b0120776c7a9a07b0d63fd456e6891b2f67d3787909f32d1cafe21`
- `package-lock.json`: `4231578550a1ebd5b6f1dd028735b02e45e273a664d47c80ae73816e850d84bc`
- Installed root `node_modules/three/src/renderers/webgl-fallback/WebGLBackend.js`: `31de7bafda55ec8418d029bb386449b20b02023007306ad0e6bbda8d51288f63`
- Installed root `node_modules/three/src/renderers/webgpu/WebGPUBackend.js`: `f854f39a7c74e7d21f069bf9b4b8ec18ac29f2e750ac6348e89b9696e46e29a2`
- Installed root `node_modules/three/src/renderers/common/Renderer.js`: `4750ca9783cbb27c2db9ea44ae9572c825658fe457cab03849dfd6cf6d80476a`


## Source review correction after initial draft

Initial draft 9828ce58 remains preserved. This correction changes only fixture and plan. Per-epoch request/commit/document identity, all six source receipts and every renderer chunk are now required separately. Exact source identity and content must agree at the same source-map index. Main-frame source evidence from the initial document cannot stand in for Reload. Failure and cleanup records retain the first primary error; later errors remain separately nonpass. Native controls, genuine WebGL extension loss, controlled sample limits and the 240-second total budget are unchanged. Timing fit, source-map representation and independent renderer-manifest production remain unvalidated prerequisites. No launcher or runtime is prepared or allocated here. WebGPU remains open.

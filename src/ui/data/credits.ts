/** Reviewed public copy: ops/ABOUT-EDITORIAL.md. Keep complete licence disclosures below. */
/** The outside links: the author, the studio, the source and the releases. */
export const aboutLinksHtml = `<nav class="about-links" aria-label="About links"><a href="https://aubreyfalconer.com" target="_blank" rel="noopener">Aubrey Falconer ↗</a><a href="https://terranlabs.com/" target="_blank" rel="noopener">Terran Labs ↗</a><a href="https://github.com/terran-labs/syn3h" target="_blank" rel="noopener">Explore the source ↗</a><a href="https://github.com/terran-labs/syn3h/releases" target="_blank" rel="noopener">Release history ↗</a></nav>`
/** Credits and licences, complete: every bundled licence is linked (tests/core/frozen-resources.test.ts). */
export const licencesHtml = `<details class="shell-credits"><summary>Credits & licences</summary>
<p>Original Syn3h and Mars Explorer game, logos and vehicle assets: Aubrey Falconer. Original assets are used with the owner's permission.</p>
<ul><li>Three.js authors: rendering and model loaders, <a href="/brand/licenses/three.txt" target="_blank" rel="noopener">MIT</a>.</li>
<li>Project Nayuki: QR format reference and test vectors, <a href="/brand/licenses/qr.txt" target="_blank" rel="noopener">MIT</a>.</li>
<li>Dimforge contributors: Rapier physics, <a href="/brand/licenses/rapier.txt" target="_blank" rel="noopener">Apache 2.0</a>.</li>
<li>cocopon: Tweakpane controls, <a href="/brand/licenses/tweakpane.txt" target="_blank" rel="noopener">MIT</a>.</li>
<li>Łukasz Dziedzic: Lato Thin, <a href="/brand/licenses/lato.txt" target="_blank" rel="noopener">SIL OFL 1.1</a>.</li>
<li>Google: Roboto Thin, <a href="/brand/licenses/roboto-apache.txt" target="_blank" rel="noopener">Apache 2.0</a>, <a href="/brand/licenses/roboto-notice.txt" target="_blank" rel="noopener">font notice</a>.</li>
<li>Barlow Project Authors: bundled Barlow fonts, <a href="/brand/licenses/barlow.txt" target="_blank" rel="noopener">SIL OFL 1.1</a>.</li>
<li>Marked contributors: dashboard Markdown, <a href="/brand/licenses/marked.txt" target="_blank" rel="noopener">MIT notices</a>.</li>
<li>ws contributors: development room server, <a href="/brand/licenses/ws.txt" target="_blank" rel="noopener">MIT</a>.</li></ul>
<p>Music and sound: all of it is synthesised in your browser as you play. The adaptive score, the vehicle voices, wind, Plasma Tag and every cue are generated; this edition ships no recordings.</p>
<p>The generated names and loading jokes are new browser-edition writing. The original online message list was not recovered.</p></details>`
/** Everything About carried that the Welcome guide still shows: the links, then credits and licences. */
export const creditsHtml = `${aboutLinksHtml}
${licencesHtml}`

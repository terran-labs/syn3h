# Mira voice spike and production proposal

Research checked 23 November 2026. The browser findings below come from vendor documentation and reports from other applications. Two-player browser validation, the preview link, real-device listening, phone CPU and frame timings, and Mira's TURN rate are pending. The bandwidth and billing tables are estimates.

Keep the two-player mesh in the spike. For production, use Cloudflare Realtime SFU with TURN fallback, subject to the owner's approval for account changes and usage charges. Validate iPhone speaker playback before committing to that rollout. An SFU changes where packets go. The iPhone still has to capture and play audio through the same Safari session.

## Phase 1

### A. iPhone Safari audio session

Opening the mic can put Safari into a play-and-record session. WebKit shipped partial Audio Session API support in Safari 16.4. Apple exposes speaker routing and ducking as separate options in its native APIs. The web session type expresses intent to play and record and leaves route selection to the browser and OS. WebKit reports describe changes in volume and route, including receiver playback or changes when capture actually starts. A newer report describes crackling in both Web Audio and an audio element while echo-cancelled capture is active on specific iPhones and OS versions. Those reports give us symptoms to check on Mira's synth mix, including whether they persist after capture ends. [Audio Session specification](https://www.w3.org/TR/audio-session/), [Safari 16.4 release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Apple speaker routing](https://developer.apple.com/library/archive/qa/qa1754/), [Apple ducking](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/duckothers), [WebKit routing report](https://bugs.webkit.org/show_bug.cgi?id=218012), [WebKit crackling report](https://bugs.webkit.org/show_bug.cgi?id=326286).

Start capture from the Enable voice gesture and resume the existing AudioContext from that same gesture. If the automatic session sounds wrong, compare a fresh run with feature-detected `navigator.audioSession.type = 'play-and-record'` just before capture. On capture failure or voice exit, stop the mic and restore the previous type if Mira changed it. Compare the route and mix at a fixed hardware volume. Treat a persistent low, distorted, or receiver-only game mix as a release issue for that device.

### B. Echo on the speaker

Request echo cancellation, noise suppression, and auto gain as preferred constraints on one local mic track. Inspect supported settings for diagnostics where the browser exposes them. The setting reports what the browser selected. The listener on the other device tells us whether it worked.

Chrome 141 documents `all` and `remote-only` in addition to the boolean constraint. The latter mode targets peer-connection audio. The spec leaves the reference up to the browser for `true`, with peer audio as the minimum it should attempt to remove under that mode. Game synths are local playout, and Chrome's release notes give no result for Mira's processed Web Audio graph. Safari's 26.4 notes describe an echo cancellation change for multiple microphones on macOS. The iPhone WebKit report confirms that enabling echo cancellation can alter playback quality, while the amount of echo removed from this graph remains an open question. Use `true` as the cross-browser baseline. [Chrome 141 release notes](https://developer.chrome.com/release-notes/141#webrtc), [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/#def-constraint-echoCancellation), [Safari 26.4 release notes](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/), [WebKit capture and playback report](https://bugs.webkit.org/show_bug.cgi?id=326286).

Test two different sounds at the far end: the partner's own words coming back from the phone and Mira's engine coming back while the phone player is quiet. Also test talking over one another, since cancellation can chew up speech. If needed, compare the same remote track through a plain audio element at matched loudness with the Web Audio output disconnected. That isolates the playback path. Try optional game-mix attenuation or a headset if the speaker leaks badly. Keep the spatial path and hold the rollout on a device where conversation becomes unusable.

### One minute on the iPhone

Set up first. Open the Foreman's verified HTTPS spike preview with `?voice=1` on the iPhone in Safari and on a second device. Join the same invited room. Put the second device in headphones and keep its mic away from the phone. Use the iPhone loudspeaker, turn off Bluetooth for this run, and leave the hardware volume alone. Start near each other in game, with voice off on the phone. Have the partner enable voice before starting the clock.

| Time | Action |
| --- | --- |
| 0 to 10 s | Drive with voice off. Note which speaker plays, the engine and music level, and whether the sound is clean. |
| 10 to 20 s | While the engine is audible, tap Enable voice and grant the mic. Check for a level drop, earpiece switch, ducking or crackles as capture starts. Note if the mic indicator appears. |
| 20 to 35 s | Stay silent and drive. The partner counts aloud, pauses to listen for their own voice coming back, then listens for your engine during the pause. Say a short phrase together and check that both voices remain intelligible. |
| 35 to 45 s | Have the partner speak while moving past your vehicle and away. Listen for left and right placement and fade with distance. |
| 45 to 55 s | Tap mute and keep talking. The partner should stop hearing you. You should still hear them. Check the mute indicator. |
| 55 to 60 s | Turn voice off. Check that the mic indicator clears and that the engine returns to its starting route, level and quality. |

Report phone model, iOS version, second browser, network pairing, route and sound before/during/after, echo of words or engine, and whether mute worked. Repeat with Android Chrome for comparison. For a report about external audio ducking, repeat with a steady background source and check whether its level changes independently of the game mix.

### C. Phone cost and mesh size

Measure two players on the same phone, scene, route, vehicle, graphics tier, network and hardware volume. Run alternating voice-off and voice-on passes with the two players present throughout. After warmup, sample 60 seconds per pass. Include an idle mic pass and a short sustained conversation with both players audible. Capture median and p95 frame intervals, long frames and missed frame budget, and total browser CPU if device profiling exposes it. Report unavailable CPU counters as unavailable. Main-thread timings miss native audio, codec and network work. Sample WebRTC stats for send/receive bitrates, packet loss, RTT and jitter buffer delay where exposed. Distinguish RTP stats from link or billing bytes, and keep raw diagnostics local. Use the same workload for iPhone Safari and Android Chrome. [WebRTC Statistics specification](https://www.w3.org/TR/webrtc-stats/).

Planning estimate per direction and per peer: 40 to 64 kbit/s during sustained speech. This assumes roughly 20 to 40 kbit/s mono Opus payload and allowance for packet headers, encryption and control traffic at about 20 ms per packet. The real rate varies with packetization, address family, loss, silence and TURN. [Opus RTP specification](https://www.rfc-editor.org/rfc/rfc7587.html#section-3.1.1).

| Voice-enabled players | Peer connections per phone | Connections across room | Phone uplink during speech | Phone downlink if everyone else speaks | Send and receive pipelines relative to two players |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 1 | 40 to 64 kbit/s | 40 to 64 kbit/s | 1× |
| 4 | 3 | 6 | 120 to 192 kbit/s | 120 to 192 kbit/s | 3× |
| 8 | 7 | 28 | 280 to 448 kbit/s | 280 to 448 kbit/s | 7× |
| 16 | 15 | 120 | 600 to 960 kbit/s | 600 to 960 kbit/s | 15× |

With one mic track attached to each peer connection, budget for one capture and preprocessing path plus up to one sender encode pipeline and one receive decode path per peer. Do not assume browsers share encodes across connections. As a first-order CPU model, add the fixed capture cost to the two-player per-peer transport, codec and mixing cost multiplied by 3, 7 or 15. Game CPU stays outside that model. These multipliers describe workload only. Scheduling, thermal throttling and browser implementation can change the CPU and frame impact.

Keep the current spike at two. Four is a reasonable mesh profiling case. Move to an SFU before testing an eight-person production rollout. Sixteen is already 15 independent uplinks per phone in a mesh. The SFU cuts that to one and can limit receive/decode costs if Mira subscribes only to nearby speakers. Phase 2 uses the SFU even for small production rooms, so peers never receive one another's ICE candidates.

### D. NAT traversal and TURN

Use public STUN only in the spike. The proposed endpoint is `stun:stun.cloudflare.com:3478`, which Cloudflare documents as free and unlimited. The integrated spike config still needs confirmation. STUN discovers a mapped address. ICE checks whether a path works. TURN carries media when direct paths fail. A same-Wi-Fi or same-host success says little about mobile carriers or restricted Wi-Fi. [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), [ICE RFC 8445](https://www.rfc-editor.org/rfc/rfc8445.html), [TURN RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html).

Mira's relay share is unknown. An IETF ICE draft reported 5 to 10% of calls needing TURN in large consumer deployments at the time. Use 5%, 10% and 20% as sensitivity cases for direct peer calls, with 20% as a stress assumption. They do not forecast Mira's users or the fraction that will need TURN to reach a Cloudflare SFU. Public STUN alone can show failures but cannot tell us how many TURN would recover. [IETF ICE draft deployment observations](https://datatracker.ietf.org/meeting/94/agenda/ice-drafts.pdf).

After approval, test same Wi-Fi, Wi-Fi to cellular, two carriers, restricted Wi-Fi, and a forced TURN test with UDP blocked. Compare direct-only with fallback enabled. Count all attempts, connected direct, connected relayed, and failed, then report selected relay share among successes separately from the fraction of all attempts recovered by TURN. Use selected candidate pair types and transport protocols from `getStats()`, with no addresses, URLs, credentials, raw SDP or ICE candidates in stored logs. For production use short-lived TURN credentials issued by the Worker to authorized room members and support UDP and TLS over TCP on port 443. Cloudflare supports TCP/TLS on the client-to-TURN leg and IPv4 UDP relay allocations. Its maximum TURN credential TTL is 48 hours. Start with a shorter TTL and refresh before expiry for longer sessions. [Cloudflare TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [Cloudflare TURN ports](https://developers.cloudflare.com/realtime/turn/custom-domains/), [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/).

## Phase 2 proposal

### Transport and authority

Use a browser RTCPeerConnection to Cloudflare Realtime SFU per voice participant, initially with one mono Opus publication and multiple individually addressable subscriptions. Use a serialized negotiation queue per connection. Keep membership and control on the existing WebSocket and the room Durable Object. The Worker holds the app secret and exposes only operations that the room authorizes. The room derives user identity from the socket, checks invitation, current membership, voice consent and host policy for each operation, and binds session and track identifiers to that membership and connection generation. Reject stale requests after rejoin. Send authorized listeners only the mapping needed to attach a received track to the speaker's current vehicle. An invite must convey server-verifiable access. A room URL or nonpublic room name alone is insufficient. [Cloudflare SFU best practices](https://developers.cloudflare.com/realtime/sfu/best-practices/).

In the existing audio engine, route each track through its own gain and position-dependent panner and into a dedicated voice volume channel. Use the live remote position and existing listener basis. Keep this path separate from the vehicle engine synthesizers and do not connect the local mic to game output. Use local attenuation for smooth movement. Before opening to larger rooms, add server-authorized nearby subscriptions with hysteresis to avoid churn at the boundary. Playback fades are a presentation feature. Subscription policy determines who can actually receive a stream. Distances and gain curves are tuning parameters.

WebRTC encrypts media between each browser and the SFU. The SFU is a trusted media endpoint, and the proposal makes no claim of end-to-end encryption between players. The production path gives Cloudflare the connection addresses and hides them from other players at the voice layer. Avoid direct-mesh fallback because it would change that privacy property. Treat a voice outage as recoverable and leave play and text chat available.

### Provider limits and cost

Cloudflare lists **$0.05 per GB of egress after the first 1,000 GB per month**, shared by SFU and TURN. Ingress is free and the Cloudflare TURN-to-SFU leg is not charged again. TURN client egress includes TURN overhead after authentication. Worker and Durable Object usage have separate pricing. The SFU supports Opus, up to 50 API operations per second per session, and up to 64 track additions per request. It publishes no fixed track cap per session. A track can be collected after 30 seconds without incoming media. Close publications and subscriptions explicitly for host disable or departure, and handle an expired track on unmute or after long quiet. Check Opus silence behavior against that timeout. [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [SFU limits and timeouts](https://developers.cloudflare.com/realtime/sfu/platform/limits/), [TURN billing FAQ](https://developers.cloudflare.com/realtime/turn/faq/).

Illustrative model at 48 kbit/s per delivered stream, or 0.0216 decimal GB per stream-hour. One full-room hour at 16 players and one sustained speaker delivers 15 streams, or 0.324 GB. All 16 speaking continuously delivers 240 streams, or 5.184 GB. At four received streams per player on average, the result is 64 streams, or 1.3824 GB per room-hour.

| 16-player room scenario | GB per room-hour | GB for 1,000 room-hours in a month | Estimated Realtime bill if this is the account's only use |
| --- | ---: | ---: | ---: |
| One continuous speaker heard by all others | 0.324 | 324 | $0 |
| Four received streams per player on average | 1.3824 | 1,382.4 | $19.12 |
| Every player speaking continuously to everyone else | 5.184 | 5,184 | $209.20 |

The model excludes extra TURN overhead and game infrastructure, assumes continuous delivery at the stated rate for each modeled stream and assigns the entire shared allowance to Mira. Compare provider egress against the model in the pilot. Apply the account's actual remaining allowance and agree on a budget and an operator kill switch before allowing more rooms.

### Controls and safety defaults

- **Room settings.** The host can allow or disable voice in an invite-gated room. Start disallowed in newly eligible rooms until the host enables it. When disabled, the server revokes media and authorization for every participant. Joining or reconnecting to a different room resets capture consent.
- **Chat panel and HUD.** Put Enable voice and Voice off beside chat controls. Explain proximity and who can hear before the microphone prompt. Put Mute/Unmute and a visible, accessible mic state within one tap while driving, clear of touch steering. Use open mic with local speech activity and a speaking indicator. VAD is an activity estimate and may miss sound or classify other sounds as speech. User mute takes precedence and must detach or otherwise stop mic transmission. If the microphone stays captured for quick unmute, distinguish that state from Voice off, which releases capture. Unmute restores capture only by explicit action following an interruption or permission loss.
- **Audio settings and player list.** Put Voice volume under Audio. Reuse the text chat per-player mute for immediate local silence and remove that subscription in production. Host removal revokes production media access. Keep public rooms and bot identities excluded. If adding a report action, use a predefined reason and permitted room metadata, without a recording or transcription.
- **Data handling.** Store no audio or transcripts. Keep SDP, candidates, voice levels, endpoint addresses, credentials, typed strings and other sensitive payloads out of logs. Use aggregate lifecycle outcomes and stable error codes that follow `server/log.ts`. Show a useful status for permission denied, mic interrupted or connection failed. Fail closed if room membership becomes uncertain, including on WebSocket loss.

### Release sequence and acceptance

1. **Finish the two-player spike.** Verify it starts only under the link switch and explicit consent. The two-player browser smoke should demonstrate audio in both directions and cleanup. Run the one-minute script on iPhone Safari and Android Chrome with a second device, and record two-player performance using the off/on method above. Bring the actual sound, routing, echo and frame findings to the Foreman before choosing a workaround or approving the production path.
2. **After approval, wire the production transport in staging.** Keep it gated while establishing server-side invite authorization, secrets, lifecycle and TURN fallback. Confirm an unauthorized client cannot publish or subscribe, a forced relay connects, and departing or disabling voice ends delivery. Exercise reconnect and credential refresh on staging. Add minimal approved aggregate observability and compare metered egress to the estimate.
3. **Ship a small invite-only pilot.** Validate phone and desktop UI, accessibility, mute, host disable and denial/interruption states. Use regular room entry with individual opt-in. Begin with a small voice participant cap. Report audible quality, connection success, selected TURN share, frame timing and spend. Set acceptable release budgets after the measured baseline, with Foreman approval before widening.
4. **Raise the cap to eight, then sixteen in invited rooms.** Verify nearby subscriptions through movement, simultaneous speech and membership churn. Re-profile lower-end phones with game load and verify egress under realistic use. If voice fails the gate, disable voice admission and close existing sessions while leaving gameplay and text operational. The Orchestrator owns production release and rollback.

Blocking invariants should catch player-visible bugs: validate signalling and authorization, reject oversized or flooded inputs and forged, stale or cross-room targets, exercise simultaneous negotiation and reconnect, verify voice off never prompts or creates a peer connection, verify mute sends no microphone audio and shared player mute suppresses that player's stream, and verify deny, leave, disconnect, host disable and removal clean up tracks, connections, graph nodes and pending capture. Check that a late permission grant after leaving stops the returned mic. Exercise failed provider operations and retries without granting stale access or duplicating publications. Test that sensitive payloads never reach logs. Keep speech thresholds, attenuation and bitrates out of blocking assertions. Use the repo's typecheck, affected tests, full suite and two-player networking smoke through the prescribed tools for the implementation.

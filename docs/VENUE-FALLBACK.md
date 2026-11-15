# Venue fallback: the game served from this Mac

Use this only if the public release cannot be reached at the venue (Cloudflare unreachable,
the venue's internet down, the Worker failing). It serves the frozen production build, with
the same Worker and room code, from this Mac to whatever local network the Mac and the
guests' phones share. Nothing is deployed and no Cloudflare access is needed.

It is a worse experience than production in specific ways, listed under "What guests lose".
Prefer production whenever it answers.

## Start it

From any checkout that has `tools/serve-venue.sh` (the frozen build lives outside the repo, in
`../Syn3h-stable/current`, and is whatever `tools/release.sh` or `tools/promote-stable.sh`
froze last):

    tools/serve-venue.sh            # port 8080; pass another port as the first argument

It prints the build it is serving and the address guests use, for example
`http://192.168.12.129:8080/`. Leave that terminal open. In a second terminal, keep the Mac
awake for as long as the demo runs:

    caffeinate -dims

Then check it the way a guest's browser would see it (two headless players, about a minute):

    tools/heavy.sh node tools/venue-check.mjs http://192.168.12.129:8080/

`VENUE CHECK OK` means both players loaded the page over plain http, rendered, joined a room
over `ws://` and saw each other drive.

Stop the server with Ctrl C in its terminal. If the terminal is gone, find the process by its
port and stop that one process: `lsof -nP -iTCP:8080 -sTCP:LISTEN -t`, then `kill <that pid>`.
Never stop it by name.

## How guests reach it

1. The Mac and the phones must be on the same network, and that network must let devices talk
   to each other.
2. On the projector, open the printed address **on this Mac, by its network address, not
   `localhost`**. Invite links and the QR code are built from the page's own address, so only
   then do they point somewhere a phone can reach.
3. Guests scan the QR code from the lobby or the in game menu, or type the address.

**Open a fresh room for the demo.** On the projector, pick a room name nobody has used
before, for example `?room=demo-sunday`, and let the QR code carry it. Do not use `lobby` or
any room used during testing, on production or on this server. A room keeps its world
settings, and a room stored by an older build can lack settings that newer builds have; until
the release that includes the fix for that (joiners take defaults for whatever a stored room
lacks, on trunk from milestone m14), people joining such a room can each build a different
island. A fresh name has no stored world: the first player in brings theirs, and everyone after
gets exactly that. The same rule applies to the public address.

Rooms on this server are separate from production's. Anyone still on the public address is in
a different world from the people on the Mac's address.

## What guests lose

A plain http page on a network address is not a "secure context", and browsers withhold some
features from it. Measured on this Mac on Saturday 14 November, headless Chrome, against the
m12 frozen build:

| Feature | Over http on the LAN | Effect |
|---|---|---|
| WebGPU | Not available (`navigator.gpu` is absent) | The game falls back to WebGL by itself and plays. Expect lower frame rates and simpler lighting than WebGPU. |
| Multiplayer socket | Works over `ws://` on the same address | None |
| Clipboard | Not available | "Copy invite link" shows the link as text to copy by hand. The QR code is unaffected. |
| Gamepads | Available in Chrome | None in Chrome. Not checked in Safari or Firefox. |
| Motion and orientation sensors | Not available | None: the game does not use them. |
| Screen wake lock | Not available | None today: the game does not ask for it. Phones dim and lock on their own timer either way. |

Not measured, so check them on real phones at the venue: sound on iOS Safari and Android
Chrome over http, and how the WebGL fallback performs on a phone. A browser may also mark the
page "Not secure" or ask before opening an http address; guests choose to continue.

The other differences are not about the browser:

- **One Mac is the server.** If it sleeps, changes network or closes the terminal, everyone
  drops. Clients reconnect by themselves when it is back, into a fresh room.
- **Reach.** Only people on the same network can join. Nobody outside the room can.
- **Capacity.** A room still takes 16 players. The limit you will meet first is the network:
  phone hotspots in particular allow only a handful of devices.

## What can stop it working

- **Client isolation.** Many guest Wi-Fi networks stop devices from talking to each other. The
  page then never loads on a phone although the Mac is fine. There is no fix on that network.
  Use another: a phone hotspot that the Mac and the guests join, a travel router, or the Mac's
  own Internet Sharing over Wi-Fi.
- **The Mac's firewall.** It was off on this Mac when this was written
  (`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`). If it is on, macOS asks
  once whether `node` may accept incoming connections: allow it.
- **The address changes.** The Mac's address belongs to the network it is on. After joining
  the venue network or a hotspot, start the script again and use the address it prints.
- **No internet at all.** The local server was tested with this Mac online. It should not need
  the internet, but that has not been tested. Test it before relying on it: join a hotspot
  with mobile data off, start the script, run the check.

## Before the audience arrives

Do these at the venue, on the venue's network, with production still the plan:

1. Production: open the public address on a phone on venue Wi-Fi and on a phone on mobile
   data. Join one room from both. If this works, the fallback stays in the drawer.
2. Start the fallback anyway and run `tools/venue-check.mjs` against the printed address.
3. From a real phone on the venue Wi-Fi, open the fallback address. If it does not load, the
   network isolates clients: set up the hotspot now, not during the demo, and repeat.
4. On that phone: does it render, is there sound after the first tap, can it drive, does the
   projector see it move, does the QR code on the projector open the same room?
5. Use the fresh demo room name for this, the one the audience will join, not `lobby`.
   Two phones and the projector in one room for two minutes: ram, tag with a beam, hold the
   hill. Watch the delay figure on the HUD's `net:` line; under about 200 ms is comfortable.
6. Leave the fallback server running and `caffeinate` on. Switching to it mid demo is then
   just putting its address on the projector.

## Going back to production

Put the public address back on the projector and ask guests to rescan. Stop the fallback
server with Ctrl C. Nothing else needs undoing: it never touched Cloudflare or the domain.

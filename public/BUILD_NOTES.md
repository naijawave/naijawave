# Naija Wave — Frontend Build Notes

Vanilla HTML/CSS/JS single-page app in `public/`. No frameworks, no build step.
Socket.IO client loaded from `/socket.io/socket.io.js` (served by backend).
Views code-split via dynamic `import()` per route.

## What was built

**Brand & shell** — `img/mark.svg` + `img/logo.svg`: bold rounded "N" whose right
stroke dissolves into 3 rising wave bars, blue gradient (#2E7CF6→#00C2FF), gold
crest dot. `index.html`: app bar, desktop sidebar, mobile bottom tab bar
(Home/Pulse/Messages/Notifications/Profile), hamburger drawer (Explore, Court,
Versus, Buzz, Verify, Settings, Admin), right rail (trending + suggested),
overlay/toast roots, offline banner.

**Core** — `js/api.js` (fetch wrapper w/ Bearer JWT, auth state, socket connect
with token + reconnect, ack-capable `emitSock(ev,data,ack)`), `js/router.js`
(hash routes + guards), `js/ui.js` (post cards with like/repost/quote/bookmark,
polls, comments, user rows, custom blue/gold/founder tick SVGs, badge
bottom-sheet from `/api/verification/badges`), `js/app.js` (chrome, unread
badges, global socket wiring).

**Routes** — `#/welcome` (email/phone toggle, 6-box OTP, username/DOB/avatar,
forgot-password), `#/home` (composer w/ media+poll, For You/Following),
`#/explore`, `#/pulse`, `#/court` (vote + debate threads), `#/versus` (VS
battles + voting), `#/buzz` (category/location filters, "Community report —
not confirmed" ribbons, report flow), `#/messages` + `#/messages/:id`
(realtime chat, status ticks, typing, presence dots, attach menu, block/report,
offline queue flushed on reconnect), `#/notifications`, `#/profile/:u`
(cover, tabs, edit modal, follow/message/block menu, founder banner),
`#/post/:id`, `#/tag/:tag`, `#/settings` (privacy incl. who-can-message, online
visibility, read receipts; notification prefs; blocked/muted; OTP password
reset; guidelines; logout), `#/verify` (badge explainer, application form,
status tracker), `#/admin` (stats, users w/ suspend/restore/revoke/make-admin,
verification queue w/ approve-blue/approve-gold/reject+note, reports w/ resolve
actions, activity log, announcements, sponsor toggle).

**WAVECAST** (`js/wavecast.js`) — full-overlay recorder: analyser-driven sound
orb (scale + glow), ripple rings, live timer (2:00 max), live waveform strip,
stop→preview (play/pause, scrubber, 1x/1.5x/2x, re-record, Send wave, discard),
MediaRecorder mime fallback chain, upload `kind=voice`, in-chat orb players
with animated playback + speed + optional transcription (only when
SpeechRecognition exists — never faked), clear mic-denial error card.

**Calls** (`js/calls.js`) — WebRTC per API.md §10 with corrected event names
(server→client: `call:incoming/accepted/rejected/ice/ended`; client→server:
`call:invite/accept/reject/missed/ice/end`), ICE from `/api/config`, incoming
overlay with 30s auto-missed, active call UI (mute, camera toggle, flip via
facingMode, speaker via setSinkId, duration, end), call logging.

## Deviations / honest gaps

- **Password change**: no `/api/auth/change-password` in the contract, so
  Settings uses the real forgot-password → OTP → reset-password flow instead.
- **Follow state in search/suggested rows**: `followBtn(u.username,false)` is
  used where the API doesn't return viewer follow state; the button corrects
  itself after first tap and via `nw:follow` events elsewhere.
- **Transcription**: plays the wave aloud for the mic-based recognizer; on
  devices where the mic can't hear the speaker it may fail gracefully — noted
  in UI copy. Never faked.
- **Badge sheet**: uses `badges.{blue,gold,founder}.{name,meaning,who}` per the
  corrected contract.
- **Admin "warn"** maps to report action `"warn"`; moderation-queue endpoint not
  used (reports tab covers it).
- **Blocked/muted lists**: uses `GET /api/users/me/blocked|muted` — not in the
  contract; if the backend lacks it, the sheet shows empty with an error. Flag
  for backend confirmation.
- Missed-call history view not built (no dedicated route requested); logs go
  via `POST /api/calls/log`.

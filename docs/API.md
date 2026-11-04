# Naija Wave — API Contract (v1)

Base URL: same origin as the app (backend serves `/public`). All JSON unless noted.
Auth: `Authorization: Bearer <JWT>` on protected routes. Token returned by login/verify.
Timestamps: ISO-8601 UTC. IDs: integers, except `uuid` where noted.

Conventions:
- Errors: `{ "error": "message", "code": "OPTIONAL_CODE" }` with proper HTTP status.
- Paginated lists: `?page=1&limit=20` → `{ items:[...], page, limit, has_more }`
- A **user object** always looks like:
  `{ id, username, display_name, avatar_url, verification: "none"|"blue"|"gold"|"founder", is_founder, bio, followers_count, following_count }`
- A **post object** always looks like:
  `{ id, author:{user}, text, created_at, media:[{id,url,kind,duration}], poll:{id,question,options:[{id,text,votes}],total_votes,my_vote}|null, counts:{likes,comments,reposts,quotes}, liked, reposted, bookmarked, hashtags:[], section:"feed"|"buzz", location, is_sponsored, quote_of:{post}|null, repost_of:{post}|null }`

## 1. Auth — /api/auth

- `POST /api/auth/register` `{ contact, contact_type:"email"|"phone", password, username, display_name, dob:"YYYY-MM-DD", avatar_url? }`
  → `201 { user:{user}, otp_sent_to, dev_otp }`
  - `dev_otp` is ONLY present when `OTP_MODE=dev` (default). In production this field is absent and the code is sent by SMS/email provider.
  - Validation: contact unique, username 3–20 `[a-z0-9_.]`, password ≥ 8 chars, age ≥ 13.
  - Codes: `USERNAME_TAKEN`, `CONTACT_TAKEN`, `UNDERAGE`, `WEAK_PASSWORD`, `INVALID_*`.
- `POST /api/auth/verify-otp` `{ contact, code }` → `{ token, user }` (marks contact verified; login allowed)
- `POST /api/auth/resend-otp` `{ contact }` → `{ otp_sent_to, dev_otp? }` (max 3/hour)
- `POST /api/auth/login` `{ contact, password }` → `{ token, user }`. Codes: `NOT_VERIFIED` (must verify OTP first), `SUSPENDED`, `INVALID_CREDENTIALS`.
- `POST /api/auth/forgot-password` `{ contact }` → `{ otp_sent_to, dev_otp? }`
- `POST /api/auth/reset-password` `{ contact, code, password }` → `{ ok:true }`
- `GET /api/auth/me` (auth) → `{ user: full profile incl. email/phone masked, prefs, verification_status }`
- `POST /api/auth/logout` (auth) → `{ ok:true }` (client discards token)

## 2. Users — /api/users

- `GET /api/users/:username` → `{ user: full public profile + counts + viewer:{following, followed_by, blocked, muted} }`
- `PATCH /api/users/me` (auth) `{ display_name?, bio?, location?, website?, avatar_url?, cover_url?, prefs? }` → `{ user }`
- `GET /api/users/:username/posts?type=posts|replies|media|likes` → paginated posts
- `GET /api/users/:username/followers|following` → paginated users
- `POST /api/users/:username/follow` (auth) / `DELETE /api/users/:username/follow` → `{ following:bool, followers_count }`
- `POST /api/users/:username/block|mute` / `DELETE ...` (auth) → `{ ok:true }`
- `POST /api/users/:username/report` (auth) `{ reason, details? }` → `{ ok:true }`
- `GET /api/users/search?q=` → `{ users:[...] }`
- `GET /api/users/suggested` (auth) → recommended accounts (based on mutuals + activity)

## 3. Posts — /api/posts

- `POST /api/posts` (auth) `{ text, media_ids?:[int], poll?:{question, options:[str x2-4]}, location?, section?:"feed"|"buzz", visibility?:"public"|"followers" }` → `{ post }`
  - max 500 chars text; media ≤ 4 images or 1 video; rate limit 30/hr.
- `GET /api/feed/foryou` (auth) `?page` → ranked by recency + engagement (no fake numbers)
- `GET /api/feed/following` (auth) → chronological from followed users
- `GET /api/explore` (auth) → popular posts + suggested users + trending hashtags
- `GET /api/posts/:id` → `{ post }` (404 if deleted/hidden)
- `DELETE /api/posts/:id` (auth owner or admin) → `{ ok:true }`
- `POST /api/posts/:id/like` / `DELETE /api/posts/:id/like` (auth) → `{ liked, likes }`
- `POST /api/posts/:id/repost` (auth) `{ quote_text? }` → `{ post }` (repost or quote wrapper)
- `DELETE /api/posts/:id/repost` (auth) → `{ ok:true }`
- `POST /api/posts/:id/bookmark` / `DELETE ...` (auth) → `{ bookmarked }`
- `GET /api/users/me/bookmarks` (auth) → paginated posts
- `GET /api/users/me/blocked` / `/me/muted` (auth) → users you blocked/muted
- `POST /api/posts/:id/poll/vote` (auth) `{ option_id }` → `{ poll }`
- Comments:
  - `GET /api/posts/:id/comments?page` → `{ items:[{id, author, text, created_at, likes, liked, replies_count, replies?:[top2]}] }`
  - `POST /api/posts/:id/comments` (auth) `{ text, parent_id? }` → `{ comment }`
  - `DELETE /api/comments/:id` (auth owner/admin)
  - `POST /api/comments/:id/like` (auth)
  - `POST /api/comments/:id/like` (auth)
- `GET /api/search?q=&type=all|people|posts|hashtags` → `{ users, posts, hashtags }`
- `GET /api/hashtags/trending` → `[{ tag, posts_count, category }]` (last 48h, real counts)
- `GET /api/hashtags/:tag` → paginated posts

## 4. Naija Pulse — /api/pulse

- `GET /api/pulse` → `{ categories:[{ name, topics:[{tag, posts_count, sample_post?}] }] }`
  Categories: Entertainment, Music, Football, Celebrity gist, Politics & public affairs, Tech, Business, Lifestyle, Memes, General.
  Mapping: hashtags → category via keyword rules in backend (`src/utils/pulse.js`).

## 5. People's Court — /api/court

- `GET /api/court` → paginated cases `{ id, author, question, context, options:[{id,text,votes}], total_votes, my_vote, comments_count, created_at, ends_at }`
- `POST /api/court` (auth) `{ question, context?, options:[2-4 strings], duration_hours?=24 }` → `{ case }`
- `POST /api/court/:id/vote` (auth) `{ option_id }` → `{ options, total_votes }` (one vote, changeable)
- `GET /api/court/:id/comments` / `POST /api/court/:id/comments` (auth) — reuse comment shape.

## 6. Naija Versus — /api/versus

- `GET /api/versus` → paginated battles `{ id, author, title, side_a:{label,image_url?,votes}, side_b:{...}, total_votes, my_side, comments_count, created_at }`
- `POST /api/versus` (auth) `{ title, side_a_label, side_b_label, side_a_image?, side_b_image? }` → `{ battle }`
- `POST /api/versus/:id/vote` (auth) `{ side:"a"|"b" }` → `{ side_a_votes, side_b_votes, total_votes }`
- comments endpoints like court.

## 7. Street Buzz — posts with section=buzz

- `GET /api/buzz?category=events|traffic|announcements|gist&location=` → paginated posts (section=buzz)
- `POST /api/posts` with `section:"buzz"` + `location` creates buzz post.
- `POST /api/posts/:id/report` (auth) `{ reason }` — buzz posts surface report counts to mods.
- Responses include `verified_reporter` if author is verified; unverified reports carry `unverified:true` flag — UI must NOT present them as confirmed facts.

## 8. Uploads — /api/uploads

- `POST /api/uploads` (auth, multipart `file`, optional `kind` hint as field or `?kind=`)
  → `{ id, url, kind, mime, size, duration? }`
  - The server detects `kind` from the file's real mimetype (never trusts the client claim alone).
  - Limits: image 8MB, video 50MB, voice 10MB, file 20MB. Allowed mimes whitelisted.
  - Files served at `/uploads/<file>`.
- `DELETE /api/uploads/:id` (auth owner)

## 9. Messages — /api/conversations + Socket.IO

REST:
- `GET /api/conversations` (auth) → `[{ id, other_user:{user}, last_message, unread_count, updated_at }]`
- `POST /api/conversations` (auth) `{ user_id }` → `{ conversation }` (idempotent)
- `GET /api/conversations/:id/messages?page` (auth member) → newest-first `{ items:[message], has_more }`
- `DELETE /api/conversations/:id` (auth member) → hides for requester
- `POST /api/conversations/:id/read` (auth) → marks read

Message shape: `{ id, conversation_id, sender_id, kind:"text"|"image"|"video"|"voice"|"file", text?, media?, created_at, status:"sent"|"delivered"|"read", deleted }`

Socket.IO (auth via `auth: { token }`):
- client→server: `message:send { conversation_id, kind, text?, media_id? }` → server acks `{ message }`, emits to room `message:new { message }`
- `message:delivered { message_id }`, `message:read { conversation_id }` → emits `message:status { message_id, status }`
- `typing { conversation_id, is_typing }` → `typing { user_id, is_typing }`
- `message:delete { message_id }` → `message:deleted { message_id }`
- presence: server emits `presence { user_id, online }` on connect/disconnect; `GET /api/users/:username/presence` → `{ online, last_seen }` (respects privacy prefs)
- Blocking: sending to someone who blocked you → ack `{ error:"BLOCKED" }`.

**Exact server→client event names** (subscribe to these):
`message:new`, `message:status`, `message:deleted`, `typing`, `presence`,
`notification`, `conversation:read`,
`call:incoming`, `call:accepted`, `call:rejected`, `call:ice`, `call:ended`.
Note: these differ from the client→server names (`call:accept` → server emits `call:accepted`, etc.).

## 10. Calls — Socket.IO signalling + /api/calls

- `POST /api/calls/log` (auth) `{ other_user_id, kind:"voice"|"video", duration_sec, status:"completed"|"missed"|"rejected" }` → `{ ok:true }`
- `GET /api/calls/history` (auth) → paginated call logs with user objects.
- Signalling (rooms `user:{id}`):
  - caller → `call:invite { to_user_id, kind, sdp_offer, call_id }`; callee gets `call:incoming { from_user, kind, sdp_offer, call_id }`
  - callee → `call:accept { call_id, sdp_answer }` / `call:reject { call_id, reason? }` / `call:missed { call_id }` (after 30s no answer, callee client emits; server stores missed-call notification)
  - both → `call:ice { call_id, candidate }`; either → `call:end { call_id }`
  - ICE servers configured client-side: free Google STUN default; TURN via env `TURN_URL/TURN_USER/TURN_PASS` for production (documented).

## 11. Notifications — /api/notifications + socket `notification`

- `GET /api/notifications?page` → `[{ id, type, actor:{user}?, post_id?, text, read, created_at }]`
  types: follow, like, comment, reply, repost, mention, message, call_missed, verification, announcement
- `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` (auth)
- `GET /api/notifications/unread-count` → `{ count }`
- `GET /api/notifications/prefs` / `PATCH /api/notifications/prefs` (auth) — toggles per type + online-status visibility + read-receipts.

## 12. Verification — /api/verification

- `POST /api/verification/apply` (auth) `{ category:"blue"|"gold", statement, links:[url], org_name? }` → `{ application }`
  - one pending application per user; must be verified contact.
- `GET /api/verification/mine` (auth) → `{ application?, history:[] }`
- Badge meaning endpoint: `GET /api/verification/badges` → `{ blue:{...}, gold:{...}, founder:{...} }` (public; UI shows on badge tap)
- Admin routes under /api/admin (below). Badge assignment ONLY via admin approve — no self-assign endpoint exists.

## 13. Admin — /api/admin (requires role admin|founder; founder-only marked ★)

- `GET /api/admin/stats` → `{ users, posts_24h, messages_24h, reports_open, verifications_pending, active_today }`
- `GET /api/admin/users?q=&page&filter=all|suspended|verified` → users + status
- `POST /api/admin/users/:id/suspend { reason }` / `.../restore` → `{ ok:true }` (+ audit log)
- `POST /api/admin/users/:id/revoke-verification { reason }` → `{ ok:true }`
- `POST /api/admin/users/:id/role` ★ `{ role:"admin"|"user" }` — only founder can grant/revoke admin
- `GET /api/admin/verifications?status=pending` → applications with applicant + evidence
- `POST /api/admin/verifications/:id/approve { category }` / `.../reject { note }`
- `GET /api/admin/reports?status=open` → `{ reports:[{id, type:"post"|"user", target, reporter, reason, details, created_at}] }`
- `POST /api/admin/reports/:id/resolve { action:"dismiss"|"remove_content"|"suspend_user"|"warn", note? }`
- `GET /api/admin/activity?page` → audit log entries
- `POST /api/admin/announcements { text, audience? }` / `GET /api/announcements` (public auth)
- `POST /api/admin/posts/:id/sponsor { label }` / `DELETE ...` — marks sponsored
- `GET /api/admin/moderation-queue` → open reports + flagged buzz posts

## 14. Setup (founder bootstrap)

- `POST /api/setup/status` → `{ founder_exists }`
- `POST /api/setup/founder` `{ setup_key, email, password, username, display_name }`
  → creates founder account (verification="founder"), allowed ONLY if no founder exists AND `setup_key === process.env.SETUP_KEY`.
  Never expose SETUP_KEY to the client; it is set as an env var by the deployer.

## Rate limits (server-enforced)
- auth: 20 req / 10 min per IP; OTP verify: 10 / 10 min; resend: 3 / hour per contact
- posts/comments: 30 / hour per user; messages: 120 / hour; follows: 60 / hour; uploads: 20 / hour
- Response on limit: `429 { error:"Too many requests, slow down." }`

## Notes for frontend
- Store JWT in memory + `localStorage` (note XSS care); send `Authorization: Bearer`.
- Socket.IO client: `io({ auth:{ token } })`; reconnect with backoff; queue unsent messages offline and flush on reconnect.
- Media: use `loading="lazy"`, render thumbnails; video uses native `<video controls preload="metadata">`.
- WAVECAST: MediaRecorder → audio/webm; upload with `kind=voice` + `duration` seconds; render orb player (see DESIGN.md).
- WebRTC: RTCPeerConnection with STUN `stun:stun.l.google.com:19302`; TURN from `/api/config` (public endpoint returning `{ ice_servers }` — no secrets exposed; TURN creds are time-limited).
- Never trust client for: verification badges (render from `user.verification` only), admin visibility (server 403s), message status.

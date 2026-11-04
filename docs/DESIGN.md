# Naija Wave — Design System & Frontend Spec

## Brand
- Name: **Naija Wave**. Tagline: *"Ride your wave."*
- Personality: modern, bold, premium, youthful, Nigerian, innovative.
- Logo: an SVG "wave mark" — a bold rounded `N` whose right stroke dissolves into three rising wave bars (like sound waves / ocean waves). Primary electric blue `#2E7CF6`→`#00C2FF` gradient on dark, with a gold `#E8B94A` accent dot at the wave crest. Wordmark: "NAIJA" in white extrabold + "WAVE" in gradient blue. Provide `img/logo.svg` and a compact `img/mark.svg`.

## Tokens
```
--bg0:#05070C (deep black)   --bg1:#0B0F17 (charcoal)   --bg2:#111826 (card)
--bg3:#18202F (raised)       --line:#1E2839 (borders)
--ink:#F2F5FA (primary text) --ink2:#9AA7BD (secondary) --ink3:#5D6B84 (muted)
--blue:#2E7CF6  --blue2:#00C2FF (gradient end)  --blue-dim:rgba(46,124,246,.14)
--gold:#E8B94A  --gold-dim:rgba(232,185,74,.14)
--green:#22C55E --red:#EF4444
--radius:18px (cards) 14px (inputs) 999px (pills/avatars)
--font: "Sora" or system: -apple-system, "Segoe UI", Inter, Roboto... (use Google Fonts Sora + Inter; fall back gracefully offline)
```
- Dark-only interface. Glassy top bars (`backdrop-filter: blur`), soft shadows, 1px hairlines.
- Motion: 180–240ms ease-out transitions; skeleton shimmer for loading; NO heavy parallax. Respect `prefers-reduced-motion`.

## Layout (mobile-first)
- **Mobile (<768px):** top app bar (logo + notification bell + avatar), content feed, bottom tab bar with 5 tabs: Home, Pulse, Messages, Notifications, Profile. "Court", "Versus", "Buzz", "Explore", "Verify", "Settings", "Admin" live in a slide-in side drawer (hamburger) + Explore page hub.
- **Desktop (≥1024px):** left sidebar nav (Home, Explore, Naija Pulse, People's Court, Naija Versus, Street Buzz, Messages, Notifications, Profile, Verification, Settings, Admin-if-authorized), center feed (max 640px), right rail (trending topics, suggested accounts, Naija Pulse mini).
- Tablet: sidebar icons-only.
- All pages responsive; touch targets ≥ 44px; images `loading="lazy"`; long lists virtualized/paginated with "Load more".

## Signature details (identity, not a template)
- Post composer opens with a wave-divider animation.
- "Wave" button (the like) — a small wave glyph that ripples on tap; count animates.
- Verification ticks: custom SVG — blue tick in a blue ring for Blue, gold tick in gold ring for Gold, gold tick + tiny crown-star for Founder. Tapping opens a bottom-sheet explaining the badge (from `/api/verification/badges`).
- Naija Pulse header: animated equalizer bars in category colors.
- Empty states use the wave mark with friendly Naija-flavored copy ("No waves yet — start the tide 🌊").

## Pages / routes (hash router)
`#/welcome` (logged out: hero + login/register tabs), `#/home` (For You / Following tabs), `#/explore`, `#/pulse`, `#/court`, `#/versus`, `#/buzz`, `#/messages`, `#/messages/:id`, `#/notifications`, `#/profile/:username`, `#/settings`, `#/verify`, `#/admin`, `#/post/:id`.

Key screens:
1. **Welcome/Auth:** logo, tagline, Email/Phone toggle, OTP step (6 boxes, auto-advance), username + display name + DOB step, avatar picker (upload or generated gradient). Clear copy: "OTP confirms you control this email/phone — not an ID check."
2. **Home:** composer (text + photo/video + poll toggle), feed tabs, post cards: avatar, name + tick, @username · time, text (linkified hashtags/mentions), media grid (1–4), poll bars (animated %), action row (comment, rewave/repost, wave/like, views?, share, bookmark). Quote/repost rendering nested.
3. **Explore:** search bar (people/posts/hashtags tabs), trending hashtags list, suggested users, popular posts.
4. **Naija Pulse:** category chips → topic cards with post counts + sparkline-ish bar; tap → hashtag feed.
5. **People's Court:** case cards with dilemma text, vote buttons (A/B/C/D), live % bars after voting, comment thread, "ends in Xh".
6. **Naija Versus:** battle cards with two image/label panels and a center "VS" badge; tap side to vote; animated % split bar; comments.
7. **Street Buzz:** category filter + location text; cards with `📍 location`; unverified posts show a subtle "Community report — not confirmed" ribbon; report button prominent.
8. **Messages:** conversation list (avatar, name, snippet, unread dot, online dot), thread view (bubbles, status ticks ✓✓→blue, voice orb messages, image/video/file attachments, date dividers), top bar (avatar, name, online status, call buttons, block/report menu). Composer: text + attach + **WAVECAST button** + send.
9. **WAVECAST (the signature voice experience):**
   - Tapping the wave-orb button opens a full overlay (not a tiny bar): a large circular **sound orb** — layered radial gradients (blue core, gold rim glow) that pulses/scales with live mic amplitude via Web Audio AnalyserNode; concentric waveform rings ripple outward.
   - Live timer (0:00), live waveform strip at the bottom, big red "discard" (X) and gold/blue "preview" flow: stop → preview mode shows the orb smaller + play/pause, scrubber, speed toggle (1x/1.5x/2x), re-record, and **Send wave** button.
   - Max 2:00 per wavecast; gentle haptic-like scale bounce on send.
   - In chat, voice messages render as compact orb players: orb animates while playing, waveform progress, duration, speed toggle.
   - Transcription: if `webkitSpeechRecognition` exists, offer "Transcribe" on preview; otherwise hide the option (never fake it).
   - MediaRecorder with `audio/webm;codecs=opus` fallback chain; handle mic denial with a clear error card.
10. **Calls:** incoming call full-screen overlay (avatar, name, pulsing rings, Accept/Decline); active call screen (remote video large / avatar, local PiP, duration, mute, camera flip, speaker, end). Uses WebRTC (see API.md). Show "Connecting…" states; on failure show plain-language error ("Couldn't connect — check your network").
11. **Notifications:** grouped list with icons; unread highlight; prefs link.
12. **Profile:** cover, avatar, name+tick, @username, bio, location/link, join date, follower counts (tappable lists), tabs (Waves/Replies/Media/Waves liked), Edit profile modal, Follow/Message/Block menu. Founder profile shows "Founder of Naija Wave" gold banner.
13. **Verification centre:** explains Blue/Gold/Founder, application form (category radio, statement textarea, evidence links list, org name if gold), status tracker (pending → approved/rejected + note), history.
14. **Settings:** profile, privacy (who can message: everyone/followed; online status visibility; read receipts), notification prefs, blocked/muted lists, change password, community guidelines, logout, danger zone (deactivate — keep simple: suspend self via support note).
15. **Admin (role-gated, server-enforced):** stat cards, tabs: Users (search, suspend/restore, revoke tick, make admin [founder only]), Verification queue (evidence links, Approve Blue/Approve Gold/Reject + note), Reports (post/user reports with context, actions), Moderation log, Announcements composer, Sponsored posts.

## Accessibility & performance
- Semantic HTML, aria-labels on icon buttons, focus-visible rings, color contrast ≥ 4.5:1 for text.
- All data fetches show skeletons; errors show retry cards with plain language; offline banner when socket disconnects ("You're offline — messages will send when you reconnect").
- Bundle: vanilla JS modules, no framework. Code-split by route (dynamic `import()`). Total first-load JS target < 250KB.

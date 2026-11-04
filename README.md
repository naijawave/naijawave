# 🌊 Naija Wave

**Ride your wave.** A Nigerian social media platform — modern, bold, premium, and
built mobile-first for Naija.

## What's inside

- **Social core:** profiles, For You + Following feeds, text/photo/video posts,
  multi-image uploads, likes ("waves"), comments + replies, reposts + quotes,
  bookmarks, polls, hashtags, trending from *real* activity, search, notifications.
- **Naija originals:** 🇳🇬 **Naija Pulse** (trending by category: Music, Football,
  Gist…), ⚖️ **People's Court** (daily dilemmas, vote + debate), 🆚 **Naija Versus**
  (A-vs-B battles), 📍 **Street Buzz** (local happenings, with anti-misinformation flags).
- **Messaging:** realtime 1:1 chat with delivery/read receipts, typing indicators,
  online status, photo/video/file sharing, block/report, privacy controls.
- **🎙️ WAVECAST:** a signature voice-note experience — animated sound orb that
  reacts to your voice, preview, scrubbing, 1x/1.5x/2x playback, transcription
  where supported. Not a WhatsApp clone.
- **📞 Real voice & video calls:** WebRTC peer-to-peer with in-app signalling,
  incoming call screen, mute/camera/speaker controls, missed-call history.
- **✅ Real verification:** Blue (individuals) and Gold (public figures/brands)
  ticks awarded only by admins after evidence review — plus your Founder badge.
- **🛡️ Founder admin dashboard:** stats, user management, verification queue,
  report triage, moderation log, announcements, sponsored posts. Server-side RBAC.

## Tech (beginner-friendly, free to start)

Node.js + Express + SQLite (`better-sqlite3`) + Socket.IO. One deploy runs
everything — no managed database bill. Upgrade path: SQLite → Postgres when you
outgrow it.

## Run it locally

```bash
npm install
cp .env.example .env   # then set SETUP_KEY + JWT_SECRET to long random values
npm start              # http://localhost:3000
```

Create your founder: open the app → Founder setup (uses `SETUP_KEY`), or
`SETUP_KEY=... node scripts/setup-founder.js you@email.com yourname "Your Name"`.

## Deploy

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — free Render/Fly.io walkthrough,
`render.yaml` one-click blueprint, `Dockerfile` included.

## Docs

- [docs/API.md](docs/API.md) — full API contract
- [docs/DESIGN.md](docs/DESIGN.md) — brand + design system
- [docs/FOUNDER.md](docs/FOUNDER.md) — admin & verification workflow
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting, domains, costs, OTP providers

## Honest limits of v1

- OTP is **dev-mode** (codes in server log) until you plug in Termii/SMTP and set `OTP_MODE=live`.
- Calls use free Google STUN; strict corporate/school networks may need a paid TURN server.
- Voice transcription works in Chromium browsers (Web Speech API); otherwise the button hides.
- No mobile push notifications yet — in-app realtime only. (FCM/APNs is the v2 path.)

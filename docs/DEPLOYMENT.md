# Naija Wave — Deployment Guide

Plain-language guide for a beginner founder. No paid service is used without your say-so.

## What you're deploying

One app that contains everything: the website (frontend), the API (backend),
file uploads, and the realtime server (chat/calls/notifications). The database
is **Postgres** (free Supabase project) — set once via `DATABASE_URL`, and your
data survives redeploys. Deploying once gives you a public link like
`https://naijawave.onrender.com`.

## Database setup (do this once — free)

1. Go to **supabase.com** → sign up (free) → **New project** (pick any name,
   set a database password, choose the closest region).
2. Wait ~2 minutes for the project to provision.
3. Go to **Project Settings → Database** → find **Connection string** → choose
   **URI** → copy it (it looks like `postgresql://postgres.xxx:password@...`).
4. In Render: your service → **Environment** → add `DATABASE_URL` → paste the
   connection string → **Save, rebuild, and deploy**.
5. The app creates all tables automatically on first boot. Your data now
   survives every redeploy.

(Keep the connection string private — it's a password. Never commit it to git.)

## Option A — Render (recommended for starting free) ⭐

1. Push this folder to a GitHub repo (see "Get the code online" below).
2. Go to render.com → **New +** → **Blueprint** → connect your repo.
3. Render reads `render.yaml` and creates the web service.
4. Set up the database (see "Database setup" above) — add `DATABASE_URL` in the
   **Environment** tab.
5. In the service's **Environment** tab, Render auto-generates `SETUP_KEY` and
   `JWT_SECRET`. Copy the `SETUP_KEY` somewhere safe — you need it once to create
   your founder account.
6. Wait for deploy → you get a free link like `https://naijawave.onrender.com`.
7. Create your founder account (see `docs/FOUNDER.md`), then log in.

**Free-tier notes:** Render's free plan sleeps after ~15 min of no traffic — the
first visit after sleep takes ~30–60s to wake. That's fine for testing/launch; the
$7/month Starter plan removes sleeping. Uploads (images/voice notes) still live on
the instance filesystem and reset on redeploy — move uploads to free object
storage (Cloudflare R2) before real users arrive; the database is already safe
on Supabase.

## Option B — Fly.io (also free-ish, better for realtime)

1. Install `flyctl`, run `fly launch` (choose the Dockerfile).
2. `fly volumes create naijawave_data --size 1` and attach it at `/app/data`.
3. `fly secrets set SETUP_KEY=$(openssl rand -hex 32) JWT_SECRET=$(openssl rand -hex 32) OTP_MODE=dev`.
4. `fly deploy` → you get `https://naijawave.fly.dev`.
5. Fly's free allowance covers a small app; the volume keeps your database.

## Option C — VPS (₦ / $5–6/month, most control)

Any VPS (e.g. DigitalOcean, Hetzner): install Node 20, clone the repo,
`npm install`, set env vars, run with `pm2` or systemd, put Caddy/Nginx in front
for HTTPS. Best when you outgrow free tiers.

## The free subdomain names

Checked 2026-11-04 (may change — confirm at signup, it's instant):
- `naijawave.netlify.app` — **looked unclaimed** (Netlify returns 404 for free names).
- `naijawave.vercel.app` — **looked unclaimed**.
- `naijawave.pages.dev` — **did not resolve**, likely unclaimed.

⚠️ Netlify/Vercel/Cloudflare Pages host **static sites only** — Naija Wave needs its
Node backend, so use them only if you later split the frontend off. For now, the
Render/Fly link above is your real Naija Wave address (also free).

## Custom domain later (naijawave.com / .com.ng)

1. Buy the domain from a registrar (Namecheap, WhoGoHost for .com.ng, Cloudflare Registrar).
2. In Render/Fly: add the custom domain → they give you a DNS record.
3. At your registrar, add that record. HTTPS is automatic.
4. `.com` ≈ $10–14/year, `.com.ng` ≈ ₦5,000–15,000/year depending on registrar.

## What costs money vs what stays free

| Needs money (only when you scale) | Free |
|---|---|
| SMS OTP delivery (e.g. Termii ≈ ₦2–4/SMS) | Email OTP via your own SMTP (Gmail free tier) |
| TURN server for calls on strict networks (metered.ca ≈ $0.10/GB) | STUN (free, Google) + direct peer calls |
| Media CDN/storage at scale (Cloudinary/S3) | Local disk uploads (fine to start) |
| Custom domain (~$10–14/yr) | `*.onrender.com` / `*.fly.dev` subdomain |
| Bigger server when you grow | Free tiers above |

**Nothing about Naija Wave's core — posting, messaging, voice notes, calls,
verification — requires payment to use.** Monetisation hooks (sponsored posts,
announcements, promoted accounts) are built in but dormant until you switch them on.

## Going live with real OTP (when you're ready)

`OTP_MODE=dev` (default) prints codes to the server log and returns them in the
register response — for building & testing only. For production:

- **Nigerian SMS:** [Termii](https://termii.com) — sign up, fund wallet, get API key.
  In `src/routes/auth.js`, `issueOtp()` is the ONE place to plug it in (marked with a comment).
- **Email OTP:** any SMTP (Gmail App Password, Resend, Brevo free tier) — same function.
- Then set `OTP_MODE=live` and redeploy. In live mode the API never exposes codes.

## Production checklist

- [ ] `SETUP_KEY` and `JWT_SECRET` are long random values (never commit `.env`)
- [ ] Founder account created, setup closed (it closes automatically)
- [ ] `OTP_MODE=live` with a real provider, or accept dev-mode limits for a private beta
- [ ] Disk/volume attached so `data/` survives restarts
- [ ] Read `docs/FOUNDER.md` for admin & moderation workflow
- [ ] Community Guidelines published (Settings → Guidelines in the app)

## Get the code online

```bash
cd ~/workspace/naija-wave
git init && git add -A && git commit -m "Naija Wave v1"
# create an empty repo on GitHub, then:
git remote add origin https://github.com/YOURNAME/naijawave.git
git push -u origin main
```
(`.gitignore` already excludes `.env`, `node_modules`, `data/`, `uploads/`.)

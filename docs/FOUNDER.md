# Naija Wave — Founder Guide

## Creating your founder account (do this first)

Your account is special: gold "Founder" badge, full admin rights, and the only
account that can grant admin to others. It is created **once**, securely — there is
no default password and nothing is hardcoded.

**Via the app (easiest):**
1. Open your Naija Wave link and go to `#/welcome` → you'll see a "Founder setup"
   option while no founder exists (or visit `/api/setup/status`).
2. Enter your **setup key** (the `SETUP_KEY` env var — Render generates it; check
   the Environment tab), your email, a strong password, username and display name.
3. Done — you're logged in as Founder, and setup closes permanently.

**Via terminal:** `SETUP_KEY=... node scripts/setup-founder.js you@email.com yourname "Your Name"`

## Opening the admin dashboard

Log in, then open **#/admin** (sidebar on desktop, drawer on mobile). If you ever
see "Admin access required", you're not logged in as the founder/admin — the check
is enforced by the server, not hidden by the UI.

## What you can do in the dashboard

- **Stats:** users, posts, messages, open reports, pending verifications, active today.
- **Users:** search, **suspend/restore** accounts, **revoke verification badges**,
  and (founder only) **make someone an admin**.
- **Verification queue:** review each application with its evidence links →
  **Approve Blue**, **Approve Gold**, or **Reject** with a note. The applicant is
  notified automatically. Only you (or your admins) can award badges — there is no
  self-assign, and payment can never buy one.
- **Reports:** review reported posts/accounts → dismiss, remove content, suspend
  the user, or warn. Every action is written to the **moderation log**.
- **Announcements:** broadcast platform-wide (users are notified, respecting mutes).
- **Sponsored:** mark any post as sponsored with a label (monetisation-ready).

## Verification policy (suggested)

- **Blue:** real individuals with a verifiable public presence. Check their links.
- **Gold:** public figures, businesses, brands, organisations — ask for org evidence.
- **Revoke** when an account is sold, impersonates, or repeatedly violates guidelines.
- Never promise verification for payment. Never skip evidence review.

## Safety workflow

1. Reports land in **Reports → Open**. Triage daily at first.
2. For Street Buzz misinformation: remove the post + warn; repeat offenders get suspended.
3. Appeals: a suspended user can contact you (add your support email in Settings →
   Guidelines). Restore from the Users tab.
4. All admin actions are logged under **Activity** — review it weekly.

## Roles

- `founder` — you. Can't be suspended, badge can't be revoked, only you grant admin.
- `admin` — everything except granting admin and touching the founder account.
- `user` — everyone else.

Keep the admin circle tiny. Two people is plenty to start.

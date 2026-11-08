# bart: closed-beta web app

A working version of bart's core trade loop for 20–30 Penn students:
sign up with a Penn email → post an item → browse → send an offer → accept or decline → chat → set a meetup at a Safe Spot → both mark it complete → rate.

It runs in the phone's browser and can be added to the home screen like an app (Share → Add to Home Screen). No App Store needed.

**Stack:** Next.js 15 (the app) · Supabase (sign-in codes, database, photo storage, live chat) · Vercel (hosting). All three have free tiers that cover a closed beta.

---

## 1. Set up Supabase (about 20 minutes, once)

1. Create a free project at [supabase.com](https://supabase.com). Pick the US East region.
2. **SQL Editor → New query.** Paste all of `supabase/migrations/0001_core.sql` and run it. Then do the same for `supabase/migrations/0002_storage_realtime.sql`.
3. **Authentication → Sign In / Providers → Email:**
   - Email provider: on. "Confirm email": on.
   - Email OTP length: **6**.
4. **Authentication → Email Templates.** In both **Magic Link** and **Confirm signup**, replace the body so it sends the code instead of a link:
   ```html
   <h2>Your bart code</h2>
   <p>Enter this code to sign in: <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>
   <p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```
   Subject: `Your bart code`.
5. **Set up your own email sender. Do this before you invite anyone.** Supabase's built-in email is for testing only: it sends a handful of emails an hour and may only deliver to your own team's addresses. Penn's mail filters also tend to quarantine mail from shared senders.
   - Create a free [Resend](https://resend.com) account (3,000 emails a month free).
   - Buy a cheap domain (about $12/year) and verify it in Resend by adding the DNS records it shows you.
   - In Supabase, go to **Authentication → Emails → SMTP Settings**, turn on custom SMTP, and enter Resend's details: host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key, sender like `codes@yourdomain.com`.
   - **Test with five real upenn.edu addresses**, including at least one `@wharton.upenn.edu` or `@seas.upenn.edu` address. If a code lands in quarantine, check the Penn quarantine digest and release it.
6. **Project Settings → API:** copy the Project URL and the `anon` public key for the next step.

## 2. Run it on your laptop

```bash
npm install
cp .env.example .env.local      # then paste the URL and anon key into .env.local
npm run dev                     # open http://localhost:3000
```

To try it on your phone while it runs on your laptop, open `http://<your-laptop-ip>:3000` on the same Wi-Fi.

## 3. Put it online (Vercel)

1. Push this folder to a private GitHub repo.
2. At [vercel.com](https://vercel.com), choose **Add New → Project**, import the repo, and add the two `NEXT_PUBLIC_SUPABASE_*` variables. Then deploy.
3. In Supabase, go to **Authentication → URL Configuration** and set the Site URL to your Vercel address.

Every push to `main` redeploys automatically.

---

## How it fits together

```
src/app/                 one folder per screen
  login/                 sign-up: Penn email → 6-digit code → name + 4 house rules
  page.tsx               home feed: search, category chips, listing grid
  post/                  new listing: photos, banned-word check, category, tier, wants
  item/[id]/             item detail, save (heart), report flag
  item/[id]/offer/       build an offer: pick from your closet, sweeteners, fairness meter, Safe Spot
  item/[id]/report/      anonymous report
  trades/                inbox: Incoming / Sent / Done, accept / decline / cancel
  trades/[id]/           live chat, meetup card, mark complete, 5-star rating
  trades/[id]/meetup/    pick day, daytime slot and Safe Spot
  me/                    profile, stats, my closet, saved items, sign out
src/components/          shared pieces (nav, cards, icons, sign-in gate)
src/lib/trade.ts         product rules: tiers, fairness meter, sweeteners
src/lib/banned.ts        banned-word list (as-you-type check)
supabase/migrations/     database tables, access rules, trade functions
supabase/tests/          access-rule tests
public/brand/            logo files from the brand kit
```

### Where the rules are enforced

The browser can be tampered with, so every rule that matters is also enforced in the database, not just in the screens:

| Rule | Where |
|---|---|
| Only `upenn.edu` addresses (incl. `wharton.`, `seas.`, etc.) can create an account | trigger on sign-up |
| Must agree to the house rules before posting | listing insert policy |
| Banned items can't be posted | trigger on listings, plus the live check on the Post screen |
| Nobody can see emails or phone numbers | they only exist in Supabase's private auth table |
| Only the two people in a trade can see its offer and chat | row-level security |
| Only the owner can accept; only the sender can cancel; items can't be in two trades at once | `respond_offer` function |
| Meetups only at listed Safe Spots, 10 AM to 4 PM Philadelphia time | `set_meetup` function |
| Trade is complete only when both people confirm | `confirm_complete` function |
| Reports are anonymous; 3 reports hide a listing for everyone | reports table + trigger |

### Running the tests

The access-rule tests simulate four students and run 46 checks (who can see, post, offer, accept, chat and report). They need a local Postgres, not Supabase:

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
npm run test:banned
```

---

## Newer features: setup

Run each of these once in the Supabase **SQL Editor**, in order, after 0001–0003:

| File | Adds |
|---|---|
| `0004_counters_chat_photos.sql` | **Counter offers** (Decline / Counter / Accept, back and forth up to 6 times) and **photos in chat** (private: only the two people in the trade can see them) |
| `0005_handoff_codes.sql` | **Finishing a trade in person.** One person taps *Show my code* (a QR code plus 4 digits, valid 10 minutes). The other scans it with their phone camera or types the digits. After 5 wrong tries the code locks and a new one is needed. |
| `0006_lock_listings_in_trades.sql` | Owners can **edit their listings**, but not once an item is in a trade |
| `0007_campus_feed.sql` | The **Campus tab**: share a finished trade to the feed, likes, comments, **Trade of the Week** (most likes since Monday, ties go to the earlier post), and the **ISO board** ("I have this" points to an item in your closet; only the person who posted sees who answered) |
| `0008_notifications.sql` | **Notifications**: number badges on the Campus, Trades and Me tabs, a dot on trades with something new, and an Activity list behind the bell on Home. Created by the database for offers, counters, answers, messages, meetups, finished trades, likes, comments, ISO answers, and saved items being traded or taken down. Repeats collapse into one. |
| `0009_safety.sql` | **Keeping sexual content out.** Sexual words are blocked everywhere (chat, comments, names, notes, listings), including disguises like "s3xy" or "nuuudes". Phones can no longer upload photos directly: every photo goes through the server, which checks it with AI first (see below). Adds **Report chat** (flag in the chat header) and a **Chats** section on the Reports screen where reviewers read the conversation and delete messages. |

Then run `npm install` again (the QR code feature added a package).

**AI fairness check (optional).** On the offer and counter screens, "Ask AI if this is fair" sends both sides' titles, details and first photos to Claude and shows a one-line second opinion. It never blocks an offer. To turn it on:
1. Create an API key at [console.anthropic.com](https://console.anthropic.com) and add a few dollars of credit. Each check costs a fraction of a cent.
2. Add it to `.env.local` (and to Vercel's Environment Variables): `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart `npm run dev`.

Without a key, the button simply doesn't appear. The key stays on the server and never reaches anyone's phone.

### Photo safety check (required for photos)

After running `0009_safety.sql`, photos only work once the server has two keys. Add both to `.env.local` (and to Vercel's Environment Variables), then restart `npm run dev`:

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_SERVICE_ROLE_KEY=...
```

- `ANTHROPIC_API_KEY`: from [console.anthropic.com](https://console.anthropic.com). The same key turns on the AI fairness check. Each photo check costs a fraction of a cent.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → the **service_role** key (or **Secret key**). This key can do anything in your database, so it must only ever go in `.env.local` and Vercel, never in a file whose name starts with `NEXT_PUBLIC_`, never in GitHub, never in a text to anyone.

If either key is missing, photo uploads are switched off rather than allowed through unchecked. Blocked attempts are recorded; see who has tried with:
```sql
select p.first_name, b.kind, b.category, b.created_at from photo_blocks b join profiles p on p.id = b.user_id order by b.created_at desc;
```

To add more blocked words (for example slurs), add rows to `banned_terms` with `everywhere = true`, and the same words to `EVERYWHERE` in `src/lib/banned.ts`.

## Running the beta

**Reviewing reports.** Run `supabase/migrations/0003_report_review.sql` in the SQL Editor once. Then make each teammate a reviewer (after they've signed up in the app):
```sql
insert into reviewers (user_id) select id from auth.users where email = 'them@wharton.upenn.edu';
```
Reviewers see **Review reports** on their Me tab. Each reported listing shows its photos, description, who posted it, every reason and note, and whether that person has been reported before, with **Keep it up** and **Take it down** buttons. Reporters stay anonymous, even to reviewers.

**Changing the Safe Spots.** Edit the `safe_spots` table in the Table Editor. The app picks up changes automatically.

**Changing the banned list.** Update both places, or the screen and the database will disagree:
- the `banned_terms` table (this is what actually blocks posts)
- `src/lib/banned.ts` (this is the as-you-type warning)

**Seeing how it's going.** Run these in the SQL Editor for the milestone numbers:
```sql
select count(*) from profiles where rules_accepted_at is not null;   -- signed up
select count(*) from listings where status <> 'removed';             -- listings
select status, count(*) from offers group by status;                 -- offers by outcome
```

---

## Decisions I made that you should check

- **Name at sign-up.** The spec shows "Jordan L." on item pages but never collects a name, so step 3 asks for a first name and last initial. Names never appear on feed cards.
- **6 PM is off.** The spec allows 6 PM, but in Philadelphia it's dark by about 5 PM from November to February. Slots run 10 AM to 4 PM. If you want 6 PM back in spring, change it in `set_meetup` (SQL) and `SLOTS` (meetup page).
- **Banned words match whole words.** The spec says "substring," but substring matching blocks "in*credible* condition" (edible) and "be*gun*". Whole words plus plurals fixes that, and "vapes" and "answer keys" are still caught.
- **"Ask" before an offer isn't there yet.** Chat lives inside a trade, which keeps all messages tied to a real offer and easy to moderate.
- **Skill counts as M** on the fairness meter, and the meter compares against the item you're asking for (the spec's example only covered M).
- **No walking times on cards.** Walking times need people's locations, which the beta doesn't collect. Safe Spots still show walking times.
- **Fridge shows a lamp icon** when there's no photo, because placeholder icons go by category (Dorm = lamp). Photos replace them.

## Deliberately not built yet

Perfect matches, the campus map, the challenge bar, badges, streaks, notifications and push, phone verification, blocking users, reporting a chat photo, and calendar invites (a Google Calendar link is there instead).

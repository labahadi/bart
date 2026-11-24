<p align="center">
  <img src="public/brand/bart-logo-dog.png" alt="bart" height="72">
</p>

<h3 align="center">You're broke. So is everyone else.</h3>

<p align="center">
  A trading app for college students. No money, just swaps.<br>
  <a href="https://bart-penn.vercel.app"><b>bart-penn.vercel.app</b></a> · in closed beta at Penn
</p>

---

## Why we built this

Every college student has a closet full of stuff they don't use: the textbook from last semester, the mini fridge you won't need next year, the blazer you wore to one interview. They also have a list of things they need and can't really afford.

Selling is a hassle and buying is expensive. So we skipped the money. On bart you post what you have, find what you want, and swap with another student on campus. Skills count too: an hour of Python help can be worth a vintage jacket.

We also wanted it to feel like a campus thing, not a marketplace. So there's a feed of finished trades, a Trade of the Week voted by likes, and a board where people post what they're looking for.

## How a trade works

1. **Sign up with your school email.** Only verified students get in (Penn for now).
2. **Add things to your closet.** Snap a photo, pick a size (S, M or L) and say what you'd take for it.
3. **Find something you want**, or check **Wanted** to see who's looking for something you already have.
4. **Make an offer.** Pick from your closet, add a sweetener ("+ a coffee"), and an optional fairness meter tells you if it's a reasonable deal.
5. **Chat and set a meetup** at a public spot on campus. It can go straight into your Google Calendar.
6. **Swap in person**, confirm with a 4-digit code, and rate each other.
7. **Share it to the Campus feed** if you're proud of the deal.

## What's inside

| | |
|---|---|
| **Closet and profile** | Your listings, saved items, finished trades and rating in one place |
| **Find and Wanted** | Search everything up for trade, or answer "looking for" posts that match your closet |
| **Offers and counters** | Back-and-forth counter offers, with an AI second opinion on whether a trade is fair |
| **Live chat** | Real-time messages and photos, private to the two people in the trade |
| **Meetups** | Pick a place on Google Maps (limited to campus), propose a time, confirm, add to Calendar |
| **Campus feed** | Finished trades, likes, comments and Trade of the Week |
| **Notifications** | In-app activity plus push notifications, with quiet hours |
| **Works like an app** | A web app you can add to your home screen. No App Store needed |

## Safety is part of the design

Trading with strangers only works if people feel safe, so most of our time went here.

- **Verified students only.** Accounts need a school email, checked by the database itself.
- **No contact info, ever.** Emails and phone numbers are never shown. Chats are tied to a real trade.
- **Every photo is checked** by an AI model on the server before anyone can see it. Uploads switch off rather than go through unchecked.
- **Text filters** catch banned items, slurs and disguised spellings everywhere, plus an AI check for things a word list misses.
- **Meetups stay public and on campus**, during daytime hours, within the next two weeks.
- **Anonymous reports, blocking and account pauses**, with a review screen for our moderators.

The browser can be tampered with, so every rule that matters is enforced in the database too, not just on the screen. Access rules are covered by automated tests that act out four students trying to see, post, offer and chat where they shouldn't.

## Built with

| | |
|---|---|
| **App** | Next.js 15, React 19, TypeScript |
| **Backend** | Supabase: Postgres with row-level security, email sign-in codes, storage, real-time chat |
| **AI** | Claude for photo checks, text checks and the fairness meter |
| **Maps and calendar** | Google Places, Routes and Calendar (free/busy only, never event details) |
| **Hosting** | Vercel, with web push notifications |

```
src/app/              one folder per screen, plus api/ for server routes
src/components/       shared pieces: nav, cards, icons, sign-in gate
src/lib/              trade rules, fairness meter, word filters, campus boundary
supabase/migrations/  tables, access rules and trade logic, in order
supabase/tests/       access-rule tests
```

## Run it yourself

```bash
npm install
cp .env.example .env.local   # add your Supabase URL and key
npm run dev                  # http://localhost:3000
```

You'll need a free Supabase project first. The full guide, including email codes, deploying to Vercel and the optional AI, Maps, Calendar and push features, is in [docs/SETUP.md](docs/SETUP.md).

## Where it's at

bart is in a closed beta with a small group of Penn students. We're watching how people actually trade, fixing what's confusing, and figuring out what it takes to bring it to other campuses.

If you're a student and want in, or you have an idea, open an issue or reach out to one of us.

## Who we are

A few Penn students who got tired of buying things we'd only need for a semester.

- **Naishu Vytla**, Penn Engineering
- **Elana Hadi**, Wharton

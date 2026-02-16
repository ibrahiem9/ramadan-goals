# Ramadan Goals

A mobile-first app for tracking Ramadan goals, daily check-ins, and progress trends with local persistence.

## Running locally

Start a local server from the project directory:

```bash
python3 -m http.server 3000
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

No build step or dependencies required. The app runs entirely in the browser using React loaded from a CDN.

## Supabase setup (Circle sharing v1)

Circle sharing + reactions require Supabase configuration.

1. Create a Supabase project.
2. Run the SQL script in `supabase/friend-sharing-v1.sql` in the Supabase SQL editor.
3. Set your project values in `index.html` under `window.__APP_CONFIG__`:

```js
window.__APP_CONFIG__ = {
  SUPABASE_URL: "https://<project-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<anon-key>"
};
```

Without these values, the app still runs local-only goal tracking, and Circle backend features stay disabled.

## Ramadan date source setup

Ramadan dates are now user-selectable and can be resolved from:

- Global API (AlAdhan)
- Location-based API (city + country)
- Manual start/end dates

### Optional runtime config

Set these in `window.__APP_CONFIG__` in `index.html` to prefill defaults:

```js
window.__APP_CONFIG__ = {
  SUPABASE_URL: "https://<project-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<anon-key>",
  RAMADAN_DEFAULT_CITY: "Riyadh",
  RAMADAN_DEFAULT_COUNTRY: "Saudi Arabia",
  ALADHAN_BASE_URL: "https://api.aladhan.com/v1"
};
```

If API resolution fails, the app requires manual date entry before continuing.

## Features

- **Onboarding** — enter your name and pick from goal templates or create custom goals
- **Today** — one-tap daily check-ins with animated progress rings
- **Progress** — overall completion rate, 30-day heatmap (tap any day to view/edit), per-goal streaks
- **Settings** — edit display name, reset all data, view app info (gear icon in Today header)
- **Circle** — private invite-only sharing with aggregate goal progress and emoji reactions (Supabase-backed)

Without Supabase config, data is stored in your browser localStorage only. With Supabase configured, social sharing data and synced goals/check-ins are persisted in Postgres.

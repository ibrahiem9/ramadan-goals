# Ramadan Goals

A mobile-first app for tracking Ramadan goals, daily check-ins, and progress trends with local persistence.

## Running locally

Start a local server from the project directory:

```bash
python3 -m http.server 3000
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

No build step or dependencies required. The app runs entirely in the browser using React loaded from a CDN.

## Features

- **Onboarding** — enter your name and pick from goal templates or create custom goals
- **Today** — one-tap daily check-ins with animated progress rings
- **Progress** — overall completion rate, 30-day heatmap (tap any day to view/edit), per-goal streaks
- **Settings** — edit display name, reset all data, view app info (gear icon in Today header)
- **Circle** — group creation and leaderboard preview (prototype)

All data is stored in your browser's localStorage.

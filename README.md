# SEO Dashboard

Self-hosted SEO dashboard for tracking multiple websites. Built with Node.js, Express, SQLite, and Chart.js.

## Features

- **Keyword Rank Tracking** — Track Google positions over time with inverted-axis charts
- **Rising & Falling Keywords** — Auto-detect week-over-week movers
- **Keyword Discovery** — Find related keywords via DataForSEO
- **SERP Snapshots** — See who ranks in the top 10 for each keyword
- **AI Visibility Tracker** — Framework to track if AI mentions your site
- **Cost Tracker** — Monitor every API call and set budget alerts
- **Scheduled Jobs** — Automated daily/weekly data collection via cron

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:3456](http://localhost:3456)

The SQLite database auto-creates on first run, pre-seeded with OPTCG Market and its keywords.

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3)
- **Frontend:** Single-page HTML/JS/CSS (dark theme)
- **Charts:** Chart.js
- **API:** DataForSEO (credentials configurable in Settings)

## Configuration

All settings are configurable from the Settings page:

- DataForSEO API credentials
- Cron schedules for rank checks, discovery, AI visibility
- Monthly budget alerts
- Add/remove sites and keywords

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sites` | List all sites |
| POST | `/api/sites` | Add a site |
| GET | `/api/sites/:id/keywords` | List keywords for a site |
| GET | `/api/sites/:id/ranks` | Get rank data for a site |
| GET | `/api/sites/:id/movers` | Get rising/falling keywords |
| GET | `/api/sites/:id/suggestions` | Get keyword suggestions |
| GET | `/api/keywords/:id/history` | Rank history for a keyword |
| GET | `/api/keywords/:id/serp` | Latest SERP snapshot |
| POST | `/api/keywords/:id/check` | Check rank for a single keyword |
| POST | `/api/run/rank-check` | Run all rank checks now |
| POST | `/api/run/discovery` | Run keyword discovery now |
| GET | `/api/costs` | Cost tracker data |
| GET/PUT | `/api/settings` | View/update settings |

## Cost Management

Every DataForSEO API call is logged with its cost. The dashboard tracks daily, weekly, monthly, and all-time spending with budget alerts. Raw API responses are cached in the database to avoid redundant calls.

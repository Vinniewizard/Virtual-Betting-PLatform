# Betting Server

TypeScript-based betting backend with:
- Engine.IO realtime game events and actions
- User registration/login (bcrypt + JWT)
- Multiple games: Aviator (crash), Dice, Roulette, Blackjack, Baccarat, Teen Patti, Mines, Plinko, HiLo, and more. Card games support interactive sessions (hit/stand, bet choices).
- Wallet operations (deposit/withdraw) and transaction history
- Live chat with profanity filter + rate limiting
- Leaderboard endpoint
- Admin APIs for user listing, balance updates, status updates, and audit logs
- Browser test client at `/test-client.html`

## Requirements

- Node.js 22+ (uses `node:sqlite`)
- npm

## Setup

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

Server starts on `http://localhost:3001` by default.

Open the test client:

```text
http://localhost:3001/test-client.html
```

## Run (production-style)

```bash
npm run build
npm start
```

## Test

```bash
npm test
```

This runs end-to-end integration tests that validate:
- HTTP health/root/leaderboard/script routes
- websocket register/login/deposit/withdraw/chat flow
- transaction retrieval
- seeded admin login and admin endpoints

## Smoke Check

```bash
npm run smoke
```

This runs a lightweight local verification:
- starts the server on an ephemeral port
- checks `/health`
- checks Engine.IO handshake
- validates realtime socket open/close

## Environment Variables

- `PORT` (default: `3001`)
- `JWT_SECRET` (default fallback exists, set this in real deployments)
- `DB_FILE` (default: `betting.db`)
- `MAX_BODY_SIZE_BYTES` (default: `102400`)
- `SEED_ADMIN_USERNAME` (optional)
- `SEED_ADMIN_PASSWORD` (optional, required with username)
- `SEED_ADMIN_BALANCE` (optional, default: `10000`)

If both `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` are set, an admin account is created once at startup if it does not already exist.

For production-oriented defaults, use:

```bash
cp .env.production.example .env
```

## Core HTTP Endpoints

- `GET /` server info
- `GET /health` health status
- `GET /gamestate` current round state
- `GET /leaderboard` top balances
- `GET /transactions/me` (auth required)
- `GET /admin/users` (admin token required)
- `POST /admin/balance` (admin token required)
- `POST /admin/user-status` (admin token required)
- `GET /admin/logs` (admin token required)

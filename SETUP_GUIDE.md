# Betting Server - Complete Setup & Run Guide

## System Overview

This is a **realtime multiplayer betting platform** built with:
- **Backend**: Node.js + TypeScript + Engine.IO (WebSocket/polling)
- **Database**: SQLite3 (in-memory + file-based)
- **Games**: Aviator, Dice, Mines, Plinko, HiLo
- **Admin Features**: User management, risk settings, balance adjustments, audit logs
- **Frontend**: Single-page HTML client with live chat, leaderboard, tournament support

---

## Prerequisites

### Required
- **Node.js 22+** (uses native `node:sqlite`)
- **npm 10+**
- **Linux/Mac/Windows** with bash or zsh

### Optional
- **SQLite3 CLI** (for database inspection)
- **curl** or **Postman** (for API testing)

---

## Installation Steps

### 1. Clone & Install Dependencies

```bash
cd /home/wizard/Desktop/Project/betting_server
npm install
```

This installs:
- `typescript`, `ts-node` (development)
- `engine.io` (realtime WebSocket)
- `bcryptjs` (password hashing)
- `jsonwebtoken` (JWT auth)
- `better-sqlite3` (synchronous SQLite)

### 2. Create `.env` File (Optional)

```bash
cat > .env << EOF
PORT=3001
JWT_SECRET=your-super-secret-key-change-me-in-production
DB_FILE=betting.db
MAX_BODY_SIZE_BYTES=102400
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin123
SEED_ADMIN_BALANCE=10000
EOF
```

**Important**: In production, use strong values for `JWT_SECRET`.

---

## Running the Server

### Option A: Development Mode (Recommended for Testing)

```bash
npm run dev
```

**Output:**
```
> betting_server@1.0.0 dev
> ts-node index.ts
Seeding admin user: admin
Server running on http://localhost:3001
Engine.IO listening at /engine.io
```

**Features:**
- Hot reload (restarts on file changes via ts-node)
- Full TypeScript source maps
- Debug logging enabled

### Option B: Production Mode

```bash
# Step 1: Compile TypeScript
npm run build

# Step 2: Start the compiled version
npm start
```

**Output:**
```
> betting_server@1.0.0 start
> node dist/index.js
Seeding admin user: admin
Server running on http://localhost:3001
```

---

## Accessing the Application

### Test Client (Browser)

Open in any modern browser:
```
http://localhost:3001/test-client.html
```

**Default Test Account:**
- **Username:** `admin`
- **Password:** `admin123`
- **Role:** Admin (can modify user balances, risk settings, send messages)

### Create a Player Account

1. Click **"Register"** on the login panel
2. Enter username and password
3. Click **Register**
4. Login with your credentials
5. Deposit funds to start betting

### API Endpoints

#### Public
- `GET /` – Server info
- `GET /health` – Health check
- `GET /gamestate` – Current game state
- `GET /leaderboard` – Top 10 by balance

#### Authenticated (JWT Required)
- `GET /transactions/me` – Your transaction history
- `POST /deposit` – Add funds (WebSocket)
- `POST /withdraw` – Remove funds (WebSocket)

#### Admin Only
- `GET /admin/users` – List all users
- `POST /admin/balance` – Update user balance
- `POST /admin/user-status` – Ban/freeze accounts
- `GET /admin/logs` – View audit trail
- `GET /admin/risk-settings` – View game limits
- `POST /admin/risk-settings` – Update game limits

---

## Testing

### Run Integration Tests

```bash
npm test
```

**Tests validate:**
- HTTP routes (health, gamestate, leaderboard)
- WebSocket registration/login flow
- Deposit/withdraw transactions
- Admin endpoints
- Profanity filter
- Rate limiting
- Game mechanics

### Run Smoke Test (Quick Check)

```bash
npm run smoke
```

**Checks:**
- Server startup
- Health endpoint
- Engine.IO handshake
- Socket open/close

---

## Troubleshooting

### Issue: "Port 3001 already in use"

**Solution:**
```bash
# Kill existing process
lsof -i :3001 | grep node | awk '{print $2}' | xargs kill -9

# Or use a different port
PORT=3002 npm run dev
```

### Issue: "TypeScript compilation error"

**Solution:**
```bash
# Clear and rebuild
rm -rf dist
npm run build
npm start
```

### Issue: "Cannot find module 'engine.io-client'"

**Solution:**
```bash
npm install
npm run build
```

### Issue: WebSocket stuck at "Connecting..."

**Solution:**
1. Open browser DevTools (F12)
2. Check Console for errors
3. Try refreshing the page
4. Ensure server is running: `curl http://localhost:3001/health`

### Issue: Admin login fails

**Solution:**
```bash
# Check if admin was seeded
sqlite3 betting.db "SELECT username, role FROM users WHERE username='admin';"

# If missing, re-run with SEED_ADMIN_USERNAME set
SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin123 npm run dev
```

---

## Database

### Inspect Database

```bash
sqlite3 betting.db

# View tables
.tables

# Check users
SELECT id, username, role, balance FROM users;

# Check bets
SELECT id, userId, gameType, amount, status FROM bets LIMIT 10;

# Exit
.exit
```

### Reset Database

```bash
# Backup first
cp betting.db betting.db.backup

# Delete and restart (creates fresh DB)
rm betting.db
npm run dev
```

---

## Project Structure

```
betting_server/
├── index.ts              # Main server (routes, websocket handlers)
├── game.ts               # Game logic (Aviator, Dice, Mines, Plinko, HiLo)
├── database.ts           # SQLite wrapper and queries
├── types.ts              # TypeScript interfaces
├── declarations.d.ts     # Global type definitions
├── test-client.html      # Browser UI (single file, 4000+ lines)
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── dist/                 # Compiled JavaScript (after `npm run build`)
├── tests/
│   ├── integration.test.js    # Full E2E tests
│   └── smoke.js               # Quick validation
└── README.md             # Quick reference
```

---

## Performance Tips

1. **Increase DB workers** for high concurrency:
   ```bash
   SQLITE_THREADS=4 npm run dev
   ```

2. **Enable compression** in production (add `Accept-Encoding` middleware)

3. **Use CDN** for static assets (engine.io.js)

4. **Monitor memory**: 
   ```bash
   node --max-old-space-size=2048 dist/index.js
   ```

---

## Security Checklist (Production)

- [ ] Set strong `JWT_SECRET` in `.env`
- [ ] Use HTTPS/WSS in production
- [ ] Enable CORS if using separate frontend domain
- [ ] Rate-limit login attempts
- [ ] Hash admin credentials in database
- [ ] Regularly audit admin logs
- [ ] Enable database encryption if storing sensitive data
- [ ] Use environment variables (never hardcode secrets)

---

## Common Workflows

### Add a New Admin

```bash
# Via admin API
curl -X POST http://localhost:3001/admin/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newadmin",
    "password": "secure-password",
    "role": "admin"
  }'
```

### Update Risk Settings

```bash
curl -X POST http://localhost:3001/admin/risk-settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "minBet": 1,
    "maxBet": 500,
    "maintenanceMode": false,
    "gamePaused": false
  }'
```

### View Admin Audit Log

```bash
curl http://localhost:3001/admin/logs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Support & Debugging

### Enable Verbose Logging

```bash
# Add to index.ts
const DEBUG_MODE = true;

// Then check console output
npm run dev
```

### Check Network Traffic

```bash
# In browser DevTools:
1. Network tab → Filter by WebSocket
2. Look for engine.io messages
3. Inspect payload and response
```

### Common WebSocket Messages

- `REGISTER` – Create account
- `LOGIN` – Authenticate
- `PLACE_BET` – Start game
- `CASH_OUT` – Exit game
- `CHAT_MESSAGE` – Send message
- `ADMIN_SEND_DM` – Admin to player message
- `PROVABLY_FAIR_REVEAL` – Game fairness commit/reveal

---

## Next Steps

1. ✅ Start server: `npm run dev`
2. ✅ Open client: `http://localhost:3001/test-client.html`
3. ✅ Create account and deposit
4. ✅ Play a game (Aviator, Dice, etc.)
5. ✅ Check leaderboard and chat
6. ✅ Admin: View logs and manage users

Enjoy! 🎮

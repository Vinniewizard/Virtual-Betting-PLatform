# Complete System Overview & Run Instructions

## 🎮 What is This?

A **realtime multiplayer betting platform** with WebSocket support, 5 playable games, admin dashboard, and comprehensive user management.

**Built with:** Node.js + TypeScript + SQLite + Engine.IO

---

## ⚡ Quick Start (5 Minutes)

### Option 1: Automated Start Script (Recommended)

```bash
cd /home/wizard/Desktop/Project/betting_server
bash start.sh
```

This will:
1. ✅ Check Node.js version
2. ✅ Install dependencies
3. ✅ Build TypeScript
4. ✅ Create `.env` if missing
5. ✅ Stop any existing process on port 3001
6. ✅ Start the server
7. ✅ Verify it's running

Then open browser:
```
http://localhost:3001/test-client.html
```

**Login credentials:**
- Username: `admin`
- Password: `admin123`

---

### Option 2: Manual Start

```bash
# 1. Install dependencies
cd /home/wizard/Desktop/Project/betting_server
npm install

# 2. Build
npm run build

# 3. Start production server
npm start

# 4. Open in browser
# http://localhost:3001/test-client.html
```

---

### Option 3: Development Mode (Hot Reload)

```bash
npm run dev
```

Auto-restarts on file changes.

---

## 📚 Complete Documentation

### For Setup & Installation
→ See **`SETUP_GUIDE.md`**
- Detailed prerequisites
- Installation steps
- Environment variables
- Running options (dev/prod)
- Troubleshooting

### For System Improvements & Recommendations
→ See **`IMPROVEMENTS.md`**
- What works well
- Recommended fixes
- Performance optimizations
- Security hardening
- Next phase roadmap

### For Quick Reference
→ See **`README.md`**
- Project overview
- API endpoints
- Run commands

---

## 🎯 What You Can Do

### 1. **Create Account**
- Register new player account
- Set username & password
- Automatic account created in database

### 2. **Play Games**
Choose from 5 games:
- **Aviator** - Classic crash game with multiplier
- **Dice** - Roll over/under prediction
- **Mines** - Tile-revealing game with hazards
- **Plinko** - Drop balls down pegs
- **HiLo** - Higher/lower card prediction

### 3. **Manage Wallet**
- Deposit virtual funds
- Place bets
- Withdraw winnings
- View transaction history

### 4. **Social Features**
- Live chat with other players
- See leaderboard (top earners)
- Join tournaments
- Receive direct messages

### 5. **Admin Functions** (if logged in as admin)
- View all users
- Modify user balances
- Ban/freeze accounts
- Change game limits (min/max bet)
- View audit logs
- Send direct messages to players

---

## 🔐 Test Accounts

### Admin Account
```
Username: admin
Password: admin123
Role: Admin (full access)
```

### Create Player Account
1. Click "Register" on login screen
2. Enter username & password
3. Start with balance: $100 (can deposit more)

---

## 📊 System Architecture

```
┌─────────────────────────────────────────┐
│   Browser Client (test-client.html)     │
│   - Games UI                             │
│   - Chat, Leaderboard                    │
│   - Wallet, Account                      │
└────────────┬────────────────────────────┘
             │ WebSocket / HTTP
             ↓
┌─────────────────────────────────────────┐
│   Node.js Server (index.ts)              │
│   - Engine.IO (realtime)                 │
│   - REST API endpoints                   │
│   - Authentication (JWT)                 │
│   - Game logic                           │
└────────────┬────────────────────────────┘
             │ SQL
             ↓
┌─────────────────────────────────────────┐
│   SQLite Database (betting.db)           │
│   - Users, Bets, Transactions            │
│   - Chat, Admin Logs                     │
└─────────────────────────────────────────┘
```

---

## 🚀 Deployment Options

### Local Development
```bash
npm run dev
```
- Hot reload
- Source maps
- Full logging

### Local Production
```bash
npm run build
npm start
```
- Optimized
- No hot reload
- Ready for testing

### Docker (Recommended for Production)
```dockerfile
FROM node:22
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

Then:
```bash
docker build -t betting-server .
docker run -p 3001:3001 betting-server
```

### Cloud Deployment (Heroku, Railway, Render)
```bash
# Already has package.json scripts
# Just set environment variables and deploy
```

---

## ✅ Verification Checklist

After starting the server, verify:

### 1. Health Check
```bash
curl http://localhost:3001/health
```
Should return: `{"status":"ok"}`

### 2. Game State
```bash
curl http://localhost:3001/gamestate
```
Should return current round info

### 3. Leaderboard
```bash
curl http://localhost:3001/leaderboard
```
Should return top 10 users

### 4. Browser Client
Open: `http://localhost:3001/test-client.html`
Should see:
- Login panel
- Game switcher (Aviator, Dice, etc.)
- Control deck (left panel)
- Chat box (right panel)
- Realtime status (should say "Connected")

---

## 🔧 Configuration

### Environment Variables

**Development (.env):**
```env
PORT=3001
JWT_SECRET=dev-secret
DB_FILE=betting.db
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin123
```

**Production (.env):**
```env
PORT=3001
NODE_ENV=production
JWT_SECRET=<generate-with-crypto>
DB_FILE=/var/lib/betting/betting.db
LOG_LEVEL=WARN
MAINTENANCE_MODE=false
```

Generate secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📖 API Examples

### Register User
```bash
curl -X POST http://localhost:3001/test-client.html \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"pass123"}'
```

### Get Leaderboard
```bash
curl http://localhost:3001/leaderboard
```

### Admin: Update Balance
```bash
curl -X POST http://localhost:3001/admin/balance \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-id","amount":500}'
```

---

## 🐛 Troubleshooting

### Server Won't Start
```bash
# Check port is free
lsof -i :3001

# Kill existing process
lsof -i :3001 | grep node | awk '{print $2}' | xargs kill -9

# Try different port
PORT=3002 npm start
```

### "Cannot find module" Error
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### WebSocket Connection Issues
1. Check browser console (F12)
2. Verify server is running: `curl http://localhost:3001/health`
3. Try refreshing the page
4. Check firewall settings

### Database Lock
```bash
rm betting.db
npm start  # Creates fresh database
```

---

## 📞 Support

1. **Read Documentation**
   - SETUP_GUIDE.md - Installation & setup
   - IMPROVEMENTS.md - Architecture & recommendations
   - README.md - Quick reference

2. **Check Logs**
   ```bash
   npm run dev  # See console output
   ```

3. **Test with Script**
   ```bash
   npm test
   npm run smoke
   ```

4. **Debug in Browser**
   - Open DevTools (F12)
   - Console tab → see logs
   - Network tab → check WebSocket
   - Application tab → check localStorage

---

## 🎓 Learning Path

1. **Day 1:** Run the system (this guide)
2. **Day 2:** Explore SETUP_GUIDE.md & API endpoints
3. **Day 3:** Review IMPROVEMENTS.md for architecture
4. **Day 4:** Examine source code:
   - `index.ts` - Main server logic
   - `game.ts` - Game mechanics
   - `database.ts` - Data layer
   - `test-client.html` - Frontend UI
5. **Day 5:** Run tests and try modifications

---

## 🚀 Next Steps

### Immediate
1. ✅ Run the server
2. ✅ Create test account
3. ✅ Play a game
4. ✅ View leaderboard

### Short Term
1. Read SETUP_GUIDE.md
2. Run integration tests: `npm test`
3. Review API endpoints
4. Test admin features

### Long Term
1. Review IMPROVEMENTS.md recommendations
2. Implement suggested enhancements
3. Add custom game logic
4. Deploy to production

---

## 💡 Pro Tips

1. **Multiple Games at Once**
   - Different browser tabs work independently
   - Chat is shared across tabs

2. **Admin Testing**
   - Use admin account to modify balances
   - Test user status changes (freeze/ban)
   - View audit logs of all actions

3. **Database Inspection**
   ```bash
   sqlite3 betting.db
   SELECT * FROM users LIMIT 5;
   .exit
   ```

4. **Performance Testing**
   ```bash
   npm run smoke  # Quick health check
   npm test       # Full integration test
   ```

5. **Development Workflow**
   ```bash
   npm run dev    # Terminal 1
   # In another terminal:
   curl http://localhost:3001/health  # Quick test
   ```

---

## 📋 Quick Command Reference

| Command | Purpose |
|---------|---------|
| `bash start.sh` | Automated setup & start |
| `npm install` | Install dependencies |
| `npm run dev` | Development mode (hot reload) |
| `npm run build` | Compile TypeScript |
| `npm start` | Production mode |
| `npm test` | Run integration tests |
| `npm run smoke` | Quick health check |
| `curl http://localhost:3001/health` | Test server is alive |

---

## 📝 Files Created

1. **SETUP_GUIDE.md** - Complete installation & configuration guide
2. **IMPROVEMENTS.md** - Architecture review & recommendations
3. **start.sh** - Automated start script
4. **QUICKSTART.md** - This file

---

**Ready to start?**

```bash
bash /home/wizard/Desktop/Project/betting_server/start.sh
```

Then open: `http://localhost:3001/test-client.html`

Enjoy! 🎮🎯

# Admin Panel Quick Reference Guide

## Tab Navigation
| Tab | Icon | Features |
|-----|------|----------|
| Dashboard | 📊 | System stats, house balance, user counts |
| Users | 👥 | User list, search, moderation, active users |
| Risk | ⚙️ | Betting limits, game control, maintenance mode |
| Tournaments | 🏆 | Create tournaments, adjust scores |
| Broadcast | 📢 | System alerts, direct messages to players |

## Dashboard (📊)
**What you see:**
- ✅ Active Users (green card)
- 📊 Total Users (blue card)
- 🚫 Banned Accounts (red card)
- ❄️ Frozen Accounts (orange card)
- 🏠 House Account Balance

**Actions:**
- 🔄 Refresh - Update stats

---

## Users Tab (👥)

### User Search
```
📝 Search bar → type username → instant results
[Search users...]  ↻ Reload
```

### User List Display
Each user shows:
```
👑 Username
Role: admin | Balance: $X,XXX.XX
[✅ ACTIVE / ❄️ FROZEN / 🚫 BANNED]
```

### Account Moderation
```
1. Enter username in moderation section
2. Select status: ✅ Active / ❄️ Frozen / 🚫 Banned
3. Click Update button
```

### Active Users Online
Shows users currently connected (green dot 🟢)

---

## Risk Tab (⚙️)

### Betting Limits
```
Minimum Bet: [____] $
Maximum Bet: [____] $
[Apply Changes]
```

### System Status
```
☐ Game Status    (pause all games)
☐ Maintenance Mode (admin-only access)
```

### Game Controls
```
Select Game: [Aviator ▼]
[💥 Force Crash]
```

---

## Tournaments Tab (🏆)

### Adjust Tournament Score
```
Tournament ID: [________________]
User ID:       [________________]
New Score:     [________________]
[Update]
```

### Create New Tournament
```
Tournament Name:    [________________]
Game Type:          [Aviator ▼]
Start Time:         [2026-03-11T10:00]
End Time:           [2026-03-11T18:00]
Prize Pool:         [____] $
Entry Fee:          [____] $
[Create]
```

---

## Broadcast Tab (📢)

### Send System Alert
```
Title:    [____________________]
Message:  [________________________]
          [________________________]
          [________________________]
Type:     [ℹ️ Info ▼]
[Send Alert]
```

**Alert Types:**
- ℹ️ Info - Blue notification
- ⚠️ Warning - Yellow alert
- ✅ Success - Green notification
- ❌ Error - Red critical alert

### Send Direct Message
```
Username: [____________________]
Message:  [________________________]
          [________________________]
[Send DM]
```

---

## Common Tasks

### Ban a Player
1. Click 👥 Users
2. Search for username
3. Enter username in moderation
4. Select "🚫 Banned"
5. Click Update
6. Player loses all access

### Pause Games
1. Click ⚙️ Risk
2. Toggle "Game Status" ON
3. All bets suspended
4. Players see "Games Paused" message

### Create Tournament
1. Click 🏆 Tournaments
2. Fill in tournament details
3. Select game type (10 options)
4. Set start/end times
5. Enter prize pool & entry fee
6. Click Create
7. Tournament goes live

### Alert All Players
1. Click 📢 Broadcast
2. Write title and message
3. Select alert type (⚠️ recommended for urgent)
4. Click Send Alert
5. Notification appears for all online players

### Message Specific Player
1. Click 📢 Broadcast
2. Enter their username
3. Write message
4. Click Send DM
5. They receive private notification

---

## Status Meanings

| Status | Emoji | Meaning | Effect |
|--------|-------|---------|--------|
| Active | ✅ | Normal access | Can play, bet, chat |
| Frozen | ❄️ | Temporary ban | Can't bet or play, can login |
| Banned | 🚫 | Permanent ban | Complete account lockout |

---

## Keyboard Shortcuts (Future)
*Coming soon:* - Alt+1: Dashboard
- Alt+2: Users
- Alt+3: Risk
- Alt+4: Tournaments
- Alt+5: Broadcast

---

## Tips & Tricks

### 💡 Search Tip
Just type a username fragment:
- "vin" matches "Vinniewizard", "VinnyUser"
- "user" matches "User123", "SuperUser"
- Case-insensitive search

### 💡 Batch Updates
- To freeze multiple users: do individually (coming: bulk update)
- Use moderation carefully: effects are immediate

### 💡 Tournament Best Practices
1. Set reasonable entry fees ($5-$20)
2. Prize pool should be 3-5x total entries
3. Give at least 24 hours before start
4. Use moderate difficulty games for new players

### 💡 Alerts Strategy
- Use ℹ️ Info for announcements
- Use ⚠️ Warning for urgent notices
- Use ✅ Success for positive news
- Use ❌ Error for critical issues only

### 💡 Game Pause Best Practices
- Pause during maintenance only
- Notify players 5 minutes before
- Keep paused time under 1 hour
- Resume promptly to avoid losing players

---

## Statistics Guide

**Active Users**: Currently connected right now
**Total Users**: Registered accounts total
**Banned**: Permanently locked accounts
**Frozen**: Temporarily suspended accounts

---

## Color Legend
- 🟢 Green: Online, Active, Success
- 🔵 Blue: Primary, Info
- 🟠 Orange: Warning, Frozen
- 🔴 Red: Danger, Banned
- 🟣 Purple: Secondary info

---

## Support
All admin actions are logged for audit purposes. Check admin logs for history of changes.

Last Updated: March 11, 2026
Admin Panel Version: 2.0 (Redesigned)

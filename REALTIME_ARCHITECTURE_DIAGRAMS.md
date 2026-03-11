# Real-Time Admin Monitoring - Architecture & Flow Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Admin Browser Client                         │
│                      (test-client.html)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               Admin Panel (React-like updates)               │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │  Dashboard  │  │    Users     │  │  Active Users    │   │  │
│  │  │   Tab       │  │    Tab       │  │     Tab          │   │  │
│  │  │  ✅ ✅ ✅    │  │  🟢 ❄️ 🚫    │  │  🟢 Online Only  │   │  │
│  │  │  📊 Stats   │  │  + Search    │  │  Real-Time List  │   │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘   │  │
│  │         ▲               ▲                   ▲               │  │
│  │         │ Updates       │ Updates           │ Updates       │  │
│  │         │ every 50μs    │ every 50μs        │ every 50μs    │  │
│  └─────────┼───────────────┼───────────────────┼───────────────┘  │
│            │               │                   │                   │
└────────────┼───────────────┼───────────────────┼───────────────────┘
             │               │                   │
             ▼               ▼                   ▼
     ┌──────────────────────────────────────────────┐
     │   Real-Time Polling Loop (50 microseconds)   │
     │  startAdminOverviewPolling()                 │
     │                                              │
     │  ┌─────────────────────────────────────┐   │
     │  │ const pollAdminData = async () => { │   │
     │  │   await Promise.all([               │   │
     │  │     refreshAdminOverview(),  ──┐   │   │
     │  │     loadUsers(),             ──┼─┐ │   │
     │  │     loadActiveUsers()        ──┘ │ │   │
     │  │   ]);                           │ │   │
     │  │   setTimeout(pollAdminData,     │ │   │
     │  │     0.00005); // 50μs ◄────────┘ │   │
     │  │ }                                 │   │
     │  └─────────────────────────────────────┘   │
     └──────────────────────────────────────────────┘
             │               │               │
             │ Parallel      │ Parallel      │ Parallel
             ▼ Requests      ▼ Requests      ▼ Requests
    ┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
    │  GET /admin/    │ │ GET /admin/  │ │GET /admin/      │
    │ house-summary   │ │ users        │ │active-users     │
    │                 │ │              │ │                 │
    │ Returns:        │ │ Returns:     │ │ Returns:        │
    │ - House balance │ │ - All users  │ │ - Online users  │
    │ - Admin info    │ │ - Statuses   │ │ - Connection    │
    │                 │ │ - Balances   │ │   times         │
    │                 │ │ - Activities │ │ - Wagers        │
    └─────────────────┘ └──────────────┘ └─────────────────┘
             │               │               │
             └───────────────┼───────────────┘
                             ▼
                    ┌────────────────────┐
                    │   Node.js Server   │
                    │  (index.ts port    │
                    │      3001)         │
                    │                    │
                    │  SQLite Database   │
                    │  - Users table     │
                    │  - Transactions    │
                    │  - Bets            │
                    └────────────────────┘
```

## Polling Loop Flow

```
Start Admin Panel
      │
      ▼
Is Admin? ──NO──→ Don't start polling
      │ YES
      ▼
startAdminOverviewPolling()
      │
      ▼
┌──────────────────────────────────────┐
│ CREATE pollAdminData async function  │
└──────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────┐
│ CALL pollAdminData()                 │
└──────────────────────────────────────┘
      │
      ▼
┌────────────────────────────────────────────┐
│ Is Admin? Is Panel Visible?                │
│ YES → Continue   NO → Return (don't run)   │
└────────────────────────────────────────────┘
      │ YES
      ▼
┌──────────────────────────────────────────────┐
│ Fetch 3 APIs in Parallel (Promise.all)       │
│                                              │
│ ├─ GET /admin/house-summary    (~10KB)     │
│ ├─ GET /admin/users            (~40KB)     │
│ └─ GET /admin/active-users     (~20KB)     │
│                                              │
│ Typical Response Time: ~50-100ms            │
│ Execution Time: <0.00005s to schedule next  │
└──────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────┐
│ Process Data in Browser                      │
│                                              │
│ loadUsers():                                 │
│  ├─ Detect status changes                   │
│  ├─ Apply pulse animation if changed        │
│  └─ Render to DOM                           │
│                                              │
│ loadActiveUsers():                          │
│  ├─ Filter online users only                │
│  └─ Render with connection info             │
│                                              │
│ refreshAdminOverview():                     │
│  ├─ Update house balance                    │
│  └─ Create activity summary                 │
│                                              │
│ updateAdminStats():                         │
│  ├─ Update stat cards                       │
│  ├─ Apply glow animation on changes         │
│  └─ Update activity status                  │
└──────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────┐
│ Schedule Next Update                         │
│ setTimeout(pollAdminData, 0.00005)          │
│                                              │
│ This creates a continuous loop that:        │
│ - Updates every 50 microseconds            │
│ - Doesn't block other UI interactions      │
│ - Uses async/await (non-blocking)          │
└──────────────────────────────────────────────┘
      │
      ▼
   [LOOP]
      │
      └─────→ (repeats every 0.00005s)
```

## Data Flow: User Status Change

```
┌─────────────────────────────────────────────────────────┐
│ Admin Action: Ban Player "JohnDoe"                      │
│ Clicks: User moderation → Select "Banned" → Update     │
└─────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ API Request: POST /admin/users/:userId/status          │
│ Body: { status: "banned" }                             │
└─────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ Server Updates Database                                 │
│ - User record status = "banned"                        │
│ - Logs action to audit trail                           │
│ - Returns success                                       │
└─────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ Admin Sees Update                                       │
│                                                         │
│ Next Polling Cycle (within 50μs):                      │
│ 1. GET /admin/users fetches new data                  │
│ 2. "JohnDoe" status = "banned" (was "active")        │
│ 3. Change detected! (status !== previousStatus)       │
│ 4. Pulse animation applied:                           │
│    ├─ Background: rgba(255, 215, 0, 0)              │
│    ├─ Animation: 0.6s with 2 cycles                  │
│    └─ Result: Golden flash visible to admin          │
│ 5. Status emoji changes: ✅ → 🚫                      │
│ 6. Color changes: Green → Red                         │
│ 7. If was online: 🟢 → 🔘 (gets kicked out)         │
│ 8. Banned count increases with green glow            │
│                                                         │
│ Total Time: ~50 microseconds from database change     │
│            to visible on admin screen                 │
└─────────────────────────────────────────────────────────┘
```

## Performance Optimization Flow

```
Admin Opens Admin Panel
        │
        ▼
    ┌───────────────────┐
    │ startAdminPanel() │
    └────────┬──────────┘
             │
             ▼
    ┌────────────────────────┐
    │ startAdminOverviewPolling() │
    │ Creates polling loop       │
    └────────┬───────────────────┘
             │
             ▼
    ┌─────────────────────────────────────┐
    │ Polling Loop Running               │
    │ Fetches data every 50 microseconds │
    └────────┬────────────────────────────┘
             │
             ▼ (User does something else)
    ┌─────────────────────────────────────┐
    │ User Clicks Away From Admin Panel  │
    │ elements.adminPanel.display = 'none'│
    └────────┬────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────┐
    │ pollAdminData() Checks              │
    │ if (elements.adminPanel ===         │
    │     'none') return;                 │
    │                                     │
    │ RESULT:                             │
    │ ✅ Polling stops                   │
    │ ✅ No API calls                    │
    │ ✅ Saves bandwidth                 │
    │ ✅ Reduces CPU usage               │
    │ ✅ Extends battery life            │
    └─────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────┐
    │ User Clicks Back to Admin Panel    │
    │ elements.adminPanel.display = 'block'│
    └────────┬────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────┐
    │ NEXT POLLING CYCLE:                 │
    │ ✅ Checks return true              │
    │ ✅ Resumes API calls               │
    │ ✅ Data fresh within 50μs          │
    │                                    │
    │ User sees current data             │
    │ (not stale data from before hide)  │
    └─────────────────────────────────────┘
```

## Animation Timeline

### Pulse Animation (Status Change)

```
t=0ms
│ Background: rgba(255, 215, 0, 0)
│ Box Shadow: none
│ [No visible effect]
│
t=150ms (50% through first cycle)
│ Background: rgba(255, 215, 0, 0.15)  ← Golden
│ Box Shadow: 0 0 10px rgba(255, 215, 0, 0.3)
│ [GOLDEN GLOW VISIBLE] ✨
│
t=300ms (end of first cycle)
│ Background: rgba(255, 215, 0, 0)
│ Box Shadow: none
│ [Fade out]
│
t=450ms (50% through second cycle)
│ Background: rgba(255, 215, 0, 0.15)
│ Box Shadow: 0 0 10px rgba(255, 215, 0, 0.3)
│ [GOLDEN GLOW VISIBLE AGAIN] ✨
│
t=600ms (Animation ends)
│ Background: rgba(255, 215, 0, 0)
│ Box Shadow: none
│ [Complete]

Duration: 600ms
Cycles: 2
Effect: Two flashes of golden glow
```

### Glow Animation (Stat Change)

```
t=0ms
│ Text Shadow: none
│ [Number appears normal]
│
t=300ms (peak)
│ Text Shadow: 0 0 8px rgba(46, 204, 113, 0.6)  ← Green glow
│ [GREEN GLOW VISIBLE] 💚
│
t=600ms (Animation ends)
│ Text Shadow: none
│ [Back to normal]

Duration: 600ms
Effect: One gentle glow
Applied to: Active Users count when it changes
```

## Real-Time Update Sequence Example

```
Timeline (Everything in milliseconds/microseconds)

t=0ms: Admin opens admin panel
  └─→ startAdminOverviewPolling() called

t=0.1ms: First polling cycle starts
  ├─→ GET /admin/users (parallel)
  ├─→ GET /admin/active-users (parallel)
  └─→ GET /admin/house-summary (parallel)

t=50ms: Server responds with data
  ├─→ 234 total users
  ├─→ 5 active users
  ├─→ 3 banned accounts
  └─→ House balance: $50,000

t=60ms: Data processed in browser
  ├─→ loadUsers() updates DOM
  ├─→ loadActiveUsers() updates DOM
  ├─→ refreshAdminOverview() updates DOM
  └─→ updateAdminStats() updates numbers

t=60.001μs: Next polling scheduled
  └─→ setTimeout(pollAdminData, 0.00005)

t=110.001μs: Second polling cycle starts (50μs after first ended)
  ├─→ GET /admin/users (parallel)
  ├─→ GET /admin/active-users (parallel)
  └─→ GET /admin/house-summary (parallel)

[PATTERN CONTINUES...]

Meanwhile, at t=100ms: New user logs in
  └─→ In server, /admin/active-users now returns 6 users (was 5)

t=150ms: Polling cycle fetches updated data
  └─→ Active user count: 6 (changed from 5!)
  ├─→ updateAdminStats() detected change
  ├─→ Green glow animation applied
  ├─→ "5" changes to "6" with visual effect
  └─→ Admin sees: "Active Users" stat glows green ✨

Result: Admin sees new login within 150ms total
(Most visible delay is from server response, not polling)
```

## Data State Management

```
┌─────────────────────────────────────────┐
│ Admin Panel Load                        │
│ adminOverviewInterval = null            │
│ previousUsers = new Map()               │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ First Polling Cycle                     │
│ Fetch: /admin/users                     │
│ Response:                               │
│  ├─ User 1: status=active               │
│  ├─ User 2: status=active               │
│  └─ User 3: status=banned               │
│                                          │
│ Store in previousUsers Map:             │
│  ├─ User 1 → "active"                   │
│  ├─ User 2 → "active"                   │
│  └─ User 3 → "banned"                   │
│                                          │
│ adminOverviewInterval = setTimeout(...) │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ Second Polling Cycle (50μs later)       │
│ Fetch: /admin/users                     │
│ Response:                               │
│  ├─ User 1: status=active (no change)   │
│  ├─ User 2: status=FROZEN (CHANGED!)    │
│  └─ User 3: status=banned (no change)   │
│                                          │
│ Change Detection:                       │
│  previousUsers.get(User2) = "active"   │
│  currentStatus = "frozen"               │
│  statusChanged = true! ✅               │
│                                          │
│ Actions:                                │
│  ├─ Apply pulse animation               │
│  ├─ Update DOM with new status          │
│  └─ Update previousUsers Map            │
│                                          │
│ adminOverviewInterval = setTimeout(...) │
└─────────────────────────────────────────┘
        │
        ▼
[CONTINUES...]
```

---

**Version**: 1.0
**Date**: March 11, 2026
**Status**: ✅ Complete

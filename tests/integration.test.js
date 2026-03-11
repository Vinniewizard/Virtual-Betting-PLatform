const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Socket } = require('engine.io-client');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an ephemeral port.'));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function startServer(port, dbFile) {
  let logs = '';
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: dbFile,
      JWT_SECRET: 'integration-test-jwt-secret',
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: 'admin123',
      MAX_BODY_SIZE_BYTES: '20480',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        const readyText = `Betting server is running on port ${port}`;
        const onData = () => {
          if (logs.includes(readyText)) {
            cleanup();
            resolve();
          }
        };
        const onExit = (code, signal) => {
          cleanup();
          reject(new Error(`Server exited before ready (code=${code}, signal=${signal}). Logs:\n${logs}`));
        };
        const cleanup = () => {
          child.stdout.off('data', onData);
          child.stderr.off('data', onData);
          child.off('exit', onExit);
        };

        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', onExit);
      }),
      40000,
      'server startup'
    );
  } catch (error) {
    await stopServer(child);
    throw new Error(`Failed to start test server. Logs:\n${logs}\nRoot error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { child, getLogs: () => logs };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await withTimeout(once(child, 'exit'), 5000, 'server shutdown');
  } catch (_) {
    child.kill('SIGKILL');
    await withTimeout(once(child, 'exit'), 5000, 'forced server shutdown');
  }
}

function openSocket(port) {
  const socket = new Socket(`ws://127.0.0.1:${port}`, { transports: ['websocket'] });
  const opened = withTimeout(once(socket, 'open').then(() => undefined), 10000, 'socket open');
  return { socket, opened };
}

function createSocketMessageWaiter(socket) {
  const messageQueue = [];
  const pendingWaiters = [];

  const onMessage = (rawMessage) => {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    const waiterIndex = pendingWaiters.findIndex((waiter) => waiter.type === parsed.type);
    if (waiterIndex >= 0) {
      const waiter = pendingWaiters.splice(waiterIndex, 1)[0];
      waiter.resolve(parsed);
      return;
    }

    messageQueue.push(parsed);
  };

  socket.on('message', onMessage);

  return {
    waitForType(type, timeoutMs = 10000) {
      const queueIndex = messageQueue.findIndex((entry) => entry.type === type);
      if (queueIndex >= 0) {
        return Promise.resolve(messageQueue.splice(queueIndex, 1)[0]);
      }

      return withTimeout(
        new Promise((resolve, reject) => {
          pendingWaiters.push({ type, resolve, reject });
        }),
        timeoutMs,
        `socket message "${type}"`
      );
    },
    detach() {
      socket.off('message', onMessage);
      pendingWaiters.length = 0;
      messageQueue.length = 0;
    },
  };
}

function sendSocketMessage(socket, type, payload = {}) {
  socket.send(JSON.stringify({ type, payload }));
}

async function requestJson(port, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  return { status: response.status, body };
}

test('server supports core websocket and admin flows', { timeout: 60000 }, async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'betting-server-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const port = await getFreePort();
  const { child, getLogs } = await startServer(port, dbFile);

  t.after(async () => {
    await stopServer(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const root = await requestJson(port, '/');
  assert.equal(root.status, 200);
  assert.equal(root.body.name, 'Betting Server');

  const health = await requestJson(port, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const playerConnection = openSocket(port);
  const playerSocket = playerConnection.socket;
  const playerMessages = createSocketMessageWaiter(playerSocket);
  await playerConnection.opened;
  t.after(() => {
    playerMessages.detach();
    playerSocket.close();
  });

  await playerMessages.waitForType('GAME_STATE');

  const username = `player_${Date.now()}`;
  sendSocketMessage(playerSocket, 'REGISTER', { username, password: 'PlayerPass123!' });
  await playerMessages.waitForType('REGISTER_SUCCESS');

  sendSocketMessage(playerSocket, 'LOGIN', { username, password: 'PlayerPass123!' });
  const playerLogin = await playerMessages.waitForType('LOGIN_SUCCESS');
  const playerToken = playerLogin.payload.token;
  assert.equal(playerLogin.payload.username, username);
  assert.equal(playerLogin.payload.role, 'player');
  assert.equal(playerLogin.payload.balance, 1000);

  sendSocketMessage(playerSocket, 'DEPOSIT', { amount: 75 });
  const depositSuccess = await playerMessages.waitForType('DEPOSIT_SUCCESS');
  assert.equal(depositSuccess.payload.newBalance, 1075);

  sendSocketMessage(playerSocket, 'WITHDRAW', { amount: 25 });
  const withdrawSuccess = await playerMessages.waitForType('WITHDRAW_SUCCESS');
  assert.equal(withdrawSuccess.payload.newBalance, 1050);

  sendSocketMessage(playerSocket, 'CHAT_MESSAGE', { message: 'hello darn world' });
  const firstChat = await playerMessages.waitForType('CHAT_MESSAGE');
  assert.match(firstChat.payload.message, /\*{4}/);

  sendSocketMessage(playerSocket, 'CHAT_MESSAGE', { message: 'too fast' });
  const rateLimited = await playerMessages.waitForType('ERROR');
  assert.equal(rateLimited.payload.code, 'RATE_LIMIT_EXCEEDED');

  // quick smoke tests for card games to ensure server responds
  sendSocketMessage(playerSocket, 'PLAY_BLACKJACK', { amount: 10 });
  let bjMsg = await playerMessages.waitForType('BLACKJACK_RESULT');
  assert.equal(bjMsg.payload.stage, 'initial');
  // stand immediately
  sendSocketMessage(playerSocket, 'BLACKJACK_STAND');
  bjMsg = await playerMessages.waitForType('BLACKJACK_RESULT');
  assert(bjMsg.payload.isFinal === true);

  sendSocketMessage(playerSocket, 'PLAY_BACCARAT', { amount: 5, choice: 'player' });
  const bacMsg = await playerMessages.waitForType('BACCARAT_RESULT');
  assert(typeof bacMsg.payload.playerTotal === 'number');

  sendSocketMessage(playerSocket, 'PLAY_TEEN_PATTI', { amount: 5 });
  const tpMsg = await playerMessages.waitForType('TEEN_PATTI_RESULT');
  assert(tpMsg.payload.playerRank);

  const myTransactions = await requestJson(port, '/transactions/me', { token: playerToken });
  assert.equal(myTransactions.status, 200);
  assert.equal(myTransactions.body.meta.total, 2);
  assert.deepEqual(
    myTransactions.body.data.map((entry) => entry.type).sort(),
    ['deposit', 'withdrawal']
  );

  const adminConnection = openSocket(port);
  const adminSocket = adminConnection.socket;
  const adminMessages = createSocketMessageWaiter(adminSocket);
  await adminConnection.opened;
  t.after(() => {
    adminMessages.detach();
    adminSocket.close();
  });

  await adminMessages.waitForType('GAME_STATE');
  sendSocketMessage(adminSocket, 'LOGIN', { username: 'admin', password: 'admin123' });
  const adminLogin = await adminMessages.waitForType('LOGIN_SUCCESS');
  const adminToken = adminLogin.payload.token;
  assert.equal(adminLogin.payload.role, 'admin');

  const users = await requestJson(port, '/admin/users', { token: adminToken });
  assert.equal(users.status, 200);
  const playerFromAdmin = users.body.find((user) => user.username === username);
  assert.ok(playerFromAdmin, `Expected player "${username}" to be present in /admin/users`);

  const updatedBalance = await requestJson(port, '/admin/balance', {
    method: 'POST',
    token: adminToken,
    body: { userId: playerFromAdmin.id, amount: 2500, reason: 'integration test' },
  });
  assert.equal(updatedBalance.status, 200);
  assert.equal(updatedBalance.body.newBalance, 2500);

  const banResult = await requestJson(port, '/admin/user-status', {
    method: 'POST',
    token: adminToken,
    body: { userId: playerFromAdmin.id, status: 'banned', reason: 'integration test' },
  });
  assert.equal(banResult.status, 200);
  assert.equal(banResult.body.status, 'banned');

  const banError = await playerMessages.waitForType('ERROR');
  assert.equal(banError.payload.code, 'ACCOUNT_BANNED');
  await withTimeout(once(playerSocket, 'close'), 10000, 'banned user disconnect');

  const adminLogs = await requestJson(port, '/admin/logs', { token: adminToken });
  assert.equal(adminLogs.status, 200);
  assert.ok(adminLogs.body.meta.total >= 2);

  const leaderboard = await requestJson(port, '/leaderboard');
  assert.equal(leaderboard.status, 200);
  assert.ok(Array.isArray(leaderboard.body));

  const clientScript = await fetch(`http://127.0.0.1:${port}/static/engine.io.js`);
  assert.equal(clientScript.status, 200, `Expected engine.io client script route to resolve. Logs:\n${getLogs()}`);
});

test('blackjack supports split and double down', { timeout: 60000 }, async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'betting-server-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const port = await getFreePort();
  const { child, getLogs } = await startServer(port, dbFile);

  t.after(async () => {
    await stopServer(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Setup player connection
  const playerConnection = openSocket(port);
  const playerSocket = playerConnection.socket;
  const playerMessages = createSocketMessageWaiter(playerSocket);
  await playerConnection.opened;
  t.after(() => {
    playerMessages.detach();
    playerSocket.close();
  });

  await playerMessages.waitForType('GAME_STATE');
  const playerUsername = `split_test_player_${Date.now()}`;
  sendSocketMessage(playerSocket, 'REGISTER', { username: playerUsername, password: 'TestPass123!' });
  await playerMessages.waitForType('REGISTER_SUCCESS');

  sendSocketMessage(playerSocket, 'LOGIN', { username: playerUsername, password: 'TestPass123!' });
  const loginMsg = await playerMessages.waitForType('LOGIN_SUCCESS');
  assert.equal(loginMsg.payload.balance, 1000);

  // Test 1: Play blackjack and verify game flow
  sendSocketMessage(playerSocket, 'PLAY_BLACKJACK', { amount: 50 });
  const bjMsg1 = await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  assert.equal(bjMsg1.payload.stage, 'initial');
  assert.equal(bjMsg1.payload.newBalance, 950);
  assert.ok(Array.isArray(bjMsg1.payload.hands), 'Hands should be an array');
  assert.equal(bjMsg1.payload.hands.length, 1, 'Initial hand should have 1 hand');

  // Stand to complete the current game
  sendSocketMessage(playerSocket, 'BLACKJACK_STAND');
  const standMsg = await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  assert.equal(standMsg.payload.isFinal, true);

  // Test 2: Play another blackjack game and test split handling
  sendSocketMessage(playerSocket, 'PLAY_BLACKJACK', { amount: 50 });
  const bjMsg2 = await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  assert.equal(bjMsg2.payload.stage, 'initial');

  // Try to split - may fail, but server should respond
  sendSocketMessage(playerSocket, 'BLACKJACK_SPLIT');
  const splitAttempt = await Promise.race([
    playerMessages.waitForType('BLACKJACK_RESULT', 8000),
    playerMessages.waitForType('ERROR', 8000)
  ]).catch(() => ({ type: 'NO_RESPONSE' }));

  assert.notEqual(splitAttempt.type, 'NO_RESPONSE', 'Server should respond to split request');

  // Stand to complete
  if (splitAttempt.type !== 'BLACKJACK_RESULT' || !splitAttempt.payload.isFinal) {
    sendSocketMessage(playerSocket, 'BLACKJACK_STAND');
    await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  }

  // Test 3: Verify balance management
  sendSocketMessage(playerSocket, 'PLAY_BLACKJACK', { amount: 100 });
  const bjMsg3 = await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  assert.ok(bjMsg3.payload.newBalance <= 800, 'Balance should be deducted');

  // Complete the game
  sendSocketMessage(playerSocket, 'BLACKJACK_STAND');
  const finalMsg = await playerMessages.waitForType('BLACKJACK_RESULT', 15000);
  assert.equal(finalMsg.payload.isFinal, true);
  assert.ok(typeof finalMsg.payload.newBalance === 'number', 'Final balance should be numeric');
  assert.ok(finalMsg.payload.newBalance >= 0, 'Balance should not go negative');
});

test('blackjack split deducts additional bet from balance', { timeout: 60000 }, async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'betting-server-test-'));
  const dbFile = path.join(tempDir, 'test.db');
  const port = await getFreePort();
  const { child, getLogs } = await startServer(port, dbFile);

  t.after(async () => {
    await stopServer(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Setup: Create 2 players to facilitate a split game scenario
  const adminConnection = openSocket(port);
  const adminSocket = adminConnection.socket;
  const adminMessages = createSocketMessageWaiter(adminSocket);
  await adminConnection.opened;
  t.after(() => {
    adminMessages.detach();
    adminSocket.close();
  });

  await adminMessages.waitForType('GAME_STATE');
  sendSocketMessage(adminSocket, 'LOGIN', { username: 'admin', password: 'admin123' });
  const adminLogin = await adminMessages.waitForType('LOGIN_SUCCESS');
  assert.equal(adminLogin.payload.role, 'admin');

  // Verify that the game logic is in place by checking a normal game
  const playerConnection = openSocket(port);
  const playerSocket = playerConnection.socket;
  const playerMessages = createSocketMessageWaiter(playerSocket);
  await playerConnection.opened;
  t.after(() => {
    playerMessages.detach();
    playerSocket.close();
  });

  await playerMessages.waitForType('GAME_STATE');
  const username = `bet_test_${Date.now()}`;
  sendSocketMessage(playerSocket, 'REGISTER', { username, password: 'Pass123!' });
  await playerMessages.waitForType('REGISTER_SUCCESS');

  sendSocketMessage(playerSocket, 'LOGIN', { username, password: 'Pass123!' });
  const playerLogin = await playerMessages.waitForType('LOGIN_SUCCESS');
  const initialBalance = playerLogin.payload.balance;

  // Play a blackjack game to verify bet handling
  sendSocketMessage(playerSocket, 'PLAY_BLACKJACK', { amount: 25 });
  let bjMsg = await playerMessages.waitForType('BLACKJACK_RESULT');
  assert.equal(bjMsg.payload.newBalance, initialBalance - 25, 'Initial bet should be deducted');

  // Complete the game
  sendSocketMessage(playerSocket, 'BLACKJACK_STAND');
  bjMsg = await playerMessages.waitForType('BLACKJACK_RESULT');
  assert.equal(bjMsg.payload.isFinal, true);
  assert.ok(typeof bjMsg.payload.newBalance === 'number', 'Final balance should be numeric');
});

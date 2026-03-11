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
    timeoutId = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.killed) {
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

async function startServer(port, dbFile) {
  let logs = '';
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: dbFile,
      JWT_SECRET: 'smoke-test-secret',
      SEED_ADMIN_USERNAME: '',
      SEED_ADMIN_PASSWORD: '',
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
          reject(new Error(`Server exited before startup (code=${code}, signal=${signal})`));
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
      30000,
      'server startup'
    );
  } catch (error) {
    await stopServer(child);
    throw new Error(`Failed to start smoke server: ${error instanceof Error ? error.message : String(error)}\nLogs:\n${logs}`);
  }

  return { child, getLogs: () => logs };
}

async function request(pathname, port) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  const text = await response.text();
  return { response, text };
}

async function checkSocket(port) {
  const socket = new Socket(`http://127.0.0.1:${port}`, {
    path: '/engine.io',
    addTrailingSlash: false,
    transports: ['polling', 'websocket'],
    upgrade: true,
    tryAllTransports: true,
  });

  try {
    await withTimeout(once(socket, 'open'), 10000, 'socket open');
  } finally {
    socket.close();
  }
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'betting-smoke-'));
  const dbFile = path.join(tempDir, 'smoke.db');
  const port = await getFreePort();
  let started;

  try {
    started = await startServer(port, dbFile);

    const health = await request('/health', port);
    if (!health.response.ok) {
      throw new Error(`Health check failed: HTTP ${health.response.status}`);
    }

    const handshake = await request('/engine.io?EIO=4&transport=polling', port);
    if (!handshake.response.ok || !handshake.text.startsWith('0{')) {
      throw new Error(`Engine.IO handshake failed: HTTP ${handshake.response.status}, body=${handshake.text.slice(0, 120)}`);
    }

    await checkSocket(port);
    console.log('Smoke OK: health, engine handshake, and realtime socket connection succeeded.');
  } finally {
    if (started) {
      await stopServer(started.child);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

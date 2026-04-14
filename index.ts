// Prevent early exit: log uncaught exceptions and rejections
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
/// <reference path="./types/declarations.d.ts" />
import http from 'http';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import Router from 'router';
// @ts-ignore
import finalhandler from 'finalhandler';
import { Server } from 'engine.io';
import crypto from 'crypto';
import { URL } from 'url';
import jwt, { verify } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { DatabaseService } from './database';
import { LipanaService } from './lipanaService';
import { AviatorGame, DiceGame, MinesGameLogic, PlinkoGameLogic, HiloGameLogic, RouletteGame } from './game';
import {
  User,
  Bet,
  GameType,
  ClientMessage,
  GameState,
  AdminLog,
  AutoPlayConfig,
  RiskSettings,
  RoundHistoryEntry,
  PromoCode,
  Notification,
  ChatMessage,
  MinesGame,
  HiloGame,
  Tournament,
  TournamentParticipant,
} from './types';
import express from 'express';
import bodyParser from 'body-parser';
import { initiateMpesaDeposit, initiateMpesaWithdrawal } from './mpesa';

function loadEnvFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFromFile(path.join(process.cwd(), '.env'));

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-that-is-long-and-random';
if (JWT_SECRET === 'your-super-secret-key-that-is-long-and-random') {
  console.warn('WARNING: Using default JWT_SECRET. Please set a secure secret in your environment variables.');
}

const parsedPort = Number(process.env.PORT || 3001);
const PORT = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 3001;
const ENGINE_IO_PATH = '/engine.io';
const parsedMaxBodySize = Number(process.env.MAX_BODY_SIZE_BYTES || 100 * 1024);
const MAX_BODY_SIZE_BYTES = Number.isFinite(parsedMaxBodySize) && parsedMaxBodySize > 0 ? parsedMaxBodySize : 100 * 1024;
const parsedDefaultAdminBalance = Number(process.env.SEED_ADMIN_BALANCE || 10000);
const DEFAULT_ADMIN_BALANCE = Number.isFinite(parsedDefaultAdminBalance) ? parsedDefaultAdminBalance : 10000;
const parsedDefaultMinBet = Number(process.env.DEFAULT_MIN_BET || 1);
const parsedDefaultMaxBet = Number(process.env.DEFAULT_MAX_BET || 1000);
const DEFAULT_RISK_SETTINGS: RiskSettings = {
  minBet: Number.isFinite(parsedDefaultMinBet) && parsedDefaultMinBet > 0 ? parsedDefaultMinBet : 1,
  maxBet: Number.isFinite(parsedDefaultMaxBet) && parsedDefaultMaxBet > 0 ? parsedDefaultMaxBet : 1000,
  maintenanceMode: false,
  gamePaused: false,
};
const REFERRAL_COMMISSION_PERCENT = 0.01; // 1% commission
const DAILY_BONUS_AMOUNT = 100;

const sendJson = (res: http.ServerResponse, statusCode: number, payload: unknown): void => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const resolveAssetPath = (...segments: string[]): string => {
  const candidates = [
    path.join(process.cwd(), ...segments),
    path.join(__dirname, ...segments),
    path.join(__dirname, '..', ...segments),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
};

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) {
    return null;
  }
  return Number(num.toFixed(2));
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function sanitizeRiskSettings(next: Partial<RiskSettings>, current: RiskSettings): RiskSettings {
  const minBet = typeof next.minBet === 'number' && Number.isFinite(next.minBet) ? Number(next.minBet.toFixed(2)) : current.minBet;
  const maxBet = typeof next.maxBet === 'number' && Number.isFinite(next.maxBet) ? Number(next.maxBet.toFixed(2)) : current.maxBet;

  const resolvedMinBet = Math.max(0.01, minBet);
  const resolvedMaxBet = Math.max(resolvedMinBet, maxBet);

  return {
    minBet: resolvedMinBet,
    maxBet: resolvedMaxBet,
    maintenanceMode: typeof next.maintenanceMode === 'boolean' ? next.maintenanceMode : current.maintenanceMode,
    gamePaused: typeof next.gamePaused === 'boolean' ? next.gamePaused : current.gamePaused,
  };
}

function sanitizeAutoPlayConfig(userId: string, payload: any, current: AutoPlayConfig, risk: RiskSettings): AutoPlayConfig {
  const enabled = typeof payload?.enabled === 'boolean' ? payload.enabled : current.enabled;

  const parsedAmount = parseAmount(payload?.amount);
  const amount = parsedAmount === null ? current.amount : parsedAmount;

  const autoCashOut = typeof payload?.autoCashOut === 'boolean' ? payload.autoCashOut : current.autoCashOut;
  const parsedTarget = parseAmount(payload?.targetMultiplier);
  const targetMultiplier = parsedTarget === null ? current.targetMultiplier : parsedTarget;

  const boundedAmount = Math.min(Math.max(amount, risk.minBet), risk.maxBet);
  const boundedTarget = Math.min(Math.max(targetMultiplier, 1.01), 1000);

  return {
    userId,
    enabled,
    amount: Number(boundedAmount.toFixed(2)),
    autoCashOut,
    targetMultiplier: Number(boundedTarget.toFixed(2)),
    updatedAt: Date.now(),
  };
}

// Initialize Router
const router = Router();

const serveTestClient = (res: http.ServerResponse) => {
  const filePath = resolveAssetPath('test-client.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'File not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(data);
  });
};

router.get('/', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendJson(res, 200, { name: 'Betting Server' });
});

const sendHealth = (res: http.ServerResponse) => {
  sendJson(res, 200, {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: Date.now(),
  });
};

router.get('/health', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendHealth(res);
});

router.get('/health/', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendHealth(res);
});

router.get('/api/health', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendHealth(res);
});

router.head('/health', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200);
  res.end();
});

router.head('/api/health', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200);
  res.end();
});

router.get('/favicon.ico', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(204, {
    'Cache-Control': 'public, max-age=86400',
  });
  res.end();
});

router.get('/notifications', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendJson(res, 200, []);
});

router.get('/test-client.html', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  serveTestClient(res);
});

router.get('/static/engine.io.js', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  const filePath = resolveAssetPath('node_modules', 'engine.io-client', 'dist', 'engine.io.js');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Engine.IO client script not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(data);
  });
});

// --- M-Pesa Transactions ---

router.post('/deposit/mpesa', (req: AuthenticatedRequest, res: http.ServerResponse) => {
    authenticateToken(req, res, async () => {
        try {
            const body = await getJsonBody(req);
            const amount = parseAmount(body.amount);
            
            // Use stored phone number if not in body
            const user = db.findUserById(req.user!.id);
            const phoneNumber = body.phoneNumber || body.phone || user?.phoneNumber;

            if (!amount || amount < 10) {
                return sendJson(res, 400, { error: 'Invalid amount. Minimum is 10 KES.' });
            }
            if (!phoneNumber) {
                return sendJson(res, 400, { error: 'No registered phone number found. Please update your profile.' });
            }

            console.log(`[M-Pesa Deposit] Attempting STK Push for User ${req.user!.id}, Phone: ${phoneNumber}, Amount: ${amount}`);
            const result = await lipana.initiateStkPush(phoneNumber, amount);
            if (result.success) {
                console.log(`[M-Pesa Deposit] STK Push SUCCESS: ${result.transactionId || result.checkoutRequestID}`);
                // Create a pending transaction
                db.deposit(req.user!.id, amount, { 
                    status: 'pending', 
                    externalId: result.transactionId || result.checkoutRequestID 
                });
                sendJson(res, 200, { message: 'STK Push initiated. Please check your phone.', transactionId: result.transactionId });
            } else {
                console.error(`[M-Pesa Deposit] STK Push FAILED: ${result.message}`);
                sendJson(res, 500, { error: result.message });
            }
        } catch (err: any) {
            console.error(`[M-Pesa Deposit] Internal Error: ${err.message}`);
            sendJson(res, 500, { error: 'Failed to initiate deposit.' });
        }
    });
});

router.post('/withdraw/mpesa', (req: AuthenticatedRequest, res: http.ServerResponse) => {
    authenticateToken(req, res, async () => {
        try {
            const body = await getJsonBody(req);
            const amount = parseAmount(body.amount);
            
            const user = db.findUserById(req.user!.id);
            const phoneNumber = body.phoneNumber || body.phone || user?.phoneNumber;

            if (!amount || amount <= 0) {
                return sendJson(res, 400, { error: 'Invalid amount.' });
            }
            if (!phoneNumber) {
                return sendJson(res, 400, { error: 'No registered phone number found. Please update your profile.' });
            }

            if (!user || user.balance < amount) {
                return sendJson(res, 400, { error: 'Insufficient balance.' });
            }

            console.log(`[M-Pesa Withdrawal] Attempting Payout for User ${req.user!.id}, Phone: ${phoneNumber}, Amount: ${amount}`);
            const result = await lipana.requestPayout(phoneNumber, amount);
            if (result.success) {
                console.log(`[M-Pesa Withdrawal] Payout SUCCESS: ${result.transactionId}`);
                // Create a pending withdrawal
                db.withdraw(req.user!.id, amount, { 
                    status: 'pending', 
                    externalId: result.transactionId 
                });
                sendJson(res, 200, { message: 'Withdrawal request submitted.', transactionId: result.transactionId });
            } else {
                console.error(`[M-Pesa Withdrawal] Payout FAILED: ${result.message}`);
                sendJson(res, 500, { error: result.message });
            }
        } catch (err: any) {
            console.error(`[M-Pesa Withdrawal] Internal Error: ${err.message}`);
            sendJson(res, 500, { error: 'Failed to initiate withdrawal.' });
        }
    });
});

router.post('/callback/mpesa', async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const signature = req.headers['x-lipana-signature'] as string;
        const bodyRaw = await new Promise<string>((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(data));
        });

        if (LIPANA_WEBHOOK_SECRET && !lipana.verifyWebhookSignature(bodyRaw, signature, LIPANA_WEBHOOK_SECRET)) {
            console.warn('Invalid Lipana webhook signature detected.');
            return sendJson(res, 401, { error: 'Invalid signature' });
        }

        const payload = JSON.parse(bodyRaw);
        console.log('Lipana Webhook received:', payload);

        const { event, data } = payload;
        const externalId = data.transactionId || data.checkoutRequestID;
        
        if (externalId) {
            const transaction = db.findTransactionByExternalId(externalId);
            if (transaction && transaction.status === 'pending') {
                let statusText = '';
                let isSuccess = false;

                if (event === 'payment.success' || event === 'payout.success') {
                    db.updateTransactionStatus(transaction.id, 'success');
                    statusText = 'successful';
                    isSuccess = true;
                    console.log(`Transaction ${transaction.id} marked as SUCCESS (Lipana ID: ${externalId})`);
                } else if (event.endsWith('.failed') || event.endsWith('.cancelled')) {
                    db.updateTransactionStatus(transaction.id, 'failed');
                    statusText = 'failed';
                    isSuccess = false;
                    console.log(`Transaction ${transaction.id} marked as FAILED (Lipana ID: ${externalId})`);
                }

                if (statusText) {
                    // Notify user if online
                    const socketId = userIdToSocketId.get(transaction.userId);
                    if (socketId && engine.clients[socketId]) {
                        const user = db.findUserById(transaction.userId);
                        sendToSocket(engine.clients[socketId], 'BALANCE_UPDATE', { 
                            balance: user?.balance,
                            message: `M-Pesa ${transaction.type} of ${transaction.amount} was ${statusText}!`
                        });
                    }
                }
            }
        }

        sendJson(res, 200, { received: true });
    } catch (err) {
        console.error('Error processing Lipana webhook:', err);
        sendJson(res, 500, { error: 'Internal server error' });
    }
});

// Create HTTP Server
const server = http.createServer((req, res) => {
  if (req.url?.startsWith(ENGINE_IO_PATH)) {
    return;
  }
  router(req, res, finalhandler(req, res));
});

// Initialize Engine.IO for real-time communication
const engine: any = new Server({
  cors: {
    origin: '*',
  },
  transports: ['polling'],
  allowUpgrades: false,
  pingInterval: 25000,
  pingTimeout: 60000,
});
engine.attach(server, { path: ENGINE_IO_PATH, addTrailingSlash: false });
engine.on('connection_error', (err: any) => {
  console.error('Engine.IO connection error:', {
    code: err?.code,
    message: err?.message,
    context: err?.context,
  });
});

// --- Session & DB Stores ---
const socketIdToUserId: Map<string, string> = new Map();
const userIdToSocketId: Map<string, string> = new Map();
const chatRateLimit: Map<string, number> = new Map();
const autoPlayCache: Map<string, AutoPlayConfig> = new Map();
const db = new DatabaseService();

// Initialize Game Engine
const aviatorGame = new AviatorGame({ curve: 'linear', multiplierStep: 0.01, tickIntervalMs: 100, maxMultiplier: 1000 });
const jetxGame = new AviatorGame({ curve: 'exp', expRate: 1.012, tickIntervalMs: 90, maxMultiplier: 500 });
const spacemanGame = new AviatorGame({ curve: 'exp', expRate: 1.014, tickIntervalMs: 85, maxMultiplier: 350 });
const crashGame = new AviatorGame({ curve: 'linear', multiplierStep: 0.012, tickIntervalMs: 95, maxMultiplier: 800 });
const balloonGame = new AviatorGame({ curve: 'exp', expRate: 1.009, tickIntervalMs: 110, maxMultiplier: 200 });
const diceGame = new DiceGame();
let riskSettings: RiskSettings = sanitizeRiskSettings(db.getRiskSettings(DEFAULT_RISK_SETTINGS), DEFAULT_RISK_SETTINGS);

const LIPANA_API_KEY = process.env.LIPANA_API_KEY || '';
const LIPANA_WEBHOOK_SECRET = process.env.LIPANA_WEBHOOK_SECRET || '';
const lipana = new LipanaService(LIPANA_API_KEY);

// Masked log for troubleshooting
if (LIPANA_API_KEY) {
    const masked = LIPANA_API_KEY.slice(0, 12) + '...' + LIPANA_API_KEY.slice(-8);
    console.log(`[Startup] Lipana API Key loaded: ${masked}`);
} else {
    console.warn('[Startup] WARNING: LIPANA_API_KEY is not set in environment.');
}

function validateSingleGameSession(socket: any, userId: string): boolean {
    if (db.hasAnyActiveGame(userId)) {
        sendError(socket, 'You already have an active game session. Complete it before starting a new one.', 'CONCURRENT_GAME_DENIED');
        return false;
    }
    return true;
}
db.setRiskSettings(riskSettings);

const crashGameTypes: GameType[] = [
  GameType.AVIATOR,
  GameType.JETX,
  GameType.SPACEMAN,
  GameType.CRASH,
  GameType.BALLOON,
];

const crashGameMap = new Map<GameType, AviatorGame>([
  [GameType.AVIATOR, aviatorGame],
  [GameType.JETX, jetxGame],
  [GameType.SPACEMAN, spacemanGame],
  [GameType.CRASH, crashGame],
  [GameType.BALLOON, balloonGame],
]);

function isCrashGameType(gameType: GameType): boolean {
  return crashGameMap.has(gameType);
}

function getCrashGame(gameType: GameType): AviatorGame | null {
  return crashGameMap.get(gameType) || null;
}

function setCrashGamesPaused(paused: boolean): void {
  crashGameTypes.forEach((gameType) => {
    const game = getCrashGame(gameType);
    if (game) {
      game.setPaused(paused);
    }
  });
}

setCrashGamesPaused(riskSettings.gamePaused);

interface AuthenticatedRequest extends http.IncomingMessage {
  user?: { id: string; role: 'player' | 'admin' };
}

function getPagination(req: http.IncomingMessage): { page: number; limit: number; offset: number } {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const parsedPage = Number.parseInt(requestUrl.searchParams.get('page') || '1', 10);
  const parsedLimit = Number.parseInt(requestUrl.searchParams.get('limit') || '20', 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

const getJsonBody = (req: http.IncomingMessage): Promise<any> => {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodySize = 0;
    let exceededMaxBodySize = false;

    req.on('data', (chunk) => {
      if (exceededMaxBodySize) {
        return;
      }

      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bodySize += normalizedChunk.length;
      if (bodySize > MAX_BODY_SIZE_BYTES) {
        exceededMaxBodySize = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }

      body += normalizedChunk.toString();
    });

    req.on('end', () => {
      if (exceededMaxBodySize) {
        return;
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', reject);
  });
};

function authenticateToken(req: AuthenticatedRequest, res: http.ServerResponse, next: (err?: Error) => void) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    sendJson(res, 401, { error: 'Authentication token required.' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) {
      sendJson(res, 403, { error: 'Invalid or expired token.' });
      return;
    }
    req.user = decoded as { id: string; role: 'player' | 'admin' };
    next();
  });
}

function authenticateAdmin(req: AuthenticatedRequest, res: http.ServerResponse, next: (err?: Error) => void) {
  authenticateToken(req, res, (err) => {
    if (err) {
      return next(err);
    }
    if (req.user?.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden: Admin access required.' });
      return;
    }
    next();
  });
}

function sendToSocket(socket: any, type: string, payload: any): void {
  socket.send(JSON.stringify({ type, payload }));
}

function broadcast(type: string, payload: any) {
  const message = JSON.stringify({ type, payload });
  for (const socketId in engine.clients) {
    engine.clients[socketId].send(message);
  }
}

function sendError(socket: any, message: string, code?: string) {
  sendToSocket(socket, 'ERROR', { message, code });
}

function getPublicUser(user: User): Omit<User, 'password'> {
  const { password: _password, ...publicUser } = user;
  return publicUser;
  // Note: recoveryKey is currently included in publicUser if it exists on the User object, which might be okay for the owner but should be stripped for others.
}

function getUserBySocket(socket: any): User | null {
  const userId = socketIdToUserId.get(socket.id);
  if (!userId) {
    return null;
  }
  return db.findUserById(userId);
}

function getUserById(userId: string): User | null {
  return db.findUserById(userId);
}

function getDefaultAutoPlayConfig(userId: string): AutoPlayConfig {
  return {
    userId,
    enabled: false,
    amount: 10,
    autoCashOut: true,
    targetMultiplier: 2,
    updatedAt: Date.now(),
  };
}

function getAutoPlayConfig(userId: string): AutoPlayConfig {
  const cached = autoPlayCache.get(userId);
  if (cached) {
    return cached;
  }
  const stored = db.getAutoPlayConfigForUser(userId);
  if (stored) {
    autoPlayCache.set(userId, stored);
    return stored;
  }
  const fallback = getDefaultAutoPlayConfig(userId);
  autoPlayCache.set(userId, fallback);
  return fallback;
}

function persistAutoPlayConfig(config: AutoPlayConfig): AutoPlayConfig {
  db.setAutoPlayConfig(config);
  autoPlayCache.set(config.userId, config);
  return config;
}

function broadcastRiskSettings(): void {
  broadcast('RISK_SETTINGS', riskSettings);
}

function applyRiskSettings(nextSettings: RiskSettings, adminId?: string): void {
  riskSettings = sanitizeRiskSettings(nextSettings, riskSettings);
  db.setRiskSettings(riskSettings);
  setCrashGamesPaused(riskSettings.gamePaused);
  broadcastRiskSettings();

  if (adminId) {
    const log: AdminLog = {
      id: crypto.randomUUID(),
      adminId,
      action: 'UPDATE_RISK_SETTINGS',
      details: JSON.stringify(riskSettings),
      timestamp: Date.now(),
    };
    db.createAdminLog(log);
  }
}

function isMaintenanceBlockedForUser(user: User | null): boolean {
  if (!riskSettings.maintenanceMode) {
    return false;
  }
  if (!user) {
    return true;
  }
  return user.role !== 'admin';
}

function enforceRuntimeAccess(socket: any, user: User | null, opts?: { allowFrozen?: boolean; allowBanned?: boolean }): boolean {
  if (!user) {
    sendError(socket, 'Authentication required.', 'AUTH_REQUIRED');
    return false;
  }

  if (isMaintenanceBlockedForUser(user)) {
    sendError(socket, 'System is under maintenance. Please try again later.', 'MAINTENANCE_MODE');
    return false;
  }

  if (!opts?.allowBanned && user.status === 'banned') {
    sendError(socket, 'This account is banned.', 'ACCOUNT_BANNED');
    return false;
  }

  if (!opts?.allowFrozen && user.status === 'frozen') {
    sendError(socket, 'This account is temporarily frozen.', 'ACCOUNT_FROZEN');
    return false;
  }

  return true;
}

function attachSocketToUser(socket: any, user: User): void {
  const existingSocketId = userIdToSocketId.get(user.id);
  if (existingSocketId && existingSocketId !== socket.id && engine.clients[existingSocketId]) {
    sendToSocket(engine.clients[existingSocketId], 'ERROR', {
      message: 'Logged in from another location.',
      code: 'SESSION_TERMINATED',
    });
    engine.clients[existingSocketId].close();
  }

  const existingUserIdOnSocket = socketIdToUserId.get(socket.id);
  if (existingUserIdOnSocket && existingUserIdOnSocket !== user.id) {
    userIdToSocketId.delete(existingUserIdOnSocket);
  }

  socketIdToUserId.set(socket.id, user.id);
  userIdToSocketId.set(user.id, socket.id);
}

function sendSessionPayload(socket: any, user: User, token?: string, type: 'LOGIN_SUCCESS' | 'SESSION_RESTORED' = 'LOGIN_SUCCESS'): void {
  const crashBets: Record<string, Bet | null> = {};
  crashGameTypes.forEach((gameType) => {
    const game = getCrashGame(gameType);
    if (!game) {
      crashBets[gameType] = null;
      return;
    }
    const gameState = game.getState();
    crashBets[gameType] = db.findActiveBetForUserInGame(user.id, gameState.gameId);
  });

  const activeBet = crashBets[GameType.AVIATOR] || null;
  const activeMinesGame = db.getActiveMinesGameForUser(user.id);
  const activeHiloGame = db.getActiveHiloGameForUser(user.id);
  const autoPlayConfig = getAutoPlayConfig(user.id);
  const stats = db.getUserStats(user.id);

  const payload: any = {
    ...getPublicUser(user),
    activeHiloGame,
    activeMinesGame,
    activeBet,
    activeCrashBets: crashBets,
    autoPlayConfig,
    riskSettings,
    stats,
  };

  if (token) {
    payload.token = token;
  }

  sendToSocket(socket, type, payload);
}

function resolveHouseAdmin(): User | null {
  const admins = db
    .getAllUsers()
    .filter((user) => user.role === 'admin' && user.status !== 'banned');

  if (!admins.length) {
    return null;
  }

  const activeAdmins = admins.filter((user) => user.status === 'active');
  const pool = activeAdmins.length ? activeAdmins : admins;
  const preferredUsername = (process.env.HOUSE_ADMIN_USERNAME || process.env.SEED_ADMIN_USERNAME || 'admin').toLowerCase();
  const preferred = pool.find((user) => user.username.toLowerCase() === preferredUsername)
    || pool.find((user) => user.username.toLowerCase() === 'admin')
    || pool[0];
  return db.findUserById(preferred.id);
}

function creditHouseOnLostBets(lostBets: Bet[]): { creditedAmount: number; adminId: string | null } {
  const houseAdmin = resolveHouseAdmin();
  if (!houseAdmin) {
    return { creditedAmount: 0, adminId: null };
  }

  let creditedAmount = 0;
  for (const lostBet of lostBets) {
    const bettor = db.findUserById(lostBet.userId);
    if (!bettor || bettor.role === 'admin') {
      continue;
    }
    creditedAmount += Number(lostBet.amount || 0);
  }

  creditedAmount = Number(creditedAmount.toFixed(2));
  if (creditedAmount <= 0) {
    return { creditedAmount: 0, adminId: houseAdmin.id };
  }

  const updatedAdminBalance = Number((houseAdmin.balance + creditedAmount).toFixed(2));
  db.updateUserBalance(houseAdmin.id, updatedAdminBalance);

  const log: AdminLog = {
    id: crypto.randomUUID(),
    adminId: houseAdmin.id,
    action: 'HOUSE_CREDIT',
    details: `Credited ${creditedAmount.toFixed(2)} from lost player bets.`,
    timestamp: Date.now(),
  };
  db.createAdminLog(log);

  const adminSocketId = userIdToSocketId.get(houseAdmin.id);
  if (adminSocketId && engine.clients[adminSocketId]) {
    sendToSocket(engine.clients[adminSocketId], 'HOUSE_CREDIT', {
      amount: creditedAmount,
      newBalance: updatedAdminBalance,
    });
  }

  return { creditedAmount, adminId: houseAdmin.id };
}

function creditHouseForBetLoss(bet: Bet): void {
  const houseAdmin = resolveHouseAdmin();
  if (!houseAdmin) {
    return;
  }
  const bettor = db.findUserById(bet.userId);
  if (!bettor || bettor.role === 'admin') {
    return;
  }
  const creditedAmount = Number(bet.amount.toFixed(2));
  if (creditedAmount <= 0) {
    return;
  }
  const updatedAdminBalance = Number((houseAdmin.balance + creditedAmount).toFixed(2));
  db.updateUserBalance(houseAdmin.id, updatedAdminBalance);
  const log: AdminLog = {
    id: crypto.randomUUID(),
    adminId: houseAdmin.id,
    action: 'HOUSE_CREDIT_INSTANT',
    targetUserId: bet.userId,
    details: `Credited ${creditedAmount.toFixed(2)} from ${bet.gameType} loss (bet ${bet.id}).`,
    timestamp: Date.now(),
  };
  db.createAdminLog(log);
  const adminSocketId = userIdToSocketId.get(houseAdmin.id);
  if (adminSocketId && engine.clients[adminSocketId]) {
    sendToSocket(engine.clients[adminSocketId], 'HOUSE_CREDIT', {
      amount: creditedAmount,
      newBalance: updatedAdminBalance,
    });
  }
}

function debitHouseForBetWin(bet: Bet, payout: number): void {
  const houseAdmin = resolveHouseAdmin();
  if (!houseAdmin) {
    return;
  }
  if (!Number.isFinite(payout) || payout <= 0) {
    return;
  }
  const bettor = db.findUserById(bet.userId);
  if (!bettor || bettor.role === 'admin') {
    return;
  }
  const updatedAdminBalance = Number((houseAdmin.balance - payout).toFixed(2));
  db.updateUserBalance(houseAdmin.id, updatedAdminBalance);
  const log: AdminLog = {
    id: crypto.randomUUID(),
    adminId: houseAdmin.id,
    action: 'HOUSE_DEBIT',
    targetUserId: bet.userId,
    details: `Debited ${payout.toFixed(2)} for ${bet.gameType} win (bet ${bet.id}).`,
    timestamp: Date.now(),
  };
  db.createAdminLog(log);
  const adminSocketId = userIdToSocketId.get(houseAdmin.id);
  if (adminSocketId && engine.clients[adminSocketId]) {
    sendToSocket(engine.clients[adminSocketId], 'HOUSE_DEBIT', {
      amount: payout,
      newBalance: updatedAdminBalance,
    });
  }
}

type PlayingCard = { rank: string; suit: string; value: number };
const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_SUITS = ['♠', '♥', '♦', '♣'];

function drawCard(): PlayingCard {
  const rankIndex = Math.floor(Math.random() * CARD_RANKS.length);
  const suitIndex = Math.floor(Math.random() * CARD_SUITS.length);
  const rank = CARD_RANKS[rankIndex];
  const suit = CARD_SUITS[suitIndex];
  let value = rankIndex + 1;
  if (rankIndex >= 10) {
    value = 10;
  }
  return { rank, suit, value };
}

function formatCard(card: PlayingCard): string {
  return `${card.rank}${card.suit}`;
}

function getBlackjackTotal(cards: PlayingCard[]): number {
  let total = 0;
  let aces = 0;
  cards.forEach((card) => {
    total += card.value;
    if (card.rank === 'A') aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function getBaccaratTotal(cards: PlayingCard[]): number {
  const sum = cards.reduce((acc, card) => acc + (card.value >= 10 ? 0 : card.value), 0);
  return sum % 10;
}

const teenPattiRanks = [
  { name: 'High Card', strength: 1, weight: 42 },
  { name: 'Pair', strength: 2, weight: 28 },
  { name: 'Color', strength: 3, weight: 12 },
  { name: 'Sequence', strength: 4, weight: 8 },
  { name: 'Pure Sequence', strength: 5, weight: 4 },
  { name: 'Three of a Kind', strength: 6, weight: 3 },
  { name: 'Straight Flush', strength: 7, weight: 2 },
  { name: 'Trail', strength: 8, weight: 1 },
];

function pickTeenPattiRank(): { name: string; strength: number } {
  const totalWeight = teenPattiRanks.reduce((acc, rank) => acc + rank.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const rank of teenPattiRanks) {
    roll -= rank.weight;
    if (roll <= 0) return { name: rank.name, strength: rank.strength };
  }
  const fallback = teenPattiRanks[0];
  return { name: fallback.name, strength: fallback.strength };
}

function updateTournamentScores(bet: Bet) {
    if (bet.status !== 'cashed_out' || !bet.exitMultiplier) return;

    const activeTournaments = db.getActiveTournaments().filter(t => t.status === 'active' && t.gameType === bet.gameType);
    if (activeTournaments.length === 0) return;

    const user = db.findUserById(bet.userId);
    if (!user) return;

    for (const tournament of activeTournaments) {
        if (db.isUserInTournament(tournament.id, user.id)) {
            // For now, score is always the exit multiplier. This can be customized per tournament later.
            const score = bet.exitMultiplier || 0;
            if (score > 0) {
                db.updateTournamentScore(tournament.id, user.id, user.username, score);
                // Broadcast update
                broadcast('TOURNAMENT_UPDATE', {
                    tournamentId: tournament.id,
                    leaderboard: db.getTournamentLeaderboard(tournament.id)
                });
            }
        }
    }
}

function processReferralCommission(user: User, betAmount: number): void {
  if (!user.referredBy) return;

  const referrer = db.findUserByUsername(user.referredBy);
  if (!referrer) return;

  const commission = Number((betAmount * REFERRAL_COMMISSION_PERCENT).toFixed(2));
  if (commission <= 0) return;

  const newBalance = Number((referrer.balance + commission).toFixed(2));
  db.updateUserBalance(referrer.id, newBalance);

  // Optionally notify referrer if online (omitted for brevity/performance)
  console.log(`Referral commission: ${commission} to ${referrer.username} from ${user.username}`);
}

type BetResult =
  | { ok: true; bet: Bet; newBalance: number; roll?: number }
  | { ok: false; message: string; code?: string };

function placeBetForUser(userId: string, amount: number, gameType: GameType = GameType.AVIATOR): BetResult {
  const user = db.findUserById(userId);
  if (!user) {
    return { ok: false, message: 'User not found.', code: 'USER_NOT_FOUND' };
  }

  if (!isCrashGameType(gameType)) {
    return { ok: false, message: 'Invalid game type.', code: 'INVALID_GAME' };
  }

  if (isMaintenanceBlockedForUser(user)) {
    return { ok: false, message: 'System is under maintenance.', code: 'MAINTENANCE_MODE' };
  }

  if (user.status === 'banned') {
    return { ok: false, message: 'Banned accounts cannot place bets.', code: 'ACCOUNT_BANNED' };
  }

  if (user.status === 'frozen') {
    return { ok: false, message: 'Frozen accounts cannot place bets.', code: 'ACCOUNT_FROZEN' };
  }

  const crashGame = getCrashGame(gameType)!;
  const gameState = crashGame.getState();
  if (riskSettings.gamePaused || gameState.paused) {
    return { ok: false, message: 'Game is paused by admin.', code: 'GAME_PAUSED' };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: 'Invalid bet amount.', code: 'INVALID_AMOUNT' };
  }

  if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
    return {
      ok: false,
      message: `Bet amount must be between ${riskSettings.minBet.toFixed(2)} and ${riskSettings.maxBet.toFixed(2)}.`,
      code: 'BET_OUT_OF_RANGE',
    };
  }

  if (gameState.status !== 'waiting') {
    return { ok: false, message: 'Bets can only be placed while waiting for the next round.', code: 'ROUND_NOT_WAITING' };
  }

  const existingBet = db.findActiveBetForUserInGame(user.id, gameState.gameId);
  if (existingBet) {
    return { ok: false, message: 'You already have an active bet for this round.', code: 'BET_EXISTS' };
  }

  if (user.balance < amount) {
    return { ok: false, message: 'Insufficient balance.', code: 'INSUFFICIENT_FUNDS' };
  }

  const newBalance = Number((user.balance - amount).toFixed(2));
  db.updateUserBalance(user.id, newBalance);

  const bet: Bet = {
    id: crypto.randomUUID(),
    userId: user.id,
    amount: Number(amount.toFixed(2)),
    gameType,
    gameId: gameState.gameId,
    entryMultiplier: 1.0,
    status: 'active',
    timestamp: Date.now(),
  };

  db.createBet(bet);

  // Process referral commission asynchronously
  processReferralCommission(user, amount);
  if (user) db.updateDailyLeaderboard(user.id, user.username, amount);

  return { ok: true, bet, newBalance };
}

function placeDiceBetForUser(userId: string, amount: number, condition: 'over' | 'under', target: number): BetResult {
    const user = db.findUserById(userId);
    if (!user) return { ok: false, message: 'User not found.', code: 'USER_NOT_FOUND' };
    if (isMaintenanceBlockedForUser(user)) return { ok: false, message: 'Maintenance mode.', code: 'MAINTENANCE_MODE' };
    if (user.balance < amount) return { ok: false, message: 'Insufficient funds.', code: 'INSUFFICIENT_FUNDS' };

    if (target < 2 || target > 98) return { ok: false, message: 'Target must be between 2 and 98.', code: 'INVALID_TARGET' };

    const newBalancePre = Number((user.balance - amount).toFixed(2));
    db.updateUserBalance(user.id, newBalancePre);

    // Play the game instantly
    const result = diceGame.playRound(user.id, condition, target);
    
    let payout = 0;
    let status: 'cashed_out' | 'lost' = 'lost';
    let exitMultiplier = 0;

    if (result.won) {
        status = 'cashed_out';
        exitMultiplier = Number(result.multiplier.toFixed(2));
        payout = Number((amount * exitMultiplier).toFixed(2));
        const newBalancePost = Number((newBalancePre + payout).toFixed(2));
        db.updateUserBalance(user.id, newBalancePost);
    }

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user.id,
        amount: Number(amount.toFixed(2)),
        gameType: GameType.DICE,
        gameId: crypto.randomUUID(), // Instant game, unique ID
        entryMultiplier: 1.0,
        exitMultiplier,
        payout,
        status,
        timestamp: Date.now(),
    };

    db.createBet(bet);

    // Record round history for provably fair
    const roundEntry: RoundHistoryEntry = {
        gameId: bet.gameId,
        crashMultiplier: result.roll, // Reusing field for roll result
        timestamp: Date.now(),
        serverSeedHash: result.serverSeedHash,
        serverSeed: result.serverSeed,
        nonce: result.nonce,
    };
    db.createRoundHistory(roundEntry);

    // Return the final balance state
    if (bet.status === 'cashed_out') {
        updateTournamentScores(bet);
        if (payout > 0) {
            debitHouseForBetWin(bet, payout);
        }
    } else {
        creditHouseForBetLoss(bet);
    }
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);
    return { ok: true, bet, newBalance: status === 'cashed_out' ? Number((newBalancePre + payout).toFixed(2)) : newBalancePre, roll: result.roll };
}

type CashOutResult =
  | { ok: true; bet: Bet; newBalance: number }
  | { ok: false; message: string; code?: string };

function cashOutForUser(userId: string, gameType: GameType = GameType.AVIATOR, multiplier?: number): CashOutResult {
  const user = db.findUserById(userId);
  if (!user) {
    return { ok: false, message: 'User not found.', code: 'USER_NOT_FOUND' };
  }

  if (!isCrashGameType(gameType)) {
    return { ok: false, message: 'Invalid game type.', code: 'INVALID_GAME' };
  }

  if (isMaintenanceBlockedForUser(user)) {
    return { ok: false, message: 'System is under maintenance.', code: 'MAINTENANCE_MODE' };
  }

  const crashGame = getCrashGame(gameType)!;
  const gameState = crashGame.getState();
  const activeBet = db.findActiveBetForUserInGame(user.id, gameState.gameId);

  if (!activeBet || activeBet.status !== 'active' || gameState.status !== 'flying') {
    return { ok: false, message: 'Cannot cash out at this time.', code: 'CASHOUT_NOT_ALLOWED' };
  }

  const finalMultiplier = Number((multiplier ?? gameState.multiplier).toFixed(2));
  const payout = Number((activeBet.amount * finalMultiplier).toFixed(2));

  activeBet.status = 'cashed_out';
  activeBet.exitMultiplier = finalMultiplier;
  activeBet.payout = payout;

  const newBalance = Number((user.balance + payout).toFixed(2));
  db.updateUserBalance(user.id, newBalance);
  db.updateBetStatus(activeBet.id, 'cashed_out', finalMultiplier, payout);
  updateTournamentScores(activeBet);
  debitHouseForBetWin(activeBet, payout);

  return { ok: true, bet: activeBet, newBalance };
}

function processAutoBetsForRound(state: GameState, gameType: GameType): void {
  if (state.status !== 'waiting') {
    return;
  }
  if (riskSettings.maintenanceMode || riskSettings.gamePaused || state.paused) {
    return;
  }
  if (gameType !== GameType.AVIATOR) {
    return;
  }

  const configs = db.getEnabledAutoPlayConfigs();
  configs.forEach((config) => {
    autoPlayCache.set(config.userId, config);
    const socketId = userIdToSocketId.get(config.userId);
    if (!socketId || !engine.clients[socketId]) {
      return;
    }

    const result = placeBetForUser(config.userId, config.amount, GameType.AVIATOR);
    if (result.ok) {
      sendToSocket(engine.clients[socketId], 'BET_PLACED', {
        bet: result.bet,
        newBalance: result.newBalance,
        auto: true,
      });
      return;
    }

    sendToSocket(engine.clients[socketId], 'AUTO_BET_SKIPPED', {
      reason: result.message,
      code: result.code,
    });
  });
}

function processAutoCashOut(state: GameState, gameType: GameType): void {
  if (state.status !== 'flying') {
    return;
  }
  if (gameType !== GameType.AVIATOR) {
    return;
  }

  const activeBets = db.getActiveBetsForGame(state.gameId);
  activeBets.forEach((bet) => {
    const config = getAutoPlayConfig(bet.userId);
    if (!config.enabled || !config.autoCashOut) {
      return;
    }

    if (state.multiplier < config.targetMultiplier) {
      return;
    }

    const result = cashOutForUser(bet.userId, GameType.AVIATOR, state.multiplier);
    if (!result.ok) {
      return;
    }

    const socketId = userIdToSocketId.get(bet.userId);
    if (socketId && engine.clients[socketId]) {
      sendToSocket(engine.clients[socketId], 'BET_WON', {
        bet: result.bet,
        newBalance: result.newBalance,
        auto: true,
        targetMultiplier: config.targetMultiplier,
      });
    }
  });
}

function sendUserRiskSettings(socket: any): void {
  sendToSocket(socket, 'RISK_SETTINGS', riskSettings);
}

function handleRegister(socket: any, payload: any): void {
  (async () => {
    try {
      if (riskSettings.maintenanceMode) {
        return sendError(socket, 'Registration disabled during maintenance.', 'MAINTENANCE_MODE');
      }

      const { username, password, referralCode, phoneNumber } = payload || {};
      if (!username || !password) {
        return sendError(socket, 'Username and password are required.', 'INVALID_INPUT');
      }

      const existingUser = db.findUserByUsername(username);
      if (existingUser) {
        return sendError(socket, 'Username already exists.', 'USERNAME_TAKEN');
      }

      let validReferrer = undefined;
      if (referralCode) {
        const referrer = db.findUserByUsername(referralCode);
        if (referrer) {
          validReferrer = referrer.username;
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const recoveryKey = crypto.randomBytes(16).toString('hex');
      const newUser: User = {
        id: crypto.randomUUID(),
        username,
        password: hashedPassword,
        balance: 1000,
        role: 'player',
        status: 'active',
        referredBy: validReferrer,
        phoneNumber: typeof phoneNumber === 'string' ? phoneNumber : undefined,
        recoveryKey,
      };

      db.createUser(newUser);
      persistAutoPlayConfig(getDefaultAutoPlayConfig(newUser.id));

      console.log(`User registered: ${username} (ID: ${newUser.id})`);
      sendToSocket(socket, 'REGISTER_SUCCESS', { username, recoveryKey });
    } catch (err) {
      console.error('Registration error:', err);
      sendError(socket, 'Registration failed due to an internal error.', 'INTERNAL_ERROR');
    }
  })().catch((error) => {
    console.error('Registration flow failed:', error);
    sendError(socket, 'Registration failed due to an internal error.', 'INTERNAL_ERROR');
  });
}

function handleLogin(socket: any, payload: any): void {
  (async () => {
    try {
      const { username, password } = payload || {};
      const user = db.findUserByUsername(username);

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return sendError(socket, 'Invalid username or password.', 'INVALID_CREDENTIALS');
      }

      if (user.status === 'banned') {
        return sendError(socket, 'This account is banned.', 'ACCOUNT_BANNED');
      }

      if (isMaintenanceBlockedForUser(user)) {
        return sendError(socket, 'System is under maintenance. Login is temporarily restricted.', 'MAINTENANCE_MODE');
      }

      attachSocketToUser(socket, user);
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
      console.log(`User logged in: ${username} on socket ${socket.id}`);
      sendSessionPayload(socket, user, token, 'LOGIN_SUCCESS');
    } catch (err) {
      console.error('Login error:', err);
      sendError(socket, 'Login failed due to an internal error.', 'INTERNAL_ERROR');
    }
  })().catch((error) => {
    console.error('Login flow failed:', error);
    sendError(socket, 'Login failed due to an internal error.', 'INTERNAL_ERROR');
  });
}

function handleAuthResume(socket: any, payload: any): void {
  const token = typeof payload?.token === 'string' ? payload.token : '';
  if (!token) {
    return sendError(socket, 'Token is required for session resume.', 'AUTH_REQUIRED');
  }

  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) {
      return sendError(socket, 'Invalid or expired token.', 'INVALID_TOKEN');
    }

    const userId = decoded?.id;
    if (!userId || typeof userId !== 'string') {
      return sendError(socket, 'Invalid session token payload.', 'INVALID_TOKEN');
    }

    const user = db.findUserById(userId);
    if (!user) {
      return sendError(socket, 'User not found for session.', 'USER_NOT_FOUND');
    }

    if (user.status === 'banned') {
      return sendError(socket, 'This account is banned.', 'ACCOUNT_BANNED');
    }

    if (isMaintenanceBlockedForUser(user)) {
      return sendError(socket, 'System is under maintenance. Session restore blocked.', 'MAINTENANCE_MODE');
    }

    attachSocketToUser(socket, user);
    sendSessionPayload(socket, user, token, 'SESSION_RESTORED');
  });
}

async function handleResetPassword(socket: any, payload: any): Promise<void> {
  try {
    const { username, recoveryKey, newPassword } = payload || {};
    if (!username || !recoveryKey || !newPassword || newPassword.length < 6) {
      return sendError(socket, 'Invalid input. Username, recovery key, and new password (min 6 chars) required.', 'INVALID_INPUT');
    }

    const user = db.findUserByUsername(username);
    if (!user || user.recoveryKey !== recoveryKey) {
      return sendError(socket, 'Invalid username or recovery key.', 'INVALID_CREDENTIALS');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.updateUserPassword(user.id, hashedPassword);
    sendToSocket(socket, 'PASSWORD_RESET_SUCCESS', { message: 'Password reset successfully. You can now login.' });
  } catch (err) {
    console.error('Password reset error:', err);
    sendError(socket, 'Password reset failed.', 'INTERNAL_ERROR');
  }
}

function handleSetAutoPlay(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const currentConfig = getAutoPlayConfig(user!.id);
  const nextConfig = sanitizeAutoPlayConfig(user!.id, payload, currentConfig, riskSettings);
  persistAutoPlayConfig(nextConfig);

  sendToSocket(socket, 'AUTOPLAY_CONFIG', nextConfig);

  const gameState = aviatorGame.getState();
  if (nextConfig.enabled && gameState.status === 'waiting' && !riskSettings.gamePaused && !riskSettings.maintenanceMode) {
    const result = placeBetForUser(user!.id, nextConfig.amount, GameType.AVIATOR);
    if (result.ok) {
      sendToSocket(socket, 'BET_PLACED', {
        bet: result.bet,
        newBalance: result.newBalance,
        auto: true,
      });
    } else if (result.code !== 'BET_EXISTS') {
      sendToSocket(socket, 'AUTO_BET_SKIPPED', {
        reason: result.message,
        code: result.code,
      });
    }
  }
}

function handlePlaceBet(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  if (!validateSingleGameSession(socket, user!.id)) return;

  const amount = parseAmount(payload?.amount);
  if (amount === null) {
    return sendError(socket, 'Invalid bet amount.', 'INVALID_AMOUNT');
  }

  const requestedType = payload?.gameType as GameType | undefined;
  const gameType = requestedType && isCrashGameType(requestedType) ? requestedType : GameType.AVIATOR;
  const result = placeBetForUser(user!.id, amount, gameType);
  if (!result.ok) {
    return sendError(socket, result.message, result.code);
  }

  sendToSocket(socket, 'BET_PLACED', { bet: result.bet, newBalance: result.newBalance, auto: false });
  console.log(`Bet placed by ${user!.username} for ${amount}. New balance: ${result.newBalance.toFixed(2)}`);
}

function handlePlaceDiceBet(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    if (!validateSingleGameSession(socket, user!.id)) return;

    const amount = parseAmount(payload?.amount);
    const condition = payload?.condition;
    const target = Number(payload?.target);

    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (condition !== 'over' && condition !== 'under') return sendError(socket, 'Invalid condition.', 'INVALID_INPUT');
    if (!Number.isFinite(target)) return sendError(socket, 'Invalid target.', 'INVALID_INPUT');

    const result = placeDiceBetForUser(user!.id, amount, condition, target);
    if (!result.ok) return sendError(socket, result.message, result.code);

    // Send specific DICE_RESULT event
    sendToSocket(socket, 'DICE_RESULT', { bet: result.bet, newBalance: result.newBalance, roll: result.roll });
    console.log(`Dice bet by ${user!.username}: ${result.bet.status} (Payout: ${result.bet.payout})`);
}

function handleMinesStartGame(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    if (!validateSingleGameSession(socket, user!.id)) return;

    const amount = parseAmount(payload?.amount);
    const mineCount = Number(payload?.mineCount);

    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) return sendError(socket, 'Mine count must be between 1 and 24.', 'INVALID_INPUT');
    if (user!.balance < amount) return sendError(socket, 'Insufficient balance.', 'INSUFFICIENT_FUNDS');

    // End any previous game
    const existingGame = db.getActiveMinesGameForUser(user!.id);
    if (existingGame) {
        // This shouldn't happen if client logic is correct, but as a safeguard
        db.updateMinesGame({ ...existingGame, isOver: true, updatedAt: Date.now() });
    }

    const newBalance = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalance);

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: amount,
        gameType: GameType.MINES,
        gameId: crypto.randomUUID(), // This will be the MinesGame ID
        entryMultiplier: 1.0,
        status: 'active',
        timestamp: Date.now(),
    };
    db.createBet(bet);

    const now = Date.now();
    const minesGame: MinesGame = {
        id: bet.gameId,
        userId: user!.id,
        betId: bet.id,
        betAmount: amount,
        gridSize: 25,
        mineCount: mineCount,
        minesLayout: [], // Generated on first click
        revealedTiles: [],
        isOver: false,
        payoutMultiplier: 1.0,
        createdAt: now,
        updatedAt: now,
    };
    db.createMinesGame(minesGame);

    sendToSocket(socket, 'MINES_GAME_STARTED', { minesGame, newBalance });
}

function handleMinesRevealTile(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const tileIndex = Number(payload?.tileIndex);
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= 25) {
        return sendError(socket, 'Invalid tile index.', 'INVALID_INPUT');
    }

    const game = db.getActiveMinesGameForUser(user!.id);
    if (!game || game.isOver) {
        return sendError(socket, 'No active Mines game found.', 'GAME_NOT_FOUND');
    }
    if (game.revealedTiles.includes(tileIndex)) {
        return sendError(socket, 'Tile already revealed.', 'INVALID_OPERATION');
    }

    if (game.revealedTiles.length === 0) {
        game.minesLayout = MinesGameLogic.generateMines(game.gridSize, game.mineCount, tileIndex);
    }

    if (game.minesLayout.includes(tileIndex)) {
        game.isOver = true;
        game.updatedAt = Date.now();
        db.updateMinesGame(game);
        db.updateBetStatus(game.betId, 'lost', 0, 0);
        const lostBet = db.getBetById(game.betId);
        if (lostBet) {
          creditHouseForBetLoss(lostBet);
        }
        sendToSocket(socket, 'MINES_GAME_OVER', { minesGame: game });
    } else {
        game.revealedTiles.push(tileIndex);
        game.payoutMultiplier = MinesGameLogic.calculateMultiplier(game.revealedTiles.length, game.gridSize, game.mineCount);
        game.updatedAt = Date.now();
        db.updateMinesGame(game);
        const nextMultiplier = MinesGameLogic.calculateMultiplier(game.revealedTiles.length + 1, game.gridSize, game.mineCount);
        sendToSocket(socket, 'MINES_TILE_REVEALED', { minesGame: game, nextMultiplier });
    }
}

function handleMinesCashout(socket: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const game = db.getActiveMinesGameForUser(user!.id);
    if (!game || game.isOver || game.revealedTiles.length === 0) {
        return sendError(socket, 'Cannot cashout now.', 'INVALID_OPERATION');
    }

    game.isOver = true;
    game.updatedAt = Date.now();
    db.updateMinesGame(game);

    const payout = Number((game.betAmount * game.payoutMultiplier).toFixed(2));
    const newBalance = Number((user!.balance + payout).toFixed(2));
    db.updateUserBalance(user!.id, newBalance);

    db.updateBetStatus(game.betId, 'cashed_out', game.payoutMultiplier, payout);

    sendToSocket(socket, 'MINES_CASHOUT_SUCCESS', { minesGame: game, payout, newBalance });
    const finalBet = db.getBetById(game.betId);
    if (finalBet) {
        updateTournamentScores(finalBet);
        debitHouseForBetWin(finalBet, payout);
    }
}

function handlePlinkoDrop(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const amount = parseAmount(payload?.amount);
    const rows = Number(payload?.rows) as (8 | 16);
    const risk = payload?.risk as ('low' | 'medium' | 'high');

    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (![8, 16].includes(rows)) return sendError(socket, 'Invalid rows. Must be 8 or 16.', 'INVALID_INPUT');
    if (!['low', 'medium', 'high'].includes(risk)) return sendError(socket, 'Invalid risk level.', 'INVALID_INPUT');
    if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

    const newBalancePre = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePre);

    const result = PlinkoGameLogic.playRound(rows, risk);
    const payout = Number((amount * result.multiplier).toFixed(2));
    const newBalancePost = Number((newBalancePre + payout).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePost);

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: amount,
        gameType: GameType.PLINKO,
        gameId: crypto.randomUUID(), // Instant game, unique ID
        entryMultiplier: 1.0,
        exitMultiplier: result.multiplier,
        payout,
        status: payout > 0 ? 'cashed_out' : 'lost',
        timestamp: Date.now(),
    };
    db.createBet(bet);

    sendToSocket(socket, 'PLINKO_RESULT', {
        bet,
        newBalance: newBalancePost,
        path: result.path
    });
    console.log(`Plinko drop by ${user!.username}: ${result.multiplier}x, Payout: ${payout}`);
    updateTournamentScores(bet);
    if (bet.status === 'lost') {
        creditHouseForBetLoss(bet);
    } else if (bet.payout) {
        debitHouseForBetWin(bet, bet.payout);
    }
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);
}

function handleHiloStartGame(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    if (!validateSingleGameSession(socket, user!.id)) return;

    const amount = parseAmount(payload?.amount);
    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

    const existingGame = db.getActiveHiloGameForUser(user!.id);
    if (existingGame) {
        db.updateHiloGame({ ...existingGame, isOver: true, updatedAt: Date.now() });
    }

    const newBalance = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalance);

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: amount,
        gameType: GameType.HILO,
        gameId: crypto.randomUUID(),
        entryMultiplier: 1.0,
        status: 'active',
        timestamp: Date.now(),
    };
    db.createBet(bet);

    const now = Date.now();
    const deck = HiloGameLogic.createDeck();
    const firstCard = deck.pop()!;
    const hiloGame: HiloGame = {
        id: bet.gameId,
        userId: user!.id,
        betId: bet.id,
        betAmount: amount,
        deck: deck,
        history: [firstCard],
        isOver: false,
        payoutMultiplier: 1.0,
        createdAt: now,
        updatedAt: now,
    };
    db.createHiloGame(hiloGame);

    sendToSocket(socket, 'HILO_GAME_STARTED', { hiloGame, newBalance });
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);
}

function handleHiloBet(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const betDirection = payload?.bet as ('higher' | 'lower');
    if (betDirection !== 'higher' && betDirection !== 'lower') {
        return sendError(socket, 'Invalid bet direction.', 'INVALID_INPUT');
    }

    const game = db.getActiveHiloGameForUser(user!.id);
    if (!game || game.isOver || game.deck.length === 0) {
        return sendError(socket, 'No active HiLo game found or deck is empty.', 'GAME_NOT_FOUND');
    }

    const previousCard = game.history[game.history.length - 1];
    const nextCard = game.deck.pop()!;
    game.history.push(nextCard);

    const { won } = HiloGameLogic.playRound(betDirection, previousCard, nextCard);

    if (won) {
        game.payoutMultiplier = HiloGameLogic.calculateMultiplier(game.history.length - 1);
        game.updatedAt = Date.now();
        db.updateHiloGame(game);
        sendToSocket(socket, 'HILO_BET_SUCCESS', { hiloGame: game, nextCard });
    } else {
        game.isOver = true;
        game.updatedAt = Date.now();
        db.updateHiloGame(game);
        db.updateBetStatus(game.betId, 'lost', 0, 0);
        const lostBet = db.getBetById(game.betId);
        if (lostBet) {
          creditHouseForBetLoss(lostBet);
        }
        sendToSocket(socket, 'HILO_GAME_OVER', { hiloGame: game, nextCard });
    }
}

function handleHiloCashout(socket: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const game = db.getActiveHiloGameForUser(user!.id);
    if (!game || game.isOver || game.history.length <= 1) {
        return sendError(socket, 'Cannot cashout now.', 'INVALID_OPERATION');
    }

    game.isOver = true;
    game.updatedAt = Date.now();
    db.updateHiloGame(game);

    const payout = Number((game.betAmount * game.payoutMultiplier).toFixed(2));
    const newBalance = Number((user!.balance + payout).toFixed(2));
    db.updateUserBalance(user!.id, newBalance);

    db.updateBetStatus(game.betId, 'cashed_out', game.payoutMultiplier, payout);

    sendToSocket(socket, 'HILO_CASHOUT_SUCCESS', { hiloGame: game, payout, newBalance });
    const finalBet = db.getBetById(game.betId);
    if (finalBet) {
        updateTournamentScores(finalBet);
        debitHouseForBetWin(finalBet, payout);
    }
}

function handlePlaceRouletteBet(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    if (!validateSingleGameSession(socket, user!.id)) return;

    const { amount, betType, betValue } = payload;

    if (!Number.isFinite(amount) || amount <= 0) {
        return sendError(socket, 'Invalid bet amount.', 'INVALID_AMOUNT');
    }

    if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
        return sendError(socket, `Bet amount must be between ${riskSettings.minBet} and ${riskSettings.maxBet}.`, 'BET_OUT_OF_RANGE');
    }

    if (user!.balance < amount) {
        return sendError(socket, 'Insufficient balance.', 'INSUFFICIENT_FUNDS');
    }

    // Validate bet type
    const validBetTypes = ['color', 'even_odd', 'high_low', 'dozen', 'column', 'number'];
    if (!validBetTypes.includes(betType)) {
        return sendError(socket, 'Invalid bet type.', 'INVALID_BET_TYPE');
    }

    // Deduct bet amount
    const newBalancePre = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePre);

    // Spin the roulette wheel
    const spinResult = RouletteGame.spinRoulette(betType, betValue);

    // Determine payout
    let payout = 0;
    let status: 'cashed_out' | 'lost' = 'lost';
    let exitMultiplier = 1.0;

    if (spinResult.won) {
        status = 'cashed_out';
        exitMultiplier = spinResult.payout;
        payout = Number((amount * spinResult.payout).toFixed(2));
        const newBalance = Number((newBalancePre + payout).toFixed(2));
        db.updateUserBalance(user!.id, newBalance);
    }

    // Create bet record
    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: Number(amount.toFixed(2)),
        gameType: GameType.ROULETTE,
        gameId: crypto.randomUUID(),
        entryMultiplier: 1.0,
        exitMultiplier,
        payout,
        status,
        timestamp: Date.now(),
    };

    db.createBet(bet);

    // Update leaderboard
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);

    const finalBalance = status === 'cashed_out' ? Number((newBalancePre + payout).toFixed(2)) : newBalancePre;

    sendToSocket(socket, 'ROULETTE_SPIN_RESULT', {
        spinResult: spinResult.result,
        color: spinResult.color,
        won: spinResult.won,
        betType,
        betValue,
        payout,
        exitMultiplier,
        newBalance: finalBalance,
    });

    if (status === 'cashed_out') {
        updateTournamentScores(bet);
        if (payout > 0) {
            debitHouseForBetWin(bet, payout);
        }
    } else {
        creditHouseForBetLoss(bet);
    }
}

// state map for ongoing blackjack sessions keyed by socket id
interface BlackjackHand {
    cards: PlayingCard[];
    betAmount: number;          // current stake for this hand (modified by double)
    doubled: boolean;           // whether player doubled down on this hand
    completed: boolean;         // hand finished (stood or busted)
}

interface BlackjackSession {
    userId: string;
    preBalance: number;         // balance after all bets have been deducted
    hands: BlackjackHand[];     // array of active hands (split creates two)
    currentHand: number;        // index of hand player is currently acting on
    dealerCards: PlayingCard[];
    betId: string;
}

const blackjackSessions: Map<string, BlackjackSession> = new Map();

function handleBlackjackPlay(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const amount = parseAmount(payload?.amount);
    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
        return sendError(socket, `Bet amount must be between ${riskSettings.minBet} and ${riskSettings.maxBet}.`, 'BET_OUT_OF_RANGE');
    }
    if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

    // deduct the

    // start session with a single hand
    const playerCards = [drawCard(), drawCard()];
    const dealerCards = [drawCard(), drawCard()];
    const hand: BlackjackHand = { cards: playerCards, betAmount: amount, doubled: false, completed: false };
    const session: BlackjackSession = {
        userId: user!.id,
        preBalance: newBalancePre,
        hands: [hand],
        currentHand: 0,
        dealerCards,
        betId: crypto.randomUUID(),
    };
    blackjackSessions.set(socket.id, session);

    const playerTotal = getBlackjackTotal(playerCards);
    const dealerTotal = getBlackjackTotal(dealerCards);

    sendToSocket(socket, 'BLACKJACK_RESULT', {
        stage: 'initial',
        isFinal: false,
        hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
        currentHand: session.currentHand,
        dealerCards: dealerCards.map(formatCard),
        dealerTotal,
        isFinal: false,
        hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
        currentHand: session.currentHand,
        dealerCards: dealerCards.map(formatCard),
        dealerTotal,
        newBalance: newBalancePre,
    });
}


// finalize a blackjack session (evaluates all hands and sends result)
function finalizeBlackjackSession(socket: any, session: BlackjackSession): void {
    // dealer play happens before calling this function
    const dealerTotal = getBlackjackTotal(session.dealerCards);

    let totalBet = 0;
    let totalPayout = 0;
    const outcomes: Array<'win'|'lose'|'push'> = [];

    session.hands.forEach(hand => {
        totalBet += hand.betAmount;
        const playerTotal = getBlackjackTotal(hand.cards);
        let outcome: 'win'|'lose'|'push' = 'lose';
        if (playerTotal > 21) outcome = 'lose';
        else if (dealerTotal > 21) outcome = 'win';
        else if (playerTotal > dealerTotal) outcome = 'win';
        else if (playerTotal < dealerTotal) outcome = 'lose';
        else outcome = 'push';
        outcomes.push(outcome);

        if (outcome === 'win') {
            totalPayout += hand.betAmount * 2;
        } else if (outcome === 'push') {
            totalPayout += hand.betAmount;
        }
    });

    const newBalancePost = Number((session.preBalance + totalPayout).toFixed(2));
    db.updateUserBalance(session.userId, newBalancePost);

    const exitMultiplier = totalBet > 0 ? totalPayout / totalBet : 0;
    const status: 'cashed_out' | 'lost' = totalPayout > 0 ? 'cashed_out' : 'lost';

    const bet: Bet = {
        id: session.betId,
        userId: session.userId,
        amount: Number(totalBet.toFixed(2)),
        gameType: GameType.BLACKJACK,
        gameId: crypto.randomUUID(),
        entryMultiplier: 1.0,
        exitMultiplier,
        payout: Number(totalPayout.toFixed(2)),
        status,
        timestamp: Date.now(),
    };
    db.createBet(bet);

    if (totalPayout > 0) {
        updateTournamentScores(bet);
        if (status === 'cashed_out') debitHouseForBetWin(bet, totalPayout);
    } else {
        creditHouseForBetLoss(bet);
    }
    const user = getUserById(session.userId);
    if (user) db.updateDailyLeaderboard(user.id, user.username, totalBet);

    sendToSocket(socket, 'BLACKJACK_RESULT', {
        stage: 'final',
        isFinal: true,
        outcomes,
        hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled })),
        dealerCards: session.dealerCards.map(formatCard),
        dealerTotal,
        newBalance: newBalancePost,
    });
    blackjackSessions.delete(socket.id);
}

// event handlers for hit/stand
function handleBlackjackHit(socket: any): void {
    const session = blackjackSessions.get(socket.id);
    if (!session) return sendError(socket, 'No active blackjack session.', 'NO_SESSION');
    const hand = session.hands[session.currentHand];
    hand.cards.push(drawCard());
    const playerTotal = getBlackjackTotal(hand.cards);
    const dealerTotal = getBlackjackTotal(session.dealerCards);

    if (playerTotal > 21) {
        hand.completed = true;
        // move to next hand or finalize
        if (session.currentHand + 1 < session.hands.length) {
            session.currentHand++;
            sendToSocket(socket, 'BLACKJACK_RESULT', {
                stage: 'next',
                isFinal: false,
                hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
                currentHand: session.currentHand,
                dealerCards: session.dealerCards.map(formatCard),
                dealerTotal,
                newBalance: session.preBalance,
            });
        } else {
            // finalize after dealer play
            while (dealerTotal < 17) {
                session.dealerCards.push(drawCard());
            }
            finalizeBlackjackSession(socket, session);
        }
        return;
    }
    // send updated state for current hand
    sendToSocket(socket, 'BLACKJACK_RESULT', {
        stage: 'hit',
        isFinal: false,
        hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
        currentHand: session.currentHand,
        dealerCards: session.dealerCards.map(formatCard),
        dealerTotal,
        newBalance: session.preBalance,
    });
}

function handleBlackjackStand(socket: any): void {
    const session = blackjackSessions.get(socket.id);
    if (!session) return sendError(socket, 'No active blackjack session.', 'NO_SESSION');
    const hand = session.hands[session.currentHand];
    hand.completed = true;
    // if more hands remain, advance without dealer play yet
    if (session.currentHand + 1 < session.hands.length) {
        session.currentHand++;
        const dealerTotal = getBlackjackTotal(session.dealerCards);
        sendToSocket(socket, 'BLACKJACK_RESULT', {
            stage: 'next',
            isFinal: false,
            hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
            currentHand: session.currentHand,
            dealerCards: session.dealerCards.map(formatCard),
            dealerTotal,
            newBalance: session.preBalance,
        });
        return;
    }
    // all player hands done; now dealer plays
    let dealerTotal = getBlackjackTotal(session.dealerCards);
    while (dealerTotal < 17) {
        session.dealerCards.push(drawCard());
        dealerTotal = getBlackjackTotal(session.dealerCards);
    }
    // finalize with multi-hand outcomes
    finalizeBlackjackSession(socket, session);
}

// allow player to split the current hand if two cards of same rank
function handleBlackjackSplit(socket: any): void {
    const session = blackjackSessions.get(socket.id);
    if (!session) return sendError(socket, 'No active blackjack session.', 'NO_SESSION');
    const hand = session.hands[session.currentHand];
    if (hand.cards.length !== 2) return sendError(socket, 'Can only split on initial two cards.', 'INVALID_SPLIT');
    const [c1, c2] = hand.cards;
    // simple rank compare (face value)
    const value = (c: PlayingCard) => c.rank; // 'K', '10', etc.
    if (value(c1) !== value(c2)) return sendError(socket, 'Cards must be same rank to split.', 'INVALID_SPLIT');
    // verify balance for additional bet
    const user = getUserBySocket(socket);
    if (!user) return sendError(socket, 'User not found.', 'INTERNAL');
    if (user.balance < hand.betAmount) return sendError(socket, 'Insufficient funds to split.', 'INSUFFICIENT_FUNDS');
    // deduct extra bet
    const newBal = Number((user.balance - hand.betAmount).toFixed(2));
    db.updateUserBalance(user.id, newBal);
    session.preBalance = newBal;
    // create two new hands
    const cardA = hand.cards[0];
    const cardB = hand.cards[1];
    const newHand1: BlackjackHand = { cards: [cardA, drawCard()], betAmount: hand.betAmount, doubled: false, completed: false };
    const newHand2: BlackjackHand = { cards: [cardB, drawCard()], betAmount: hand.betAmount, doubled: false, completed: false };
    // replace current hand with two
    session.hands.splice(session.currentHand, 1, newHand1, newHand2);
    // respond
    sendToSocket(socket, 'BLACKJACK_RESULT', {
        stage: 'split',
        isFinal: false,
        hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
        currentHand: session.currentHand,
        dealerCards: session.dealerCards.map(formatCard),
        dealerTotal: getBlackjackTotal(session.dealerCards),
        newBalance: session.preBalance,
    });
}

// double down on current hand: double bet, draw one card and stand
function handleBlackjackDouble(socket: any): void {
    const session = blackjackSessions.get(socket.id);
    if (!session) return sendError(socket, 'No active blackjack session.', 'NO_SESSION');
    const hand = session.hands[session.currentHand];
    if (hand.cards.length !== 2 || hand.doubled) return sendError(socket, 'Cannot double now.', 'INVALID_DOUBLE');
    const user = getUserBySocket(socket);
    if (!user) return sendError(socket, 'User not found.', 'INTERNAL');
    if (user.balance < hand.betAmount) return sendError(socket, 'Insufficient funds to double.', 'INSUFFICIENT_FUNDS');
    // deduct extra bet
    const newBal = Number((user.balance - hand.betAmount).toFixed(2));
    db.updateUserBalance(user.id, newBal);
    session.preBalance = newBal;
    hand.betAmount *= 2;
    hand.doubled = true;
    // draw one card and complete hand
    hand.cards.push(drawCard());
    hand.completed = true;
    // if additional hands exist, move to next
    if (session.currentHand + 1 < session.hands.length) {
        session.currentHand++;
        sendToSocket(socket, 'BLACKJACK_RESULT', {
            stage: 'double',
            isFinal: false,
            hands: session.hands.map(h => ({ cards: h.cards.map(formatCard), total: getBlackjackTotal(h.cards), bet: h.betAmount, doubled: h.doubled, completed: h.completed })),
            currentHand: session.currentHand,
            dealerCards: session.dealerCards.map(formatCard),
            dealerTotal: getBlackjackTotal(session.dealerCards),
            newBalance: session.preBalance,
        });
        return;
    }
    // else finalize after dealer play
    let dealerTotal = getBlackjackTotal(session.dealerCards);
    while (dealerTotal < 17) {
        session.dealerCards.push(drawCard());
        dealerTotal = getBlackjackTotal(session.dealerCards);
    }
    finalizeBlackjackSession(socket, session);
}

function handleBaccaratPlay(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const amount = parseAmount(payload?.amount);
    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
        return sendError(socket, `Bet amount must be between ${riskSettings.minBet} and ${riskSettings.maxBet}.`, 'BET_OUT_OF_RANGE');
    }
    if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

    const newBalancePre = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePre);

    const playerCards = [drawCard(), drawCard()];
    const bankerCards = [drawCard(), drawCard()];
    const playerTotal = getBaccaratTotal(playerCards);
    const bankerTotal = getBaccaratTotal(bankerCards);
    // payload may provide choice or betOn
    let betOn: 'player' | 'banker' | 'tie' = 'player';
    if (payload?.choice === 'banker' || payload?.choice === 'tie') {
        betOn = payload.choice;
    } else if (payload?.betOn === 'banker' || payload?.betOn === 'tie') {
        betOn = payload.betOn;
    }
    let outcome: 'win' | 'lose' | 'push' = 'lose';
    if (playerTotal === bankerTotal) {
        outcome = betOn === 'tie' ? 'win' : 'push';
    } else if (betOn === 'player') {
        outcome = playerTotal > bankerTotal ? 'win' : 'lose';
    } else if (betOn === 'banker') {
        outcome = bankerTotal > playerTotal ? 'win' : 'lose';
    }

    let payout = 0;
    let exitMultiplier = 0;
    let status: 'cashed_out' | 'lost' = 'lost';
    if (outcome === 'win') {
        exitMultiplier = betOn === 'tie' ? 9 : betOn === 'banker' ? 1.95 : 2;
        payout = Number((amount * exitMultiplier).toFixed(2));
        status = 'cashed_out';
    } else if (outcome === 'push') {
        exitMultiplier = 1;
        payout = Number(amount.toFixed(2));
        status = 'cashed_out';
    }

    const newBalancePost = Number((newBalancePre + payout).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePost);

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: Number(amount.toFixed(2)),
        gameType: GameType.BACCARAT,
        gameId: crypto.randomUUID(),
        entryMultiplier: 1.0,
        exitMultiplier,
        payout,
        status,
        timestamp: Date.now(),
    };
    db.createBet(bet);

    if (outcome === 'win') {
        updateTournamentScores(bet);
        debitHouseForBetWin(bet, payout);
    } else if (outcome === 'lose') {
        creditHouseForBetLoss(bet);
    }
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);

    sendToSocket(socket, 'BACCARAT_RESULT', {
        bet,
        outcome,
        betOn,
        playerCards: playerCards.map(formatCard),
        bankerCards: bankerCards.map(formatCard),
        playerTotal,
        bankerTotal,
        newBalance: newBalancePost,
    });
}

function handleTeenPattiPlay(socket: any, payload: any): void {
    const user = getUserBySocket(socket);
    if (!enforceRuntimeAccess(socket, user)) return;

    const amount = parseAmount(payload?.amount);
    if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
    if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
        return sendError(socket, `Bet amount must be between ${riskSettings.minBet} and ${riskSettings.maxBet}.`, 'BET_OUT_OF_RANGE');
    }
    if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

    const newBalancePre = Number((user!.balance - amount).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePre);

    const playerRank = pickTeenPattiRank();
    const dealerRank = pickTeenPattiRank();

    let outcome: 'win' | 'lose' | 'push' = 'lose';
    if (playerRank.strength > dealerRank.strength) {
        outcome = 'win';
    } else if (playerRank.strength < dealerRank.strength) {
        outcome = 'lose';
    } else {
        outcome = 'push';
    }

    let payout = 0;
    let exitMultiplier = 0;
    let status: 'cashed_out' | 'lost' = 'lost';
    if (outcome === 'win') {
        exitMultiplier = 2;
        payout = Number((amount * exitMultiplier).toFixed(2));
        status = 'cashed_out';
    } else if (outcome === 'push') {
        exitMultiplier = 1;
        payout = Number(amount.toFixed(2));
        status = 'cashed_out';
    }

    const newBalancePost = Number((newBalancePre + payout).toFixed(2));
    db.updateUserBalance(user!.id, newBalancePost);

    const bet: Bet = {
        id: crypto.randomUUID(),
        userId: user!.id,
        amount: Number(amount.toFixed(2)),
        gameType: GameType.TEEN_PATTI,
        gameId: crypto.randomUUID(),
        entryMultiplier: 1.0,
        exitMultiplier,
        payout,
        status,
        timestamp: Date.now(),
    };
    db.createBet(bet);

    if (outcome === 'win') {
        updateTournamentScores(bet);
        debitHouseForBetWin(bet, payout);
    } else if (outcome === 'lose') {
        creditHouseForBetLoss(bet);
    }
    if (user) db.updateDailyLeaderboard(user.id, user.username, amount);

    sendToSocket(socket, 'TEEN_PATTI_RESULT', {
        bet,
        outcome,
        playerRank: playerRank.name,
        dealerRank: dealerRank.name,
        newBalance: newBalancePost,
    });
}

function resolveGridRisk(risk: string | undefined): { risk: 'easy' | 'medium' | 'hard'; winChance: number; multiplier: number } {
  switch (risk) {
    case 'hard':
      return { risk: 'hard', winChance: 0.16, multiplier: 5 };
    case 'medium':
      return { risk: 'medium', winChance: 0.28, multiplier: 2.6 };
    default:
      return { risk: 'easy', winChance: 0.4, multiplier: 1.6 };
  }
}

function handleGridGamePlay(socket: any, payload: any, gameType: GameType): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) return;

  const amount = parseAmount(payload?.amount);
  const tileIndex = Number(payload?.tileIndex);
  if (amount === null || amount <= 0) return sendError(socket, 'Invalid amount.', 'INVALID_AMOUNT');
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex > 8) {
    return sendError(socket, 'Invalid tile selection.', 'INVALID_INPUT');
  }
  if (amount < riskSettings.minBet || amount > riskSettings.maxBet) {
    return sendError(socket, `Bet amount must be between ${riskSettings.minBet} and ${riskSettings.maxBet}.`, 'BET_OUT_OF_RANGE');
  }
  if (user!.balance < amount) return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');

  const riskConfig = resolveGridRisk(payload?.risk);
  const newBalancePre = Number((user!.balance - amount).toFixed(2));
  db.updateUserBalance(user!.id, newBalancePre);

  const won = Math.random() < riskConfig.winChance;
  const winningTile = won ? tileIndex : Math.floor(Math.random() * 9);
  const payout = won ? Number((amount * riskConfig.multiplier).toFixed(2)) : 0;
  const status: 'cashed_out' | 'lost' = won ? 'cashed_out' : 'lost';
  const exitMultiplier = won ? riskConfig.multiplier : 0;
  const newBalancePost = Number((newBalancePre + payout).toFixed(2));
  db.updateUserBalance(user!.id, newBalancePost);

  const bet: Bet = {
    id: crypto.randomUUID(),
    userId: user!.id,
    amount: Number(amount.toFixed(2)),
    gameType,
    gameId: crypto.randomUUID(),
    entryMultiplier: 1.0,
    exitMultiplier,
    payout,
    status,
    timestamp: Date.now(),
  };
  db.createBet(bet);

  if (won) {
    updateTournamentScores(bet);
    debitHouseForBetWin(bet, payout);
  } else {
    creditHouseForBetLoss(bet);
  }
  if (user) db.updateDailyLeaderboard(user.id, user.username, amount);

  sendToSocket(socket, `${gameType.toUpperCase()}_RESULT`, {
    bet,
    outcome: won ? 'win' : 'lose',
    tileIndex,
    winningTile,
    risk: riskConfig.risk,
    multiplier: riskConfig.multiplier,
    newBalance: newBalancePost,
  });
}

function handleCashOut(socket: any, payload?: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user, { allowFrozen: true })) {
    return;
  }

  const requestedType = payload?.gameType as GameType | undefined;
  const gameType = requestedType && isCrashGameType(requestedType) ? requestedType : GameType.AVIATOR;
  const result = cashOutForUser(user!.id, gameType);
  if (!result.ok) {
    return sendError(socket, result.message, result.code);
  }

  sendToSocket(socket, 'BET_WON', { bet: result.bet, newBalance: result.newBalance, auto: false });
  console.log(`User ${user!.username} cashed out at ${result.bet.exitMultiplier}x. Payout: ${result.bet.payout?.toFixed(2)}`);
}

function handleDeposit(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const amount = parseAmount(payload?.amount);
  if (amount === null || amount <= 0) {
    return sendError(socket, 'Invalid deposit amount.', 'INVALID_AMOUNT');
  }

  db.deposit(user!.id, amount);
  const updatedUser = db.findUserById(user!.id);
  if (!updatedUser) {
    return sendError(socket, 'User not found.', 'USER_NOT_FOUND');
  }

  sendToSocket(socket, 'DEPOSIT_SUCCESS', { newBalance: updatedUser.balance });
}

function handleWithdraw(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const amount = parseAmount(payload?.amount);
  if (amount === null || amount <= 0) {
    return sendError(socket, 'Invalid withdrawal amount.', 'INVALID_AMOUNT');
  }

  if (user!.balance < amount) {
    return sendError(socket, 'Insufficient funds.', 'INSUFFICIENT_FUNDS');
  }

  db.withdraw(user!.id, amount);
  const updatedUser = db.findUserById(user!.id);
  if (!updatedUser) {
    return sendError(socket, 'User not found.', 'USER_NOT_FOUND');
  }

  sendToSocket(socket, 'WITHDRAW_SUCCESS', { newBalance: updatedUser.balance });
}

function handleClaimDailyBonus(socket: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const now = Date.now();
  const lastClaim = user!.lastDailyBonus || 0;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (now - lastClaim < oneDayMs) {
    const nextClaimTime = lastClaim + oneDayMs;
    const timeLeft = Math.ceil((nextClaimTime - now) / (60 * 1000)); // minutes
    return sendError(socket, `Daily bonus not ready. Try again in ${timeLeft} minutes.`, 'BONUS_COOLDOWN');
  }

  const newBalance = Number((user!.balance + DAILY_BONUS_AMOUNT).toFixed(2));
  db.updateUserBalance(user!.id, newBalance);
  db.updateLastDailyBonus(user!.id, now);

  sendToSocket(socket, 'DAILY_BONUS_CLAIMED', { amount: DAILY_BONUS_AMOUNT, newBalance });
}

function handleTransferFunds(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const { recipientUsername, amount } = payload || {};
  const parsedAmount = parseAmount(amount);

  if (!recipientUsername || typeof recipientUsername !== 'string') {
    return sendError(socket, 'Recipient username is required.', 'INVALID_INPUT');
  }
  if (parsedAmount === null || parsedAmount <= 0) {
    return sendError(socket, 'Invalid transfer amount.', 'INVALID_AMOUNT');
  }

  const recipient = db.findUserByUsername(recipientUsername);
  if (!recipient) {
    return sendError(socket, 'Recipient user not found.', 'USER_NOT_FOUND');
  }
  if (recipient.id === user!.id) {
    return sendError(socket, 'Cannot transfer funds to yourself.', 'INVALID_OPERATION');
  }

  db.transferFunds(user!.id, recipient.id, parsedAmount);
  sendToSocket(socket, 'TRANSFER_SUCCESS', { amount: parsedAmount, recipient: recipient.username, newBalance: user!.balance - parsedAmount });
}

function handleUpdateProfile(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const { username, phoneNumber } = payload || {};
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return sendError(socket, 'Invalid username (min 3 chars).', 'INVALID_INPUT');
  }

  const trimmedUsername = username.trim();
  const trimmedPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : null;

  if (trimmedUsername !== user!.username) {
    const existing = db.findUserByUsername(trimmedUsername);
    if (existing) {
      return sendError(socket, 'Username already taken.', 'USERNAME_TAKEN');
    }
  }

  db.updateUserProfile(user!.id, trimmedUsername, trimmedPhone);
  const updatedUser = db.findUserById(user!.id);
  sendToSocket(socket, 'PROFILE_UPDATED', getPublicUser(updatedUser!));
}

async function handleChangePassword(socket: any, payload: any): Promise<void> {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) return;

  const { oldPassword, newPassword } = payload || {};
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return sendError(socket, 'Invalid password data (min 6 chars).', 'INVALID_INPUT');
  }

  const match = await bcrypt.compare(oldPassword, user!.password);
  if (!match) {
    return sendError(socket, 'Incorrect old password.', 'INVALID_CREDENTIALS');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  db.updateUserPassword(user!.id, hashedPassword);
  sendToSocket(socket, 'PASSWORD_CHANGED', { message: 'Password updated successfully.' });
}

const profanityList = ['darn', 'heck', 'gosh', 'shoot'];

function filterProfanity(message: string): string {
  let filteredMessage = message;
  profanityList.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
  });
  return filteredMessage;
}

function maskUsername(username: string): string {
  if (username.length <= 3) return username;
  const first = username.slice(0, 3);
  const last = username.slice(-2);
  return `${first}***${last}`;
}

function handleChatMessage(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!enforceRuntimeAccess(socket, user)) {
    return;
  }

  const now = Date.now();
  const lastMessageTime = chatRateLimit.get(user!.id) || 0;
  if (now - lastMessageTime < 1000) {
    return sendError(socket, 'You are sending messages too fast.', 'RATE_LIMIT_EXCEEDED');
  }

  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  if (!message) {
    return;
  }

  chatRateLimit.set(user!.id, now);
  const cleanMessage = filterProfanity(message);
  const maskedUsername = maskUsername(user!.username);

  const chatMsg: ChatMessage = {
    id: crypto.randomUUID(),
    userId: user!.id,
    username: maskedUsername,
    message: cleanMessage,
    timestamp: now,
  };
  db.createChatMessage(chatMsg);
  broadcast('CHAT_MESSAGE', chatMsg);
}

function handleAdminSetRisk(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!user) {
    return sendError(socket, 'Authentication required.', 'AUTH_REQUIRED');
  }
  if (user.role !== 'admin') {
    return sendError(socket, 'Admin access required.', 'FORBIDDEN');
  }

  const incoming: Partial<RiskSettings> = {
    minBet: typeof payload?.minBet === 'number' ? payload.minBet : undefined,
    maxBet: typeof payload?.maxBet === 'number' ? payload.maxBet : undefined,
    maintenanceMode: typeof payload?.maintenanceMode === 'boolean' ? payload.maintenanceMode : undefined,
    gamePaused: typeof payload?.gamePaused === 'boolean' ? payload.gamePaused : undefined,
  };

  applyRiskSettings(sanitizeRiskSettings(incoming, riskSettings), user.id);
  sendToSocket(socket, 'RISK_SETTINGS', riskSettings);
}

function handleAdminSendDirectMessage(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!user) {
    return sendError(socket, 'Authentication required.', 'AUTH_REQUIRED');
  }
  if (user.role !== 'admin') {
    return sendError(socket, 'Admin access required.', 'FORBIDDEN');
  }

  const { username, message } = payload || {};
  if (!username || typeof username !== 'string' || !message || typeof message !== 'string') {
    return sendError(socket, 'Username and message are required.', 'INVALID_INPUT');
  }

  const recipient = db.findUserByUsername(username);
  if (!recipient) {
    return sendError(socket, 'Recipient user not found.', 'USER_NOT_FOUND');
  }

  const recipientSocketId = userIdToSocketId.get(recipient.id);
  if (recipientSocketId && engine.clients[recipientSocketId]) {
    sendToSocket(engine.clients[recipientSocketId], 'DIRECT_MESSAGE', {
      from: user.username,
      message: message.trim(),
    });
  }

  // Log admin action
  const log: AdminLog = {
    id: crypto.randomUUID(),
    adminId: user.id,
    action: 'SEND_DIRECT_MESSAGE',
    targetUserId: recipient.id,
    details: `Sent DM: "${message.substring(0, 50)}..."`,
    timestamp: Date.now(),
  };
  db.createAdminLog(log);

  sendToSocket(socket, 'MESSAGE_SENT', {
    success: true,
    recipient: username,
  });
}

function handleAdminForceCrash(socket: any, payload: any): void {
  const user = getUserBySocket(socket);
  if (!user) {
    return sendError(socket, 'Authentication required.', 'AUTH_REQUIRED');
  }
  if (user.role !== 'admin') {
    return sendError(socket, 'Admin access required.', 'FORBIDDEN');
  }
  const requestedType = payload?.gameType as GameType | undefined;
  const gameType = requestedType && isCrashGameType(requestedType) ? requestedType : GameType.AVIATOR;
  const game = getCrashGame(gameType);
  if (!game) {
    return sendError(socket, 'Game not found.', 'GAME_NOT_FOUND');
  }
  const ok = game.forceCrash();
  if (!ok) {
    return sendError(socket, 'Game is not in flight.', 'NOT_FLYING');
  }
  const log: AdminLog = {
    id: crypto.randomUUID(),
    adminId: user.id,
    action: 'FORCE_CRASH',
    details: `Forced crash on ${gameType}`,
    timestamp: Date.now(),
  };
  db.createAdminLog(log);
  sendToSocket(socket, 'SYSTEM_NOTICE', { message: `${gameType.toUpperCase()} forced to crash.` });
}

// REST API routes
router.get('/gamestate', (req: http.IncomingMessage, res: http.ServerResponse) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const gameTypeParam = requestUrl.searchParams.get('gameType') as GameType | null;
  const gameType = gameTypeParam && isCrashGameType(gameTypeParam) ? gameTypeParam : GameType.AVIATOR;
  const game = getCrashGame(gameType) || aviatorGame;
  sendJson(res, 200, { ...game.getState(), gameType });
});

router.get('/leaderboard', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendJson(res, 200, db.getLeaderboard(10));
});

router.get('/rounds', (req: http.IncomingMessage, res: http.ServerResponse) => {
  const { limit } = getPagination(req);
  sendJson(res, 200, db.getRecentRounds(limit));
});

router.get('/fairness/current', (req: http.IncomingMessage, res: http.ServerResponse) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const gameTypeParam = requestUrl.searchParams.get('gameType') as GameType | null;
  const gameType = gameTypeParam && isCrashGameType(gameTypeParam) ? gameTypeParam : GameType.AVIATOR;
  const game = getCrashGame(gameType) || aviatorGame;
  sendJson(res, 200, { ...game.getCurrentFairnessCommitment(), gameType });
});

router.get('/risk-settings', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendJson(res, 200, riskSettings);
});
router.get('/admin/house-summary', authenticateAdmin, (_req: AuthenticatedRequest, res: http.ServerResponse) => {
  const houseAdmin = resolveHouseAdmin();
  sendJson(res, 200, {
    houseAdmin: houseAdmin
      ? { id: houseAdmin.id, username: houseAdmin.username, balance: houseAdmin.balance }
      : null,
    activeUsersCount: userIdToSocketId.size,
  });
});

router.get('/admin/active-users', authenticateAdmin, (_req: AuthenticatedRequest, res: http.ServerResponse) => {
  const activeUsers = Array.from(userIdToSocketId.entries())
    .map(([userId, socketId]) => {
      const user = db.findUserById(userId);
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        balance: user.balance,
        role: user.role,
        status: user.status,
        socketId,
      };
    })
    .filter(Boolean);
  sendJson(res, 200, activeUsers);
});

router.get('/admin/bets', authenticateAdmin, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const { page, limit, offset } = getPagination(req);
  const bets = db.getAllBetsPaginated(limit, offset);
  const total = db.countAllBets();

  sendJson(res, 200, {
    data: bets,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/admin/logs', authenticateAdmin, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const { page, limit, offset } = getPagination(req);
  const logs = db.getAdminLogsPaginated(limit, offset);
  const total = db.countAdminLogs();

  sendJson(res, 200, {
    data: logs,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/admin/risk-settings', authenticateAdmin, (_req: AuthenticatedRequest, res: http.ServerResponse) => {
  sendJson(res, 200, riskSettings);
});

router.post('/admin/risk-settings', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const incoming: Partial<RiskSettings> = {
      minBet: typeof body?.minBet === 'number' ? body.minBet : undefined,
      maxBet: typeof body?.maxBet === 'number' ? body.maxBet : undefined,
      maintenanceMode: typeof body?.maintenanceMode === 'boolean' ? body.maintenanceMode : undefined,
      gamePaused: typeof body?.gamePaused === 'boolean' ? body.gamePaused : undefined,
    };

    applyRiskSettings(sanitizeRiskSettings(incoming, riskSettings), req.user!.id);
    sendJson(res, 200, { success: true, riskSettings });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.' });
      return;
    }
    console.error('Admin risk settings error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

router.post('/admin/balance', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const { userId, amount, reason } = body;
    const sanitizedAmount = parseAmount(amount);

    if (!userId || sanitizedAmount === null || sanitizedAmount < 0) {
      sendJson(res, 400, { error: 'userId and amount (number >= 0) are required.' });
      return;
    }

    const user = db.findUserById(userId);
    if (!user) {
      sendJson(res, 404, { error: 'User not found.' });
      return;
    }

    const oldBalance = user.balance;
    db.updateUserBalance(userId, sanitizedAmount);

    const log: AdminLog = {
      id: crypto.randomUUID(),
      adminId: req.user!.id,
      action: 'UPDATE_BALANCE',
      targetUserId: userId,
      details: `Updated balance from ${oldBalance} to ${sanitizedAmount}. Reason: ${reason || 'No reason provided'}`,
      timestamp: Date.now(),
    };
    db.createAdminLog(log);

    sendJson(res, 200, { success: true, newBalance: sanitizedAmount });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.' });
      return;
    }
    console.error('Admin balance update error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

router.post('/admin/user-status', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const { userId, status, reason } = body;

    if (!userId || !status || !['active', 'frozen', 'banned'].includes(status)) {
      sendJson(res, 400, { error: 'userId and valid status ("active", "frozen", "banned") are required.' });
      return;
    }

    const user = db.findUserById(userId);
    if (!user) {
      sendJson(res, 404, { error: 'User not found.' });
      return;
    }

    db.updateUserStatus(userId, status);

    const log: AdminLog = {
      id: crypto.randomUUID(),
      adminId: req.user!.id,
      action: 'UPDATE_USER_STATUS',
      targetUserId: userId,
      details: `Set user status to ${status}. Reason: ${reason || 'No reason provided'}`,
      timestamp: Date.now(),
    };
    db.createAdminLog(log);

    const socketId = userIdToSocketId.get(userId);
    if (socketId && engine.clients[socketId]) {
      if (status === 'banned') {
        sendToSocket(engine.clients[socketId], 'ERROR', { message: 'Your account has been banned.', code: 'ACCOUNT_BANNED' });
        engine.clients[socketId].close();
      } else if (status === 'frozen') {
        sendToSocket(engine.clients[socketId], 'ERROR', { message: 'Your account has been frozen pending review.', code: 'ACCOUNT_FROZEN' });
      } else {
        sendToSocket(engine.clients[socketId], 'SYSTEM_NOTICE', { message: 'Your account status is now active.' });
      }
    }

    sendJson(res, 200, { success: true, userId, status });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.' });
      return;
    }
    console.error('Admin user status update error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

router.get('/admin/promocodes', authenticateAdmin, (_req: AuthenticatedRequest, res: http.ServerResponse) => {
  sendJson(res, 200, db.getAllPromoCodes());
});

router.post('/admin/promocodes', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const { code, amount, maxUses, daysValid } = body;

    if (!code || !amount || !maxUses || !daysValid) {
      sendJson(res, 400, { error: 'Missing required fields: code, amount, maxUses, daysValid' });
      return;
    }

    const promo: PromoCode = {
      code: String(code).toUpperCase(),
      amount: Number(amount),
      maxUses: Number(maxUses),
      usedCount: 0,
      expiresAt: Date.now() + (Number(daysValid) * 24 * 60 * 60 * 1000),
      createdBy: req.user!.id,
    };

    db.createPromoCode(promo);
    sendJson(res, 200, { success: true, promo });
  } catch (err) {
    console.error('Create promo code error:', err);
    sendJson(res, 500, { error: 'Internal server error or code already exists.' });
  }
});

router.post('/promocodes/redeem', authenticateToken, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const code = String(body?.code || '').toUpperCase();
    const userId = req.user!.id;

    const promo = db.getPromoCode(code);
    if (!promo) {
      sendJson(res, 404, { error: 'Invalid promo code.' });
      return;
    }
    if (Date.now() > promo.expiresAt || promo.usedCount >= promo.maxUses) {
      sendJson(res, 400, { error: 'Promo code expired or fully claimed.' });
      return;
    }
    if (db.hasUserRedeemedPromo(userId, code)) {
      sendJson(res, 400, { error: 'You have already redeemed this code.' });
      return;
    }

    db.redeemPromoCode(userId, code, promo.amount);
    sendJson(res, 200, { success: true, amount: promo.amount });
  } catch (err) {
    console.error('Redeem promo error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

router.get('/notifications', (_req: http.IncomingMessage, res: http.ServerResponse) => {
  sendJson(res, 200, db.getRecentNotifications(5));
});

router.post('/admin/notifications', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const body = await getJsonBody(req);
    const { title, message, type } = body;

    if (!title || !message || !['info', 'warning', 'success', 'error'].includes(type)) {
      sendJson(res, 400, { error: 'Missing required fields: title, message, type (info, warning, success, error)' });
      return;
    }

    const notification: Notification = {
      id: crypto.randomUUID(),
      title,
      message,
      type,
      timestamp: Date.now(),
    };

    db.createNotification(notification);
    broadcast('SYSTEM_NOTIFICATION', notification);
    sendJson(res, 200, { success: true, notification });
  } catch (err) {
    console.error('Create notification error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

router.get('/tournaments', (_req: http.IncomingMessage, res: http.ServerResponse) => {
    sendJson(res, 200, db.getActiveTournaments());
});

router.get('/leaderboard/daily', (_req: http.IncomingMessage, res: http.ServerResponse) => {
    sendJson(res, 200, db.getDailyLeaderboard());
});

router.get('/tournaments/:id/leaderboard', (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const id = url.pathname.split('/')[2];
    if (!id) return sendJson(res, 400, { error: 'Tournament ID required' });
    sendJson(res, 200, db.getTournamentLeaderboard(id));
});

router.post('/tournaments/:id/join', authenticateToken, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
    const user = db.findUserById(req.user!.id);
    if (!user) return sendJson(res, 404, { error: 'User not found' });

    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const tournamentId = url.pathname.split('/')[2];
    const tournament = db.getTournament(tournamentId);

    if (!tournament || tournament.status !== 'scheduled') {
        return sendJson(res, 400, { error: 'Tournament not available for joining.' });
    }

    if (user.balance < tournament.entryFee) {
        return sendJson(res, 400, { error: 'Insufficient balance for entry fee.' });
    }

    if (tournament.entryFee > 0) {
        db.updateUserBalance(user.id, user.balance - tournament.entryFee);
    }

    db.joinTournament(tournament.id, user);
    sendJson(res, 200, { success: true, message: `Successfully joined "${tournament.name}"` });
});

router.post('/admin/tournaments', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
    try {
        const body = await getJsonBody(req);
        const { name, gameType, startTime, endTime, prizePool, entryFee } = body;
        if (!name || !gameType || !startTime || !endTime) {
            return sendJson(res, 400, { error: 'Missing required fields' });
        }

        const tournament: Tournament = {
            id: crypto.randomUUID(),
            name,
            gameType,
            startTime: Number(startTime),
            endTime: Number(endTime),
            prizePool: Number(prizePool || 0),
            entryFee: Number(entryFee || 0),
            status: 'scheduled',
            createdBy: req.user!.id,
        };
        db.createTournament(tournament);
        broadcast('TOURNAMENT_CREATED', tournament);
        sendJson(res, 201, tournament);
    } catch (err) {
        console.error('Create tournament error:', err);
        sendJson(res, 500, { error: 'Internal server error' });
    }
});

router.post('/admin/tournaments/score', authenticateAdmin, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
    try {
        const body = await getJsonBody(req);
        const { tournamentId, userId, score } = body;

        if (!tournamentId || !userId || typeof score !== 'number') {
             return sendJson(res, 400, { error: 'Missing required fields: tournamentId, userId, score (number)' });
        }

        const tournament = db.getTournament(tournamentId);
        if (!tournament) {
            return sendJson(res, 404, { error: 'Tournament not found' });
        }

        db.setTournamentScore(tournamentId, userId, score);

        broadcast('TOURNAMENT_UPDATE', {
            tournamentId: tournament.id,
            leaderboard: db.getTournamentLeaderboard(tournament.id)
        });

        sendJson(res, 200, { success: true });
    } catch (err) {
        console.error('Update tournament score error:', err);
        sendJson(res, 500, { error: 'Internal server error' });
    }
});

router.get('/transactions/me', authenticateToken, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const userId = req.user!.id;
  const { page, limit, offset } = getPagination(req);

  const transactions = db.getTransactionsForUserPaginated(userId, limit, offset);
  const total = db.countTransactionsForUser(userId);

  sendJson(res, 200, {
    data: transactions,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/bets/me', authenticateToken, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const userId = req.user!.id;
  const { page, limit, offset } = getPagination(req);

  const bets = db.getBetHistoryForUserPaginated(userId, limit, offset);
  const total = db.countBetsForUser(userId);

  sendJson(res, 200, {
    data: bets,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/stats/me', authenticateToken, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const userId = req.user!.id;
  sendJson(res, 200, db.getUserStats(userId));
});

router.get('/autoplay/me', authenticateToken, (req: AuthenticatedRequest, res: http.ServerResponse) => {
  const userId = req.user!.id;
  sendJson(res, 200, getAutoPlayConfig(userId));
});

router.post('/autoplay/me', authenticateToken, async (req: AuthenticatedRequest, res: http.ServerResponse) => {
  try {
    const userId = req.user!.id;
    const user = db.findUserById(userId);
    if (!user) {
      sendJson(res, 404, { error: 'User not found.' });
      return;
    }
    if (isMaintenanceBlockedForUser(user)) {
      sendJson(res, 403, { error: 'System is under maintenance.' });
      return;
    }

    const body = await getJsonBody(req);
    const current = getAutoPlayConfig(userId);
    const nextConfig = sanitizeAutoPlayConfig(userId, body, current, riskSettings);
    persistAutoPlayConfig(nextConfig);

    sendJson(res, 200, nextConfig);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.' });
      return;
    }
    console.error('Autoplay update error:', err);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

async function manageTournaments() {
    const now = Date.now();

    // Start scheduled tournaments
    const scheduled = db.getTournamentsByStatus('scheduled');
    for (const t of scheduled) {
        if (now >= t.startTime) {
            t.status = 'active';
            db.updateTournament(t);
            const notification: Notification = {
                id: crypto.randomUUID(),
                title: 'Tournament Started!',
                message: `The "${t.name}" tournament for ${t.gameType} has begun! Good luck!`,
                type: 'success',
                timestamp: now,
            };
            db.createNotification(notification);
            broadcast('SYSTEM_NOTIFICATION', notification);
            broadcast('TOURNAMENT_UPDATE', { tournamentId: t.id, status: 'active' });
            console.log(`Tournament ${t.id} (${t.name}) has started.`);
        }
    }

    // End active tournaments and distribute prizes
    const active = db.getTournamentsByStatus('active');
    for (const t of active) {
        if (now >= t.endTime) {
            t.status = 'finished';
            db.updateTournament(t);

            const leaderboard = db.getTournamentLeaderboard(t.id);
            const prizeDistribution = [0.5, 0.3, 0.2]; // Top 3: 50%, 30%, 20%

            for (let i = 0; i < Math.min(leaderboard.length, prizeDistribution.length); i++) {
                const winner = leaderboard[i];
                const prize = Math.floor(t.prizePool * prizeDistribution[i]);
                if (prize > 0) {
                    const user = db.findUserById(winner.userId);
                    if (user) {
                        db.updateUserBalance(user.id, user.balance + prize);
                        const prizeNotification: Notification = {
                            id: crypto.randomUUID(),
                            title: 'Tournament Prize Won!',
                            message: `Congratulations! You won $${prize.toFixed(2)} in the "${t.name}" tournament for placing #${winner.rank}.`,
                            type: 'success',
                            timestamp: now,
                        };
                        db.createNotification(prizeNotification);
                        const socketId = userIdToSocketId.get(user.id);
                        if (socketId && engine.clients[socketId]) {
                            sendToSocket(engine.clients[socketId], 'SYSTEM_NOTIFICATION', prizeNotification);
                        }
                    }
                }
            }

            const finishNotification: Notification = {
                id: crypto.randomUUID(),
                title: 'Tournament Finished',
                message: `The "${t.name}" tournament has ended. Check the leaderboards for results!`,
                type: 'info',
                timestamp: now,
            };
            db.createNotification(finishNotification);
            broadcast('SYSTEM_NOTIFICATION', finishNotification);
            broadcast('TOURNAMENT_UPDATE', { tournamentId: t.id, status: 'finished' });
            console.log(`Tournament ${t.id} (${t.name}) has finished.`);
        }
    }
}

function scheduleDailyLeaderboardReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    const timeToMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
        console.log('Resetting daily leaderboard...');
        db.clearDailyLeaderboard();
        setInterval(() => db.clearDailyLeaderboard(), 24 * 60 * 60 * 1000);
    }, timeToMidnight);
}

// Game event handling
function registerCrashGameEvents(gameType: GameType, game: AviatorGame): void {
  game.on('stateChange', (state: GameState) => {
    broadcast('GAME_STATE', { ...state, gameType });
    if (state.status === 'waiting') {
      processAutoBetsForRound(state, gameType);
    }
  });

  game.on('tick', (state: GameState) => {
    processAutoCashOut(state, gameType);
    broadcast('GAME_TICK', { ...state, gameType });
  });

  game.on('crash', (state: GameState) => {
    broadcast('GAME_CRASH', { ...state, gameType });

    const reveal = game.getCurrentFairnessReveal();
    const roundEntry: RoundHistoryEntry = {
      gameId: reveal.gameId,
      crashMultiplier: reveal.crashMultiplier,
      timestamp: Date.now(),
      serverSeedHash: reveal.serverSeedHash,
      serverSeed: reveal.serverSeed,
      nonce: reveal.nonce,
    };
    db.createRoundHistory(roundEntry);

    broadcast('PROVABLY_FAIR_REVEAL', { ...reveal, gameType });
    broadcast('ROUND_RESULT', { ...roundEntry, gameType });

    const lostBets = db.markActiveBetsAsLost(state.gameId);
    const houseCredit = creditHouseOnLostBets(lostBets);
    if (houseCredit.creditedAmount > 0) {
      console.log(`House credit: ${houseCredit.creditedAmount.toFixed(2)} -> admin ${houseCredit.adminId}`);
    }
    lostBets.forEach((lostBet) => {
      const socketId = userIdToSocketId.get(lostBet.userId);
      if (socketId && engine.clients[socketId]) {
        const user = db.findUserById(lostBet.userId);
        sendToSocket(engine.clients[socketId], 'BET_LOST', {
          bet: lostBet,
          betId: lostBet.id,
          newBalance: user?.balance,
        });
      }
    });
  });
}

crashGameTypes.forEach((gameType) => {
  const game = getCrashGame(gameType);
  if (game) {
    registerCrashGameEvents(gameType, game);
  }
});

// Socket event handling
engine.on('connection', (socket: any) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('close', (reason: any) => {
    console.log(`Client disconnected: ${socket.id} reason=${reason}`);
  });
  socket.on('error', (err: any) => {
    console.log(`Socket error: ${socket.id} ${err?.message || err}`);
  });

  crashGameTypes.forEach((gameType) => {
    const game = getCrashGame(gameType);
    if (game) {
      sendToSocket(socket, 'GAME_STATE', { ...game.getState(), gameType });
    }
  });
  sendUserRiskSettings(socket);
  sendToSocket(socket, 'CHAT_HISTORY', db.getRecentChatMessages(50));

  socket.on('message', (data: any) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      switch (message.type) {
        case 'REGISTER':
          handleRegister(socket, message.payload);
          break;
        case 'LOGIN':
          handleLogin(socket, message.payload);
          break;
        case 'AUTH_RESUME':
          handleAuthResume(socket, message.payload);
          break;
        case 'RESET_PASSWORD':
          handleResetPassword(socket, message.payload);
          break;
        case 'SET_AUTOPLAY':
          handleSetAutoPlay(socket, message.payload);
          break;
        case 'PLACE_BET':
          handlePlaceBet(socket, message.payload);
          break;
        case 'PLACE_DICE_BET':
          handlePlaceDiceBet(socket, message.payload);
          break;
        case 'MINES_START_GAME':
          handleMinesStartGame(socket, message.payload);
          break;
        case 'MINES_REVEAL_TILE':
          handleMinesRevealTile(socket, message.payload);
          break;
        case 'MINES_CASHOUT':
          handleMinesCashout(socket);
          break;
        case 'PLINKO_DROP':
          handlePlinkoDrop(socket, message.payload);
          break;
        case 'HILO_START_GAME':
          handleHiloStartGame(socket, message.payload);
          break;
        case 'HILO_BET':
          handleHiloBet(socket, message.payload);
          break;
        case 'HILO_CASHOUT':
          handleHiloCashout(socket);
          break;
        case 'PLACE_ROULETTE_BET':
          handlePlaceRouletteBet(socket, message.payload);
          break;
        case 'PLAY_BLACKJACK':
          handleBlackjackPlay(socket, message.payload);
          break;
        case 'PLAY_BACCARAT':
          handleBaccaratPlay(socket, message.payload);
          break;
        case 'PLAY_TEEN_PATTI':
          handleTeenPattiPlay(socket, message.payload);
          break;
        case 'BLACKJACK_HIT':
          handleBlackjackHit(socket);
          break;
        case 'BLACKJACK_STAND':
          handleBlackjackStand(socket);
          break;
        case 'BLACKJACK_SPLIT':
          handleBlackjackSplit(socket);
          break;
        case 'BLACKJACK_DOUBLE':
          handleBlackjackDouble(socket);
          break;
        case 'PLAY_TOWER':
          handleGridGamePlay(socket, message.payload, GameType.TOWER);
          break;
        case 'PLAY_DRAGON_TOWER':
          handleGridGamePlay(socket, message.payload, GameType.DRAGON_TOWER);
          break;
        case 'PLAY_TREASURE_HUNT':
          handleGridGamePlay(socket, message.payload, GameType.TREASURE_HUNT);
          break;
        case 'ADMIN_UPDATE_TOURNAMENT':
          // Placeholder for a websocket based update
          break;
        case 'CASH_OUT':
          handleCashOut(socket, message.payload);
          break;
        case 'DEPOSIT':
          handleDeposit(socket, message.payload);
          break;
        case 'WITHDRAW':
          handleWithdraw(socket, message.payload);
          break;
        case 'CLAIM_DAILY_BONUS':
          handleClaimDailyBonus(socket);
          break;
        case 'TRANSFER_FUNDS':
          handleTransferFunds(socket, message.payload);
          break;
        case 'UPDATE_PROFILE':
          handleUpdateProfile(socket, message.payload);
          break;
        case 'CHANGE_PASSWORD':
          handleChangePassword(socket, message.payload);
          break;
        case 'CHAT_MESSAGE':
          handleChatMessage(socket, message.payload);
          break;
        case 'ADMIN_SET_RISK':
          handleAdminSetRisk(socket, message.payload);
          break;
        case 'ADMIN_SEND_DM':
          handleAdminSendDirectMessage(socket, message.payload);
          break;
        case 'ADMIN_FORCE_CRASH':
          handleAdminForceCrash(socket, message.payload);
          break;
        default:
          sendError(socket, `Unknown message type: ${message.type}`, 'UNKNOWN_COMMAND');
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
      sendError(socket, 'Invalid message format.', 'INVALID_FORMAT');
    }
  });

  socket.on('close', () => {
    const userId = socketIdToUserId.get(socket.id);
    if (userId) {
      db.disableAutoPlayForUser(userId);
      socketIdToUserId.delete(socket.id);
      userIdToSocketId.delete(userId);
      console.log(`User with ID ${userId} disconnected. Auto-bet disabled.`);
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

async function seedAdminFromEnv(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username && !password) {
    return;
  }
  if (!username || !password) {
    console.warn('Both SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD must be set to seed an admin.');
    return;
  }

  const existingUser = db.findUserByUsername(username);
  if (existingUser) {
    if (existingUser.role === 'admin') {
      console.log(`Admin user "${username}" already exists. Skipping seed.`);
      return;
    }
    console.warn(`User "${username}" already exists as role "${existingUser.role}". Admin seed skipped.`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const adminUser: User = {
    id: crypto.randomUUID(),
    username,
    password: hashedPassword,
    balance: DEFAULT_ADMIN_BALANCE,
    role: 'admin',
    status: 'active',
  };
  db.createUser(adminUser);
  persistAutoPlayConfig(getDefaultAutoPlayConfig(adminUser.id));
  console.log(`Seeded admin user "${username}".`);
}

async function start(): Promise<void> {
  console.log('Starting server initialization...');
  await seedAdminFromEnv();
  console.log('Admin seeded, scheduling tasks...');
  scheduleDailyLeaderboardReset();
  setInterval(manageTournaments, 15 * 1000); // Check tournaments every 15 seconds
  console.log(`Server listening on port ${PORT}...`);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Betting server is running on port ${PORT}`);
  });
}

process.on('SIGINT', () => {
  crashGameTypes.forEach((gameType) => {
    const game = getCrashGame(gameType);
    if (game) {
      game.shutdown();
    }
  });
  // Do not exit; let server stay alive for Render
  console.log('SIGINT received, server will stay alive for Render.');
});
process.on('SIGTERM', () => {
  crashGameTypes.forEach((gameType) => {
    const game = getCrashGame(gameType);
    if (game) {
      game.shutdown();
    }
  });
  // Do not exit; let server stay alive for Render
  console.log('SIGTERM received, server will stay alive for Render.');
});

void start().catch((error) => {
  console.error('Failed to start server:', error);
  // Do not exit; log error and keep process alive for Render
  console.log('Server will continue running despite the error.');
});

export interface User {
  id: string;
  username: string;
  // In a real app, this would be a securely hashed password
  password: string;
  balance: number;
  role: 'player' | 'admin';
  status: 'active' | 'frozen' | 'banned';
  referredBy?: string;
  lastDailyBonus?: number;
  phoneNumber?: string;
  recoveryKey?: string;
}

export enum GameType {
  AVIATOR = 'aviator',
  JETX = 'jetx',
  SPACEMAN = 'spaceman',
  CRASH = 'crash',
  BALLOON = 'balloon',
  DICE = 'dice',
  MINES = 'mines',
  PLINKO = 'plinko',
  HILO = 'hilo',
  ROULETTE = 'roulette',
  BLACKJACK = 'blackjack',
  BACCARAT = 'baccarat',
  TEEN_PATTI = 'teen_patti',
  TOWER = 'tower',
  DRAGON_TOWER = 'dragon_tower',
  TREASURE_HUNT = 'treasure_hunt',
}

export interface Bet {
  id: string;
  userId: string;
  amount: number;
  gameType: GameType;
  gameId: string;
  entryMultiplier: number;
  exitMultiplier?: number;
  payout?: number;
  status: 'active' | 'cashed_out' | 'lost';
  timestamp: number;
}

export interface GameState {
  status: 'waiting' | 'flying' | 'crashed';
  multiplier: number;
  gameId: string;
  serverSeedHash?: string;
  nonce?: number;
  paused?: boolean;
  // Dice specific
  roll?: number;
  target?: number;
  condition?: 'over' | 'under';
  winChance?: number;
  payoutMultiplier?: number;
}

export interface ClientMessage {
  type: string;
  payload: any;
}

export interface Transaction {
  id: string;
  userId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  status: 'pending' | 'success' | 'failed';
  externalId?: string;
  timestamp: number;
}

export interface AdminLog {
  id: string;
  adminId: string;
  action: string;
  targetUserId?: string;
  details?: string;
  timestamp: number;
}

export interface RoundHistoryEntry {
  gameId: string;
  crashMultiplier: number;
  timestamp: number;
  serverSeedHash: string;
  serverSeed: string;
  nonce: number;
}

export interface AutoPlayConfig {
  userId: string;
  enabled: boolean;
  amount: number;
  autoCashOut: boolean;
  targetMultiplier: number;
  updatedAt: number;
}

export interface RiskSettings {
  minBet: number;
  maxBet: number;
  maintenanceMode: boolean;
  gamePaused: boolean;
}

export interface UserStats {
  totalBets: number;
  totalWagered: number;
  totalPayout: number;
  netProfit: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  bestCashout: number;
  currentStreak: number;
  bestWinStreak: number;
}

export interface PromoCode {
  code: string;
  amount: number;
  maxUses: number;
  usedCount: number;
  expiresAt: number;
  createdBy: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

export interface MinesGame {
  id: string;
  userId: string;
  betId: string;
  betAmount: number;
  gridSize: number;
  mineCount: number;
  minesLayout: number[];
  revealedTiles: number[];
  isOver: boolean;
  payoutMultiplier: number;
  createdAt: number;
  updatedAt: number;
}

export interface HiloGame {
  id: string;
  userId: string;
  betId: string;
  betAmount: number;
  deck: string[];
  history: string[]; // Cards drawn so far
  isOver: boolean;
  payoutMultiplier: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tournament {
  id: string;
  name: string;
  gameType: GameType;
  startTime: number;
  endTime: number;
  status: 'scheduled' | 'active' | 'finished';
  prizePool: number;
  entryFee: number;
  createdBy: string;
}

export interface TournamentParticipant {
  tournamentId: string;
  userId: string;
  username: string;
  score: number;
  rank?: number;
}

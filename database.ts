import { DatabaseSync, StatementSync } from 'node:sqlite';
import crypto from 'crypto';
import {
    User,
    Bet,
    Transaction,
    AdminLog,
    RoundHistoryEntry,
    AutoPlayConfig,
    RiskSettings,
    UserStats,
    PromoCode,
    Notification,
    ChatMessage,
    MinesGame,
    HiloGame,
    Tournament,
    TournamentParticipant,
} from './types';

function rowToUser(row: Record<string, any>): User {
    return {
        id: row.id,
        username: row.username,
        password: row.password,
        balance: row.balance,
        role: row.role,
        status: row.status,
        referredBy: row.referredBy,
        lastDailyBonus: row.lastDailyBonus,
        phoneNumber: row.phoneNumber,
        recoveryKey: row.recoveryKey,
    };
}

function rowToBet(row: Record<string, any>): Bet {
    return {
        id: row.id,
        userId: row.userId,
        amount: row.amount,
        gameType: row.gameType as any,
        gameId: row.gameId,
        entryMultiplier: row.entryMultiplier,
        exitMultiplier: row.exitMultiplier,
        payout: row.payout,
        status: row.status as any,
        timestamp: row.timestamp,
    };
}

function rowToTransaction(row: Record<string, any>): Transaction {
    return {
        id: row.id,
        userId: row.userId,
        type: row.type as any,
        amount: row.amount,
        timestamp: row.timestamp,
    };
}

function rowToAdminLog(row: Record<string, any>): AdminLog {
    return {
        id: row.id,
        adminId: row.adminId,
        action: row.action,
        targetUserId: row.targetUserId,
        details: row.details,
        timestamp: row.timestamp,
    };
}

function rowToRoundHistory(row: Record<string, any>): RoundHistoryEntry {
    return {
        gameId: row.gameId,
        crashMultiplier: row.crashMultiplier,
        timestamp: row.timestamp,
        serverSeedHash: row.serverSeedHash,
        serverSeed: row.serverSeed,
        nonce: row.nonce,
    };
}

function rowToAutoPlayConfig(row: Record<string, any>): AutoPlayConfig {
    return {
        userId: row.userId,
        enabled: Number(row.enabled) === 1,
        amount: Number(row.amount),
        autoCashOut: Number(row.autoCashOut) === 1,
        targetMultiplier: Number(row.targetMultiplier),
        updatedAt: Number(row.updatedAt),
    };
}

function rowToPromoCode(row: Record<string, any>): PromoCode {
    return {
        code: row.code,
        amount: Number(row.amount),
        maxUses: Number(row.maxUses),
        usedCount: Number(row.usedCount),
        expiresAt: Number(row.expiresAt),
        createdBy: row.createdBy,
    };
}

function rowToNotification(row: Record<string, any>): Notification {
    return {
        id: row.id,
        title: row.title,
        message: row.message,
        type: row.type as any,
        timestamp: Number(row.timestamp),
    };
}

function rowToChatMessage(row: Record<string, any>): ChatMessage {
    return {
        id: row.id,
        userId: row.userId,
        username: row.username,
        message: row.message,
        timestamp: Number(row.timestamp),
    };
}

function rowToMinesGame(row: Record<string, any>): MinesGame {
    return {
        id: row.id,
        userId: row.userId,
        betId: row.betId,
        betAmount: Number(row.betAmount),
        gridSize: Number(row.gridSize),
        mineCount: Number(row.mineCount),
        minesLayout: JSON.parse(row.minesLayout || '[]'),
        revealedTiles: JSON.parse(row.revealedTiles || '[]'),
        isOver: Number(row.isOver) === 1,
        payoutMultiplier: Number(row.payoutMultiplier),
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
    };
}

function rowToTournament(row: Record<string, any>): Tournament {
    return {
        id: row.id,
        name: row.name,
        gameType: row.gameType as any,
        startTime: Number(row.startTime),
        endTime: Number(row.endTime),
        status: row.status as any,
        prizePool: Number(row.prizePool),
        entryFee: Number(row.entryFee),
        createdBy: row.createdBy,
    };
}

function rowToTournamentParticipant(row: Record<string, any>): TournamentParticipant {
    return {
        tournamentId: row.tournamentId,
        userId: row.userId,
        username: row.username,
        score: Number(row.score),
        rank: row.rank, // rank might be calculated on the fly
    };
}

function rowToHiloGame(row: Record<string, any>): HiloGame {
    return {
        id: row.id,
        userId: row.userId,
        betId: row.betId,
        betAmount: Number(row.betAmount),
        deck: JSON.parse(row.deck || '[]'),
        history: JSON.parse(row.history || '[]'),
        isOver: Number(row.isOver) === 1,
        payoutMultiplier: Number(row.payoutMultiplier),
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
    };
}

export class DatabaseService {
    private db: DatabaseSync;

    private findUserByUsernameStmt!: StatementSync;
    private findUserByIdStmt!: StatementSync;
    private createUserStmt!: StatementSync;
    private updateUserProfileStmt!: StatementSync;
    private updateUserPasswordStmt!: StatementSync;
    private updateUserBalanceStmt!: StatementSync;
    private createBetStmt!: StatementSync;
    private findActiveBetForUserInGameStmt!: StatementSync;
    private updateBetStatusStmt!: StatementSync;
    private getActiveBetsForGameStmt!: StatementSync;
    private markBetsAsLostStmt!: StatementSync;
    private getLeaderboardStmt!: StatementSync;
    private depositStmt!: StatementSync;
    private withdrawStmt!: StatementSync;
    private createTransactionStmt!: StatementSync;
    private getTransactionsForUserPaginatedStmt!: StatementSync;
    private countTransactionsForUserStmt!: StatementSync;
    private getAllUsersStmt!: StatementSync;
    private createAdminLogStmt!: StatementSync;
    private getAdminLogsPaginatedStmt!: StatementSync;
    private countAdminLogsStmt!: StatementSync;
    private updateUserStatusStmt!: StatementSync;
    private getBetsForUserPaginatedStmt!: StatementSync;
    private countBetsForUserStmt!: StatementSync;
    private getAllBetsPaginatedStmt!: StatementSync;
    private countAllBetsStmt!: StatementSync;
    private createRoundHistoryStmt!: StatementSync;
    private getRecentRoundsStmt!: StatementSync;
    private getUserStatsAggregateStmt!: StatementSync;
    private getUserBetOutcomesStmt!: StatementSync;
    private upsertAutoPlayConfigStmt!: StatementSync;
    private getAutoPlayConfigStmt!: StatementSync;
    private getEnabledAutoPlayConfigsStmt!: StatementSync;
    private upsertSettingStmt!: StatementSync;
    private getSettingStmt!: StatementSync;
    private createPromoCodeStmt!: StatementSync;
    private getPromoCodeStmt!: StatementSync;
    private incrementPromoCodeUsageStmt!: StatementSync;
    private createPromoRedemptionStmt!: StatementSync;
    private hasUserRedeemedPromoStmt!: StatementSync;
    private getPromoCodesStmt!: StatementSync;
    private updateLastDailyBonusStmt!: StatementSync;
    private createNotificationStmt!: StatementSync;
    private getRecentNotificationsStmt!: StatementSync;
    private createChatMessageStmt!: StatementSync;
    private getRecentChatMessagesStmt!: StatementSync;
    private createMinesGameStmt!: StatementSync;
    private getActiveMinesGameForUserStmt!: StatementSync;
    private updateMinesGameStmt!: StatementSync;
    private getBetByIdStmt!: StatementSync;
    private createTournamentStmt!: StatementSync;
    private updateTournamentStmt!: StatementSync;
    private getTournamentsStmt!: StatementSync;
    private getTournamentsByStatusStmt!: StatementSync;
    private getTournamentByIdStmt!: StatementSync;
    private joinTournamentStmt!: StatementSync;
    private getParticipantStmt!: StatementSync;
    private getTournamentParticipantsStmt!: StatementSync;
    private upsertParticipantScoreStmt!: StatementSync;
    private setParticipantScoreStmt!: StatementSync;
    private createHiloGameStmt!: StatementSync;
    private upsertDailyLeaderboardScoreStmt!: StatementSync;
    private getDailyLeaderboardStmt!: StatementSync;
    private clearDailyLeaderboardStmt!: StatementSync;
    private getActiveHiloGameForUserStmt!: StatementSync;
    private updateHiloGameStmt!: StatementSync;

    constructor() {
        const dbFile = process.env.DB_FILE || 'betting.db';
        this.db = new DatabaseSync(dbFile);
        console.log(`Database opened at ${this.db.location()}`);
        this.initSchema();
        this.prepareStatements();
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance REAL NOT NULL,
                role TEXT NOT NULL DEFAULT 'player',
                status TEXT NOT NULL DEFAULT 'active',
                referredBy TEXT,
                lastDailyBonus INTEGER,
                phoneNumber TEXT,
                recoveryKey TEXT
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bets (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL,
                amount REAL NOT NULL,
                gameType TEXT NOT NULL,
                gameId TEXT NOT NULL,
                entryMultiplier REAL NOT NULL,
                exitMultiplier REAL,
                payout REAL,
                status TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS admin_logs (
                id TEXT PRIMARY KEY,
                adminId TEXT NOT NULL,
                action TEXT NOT NULL,
                targetUserId TEXT,
                details TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY(adminId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS round_history (
                gameId TEXT PRIMARY KEY,
                crashMultiplier REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                serverSeedHash TEXT NOT NULL,
                serverSeed TEXT NOT NULL,
                nonce INTEGER NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS autoplay_configs (
                userId TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                amount REAL NOT NULL DEFAULT 10,
                autoCashOut INTEGER NOT NULL DEFAULT 1,
                targetMultiplier REAL NOT NULL DEFAULT 2,
                updatedAt INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS promo_codes (
                code TEXT PRIMARY KEY,
                amount REAL NOT NULL,
                maxUses INTEGER NOT NULL,
                usedCount INTEGER NOT NULL DEFAULT 0,
                expiresAt INTEGER NOT NULL,
                createdBy TEXT NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS promo_redemptions (
                userId TEXT NOT NULL,
                code TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                PRIMARY KEY (userId, code),
                FOREIGN KEY(userId) REFERENCES users(id),
                FOREIGN KEY(code) REFERENCES promo_codes(code)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mines_games (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL UNIQUE,
                betId TEXT NOT NULL,
                betAmount REAL NOT NULL,
                gridSize INTEGER NOT NULL,
                mineCount INTEGER NOT NULL,
                minesLayout TEXT NOT NULL,
                revealedTiles TEXT NOT NULL,
                isOver INTEGER NOT NULL DEFAULT 0,
                payoutMultiplier REAL NOT NULL DEFAULT 1.0,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS hilo_games (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL UNIQUE,
                betId TEXT NOT NULL,
                betAmount REAL NOT NULL,
                deck TEXT NOT NULL,
                history TEXT NOT NULL,
                isOver INTEGER NOT NULL DEFAULT 0,
                payoutMultiplier REAL NOT NULL DEFAULT 1.0,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tournaments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                gameType TEXT NOT NULL,
                startTime INTEGER NOT NULL,
                endTime INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'scheduled',
                prizePool REAL NOT NULL DEFAULT 0,
                entryFee REAL NOT NULL DEFAULT 0,
                createdBy TEXT NOT NULL
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tournament_participants (
                tournamentId TEXT NOT NULL,
                userId TEXT NOT NULL,
                username TEXT NOT NULL,
                score REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (tournamentId, userId),
                FOREIGN KEY(tournamentId) REFERENCES tournaments(id),
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_leaderboard (
                userId TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                wagered REAL NOT NULL DEFAULT 0,
                updatedAt INTEGER NOT NULL,
                FOREIGN KEY(userId) REFERENCES users(id)
            );
        `);

        this.db.exec('CREATE INDEX IF NOT EXISTS idx_bets_user_time ON bets(userId, timestamp DESC);');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_bets_game_status ON bets(gameId, status);');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_round_history_time ON round_history(timestamp DESC);');

        const addColumn = (table: string, col: string, type: string) => {
            try {
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
            } catch (e: any) {
                if (!e.message?.includes('duplicate column name')) {
                    console.error(`[Schema Update] Failed to add column ${col} to ${table}:`, e.message);
                }
            }
        };
        addColumn('users', 'phoneNumber', 'TEXT');
        addColumn('users', 'referredBy', 'TEXT');
        addColumn('users', 'lastDailyBonus', 'INTEGER');
        addColumn('users', 'recoveryKey', 'TEXT');

        console.log('Database schema initialized.');
    }

    private prepareStatements(): void {
        this.findUserByUsernameStmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
        this.findUserByIdStmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
        this.createUserStmt = this.db.prepare('INSERT INTO users (id, username, password, balance, role, referredBy, phoneNumber, recoveryKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        this.updateUserProfileStmt = this.db.prepare('UPDATE users SET username = ?, phoneNumber = ? WHERE id = ?');
        this.updateUserPasswordStmt = this.db.prepare('UPDATE users SET password = ? WHERE id = ?');
        this.updateUserBalanceStmt = this.db.prepare('UPDATE users SET balance = ? WHERE id = ?');
        this.createBetStmt = this.db.prepare('INSERT INTO bets (id, userId, amount, gameType, gameId, entryMultiplier, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        this.findActiveBetForUserInGameStmt = this.db.prepare("SELECT * FROM bets WHERE userId = ? AND gameId = ? AND status = 'active'");
        this.updateBetStatusStmt = this.db.prepare("UPDATE bets SET status = ?, exitMultiplier = ?, payout = ? WHERE id = ?");
        this.getActiveBetsForGameStmt = this.db.prepare("SELECT * FROM bets WHERE gameId = ? AND status = 'active'");
        this.markBetsAsLostStmt = this.db.prepare("UPDATE bets SET status = 'lost' WHERE gameId = ? AND status = 'active'");
        this.getLeaderboardStmt = this.db.prepare('SELECT username, balance FROM users ORDER BY balance DESC LIMIT ?');
        this.depositStmt = this.db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
        this.withdrawStmt = this.db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
        this.createTransactionStmt = this.db.prepare('INSERT INTO transactions (id, userId, type, amount, timestamp) VALUES (?, ?, ?, ?, ?)');
        this.getTransactionsForUserPaginatedStmt = this.db.prepare('SELECT * FROM transactions WHERE userId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?');
        this.countTransactionsForUserStmt = this.db.prepare('SELECT COUNT(*) as count FROM transactions WHERE userId = ?');
        this.getAllUsersStmt = this.db.prepare('SELECT id, username, balance, role, status FROM users');
        this.createAdminLogStmt = this.db.prepare('INSERT INTO admin_logs (id, adminId, action, targetUserId, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
        this.getAdminLogsPaginatedStmt = this.db.prepare('SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?');
        this.countAdminLogsStmt = this.db.prepare('SELECT COUNT(*) as count FROM admin_logs');
        this.updateUserStatusStmt = this.db.prepare('UPDATE users SET status = ? WHERE id = ?');
        this.getBetsForUserPaginatedStmt = this.db.prepare('SELECT * FROM bets WHERE userId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?');
        this.countBetsForUserStmt = this.db.prepare('SELECT COUNT(*) as count FROM bets WHERE userId = ?');
        this.getAllBetsPaginatedStmt = this.db.prepare(`
            SELECT bets.*, users.username
            FROM bets
            JOIN users ON users.id = bets.userId
            ORDER BY bets.timestamp DESC
            LIMIT ? OFFSET ?
        `);
        this.countAllBetsStmt = this.db.prepare('SELECT COUNT(*) as count FROM bets');
        this.createRoundHistoryStmt = this.db.prepare('INSERT OR REPLACE INTO round_history (gameId, crashMultiplier, timestamp, serverSeedHash, serverSeed, nonce) VALUES (?, ?, ?, ?, ?, ?)');
        this.getRecentRoundsStmt = this.db.prepare('SELECT * FROM round_history ORDER BY timestamp DESC LIMIT ?');
        this.getUserStatsAggregateStmt = this.db.prepare(`
            SELECT
                COUNT(*) AS totalBets,
                COALESCE(SUM(amount), 0) AS totalWagered,
                COALESCE(SUM(CASE WHEN status = 'cashed_out' THEN payout ELSE 0 END), 0) AS totalPayout,
                COALESCE(SUM(CASE WHEN status = 'cashed_out' THEN 1 ELSE 0 END), 0) AS wins,
                COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
                COALESCE(MAX(CASE WHEN status = 'cashed_out' THEN exitMultiplier ELSE 0 END), 0) AS bestCashout
            FROM bets
            WHERE userId = ?
        `);
        this.getUserBetOutcomesStmt = this.db.prepare("SELECT status FROM bets WHERE userId = ? AND status IN ('cashed_out', 'lost') ORDER BY timestamp DESC");
        this.upsertAutoPlayConfigStmt = this.db.prepare(`
            INSERT INTO autoplay_configs (userId, enabled, amount, autoCashOut, targetMultiplier, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(userId) DO UPDATE SET
                enabled = excluded.enabled,
                amount = excluded.amount,
                autoCashOut = excluded.autoCashOut,
                targetMultiplier = excluded.targetMultiplier,
                updatedAt = excluded.updatedAt
        `);
        this.getAutoPlayConfigStmt = this.db.prepare('SELECT * FROM autoplay_configs WHERE userId = ?');
        this.getEnabledAutoPlayConfigsStmt = this.db.prepare('SELECT * FROM autoplay_configs WHERE enabled = 1');
        this.upsertSettingStmt = this.db.prepare(`
            INSERT INTO system_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        this.getSettingStmt = this.db.prepare('SELECT value FROM system_settings WHERE key = ?');
        this.createPromoCodeStmt = this.db.prepare('INSERT INTO promo_codes (code, amount, maxUses, expiresAt, createdBy) VALUES (?, ?, ?, ?, ?)');
        this.getPromoCodeStmt = this.db.prepare('SELECT * FROM promo_codes WHERE code = ?');
        this.incrementPromoCodeUsageStmt = this.db.prepare('UPDATE promo_codes SET usedCount = usedCount + 1 WHERE code = ?');
        this.createPromoRedemptionStmt = this.db.prepare('INSERT INTO promo_redemptions (userId, code, timestamp) VALUES (?, ?, ?)');
        this.hasUserRedeemedPromoStmt = this.db.prepare('SELECT 1 FROM promo_redemptions WHERE userId = ? AND code = ?');
        this.getPromoCodesStmt = this.db.prepare('SELECT * FROM promo_codes ORDER BY expiresAt DESC');
        this.updateLastDailyBonusStmt = this.db.prepare('UPDATE users SET lastDailyBonus = ? WHERE id = ?');
        this.createNotificationStmt = this.db.prepare('INSERT INTO notifications (id, title, message, type, timestamp) VALUES (?, ?, ?, ?, ?)');
        this.getRecentNotificationsStmt = this.db.prepare('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ?');
        this.createChatMessageStmt = this.db.prepare('INSERT INTO chat_messages (id, userId, username, message, timestamp) VALUES (?, ?, ?, ?, ?)');
        this.getRecentChatMessagesStmt = this.db.prepare('SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT ?');
        this.createMinesGameStmt = this.db.prepare('INSERT OR REPLACE INTO mines_games (id, userId, betId, betAmount, gridSize, mineCount, minesLayout, revealedTiles, isOver, payoutMultiplier, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        this.getActiveMinesGameForUserStmt = this.db.prepare('SELECT * FROM mines_games WHERE userId = ? AND isOver = 0');
        this.updateMinesGameStmt = this.db.prepare('UPDATE mines_games SET minesLayout = ?, revealedTiles = ?, isOver = ?, payoutMultiplier = ?, updatedAt = ? WHERE id = ?');
        this.getBetByIdStmt = this.db.prepare('SELECT * FROM bets WHERE id = ?');
        this.createTournamentStmt = this.db.prepare('INSERT INTO tournaments (id, name, gameType, startTime, endTime, status, prizePool, entryFee, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        this.updateTournamentStmt = this.db.prepare('UPDATE tournaments SET name = ?, startTime = ?, endTime = ?, status = ?, prizePool = ?, entryFee = ? WHERE id = ?');
        this.getTournamentsStmt = this.db.prepare("SELECT * FROM tournaments WHERE status != 'finished' ORDER BY startTime ASC");
        this.getTournamentsByStatusStmt = this.db.prepare('SELECT * FROM tournaments WHERE status = ?');
        this.getTournamentByIdStmt = this.db.prepare('SELECT * FROM tournaments WHERE id = ?');
        this.joinTournamentStmt = this.db.prepare('INSERT OR IGNORE INTO tournament_participants (tournamentId, userId, username) VALUES (?, ?, ?)');
        this.getParticipantStmt = this.db.prepare('SELECT * FROM tournament_participants WHERE tournamentId = ? AND userId = ?');
        this.getTournamentParticipantsStmt = this.db.prepare('SELECT *, RANK() OVER (ORDER BY score DESC) as rank FROM tournament_participants WHERE tournamentId = ? ORDER BY score DESC LIMIT 50');
        this.upsertParticipantScoreStmt = this.db.prepare('INSERT INTO tournament_participants (tournamentId, userId, username, score) VALUES (?, ?, ?, ?) ON CONFLICT(tournamentId, userId) DO UPDATE SET score = MAX(score, excluded.score)');
        this.setParticipantScoreStmt = this.db.prepare('UPDATE tournament_participants SET score = ? WHERE tournamentId = ? AND userId = ?');
        this.upsertDailyLeaderboardScoreStmt = this.db.prepare('INSERT INTO daily_leaderboard (userId, username, wagered, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(userId) DO UPDATE SET wagered = wagered + excluded.wagered, updatedAt = excluded.updatedAt');
        this.getDailyLeaderboardStmt = this.db.prepare('SELECT * FROM daily_leaderboard ORDER BY wagered DESC LIMIT 50');
        this.clearDailyLeaderboardStmt = this.db.prepare('DELETE FROM daily_leaderboard');
        this.createHiloGameStmt = this.db.prepare('INSERT OR REPLACE INTO hilo_games (id, userId, betId, betAmount, deck, history, isOver, payoutMultiplier, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        this.getActiveHiloGameForUserStmt = this.db.prepare('SELECT * FROM hilo_games WHERE userId = ? AND isOver = 0');
        this.updateHiloGameStmt = this.db.prepare('UPDATE hilo_games SET deck = ?, history = ?, isOver = ?, payoutMultiplier = ?, updatedAt = ? WHERE id = ?');
    }

    public findUserByUsername = (username: string): User | null => {
        const row = this.findUserByUsernameStmt.get(username);
        return row ? rowToUser(row as Record<string, any>) : null;
    };

    public findUserById = (id: string): User | null => {
        const row = this.findUserByIdStmt.get(id);
        return row ? rowToUser(row as Record<string, any>) : null;
    };

    public createUser = (user: User): void => {
        this.createUserStmt.run(
            user.id,
            user.username,
            user.password,
            user.balance,
            user.role,
            user.referredBy || null,
            user.phoneNumber || null,
            user.recoveryKey || null
        );
    };

    public updateUserProfile = (userId: string, username: string, phoneNumber: string | null): void => {
        this.updateUserProfileStmt.run(username, phoneNumber, userId);
    };

    public updateUserPassword = (userId: string, password: string): void => {
        this.updateUserPasswordStmt.run(password, userId);
    };

    public updateUserBalance = (userId: string, balance: number): void => {
        this.updateUserBalanceStmt.run(balance, userId);
    };

    public createBet = (bet: Bet): void => {
        this.createBetStmt.run(bet.id, bet.userId, bet.amount, bet.gameType, bet.gameId, bet.entryMultiplier, bet.status, bet.timestamp);
    };

    public findActiveBetForUserInGame = (userId: string, gameId: string): Bet | null => {
        const row = this.findActiveBetForUserInGameStmt.get(userId, gameId);
        return row ? rowToBet(row as Record<string, any>) : null;
    };

    public getActiveBetsForGame = (gameId: string): Bet[] => {
        return this.getActiveBetsForGameStmt.all(gameId).map(row => rowToBet(row as Record<string, any>));
    };

    public getBetById = (id: string): Bet | null => {
        const row = this.getBetByIdStmt.get(id);
        return row ? rowToBet(row as Record<string, any>) : null;
    };

    public updateBetStatus = (betId: string, status: 'cashed_out' | 'lost', exitMultiplier: number, payout: number): void => {
        this.updateBetStatusStmt.run(status, exitMultiplier, payout, betId);
    };

    public getBetHistoryForUserPaginated = (userId: string, limit: number, offset: number): Bet[] => {
        return this.getBetsForUserPaginatedStmt.all(userId, limit, offset).map(row => rowToBet(row as Record<string, any>));
    };

    public countBetsForUser = (userId: string): number => {
        return (this.countBetsForUserStmt.get(userId) as { count: number }).count;
    };

    public getAllBetsPaginated = (limit: number, offset: number): (Bet & { username: string })[] => {
        return this.getAllBetsPaginatedStmt
            .all(limit, offset)
            .map(row => {
                const typedRow = row as Record<string, any>;
                const bet = rowToBet(typedRow);
                return {
                    ...bet,
                    username: String(typedRow.username || ''),
                };
            });
    };

    public countAllBets = (): number => {
        return (this.countAllBetsStmt.get() as { count: number }).count;
    };

    public getLeaderboard = (limit: number): { username: string, balance: number }[] => {
        return this.getLeaderboardStmt.all(limit) as { username: string, balance: number }[];
    };

    public getTransactionsForUserPaginated = (userId: string, limit: number, offset: number): Transaction[] => {
        return this.getTransactionsForUserPaginatedStmt.all(userId, limit, offset).map(row => rowToTransaction(row as Record<string, any>));
    };

    public countTransactionsForUser = (userId: string): number => {
        return (this.countTransactionsForUserStmt.get(userId) as { count: number }).count;
    };

    public getAllUsers = (): Omit<User, 'password'>[] => {
        return this.getAllUsersStmt.all().map(row => {
            const user = rowToUser(row as Record<string, any>);
            const { password, ...rest } = user;
            return rest;
        });
    };

    public createAdminLog = (log: AdminLog): void => {
        this.createAdminLogStmt.run(log.id, log.adminId, log.action, log.targetUserId || null, log.details || null, log.timestamp);
    };

    public getAdminLogsPaginated = (limit: number, offset: number): AdminLog[] => {
        return this.getAdminLogsPaginatedStmt.all(limit, offset).map(row => rowToAdminLog(row as Record<string, any>));
    };

    public countAdminLogs = (): number => {
        return (this.countAdminLogsStmt.get() as { count: number }).count;
    };

    public updateUserStatus = (userId: string, status: 'active' | 'frozen' | 'banned'): void => {
        this.updateUserStatusStmt.run(status, userId);
    };

    public deposit = (userId: string, amount: number): void => {
        this.depositStmt.run(amount, userId);
        this.createTransactionStmt.run(crypto.randomUUID(), userId, 'deposit', amount, Date.now());
    };

    public withdraw = (userId: string, amount: number): void => {
        this.withdrawStmt.run(amount, userId);
        this.createTransactionStmt.run(crypto.randomUUID(), userId, 'withdrawal', amount, Date.now());
    };

    public markActiveBetsAsLost(gameId: string): Bet[] {
        const lostBets = this.getActiveBetsForGame(gameId);
        if (lostBets.length > 0) {
            this.markBetsAsLostStmt.run(gameId);
        }
        return lostBets;
    }

    public createRoundHistory = (entry: RoundHistoryEntry): void => {
        this.createRoundHistoryStmt.run(
            entry.gameId,
            entry.crashMultiplier,
            entry.timestamp,
            entry.serverSeedHash,
            entry.serverSeed,
            entry.nonce,
        );
    };

    public getRecentRounds = (limit: number): RoundHistoryEntry[] => {
        return this.getRecentRoundsStmt.all(limit).map(row => rowToRoundHistory(row as Record<string, any>));
    };

    public getUserStats = (userId: string): UserStats => {
        const aggregate = this.getUserStatsAggregateStmt.get(userId) as {
            totalBets: number;
            totalWagered: number;
            totalPayout: number;
            wins: number;
            losses: number;
            bestCashout: number;
        };

        const totalBets = Number(aggregate?.totalBets || 0);
        const totalWagered = Number(aggregate?.totalWagered || 0);
        const totalPayout = Number(aggregate?.totalPayout || 0);
        const wins = Number(aggregate?.wins || 0);
        const losses = Number(aggregate?.losses || 0);
        const bestCashout = Number(aggregate?.bestCashout || 0);

        const outcomes = this.getUserBetOutcomesStmt.all(userId) as { status: string }[];

        let currentStreak = 0;
        if (outcomes.length > 0) {
            const firstIsWin = outcomes[0].status === 'cashed_out';
            let streakCount = 0;
            for (const row of outcomes) {
                const isWin = row.status === 'cashed_out';
                if (isWin === firstIsWin) {
                    streakCount += 1;
                } else {
                    break;
                }
            }
            currentStreak = firstIsWin ? streakCount : -streakCount;
        }

        let bestWinStreak = 0;
        let runningWinStreak = 0;
        for (let i = outcomes.length - 1; i >= 0; i -= 1) {
            if (outcomes[i].status === 'cashed_out') {
                runningWinStreak += 1;
                if (runningWinStreak > bestWinStreak) {
                    bestWinStreak = runningWinStreak;
                }
            } else {
                runningWinStreak = 0;
            }
        }

        const winRate = totalBets > 0 ? Number(((wins / totalBets) * 100).toFixed(2)) : 0;
        const netProfit = Number((totalPayout - totalWagered).toFixed(2));
        const roi = totalWagered > 0 ? Number(((netProfit / totalWagered) * 100).toFixed(2)) : 0;

        return {
            totalBets,
            totalWagered: Number(totalWagered.toFixed(2)),
            totalPayout: Number(totalPayout.toFixed(2)),
            netProfit,
            wins,
            losses,
            winRate,
            roi,
            bestCashout: Number(bestCashout.toFixed(2)),
            currentStreak,
            bestWinStreak,
        };
    };

    public setAutoPlayConfig = (config: AutoPlayConfig): void => {
        this.upsertAutoPlayConfigStmt.run(
            config.userId,
            config.enabled ? 1 : 0,
            config.amount,
            config.autoCashOut ? 1 : 0,
            config.targetMultiplier,
            config.updatedAt,
        );
    };

    public getAutoPlayConfigForUser = (userId: string): AutoPlayConfig | null => {
        const row = this.getAutoPlayConfigStmt.get(userId);
        return row ? rowToAutoPlayConfig(row as Record<string, any>) : null;
    };

    public getEnabledAutoPlayConfigs = (): AutoPlayConfig[] => {
        return this.getEnabledAutoPlayConfigsStmt.all().map(row => rowToAutoPlayConfig(row as Record<string, any>));
    };

    public setSetting = (key: string, value: string): void => {
        this.upsertSettingStmt.run(key, value);
    };

    public getSetting = (key: string): string | null => {
        const row = this.getSettingStmt.get(key) as { value: string } | undefined;
        return row ? row.value : null;
    };

    public getRiskSettings = (defaults: RiskSettings): RiskSettings => {
        const parseNumber = (raw: string | null, fallback: number): number => {
            const parsed = Number(raw);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
        };
        const parseBoolean = (raw: string | null, fallback: boolean): boolean => {
            if (raw === null) {
                return fallback;
            }
            return raw === 'true';
        };

        const minBet = Math.max(0.01, parseNumber(this.getSetting('risk.minBet'), defaults.minBet));
        const maxBet = Math.max(minBet, parseNumber(this.getSetting('risk.maxBet'), defaults.maxBet));
        const maintenanceMode = parseBoolean(this.getSetting('risk.maintenanceMode'), defaults.maintenanceMode);
        const gamePaused = parseBoolean(this.getSetting('risk.gamePaused'), defaults.gamePaused);

        return {
            minBet: Number(minBet.toFixed(2)),
            maxBet: Number(maxBet.toFixed(2)),
            maintenanceMode,
            gamePaused,
        };
    };

    public setRiskSettings = (settings: RiskSettings): void => {
        this.setSetting('risk.minBet', String(settings.minBet));
        this.setSetting('risk.maxBet', String(settings.maxBet));
        this.setSetting('risk.maintenanceMode', settings.maintenanceMode ? 'true' : 'false');
        this.setSetting('risk.gamePaused', settings.gamePaused ? 'true' : 'false');
    };

    public createPromoCode = (promo: PromoCode): void => {
        this.createPromoCodeStmt.run(promo.code, promo.amount, promo.maxUses, promo.expiresAt, promo.createdBy);
    };

    public getPromoCode = (code: string): PromoCode | null => {
        const row = this.getPromoCodeStmt.get(code);
        return row ? rowToPromoCode(row as Record<string, any>) : null;
    };

    public getAllPromoCodes = (): PromoCode[] => {
        return this.getPromoCodesStmt.all().map(row => rowToPromoCode(row as Record<string, any>));
    };

    public hasUserRedeemedPromo = (userId: string, code: string): boolean => {
        const row = this.hasUserRedeemedPromoStmt.get(userId, code);
        return !!row;
    };

    public redeemPromoCode = (userId: string, code: string, amount: number): boolean => {
        // Simple transaction simulation
        try {
            this.db.exec('BEGIN TRANSACTION');
            this.incrementPromoCodeUsageStmt.run(code);
            this.createPromoRedemptionStmt.run(userId, code, Date.now());
            this.updateUserBalanceStmt.run(this.findUserById(userId)!.balance + amount, userId);
            this.createTransactionStmt.run(crypto.randomUUID(), userId, 'deposit', amount, Date.now());
            this.db.exec('COMMIT');
            return true;
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    };

    public transferFunds = (fromUserId: string, toUserId: string, amount: number): void => {
        try {
            this.db.exec('BEGIN TRANSACTION');
            const sender = this.findUserById(fromUserId);
            const recipient = this.findUserById(toUserId);

            if (!sender || !recipient) throw new Error('User not found');
            if (sender.balance < amount) throw new Error('Insufficient funds');

            this.updateUserBalanceStmt.run(sender.balance - amount, fromUserId);
            this.updateUserBalanceStmt.run(recipient.balance + amount, toUserId);
            this.db.exec('COMMIT');
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    };

    public updateLastDailyBonus = (userId: string, timestamp: number): void => {
        this.updateLastDailyBonusStmt.run(timestamp, userId);
    };

    public createNotification = (notification: Notification): void => {
        this.createNotificationStmt.run(notification.id, notification.title, notification.message, notification.type, notification.timestamp);
    };

    public getRecentNotifications = (limit: number): Notification[] => {
        return this.getRecentNotificationsStmt.all(limit).map(row => rowToNotification(row as Record<string, any>));
    };

    public createChatMessage = (msg: ChatMessage): void => {
        this.createChatMessageStmt.run(msg.id, msg.userId, msg.username, msg.message, msg.timestamp);
    };

    public getRecentChatMessages = (limit: number): ChatMessage[] => {
        return this.getRecentChatMessagesStmt.all(limit).map(row => rowToChatMessage(row as Record<string, any>)).reverse();
    };

    public createMinesGame = (game: MinesGame): void => {
        this.createMinesGameStmt.run(
            game.id,
            game.userId,
            game.betId,
            game.betAmount,
            game.gridSize,
            game.mineCount,
            JSON.stringify(game.minesLayout),
            JSON.stringify(game.revealedTiles),
            game.isOver ? 1 : 0,
            game.payoutMultiplier,
            game.createdAt,
            game.updatedAt
        );
    };

    public getActiveMinesGameForUser = (userId: string): MinesGame | null => {
        const row = this.getActiveMinesGameForUserStmt.get(userId);
        return row ? rowToMinesGame(row as Record<string, any>) : null;
    };

    public updateMinesGame = (game: MinesGame): void => {
        this.updateMinesGameStmt.run(
            JSON.stringify(game.minesLayout),
            JSON.stringify(game.revealedTiles),
            game.isOver ? 1 : 0,
            game.payoutMultiplier,
            game.updatedAt,
            game.id
        );
    };

    public createHiloGame = (game: HiloGame): void => {
        this.createHiloGameStmt.run(
            game.id,
            game.userId,
            game.betId,
            game.betAmount,
            JSON.stringify(game.deck),
            JSON.stringify(game.history),
            game.isOver ? 1 : 0,
            game.payoutMultiplier,
            game.createdAt,
            game.updatedAt
        );
    };

    public getActiveHiloGameForUser = (userId: string): HiloGame | null => {
        const row = this.getActiveHiloGameForUserStmt.get(userId);
        return row ? rowToHiloGame(row as Record<string, any>) : null;
    };

    public updateHiloGame = (game: HiloGame): void => {
        this.updateHiloGameStmt.run(
            JSON.stringify(game.deck),
            JSON.stringify(game.history),
            game.isOver ? 1 : 0,
            game.payoutMultiplier,
            game.updatedAt,
            game.id
        );
    };

    public createTournament = (t: Tournament): void => {
        this.createTournamentStmt.run(t.id, t.name, t.gameType, t.startTime, t.endTime, t.status, t.prizePool, t.entryFee, t.createdBy);
    };

    public updateTournament = (t: Tournament): void => {
        this.updateTournamentStmt.run(t.name, t.startTime, t.endTime, t.status, t.prizePool, t.entryFee, t.id);
    };

    public getActiveTournaments = (): Tournament[] => {
        return this.getTournamentsStmt.all().map(row => rowToTournament(row as Record<string, any>));
    };

    public getTournamentsByStatus = (status: 'scheduled' | 'active' | 'finished'): Tournament[] => {
        return this.getTournamentsByStatusStmt.all(status).map(row => rowToTournament(row as Record<string, any>));
    };

    public getTournament = (id: string): Tournament | null => {
        const row = this.getTournamentByIdStmt.get(id);
        return row ? rowToTournament(row as Record<string, any>) : null;
    };

    public isUserInTournament = (tournamentId: string, userId: string): boolean => {
        return !!this.getParticipantStmt.get(tournamentId, userId);
    };

    public joinTournament = (tournamentId: string, user: User): void => {
        this.joinTournamentStmt.run(tournamentId, user.id, user.username);
    };

    public getTournamentLeaderboard = (tournamentId: string): TournamentParticipant[] => {
        return this.getTournamentParticipantsStmt.all(tournamentId).map(row => rowToTournamentParticipant(row as Record<string, any>));
    };

    public updateTournamentScore = (tournamentId: string, userId: string, username: string, newScore: number): void => {
        this.upsertParticipantScoreStmt.run(tournamentId, userId, username, newScore);
    };

    public setTournamentScore = (tournamentId: string, userId: string, score: number): void => {
        this.setParticipantScoreStmt.run(score, tournamentId, userId);
    };

    public updateDailyLeaderboard = (userId: string, username: string, amount: number): void => {
        this.upsertDailyLeaderboardScoreStmt.run(userId, username, amount, Date.now());
    };

    public getDailyLeaderboard = (): { userId: string, username: string, wagered: number }[] => {
        return this.getDailyLeaderboardStmt.all() as any[];
    };

    public clearDailyLeaderboard = (): void => {
        this.clearDailyLeaderboardStmt.run();
    };
}

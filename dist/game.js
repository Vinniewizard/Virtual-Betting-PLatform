"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouletteGame = exports.HiloGameLogic = exports.PlinkoGameLogic = exports.MinesGameLogic = exports.DiceGame = exports.AviatorGame = void 0;
const events_1 = require("events");
const crypto_1 = __importDefault(require("crypto"));
const WAITING_DURATION_MS = 5000;
const CRASH_TO_WAITING_MS = 3000;
const TICK_INTERVAL_MS = 100;
const MULTIPLIER_STEP = 0.01;
class AviatorGame extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.state = {
            status: 'waiting',
            multiplier: 1.0,
            gameId: crypto_1.default.randomUUID(),
            paused: false,
        };
        this.crashPoint = 1.0;
        this.waitingTimer = null;
        this.loopInterval = null;
        this.crashTimer = null;
        this.paused = false;
        this.nonce = 0;
        this.currentServerSeed = '';
        this.currentServerSeedHash = '';
        this.waitingDurationMs = Number.isFinite(config.waitingDurationMs) ? Math.max(1000, config.waitingDurationMs) : WAITING_DURATION_MS;
        this.crashToWaitingMs = Number.isFinite(config.crashToWaitingMs) ? Math.max(1000, config.crashToWaitingMs) : CRASH_TO_WAITING_MS;
        this.tickIntervalMs = Number.isFinite(config.tickIntervalMs) ? Math.max(40, config.tickIntervalMs) : TICK_INTERVAL_MS;
        this.multiplierStep = Number.isFinite(config.multiplierStep) ? Math.max(0.001, config.multiplierStep) : MULTIPLIER_STEP;
        this.maxMultiplier = Number.isFinite(config.maxMultiplier) ? Math.max(10, config.maxMultiplier) : 1000;
        this.curve = config.curve === 'exp' ? 'exp' : 'linear';
        this.expRate = Number.isFinite(config.expRate) ? Math.max(1.001, config.expRate) : 1.012;
        this.startLoop();
    }
    startLoop() {
        this.startWaiting();
    }
    clearTimers() {
        if (this.waitingTimer) {
            clearTimeout(this.waitingTimer);
            this.waitingTimer = null;
        }
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }
        if (this.crashTimer) {
            clearTimeout(this.crashTimer);
            this.crashTimer = null;
        }
    }
    sha256(value) {
        return crypto_1.default.createHash('sha256').update(value).digest('hex');
    }
    prepareFairnessForRound() {
        this.nonce += 1;
        this.currentServerSeed = crypto_1.default.randomBytes(32).toString('hex');
        this.currentServerSeedHash = this.sha256(this.currentServerSeed);
    }
    deriveCrashPoint(serverSeed, gameId, nonce) {
        const digest = this.sha256(`${serverSeed}:${gameId}:${nonce}`);
        const first52Bits = parseInt(digest.slice(0, 13), 16);
        const max52Bits = 0x1fffffffffffff;
        const ratio = Math.min(first52Bits / max52Bits, 0.999999999999);
        // Exponential tail: small values are common, large values are rare.
        const rawCrash = 1 / (1 - ratio);
        const rounded = Math.floor(rawCrash * 100) / 100;
        return Math.max(1.01, Math.min(this.maxMultiplier, Number(rounded.toFixed(2))));
    }
    scheduleWaitingToFlying() {
        if (this.paused || this.waitingTimer) {
            return;
        }
        this.waitingTimer = setTimeout(() => {
            this.waitingTimer = null;
            if (this.paused) {
                return;
            }
            this.startFlying();
        }, this.waitingDurationMs);
    }
    startWaiting() {
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }
        if (this.crashTimer) {
            clearTimeout(this.crashTimer);
            this.crashTimer = null;
        }
        this.state.status = 'waiting';
        this.state.multiplier = 1.0;
        this.state.gameId = crypto_1.default.randomUUID();
        this.state.paused = this.paused;
        this.prepareFairnessForRound();
        this.state.serverSeedHash = this.currentServerSeedHash;
        this.state.nonce = this.nonce;
        this.emit('stateChange', this.getState());
        this.scheduleWaitingToFlying();
    }
    startFlying() {
        this.state.status = 'flying';
        this.state.paused = this.paused;
        this.crashPoint = this.deriveCrashPoint(this.currentServerSeed, this.state.gameId, this.nonce);
        this.emit('stateChange', this.getState());
        this.loopInterval = setInterval(() => {
            if (this.curve === 'exp') {
                this.state.multiplier = Number((this.state.multiplier * this.expRate).toFixed(2));
            }
            else {
                this.state.multiplier = Number((this.state.multiplier + this.multiplierStep).toFixed(2));
            }
            if (this.state.multiplier >= this.crashPoint) {
                this.crash();
            }
            else {
                this.emit('tick', this.getState());
            }
        }, this.tickIntervalMs);
    }
    crash() {
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }
        this.state.status = 'crashed';
        this.state.multiplier = Number(this.crashPoint.toFixed(2));
        this.state.paused = this.paused;
        this.emit('crash', this.getState());
        this.crashTimer = setTimeout(() => {
            this.crashTimer = null;
            this.startWaiting();
        }, this.crashToWaitingMs);
    }
    forceCrash() {
        if (this.state.status !== 'flying') {
            return false;
        }
        this.crashPoint = Math.max(1.01, Number(this.state.multiplier.toFixed(2)));
        this.crash();
        return true;
    }
    setPaused(paused) {
        if (this.paused === paused) {
            return;
        }
        this.paused = paused;
        this.state.paused = paused;
        if (paused) {
            if (this.waitingTimer) {
                clearTimeout(this.waitingTimer);
                this.waitingTimer = null;
            }
        }
        else if (this.state.status === 'waiting') {
            this.scheduleWaitingToFlying();
        }
        this.emit('stateChange', this.getState());
    }
    getState() {
        return { ...this.state };
    }
    getCurrentFairnessCommitment() {
        return {
            gameId: this.state.gameId,
            serverSeedHash: this.currentServerSeedHash,
            nonce: this.nonce,
        };
    }
    getCurrentFairnessReveal() {
        return {
            gameId: this.state.gameId,
            serverSeedHash: this.currentServerSeedHash,
            serverSeed: this.currentServerSeed,
            nonce: this.nonce,
            crashMultiplier: Number(this.crashPoint.toFixed(2)),
        };
    }
    shutdown() {
        this.clearTimers();
    }
}
exports.AviatorGame = AviatorGame;
class DiceGame extends events_1.EventEmitter {
    constructor() {
        super();
        this.nonce = 0;
        this.currentServerSeed = '';
        this.currentServerSeedHash = '';
        this.rotateSeed();
    }
    sha256(value) {
        return crypto_1.default.createHash('sha256').update(value).digest('hex');
    }
    rotateSeed() {
        this.nonce += 1;
        this.currentServerSeed = crypto_1.default.randomBytes(32).toString('hex');
        this.currentServerSeedHash = this.sha256(this.currentServerSeed);
    }
    playRound(clientSeed, condition, target) {
        // Provably fair roll 0.00 to 100.00
        const hmac = crypto_1.default.createHmac('sha256', this.currentServerSeed);
        hmac.update(`${clientSeed}:${this.nonce}`);
        const hex = hmac.digest('hex');
        const roll = parseInt(hex.slice(0, 5), 16) % 10001 / 100;
        let won = false;
        let multiplier = 0;
        if (condition === 'over' && roll > target)
            won = true;
        if (condition === 'under' && roll < target)
            won = true;
        if (won) {
            const winChance = condition === 'over' ? (100 - target) : target;
            multiplier = 99 / winChance; // 1% house edge
        }
        const result = { roll, won, multiplier, serverSeed: this.currentServerSeed, serverSeedHash: this.currentServerSeedHash, nonce: this.nonce };
        this.rotateSeed(); // Rotate for next bet
        return result;
    }
}
exports.DiceGame = DiceGame;
class MinesGameLogic {
    // n-choose-k
    static combinations(n, k) {
        if (k < 0 || k > n) {
            return 0;
        }
        if (k === 0 || k === n) {
            return 1;
        }
        if (k > n / 2) {
            k = n - k;
        }
        let res = 1;
        for (let i = 1; i <= k; i++) {
            res = res * (n - i + 1) / i;
        }
        return res;
    }
    static calculateMultiplier(revealedCount, gridSize, mineCount) {
        if (revealedCount === 0)
            return 1.0;
        const houseEdge = 0.99; // 1% house edge
        const safeTiles = gridSize - mineCount;
        if (revealedCount > safeTiles)
            return 0; // Should not happen
        const probability = this.combinations(safeTiles, revealedCount) / this.combinations(gridSize, revealedCount);
        const multiplier = houseEdge / probability;
        return Math.floor(multiplier * 100) / 100;
    }
    static generateMines(gridSize, mineCount, firstClickIndex) {
        const mines = [];
        const possibleIndices = Array.from({ length: gridSize }, (_, i) => i).filter(i => i !== firstClickIndex);
        for (let i = 0; i < mineCount; i++) {
            const randomIndex = Math.floor(Math.random() * possibleIndices.length);
            const mineIndex = possibleIndices.splice(randomIndex, 1)[0];
            mines.push(mineIndex);
        }
        mines.sort((a, b) => a - b);
        return mines;
    }
}
exports.MinesGameLogic = MinesGameLogic;
const PLINKO_MULTIPLIERS = {
    low: {
        8: [0.5, 0.7, 1, 1.1, 1.2, 1.1, 1, 0.7, 0.5],
        16: [0.5, 0.6, 0.7, 0.8, 1, 1.1, 1.2, 1.5, 2, 1.5, 1.2, 1.1, 1, 0.8, 0.7, 0.6, 0.5]
    },
    medium: {
        8: [0.4, 0.6, 1.1, 1.5, 2, 1.5, 1.1, 0.6, 0.4],
        16: [0.4, 0.5, 0.6, 0.8, 1, 1.5, 2, 4, 10, 4, 2, 1.5, 1, 0.8, 0.6, 0.5, 0.4]
    },
    high: {
        8: [0.3, 0.5, 1, 2, 5, 2, 1, 0.5, 0.3],
        16: [0.3, 0.4, 0.5, 0.7, 1, 2, 5, 10, 25, 10, 5, 2, 1, 0.7, 0.5, 0.4, 0.3]
    }
};
class PlinkoGameLogic {
    static playRound(rows, risk) {
        let rightMoves = 0;
        const path = [];
        for (let i = 0; i < rows; i++) {
            const direction = Math.random() < 0.5 ? 0 : 1; // 0 for left, 1 for right
            path.push(direction);
            rightMoves += direction;
        }
        const multipliers = PLINKO_MULTIPLIERS[risk][rows];
        const multiplier = multipliers[rightMoves];
        return { multiplier, path };
    }
}
exports.PlinkoGameLogic = PlinkoGameLogic;
class HiloGameLogic {
    static createDeck() {
        const deck = [];
        for (let i = 0; i < 4; i++) {
            deck.push(...this.CARDS);
        }
        // Fisher-Yates shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }
    static getCardValue(card) {
        return this.CARD_VALUES[card];
    }
    static calculateMultiplier(streak) {
        // This is a simple multiplier progression, can be made more complex
        if (streak === 0)
            return 1.0;
        const base = 1.05;
        const multiplier = Math.pow(base, streak) * (1 + streak * 0.05);
        return Math.floor(multiplier * 100) / 100;
    }
    static playRound(bet, previousCard, nextCard) {
        const prevValue = this.getCardValue(previousCard);
        const nextValue = this.getCardValue(nextCard);
        if (nextValue === prevValue)
            return { won: false }; // Bust on same card
        if (bet === 'higher')
            return { won: nextValue > prevValue };
        if (bet === 'lower')
            return { won: nextValue < prevValue };
        return { won: false };
    }
}
exports.HiloGameLogic = HiloGameLogic;
HiloGameLogic.CARDS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
HiloGameLogic.CARD_VALUES = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
};
class RouletteGame {
    static spinRoulette(betType, betValue) {
        const spinResult = Math.floor(Math.random() * 37); // 0-36
        let won = false;
        let payout = 0;
        let color = '';
        if (spinResult === 0) {
            color = 'green';
        }
        else if (this.RED_NUMBERS.has(spinResult)) {
            color = 'red';
        }
        else {
            color = 'black';
        }
        // Determine win/loss and payout based on bet type
        switch (betType) {
            case 'color': {
                // Color bet: red or black pays 1:1
                won = betValue === color && color !== 'green';
                payout = won ? 2 : 0;
                break;
            }
            case 'even_odd': {
                // Even/Odd bet pays 1:1
                const isEven = spinResult % 2 === 0;
                const isBetEven = betValue === 'even';
                won = (isEven && isBetEven) || (!isEven && !isBetEven);
                payout = won ? 2 : 0;
                break;
            }
            case 'high_low': {
                // High (19-36) / Low (1-18) pays 1:1
                const isHigh = spinResult >= 19 && spinResult <= 36;
                const isBetHigh = betValue === 'high';
                won = (isHigh && isBetHigh) || (!isHigh && !isBetHigh);
                payout = won ? 2 : 0;
                break;
            }
            case 'dozen': {
                // Dozen bet (1-12, 13-24, 25-36) pays 2:1
                let dozenRange = 0;
                if (spinResult >= 1 && spinResult <= 12)
                    dozenRange = 1;
                else if (spinResult >= 13 && spinResult <= 24)
                    dozenRange = 2;
                else if (spinResult >= 25 && spinResult <= 36)
                    dozenRange = 3;
                won = dozenRange === Number(betValue);
                payout = won ? 3 : 0;
                break;
            }
            case 'column': {
                // Column bet (1-34, 2-35, 3-36) pays 2:1
                let column = 0;
                if (spinResult > 0 && spinResult <= 36) {
                    column = ((spinResult - 1) % 3) + 1;
                }
                won = column === Number(betValue);
                payout = won ? 3 : 0;
                break;
            }
            case 'number': {
                // Straight bet on specific number pays 35:1
                won = spinResult === Number(betValue);
                payout = won ? 36 : 0;
                break;
            }
            default:
                won = false;
                payout = 0;
        }
        return {
            result: spinResult,
            won,
            payout,
            color
        };
    }
}
exports.RouletteGame = RouletteGame;
// European roulette: 37 numbers (0-36)
// Red: 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
// Black: 2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35
// Green: 0
RouletteGame.RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
RouletteGame.BLACK_NUMBERS = new Set([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);

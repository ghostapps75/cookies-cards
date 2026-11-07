import { describe, expect, it, vi } from 'vitest';
import type { Board, Card, DrawCount, Rank, Suit } from '../types';
import { RANKS, dealFromSeed } from '../utils/gameLogic';
import { solve, toGameMove, type SolverMove } from './klondike';

// The store asks the dealer for a hand the moment it is created. In here the
// hands are laid by the tests, so the dealer must never answer.
vi.mock('../utils/dealer', () => ({
    requestDeal: () => new Promise(() => {}),
    warmUp: () => {},
}));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
});
vi.stubGlobal('window', globalThis);

const loadStore = async () => (await import('../store/gameStore')).useGameStore;
type Store = Awaited<ReturnType<typeof loadStore>>;

const BUDGET = { maxMs: 1500, maxNodes: 150_000 };

/** Put this hand on the table, mid-game, as if it had just been dealt. */
const lay = (store: Store, board: Board, drawCount: DrawCount): void => {
    store.setState({
        ...board,
        status: 'playing',
        drawCount,
        score: 0,
        moves: 0,
        recycles: 0,
        wasteFan: 0,
        lastMoved: [],
        history: [],
        hint: null,
        started: false,
    });
};

/** Make one of the solver's moves through the real store, which must accept it. */
const play = (store: Store, move: SolverMove): void => {
    const state = store.getState();
    const gameMove = toGameMove(state, move);
    if (gameMove.kind === 'draw') {
        state.draw();
    } else {
        const ok = state.moveCards(gameMove.from, gameMove.cardId, gameMove.to);
        if (!ok) throw new Error(`Store refused ${gameMove.from} ${gameMove.cardId} -> ${gameMove.to}`);
    }
};

/** Play the solver's line through the real store, move by move, and check it wins. */
const replay = async (board: Board, drawCount: DrawCount, moves: SolverMove[]): Promise<void> => {
    const store = await loadStore();
    lay(store, board, drawCount);
    for (const move of moves) play(store, move);
    expect(store.getState().status).toBe('won');
};

describe('dealFromSeed', () => {
    it('lays the same hand for the same seed', () => {
        const a = dealFromSeed(12345);
        const b = dealFromSeed(12345);
        expect(a).toEqual(b);
        expect(dealFromSeed(12346)).not.toEqual(a);
    });

    it('deals a full, legal Klondike layout', () => {
        const board = dealFromSeed(7);
        const ids = [...board.stock, ...board.tableau.flat()].map(c => c.id);
        expect(new Set(ids).size).toBe(52);
        expect(board.stock).toHaveLength(24);
        board.tableau.forEach((pile, col) => {
            expect(pile).toHaveLength(col + 1);
            pile.forEach((card, i) => expect(card.isFaceUp).toBe(i === col));
        });
        expect(board.stock.every(c => !c.isFaceUp)).toBe(true);
    });
});

describe('solve', () => {
    const SEEDS = 60;

    for (const drawCount of [3, 1] as const) {
        it(`finds lines through most draw-${drawCount} hands, and every line wins in the store`, async () => {
            const tally = { won: 0, lost: 0, unknown: 0 };
            let ms = 0;
            let nodes = 0;
            let longest = 0;

            for (let seed = 1; seed <= SEEDS; seed++) {
                const board = dealFromSeed(seed);
                const result = solve(board, drawCount, BUDGET);
                tally[result.status] += 1;
                ms += result.ms;
                nodes += result.nodes;
                if (result.status === 'won') {
                    longest = Math.max(longest, result.moves.length);
                    await replay(dealFromSeed(seed), drawCount, result.moves);
                }
            }

            console.log(
                `draw-${drawCount}: ${tally.won} won, ${tally.lost} lost, ${tally.unknown} unknown of ${SEEDS}; ` +
                    `${(ms / SEEDS).toFixed(0)} ms and ${(nodes / SEEDS).toFixed(0)} nodes per hand; longest line ${longest} moves`,
            );
            expect(tally.won / SEEDS).toBeGreaterThan(0.5);
        }, 120_000);
    }

    it('reports a hand it cannot see through as unknown, within budget', () => {
        const result = solve(dealFromSeed(1), 3, { maxNodes: 5 });
        expect(['won', 'unknown']).toContain(result.status);
        expect(result.nodes).toBeLessThanOrEqual(6);
    });
});

describe('solve, mid-game', () => {
    /** The first dealt hand the solver sees through, turning three. */
    const winnableHand = (): { board: Board; moves: SolverMove[] } => {
        for (let seed = 1; seed <= 100; seed++) {
            const board = dealFromSeed(seed);
            const result = solve(board, 3, BUDGET);
            if (result.status === 'won') return { board, moves: result.moves };
        }
        throw new Error('No winnable hand among the first hundred seeds');
    };

    it('still finds a winning line after some of its own moves have been played', async () => {
        const { board, moves } = winnableHand();
        const store = await loadStore();
        lay(store, board, 3);

        // Partway in: face-down cards have turned up, the deck has been dug into.
        const played = Math.min(12, moves.length - 1);
        for (const move of moves.slice(0, played)) play(store, move);
        const midGame = store.getState();
        expect(midGame.status).toBe('playing');
        expect(midGame.moves).toBe(played);

        const again = solve(midGame, 3, BUDGET);
        expect(again.status).toBe('won');
        expect(again.moves.length).toBeGreaterThan(0);

        // The first move of the new line - what the Hint button points at - is
        // one the store accepts from this exact table.
        play(store, again.moves[0]);
        expect(store.getState().moves).toBe(played + 1);
    });

    const card = (rank: Rank, suit: Suit, isFaceUp = true): Card => ({ id: `${rank}_${suit}`, suit, rank, isFaceUp });
    const spade = (rank: Rank, isFaceUp = true): Card => card(rank, 'spades', isFaceUp);
    /** A foundation holding this suit from the ace up to `top`. */
    const home = (suit: Suit, top: Rank): Card[] => RANKS.slice(0, RANKS.indexOf(top) + 1).map(rank => card(rank, suit));

    /**
     * Hearts, clubs and diamonds are home; spades stopped at the three. The
     * four is face down under the king of spades, no column is empty for the
     * king to move to, and every other spade is stuck where it lies: black
     * cards cannot sit on black, and nothing red is left to sit on.
     */
    const buried: Board = {
        stock: [spade('6', false), spade('8', false)],
        waste: [],
        foundations: [home('spades', '3'), home('hearts', 'king'), home('clubs', 'king'), home('diamonds', 'king')],
        tableau: [
            [spade('4', false), spade('king')],
            [spade('5')],
            [spade('7')],
            [spade('9')],
            [spade('10')],
            [spade('jack')],
            [spade('queen')],
        ],
    };

    it('reports a hand as lost when the card it needs is buried under a king with nowhere to go', () => {
        const everything = [...buried.stock, ...buried.waste, ...buried.foundations.flat(), ...buried.tableau.flat()];
        expect(new Set(everything.map(c => c.id)).size).toBe(52);

        for (const drawCount of [1, 3] as const) {
            const result = solve(buried, drawCount, BUDGET);
            expect(result.status).toBe('lost');
            expect(result.moves).toEqual([]);
        }
    });

    it('sees the same hand through once the buried card is on top instead', async () => {
        const freed: Board = {
            ...buried,
            tableau: [[spade('king', false), spade('4')], ...buried.tableau.slice(1)],
        };
        for (const drawCount of [1, 3] as const) {
            const result = solve(freed, drawCount, BUDGET);
            expect(result.status).toBe('won');
            await replay(freed, drawCount, result.moves);
        }
    });
});

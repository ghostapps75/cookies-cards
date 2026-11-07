import { describe, expect, it, vi } from 'vitest';
import type { Board, DrawCount } from '../types';
import { dealFromSeed } from '../utils/gameLogic';
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

/** Play the solver's line through the real store, move by move, and check it wins. */
const replay = async (board: Board, drawCount: DrawCount, moves: SolverMove[]): Promise<void> => {
    const store = await loadStore();
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

    for (const move of moves) {
        const state = store.getState();
        const gameMove = toGameMove(state, move);
        if (gameMove.kind === 'draw') {
            state.draw();
        } else {
            const ok = state.moveCards(gameMove.from, gameMove.cardId, gameMove.to);
            if (!ok) throw new Error(`Store refused ${gameMove.from} ${gameMove.cardId} -> ${gameMove.to}`);
        }
    }
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
                const result = solve(board, drawCount, { maxMs: 1500, maxNodes: 150_000 });
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

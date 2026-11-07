import type { Board, DrawCount } from '../types';
import type { SolveReply, SolverReply, SolverRequest } from './solver.worker';

/**
 * The main thread's end of the solver worker. Requests go out numbered and
 * replies are matched up by number, so several can be in flight at once.
 *
 * There are two workers, not one: the dealer keeps the next hand cooking in
 * the background, and a hint must never wait in line behind that. If a worker
 * cannot be started or breaks, every open question gets a null answer and the
 * caller falls back to doing without; nobody asks that worker again.
 */

/** Search budget per position. Winnable hands usually fall in well under this. */
export const SOLVE_BUDGET = { maxNodes: 150_000, maxMs: 1500 } as const;

type Settle = (reply: SolverReply | null) => void;

const createLink = () => {
    let worker: Worker | null | undefined;
    let nextId = 1;
    const waiting = new Map<number, Settle>();

    const getWorker = (): Worker | null => {
        if (worker !== undefined) return worker;
        try {
            const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
            w.onmessage = (event: MessageEvent<SolverReply>) => {
                const settle = waiting.get(event.data.id);
                if (settle) {
                    waiting.delete(event.data.id);
                    settle(event.data);
                }
            };
            w.onerror = () => {
                w.terminate();
                worker = null;
                waiting.forEach(settle => settle(null));
                waiting.clear();
            };
            worker = w;
        } catch {
            worker = null;
        }
        return worker;
    };

    const request = (make: (id: number) => SolverRequest): Promise<SolverReply | null> =>
        new Promise(resolve => {
            const w = getWorker();
            if (!w) {
                resolve(null);
                return;
            }
            const id = nextId++;
            waiting.set(id, resolve);
            w.postMessage(make(id));
        });

    return { request };
};

const dealing = createLink();
const hinting = createLink();

/** A seed whose hand can be won, from up to `attempts` tries; null if none was, or the solver is unavailable. */
export const findWinnableSeed = async (attempts: number): Promise<number | null> => {
    const reply = await dealing.request(id => ({ type: 'find', id, attempts, ...SOLVE_BUDGET }));
    return reply?.type === 'find' ? reply.seed : null;
};

/** The solver's verdict on this table, with the first move of its line; null if the solver is unavailable. */
export const solveBoard = async (board: Board, drawCount: DrawCount): Promise<SolveReply | null> => {
    // Only the piles go across: a store state carries functions, which cannot be cloned.
    const piles: Board = {
        stock: board.stock,
        waste: board.waste,
        foundations: board.foundations,
        tableau: board.tableau,
    };
    const reply = await hinting.request(id => ({ type: 'solve', id, board: piles, drawCount, ...SOLVE_BUDGET }));
    return reply?.type === 'solve' ? reply : null;
};

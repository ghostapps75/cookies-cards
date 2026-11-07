import type { Board } from '../types';
import type { FindReply, FindRequest } from '../solver/solver.worker';
import { dealFromSeed, randomSeed } from './gameLogic';

/**
 * Hands out deals. Asked for a hand that can be won, it gets one from the
 * solver running in a worker, and it keeps one cooked and ready so that
 * pressing New is instant nearly every time. If the solver is slow, gives up,
 * or is not available at all, a plain shuffle goes out instead: nobody waits
 * on an empty table for long.
 */

export interface Deal {
    board: Board;
    seed: number;
    /** True when the solver has seen this hand through to the end. */
    winnable: boolean;
}

/** Seeds tried per request before the solver admits defeat. */
const ATTEMPTS = 8;
/** Search budget per seed. Winnable hands usually fall in well under this. */
const MAX_MS = 1500;
const MAX_NODES = 150_000;
/** How long the player waits on an empty table before we deal whatever comes. */
const PATIENCE_MS = 5000;

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, (seed: number | null) => void>();

const getWorker = (): Worker | null => {
    if (worker !== undefined) return worker;
    try {
        const w = new Worker(new URL('../solver/solver.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (event: MessageEvent<FindReply>) => {
            const resolve = waiting.get(event.data.id);
            if (resolve) {
                waiting.delete(event.data.id);
                resolve(event.data.seed);
            }
        };
        w.onerror = () => {
            // Whatever went wrong, every open request gets a plain shuffle and
            // nobody asks this worker again.
            w.terminate();
            worker = null;
            waiting.forEach(resolve => resolve(null));
            waiting.clear();
        };
        worker = w;
    } catch {
        worker = null;
    }
    return worker;
};

const cook = (): Promise<number | null> =>
    new Promise(resolve => {
        const w = getWorker();
        if (!w) {
            resolve(null);
            return;
        }
        const id = nextId++;
        waiting.set(id, resolve);
        const request: FindRequest = { id, attempts: ATTEMPTS, maxMs: MAX_MS, maxNodes: MAX_NODES };
        w.postMessage(request);
    });

/** One winnable seed kept warm, and at most one cooking. */
let reserve: number | undefined;
let inFlight: Promise<void> | null = null;

const cookInto = (): Promise<void> => {
    if (reserve !== undefined) return Promise.resolve();
    if (!inFlight) {
        inFlight = cook().then(seed => {
            inFlight = null;
            if (seed !== null && reserve === undefined) reserve = seed;
        });
    }
    return inFlight;
};

const take = (): number | undefined => {
    const seed = reserve;
    reserve = undefined;
    return seed;
};

const patience = (): Promise<void> => new Promise(resolve => window.setTimeout(resolve, PATIENCE_MS));

const plainShuffle = (): Deal => {
    const seed = randomSeed();
    return { board: dealFromSeed(seed), seed, winnable: false };
};

/** Start cooking a hand, if none is ready. */
export const warmUp = (): void => {
    void cookInto();
};

export const requestDeal = async (winnableOnly: boolean): Promise<Deal> => {
    if (!winnableOnly) return plainShuffle();

    let seed = take();
    if (seed === undefined) {
        await Promise.race([cookInto(), patience()]);
        seed = take();
    }

    // Keep one warm for next time. If the solver is still busy, this just
    // waits for it, so nothing is cooked twice.
    warmUp();

    return seed === undefined ? plainShuffle() : { board: dealFromSeed(seed), seed, winnable: true };
};

import type { Board } from '../types';
import { findWinnableSeed } from '../solver/client';
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
/** How long the player waits on an empty table before we deal whatever comes. */
const PATIENCE_MS = 5000;

/** One winnable seed kept warm, and at most one cooking. */
let reserve: number | undefined;
let inFlight: Promise<void> | null = null;

const cookInto = (): Promise<void> => {
    if (reserve !== undefined) return Promise.resolve();
    if (!inFlight) {
        inFlight = findWinnableSeed(ATTEMPTS).then(seed => {
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

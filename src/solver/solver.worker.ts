import { dealFromSeed, randomSeed } from '../utils/gameLogic';
import { solve } from './klondike';

/**
 * Looks for a hand that can be won, off the main thread so the table never
 * stutters. Each request tries a run of random seeds and reports the first
 * one the solver can see all the way through, or null if none of them were.
 *
 * Hands are always checked turning three cards. A line of play that works
 * turning three works turning one as well - every card it reaches is reached
 * by drawing singly to the same place - so one vouched-for seed serves both
 * settings, and the three-card search is the quicker of the two.
 */

export interface FindRequest {
    id: number;
    attempts: number;
    maxMs: number;
    maxNodes: number;
}

export interface FindReply {
    id: number;
    seed: number | null;
    tried: number;
    ms: number;
}

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<FindRequest>) => void) | null;
    postMessage(reply: FindReply): void;
};

scope.onmessage = event => {
    const request = event.data;
    const started = performance.now();

    for (let tried = 1; tried <= request.attempts; tried++) {
        const seed = randomSeed();
        const result = solve(dealFromSeed(seed), 3, {
            maxMs: request.maxMs,
            maxNodes: request.maxNodes,
        });
        if (result.status === 'won') {
            scope.postMessage({ id: request.id, seed, tried, ms: performance.now() - started });
            return;
        }
    }

    scope.postMessage({ id: request.id, seed: null, tried: request.attempts, ms: performance.now() - started });
};

import type { Board, DrawCount } from '../types';
import { dealFromSeed, randomSeed } from '../utils/gameLogic';
import { solve, type Solution, type SolverMove } from './klondike';

/**
 * The solver, off the main thread so the table never stutters. It runs two
 * errands: before a hand is dealt, finding one that can be won; and mid-game,
 * finding the next move on a winning line for the Hint button.
 */

/** Try a run of random seeds and report the first the solver sees all the way through. */
export interface FindRequest {
    type: 'find';
    id: number;
    attempts: number;
    maxMs: number;
    maxNodes: number;
}

/** Solve this table as it stands, turning this many cards. */
export interface SolveRequest {
    type: 'solve';
    id: number;
    board: Board;
    drawCount: DrawCount;
    maxMs: number;
    maxNodes: number;
}

export type SolverRequest = FindRequest | SolveRequest;

export interface FindReply {
    type: 'find';
    id: number;
    /** Null when none of the seeds tried could be won. */
    seed: number | null;
    tried: number;
    ms: number;
}

export interface SolveReply {
    type: 'solve';
    id: number;
    status: Solution['status'];
    /** The first move of the winning line, when there is one. */
    move: SolverMove | null;
    ms: number;
}

export type SolverReply = FindReply | SolveReply;

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<SolverRequest>) => void) | null;
    postMessage(reply: SolverReply): void;
};

/**
 * Hands are always checked turning three cards. A line of play that works
 * turning three works turning one as well - every card it reaches is reached
 * by drawing singly to the same place - so one vouched-for seed serves both
 * settings, and the three-card search is the quicker of the two.
 */
const findSeed = (request: FindRequest): FindReply => {
    const started = performance.now();
    for (let tried = 1; tried <= request.attempts; tried++) {
        const seed = randomSeed();
        const result = solve(dealFromSeed(seed), 3, { maxMs: request.maxMs, maxNodes: request.maxNodes });
        if (result.status === 'won') {
            return { type: 'find', id: request.id, seed, tried, ms: performance.now() - started };
        }
    }
    return { type: 'find', id: request.id, seed: null, tried: request.attempts, ms: performance.now() - started };
};

const solveBoard = (request: SolveRequest): SolveReply => {
    const result = solve(request.board, request.drawCount, { maxMs: request.maxMs, maxNodes: request.maxNodes });
    return { type: 'solve', id: request.id, status: result.status, move: result.moves[0] ?? null, ms: result.ms };
};

scope.onmessage = event => {
    const request = event.data;
    scope.postMessage(request.type === 'find' ? findSeed(request) : solveBoard(request));
};

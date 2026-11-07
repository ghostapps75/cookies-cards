import { create } from 'zustand';
import { randomSeed } from '../../utils/gameLogic';
import * as sfx from '../../utils/sound';
import { planComputerTurn, type ComputerStep } from './computer';
import {
    boardChanged,
    checkTurn,
    commitTurn,
    currentBoard,
    dealRound,
    drawTurn,
    everyTileAccountedFor,
    failTurn,
    isJoker,
    moveTiles,
    retrieveJoker,
    roundScore,
    setHolding,
    sortRack,
    withBoard,
    type Board,
    type MoveTarget,
    type Player,
    type RackSort,
    type Round,
} from './rules';

const GAME_KEY = 'cookie-tiles-game';
const STATS_KEY = 'cookie-tiles-stats';

export interface RoundRecord {
    number: number;
    winner: Player | null;
    how: 'out' | 'blocked';
    cookie: number;
    computer: number;
}

export interface TilesStats {
    won: number;
    played: number;
}

/** The computer's turn while it plays out. Steps land one at a time so they can be followed. */
export interface ComputerRun {
    steps: ComputerStep[];
    index: number;
    say: string;
    /** How long until the next thing happens, in milliseconds. */
    delay: number;
}

interface TilesState {
    round: Round;
    rounds: RoundRecord[];
    stats: TilesStats;
    rackSort: RackSort;
    /** Tiles Cookie has picked up. They stay where they are until she taps somewhere. */
    lifted: string[];
    /** Her moves this turn, for the one-step Undo. */
    history: Board[];
    computer: ComputerRun | null;
    /** What the computer did last time, said ahead of the instructions. */
    note: string | null;
    /** The tiles it laid down last turn, ringed so that she can spot them. */
    fresh: string[];
    notice: string | null;

    tapRackTile: (id: string) => void;
    tapTableTile: (id: string) => void;
    tapSet: (setId: string) => void;
    tapNewSet: () => void;
    tapRack: () => void;
    tapFelt: () => void;
    /** The start of a drag: this tile, and whatever else is lifted if it was too. False if it may not move. */
    grab: (id: string) => boolean;
    /** The end of a drag onto a set, and onto which tile of it, if any. */
    dropOnSet: (setId: string, tileId?: string) => void;
    undo: () => void;
    startOver: () => void;
    endTurn: () => void;
    draw: () => void;
    giveUp: () => void;
    sortBy: (mode: RackSort) => void;
    computerTick: () => void;
    nextRound: () => void;
    newRound: () => void;
    newGame: () => void;
    clearNotice: () => void;
}

/* --------------------------------------------------------------- saving */

const readJson = (key: string): unknown => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const writeJson = (key: string, value: unknown): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* private browsing: the game just will not resume */
    }
};

interface SavedGame {
    round: Round;
    rounds: RoundRecord[];
    rackSort: RackSort;
    fresh: string[];
    note: string | null;
}

const loadGame = (): SavedGame | null => {
    const saved = readJson(GAME_KEY) as Partial<SavedGame> | null;
    if (!saved?.round || !Array.isArray(saved.rounds)) return null;
    try {
        if (!everyTileAccountedFor(saved.round)) return null;
    } catch {
        return null;
    }
    return {
        round: saved.round,
        rounds: saved.rounds,
        rackSort: saved.rackSort === 'number' ? 'number' : 'color',
        fresh: Array.isArray(saved.fresh) ? saved.fresh : [],
        note: typeof saved.note === 'string' ? saved.note : null,
    };
};

const loadStats = (): TilesStats => {
    const saved = readJson(STATS_KEY) as Partial<TilesStats> | null;
    return { won: Number(saved?.won) || 0, played: Number(saved?.played) || 0 };
};

/* ---------------------------------------------------------------- pacing */

// A dev-only dial, so that a browser check can play a whole round without waiting.
let pace = 1;

const FIRST_THOUGHT_MS = 900;
const AFTER_LAST_STEP_MS = 650;

/** A pause of 600 to 1200 ms after a step, longer when more tiles moved. */
const stepDelay = (tilesMoved: number): number => Math.min(1200, 600 + tilesMoved * 150) * pace;

const startComputer = (round: Round): ComputerRun => ({
    steps: planComputerTurn({
        rack: round.racks.computer,
        table: round.table,
        opened: round.opened.computer,
        poolCount: round.pool.length,
    }),
    index: 0,
    say: 'Computer is thinking…',
    delay: FIRST_THOUGHT_MS * pace,
});

/* --------------------------------------------------------- starting state */

const freshRound = (number: number, rackSort: RackSort, seed = randomSeed()): Round => {
    const round = dealRound(seed, number);
    const rack = sortRack(round.racks.cookie, rackSort);
    return { ...round, racks: { ...round.racks, cookie: rack }, start: { ...round.start, rack } };
};

const initial = (): Pick<TilesState, 'round' | 'rounds' | 'rackSort' | 'fresh' | 'note' | 'computer'> => {
    const saved = loadGame();
    if (!saved) {
        return { round: freshRound(1, 'color'), rounds: [], rackSort: 'color', fresh: [], note: null, computer: null };
    }
    const computerToMove = saved.round.turn === 'computer' && !saved.round.result;
    return { ...saved, computer: computerToMove ? startComputer(saved.round) : null };
};

/* -------------------------------------------------------------- the store */

const isCookiesMove = (state: TilesState): boolean =>
    state.round.turn === 'cookie' && !state.round.result && !state.computer;

const saveGame = (state: Pick<TilesState, 'round' | 'rounds' | 'rackSort' | 'fresh' | 'note'>): void => {
    writeJson(GAME_KEY, {
        round: state.round,
        rounds: state.rounds,
        rackSort: state.rackSort,
        fresh: state.fresh,
        note: state.note,
    });
};

export const useTiles = create<TilesState>((set, get) => {
    /** Is this tile part of the table as it stood when the turn began? */
    const wasOnTable = (id: string): boolean =>
        get().round.start.table.some(other => other.tiles.some(tile => tile.id === id));

    /** Before opening, what was already on the table is out of bounds. */
    const refuseIfLocked = (ids: readonly string[]): boolean => {
        const { round } = get();
        if (round.opened.cookie || !ids.some(wasOnTable)) return false;
        sfx.playInvalid();
        set({ notice: 'You can use the table once you have opened: put down 30 points of your own first.' });
        return true;
    };

    const applyBoard = (board: Board, lifted: string[] = []): void => {
        const { round, history, rackSort } = get();
        const before = currentBoard(round);
        const next = withBoard(round, { table: board.table, rack: sortRack(board.rack, rackSort) });
        set({ round: next, history: [...history, before], lifted });
        saveGame(get());
    };

    const moveLifted = (target: MoveTarget): void => {
        const { round, lifted } = get();
        applyBoard(moveTiles(currentBoard(round), lifted, target));
        sfx.playPlace();
    };

    /** One tile in hand, put on a joker it can replace: the joker comes away, ready to be played. */
    const swapForJoker = (jokerId: string): boolean => {
        const { round, lifted } = get();
        if (lifted.length !== 1 || !round.opened.cookie) return false;
        const holder = setHolding(round.table, jokerId);
        if (!holder || !holder.tiles.some(tile => tile.id === jokerId && isJoker(tile))) return false;
        const swapped = retrieveJoker(currentBoard(round), holder.id, jokerId, lifted[0]);
        if (!swapped) return false;
        applyBoard(swapped, [jokerId]);
        sfx.playPlace();
        set({ notice: 'You got the joker! Now play it: tap a set, or the dotted spot.' });
        return true;
    };

    /** The round has ended: put it in the book and tell the stats. */
    const settle = (round: Round): void => {
        const result = round.result;
        if (!result) return;
        const score = roundScore(result);
        const { rounds, stats } = get();
        const record: RoundRecord = {
            number: round.number,
            winner: result.winner,
            how: result.how,
            cookie: score.cookie,
            computer: score.computer,
        };
        const nextStats = {
            won: stats.won + (result.winner === 'cookie' ? 1 : 0),
            played: stats.played + 1,
        };
        writeJson(STATS_KEY, nextStats);
        set({
            round,
            rounds: [...rounds, record],
            stats: nextStats,
            computer: null,
            history: [],
            lifted: [],
            note: null,
            notice: null,
        });
        if (result.winner === 'cookie') sfx.playWin();
        saveGame(get());
    };

    /** Cookie's turn is over, one way or another. */
    const afterCookie = (round: Round): void => {
        if (round.result) {
            settle(round);
            return;
        }
        set({
            round,
            computer: startComputer(round),
            history: [],
            lifted: [],
            note: null,
            fresh: [],
            notice: null,
        });
        // Saved here, and not again until the computer has finished, so a reload
        // mid-turn simply has it play the same turn over from the start.
        saveGame(get());
    };

    const dealNew = (number: number, rounds: RoundRecord[]): void => {
        const { rackSort } = get();
        set({
            round: freshRound(number, rackSort),
            rounds,
            computer: null,
            history: [],
            lifted: [],
            note: null,
            fresh: [],
            notice: null,
        });
        sfx.playShuffle();
        saveGame(get());
    };

    return {
        ...initial(),
        stats: loadStats(),
        lifted: [],
        history: [],
        notice: null,

        tapRackTile: id => {
            const state = get();
            if (!isCookiesMove(state)) return;
            if (state.lifted.includes(id)) {
                set({ lifted: state.lifted.filter(other => other !== id) });
                sfx.playPlace();
            } else {
                set({ lifted: [...state.lifted, id] });
                sfx.playPickup();
            }
        },

        tapTableTile: id => {
            const state = get();
            if (!isCookiesMove(state)) return;
            const { lifted, round } = state;

            if (lifted.includes(id)) {
                set({ lifted: lifted.filter(other => other !== id) });
                sfx.playPlace();
                return;
            }
            if (refuseIfLocked([id])) return;

            const holder = setHolding(round.table, id);
            if (!holder) return;

            // Nothing in hand, or more from the set already being taken apart: pick it up.
            if (lifted.length === 0 || lifted.every(other => holder.tiles.some(held => held.id === other))) {
                set({ lifted: [...lifted, id] });
                sfx.playPickup();
                return;
            }

            if (swapForJoker(id)) return;

            get().tapSet(holder.id);
        },

        tapSet: setId => {
            const state = get();
            if (!isCookiesMove(state) || state.lifted.length === 0) return;
            const target = state.round.table.find(other => other.id === setId);
            if (!target) return;
            if (refuseIfLocked(target.tiles.map(tile => tile.id))) return;
            if (state.lifted.every(id => target.tiles.some(tile => tile.id === id))) {
                set({ lifted: [] });
                return;
            }
            moveLifted({ kind: 'set', setId });
        },

        tapNewSet: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            if (state.lifted.length === 0) {
                sfx.playInvalid();
                set({ notice: 'Tap a tile first to pick it up, then tap here.' });
                return;
            }
            moveLifted({ kind: 'new' });
        },

        tapRack: () => {
            const state = get();
            if (!isCookiesMove(state) || state.lifted.length === 0) return;
            const { lifted, round } = state;
            const stuck = lifted.filter(wasOnTable);
            const onRack = lifted.filter(id => round.racks.cookie.some(tile => tile.id === id));
            const back = lifted.filter(id => !stuck.includes(id) && !onRack.includes(id));

            if (back.length > 0) {
                applyBoard(moveTiles(currentBoard(round), back, { kind: 'rack' }), stuck);
                sfx.playPlace();
            } else {
                set({ lifted: stuck });
            }
            if (stuck.length > 0) {
                sfx.playInvalid();
                set({ notice: 'Tiles that were on the table have to stay on the table.' });
            }
        },

        tapFelt: () => {
            if (get().lifted.length > 0) set({ lifted: [] });
        },

        grab: id => {
            const state = get();
            if (!isCookiesMove(state)) return false;
            if (state.lifted.includes(id)) return true;
            if (refuseIfLocked([id])) return false;
            set({ lifted: [id] });
            sfx.playPickup();
            return true;
        },

        dropOnSet: (setId, tileId) => {
            if (tileId && swapForJoker(tileId)) return;
            get().tapSet(setId);
        },

        undo: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            const previous = state.history[state.history.length - 1];
            if (!previous) return;
            const round = withBoard(state.round, {
                table: previous.table,
                rack: sortRack(previous.rack, state.rackSort),
            });
            set({ round, history: state.history.slice(0, -1), lifted: [] });
            sfx.playUndo();
            saveGame(get());
        },

        startOver: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            const { start } = state.round;
            const round = withBoard(state.round, { table: start.table, rack: sortRack(start.rack, state.rackSort) });
            set({ round, history: [], lifted: [] });
            sfx.playUndo();
            saveGame(get());
        },

        endTurn: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            const { round: next, problem } = commitTurn(state.round);
            if (problem) {
                sfx.playInvalid();
                return;
            }
            sfx.playPlace();
            afterCookie(next);
        },

        draw: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            if (boardChanged(state.round.start, currentBoard(state.round))) return;
            sfx.playDeal();
            const next = drawTurn(state.round);
            const rack = sortRack(next.racks.cookie, state.rackSort);
            afterCookie({ ...next, racks: { ...next.racks, cookie: rack } });
        },

        giveUp: () => {
            const state = get();
            if (!isCookiesMove(state)) return;
            sfx.playUndo();
            const next = failTurn(state.round);
            const rack = sortRack(next.racks.cookie, state.rackSort);
            afterCookie({ ...next, racks: { ...next.racks, cookie: rack } });
        },

        sortBy: mode => {
            const state = get();
            sfx.playClick();
            const rack = sortRack(state.round.racks.cookie, mode);
            set({ rackSort: mode, round: { ...state.round, racks: { ...state.round.racks, cookie: rack } } });
            saveGame(get());
        },

        computerTick: () => {
            const state = get();
            const run = state.computer;
            if (!run) return;

            if (run.index < run.steps.length) {
                const step = run.steps[run.index];
                const moved = state.round.racks.computer.length - step.rack.length;
                sfx.playPlace();
                set({
                    round: withBoard(state.round, step),
                    computer: {
                        ...run,
                        index: run.index + 1,
                        say: step.say,
                        delay: run.index + 1 < run.steps.length ? stepDelay(moved) : AFTER_LAST_STEP_MS * pace,
                    },
                });
                return;
            }

            if (run.steps.length === 0) {
                sfx.playDeal();
                const hadTile = state.round.pool.length > 0;
                const next = drawTurn(state.round);
                if (next.result) {
                    settle(next);
                    return;
                }
                set({
                    round: next,
                    computer: null,
                    fresh: [],
                    note: hadTile ? 'Computer drew a tile.' : 'Computer passed.',
                });
                saveGame(get());
                return;
            }

            // The rules have the last word on every turn, the computer's included.
            const { round: next, problem } = commitTurn(state.round);
            if (problem) {
                settle(failed(state.round));
                return;
            }
            const { start } = state.round;
            const played = start.rack.filter(tile => !state.round.racks.computer.some(other => other.id === tile.id));
            if (next.result) {
                settle(next);
                return;
            }
            let said = played.length === 1 ? 'Computer played 1 tile.' : `Computer played ${played.length} tiles.`;
            if (!state.round.opened.computer) said = `${run.steps[run.steps.length - 1].say}.`;
            set({
                round: next,
                computer: null,
                fresh: played.map(tile => tile.id),
                note: said,
            });
            saveGame(get());
        },

        nextRound: () => {
            const { round, rounds } = get();
            dealNew(round.number + 1, rounds);
        },

        newRound: () => {
            const { round, rounds } = get();
            // A round abandoned half way does not count for anyone.
            dealNew(round.result ? round.number + 1 : round.number, rounds);
        },

        newGame: () => {
            dealNew(1, []);
        },

        clearNotice: () => set({ notice: null }),
    };

    /** Should never happen: the plan broke a rule, so its turn is thrown out and the game goes on. */
    function failed(round: Round): Round {
        return failTurn(round);
    }
});

/** Everything needed to know whether End turn may be pressed. */
export const turnCheck = (round: Round) => checkTurn(round.start, currentBoard(round), round.opened.cookie);

if (import.meta.env.DEV) {
    // For checking the game in a browser, as solitaire does with window.game.
    (window as unknown as { tilesGame: unknown }).tilesGame = {
        store: useTiles,
        setPace: (value: number) => {
            pace = value;
        },
        deal: (seed: number) => {
            useTiles.setState({
                round: freshRound(1, useTiles.getState().rackSort, seed),
                computer: null,
                history: [],
                lifted: [],
                note: null,
                fresh: [],
                notice: null,
            });
        },
    };
}

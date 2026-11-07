import type { Board, DrawCount, PileId } from '../types';
import { RANKS, SUITS } from '../utils/gameLogic';

/**
 * A Klondike solver that knows every card, face-down ones included.
 *
 * It exists to vouch for a deal before the player sees it: a hand is only put
 * on the table if a line of play from the first card to the last has been
 * found. It plays by exactly the rules in the store - draw one or three, turn
 * the deck over as often as you like, kings alone on empty columns - with one
 * omission: it never takes a card back off a foundation. That is almost never
 * needed, and leaving it out keeps the search small.
 *
 * The search is a depth-first walk with a memory of every table it has seen,
 * so it never loops, and a budget, so it never hangs. Cards that can go home
 * without any possible regret go home without being asked.
 */

export type SolverMove =
    | { kind: 'draw' }
    | { kind: 'toFoundation'; from: 'waste' | number }
    | { kind: 'toTableau'; from: 'waste' | number; index: number; to: number };

export interface Solution {
    /** 'lost' means every line was tried; 'unknown' means the budget ran out. */
    status: 'won' | 'lost' | 'unknown';
    moves: SolverMove[];
    nodes: number;
    ms: number;
}

export interface SolveOptions {
    maxNodes?: number;
    maxMs?: number;
}

/*
 * Cards are small integers: suit * 13 + rank, with suits in SUITS order
 * (spades, hearts, clubs, diamonds - so the red suits are the odd ones) and
 * ranks from ace = 0 to king = 12.
 */
const KING = 12;
const rankOf = (c: number): number => c % 13;
const suitOf = (c: number): number => (c / 13) | 0;
const isRedCode = (c: number): boolean => (suitOf(c) & 1) === 1;

interface State {
    tab: number[][];
    /** Face-down cards sit at the bottom of a column; this many of them. */
    down: number[];
    /** Cards home per suit, so found[s] is also the rank the suit wants next. */
    found: number[];
    /**
     * Stock and waste as one list in the order cards come off the deck. The
     * first `pos` of them are on the waste, with deck[pos - 1] showing.
     */
    deck: number[];
    pos: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const fromBoard = (board: Board): State => {
    const code = (c: { suit: string; rank: string }): number =>
        SUITS.indexOf(c.suit as (typeof SUITS)[number]) * 13 + RANKS.indexOf(c.rank as (typeof RANKS)[number]);
    const found = [0, 0, 0, 0];
    board.foundations.forEach(pile => {
        if (pile.length) found[suitOf(code(pile[0]))] = pile.length;
    });
    return {
        tab: board.tableau.map(pile => pile.map(code)),
        down: board.tableau.map(pile => pile.filter(c => !c.isFaceUp).length),
        found,
        deck: [...board.waste.map(code), ...board.stock.map(code).reverse()],
        pos: board.waste.length,
    };
};

const canGoHome = (s: State, c: number): boolean => s.found[suitOf(c)] === rankOf(c);

const canSitOn = (c: number, top: number): boolean =>
    isRedCode(c) !== isRedCode(top) && rankOf(top) === rankOf(c) + 1;

/**
 * A card can go home with no possible regret once nothing could ever want to
 * sit on it: both cards of the other colour one rank below are already home.
 */
const isSafeHome = (s: State, c: number): boolean => {
    const r = rankOf(c);
    if (r <= 1) return true;
    const red = isRedCode(c);
    return s.found[red ? 0 : 1] >= r && s.found[red ? 2 : 3] >= r;
};

const isWon = (s: State): boolean => s.found[0] + s.found[1] + s.found[2] + s.found[3] === 52;

const wasteTopOf = (s: State): number => (s.pos > 0 ? s.deck[s.pos - 1] : -1);

const firstEmpty = (s: State): number => s.tab.findIndex(pile => pile.length === 0);

const wasteTopPlayable = (s: State): boolean => {
    const c = wasteTopOf(s);
    if (c < 0) return false;
    if (canGoHome(s, c)) return true;
    for (let j = 0; j < 7; j++) {
        const pile = s.tab[j];
        if (pile.length === 0 ? rankOf(c) === KING : canSitOn(c, pile[pile.length - 1])) return true;
    }
    return false;
};

const apply = (s: State, m: SolverMove, drawCount: DrawCount): State => {
    if (m.kind === 'draw') {
        const n = s.deck.length;
        return { ...s, pos: s.pos >= n ? 0 : Math.min(n, s.pos + drawCount) };
    }

    const next: State = { tab: s.tab.slice(), down: s.down.slice(), found: s.found, deck: s.deck, pos: s.pos };
    let moving: number[];
    if (m.from === 'waste') {
        moving = [s.deck[s.pos - 1]];
        next.deck = s.deck.slice(0, s.pos - 1).concat(s.deck.slice(s.pos));
        next.pos = s.pos - 1;
    } else {
        const pile = s.tab[m.from];
        const index = m.kind === 'toTableau' ? m.index : pile.length - 1;
        moving = pile.slice(index);
        next.tab[m.from] = pile.slice(0, index);
        // Uncover whatever the moved run was sitting on.
        if (next.down[m.from] > 0 && next.tab[m.from].length === next.down[m.from]) next.down[m.from] -= 1;
    }

    if (m.kind === 'toFoundation') {
        next.found = s.found.slice();
        next.found[suitOf(moving[0])] += 1;
    } else {
        next.tab[m.to] = s.tab[m.to].concat(moving);
    }
    return next;
};

/**
 * A fingerprint of the table. Columns are sorted so that the same cards in
 * different columns count as the same position: which column is which makes
 * no difference to the game, and treating them alike roughly halves the search.
 */
const keyOf = (s: State): string => {
    const columns: string[] = [];
    for (let i = 0; i < 7; i++) {
        columns.push(s.down[i] + String.fromCharCode(...s.tab[i].map(c => c + 40)));
    }
    columns.sort();
    return (
        columns.join('|') +
        '#' +
        String.fromCharCode(...s.found.map(f => f + 40)) +
        '#' +
        String.fromCharCode(...s.deck.map(c => c + 40)) +
        '#' +
        s.pos
    );
};

/**
 * Moves worth trying from here, best first. Only moves that get somewhere are
 * offered: a card goes home, a face-down card is uncovered, a column is
 * freed, a card comes off the waste, or part of a run slides aside to let the
 * card beneath it go home. Shuffling runs between columns for its own sake
 * is left out; it only multiplies positions.
 */
const candidates = (s: State, afterDeadDraw: boolean): SolverMove[] => {
    const moves: SolverMove[] = [];

    // The last draw turned up nothing playable. Every table move available now
    // was available before the draw too, and has been tried from there, so the
    // only new thing to do is keep turning the deck.
    if (afterDeadDraw) {
        if (s.deck.length) moves.push({ kind: 'draw' });
        return moves;
    }

    const wasteTop = wasteTopOf(s);
    const empty = firstEmpty(s);

    for (let i = 0; i < 7; i++) {
        const pile = s.tab[i];
        if (pile.length && canGoHome(s, pile[pile.length - 1])) moves.push({ kind: 'toFoundation', from: i });
    }
    if (wasteTop >= 0 && canGoHome(s, wasteTop)) moves.push({ kind: 'toFoundation', from: 'waste' });

    const uncovering: { move: SolverMove; hidden: number }[] = [];
    const freeing: SolverMove[] = [];
    const partial: SolverMove[] = [];

    for (let i = 0; i < 7; i++) {
        const pile = s.tab[i];
        const d = s.down[i];
        if (pile.length <= d) continue;

        const head = pile[d];
        for (let j = 0; j < 7; j++) {
            if (j === i) continue;
            const target = s.tab[j];
            if (target.length === 0) {
                // A king to an empty column, but only if that uncovers something.
                // Moving a whole column into another empty column changes nothing.
                if (rankOf(head) !== KING || j !== empty || d === 0) continue;
                uncovering.push({ move: { kind: 'toTableau', from: i, index: d, to: j }, hidden: d });
            } else if (canSitOn(head, target[target.length - 1])) {
                const move: SolverMove = { kind: 'toTableau', from: i, index: d, to: j };
                if (d > 0) uncovering.push({ move, hidden: d });
                else freeing.push(move);
            }
        }

        for (let index = d + 1; index < pile.length; index++) {
            if (!canGoHome(s, pile[index - 1])) continue;
            const h = pile[index];
            for (let j = 0; j < 7; j++) {
                if (j === i) continue;
                const target = s.tab[j];
                if (target.length && canSitOn(h, target[target.length - 1])) {
                    partial.push({ kind: 'toTableau', from: i, index, to: j });
                }
            }
        }
    }

    // Dig where the most cards are buried.
    uncovering.sort((a, b) => b.hidden - a.hidden);
    uncovering.forEach(entry => moves.push(entry.move));

    if (wasteTop >= 0) {
        for (let j = 0; j < 7; j++) {
            const target = s.tab[j];
            const fits = target.length === 0
                ? rankOf(wasteTop) === KING && j === empty
                : canSitOn(wasteTop, target[target.length - 1]);
            if (fits) moves.push({ kind: 'toTableau', from: 'waste', index: 0, to: j });
        }
    }

    moves.push(...freeing, ...partial);
    if (s.deck.length) moves.push({ kind: 'draw' });
    return moves;
};

export const solve = (board: Board, drawCount: DrawCount, options: SolveOptions = {}): Solution => {
    const maxNodes = options.maxNodes ?? 150_000;
    const started = now();
    const deadline = started + (options.maxMs ?? 2000);

    const visited = new Set<string>();
    const path: SolverMove[] = [];
    let nodes = 0;
    let outOfBudget = false;

    const dfs = (initial: State, afterDeadDraw: boolean): boolean => {
        const mark = path.length;
        let s = initial;

        // Send home whatever can go with no regret, and keep going while it lasts.
        let again = true;
        while (again) {
            again = false;
            for (let i = 0; i < 7; i++) {
                const pile = s.tab[i];
                if (!pile.length) continue;
                const c = pile[pile.length - 1];
                if (canGoHome(s, c) && isSafeHome(s, c)) {
                    const move: SolverMove = { kind: 'toFoundation', from: i };
                    path.push(move);
                    s = apply(s, move, drawCount);
                    again = true;
                }
            }
            const w = wasteTopOf(s);
            if (w >= 0 && canGoHome(s, w) && isSafeHome(s, w)) {
                const move: SolverMove = { kind: 'toFoundation', from: 'waste' };
                path.push(move);
                s = apply(s, move, drawCount);
                again = true;
            }
        }

        if (isWon(s)) return true;

        const key = keyOf(s);
        if (visited.has(key)) {
            path.length = mark;
            return false;
        }
        visited.add(key);

        nodes += 1;
        if (nodes > maxNodes || ((nodes & 255) === 0 && now() > deadline)) {
            outOfBudget = true;
            path.length = mark;
            return false;
        }

        for (const move of candidates(s, afterDeadDraw)) {
            path.push(move);
            const next = apply(s, move, drawCount);
            if (dfs(next, move.kind === 'draw' && !wasteTopPlayable(next))) return true;
            path.pop();
            if (outOfBudget) break;
        }

        path.length = mark;
        return false;
    };

    const won = dfs(fromBoard(board), false);
    return {
        status: won ? 'won' : outOfBudget ? 'unknown' : 'lost',
        moves: won ? path.slice() : [],
        nodes,
        ms: now() - started,
    };
};

/** A solver move spelled out in the store's terms, against the board as it is now. */
export type GameMove = { kind: 'draw' } | { kind: 'move'; from: PileId; cardId: string; to: PileId };

export const toGameMove = (board: Board, move: SolverMove): GameMove => {
    if (move.kind === 'draw') return { kind: 'draw' };

    const from: PileId = move.from === 'waste' ? 'waste' : `tableau-${move.from}`;
    let card;
    if (move.from === 'waste') {
        card = board.waste[board.waste.length - 1];
    } else {
        const pile = board.tableau[move.from];
        card = pile[move.kind === 'toTableau' ? move.index : pile.length - 1];
    }
    if (!card) throw new Error(`No card to move from ${from}`);

    if (move.kind === 'toTableau') return { kind: 'move', from, cardId: card.id, to: `tableau-${move.to}` };

    // The store's foundations are not tied to a suit; find the one this suit lives in.
    let f = board.foundations.findIndex(pile => pile.length > 0 && pile[0].suit === card.suit);
    if (f === -1) f = board.foundations.findIndex(pile => pile.length === 0);
    if (f === -1) throw new Error(`No foundation for ${card.id}`);
    return { kind: 'move', from, cardId: card.id, to: `foundation-${f}` };
};

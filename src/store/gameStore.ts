import { create } from 'zustand';
import type { Card, PileId } from '../types';
import {
    canStackOnFoundation,
    canStackOnTableau,
    createDeck,
    isMovableRun,
    shuffleDeck,
} from '../utils/gameLogic';
import * as sfx from '../utils/sound';

const SAVE_KEY = 'cookie-solitaire-save';
const STATS_KEY = 'cookie-solitaire-stats';
const MAX_HISTORY = 400;

export type DrawCount = 1 | 3;
export type GameStatus = 'dealing' | 'playing' | 'won';

interface Board {
    stock: Card[];
    waste: Card[];
    foundations: Card[][];
    tableau: Card[][];
}

interface Snapshot extends Board {
    score: number;
    moves: number;
    recycles: number;
}

export interface Hint {
    cardIds: string[];
    toPileId: PileId;
    /** Nothing to do but turn the deck over. */
    deckOnly?: boolean;
}

/** What one tick of the auto-finisher managed to do. */
export type AutoStep = 'placed' | 'drew' | 'done';

export interface Stats {
    played: number;
    won: number;
    bestTime: number | null;
    bestScore: number;
}

interface GameState extends Board {
    gameId: number;
    status: GameStatus;
    score: number;
    moves: number;
    seconds: number;
    recycles: number;
    drawCount: DrawCount;
    history: Snapshot[];
    hint: Hint | null;
    started: boolean;
    stats: Stats;

    newGame: (drawCount?: DrawCount) => void;
    finishDeal: () => void;
    tick: () => void;
    draw: () => void;
    undo: () => void;
    canUndo: () => boolean;
    moveCards: (from: PileId, cardId: string, to: PileId) => boolean;
    sendHome: (from: PileId, cardId: string) => boolean;
    flipTableauTop: (pileId: PileId) => boolean;
    canAutoComplete: () => boolean;
    autoCompleteStep: () => AutoStep;
    showHint: () => void;
    clearHint: () => void;
    setDrawCount: (drawCount: DrawCount) => void;
}

const emptyBoard = (): Board => ({
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
});

const loadStats = (): Stats => {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (raw) return { played: 0, won: 0, bestTime: null, bestScore: 0, ...JSON.parse(raw) };
    } catch {
        /* ignore */
    }
    return { played: 0, won: 0, bestTime: null, bestScore: 0 };
};

const saveStats = (stats: Stats): void => {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
        /* ignore */
    }
};

const deal = (): Board => {
    const deck = shuffleDeck(createDeck());
    const board = emptyBoard();

    for (let col = 0; col < 7; col++) {
        const cards = deck.splice(0, col + 1);
        cards[cards.length - 1].isFaceUp = true;
        board.tableau[col] = cards;
    }
    board.stock = deck;
    return board;
};

/**
 * Only the piles are copied, not the cards in them. Once a card is in the store
 * it is never mutated in place - every change spreads a new object - so sharing
 * them keeps identity stable for the fifty-odd cards a move does not touch,
 * which is what lets React skip re-rendering them.
 */
const cloneBoard = (b: Board): Board => ({
    stock: [...b.stock],
    waste: [...b.waste],
    foundations: b.foundations.map(p => [...p]),
    tableau: b.tableau.map(p => [...p]),
});

const pileIndex = (id: PileId): number => Number(id.slice(id.indexOf('-') + 1));

const readPile = (b: Board, id: PileId): Card[] => {
    if (id === 'stock') return b.stock;
    if (id === 'waste') return b.waste;
    if (id.startsWith('foundation')) return b.foundations[pileIndex(id)];
    return b.tableau[pileIndex(id)];
};

const writePile = (b: Board, id: PileId, cards: Card[]): void => {
    if (id === 'stock') b.stock = cards;
    else if (id === 'waste') b.waste = cards;
    else if (id.startsWith('foundation')) b.foundations[pileIndex(id)] = cards;
    else b.tableau[pileIndex(id)] = cards;
};

const topOf = (cards: Card[]): Card | undefined => cards[cards.length - 1];

const isWon = (b: Board): boolean => b.foundations.every(p => p.length === 13);

/** Classic Windows Solitaire scoring, so the numbers feel familiar. */
const moveScore = (from: PileId, to: PileId): number => {
    const toFoundation = to.startsWith('foundation');
    const fromFoundation = from.startsWith('foundation');
    if (toFoundation) return 10;
    if (fromFoundation) return -15;
    if (from === 'waste') return 5;
    return 0;
};

// --- persistence -----------------------------------------------------------

interface SavedGame extends Board {
    gameId: number;
    score: number;
    moves: number;
    seconds: number;
    recycles: number;
    drawCount: DrawCount;
    started: boolean;
    /** Enough of the past that Undo still works after closing the tab. */
    history?: Snapshot[];
}

const SAVED_HISTORY = 25;

const persist = (s: GameState): void => {
    if (s.status === 'won') {
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch {
            /* ignore */
        }
        return;
    }
    const save: SavedGame = {
        stock: s.stock,
        waste: s.waste,
        foundations: s.foundations,
        tableau: s.tableau,
        gameId: s.gameId,
        score: s.score,
        moves: s.moves,
        seconds: s.seconds,
        recycles: s.recycles,
        drawCount: s.drawCount,
        started: s.started,
        history: s.history.slice(-SAVED_HISTORY),
    };
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
        /* ignore */
    }
};

const loadSave = (): SavedGame | null => {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedGame;
        if (!parsed.tableau || parsed.tableau.length !== 7 || !parsed.foundations) return null;
        const total =
            parsed.stock.length +
            parsed.waste.length +
            parsed.foundations.reduce((n, p) => n + p.length, 0) +
            parsed.tableau.reduce((n, p) => n + p.length, 0);
        if (total !== 52) return null;
        return parsed;
    } catch {
        return null;
    }
};

const restored = loadSave();
const initialBoard: Board = restored
    ? {
          stock: restored.stock,
          waste: restored.waste,
          foundations: restored.foundations,
          tableau: restored.tableau,
      }
    : deal();

export const useGameStore = create<GameState>((set, get) => ({
    ...initialBoard,
    gameId: restored?.gameId ?? 1,
    status: 'dealing',
    score: restored?.score ?? 0,
    moves: restored?.moves ?? 0,
    seconds: restored?.seconds ?? 0,
    recycles: restored?.recycles ?? 0,
    drawCount: restored?.drawCount ?? 3,
    history: restored?.history ?? [],
    hint: null,
    started: restored?.started ?? false,
    stats: loadStats(),

    newGame: drawCount => {
        const board = deal();
        const stats = { ...get().stats, played: get().stats.played + 1 };
        saveStats(stats);
        sfx.playShuffle();
        set(s => ({
            ...board,
            gameId: s.gameId + 1,
            status: 'dealing',
            score: 0,
            moves: 0,
            seconds: 0,
            recycles: 0,
            drawCount: drawCount ?? s.drawCount,
            history: [],
            hint: null,
            started: false,
            stats,
        }));
        persist(get());
    },

    finishDeal: () => {
        if (get().status === 'dealing') set({ status: 'playing' });
    },

    tick: () => {
        const s = get();
        if (s.status !== 'playing' || !s.started) return;
        set({ seconds: s.seconds + 1 });
    },

    setDrawCount: drawCount => {
        if (get().drawCount === drawCount) return;
        get().newGame(drawCount);
    },

    canUndo: () => get().history.length > 0,

    draw: () => {
        const s = get();
        if (s.status !== 'playing') return;

        const snapshot = takeSnapshot(s);
        const board = cloneBoard(s);

        if (board.stock.length === 0) {
            if (board.waste.length === 0) return;
            board.stock = [...board.waste].reverse().map(c => ({ ...c, isFaceUp: false }));
            board.waste = [];
            const penalty = s.drawCount === 1 ? 100 : 20;
            sfx.playRecycle();
            set({
                ...board,
                history: pushHistory(s.history, snapshot),
                score: Math.max(0, s.score - (s.recycles > 0 ? penalty : 0)),
                recycles: s.recycles + 1,
                moves: s.moves + 1,
                hint: null,
                started: true,
            });
        } else {
            const count = Math.min(s.drawCount, board.stock.length);
            const drawn = board.stock.splice(-count).reverse().map(c => ({ ...c, isFaceUp: true }));
            board.waste = [...board.waste, ...drawn];
            drawn.forEach((_, i) => sfx.playDeal(i * 0.075));
            set({
                ...board,
                history: pushHistory(s.history, snapshot),
                moves: s.moves + 1,
                hint: null,
                started: true,
            });
        }
        persist(get());
    },

    undo: () => {
        const s = get();
        const previous = s.history[s.history.length - 1];
        if (!previous) return;

        sfx.playUndo();
        set({
            stock: previous.stock,
            waste: previous.waste,
            foundations: previous.foundations,
            tableau: previous.tableau,
            score: previous.score,
            moves: previous.moves,
            recycles: previous.recycles,
            history: s.history.slice(0, -1),
            status: 'playing',
            hint: null,
        });
        persist(get());
    },

    moveCards: (from, cardId, to) => {
        const s = get();
        if (s.status !== 'playing' || from === to) return false;

        const source = readPile(s, from);
        const index = source.findIndex(c => c.id === cardId);
        if (index === -1) return false;

        const moving = source.slice(index);
        if (!isMovableRun(moving)) return false;
        if (from === 'waste' && index !== source.length - 1) return false;

        const target = readPile(s, to);
        const targetTop = topOf(target);

        const legal = to.startsWith('foundation')
            ? moving.length === 1 && canStackOnFoundation(moving[0], targetTop)
            : to.startsWith('tableau') && canStackOnTableau(moving[0], targetTop);
        if (!legal) return false;

        const snapshot = takeSnapshot(s);
        const board = cloneBoard(s);
        writePile(board, from, readPile(board, from).slice(0, index));
        writePile(board, to, [...readPile(board, to), ...moving.map(c => ({ ...c, isFaceUp: true }))]);

        let gained = moveScore(from, to);

        // Uncover whatever the moved run was sitting on.
        let flipped = false;
        if (from.startsWith('tableau')) {
            const rest = readPile(board, from);
            const last = topOf(rest);
            if (last && !last.isFaceUp) {
                rest[rest.length - 1] = { ...last, isFaceUp: true };
                gained += 5;
                flipped = true;
            }
        }

        if (to.startsWith('foundation')) {
            sfx.playFoundation(readPile(board, to).length);
        } else {
            sfx.playPlace();
        }
        if (flipped) window.setTimeout(() => sfx.playFlip(), 160);

        const won = isWon(board);
        set({
            ...board,
            history: pushHistory(s.history, snapshot),
            score: Math.max(0, s.score + gained),
            moves: s.moves + 1,
            hint: null,
            started: true,
            status: won ? 'won' : 'playing',
        });

        if (won) recordWin(get(), set);
        persist(get());
        return true;
    },

    /** Tap a card and it flies home if there is room for it. */
    sendHome: (from, cardId) => {
        const s = get();
        const source = readPile(s, from);
        const card = topOf(source);
        if (!card || card.id !== cardId || !card.isFaceUp) return false;

        for (let f = 0; f < 4; f++) {
            if (canStackOnFoundation(card, topOf(s.foundations[f]))) {
                return get().moveCards(from, cardId, `foundation-${f}`);
            }
        }
        return false;
    },

    flipTableauTop: pileId => {
        const s = get();
        if (s.status !== 'playing' || !pileId.startsWith('tableau')) return false;
        const pile = readPile(s, pileId);
        const card = topOf(pile);
        if (!card || card.isFaceUp) return false;

        const snapshot = takeSnapshot(s);
        const board = cloneBoard(s);
        const target = readPile(board, pileId);
        target[target.length - 1] = { ...card, isFaceUp: true };

        sfx.playFlip();
        set({
            ...board,
            history: pushHistory(s.history, snapshot),
            score: s.score + 5,
            moves: s.moves + 1,
            hint: null,
            started: true,
        });
        persist(get());
        return true;
    },

    /** Once nothing is face down, the rest of the game plays itself. */
    canAutoComplete: () => {
        const s = get();
        if (s.status !== 'playing') return false;
        if (s.foundations.every(p => p.length === 13)) return false;
        return s.tableau.every(pile => pile.every(c => c.isFaceUp));
    },

    autoCompleteStep: () => {
        const s = get();
        if (s.status !== 'playing') return 'done';

        for (let t = 0; t < 7; t++) {
            const card = topOf(s.tableau[t]);
            if (card && get().sendHome(`tableau-${t}`, card.id)) return 'placed';
        }
        const wasteTop = topOf(s.waste);
        if (wasteTop && get().sendHome('waste', wasteTop.id)) return 'placed';

        // Nothing to place right now, but there may be a card buried in the deck.
        if (s.stock.length > 0 || s.waste.length > 1) {
            get().draw();
            return 'drew';
        }
        return 'done';
    },

    showHint: () => {
        const s = get();
        if (s.status !== 'playing') return;
        const hint = findHint(s);
        set({ hint });
        if (hint) sfx.playHint();
        else sfx.playInvalid();
    },

    clearHint: () => {
        if (get().hint) set({ hint: null });
    },
}));

if (import.meta.env.DEV) {
    (window as unknown as { game?: unknown }).game = useGameStore;
}

const takeSnapshot = (s: GameState): Snapshot => ({
    ...cloneBoard(s),
    score: s.score,
    moves: s.moves,
    recycles: s.recycles,
});

const pushHistory = (history: Snapshot[], snapshot: Snapshot): Snapshot[] => {
    const next = [...history, snapshot];
    return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
};

const recordWin = (s: GameState, set: (partial: Partial<GameState>) => void): void => {
    const timeBonus = s.seconds > 30 ? Math.floor(700000 / s.seconds) : 0;
    const finalScore = s.score + timeBonus;
    const stats: Stats = {
        played: Math.max(s.stats.played, 1),
        won: s.stats.won + 1,
        bestTime: s.stats.bestTime === null ? s.seconds : Math.min(s.stats.bestTime, s.seconds),
        bestScore: Math.max(s.stats.bestScore, finalScore),
    };
    saveStats(stats);
    set({ score: finalScore, stats });
    sfx.playWin();
};

/**
 * Suggest a move, favouring the ones that actually open the game up:
 * cards going home, then moves that uncover a face-down card or free a column.
 */
const findHint = (s: GameState): Hint | null => {
    const wasteTop = topOf(s.waste);

    for (let t = 0; t < 7; t++) {
        const card = topOf(s.tableau[t]);
        if (!card || !card.isFaceUp) continue;
        for (let f = 0; f < 4; f++) {
            if (canStackOnFoundation(card, topOf(s.foundations[f]))) {
                return { cardIds: [card.id], toPileId: `foundation-${f}` };
            }
        }
    }
    if (wasteTop) {
        for (let f = 0; f < 4; f++) {
            if (canStackOnFoundation(wasteTop, topOf(s.foundations[f]))) {
                return { cardIds: [wasteTop.id], toPileId: `foundation-${f}` };
            }
        }
    }

    // Tableau to tableau, but only when it reveals something.
    for (let from = 0; from < 7; from++) {
        const pile = s.tableau[from];
        const firstUp = pile.findIndex(c => c.isFaceUp);
        if (firstUp === -1) continue;
        const run = pile.slice(firstUp);
        if (!isMovableRun(run)) continue;
        const uncovers = firstUp > 0;
        if (!uncovers) continue; // moving a whole column onto another achieves nothing

        for (let to = 0; to < 7; to++) {
            if (to === from) continue;
            if (canStackOnTableau(run[0], topOf(s.tableau[to]))) {
                return { cardIds: run.map(c => c.id), toPileId: `tableau-${to}` };
            }
        }
    }

    if (wasteTop) {
        for (let to = 0; to < 7; to++) {
            if (canStackOnTableau(wasteTop, topOf(s.tableau[to]))) {
                return { cardIds: [wasteTop.id], toPileId: `tableau-${to}` };
            }
        }
    }

    // Partial runs off a face-up stack (splitting a sequence) as a last resort.
    for (let from = 0; from < 7; from++) {
        const pile = s.tableau[from];
        for (let i = 0; i < pile.length; i++) {
            if (!pile[i].isFaceUp) continue;
            const run = pile.slice(i);
            if (!isMovableRun(run)) continue;
            for (let to = 0; to < 7; to++) {
                if (to === from) continue;
                if (canStackOnTableau(run[0], topOf(s.tableau[to]))) {
                    return { cardIds: run.map(c => c.id), toPileId: `tableau-${to}` };
                }
            }
        }
    }

    if (s.stock.length > 0 || s.waste.length > 1) {
        return { cardIds: [], toPileId: 'stock', deckOnly: true };
    }
    return null;
};

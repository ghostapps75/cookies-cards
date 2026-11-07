import { create } from 'zustand';
import { randomSeed } from '../../utils/gameLogic';
import * as sfx from '../../utils/sound';
import { cardName } from '../shared/cards';
import { computerMove } from './computer';
import {
    DECK_SIZE,
    DEFAULT_CANASTAS_TO_GO_OUT,
    allCards,
    applyMove,
    dealHand,
    matchWinner,
    rankWords,
    scoreHand,
    type HandEnding,
    type HandState,
    type Move,
    type Seat,
    type SeatScore,
    type Verdict,
} from './rules';

/** The match in progress and everything the table needs. Rules live in rules.ts. */

const MATCH_KEY = 'cookie-canasta-match';
const STATS_KEY = 'cookie-canasta-stats';

export interface HandResult {
    scores: Record<Seat, SeatScore>;
    ending: HandEnding;
    wentOut: Seat | null;
    concealed: boolean;
}

interface Match {
    hand: HandState;
    totals: Record<Seat, number>;
    /** Hands finished in this match. */
    handsPlayed: number;
    result: HandResult | null;
    winner: Seat | null;
    canastasNeeded: number;
    /** The table right after Cookie drew, so melds from this turn can be taken back. */
    undo: HandState | null;
    /** The computer's latest move in plain words. */
    lastAction: string | null;
}

export interface Stats {
    won: number;
    played: number;
}

interface CanastaStore extends Match {
    stats: Stats;
    selected: string[];
    notice: { text: string; id: number } | null;

    toggle: (cardId: string) => void;
    clearSelection: () => void;
    say: (text: string) => void;
    clearNotice: () => void;
    /** Cookie's move. Hands back whether it went through; a refusal becomes a Notice. */
    play: (move: Move) => Verdict<HandState>;
    computerStep: () => void;
    takeBack: () => void;
    nextHand: () => void;
    newHand: () => void;
    newMatch: () => void;
    setCanastasNeeded: (count: number) => void;
}

const firstPlayer = (handsPlayed: number): Seat => (handsPlayed % 2 === 0 ? 'cookie' : 'computer');

const deal = (handsPlayed: number, totals: Record<Seat, number>, canastasNeeded: number): HandState =>
    dealHand({ seed: randomSeed(), first: firstPlayer(handsPlayed), startTotals: totals, canastasNeeded });

const freshMatch = (canastasNeeded: number): Match => ({
    hand: deal(0, { cookie: 0, computer: 0 }, canastasNeeded),
    totals: { cookie: 0, computer: 0 },
    handsPlayed: 0,
    result: null,
    winner: null,
    canastasNeeded,
    undo: null,
    lastAction: null,
});

const isSoundMatch = (value: unknown): value is Match => {
    const match = value as Match | null;
    if (!match?.hand?.players || !match.totals) return false;
    const cards = allCards(match.hand);
    return cards.length === DECK_SIZE && new Set(cards.map(card => card.id)).size === DECK_SIZE;
};

const loadMatch = (): Match | null => {
    try {
        const saved = localStorage.getItem(MATCH_KEY);
        if (!saved) return null;
        const parsed: unknown = JSON.parse(saved);
        return isSoundMatch(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const loadStats = (): Stats => {
    try {
        const saved = localStorage.getItem(STATS_KEY);
        if (!saved) return { won: 0, played: 0 };
        const parsed = JSON.parse(saved) as Partial<Stats>;
        return { won: parsed.won ?? 0, played: parsed.played ?? 0 };
    } catch {
        return { won: 0, played: 0 };
    }
};

const saveMatch = (match: Match): void => {
    try {
        localStorage.setItem(MATCH_KEY, JSON.stringify(match));
    } catch {
        /* private browsing: the match just will not survive a reload */
    }
};

const saveStats = (stats: Stats): void => {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
        /* ignore */
    }
};

/** What the hand is worth, once it is over; the match totals and any winner follow from it. */
const settle = (hand: HandState, match: Pick<Match, 'totals' | 'handsPlayed'>) => {
    const scores = scoreHand(hand);
    const totals = {
        cookie: match.totals.cookie + scores.cookie.total,
        computer: match.totals.computer + scores.computer.total,
    };
    return {
        totals,
        handsPlayed: match.handsPlayed + 1,
        winner: matchWinner(totals),
        result: { scores, ending: hand.ending ?? 'stock', wentOut: hand.wentOut, concealed: hand.concealed },
    };
};

const moveSound = (before: HandState, after: HandState, seat: Seat, move: Move): void => {
    switch (move.type) {
        case 'draw':
            sfx.playDeal();
            sfx.playDeal(0.09);
            break;
        case 'take':
            sfx.playShuffle();
            break;
        case 'meld':
        case 'discard':
        case 'goOut':
            sfx.playPlace();
            break;
    }
    if (after.players[seat].redThrees.length > before.players[seat].redThrees.length) sfx.playFlip();
};

/** The computer's move, in words she can follow. */
const describeComputer = (before: HandState, after: HandState, move: Move): string => {
    const seat: Seat = 'computer';
    const reds = after.players[seat].redThrees.length - before.players[seat].redThrees.length;
    const redWords = reds > 0 ? `, and laid down ${reds === 1 ? 'a red three' : `${reds} red threes`}` : '';
    switch (move.type) {
        case 'draw':
            return `The computer drew from the stock${redWords}.`;
        case 'take':
            return `The computer took the pile of ${before.discard.length}${redWords}.`;
        case 'meld': {
            const had = new Set(before.players[seat].melds.map(meld => meld.rank));
            const parts = move.groups.map(group => (had.has(group.rank) ? `added to its ${rankWords(group.rank)}` : `melded ${rankWords(group.rank)}`));
            return `The computer ${parts.join(' and ')}.`;
        }
        case 'discard': {
            const card = before.players[seat].hand.find(c => c.id === move.cardId);
            return card ? `The computer discarded the ${cardName(card)}.` : 'The computer discarded.';
        }
        case 'goOut':
            return 'The computer went out!';
    }
};

export const useCanastaStore = create<CanastaStore>((set, get) => {
    const after = (next: HandState, seat: Seat, move: Move) => {
        const state = get();
        moveSound(state.hand, next, seat, move);
        if (next.phase !== 'over') return { hand: next };

        const settled = settle(next, state);
        if (settled.winner) {
            const stats = {
                won: state.stats.won + (settled.winner === 'cookie' ? 1 : 0),
                played: state.stats.played + 1,
            };
            saveStats(stats);
            if (settled.winner === 'cookie') sfx.playWin();
            else sfx.playHint();
            return { hand: next, ...settled, stats };
        }
        sfx.playHint();
        return { hand: next, ...settled };
    };

    return {
        ...(loadMatch() ?? freshMatch(DEFAULT_CANASTAS_TO_GO_OUT)),
        stats: loadStats(),
        selected: [],
        notice: null,

        toggle: cardId =>
            set(state => ({
                selected: state.selected.includes(cardId)
                    ? state.selected.filter(id => id !== cardId)
                    : [...state.selected, cardId],
            })),
        clearSelection: () => set({ selected: [] }),
        say: text => set(state => ({ notice: { text, id: (state.notice?.id ?? 0) + 1 } })),
        clearNotice: () => set({ notice: null }),

        play: move => {
            const state = get();
            const verdict = applyMove(state.hand, 'cookie', move);
            if (!verdict.ok) {
                sfx.playInvalid();
                get().say(verdict.reason);
                return verdict;
            }
            const next = verdict.value;
            const drewNow = move.type === 'draw' || move.type === 'take';
            const endedTurn = next.phase === 'over' || next.turn !== 'cookie';
            const moreReds = next.players.cookie.redThrees.length > state.hand.players.cookie.redThrees.length;
            set({
                ...after(next, 'cookie', move),
                selected: [],
                notice: null,
                undo: endedTurn ? null : drewNow ? next : state.undo,
            });
            if (moreReds) {
                get().say(
                    move.type === 'draw'
                        ? 'A red three! It goes on the table, worth 100, and you get another card.'
                        : 'There was a red three in the pile. It goes on the table, worth 100.',
                );
            }
            return verdict;
        },

        computerStep: () => {
            const state = get();
            const { hand } = state;
            if (hand.phase === 'over' || hand.turn !== 'computer') return;
            const move = computerMove(hand, 'computer');
            let verdict = applyMove(hand, 'computer', move);
            let played = move;
            if (!verdict.ok) {
                // It should never come to this, but a stuck table is worse than a dull move.
                played = hand.phase === 'draw' ? { type: 'draw' } : { type: 'discard', cardId: hand.players.computer.hand[0].id };
                verdict = applyMove(hand, 'computer', played);
                if (!verdict.ok) return;
            }
            set({
                ...after(verdict.value, 'computer', played),
                lastAction: describeComputer(hand, verdict.value, played),
            });
        },

        takeBack: () => {
            const { undo } = get();
            if (!undo) return;
            sfx.playUndo();
            set({ hand: undo, selected: [], notice: null });
        },

        nextHand: () => {
            const { handsPlayed, totals, canastasNeeded, winner } = get();
            if (winner) return get().newMatch();
            sfx.playShuffle();
            set({
                hand: deal(handsPlayed, totals, canastasNeeded),
                result: null,
                undo: null,
                selected: [],
                notice: null,
                lastAction: null,
            });
        },

        newHand: () => {
            const { handsPlayed, totals, canastasNeeded } = get();
            sfx.playShuffle();
            set({
                hand: deal(handsPlayed, totals, canastasNeeded),
                result: null,
                undo: null,
                selected: [],
                notice: null,
                lastAction: null,
            });
        },

        newMatch: () => {
            sfx.playShuffle();
            set({ ...freshMatch(get().canastasNeeded), selected: [], notice: null });
        },

        setCanastasNeeded: count =>
            set(state => ({
                canastasNeeded: count,
                hand: state.hand.phase === 'over' ? state.hand : { ...state.hand, canastasNeeded: count },
                // A meld taken back must not undo the rule along with it.
                undo: state.undo ? { ...state.undo, canastasNeeded: count } : null,
            })),
    };
});

/** The fields that make up the saved match. */
const toMatch = ({ hand, totals, handsPlayed, result, winner, canastasNeeded, undo, lastAction }: CanastaStore): Match => ({
    hand,
    totals,
    handsPlayed,
    result,
    winner,
    canastasNeeded,
    undo,
    lastAction,
});

useCanastaStore.subscribe((state, previous) => {
    if (
        state.hand !== previous.hand ||
        state.totals !== previous.totals ||
        state.result !== previous.result ||
        state.undo !== previous.undo ||
        state.canastasNeeded !== previous.canastasNeeded
    ) {
        saveMatch(toMatch(state));
    }
});

saveMatch(toMatch(useCanastaStore.getState()));

// A way in for checking the game by hand in the dev tools.
if (import.meta.env?.DEV) {
    (window as unknown as { canasta: typeof useCanastaStore }).canasta = useCanastaStore;
}

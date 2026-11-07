import { create } from 'zustand';
import { randomSeed } from '../../utils/gameLogic';
import * as sfx from '../../utils/sound';
import type { PlayingCard } from '../shared/cards';
import { applyMove, chooseMove, viewFor } from './computer';
import type { SortBy } from './layout';
import {
    dealHand,
    discardCard,
    drawFromStock,
    handProblems,
    layOffCards,
    meldCards,
    newMatch,
    recordHand,
    redealHand,
    starterFor,
    startNextHand,
    swapJoker,
    takeDiscard,
    type HandState,
    type MatchState,
    type Outcome,
} from './rules';

/** The match in play and what Cookie has picked. Timers live in the component. */

const MATCH_KEY = 'cookie-kalooki-match';
const STATS_KEY = 'cookie-kalooki-stats';
const SORT_KEY = 'cookie-kalooki-sort';

export interface KalookiStats {
    won: number;
    played: number;
}

const readJson = (key: string): unknown => {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
};

const write = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* private browsing: the game still works, it just will not resume */
    }
};

/** A save from an older version or a damaged one starts a new match rather than breaking the table. */
const loadMatch = (): MatchState | null => {
    const saved = readJson(MATCH_KEY) as MatchState | null;
    try {
        if (!saved || !saved.hand || !Array.isArray(saved.history) || !Array.isArray(saved.undo)) return null;
        if (typeof saved.totals?.cookie !== 'number' || typeof saved.totals?.computer !== 'number') return null;
        return handProblems(saved.hand).length === 0 ? saved : null;
    } catch {
        return null;
    }
};

const loadStats = (): KalookiStats => {
    const saved = readJson(STATS_KEY) as Partial<KalookiStats> | null;
    return { won: Number(saved?.won) || 0, played: Number(saved?.played) || 0 };
};

const loadSort = (): SortBy => {
    try {
        return localStorage.getItem(SORT_KEY) === 'rank' ? 'rank' : 'suit';
    } catch {
        return 'suit';
    }
};

const WAIT = 'Hold on, it is the computer’s turn.';

let noticeSerial = 0;

interface KalookiStore {
    match: MatchState;
    stats: KalookiStats;
    selected: string[];
    /** Swap joker was pressed and more than one meld could take the card. */
    choosingSwap: boolean;
    sortBy: SortBy;
    notice: { id: number; text: string } | null;

    toggleCard: (card: PlayingCard) => void;
    toggleSort: () => void;
    clearNotice: () => void;
    draw: () => void;
    takeTopDiscard: () => void;
    tapDiscardPile: () => void;
    meldSelected: () => void;
    tapMeld: (meldId: string) => void;
    pressSwap: () => void;
    discardSelected: () => void;
    takeBack: () => void;
    computerStep: () => void;
    nextHand: () => void;
    throwInHand: () => void;
    startNewMatch: () => void;
    setOpening: (opening: number) => void;
    setHandSize: (handSize: number) => void;
}

export const useKalooki = create<KalookiStore>((set, get) => {
    const say = (text: string) => {
        sfx.playInvalid();
        set({ notice: { id: ++noticeSerial, text } });
    };

    /** Puts a new hand state in place, and settles up if the hand has just ended. */
    const put = (hand: HandState, undo: HandState[]) => {
        const { match, stats } = get();
        const next = recordHand({ ...match, hand, undo });
        const justWon = next.winner !== null && match.winner === null;
        if (justWon) {
            const newStats = { won: stats.won + (next.winner === 'cookie' ? 1 : 0), played: stats.played + 1 };
            write(STATS_KEY, JSON.stringify(newStats));
            set({ stats: newStats });
            if (next.winner === 'cookie') sfx.playWin();
        }
        set({ match: next });
    };

    /** The hand, if it is Cookie's move and she has picked up. Otherwise says why not. */
    const myPlay = (): HandState | null => {
        const { hand } = get().match;
        if (hand.phase === 'over') return null;
        if (hand.turn !== 'cookie') {
            say(WAIT);
            return null;
        }
        if (hand.phase !== 'play') {
            say('Pick up a card first: draw one, or take the top discard.');
            return null;
        }
        return hand;
    };

    /** Applies something Cookie laid down: remembers the table first, so it can be taken back. */
    const layDown = (before: HandState, outcome: Outcome) => {
        if (!outcome.ok) {
            say(outcome.why);
            return;
        }
        sfx.playPlace();
        const { match } = get();
        // A swapped joker comes back picked, ready to be tapped onto a meld.
        set({ selected: outcome.state.mustUse, choosingSwap: false });
        put(outcome.state, [...match.undo, before]);
    };

    const deal = (match: MatchState) => {
        sfx.playShuffle();
        set({ match, selected: [], choosingSwap: false, notice: null });
    };

    /** New settings apply to a hand nobody has touched yet, or else from the next deal. */
    const changeSettings = (change: { opening?: number; handSize?: number }) => {
        const { match, selected } = get();
        const next = { ...match, ...change };
        const { hand } = match;
        const untouched = hand.turns === 0 && hand.phase === 'draw';
        set({
            match: untouched
                ? {
                      ...next,
                      hand: dealHand({
                          seed: hand.seed,
                          handNo: hand.handNo,
                          opening: next.opening,
                          handSize: next.handSize,
                          starter: starterFor(hand.handNo),
                      }),
                      undo: [],
                  }
                : next,
            selected: untouched ? [] : selected,
        });
    };

    return {
        match: loadMatch() ?? newMatch(randomSeed()),
        stats: loadStats(),
        selected: [],
        choosingSwap: false,
        sortBy: loadSort(),
        notice: null,

        toggleCard: card => {
            sfx.playClick();
            const { selected } = get();
            set({
                choosingSwap: false,
                selected: selected.includes(card.id)
                    ? selected.filter(id => id !== card.id)
                    : [...selected, card.id],
            });
        },

        toggleSort: () => {
            sfx.playClick();
            const sortBy: SortBy = get().sortBy === 'suit' ? 'rank' : 'suit';
            write(SORT_KEY, sortBy);
            set({ sortBy });
        },

        clearNotice: () => set({ notice: null }),

        draw: () => {
            const { hand } = get().match;
            if (hand.phase === 'over') return;
            if (hand.turn !== 'cookie') return say(WAIT);
            const wasEmpty = hand.stock.length === 0;
            const outcome = drawFromStock(hand);
            if (!outcome.ok) return say(outcome.why);
            if (wasEmpty) sfx.playRecycle();
            else sfx.playPickup();
            put(outcome.state, []);
        },

        takeTopDiscard: () => {
            const { hand } = get().match;
            if (hand.phase === 'over') return;
            if (hand.turn !== 'cookie') return say(WAIT);
            const outcome = takeDiscard(hand);
            if (!outcome.ok) return say(outcome.why);
            sfx.playPickup();
            // The new card is picked already, so the next tap is choosing what goes with it.
            set({ selected: outcome.state.mustUse, choosingSwap: false });
            put(outcome.state, []);
        },

        tapDiscardPile: () => {
            const { match } = get();
            if (match.hand.turn === 'cookie' && match.hand.phase === 'draw') get().takeTopDiscard();
            else get().discardSelected();
        },

        meldSelected: () => {
            const hand = myPlay();
            if (!hand) return;
            const { selected } = get();
            if (selected.length === 0) return say('Pick the cards you want to meld, then press Meld.');
            layDown(hand, meldCards(hand, selected));
        },

        tapMeld: meldId => {
            const { match, selected, choosingSwap } = get();
            if (match.hand.phase === 'over') return;
            if (selected.length === 0) {
                return say('Pick a card from your hand first, then tap this meld to add it.');
            }
            const hand = myPlay();
            if (!hand) return;
            if (choosingSwap) return layDown(hand, swapJoker(hand, meldId, selected[0]));

            const layOff = layOffCards(hand, meldId, selected);
            if (layOff.ok) return layDown(hand, layOff);
            if (selected.length === 1) {
                const swap = swapJoker(hand, meldId, selected[0]);
                if (swap.ok) return layDown(hand, swap);
            }
            say(layOff.why);
        },

        pressSwap: () => {
            const hand = myPlay();
            if (!hand) return;
            const { selected } = get();
            if (selected.length !== 1) {
                return say('Pick the card the joker stands for, then press Swap joker.');
            }
            const options = hand.melds.filter(meld => swapJoker(hand, meld.id, selected[0]).ok);
            if (options.length === 0) {
                const holder = hand.melds.find(meld => meld.cards.some(card => card.rank === 'joker'));
                const why = holder ? swapJoker(hand, holder.id, selected[0]) : null;
                return say(why && !why.ok ? why.why : 'There is no joker on the table to swap.');
            }
            if (options.length === 1) return layDown(hand, swapJoker(hand, options[0].id, selected[0]));
            sfx.playClick();
            set({ choosingSwap: true });
        },

        discardSelected: () => {
            const hand = myPlay();
            if (!hand) return;
            const { selected } = get();
            if (selected.length === 0) return say('Pick the card you want to throw away, then press Discard.');
            if (selected.length > 1) return say('Pick just one card to discard.');
            const outcome = discardCard(hand, selected[0]);
            if (!outcome.ok) return say(outcome.why);
            sfx.playPlace();
            set({ selected: [], choosingSwap: false });
            put(outcome.state, []);
        },

        takeBack: () => {
            const { match } = get();
            const previous = match.undo[match.undo.length - 1];
            if (!previous || match.hand.turn !== 'cookie') return;
            sfx.playUndo();
            set({
                match: { ...match, hand: previous, undo: match.undo.slice(0, -1) },
                selected: [],
                choosingSwap: false,
            });
        },

        computerStep: () => {
            const { hand } = get().match;
            if (hand.turn !== 'computer' || hand.phase === 'over') return;
            const move = chooseMove(viewFor(hand, 'computer'));
            const outcome = applyMove(hand, move);
            if (!outcome.ok) {
                // Self-play never reaches this. If it ever did, the toolbar's New hand still works.
                console.error('Kalooki: the computer tried an illegal move', move, outcome.why);
                return;
            }
            if (move.type === 'stock' || move.type === 'discardPile') sfx.playPickup();
            else sfx.playPlace();
            put(outcome.state, []);
        },

        nextHand: () => {
            const { match } = get();
            if (match.winner) get().startNewMatch();
            else deal(startNextHand(match, randomSeed()));
        },

        throwInHand: () => {
            const { match } = get();
            if (match.winner) get().startNewMatch();
            else if (match.hand.phase === 'over') deal(startNextHand(match, randomSeed()));
            else deal(redealHand(match, randomSeed()));
        },

        startNewMatch: () => {
            const { match } = get();
            deal(newMatch(randomSeed(), match.opening, match.handSize));
        },

        setOpening: opening => changeSettings({ opening }),
        setHandSize: handSize => changeSettings({ handSize }),
    };
});

useKalooki.subscribe((state, previous) => {
    if (state.match !== previous.match) write(MATCH_KEY, JSON.stringify(state.match));
});

if (import.meta.env.DEV) {
    (window as unknown as { kalooki: typeof useKalooki }).kalooki = useKalooki;
}

import type { Board, Card, Rank, Suit } from '../types';

export const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export const RANKS: Rank[] = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];

const RANK_VALUES: Record<Rank, number> = {
    ace: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, jack: 11, queen: 12, king: 13,
};

export const rankValue = (rank: Rank): number => RANK_VALUES[rank];

export const isRed = (suit: Suit): boolean => suit === 'hearts' || suit === 'diamonds';

export const createDeck = (): Card[] => {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ id: `${rank}_${suit}`, suit, rank, isFaceUp: false });
        }
    }
    return deck;
};

/**
 * A small, fast, seedable random number generator (mulberry32). Every hand is
 * dealt from a 32-bit seed, so a deal can be reproduced from its number alone:
 * the solver can vouch for a seed in a worker and hand back just the number.
 */
export const mulberry32 = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export const randomSeed = (): number => Math.floor(Math.random() * 4294967296) >>> 0;

export const shuffleDeck = (deck: Card[], random: () => number = Math.random): Card[] => {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

/** The same seed always lays out the same hand. */
export const dealFromSeed = (seed: number): Board => {
    const deck = shuffleDeck(createDeck(), mulberry32(seed));
    const board: Board = {
        stock: [],
        waste: [],
        foundations: [[], [], [], []],
        tableau: [[], [], [], [], [], [], []],
    };
    for (let col = 0; col < 7; col++) {
        const cards = deck.splice(0, col + 1);
        cards[cards.length - 1].isFaceUp = true;
        board.tableau[col] = cards;
    }
    board.stock = deck;
    return board;
};

/** Can `card` (head of a moving stack) land on this tableau pile? */
export const canStackOnTableau = (card: Card, target: Card | undefined): boolean => {
    if (!target) return card.rank === 'king';
    if (!target.isFaceUp) return false;
    return isRed(card.suit) !== isRed(target.suit) && rankValue(target.rank) === rankValue(card.rank) + 1;
};

/** Can this single card land on this foundation pile? */
export const canStackOnFoundation = (card: Card, target: Card | undefined): boolean => {
    if (!target) return card.rank === 'ace';
    return card.suit === target.suit && rankValue(card.rank) === rankValue(target.rank) + 1;
};

/** A run of face-up, descending, alternating-colour cards can be dragged together. */
export const isMovableRun = (cards: Card[]): boolean => {
    for (let i = 0; i < cards.length; i++) {
        if (!cards[i].isFaceUp) return false;
        if (i > 0) {
            const above = cards[i - 1];
            const below = cards[i];
            if (isRed(above.suit) === isRed(below.suit)) return false;
            if (rankValue(above.rank) !== rankValue(below.rank) + 1) return false;
        }
    }
    return cards.length > 0;
};

export const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

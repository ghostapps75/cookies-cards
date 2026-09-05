import type { Card, Rank, Suit } from '../types';

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

export const shuffleDeck = (deck: Card[]): Card[] => {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
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

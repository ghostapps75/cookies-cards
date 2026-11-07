import type { Rank, Suit } from '../../types';
import { RANKS, SUITS } from '../../utils/gameLogic';

/**
 * A card from a double deck with jokers, as the rummy games use. Every card
 * carries its own identity, so the two queens of hearts are two cards and can
 * be told apart on the table and in animations.
 */
export interface PlayingCard {
    id: string;
    rank: Rank | 'joker';
    /** Null for a joker. */
    suit: Suit | null;
    /** Which of the two decks it came from; jokers are numbered 0 to 3 instead. */
    copy: number;
    isFaceUp: boolean;
}

export const isJoker = (card: PlayingCard): boolean => card.rank === 'joker';

/** Red jokers are the even-numbered ones, so a pack has two of each colour. */
export const isRedCard = (card: PlayingCard): boolean =>
    card.rank === 'joker' ? card.copy % 2 === 0 : card.suit === 'hearts' || card.suit === 'diamonds';

export const cardName = (card: PlayingCard): string =>
    card.rank === 'joker' ? 'joker' : `${card.rank} of ${card.suit}`;

/** Two full decks plus this many jokers, in factory order. Shuffle it yourself. */
export const buildDoubleDeck = (jokers = 4): PlayingCard[] => {
    const cards: PlayingCard[] = [];
    for (let copy = 0; copy < 2; copy++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                cards.push({ id: `${rank}_${suit}_${copy}`, rank, suit, copy, isFaceUp: false });
            }
        }
    }
    for (let copy = 0; copy < jokers; copy++) {
        cards.push({ id: `joker_${copy}`, rank: 'joker', suit: null, copy, isFaceUp: false });
    }
    return cards;
};

/** Fisher-Yates, with a pluggable source of randomness so that hands can be seeded. */
export const shuffled = <T>(items: T[], random: () => number = Math.random): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

/** The same card, turned over. Cards are treated as immutable everywhere. */
export const turned = (card: PlayingCard, isFaceUp: boolean): PlayingCard =>
    card.isFaceUp === isFaceUp ? card : { ...card, isFaceUp };

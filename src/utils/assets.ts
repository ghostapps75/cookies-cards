import type { Suit, Rank } from '../types';

const ASSET_PATH = '/assets/images';
const CARD_FACES_PATH = `${ASSET_PATH}/Card Faces`;
const CARD_BACK_URL = `${ASSET_PATH}/card_back_cookie.jpg`;

/**
 * The pack ships two artworks for the court cards: "queen_of_hearts.png" is a
 * placeholder with a single giant pip, "queen_of_hearts2.png" is the real
 * illustrated court card. Always prefer the illustrated one.
 */
const ILLUSTRATED_RANKS = new Set<Rank>(['jack', 'queen', 'king']);

export const getCardImageUrl = (rank: Rank, suit: Suit): string => {
    if (ILLUSTRATED_RANKS.has(rank)) {
        return `${CARD_FACES_PATH}/${rank}_of_${suit}2.png`;
    }
    if (rank === 'ace' && suit === 'spades') {
        return `${CARD_FACES_PATH}/ace_of_spades2.png`;
    }
    return `${CARD_FACES_PATH}/${rank}_of_${suit}.png`;
};

export const getCardBackUrl = (): string => CARD_BACK_URL;

/** Warm the browser cache so the deal animation never shows a blank card. */
export const preloadCardImages = (cards: { rank: Rank; suit: Suit }[]): void => {
    const urls = new Set<string>([CARD_BACK_URL, ...cards.map(c => getCardImageUrl(c.rank, c.suit))]);
    urls.forEach(url => {
        const img = new Image();
        img.src = url;
    });
};

import type { Suit, Rank } from '../types';

const ASSET_PATH = '/assets/images';
const CARD_FACES_PATH = `${ASSET_PATH}/Card Faces`;
const CARD_BACK_URL = `${ASSET_PATH}/card_back_cookie.jpg`;

export const getCardImageUrl = (rank: Rank, suit: Suit): string => {
    // Filenames are strictly "rank_of_suit.png" or "10_of_suit.png" etc.
    // Special cases for face cards: jack_of_hearts2.png might exist, but we use the base one first.
    let rankStr: string = rank;

    // No special mapping needed if rank is already the string we want (ace, 2-10, jack, queen, king)
    return `${CARD_FACES_PATH}/${rankStr}_of_${suit}.png`;
};

export const getCardBackUrl = (): string => {
    return CARD_BACK_URL;
};

import type { Suit } from '../../types';
import { RANKS } from '../../utils/gameLogic';
import { isJoker, type PlayingCard } from '../shared/cards';

/**
 * The small sums behind the table that CSS cannot do alone. Pure, so the sizes
 * can be checked without a browser.
 */

export type SortBy = 'suit' | 'rank';

/** Black and red take turns, so that neighbouring suits are easy to tell apart. */
const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

const suitIndex = (card: PlayingCard): number => (card.suit ? SUIT_ORDER.indexOf(card.suit) : -1);
const rankIndex = (card: PlayingCard): number => (isJoker(card) ? -1 : RANKS.indexOf(card.rank as (typeof RANKS)[number]));

/** Jokers at the left, then by suit and rank, or by rank and suit. */
export const sortHand = (cards: PlayingCard[], by: SortBy): PlayingCard[] =>
    [...cards].sort((a, b) => {
        if (isJoker(a) !== isJoker(b)) return isJoker(a) ? -1 : 1;
        const bySuit = suitIndex(a) - suitIndex(b);
        const byRank = rankIndex(a) - rankIndex(b);
        const order = by === 'suit' ? bySuit || byRank : byRank || bySuit;
        return order || a.id.localeCompare(b.id);
    });

/** How much of each card in a meld shows from under the next one, as a share of its width. */
export const MELD_STEP = 0.36;
const CARD_RATIO = 16 / 11;
const MELD_PADDING = 3;
const MELD_GAP = 8;
const LABEL_HEIGHT = 20;
const COLUMN_GAP = 12;

export const MIN_MELD_CARD = 26;
export const MAX_MELD_CARD = 76;

const meldWidth = (cards: number, cardWidth: number): number =>
    cardWidth + (cards - 1) * MELD_STEP * cardWidth + MELD_PADDING * 2;

const rowsNeeded = (melds: number[], cardWidth: number, columnWidth: number): number | null => {
    let rows = 1;
    let x = 0;
    for (const cards of melds) {
        const width = meldWidth(cards, cardWidth);
        if (width > columnWidth) return null;
        if (x > 0 && x + width > columnWidth) {
            rows++;
            x = 0;
        }
        x += width + MELD_GAP;
    }
    return rows;
};

/**
 * The biggest card that lets every meld fit in the two columns (Cookie's and
 * the computer's) with no scrolling. Each group is the card count of each meld.
 */
export const fitMeldCard = (width: number, height: number, groups: number[][]): number => {
    if (width <= 0 || height <= 0) return MIN_MELD_CARD;
    const columnWidth = (width - COLUMN_GAP) / groups.length;
    for (let cardWidth = MAX_MELD_CARD; cardWidth > MIN_MELD_CARD; cardWidth -= 2) {
        const fits = groups.every(melds => {
            const rows = rowsNeeded(melds, cardWidth, columnWidth);
            if (rows === null) return false;
            const rowHeight = cardWidth * CARD_RATIO + MELD_PADDING * 2;
            return LABEL_HEIGHT + rows * rowHeight + (rows - 1) * MELD_GAP <= height;
        });
        if (fits) return cardWidth;
    }
    return MIN_MELD_CARD;
};

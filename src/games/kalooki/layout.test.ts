import { describe, expect, it } from 'vitest';
import type { Rank, Suit } from '../../types';
import type { PlayingCard } from '../shared/cards';
import { MAX_MELD_CARD, MIN_MELD_CARD, fitMeldCard, sortHand } from './layout';

const c = (rank: Rank, suit: Suit): PlayingCard => ({ id: `${rank}_${suit}_0`, rank, suit, copy: 0, isFaceUp: true });
const joker: PlayingCard = { id: 'joker_0', rank: 'joker', suit: null, copy: 0, isFaceUp: true };

describe('sorting a hand', () => {
    const hand = [c('7', 'hearts'), c('ace', 'spades'), joker, c('king', 'spades'), c('7', 'spades')];

    it('puts jokers left, then goes by suit and rank', () => {
        expect(sortHand(hand, 'suit').map(card => card.id)).toEqual([
            'joker_0',
            'ace_spades_0',
            '7_spades_0',
            'king_spades_0',
            '7_hearts_0',
        ]);
    });

    it('can go by rank instead, which is what you want for sets', () => {
        expect(sortHand(hand, 'rank').map(card => card.id)).toEqual([
            'joker_0',
            'ace_spades_0',
            '7_spades_0',
            '7_hearts_0',
            'king_spades_0',
        ]);
    });
});

describe('fitting the melds on the table', () => {
    it('uses the biggest card when there is plenty of room', () => {
        expect(fitMeldCard(1000, 400, [[3], [3]])).toBe(MAX_MELD_CARD);
    });

    it('shrinks as the melds pile up, and fits a crowded phone table', () => {
        const few = fitMeldCard(700, 170, [[3, 3], [3]]);
        const many = fitMeldCard(700, 170, [
            [3, 4, 3, 5, 3, 4],
            [3, 3, 4, 3, 6],
        ]);
        expect(many).toBeLessThan(few);
        expect(many).toBeGreaterThanOrEqual(MIN_MELD_CARD);
    });

    it('never goes below the smallest card, even with nowhere to put it', () => {
        expect(fitMeldCard(100, 40, [[14, 14], [14]])).toBe(MIN_MELD_CARD);
        expect(fitMeldCard(0, 0, [[3], [3]])).toBe(MIN_MELD_CARD);
    });
});

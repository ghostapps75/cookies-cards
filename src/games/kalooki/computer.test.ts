import { describe, expect, it } from 'vitest';
import type { Rank, Suit } from '../../types';
import type { PlayingCard } from '../shared/cards';
import { applyMove, chooseMove, viewFor, type ComputerView } from './computer';
import {
    arrangeMeld,
    dealHand,
    everyCard,
    handProblems,
    MATCH_LIMIT,
    newMatch,
    recordHand,
    startNextHand,
    type HandState,
    type Meld,
} from './rules';

let serial = 0;
const c = (rank: Rank, suit: Suit, copy = 0): PlayingCard => ({
    id: `${rank}_${suit}_${copy}_t${serial++}`,
    rank,
    suit,
    copy,
    isFaceUp: false,
});
const joker = (): PlayingCard => ({ id: `joker_t${serial++}`, rank: 'joker', suit: null, copy: 0, isFaceUp: false });

const asMeld = (cards: PlayingCard[], id = 'table'): Meld => {
    const shape = arrangeMeld(cards);
    if (!shape) throw new Error('not a meld');
    return { ...shape, id, owner: 'cookie' };
};

const view = (over: Partial<ComputerView>): ComputerView => ({
    phase: 'play',
    hand: [],
    melds: [],
    discardTop: null,
    opened: true,
    opening: 51,
    turnMeldValue: 0,
    mustUse: [],
    opponentOpened: false,
    opponentInterest: [],
    ...over,
});

/** Plays one hand with the computer on both sides, checking the table after every single move. */
const playOut = (start: HandState, label: string): { state: HandState; moves: number } => {
    let state = start;
    let moves = 0;
    const limit = 20000;
    expect(handProblems(state), `${label} at the deal`).toEqual([]);
    while (state.phase !== 'over') {
        if (moves++ > limit) throw new Error(`${label}: never finished`);
        const move = chooseMove(viewFor(state, state.turn));
        const outcome = applyMove(state, move);
        if (!outcome.ok) {
            throw new Error(`${label}: illegal ${JSON.stringify(move)} on move ${moves}: ${outcome.why}`);
        }
        state = outcome.state;
        const problems = handProblems(state);
        if (problems.length > 0) {
            throw new Error(`${label}: after ${JSON.stringify(move)}: ${problems.join('; ')}`);
        }
        if (everyCard(state).length !== 108) throw new Error(`${label}: lost a card`);
    }
    return { state, moves };
};

describe('self-play', () => {
    it('plays fifty hands to the end with every card accounted for after every move', () => {
        let wentOut = 0;
        for (let seed = 1; seed <= 50; seed++) {
            const { state } = playOut(dealHand({ seed, starter: seed % 2 ? 'cookie' : 'computer' }), `seed ${seed}`);
            expect(state.result).not.toBeNull();
            if (state.result?.wentOut) {
                wentOut++;
                expect(state.hands[state.result.wentOut]).toHaveLength(0);
                expect(state.result.charges[state.result.wentOut]).toBe(0);
            }
        }
        expect(wentOut).toBe(50);
    }, 120000);

    it('copes with the other settings: fifteen cards, and opening at forty', () => {
        for (let seed = 101; seed <= 115; seed++) {
            playOut(dealHand({ seed, handSize: 15 }), `15 cards, seed ${seed}`);
            playOut(dealHand({ seed, opening: 40 }), `open at 40, seed ${seed}`);
        }
    }, 120000);

    it('plays a whole match through to the limit', () => {
        let match = newMatch(2024);
        let seed = 2025;
        while (!match.winner) {
            const { state } = playOut(match.hand, `hand ${match.hand.handNo}`);
            match = recordHand({ ...match, hand: state });
            if (!match.winner) match = startNextHand(match, seed++);
            if (seed > 2200) throw new Error('match never ended');
        }
        expect(Math.max(match.totals.cookie, match.totals.computer)).toBeGreaterThanOrEqual(MATCH_LIMIT);
        const lower = match.totals.cookie < match.totals.computer ? 'cookie' : 'computer';
        expect(match.winner).toBe(lower);
    }, 120000);
});

describe('what the computer can see', () => {
    it('is never told the other player cards', () => {
        const state = dealHand({ seed: 11 });
        const seen = JSON.stringify(viewFor(state, 'computer'));
        for (const card of state.hands.cookie) expect(seen).not.toContain(card.id);
        for (const card of state.stock) expect(seen).not.toContain(card.id);
    });

    it('decides the same whatever Cookie is holding', () => {
        const state = dealHand({ seed: 12, starter: 'computer' });
        const swappedHands: HandState = {
            ...state,
            hands: { ...state.hands, cookie: state.stock.slice(0, state.hands.cookie.length) },
            stock: [...state.hands.cookie, ...state.stock.slice(state.hands.cookie.length)],
        };
        expect(chooseMove(viewFor(swappedHands, 'computer'))).toEqual(chooseMove(viewFor(state, 'computer')));
    });
});

describe('how the computer plays', () => {
    it('takes the discard when it opens with it', () => {
        const hand = [
            c('king', 'clubs'),
            c('king', 'spades'),
            c('10', 'hearts'),
            c('jack', 'hearts'),
            c('queen', 'hearts'),
            c('2', 'diamonds'),
        ];
        const move = chooseMove(view({ phase: 'draw', opened: false, hand, discardTop: c('king', 'hearts') }));
        expect(move).toEqual({ type: 'discardPile' });
    });

    it('takes the discard when it can lay it off', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const move = chooseMove(view({ phase: 'draw', hand: [c('2', 'clubs')], melds: [meld], discardTop: c('8', 'hearts') }));
        expect(move).toEqual({ type: 'discardPile' });
    });

    it('draws from the stock when the discard is of no use', () => {
        const move = chooseMove(view({ phase: 'draw', opened: false, hand: [c('2', 'clubs')], discardTop: c('8', 'hearts') }));
        expect(move).toEqual({ type: 'stock' });
    });

    it('opens as soon as it reaches the threshold, and not before', () => {
        const set = [c('king', 'clubs'), c('king', 'spades'), c('king', 'hearts')];
        const run = [c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts')];
        const spare = [c('2', 'clubs'), c('4', 'diamonds')];

        const ready = chooseMove(view({ opened: false, hand: [...set, ...run, ...spare] }));
        expect(ready.type).toBe('meld');

        const notYet = chooseMove(view({ opened: false, hand: [...set, ...spare, c('8', 'spades')] }));
        expect(notYet.type).toBe('discard');
    });

    it('lays off whatever it can once open', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const eight = c('8', 'hearts');
        const move = chooseMove(view({ hand: [eight, c('2', 'clubs')], melds: [meld] }));
        expect(move).toEqual({ type: 'layoff', meldId: 'table', cardIds: [eight.id] });
    });

    it('swaps a joker off the table when that gets it closer to going out', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), joker()]);
        const seven = c('7', 'hearts');
        const move = chooseMove(view({ hand: [seven, c('2', 'clubs')], melds: [meld] }));
        expect(move).toEqual({ type: 'swap', meldId: 'table', cardId: seven.id });
    });

    it('then puts the swapped joker straight down', () => {
        const wild = joker();
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const move = chooseMove(view({ hand: [wild, c('2', 'clubs')], melds: [meld], mustUse: [wild.id] }));
        expect(move).toEqual({ type: 'layoff', meldId: 'table', cardIds: [wild.id] });
    });

    it('keeps what it is building and throws the lone high card', () => {
        const hand = [
            c('7', 'hearts'),
            c('7', 'clubs'),
            c('5', 'spades'),
            c('6', 'spades'),
            c('king', 'diamonds'),
            c('2', 'clubs'),
        ];
        const move = chooseMove(view({ opened: false, hand }));
        expect(move).toEqual({ type: 'discard', cardId: hand[4].id });
    });

    it('will not throw a joker while it holds anything else', () => {
        const hand = [joker(), c('king', 'diamonds'), c('ace', 'clubs')];
        const move = chooseMove(view({ opened: false, hand }));
        expect(move.type).toBe('discard');
        if (move.type === 'discard') expect(move.cardId).not.toBe(hand[0].id);
    });

    it('shies away from a card Cookie has shown she wants', () => {
        const queen = c('queen', 'diamonds');
        const king = c('king', 'spades');
        const hand = [queen, king, c('2', 'clubs'), c('2', 'hearts')];
        const plain = chooseMove(view({ opened: false, hand }));
        expect(plain).toEqual({ type: 'discard', cardId: expect.any(String) });

        // She has picked up queens: of two equally dear loose cards, it keeps the queen back.
        const wary = chooseMove(
            view({ opened: false, hand, opponentInterest: [{ rank: 'queen', suit: 'clubs' }, { rank: 'queen', suit: 'hearts' }] }),
        );
        expect(wary).toEqual({ type: 'discard', cardId: king.id });

        // And of the king, if it is kings she has been picking up.
        const warier = chooseMove(
            view({ opened: false, hand, opponentInterest: [{ rank: 'king', suit: 'clubs' }, { rank: 'king', suit: 'hearts' }] }),
        );
        expect(warier).toEqual({ type: 'discard', cardId: queen.id });
    });

    it('shies away from feeding a meld once she can lay off', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const fits = c('8', 'hearts');
        const loose = c('9', 'clubs');
        const hand = [fits, loose, c('2', 'clubs'), c('2', 'hearts')];
        const move = chooseMove(view({ opened: false, hand, melds: [meld], opponentOpened: true }));
        expect(move).toEqual({ type: 'discard', cardId: loose.id });
    });

    it('goes out by discarding its last card', () => {
        const last = c('2', 'clubs');
        expect(chooseMove(view({ hand: [last] }))).toEqual({ type: 'discard', cardId: last.id });
    });
});

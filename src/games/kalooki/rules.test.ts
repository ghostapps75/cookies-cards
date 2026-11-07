import { describe, expect, it } from 'vitest';
import type { Rank, Suit } from '../../types';
import type { PlayingCard } from '../shared/cards';
import {
    arrangeMeld,
    bestMelds,
    bestMeldsWith,
    dealHand,
    discardCard,
    drawFromStock,
    everyCard,
    handCharge,
    handProblems,
    layOffCards,
    layOffOptions,
    matchWinner,
    meldCards,
    meldIsSound,
    meldValue,
    newMatch,
    recordHand,
    settleHand,
    startNextHand,
    statusLine,
    swapJoker,
    swapOut,
    takeCheckFor,
    takeDiscard,
    turnOverDiscards,
    whyNotTake,
    type HandState,
    type Meld,
} from './rules';

let serial = 0;
const c = (rank: Rank, suit: Suit, copy = 0): PlayingCard => ({
    id: `${rank}_${suit}_${copy}_${serial++}`,
    rank,
    suit,
    copy,
    isFaceUp: true,
});
const joker = (): PlayingCard => ({ id: `joker_${serial++}`, rank: 'joker', suit: null, copy: 0, isFaceUp: true });

const asMeld = (cards: PlayingCard[], id = 'table', owner: Meld['owner'] = 'computer'): Meld => {
    const shape = arrangeMeld(cards);
    if (!shape) throw new Error('not a meld');
    return { ...shape, id, owner };
};

/** A hand in Cookie's play phase with exactly these cards in play. */
const table = (over: Partial<HandState>): HandState => ({
    ...dealHand({ seed: 1 }),
    hands: { cookie: [], computer: [c('9', 'clubs')] },
    stock: [c('2', 'clubs')],
    discard: [c('3', 'clubs')],
    melds: [],
    turn: 'cookie',
    phase: 'play',
    ...over,
});

const expectOk = (outcome: ReturnType<typeof meldCards>): HandState => {
    if (!outcome.ok) throw new Error(outcome.why);
    return outcome.state;
};

const ids = (cards: PlayingCard[]) => cards.map(card => card.id);

describe('sets', () => {
    it('takes three or four of a rank in different suits', () => {
        expect(arrangeMeld([c('7', 'hearts'), c('7', 'spades'), c('7', 'clubs')])?.kind).toBe('set');
        expect(arrangeMeld([c('7', 'hearts'), c('7', 'spades'), c('7', 'clubs'), c('7', 'diamonds')])?.kind).toBe('set');
    });

    it('refuses two of the same suit, even though a double deck has them', () => {
        expect(arrangeMeld([c('7', 'hearts', 0), c('7', 'hearts', 1), c('7', 'clubs')])).toBeNull();
    });

    it('refuses too few or too many', () => {
        expect(arrangeMeld([c('7', 'hearts'), c('7', 'clubs')])).toBeNull();
        expect(
            arrangeMeld([c('7', 'hearts'), c('7', 'clubs'), c('7', 'spades'), c('7', 'diamonds'), joker()]),
        ).toBeNull();
    });

    it('lets a joker fill in, and a joker makes it no more than four', () => {
        const shape = arrangeMeld([c('7', 'hearts'), c('7', 'clubs'), joker()]);
        expect(shape?.kind).toBe('set');
        expect(shape?.stands[2]).toEqual({ rank: '7', suit: null });
    });

    it('never holds more jokers than natural cards', () => {
        expect(arrangeMeld([c('7', 'hearts'), joker(), joker()])).toBeNull();
        expect(arrangeMeld([c('7', 'hearts'), c('7', 'clubs'), joker(), joker()])?.kind).toBe('set');
        expect(arrangeMeld([joker(), joker(), joker()])).toBeNull();
    });
});

describe('runs', () => {
    it('takes three or more in a row in one suit, in any order', () => {
        const shape = arrangeMeld([c('6', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]);
        expect(shape?.kind).toBe('run');
        expect(shape?.cards.map(card => card.rank)).toEqual(['4', '5', '6']);
    });

    it('refuses a gap, or a mix of suits', () => {
        expect(arrangeMeld([c('4', 'hearts'), c('5', 'hearts'), c('7', 'hearts')])).toBeNull();
        expect(arrangeMeld([c('4', 'hearts'), c('5', 'hearts'), c('6', 'clubs')])).toBeNull();
    });

    it('allows the ace low and the ace high', () => {
        const low = arrangeMeld([c('ace', 'spades'), c('2', 'spades'), c('3', 'spades')]);
        expect(low?.kind).toBe('run');
        expect(low?.low).toBe(1);
        const high = arrangeMeld([c('queen', 'spades'), c('king', 'spades'), c('ace', 'spades')]);
        expect(high?.kind).toBe('run');
        expect(high?.cards.map(card => card.rank)).toEqual(['queen', 'king', 'ace']);
        expect(high?.low).toBe(12);
    });

    it('never goes round the corner', () => {
        expect(arrangeMeld([c('king', 'spades'), c('ace', 'spades'), c('2', 'spades')])).toBeNull();
        expect(arrangeMeld([c('king', 'spades'), joker(), c('2', 'spades')])).toBeNull();
    });

    it('fills a gap with a joker', () => {
        const shape = arrangeMeld([c('4', 'hearts'), joker(), c('6', 'hearts')]);
        expect(shape?.cards[1].rank).toBe('joker');
        expect(shape?.stands[1]).toEqual({ rank: '5', suit: 'hearts' });
    });

    it('puts a spare joker where it is worth the most, but never past the ends', () => {
        const middle = arrangeMeld([c('5', 'hearts'), c('6', 'hearts'), joker()]);
        expect(middle?.stands[2]).toEqual({ rank: '7', suit: 'hearts' });
        const top = arrangeMeld([c('king', 'hearts'), c('ace', 'hearts'), joker()]);
        expect(top?.stands[0]).toEqual({ rank: 'queen', suit: 'hearts' });
        const bottom = arrangeMeld([c('ace', 'hearts'), c('2', 'hearts'), joker()]);
        expect(bottom?.stands[2]).toEqual({ rank: '3', suit: 'hearts' });
    });

    it('reads an ace and a king with a joker between as queen-king-ace, an ace and three as ace-2-3', () => {
        const high = arrangeMeld([c('ace', 'clubs'), c('queen', 'clubs'), joker()]);
        expect(high?.stands[1]).toEqual({ rank: 'king', suit: 'clubs' });
        const low = arrangeMeld([c('ace', 'clubs'), c('3', 'clubs'), joker()]);
        expect(low?.stands[1]).toEqual({ rank: '2', suit: 'clubs' });
    });

    it('never holds more jokers than natural cards', () => {
        expect(arrangeMeld([c('5', 'hearts'), joker(), joker()])).toBeNull();
        expect(arrangeMeld([c('5', 'hearts'), c('8', 'hearts'), joker(), joker()])?.kind).toBe('run');
    });

    it('refuses the same card twice in one run', () => {
        expect(arrangeMeld([c('5', 'hearts', 0), c('5', 'hearts', 1), c('6', 'hearts'), c('7', 'hearts')])).toBeNull();
    });
});

describe('what melds are worth', () => {
    it('counts ace 11, faces 10, the rest their pip', () => {
        expect(meldValue(arrangeMeld([c('ace', 'spades'), c('2', 'spades'), c('3', 'spades')])!)).toBe(16);
        expect(meldValue(arrangeMeld([c('queen', 'spades'), c('king', 'spades'), c('ace', 'spades')])!)).toBe(31);
        expect(meldValue(arrangeMeld([c('jack', 'hearts'), c('jack', 'clubs'), c('jack', 'spades')])!)).toBe(30);
    });

    it('counts a joker as the card it stands for', () => {
        // 9-joker-jack: the joker is a ten, so 29.
        expect(meldValue(arrangeMeld([c('9', 'spades'), joker(), c('jack', 'spades')])!)).toBe(29);
        // A set of kings with a joker: 30.
        expect(meldValue(arrangeMeld([c('king', 'hearts'), c('king', 'clubs'), joker()])!)).toBe(30);
    });
});

describe('opening', () => {
    const under = [c('jack', 'hearts'), c('jack', 'clubs'), c('jack', 'spades')];
    const rest = [c('4', 'clubs'), c('2', 'diamonds'), c('9', 'spades')];

    it('is refused at 30 but counts up across melds in one turn', () => {
        const hand = [...under, c('7', 'hearts'), c('8', 'hearts'), c('9', 'hearts'), ...rest];
        const start = table({ hands: { cookie: hand, computer: [c('9', 'clubs')] } });

        const first = expectOk(meldCards(start, ids(under)));
        expect(first.opened.cookie).toBe(false);
        expect(first.turnMeldValue).toBe(30);

        const refused = discardCard(first, rest[0].id);
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.why).toContain('You need 51 points to open; these are worth 30');

        const second = expectOk(meldCards(first, ids([hand[3], hand[4], hand[5]])));
        expect(second.turnMeldValue).toBe(54);
        expect(second.opened.cookie).toBe(true);
        expect(second.openedThisTurn).toBe(true);
        expectOk(discardCard(second, rest[0].id));
    });

    it('reaches the threshold exactly', () => {
        // K K K (30) + 6-7-8 (21) = 51 on the nose.
        const kings = [c('king', 'hearts'), c('king', 'clubs'), c('king', 'spades')];
        const run = [c('6', 'hearts'), c('7', 'hearts'), c('8', 'hearts')];
        const hand = [...kings, ...run, c('2', 'clubs')];
        const next = expectOk(meldCards(expectOk(meldCards(table({ hands: { cookie: hand, computer: [] } }), ids(kings))), ids(run)));
        expect(next.turnMeldValue).toBe(51);
        expect(next.opened.cookie).toBe(true);
    });

    it('counts a joker at the value it stands for', () => {
        // Q-joker-A in spades: 10 + 10 + 11 = 31; with 7-7-7 (21): 52.
        const run = [c('queen', 'spades'), joker(), c('ace', 'spades')];
        const set = [c('7', 'hearts'), c('7', 'clubs'), c('7', 'diamonds')];
        const hand = [...run, ...set, c('2', 'clubs')];
        const state = expectOk(meldCards(expectOk(meldCards(table({ hands: { cookie: hand, computer: [] } }), ids(run))), ids(set)));
        expect(state.turnMeldValue).toBe(52);
        expect(state.opened.cookie).toBe(true);
    });

    it('honours a lower opening', () => {
        const hand = [c('king', 'hearts'), c('king', 'clubs'), c('king', 'spades'), c('jack', 'diamonds'), c('queen', 'diamonds'), c('king', 'diamonds'), c('2', 'clubs')];
        const state = table({ opening: 40, hands: { cookie: hand, computer: [] } });
        const first = expectOk(meldCards(state, ids(hand.slice(0, 3))));
        expect(first.opened.cookie).toBe(false);
        const second = expectOk(meldCards(first, ids(hand.slice(3, 6))));
        expect(second.opened.cookie).toBe(true);
    });

    it('stops you laying off or swapping before you have opened', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), joker()]);
        const seven = c('7', 'hearts');
        const eight = c('8', 'hearts');
        const state = table({ melds: [meld], hands: { cookie: [seven, eight, c('2', 'clubs')], computer: [] } });
        expect(layOffCards(state, meld.id, [eight.id]).ok).toBe(false);
        expect(swapJoker(state, meld.id, seven.id).ok).toBe(false);
    });

    it('keeps one card back for the final discard', () => {
        const hand = [c('king', 'hearts'), c('king', 'clubs'), c('king', 'spades')];
        const state = table({ hands: { cookie: hand, computer: [] } });
        const out = meldCards(state, ids(hand));
        expect(out.ok).toBe(false);
    });
});

describe('finding melds in a hand', () => {
    it('finds the split worth the most, and every value agrees with the rules', () => {
        const hand = [
            c('king', 'hearts'),
            c('king', 'clubs'),
            c('king', 'spades'),
            c('queen', 'hearts'),
            c('jack', 'hearts'),
            c('4', 'clubs'),
            c('9', 'diamonds'),
        ];
        const plan = bestMelds(hand, 'value');
        expect(plan.value).toBe(30);
        for (const cards of plan.melds) expect(arrangeMeld(cards)).not.toBeNull();
    });

    it('uses both copies of a card in two different melds', () => {
        const hand = [
            c('5', 'hearts', 0),
            c('5', 'hearts', 1),
            c('6', 'hearts', 0),
            c('6', 'hearts', 1),
            c('7', 'hearts', 0),
            c('7', 'hearts', 1),
            c('2', 'clubs'),
        ];
        const plan = bestMelds(hand, 'value');
        expect(plan.melds).toHaveLength(2);
        expect(plan.value).toBe(36);
    });

    it('holds a card back when everything would otherwise go down', () => {
        const hand = [c('king', 'hearts'), c('king', 'clubs'), c('king', 'spades')];
        expect(bestMelds(hand, 'value').melds).toHaveLength(0);
        const four = [...hand, c('king', 'diamonds')];
        const plan = bestMelds(four, 'value');
        expect(plan.used).toBe(3);
    });

    it('stays quick on the fullest hand there can be', () => {
        const hand = [
            joker(),
            joker(),
            joker(),
            joker(),
            ...(['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack'] as Rank[]).map(rank => c(rank, 'hearts')),
        ];
        const started = Date.now();
        const plan = bestMelds(hand, 'value');
        expect(plan.used).toBeGreaterThan(10);
        expect(Date.now() - started).toBeLessThan(1500);
    });
});

describe('taking the top discard', () => {
    it('is allowed to an opened player when the card melds with two in hand', () => {
        const top = c('7', 'hearts');
        const state = table({
            phase: 'draw',
            opened: { cookie: true, computer: false },
            discard: [top],
            hands: { cookie: [c('7', 'clubs'), c('7', 'spades'), c('2', 'clubs')], computer: [] },
        });
        const next = expectOk(takeDiscard(state));
        expect(next.mustUse).toEqual([top.id]);
        expect(next.hands.cookie.map(card => card.id)).toContain(top.id);
        expect(next.phase).toBe('play');
    });

    it('is allowed to an opened player when the card lays off on the table', () => {
        const top = c('8', 'hearts');
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const state = table({
            phase: 'draw',
            opened: { cookie: true, computer: false },
            discard: [top],
            melds: [meld],
            hands: { cookie: [c('2', 'clubs')], computer: [] },
        });
        expect(takeDiscard(state).ok).toBe(true);
    });

    it('allows a card that fits once your own cards build up to it', () => {
        const top = c('9', 'hearts');
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const state = table({
            phase: 'draw',
            opened: { cookie: true, computer: false },
            discard: [top],
            melds: [meld],
            hands: { cookie: [c('8', 'hearts'), c('2', 'clubs')], computer: [] },
        });
        expect(takeDiscard(state).ok).toBe(true);
    });

    it('is refused with a reason when it will not go anywhere', () => {
        const state = table({
            phase: 'draw',
            opened: { cookie: true, computer: false },
            discard: [c('8', 'hearts')],
            hands: { cookie: [c('2', 'clubs'), c('5', 'spades')], computer: [] },
        });
        const out = takeDiscard(state);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.why).toContain('8 of hearts');
    });

    it('is refused before opening unless the melds with it reach the threshold', () => {
        const hand = [c('7', 'clubs'), c('7', 'spades'), c('2', 'clubs'), c('5', 'spades')];
        const state = table({ phase: 'draw', discard: [c('7', 'hearts')], hands: { cookie: hand, computer: [] } });
        const out = takeDiscard(state);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.why).toContain('worth 21');
    });

    it('is allowed before opening when the melds with it reach the threshold', () => {
        const hand = [
            c('king', 'clubs'),
            c('king', 'spades'),
            c('jack', 'hearts'),
            c('queen', 'hearts'),
            c('ace', 'hearts'),
            c('2', 'diamonds'),
        ];
        const state = table({ phase: 'draw', discard: [c('king', 'hearts')], hands: { cookie: hand, computer: [] } });
        // K K K (30) + J Q A cannot run without the king, but K-K-K alone is 30: refused.
        expect(takeDiscard(state).ok).toBe(false);

        const better = [c('king', 'clubs'), c('king', 'spades'), c('10', 'hearts'), c('jack', 'hearts'), c('queen', 'hearts'), c('2', 'diamonds')];
        const yes = table({ phase: 'draw', discard: [c('king', 'hearts')], hands: { cookie: better, computer: [] } });
        // K K K (30) + 10 J Q (30) = 60.
        const taken = expectOk(takeDiscard(yes));
        expect(whyNotTake(takeCheckFor(yes))).toBeNull();
        const opened = expectOk(meldCards(taken, [taken.mustUse[0], better[0].id, better[1].id]));
        expect(opened.mustUse).toEqual([]);
    });

    it('allows opening from the hand and then laying the card off', () => {
        const hand = [
            c('king', 'clubs'),
            c('king', 'spades'),
            c('king', 'hearts'),
            c('10', 'hearts'),
            c('jack', 'hearts'),
            c('queen', 'hearts'),
            c('2', 'diamonds'),
        ];
        const state = table({ phase: 'draw', discard: [c('9', 'hearts')], hands: { cookie: hand, computer: [] } });
        expect(takeDiscard(state).ok).toBe(true);
    });

    it('must be used before the turn can end', () => {
        const top = c('7', 'hearts');
        const hand = [c('7', 'clubs'), c('7', 'spades'), c('2', 'clubs'), c('5', 'clubs')];
        const state = table({
            phase: 'draw',
            opened: { cookie: true, computer: false },
            discard: [top],
            hands: { cookie: hand, computer: [] },
        });
        const taken = expectOk(takeDiscard(state));
        const refused = discardCard(taken, hand[3].id);
        expect(refused.ok).toBe(false);
        expect(discardCard(taken, top.id).ok).toBe(false);
        const used = expectOk(meldCards(taken, [top.id, hand[0].id, hand[1].id]));
        expectOk(discardCard(used, hand[3].id));
    });

    it('spends the very card you took when you hold its twin', () => {
        const taken = c('7', 'hearts', 1);
        const twin = c('7', 'hearts', 0);
        const hand = [twin, taken, c('7', 'clubs'), c('7', 'spades'), c('2', 'clubs')];
        const plan = bestMeldsWith(hand, taken.id, 'charge');
        expect(plan?.melds[0].map(card => card.id)).toContain(taken.id);
        expect(plan?.melds[0].map(card => card.id)).not.toContain(twin.id);
    });
});

describe('laying off', () => {
    const opened = { cookie: true, computer: false };

    it('extends a run at either end', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const eight = c('8', 'hearts');
        const four = c('4', 'hearts');
        const state = table({ opened, melds: [meld], hands: { cookie: [eight, four, c('2', 'clubs')], computer: [] } });
        const after = expectOk(layOffCards(state, meld.id, [eight.id, four.id]));
        expect(after.melds[0].cards.map(card => card.rank)).toEqual(['4', '5', '6', '7', '8']);
        expect(meldIsSound(after.melds[0])).toBe(true);
    });

    it('works on the other player melds as well as your own', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')], 'theirs', 'computer');
        const eight = c('8', 'hearts');
        const state = table({ opened, melds: [meld], hands: { cookie: [eight, c('2', 'clubs')], computer: [] } });
        expect(layOffCards(state, 'theirs', [eight.id]).ok).toBe(true);
    });

    it('adds to a set up to four, in a suit it does not have', () => {
        const meld = asMeld([c('5', 'hearts'), c('5', 'clubs'), c('5', 'spades')]);
        expect(layOffOptions(meld, c('5', 'diamonds'))).toHaveLength(1);
        expect(layOffOptions(meld, c('5', 'hearts'))).toHaveLength(0);
        const full = layOffOptions(meld, c('5', 'diamonds'))[0];
        expect(layOffOptions(full, joker())).toHaveLength(0);
    });

    it('takes a king then an ace on top, and refuses to go round the corner', () => {
        const meld = asMeld([c('10', 'hearts'), c('jack', 'hearts'), c('queen', 'hearts')]);
        const withKing = layOffOptions(meld, c('king', 'hearts'))[0];
        const withAce = layOffOptions(withKing, c('ace', 'hearts'))[0];
        expect(withAce.low + withAce.cards.length - 1).toBe(14);
        expect(layOffOptions(withAce, c('2', 'hearts'))).toHaveLength(0);
        expect(layOffOptions(withAce, joker()).every(option => option.low === 9)).toBe(true);
    });

    it('offers a joker at either end, unless it would outnumber the natural cards', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        expect(layOffOptions(meld, joker())).toHaveLength(2);
        const thin = asMeld([c('5', 'hearts'), c('6', 'hearts'), joker()]);
        const once = layOffOptions(thin, joker());
        expect(once).toHaveLength(2);
        expect(layOffOptions(once[0], joker())).toHaveLength(0);
    });

    it('takes a low ace under a two', () => {
        const meld = asMeld([c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs')]);
        const option = layOffOptions(meld, c('ace', 'clubs'));
        expect(option).toHaveLength(1);
        expect(option[0].low).toBe(1);
    });

    it('keeps one card back', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const eight = c('8', 'hearts');
        const state = table({ opened, melds: [meld], hands: { cookie: [eight], computer: [] } });
        expect(layOffCards(state, meld.id, [eight.id]).ok).toBe(false);
    });

    it('reports a card that does not fit', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        const stray = c('2', 'clubs');
        const state = table({ opened, melds: [meld], hands: { cookie: [stray, c('9', 'clubs')], computer: [] } });
        const out = layOffCards(state, meld.id, [stray.id]);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.why).toContain('2 of clubs');
    });
});

describe('joker swaps', () => {
    const opened = { cookie: true, computer: false };

    it('gives the natural card and takes the joker, from a run', () => {
        const wild = joker();
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), wild], 'run');
        const seven = c('7', 'hearts');
        const hand = [seven, c('2', 'clubs'), c('9', 'clubs')];
        const state = table({ opened, melds: [meld], hands: { cookie: hand, computer: [] } });
        const after = expectOk(swapJoker(state, 'run', seven.id));
        expect(after.melds[0].cards.map(card => card.id)).toContain(seven.id);
        expect(after.melds[0].cards.some(card => card.rank === 'joker')).toBe(false);
        expect(after.hands.cookie.map(card => card.id)).toContain(wild.id);
        expect(after.mustUse).toEqual([wild.id]);
    });

    it('refuses any card but the one the joker stands for', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), joker()], 'run');
        const wrong = c('8', 'hearts');
        const state = table({ opened, melds: [meld], hands: { cookie: [wrong, c('2', 'clubs')], computer: [] } });
        const out = swapJoker(state, 'run', wrong.id);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.why).toContain('7♥');
    });

    it('in a set, takes any suit the set does not have yet', () => {
        const meld = asMeld([c('5', 'hearts'), c('5', 'clubs'), joker()], 'set');
        expect(swapOut(meld, c('5', 'spades'))).not.toBeNull();
        expect(swapOut(meld, c('5', 'diamonds'))).not.toBeNull();
        expect(swapOut(meld, c('5', 'hearts'))).toBeNull();
        expect(swapOut(meld, c('6', 'spades'))).toBeNull();
    });

    it('makes the joker go back down before the turn can end', () => {
        const wild = joker();
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), wild], 'run');
        const seven = c('7', 'hearts');
        const hand = [seven, c('2', 'clubs'), c('9', 'clubs')];
        const state = table({ opened, melds: [meld], hands: { cookie: hand, computer: [] } });
        const after = expectOk(swapJoker(state, 'run', seven.id));
        expect(discardCard(after, hand[1].id).ok).toBe(false);
        const placed = expectOk(layOffCards(after, 'run', [wild.id]));
        expect(placed.mustUse).toEqual([]);
        expect(placed.melds[0].cards).toHaveLength(4);
        expect(discardCard(placed, hand[1].id).ok).toBe(true);
    });

    it('is refused when the joker could not go anywhere', () => {
        // A set of four filled by the swap, and nothing else on the table to hold a joker.
        const meld = asMeld([c('5', 'hearts'), c('5', 'clubs'), c('5', 'spades'), joker()], 'set');
        const five = c('5', 'diamonds');
        const state = table({ opened, melds: [meld], hands: { cookie: [five, c('2', 'clubs')], computer: [] } });
        const out = swapJoker(state, 'set', five.id);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.why).toContain('nowhere');
    });

    it('is refused when you would have nothing left to discard', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), joker()], 'run');
        const seven = c('7', 'hearts');
        const state = table({ opened, melds: [meld], hands: { cookie: [seven], computer: [] } });
        expect(swapJoker(state, 'run', seven.id).ok).toBe(false);
    });
});

describe('going out', () => {
    it('ends the hand when the last card is discarded, charging the other player', () => {
        const last = c('2', 'clubs');
        const state = table({
            opened: { cookie: true, computer: false },
            hands: { cookie: [last], computer: [c('king', 'clubs'), c('ace', 'clubs'), joker(), c('4', 'hearts')] },
        });
        const after = expectOk(discardCard(state, last.id));
        expect(after.phase).toBe('over');
        expect(after.result?.wentOut).toBe('cookie');
        expect(after.result?.kalooki).toBe(false);
        expect(after.result?.charges).toEqual({ cookie: 0, computer: 10 + 11 + 25 + 4 });
    });

    it('is a kalooki when you go out in one turn without having opened, doubling the charge', () => {
        const sets = [c('king', 'hearts'), c('king', 'clubs'), c('king', 'spades')];
        const run = [c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts')];
        const last = c('2', 'clubs');
        const state = table({
            hands: { cookie: [...sets, ...run, last], computer: [c('king', 'diamonds'), c('7', 'diamonds')] },
        });
        const one = expectOk(meldCards(state, ids(sets)));
        const two = expectOk(meldCards(one, ids(run)));
        const out = expectOk(discardCard(two, last.id));
        expect(out.result?.wentOut).toBe('cookie');
        expect(out.result?.kalooki).toBe(true);
        expect(out.result?.charges).toEqual({ cookie: 0, computer: (10 + 7) * 2 });
    });

    it('is not a kalooki if you had opened on an earlier turn', () => {
        const last = c('2', 'clubs');
        const state = table({
            opened: { cookie: true, computer: false },
            openedThisTurn: false,
            hands: { cookie: [last], computer: [c('7', 'diamonds')] },
        });
        const out = expectOk(discardCard(state, last.id));
        expect(out.result?.kalooki).toBe(false);
        expect(out.result?.charges.computer).toBe(7);
    });

    it('moves to the other player when cards remain', () => {
        const hand = [c('2', 'clubs'), c('3', 'spades')];
        const state = table({ hands: { cookie: hand, computer: [c('7', 'diamonds')] } });
        const next = expectOk(discardCard(state, hand[0].id));
        expect(next.turn).toBe('computer');
        expect(next.phase).toBe('draw');
        expect(next.discard[next.discard.length - 1].id).toBe(hand[0].id);
    });
});

describe('scoring and the match', () => {
    it('charges a joker 25, an ace 11, a face 10, others their pip', () => {
        expect(handCharge([joker()])).toBe(25);
        expect(handCharge([c('ace', 'spades')])).toBe(11);
        expect(handCharge([c('king', 'spades'), c('jack', 'hearts')])).toBe(20);
        expect(handCharge([c('7', 'spades'), c('2', 'hearts')])).toBe(9);
    });

    it('doubles only the player who was left holding cards', () => {
        const hands = { cookie: [], computer: [c('5', 'clubs')] };
        expect(settleHand(hands, 'cookie', true)).toEqual({ cookie: 0, computer: 10 });
        const both = { cookie: [c('2', 'clubs')], computer: [c('5', 'clubs')] };
        expect(settleHand(both, null, false)).toEqual({ cookie: 2, computer: 5 });
    });

    it('ends when someone reaches the limit, lower total winning', () => {
        expect(matchWinner({ cookie: 149, computer: 149 })).toBeNull();
        expect(matchWinner({ cookie: 150, computer: 20 })).toBe('computer');
        expect(matchWinner({ cookie: 40, computer: 151 })).toBe('cookie');
        expect(matchWinner({ cookie: 160, computer: 160 })).toBe('tie');
    });

    it('records a finished hand exactly once, and alternates who starts', () => {
        const match = newMatch(9);
        const last = c('2', 'clubs');
        const over = expectOk(
            discardCard(
                table({ handNo: 1, opened: { cookie: true, computer: false }, hands: { cookie: [last], computer: [c('king', 'clubs')] } }),
                last.id,
            ),
        );
        const recorded = recordHand({ ...match, hand: over });
        expect(recorded.totals).toEqual({ cookie: 0, computer: 10 });
        expect(recorded.history).toHaveLength(1);
        expect(recordHand(recorded)).toBe(recorded);

        const second = startNextHand(recorded, 10);
        expect(second.hand.handNo).toBe(2);
        expect(second.hand.turn).toBe('computer');
        expect(second.totals).toEqual({ cookie: 0, computer: 10 });
    });
});

describe('the deal and the stock', () => {
    it('deals 108 cards, thirteen each, one turned up, the same way for the same seed', () => {
        const hand = dealHand({ seed: 42 });
        expect(hand.hands.cookie).toHaveLength(13);
        expect(hand.hands.computer).toHaveLength(13);
        expect(hand.discard).toHaveLength(1);
        expect(hand.stock).toHaveLength(108 - 27);
        expect(handProblems(hand)).toEqual([]);
        expect(dealHand({ seed: 42 })).toEqual(hand);
        expect(dealHand({ seed: 43 }).hands.cookie).not.toEqual(hand.hands.cookie);
    });

    it('deals fifteen each when asked', () => {
        const hand = dealHand({ seed: 42, handSize: 15 });
        expect(hand.hands.cookie).toHaveLength(15);
        expect(hand.stock).toHaveLength(108 - 31);
        expect(handProblems(hand)).toEqual([]);
    });

    it('keeps Cookie cards face up and the computer cards and stock face down', () => {
        const hand = dealHand({ seed: 42 });
        expect(hand.hands.cookie.every(card => card.isFaceUp)).toBe(true);
        expect(hand.hands.computer.every(card => !card.isFaceUp)).toBe(true);
        expect(hand.stock.every(card => !card.isFaceUp)).toBe(true);
        expect(hand.discard[0].isFaceUp).toBe(true);
    });

    it('turns the discard pile over when the stock runs out, keeping its top card', () => {
        const pile = [c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs'), c('5', 'clubs')];
        const state = table({ phase: 'draw', stock: [], discard: pile, hands: { cookie: [c('9', 'clubs')], computer: [] } });
        const after = turnOverDiscards(state);
        expect(after.discard.map(card => card.id)).toEqual([pile[3].id]);
        expect(after.stock.every(card => !card.isFaceUp)).toBe(true);
        // The first card ever discarded is on top of the new stock.
        expect(after.stock[after.stock.length - 1].id).toBe(pile[0].id);

        const drawn = expectOk(drawFromStock(state));
        expect(drawn.hands.cookie.map(card => card.id)).toContain(pile[0].id);
        expect(drawn.stock).toHaveLength(2);
    });

    it('ends the hand if there is nothing left to draw at all, charging both', () => {
        const state = table({
            phase: 'draw',
            stock: [],
            discard: [c('2', 'clubs')],
            hands: { cookie: [c('9', 'clubs')], computer: [c('3', 'hearts')] },
        });
        const after = expectOk(drawFromStock(state));
        expect(after.phase).toBe('over');
        expect(after.result?.wentOut).toBeNull();
        expect(after.result?.charges).toEqual({ cookie: 9, computer: 3 });
    });
});

describe('the status line', () => {
    it('says what to do at each step', () => {
        const hand = dealHand({ seed: 7 });
        expect(statusLine(hand, [])).toBe('Draw a card, or take the top discard');
        expect(statusLine({ ...hand, turn: 'computer' }, [])).toBe('Computer is thinking…');
        const opened = table({ opened: { cookie: true, computer: false }, hands: { cookie: [c('2', 'clubs'), c('3', 'clubs')], computer: [] } });
        expect(statusLine(opened, [])).toBe('Meld, lay off, then discard');
    });

    it('counts up towards the opening as you pick cards', () => {
        const picks = [c('jack', 'hearts'), c('jack', 'clubs'), c('jack', 'spades')];
        const state = table({ hands: { cookie: [...picks, c('2', 'clubs')], computer: [] } });
        expect(statusLine(state, picks)).toBe('You need 51 points to open; these are worth 30');
        expect(statusLine({ ...state, turnMeldValue: 24 }, picks)).toContain('54');
    });
});

describe('integrity checks', () => {
    it('catches a lost card', () => {
        const hand = dealHand({ seed: 3 });
        const short = { ...hand, stock: hand.stock.slice(1) };
        expect(handProblems(short)).not.toEqual([]);
        expect(everyCard(short)).toHaveLength(107);
    });

    it('catches a bad meld', () => {
        const meld = asMeld([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')]);
        expect(meldIsSound(meld)).toBe(true);
        expect(meldIsSound({ ...meld, low: 13 })).toBe(false);
        expect(meldIsSound({ ...meld, cards: [c('5', 'hearts'), c('6', 'clubs'), c('7', 'hearts')] })).toBe(false);
    });
});

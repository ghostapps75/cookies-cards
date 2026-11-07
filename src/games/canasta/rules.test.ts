import { describe, expect, it } from 'vitest';
import { buildDoubleDeck, turned, type PlayingCard } from '../shared/cards';
import {
    DECK_SIZE,
    HAND_SIZE,
    allCards,
    applyMove,
    arrangeSelection,
    cardValue,
    checkMeld,
    countCanastas,
    dealHand,
    findMinimumMeld,
    goingOutPlan,
    initialMinimum,
    isBlackThree,
    isRedThree,
    isWild,
    matchWinner,
    meldProblem,
    planTake,
    planTakeWith,
    scoreHand,
    scoreSeat,
    type HandState,
    type Meld,
    type MeldRank,
    type Player,
    type Seat,
} from './rules';

/** Cards by shorthand: `K`, `10`, `2`, `joker`, `3h` (a red three), `3c` (a black one). */
const WORDS: Record<string, string> = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };

const makeCards = (spec: string): PlayingCard[] => {
    const used = new Map<string, number>();
    const deck = buildDoubleDeck(4);
    return spec
        .split(' ')
        .filter(Boolean)
        .map(token => {
            let rank = WORDS[token] ?? token;
            let suit: string | null = null;
            const match = /^3([hdcs])$/.exec(token);
            if (match) {
                rank = '3';
                suit = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' }[match[1]]!;
            }
            const matches = deck.filter(card => card.rank === rank && (!suit || card.suit === suit));
            const at = used.get(token) ?? 0;
            used.set(token, at + 1);
            if (!matches[at]) throw new Error(`no more ${token}`);
            return turned(matches[at], true);
        });
};

/** Cards for two separate lists must not collide, so anything shared takes an offset. */
const fresh = (spec: string, offset: number): PlayingCard[] =>
    makeCards(spec).map(card => ({ ...card, id: `${card.id}#${offset}` }));

const seatOf = (over: Partial<Player> = {}): Player => ({
    hand: [],
    melds: [],
    redThrees: [],
    tookRanks: [],
    ...over,
});

const meldOf = (rank: MeldRank, spec: string, offset = 900): Meld => ({ rank, cards: fresh(spec, offset) });

let tick = 0;
const table = (over: {
    cookie?: Partial<Player>;
    computer?: Partial<Player>;
    stock?: string;
    discard?: string;
    frozen?: boolean;
    turn?: Seat;
    phase?: HandState['phase'];
    needed?: number;
    totals?: Record<Seat, number>;
    meldedAtTurnStart?: boolean;
}): HandState => ({
    seed: 1,
    stock: fresh(over.stock ?? '4 5 6 7 8', ++tick * 10),
    discard: fresh(over.discard ?? '', ++tick * 10),
    frozen: over.frozen ?? false,
    players: { cookie: seatOf(over.cookie), computer: seatOf(over.computer) },
    turn: over.turn ?? 'cookie',
    phase: over.phase ?? 'play',
    startTotals: over.totals ?? { cookie: 0, computer: 0 },
    canastasNeeded: over.needed ?? 2,
    meldedAtTurnStart: over.meldedAtTurnStart ?? (over.cookie?.melds?.length ?? 0) > 0,
    ending: null,
    wentOut: null,
    concealed: false,
});

const hand = (spec: string): PlayingCard[] => fresh(spec, 1);
const idsOf = (cards: PlayingCard[]): string[] => cards.map(card => card.id);
const rankIds = (player: Player, rank: string): string[] => player.hand.filter(c => c.rank === rank).map(c => c.id);

const must = (result: ReturnType<typeof applyMove>): HandState => {
    if (!result.ok) throw new Error(result.reason);
    return result.value;
};

describe('card values', () => {
    it('match the table', () => {
        const value = (spec: string) => cardValue(makeCards(spec)[0]);
        expect(value('joker')).toBe(50);
        expect(value('2')).toBe(20);
        expect(value('A')).toBe(20);
        expect(value('K')).toBe(10);
        expect(value('8')).toBe(10);
        expect(value('7')).toBe(5);
        expect(value('4')).toBe(5);
        expect(value('3c')).toBe(5);
    });
});

describe('the deal', () => {
    it('hands out fifteen each and accounts for all 108 cards', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const state = dealHand({ seed });
            expect(state.players.cookie.hand).toHaveLength(HAND_SIZE);
            expect(state.players.computer.hand).toHaveLength(HAND_SIZE);
            const cards = allCards(state);
            expect(cards).toHaveLength(DECK_SIZE);
            expect(new Set(idsOf(cards)).size).toBe(DECK_SIZE);
        }
    });

    it('is the same hand for the same seed', () => {
        expect(dealHand({ seed: 77 })).toEqual(dealHand({ seed: 77 }));
    });

    it('never leaves a red three in a hand', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const state = dealHand({ seed });
            expect(state.players.cookie.hand.some(isRedThree)).toBe(false);
            expect(state.players.computer.hand.some(isRedThree)).toBe(false);
        }
    });

    it('turns up a natural card, freezing the pile if a wild or red three came first', () => {
        let frozenSeen = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const state = dealHand({ seed });
            const top = state.discard[state.discard.length - 1];
            expect(isWild(top)).toBe(false);
            expect(isRedThree(top)).toBe(false);
            if (state.discard.length > 1) {
                expect(state.frozen).toBe(true);
                frozenSeen++;
            } else {
                expect(state.frozen).toBe(false);
            }
        }
        expect(frozenSeen).toBeGreaterThan(0);
    });

    it('keeps Cookie\'s cards face up and the computer\'s face down', () => {
        const state = dealHand({ seed: 5 });
        expect(state.players.cookie.hand.every(card => card.isFaceUp)).toBe(true);
        expect(state.players.computer.hand.every(card => !card.isFaceUp)).toBe(true);
        expect(state.stock.every(card => !card.isFaceUp)).toBe(true);
    });
});

describe('meld validity', () => {
    const check = (rank: MeldRank | '2', spec: string) => meldProblem(rank, makeCards(spec));

    it('accepts three of a kind', () => {
        expect(check('king', 'K K K')).toBeNull();
    });
    it('accepts two naturals and a wild', () => {
        expect(check('king', 'K K 2')).toBeNull();
        expect(check('king', 'K K joker')).toBeNull();
    });
    it('refuses one natural and two wilds', () => {
        expect(check('king', 'K 2 joker')).toMatch(/two cards that are not wild/);
    });
    it('refuses two cards', () => {
        expect(check('king', 'K K')).toMatch(/three/);
    });
    it('refuses mixed ranks', () => {
        expect(check('king', 'K K Q')).toMatch(/one rank/);
    });
    it('refuses a fourth wild', () => {
        expect(check('king', 'K K K K 2 2 2 joker')).toMatch(/three wild/);
        expect(check('king', 'K K K K 2 2 2')).toBeNull();
    });
    it('has no meld of twos', () => {
        expect(check('2', '2 2 2')).toMatch(/wild/);
    });
    it('takes black threes only three or four together with no wilds', () => {
        expect(check('3', '3c 3c 3s')).toBeNull();
        expect(check('3', '3c 3c 3s 3s')).toBeNull();
        expect(check('3', '3c 3c')).toMatch(/three or four/);
        expect(check('3', '3c 3c 2')).toMatch(/wild/);
        expect(check('3', '3h 3c 3s')).toMatch(/Red threes/);
    });

    it('allows only one meld per rank: more cards join the one there is', () => {
        const melds = [meldOf('king', 'K K K')];
        const state = table({ cookie: { hand: hand('K K 5 6 7'), melds } });
        const groups = [{ rank: 'king' as const, cardIds: rankIds(state.players.cookie, 'king') }];
        const next = must(applyMove(state, 'cookie', { type: 'meld', groups }));
        expect(next.players.cookie.melds).toHaveLength(1);
        expect(next.players.cookie.melds[0].cards).toHaveLength(5);
    });

    it('lets a canasta keep growing', () => {
        const melds = [meldOf('king', 'K K K K K K K')];
        const state = table({ cookie: { hand: hand('K 5 6 7'), melds } });
        const groups = [{ rank: 'king' as const, cardIds: rankIds(state.players.cookie, 'king') }];
        const next = must(applyMove(state, 'cookie', { type: 'meld', groups }));
        expect(next.players.cookie.melds[0].cards).toHaveLength(8);
    });

    it('sorts a selection across ranks, wilds to where they are needed', () => {
        const player = seatOf({ hand: hand('K K K Q Q 2 6') });
        const arranged = arrangeSelection(player, player.hand.filter(card => card.rank !== '6'));
        expect(arranged.ok).toBe(true);
        if (arranged.ok) {
            const queens = arranged.value.find(group => group.rank === 'queen')!;
            expect(queens.cardIds).toHaveLength(3);
            const kings = arranged.value.find(group => group.rank === 'king')!;
            expect(kings.cardIds).toHaveLength(3);
        }
    });

    it('refuses wild cards on their own without a target', () => {
        const player = seatOf({ hand: hand('2 joker') });
        const arranged = arrangeSelection(player, player.hand);
        expect(arranged.ok).toBe(false);
    });
});

describe('the first meld minimum', () => {
    it('goes by the total at the start of the hand', () => {
        expect(initialMinimum(-1)).toBe(15);
        expect(initialMinimum(-500)).toBe(15);
        expect(initialMinimum(0)).toBe(50);
        expect(initialMinimum(1495)).toBe(50);
        expect(initialMinimum(1500)).toBe(90);
        expect(initialMinimum(2995)).toBe(90);
        expect(initialMinimum(3000)).toBe(120);
        expect(initialMinimum(4990)).toBe(120);
    });

    it('holds Cookie to it, across several melds put down together', () => {
        const state = table({ cookie: { hand: hand('K K K 7 7 7 5 6') } });
        const kings = { rank: 'king' as const, cardIds: rankIds(state.players.cookie, 'king') };
        const sevens = { rank: '7' as const, cardIds: rankIds(state.players.cookie, '7') };
        const alone = applyMove(state, 'cookie', { type: 'meld', groups: [kings] });
        expect(alone.ok).toBe(false);
        if (!alone.ok) expect(alone.reason).toMatch(/needs 50 points.*make 30/);
        const both = applyMove(state, 'cookie', { type: 'meld', groups: [kings, sevens] });
        expect(both.ok).toBe(false); // 45 still short
        const withWild = table({ cookie: { hand: hand('K K K 2 5 6 7') } });
        const groups = [
            { rank: 'king' as const, cardIds: idsOf(withWild.players.cookie.hand.filter(c => c.rank === 'king' || c.rank === '2')) },
        ];
        expect(applyMove(withWild, 'cookie', { type: 'meld', groups }).ok).toBe(true);
    });

    it('uses a higher minimum for a higher score', () => {
        const state = table({
            cookie: { hand: hand('A A A K 5 6 7') },
            totals: { cookie: 3000, computer: 0 },
        });
        const groups = [{ rank: 'ace' as const, cardIds: rankIds(state.players.cookie, 'ace') }];
        const result = applyMove(state, 'cookie', { type: 'meld', groups });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/120/);
    });

    it('applies no minimum once a meld is down', () => {
        const state = table({ cookie: { hand: hand('4 4 4 5 6 7'), melds: [meldOf('king', 'K K K')] } });
        const groups = [{ rank: '4' as const, cardIds: rankIds(state.players.cookie, '4') }];
        expect(applyMove(state, 'cookie', { type: 'meld', groups }).ok).toBe(true);
    });

    it('finds the cheapest meld that reaches a minimum', () => {
        const cards = hand('A A A K K K 2 joker 5 6');
        const groups = findMinimumMeld(cards, 50);
        expect(groups).not.toBeNull();
        expect(groups).toHaveLength(1); // the aces alone make 60, no wilds spent
        expect(groups![0].rank).toBe('ace');
    });

    it('spends a wild only when it has to', () => {
        const groups = findMinimumMeld(hand('K K K 2 5 6 9'), 50);
        expect(groups).toHaveLength(1);
        expect(groups![0].cardIds).toHaveLength(4);
        expect(findMinimumMeld(hand('K K 2 5 6 9'), 50)).toBeNull(); // 40 points at best
    });
});

describe('taking the pile', () => {
    const melded = [meldOf('queen', 'Q Q Q')];

    it('is allowed with two naturals when the pile is not frozen', () => {
        const state = table({
            phase: 'draw',
            discard: '9 K',
            cookie: { hand: hand('K K 5 6'), melds: melded },
        });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        const meld = next.players.cookie.melds.find(m => m.rank === 'king')!;
        expect(meld.cards).toHaveLength(3);
        expect(next.discard).toHaveLength(0);
        expect(next.frozen).toBe(false);
        expect(next.phase).toBe('play');
        expect(next.players.cookie.hand.map(c => c.rank).sort()).toEqual(['5', '6', '9']);
    });

    it('is allowed with one natural and a wild when not frozen', () => {
        const state = table({ phase: 'draw', discard: '9 K', cookie: { hand: hand('K 2 5 6'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok && plan.value.usesWild).toBe(true);
    });

    it('is allowed by adding the top card to a meld, when not frozen', () => {
        const state = table({ phase: 'draw', discard: '9 Q', cookie: { hand: hand('5 6 7'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.value.cards).toHaveLength(0);
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        expect(next.players.cookie.melds[0].cards).toHaveLength(4);
    });

    it('is refused without matching cards', () => {
        const state = table({ phase: 'draw', discard: '9 K', cookie: { hand: hand('5 6 7'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.reason).toMatch(/kings/);
    });

    it('when frozen, will only do with two naturals', () => {
        const base = { phase: 'draw' as const, discard: '2 9 K', frozen: true };
        const pair = table({ ...base, cookie: { hand: hand('K K 5'), melds: melded } });
        const planned = planTake(pair, 'cookie');
        expect(planned.ok).toBe(true);
        const wild = table({ ...base, cookie: { hand: hand('K 2 5'), melds: melded } });
        const wildPlan = planTake(wild, 'cookie');
        expect(wildPlan.ok).toBe(false);
        if (!wildPlan.ok) expect(wildPlan.reason).toMatch(/frozen/);
        // Holding a meld of that rank does not help while it is frozen.
        const meld = table({
            phase: 'draw',
            discard: '2 9 Q',
            frozen: true,
            cookie: { hand: hand('5 6 7'), melds: melded },
        });
        expect(planTake(meld, 'cookie').ok).toBe(false);
    });

    it('is frozen for a player with no melds, even when frozen for nobody else', () => {
        const state = table({ phase: 'draw', discard: 'A', cookie: { hand: hand('A 2 joker 5 6') } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.reason).toMatch(/first meld/);
    });

    it('counts only the top card and cards from the hand toward the first meld', () => {
        // Top ace 20 + two aces 40 = 60, enough for 50.
        const enough = table({ phase: 'draw', discard: 'joker joker A', cookie: { hand: hand('A A 5 6') } });
        expect(planTake(enough, 'cookie').ok).toBe(true);
        // Top king 10 + two kings 20 = 30: the jokers lower down do not count.
        const short = table({ phase: 'draw', discard: 'joker joker K', cookie: { hand: hand('K K 5 6') } });
        const plan = planTake(short, 'cookie');
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.reason).toMatch(/needs 50 points.*only 30/);
    });

    it('may bring more cards from the hand to reach the first-meld minimum', () => {
        const state = table({ phase: 'draw', discard: '9 K', cookie: { hand: hand('K K 7 A A A 5') } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        expect(next.players.cookie.melds.map(m => m.rank).sort()).toEqual(['ace', 'king']);
    });

    it('is blocked by a black three on top for the very next turn only', () => {
        const state = table({ phase: 'draw', discard: '9 9 3c', cookie: { hand: hand('3c 3s 5 6'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.reason).toMatch(/black three/);

        // Once a card covers it the pile can be taken again.
        const covered = table({ phase: 'draw', discard: '9 3c K', cookie: { hand: hand('K K 5 6'), melds: melded } });
        expect(planTake(covered, 'cookie').ok).toBe(true);
    });

    it('is blocked by a wild on top', () => {
        const state = table({ phase: 'draw', discard: '9 2', frozen: true, cookie: { hand: hand('2 2 5'), melds: melded } });
        expect(planTake(state, 'cookie').ok).toBe(false);
    });

    it('unfreezes the pile once taken', () => {
        const state = table({ phase: 'draw', discard: '2 9 K', frozen: true, cookie: { hand: hand('K K 5'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        expect(next.frozen).toBe(false);
        expect(next.players.cookie.hand.some(isWild)).toBe(true);
    });

    it('freezes when a wild is discarded', () => {
        const state = table({ cookie: { hand: hand('2 5 6'), melds: melded } });
        const wildId = rankIds(state.players.cookie, '2')[0];
        const next = must(applyMove(state, 'cookie', { type: 'discard', cardId: wildId }));
        expect(next.frozen).toBe(true);
    });

    it('stays frozen under later discards', () => {
        const state = table({ discard: '2 9', frozen: true, cookie: { hand: hand('5 6'), melds: melded } });
        const next = must(applyMove(state, 'cookie', { type: 'discard', cardId: rankIds(state.players.cookie, '5')[0] }));
        expect(next.frozen).toBe(true);
    });

    it('will not take the pile if it leaves no card to discard', () => {
        const state = table({ phase: 'draw', discard: 'K', cookie: { hand: hand('K K'), melds: melded } });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(false);
        if (!plan.ok) expect(plan.reason).toMatch(/Keep a card/);
    });

    it('honours the cards a player chose', () => {
        const state = table({ phase: 'draw', discard: '9 K', cookie: { hand: hand('K K 2 5 6'), melds: melded } });
        const player = state.players.cookie;
        const natural = player.hand.find(c => c.rank === 'king')!;
        const wild = player.hand.find(c => c.rank === '2')!;
        const plan = planTakeWith(state, 'cookie', [natural, wild]);
        expect(plan.ok && plan.value.usesWild).toBe(true);
        const stray = planTakeWith(state, 'cookie', [player.hand.find(c => c.rank === '5')!]);
        expect(stray.ok).toBe(false);
    });

    it('brings the matching pair along when she has only chosen the extras', () => {
        const state = table({ phase: 'draw', discard: '9 K', cookie: { hand: hand('K K 7 A A A 5') } });
        const player = state.players.cookie;
        const plan = planTakeWith(state, 'cookie', player.hand.filter(c => c.rank === 'ace'));
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        expect(next.players.cookie.melds.map(m => m.rank).sort()).toEqual(['ace', 'king']);
    });
});

describe('red threes', () => {
    it('are laid down and replaced when drawn', () => {
        const state = table({ phase: 'draw', stock: '4 5 6 3h', cookie: { hand: hand('K Q') } });
        const next = must(applyMove(state, 'cookie', { type: 'draw' }));
        expect(next.players.cookie.redThrees).toHaveLength(1);
        expect(next.players.cookie.hand).toHaveLength(4);
        expect(next.players.cookie.hand.some(isRedThree)).toBe(false);
        expect(next.stock).toHaveLength(1);
    });

    it('are laid without replacement when the last stock card', () => {
        const state = table({ phase: 'draw', stock: '3h', cookie: { hand: hand('K Q') } });
        const next = must(applyMove(state, 'cookie', { type: 'draw' }));
        expect(next.players.cookie.redThrees).toHaveLength(1);
        expect(next.players.cookie.hand).toHaveLength(2);
        expect(next.stock).toHaveLength(0);
        expect(next.phase).toBe('play'); // the turn goes on
    });

    it('are laid but not replaced when inside a taken pile', () => {
        const state = table({
            phase: 'draw',
            discard: '3h 9 K',
            stock: '4 5',
            cookie: { hand: hand('K K 5 6'), melds: [meldOf('queen', 'Q Q Q')] },
        });
        const plan = planTake(state, 'cookie');
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const next = must(applyMove(state, 'cookie', { type: 'take', groups: plan.value.groups }));
        expect(next.players.cookie.redThrees).toHaveLength(1);
        expect(next.stock).toHaveLength(2);
        expect(next.players.cookie.hand.some(isRedThree)).toBe(false);
    });

    it('score 100 each, 800 for all four, and count against a player with no meld', () => {
        const three = (count: number, melds: Meld[] = []) =>
            scoreSeat(
                table({
                    cookie: { redThrees: fresh(['3h', '3h', '3d', '3d'].slice(0, count).join(' '), 5), melds },
                    phase: 'over',
                }),
                'cookie',
            ).redThrees;
        const melded = [meldOf('king', 'K K K')];
        expect(three(1, melded)).toBe(100);
        expect(three(3, melded)).toBe(300);
        expect(three(4, melded)).toBe(800);
        expect(three(1)).toBe(-100);
        expect(three(4)).toBe(-800);
        expect(three(0)).toBeCloseTo(0);
    });
});

describe('black threes', () => {
    it('cannot be melded except when going out', () => {
        const state = table({
            cookie: { hand: hand('3c 3c 3s 5 6 7'), melds: [meldOf('king', 'K K K K K K K'), meldOf('ace', 'A A A A A A A')] },
        });
        const groups = [{ rank: '3' as const, cardIds: rankIds(state.players.cookie, '3') }];
        const result = applyMove(state, 'cookie', { type: 'meld', groups });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/turn you go out/);
    });

    it('can go down three together as part of going out', () => {
        const state = table({
            cookie: { hand: hand('3c 3c 3s'), melds: [meldOf('king', 'K K K K K K K'), meldOf('ace', 'A A A A A A A')] },
        });
        const plan = goingOutPlan(state, 'cookie');
        expect(plan).not.toBeNull();
        const next = must(applyMove(state, 'cookie', { type: 'goOut' }));
        expect(next.phase).toBe('over');
        expect(next.players.cookie.melds).toHaveLength(3);
    });
});

describe('going out', () => {
    const two = () => [meldOf('king', 'K K K K K K K', 800), meldOf('ace', 'A A A A A A A', 810)];
    const one = () => [meldOf('king', 'K K K K K K K', 800), meldOf('ace', 'A A A', 810)];

    it('needs two canastas by default', () => {
        const short = table({ cookie: { hand: hand('Q Q Q 5'), melds: one() } });
        expect(goingOutPlan(short, 'cookie')).toBeNull();
        const enough = table({ cookie: { hand: hand('Q Q Q 5'), melds: two() } });
        expect(goingOutPlan(enough, 'cookie')).not.toBeNull();
    });

    it('needs one canasta when the setting says so', () => {
        const state = table({ needed: 1, cookie: { hand: hand('Q Q Q 5'), melds: one() } });
        expect(goingOutPlan(state, 'cookie')).not.toBeNull();
    });

    it('counts a canasta made on the way out', () => {
        const melds = [meldOf('king', 'K K K K K K K', 800), meldOf('ace', 'A A A A A A', 810)];
        const state = table({ cookie: { hand: hand('A'), melds } });
        const plan = goingOutPlan(state, 'cookie');
        expect(plan).not.toBeNull();
        const next = must(applyMove(state, 'cookie', { type: 'goOut' }));
        expect(next.phase).toBe('over');
        expect(countCanastas(next.players.cookie.melds)).toBe(2);
    });

    it('goes out with a final discard, or without one', () => {
        const withCard = table({ cookie: { hand: hand('Q Q Q 5'), melds: two() } });
        const plan = goingOutPlan(withCard, 'cookie');
        expect(plan?.discard).toBeTruthy();
        const after = must(applyMove(withCard, 'cookie', { type: 'goOut' }));
        expect(after.wentOut).toBe('cookie');
        expect(after.players.cookie.hand).toHaveLength(0);
        expect(after.discard).toHaveLength(1);

        const without = table({ cookie: { hand: hand('Q Q Q'), melds: two() } });
        const out = must(applyMove(without, 'cookie', { type: 'goOut' }));
        expect(out.wentOut).toBe('cookie');
        expect(out.discard).toHaveLength(0);
    });

    it('is refused when a card has nowhere to go', () => {
        const state = table({ cookie: { hand: hand('Q 9 5'), melds: two() } });
        expect(goingOutPlan(state, 'cookie')).toBeNull();
        expect(applyMove(state, 'cookie', { type: 'goOut' }).ok).toBe(false);
    });

    it('will not let a meld leave nothing to discard without the canastas', () => {
        const state = table({ cookie: { hand: hand('Q Q Q 5'), melds: one() } });
        const groups = [{ rank: 'queen' as const, cardIds: rankIds(state.players.cookie, 'queen') }];
        const result = checkMeld(state, 'cookie', groups);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/Keep a card/);
    });

    it('ends the hand by discarding the last card, with the canastas', () => {
        const state = table({ cookie: { hand: hand('5'), melds: two() } });
        const next = must(applyMove(state, 'cookie', { type: 'discard', cardId: state.players.cookie.hand[0].id }));
        expect(next.phase).toBe('over');
        expect(next.wentOut).toBe('cookie');
    });

    it('calls a whole hand melded at once with a canasta concealed', () => {
        const state = table({ needed: 1, cookie: { hand: hand('K K K K K K K A A A 5') } });
        expect(state.meldedAtTurnStart).toBe(false);
        const next = must(applyMove(state, 'cookie', { type: 'goOut' }));
        expect(next.concealed).toBe(true);
        expect(scoreSeat(next, 'cookie').goingOut).toBe(200);
    });

    it('does not call it concealed after an earlier meld', () => {
        const state = table({ needed: 1, cookie: { hand: hand('A A A'), melds: [meldOf('king', 'K K K K K K K')] } });
        const next = must(applyMove(state, 'cookie', { type: 'goOut' }));
        expect(next.concealed).toBe(false);
        expect(scoreSeat(next, 'cookie').goingOut).toBe(100);
    });

    it('holds a concealed hand to the first-meld minimum', () => {
        const state = table({
            needed: 1,
            totals: { cookie: 3000, computer: 0 },
            cookie: { hand: hand('4 4 4 4 4 4 4 5') },
        });
        // 35 points of fours against a minimum of 120.
        expect(goingOutPlan(state, 'cookie')).toBeNull();
    });

    it('prefers to keep a natural canasta natural when placing a wild', () => {
        const melds = [meldOf('king', 'K K K K K K K', 800), meldOf('ace', 'A A A A A A A', 810), meldOf('queen', 'Q Q Q', 820)];
        const state = table({ cookie: { hand: hand('2 5'), melds } });
        const plan = goingOutPlan(state, 'cookie');
        expect(plan?.groups[0].rank).toBe('queen');
    });
});

describe('the stock running out', () => {
    it('ends the hand when the next player cannot take the pile', () => {
        const state = table({
            stock: '',
            cookie: { hand: hand('5 6'), melds: [meldOf('king', 'K K K')] },
            computer: { hand: hand('9 9 J') },
        });
        const next = must(applyMove(state, 'cookie', { type: 'discard', cardId: rankIds(state.players.cookie, '5')[0] }));
        expect(next.phase).toBe('over');
        expect(next.ending).toBe('stock');
        expect(next.wentOut).toBeNull();
        expect(scoreSeat(next, 'cookie').goingOut).toBe(0);
    });

    it('plays on while the next player can take the pile', () => {
        const state = table({
            stock: '',
            cookie: { hand: hand('5 6'), melds: [meldOf('king', 'K K K')] },
            computer: { hand: hand('9 J Q'), melds: [meldOf('5', '5 5 5')] },
        });
        const next = must(applyMove(state, 'cookie', { type: 'discard', cardId: rankIds(state.players.cookie, '5')[0] }));
        expect(next.phase).toBe('draw');
        expect(next.turn).toBe('computer');
    });

    it('will not draw from an empty stock', () => {
        const state = table({ stock: '', phase: 'draw', discard: '9 9', cookie: { hand: hand('9 9 5'), melds: [meldOf('king', 'K K K')] } });
        expect(applyMove(state, 'cookie', { type: 'draw' }).ok).toBe(false);
    });

    it('ends without a bonus if the last card must go with no canastas', () => {
        const state = table({ stock: '3h', phase: 'draw', cookie: { hand: hand('5') } });
        const drawn = must(applyMove(state, 'cookie', { type: 'draw' }));
        const next = must(applyMove(drawn, 'cookie', { type: 'discard', cardId: drawn.players.cookie.hand[0].id }));
        expect(next.phase).toBe('over');
        expect(next.ending).toBe('stuck');
        expect(next.wentOut).toBeNull();
    });
});

describe('scoring a hand', () => {
    it('adds canastas, going out, red threes and melded cards, less what is in hand', () => {
        const natural = meldOf('king', 'K K K K K K K', 700); // 500 + 70
        const mixed = meldOf('ace', 'A A A A A A 2', 710); // 300 + 140
        const state: HandState = {
            ...table({
                cookie: { hand: [], melds: [natural, mixed], redThrees: fresh('3h', 720) },
                computer: { hand: hand('joker 9 4 3c'), melds: [meldOf('5', '5 5 5', 730)], redThrees: fresh('3d 3d', 740) },
            }),
            phase: 'over',
            wentOut: 'cookie',
            ending: 'out',
            concealed: false,
        };
        const scores = scoreHand(state);
        expect(scores.cookie).toEqual({
            canastas: 800,
            redThrees: 100,
            goingOut: 100,
            melded: 70 + 140,
            inHand: 0,
            total: 800 + 100 + 100 + 210,
        });
        expect(scores.computer).toEqual({
            canastas: 0,
            redThrees: 200,
            goingOut: 0,
            melded: 15,
            inHand: 50 + 10 + 5 + 5,
            total: 200 + 15 - 70,
        });
    });

    it('can go negative', () => {
        const state: HandState = {
            ...table({ cookie: { hand: hand('joker joker'), redThrees: fresh('3h', 5) } }),
            phase: 'over',
        };
        expect(scoreSeat(state, 'cookie').total).toBe(-200);
    });
});

describe('the match', () => {
    it('ends when someone reaches 5000, and the higher total wins', () => {
        expect(matchWinner({ cookie: 4995, computer: 4000 })).toBeNull();
        expect(matchWinner({ cookie: 5000, computer: 4000 })).toBe('cookie');
        expect(matchWinner({ cookie: 5200, computer: 5400 })).toBe('computer');
        expect(matchWinner({ cookie: 5200, computer: 5200 })).toBeNull();
    });
});

describe('turn order', () => {
    it('refuses to play out of turn or out of phase', () => {
        const state = dealHand({ seed: 3 });
        expect(applyMove(state, 'computer', { type: 'draw' }).ok).toBe(false);
        expect(applyMove(state, 'cookie', { type: 'discard', cardId: state.players.cookie.hand[0].id }).ok).toBe(false);
        const drawn = must(applyMove(state, 'cookie', { type: 'draw' }));
        expect(applyMove(drawn, 'cookie', { type: 'draw' }).ok).toBe(false);
    });

    it('draws two cards and passes the turn after a discard', () => {
        const state = table({ phase: 'draw', stock: '4 5 6 7', cookie: { hand: hand('K Q') } });
        const drawn = must(applyMove(state, 'cookie', { type: 'draw' }));
        expect(drawn.players.cookie.hand).toHaveLength(4);
        const next = must(applyMove(drawn, 'cookie', { type: 'discard', cardId: drawn.players.cookie.hand[0].id }));
        expect(next.turn).toBe('computer');
        expect(next.phase).toBe('draw');
    });

    it('recognises black threes', () => {
        expect(isBlackThree(makeCards('3c')[0])).toBe(true);
        expect(isBlackThree(makeCards('3h')[0])).toBe(false);
    });
});

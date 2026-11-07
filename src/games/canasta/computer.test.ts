import { describe, expect, it } from 'vitest';
import { buildDoubleDeck, turned, type PlayingCard } from '../shared/cards';
import { chooseMove, computerMove, discardCost, redacted } from './computer';
import {
    DECK_SIZE,
    MAX_WILDS,
    allCards,
    applyMove,
    countCanastas,
    dealHand,
    goingOutPlan,
    isBlackThree,
    isNatural,
    isRedThree,
    isWild,
    matchWinner,
    meldProblem,
    otherSeat,
    planTake,
    scoreHand,
    type HandState,
    type Meld,
    type MeldRank,
    type Move,
    type Player,
    type Seat,
} from './rules';

/** Everything that must be true of the table after any move at all. */
const assertSound = (state: HandState, context: string) => {
    const cards = allCards(state);
    expect(cards.length, context).toBe(DECK_SIZE);
    expect(new Set(cards.map(card => card.id)).size, context).toBe(DECK_SIZE);

    for (const seat of ['cookie', 'computer'] as Seat[]) {
        const player = state.players[seat];
        expect(player.hand.some(isRedThree), context).toBe(false);
        expect(player.redThrees.every(isRedThree), context).toBe(true);

        const ranks = player.melds.map(meld => meld.rank);
        expect(new Set(ranks).size, context).toBe(ranks.length);
        for (const meld of player.melds) {
            expect(meldProblem(meld.rank, meld.cards), `${context}: ${meld.rank}`).toBeNull();
            expect(meld.cards.filter(isWild).length, context).toBeLessThanOrEqual(MAX_WILDS);
            expect(meld.cards.filter(isNatural).length, context).toBeGreaterThanOrEqual(2);
            expect(meld.cards.every(card => card.isFaceUp), context).toBe(true);
            if (meld.rank === '3') expect(state.phase, context).toBe('over');
        }
        if (state.phase !== 'over' && !(seat === state.turn && state.phase === 'play')) {
            expect(player.hand.length, `${context}: a hand with nothing in it`).toBeGreaterThan(0);
        }
    }

    const top = state.discard[state.discard.length - 1];
    if (top) expect(isRedThree(top), context).toBe(false);
    if (state.discard.some(isWild)) expect(state.frozen, context).toBe(true);
    if (state.phase === 'draw' && state.stock.length === 0) {
        expect(planTake(state, state.turn).ok, `${context}: stuck at an empty stock`).toBe(true);
    }
};

interface Played {
    state: HandState;
    moves: number;
    taken: number;
    meldCount: number;
}

const playOut = (seed: number, options: { totals?: Record<Seat, number>; needed?: number; first?: Seat } = {}): Played => {
    let state = dealHand({ seed, startTotals: options.totals, canastasNeeded: options.needed, first: options.first });
    assertSound(state, `seed ${seed}, deal`);
    let moves = 0;
    let taken = 0;
    let meldCount = 0;
    while (state.phase !== 'over') {
        moves++;
        if (moves > 3000) throw new Error(`seed ${seed} never finished`);
        const seat = state.turn;
        const move = computerMove(state, seat);
        const context = `seed ${seed}, move ${moves}, ${seat} ${move.type}`;
        const result = applyMove(state, seat, move);
        if (!result.ok) throw new Error(`${context}: illegal: ${result.reason}`);
        state = result.value;
        if (move.type === 'take') taken++;
        if (move.type === 'meld') meldCount++;
        assertSound(state, context);
    }
    return { state, moves, taken, meldCount };
};

describe('the computer against itself', () => {
    it('plays fifty hands to the end with every card accounted for and nothing illegal', () => {
        let wentOut = 0;
        let ranOut = 0;
        let takes = 0;
        let melds = 0;
        for (let seed = 1; seed <= 50; seed++) {
            const { state, taken, meldCount } = playOut(seed * 7919);
            if (state.ending === 'out') wentOut++;
            if (state.ending === 'stock') ranOut++;
            takes += taken;
            melds += meldCount;
            const scores = scoreHand(state);
            expect(Number.isFinite(scores.cookie.total)).toBe(true);
            expect(Number.isFinite(scores.computer.total)).toBe(true);
        }
        // Not just shuffling cards round: it melds, takes piles and finishes hands.
        expect(wentOut + ranOut).toBe(50);
        expect(wentOut).toBeGreaterThan(0);
        expect(takes).toBeGreaterThan(25);
        expect(melds).toBeGreaterThan(100);
    }, 120_000);

    it('copes with every minimum and with the one-canasta rule', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const totals = [
                { cookie: -200, computer: 0 },
                { cookie: 1500, computer: 2000 },
                { cookie: 3200, computer: 4500 },
            ][seed % 3];
            playOut(seed * 104_729, { totals, needed: seed % 2 === 0 ? 1 : 2, first: seed % 2 === 0 ? 'computer' : 'cookie' });
        }
    }, 120_000);

    it('can play a whole match to five thousand', () => {
        let totals: Record<Seat, number> = { cookie: 0, computer: 0 };
        let hands = 0;
        let seed = 2024;
        while (matchWinner(totals) === null) {
            hands++;
            if (hands > 80) throw new Error('the match never ended');
            const { state } = playOut((seed = seed * 31 + 7), {
                totals,
                first: hands % 2 === 0 ? 'computer' : 'cookie',
            });
            const scores = scoreHand(state);
            totals = { cookie: totals.cookie + scores.cookie.total, computer: totals.computer + scores.computer.total };
        }
        expect(Math.max(totals.cookie, totals.computer)).toBeGreaterThanOrEqual(5000);
    }, 120_000);
});

describe('what the computer can see', () => {
    it('blanks out the stock and the other hand', () => {
        const state = dealHand({ seed: 41 });
        const seen = redacted(state, 'computer');
        expect(seen.stock).toHaveLength(state.stock.length);
        expect(seen.stock.every(card => card.id.startsWith('stock_'))).toBe(true);
        expect(seen.players.cookie.hand).toHaveLength(state.players.cookie.hand.length);
        expect(seen.players.cookie.hand.every(card => card.id.startsWith('hidden_'))).toBe(true);
        expect(seen.players.computer.hand).toEqual(state.players.computer.hand);
    });

    it('decides the same whatever the secrets are', () => {
        for (let seed = 1; seed <= 15; seed++) {
            let state = dealHand({ seed: seed * 613 });
            for (let step = 0; step < 150 && state.phase !== 'over'; step++) {
                const seat = state.turn;
                const other = otherSeat(seat);
                // Swap the stock with the other hand's cards in a different order: all hidden.
                const mixed = [...state.stock, ...state.players[other].hand].reverse();
                const otherSize = state.players[other].hand.length;
                const swapped: HandState = {
                    ...state,
                    stock: mixed.slice(otherSize),
                    players: {
                        ...state.players,
                        [other]: { ...state.players[other], hand: mixed.slice(0, otherSize) },
                    },
                };
                const move = computerMove(state, seat);
                expect(computerMove(swapped, seat)).toEqual(move);
                state = (applyMove(state, seat, move) as { ok: true; value: HandState }).value;
            }
        }
    });
});

// A few positions, to see that it plays sensibly.

const CARD_WORDS: Record<string, string> = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };
let tick = 0;
const cards = (spec: string): PlayingCard[] => {
    tick++;
    const deck = buildDoubleDeck(4);
    const counts = new Map<string, number>();
    return spec
        .split(' ')
        .filter(Boolean)
        .map(token => {
            const black = token === '3c';
            const rank = black ? '3' : (CARD_WORDS[token] ?? token);
            const pool = deck.filter(card => card.rank === rank && (!black || card.suit === 'clubs'));
            const at = counts.get(token) ?? 0;
            counts.set(token, at + 1);
            return { ...turned(pool[at % pool.length], true), id: `${token}_${at}_${tick}` };
        });
};

const meld = (rank: MeldRank, spec: string): Meld => ({ rank, cards: cards(spec) });

const player = (over: Partial<Player> = {}): Player => ({ hand: [], melds: [], redThrees: [], tookRanks: [], ...over });

const position = (over: {
    me?: Partial<Player>;
    them?: Partial<Player>;
    discard?: string;
    frozen?: boolean;
    phase?: HandState['phase'];
    stock?: number;
    needed?: number;
    totals?: Record<Seat, number>;
}): HandState => ({
    seed: 1,
    stock: cards(Array.from({ length: over.stock ?? 40 }, () => '4').join(' ')),
    discard: cards(over.discard ?? ''),
    frozen: over.frozen ?? false,
    players: { cookie: player(over.them), computer: player(over.me) },
    turn: 'computer',
    phase: over.phase ?? 'play',
    startTotals: over.totals ?? { cookie: 0, computer: 0 },
    canastasNeeded: over.needed ?? 2,
    meldedAtTurnStart: (over.me?.melds?.length ?? 0) > 0,
    ending: null,
    wentOut: null,
    concealed: false,
});

const choose = (state: HandState): Move => chooseMove(redacted(state, 'computer'), 'computer');

describe('how it plays', () => {
    const down = () => [meld('queen', 'Q Q Q')];

    it('takes a pile worth having, draws when it is not', () => {
        const pile = position({ phase: 'draw', discard: '9 8 K', me: { hand: cards('K K 5 6'), melds: down() } });
        expect(choose(pile).type).toBe('take');
        const small = position({ phase: 'draw', discard: 'K', me: { hand: cards('K K 5 6'), melds: down() } });
        expect(choose(small).type).toBe('draw');
    });

    it('takes even a small pile when it makes its first meld', () => {
        const state = position({ phase: 'draw', discard: 'A', me: { hand: cards('A A 5 6') } });
        expect(choose(state).type).toBe('take');
    });

    it('will not spend a wild for a small pile', () => {
        const state = position({ phase: 'draw', discard: '9 8 K', me: { hand: cards('K 2 5 6'), melds: down() } });
        expect(choose(state).type).toBe('draw');
    });

    it('makes its first meld keeping its wilds if it can', () => {
        const state = position({ me: { hand: cards('A A A 2 joker 6 7 8') } });
        const move = choose(state);
        expect(move.type).toBe('meld');
        if (move.type === 'meld') {
            expect(move.groups).toHaveLength(1);
            expect(move.groups[0].rank).toBe('ace');
            expect(move.groups[0].cardIds).toHaveLength(3);
        }
    });

    it('melds a natural triple once it is down', () => {
        const state = position({ me: { hand: cards('9 9 9 6 7'), melds: down() } });
        const move = choose(state);
        expect(move.type === 'meld' && move.groups[0].rank).toBe('9');
    });

    it('lays off naturals onto its melds', () => {
        const state = position({ me: { hand: cards('Q 6 7'), melds: down() } });
        const move = choose(state);
        expect(move.type === 'meld' && move.groups[0].rank).toBe('queen');
    });

    it('spends a wild to reach seven', () => {
        const state = position({ me: { hand: cards('2 6 7'), melds: [meld('queen', 'Q Q Q Q Q Q')] } });
        const move = choose(state);
        expect(move.type === 'meld' && move.groups[0].rank).toBe('queen');
    });

    it('keeps its wilds otherwise, while its hand is small', () => {
        const state = position({ me: { hand: cards('2 6 7'), melds: down() }, them: { hand: cards('5 5 5 5 5 5 5 5 5') } });
        expect(choose(state).type).toBe('discard');
    });

    it('spends wilds on pairs when its hand is large', () => {
        const state = position({
            me: { hand: cards('2 9 9 4 5 6 7 8 10 J K A'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5 5') },
        });
        const move = choose(state);
        expect(move.type === 'meld' && move.groups[0].rank).toBe('9');
    });

    it('goes out when it can and is ahead', () => {
        const melds = [meld('king', 'K K K K K K K'), meld('ace', 'A A A A A A A')];
        const state = position({ me: { hand: cards('Q Q Q 5'), melds }, them: { hand: cards('5 5 5 5 5 5 5 5 5') } });
        expect(goingOutPlan(state, 'computer')).not.toBeNull();
        expect(choose(state).type).toBe('goOut');
    });

    it('holds on when it is well behind and Cookie is not close, but not when she is', () => {
        const melds = [meld('king', 'K K K K K K K'), meld('4', '4 4 4 4 4 4 4')];
        const theirMelds = [meld('ace', 'A A A A A A A'), meld('queen', 'Q Q Q Q Q Q Q'), meld('jack', 'J J J J J J J')];
        const far = position({
            me: { hand: cards('9 9 9 5'), melds },
            them: { hand: cards('5 5 5 5 5 5 5 5 5 5'), melds: theirMelds },
            needed: 2,
            totals: { cookie: 2000, computer: 0 },
        });
        expect(choose(far).type).not.toBe('goOut');

        const close = position({
            me: { hand: cards('9 9 9 5'), melds },
            them: { hand: cards('5 5 5'), melds: theirMelds },
            needed: 2,
            totals: { cookie: 2000, computer: 0 },
        });
        expect(choose(close).type).toBe('goOut');
    });

    it('never discards a wild unless forced', () => {
        const state = position({ me: { hand: cards('2 joker 6'), melds: down() }, them: { hand: cards('5 5 5 5 5 5 5 5') } });
        const hand = state.players.computer.hand;
        const six = hand.find(card => card.rank === '6')!;
        expect(choose(state)).toEqual({ type: 'discard', cardId: six.id });

        const forced = position({ me: { hand: cards('2 joker'), melds: down() }, them: { hand: cards('5 5 5 5 5 5 5 5') } });
        const move = choose(forced);
        expect(move.type).toBe('discard');
    });

    it('freezes a large pile Cookie could take', () => {
        const state = position({
            discard: '9 8 7 6 5 4 K Q 9 8',
            me: { hand: cards('2 6 J'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5'), melds: [meld('ace', 'A A A')] },
        });
        const two = state.players.computer.hand.find(card => card.rank === '2')!;
        expect(choose(state)).toEqual({ type: 'discard', cardId: two.id });
    });

    it('does not freeze a pile already frozen, or one she cannot take', () => {
        const frozen = position({
            discard: '2 8 7 6 5 4 K Q 9 8',
            frozen: true,
            me: { hand: cards('2 6'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5'), melds: [meld('ace', 'A A A')] },
        });
        const wild = frozen.players.computer.hand.find(isWild)!;
        expect(discardCost(frozen, 'computer', wild)).toBeGreaterThan(100);
    });

    it('avoids the ranks Cookie has melded or taken', () => {
        const state = position({
            me: { hand: cards('A 7 J'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5'), melds: [meld('7', '7 7 7')], tookRanks: ['jack'] },
        });
        const ace = state.players.computer.hand.find(card => card.rank === 'ace')!;
        expect(choose(state)).toEqual({ type: 'discard', cardId: ace.id });
    });

    it('throws a black three on a valuable pile', () => {
        const state = position({
            discard: '9 8 7 6 5 4',
            me: { hand: cards('3c 5 6 7'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5') },
        });
        const three = state.players.computer.hand.find(isBlackThree)!;
        expect(choose(state)).toEqual({ type: 'discard', cardId: three.id });
    });

    it('throws its lowest singleton otherwise', () => {
        const state = position({
            me: { hand: cards('K 5 9 9'), melds: down() },
            them: { hand: cards('5 5 5 5 5 5 5 5') },
        });
        const five = state.players.computer.hand.find(card => card.rank === '5')!;
        expect(choose(state)).toEqual({ type: 'discard', cardId: five.id });
    });

    it('works toward canastas in self-play', () => {
        let canastas = 0;
        for (let seed = 1; seed <= 12; seed++) {
            const { state } = playOut(seed * 2_111);
            canastas += countCanastas(state.players.cookie.melds) + countCanastas(state.players.computer.melds);
        }
        expect(canastas).toBeGreaterThan(5);
    }, 60_000);
});

import type { PlayingCard } from '../shared/cards';
import {
    CANASTA_SIZE,
    MAX_WILDS,
    cardValue,
    cardsValue,
    canastaBonus,
    checkMeld,
    countCanastas,
    findMinimumMeld,
    goingOutPlan,
    isBlackThree,
    isCanasta,
    isNaturalCanasta,
    isWild,
    minimumFor,
    otherSeat,
    planTake,
    type HandState,
    type Meld,
    type MeldGroup,
    type MeldRank,
    type Move,
    type Player,
    type Seat,
} from './rules';

/**
 * The computer player: a sound heuristic that never looks at anything it should
 * not. It is handed a `redacted` copy of the table in which the stock and the
 * other player's hand are blank cards, so it plays honestly by construction, and
 * it decides one step at a time, so a saved game can pick up mid-turn.
 */

const PILE_WORTH_TAKING = 3;
const PILE_WORTH_A_WILD = 5;
const PILE_WORTH_BLOCKING = 5;
const PILE_WORTH_FREEZING = 8;
const LARGE_HAND = 12;

/** The table as this seat can see it: the stock and the other hand are blanks. */
export const redacted = (state: HandState, seat: Seat): HandState => {
    const other = otherSeat(seat);
    const blanks = (count: number, prefix: string): PlayingCard[] =>
        Array.from({ length: count }, (_, i) => ({
            id: `${prefix}_${i}`,
            rank: 'joker',
            suit: null,
            copy: i,
            isFaceUp: false,
        }));
    return {
        ...state,
        seed: 0,
        stock: blanks(state.stock.length, 'stock'),
        players: {
            ...state.players,
            [other]: { ...state.players[other], hand: blanks(state.players[other].hand.length, 'hidden') },
        },
    };
};

const ids = (cards: PlayingCard[]): string[] => cards.map(card => card.id);

const meldMove = (groups: MeldGroup[]): Move => ({ type: 'meld', groups });

const naturalsOf = (hand: PlayingCard[]): Map<MeldRank, PlayingCard[]> => {
    const groups = new Map<MeldRank, PlayingCard[]>();
    for (const card of hand) {
        if (isWild(card) || isBlackThree(card)) continue;
        const rank = card.rank as MeldRank;
        groups.set(rank, [...(groups.get(rank) ?? []), card]);
    }
    return groups;
};

const cheapestWilds = (hand: PlayingCard[]): PlayingCard[] =>
    hand.filter(isWild).sort((a, b) => cardValue(a) - cardValue(b));

const wildsIn = (meld: Meld): number => meld.cards.filter(isWild).length;

/** What the table says a player's melds are worth, before anything in their hand. */
const tableScore = (player: Player): number =>
    player.melds.reduce((sum, meld) => sum + canastaBonus(meld) + cardsValue(meld.cards), 0) +
    player.redThrees.length * 100;

// ------------------------------------------------------- draw or take the pile

const chooseDraw = (table: HandState, seat: Seat): Move => {
    const plan = planTake(table, seat);
    if (!plan.ok) return { type: 'draw' };
    if (table.stock.length === 0) return { type: 'take', groups: plan.value.groups };

    const firstMeld = table.players[seat].melds.length === 0;
    const size = table.discard.length;
    const worthwhile = firstMeld || size >= PILE_WORTH_TAKING;
    const tooDear = !firstMeld && plan.value.usesWild && size < PILE_WORTH_A_WILD;
    return worthwhile && !tooDear ? { type: 'take', groups: plan.value.groups } : { type: 'draw' };
};

// ----------------------------------------------------------- melds and lay-offs

const legal = (table: HandState, seat: Seat, groups: MeldGroup[]): boolean => checkMeld(table, seat, groups).ok;

const cookieLooksClose = (table: HandState, seat: Seat): boolean => {
    const other = table.players[otherSeat(seat)];
    return other.hand.length <= 4 || (countCanastas(other.melds) >= table.canastasNeeded && other.hand.length <= 7);
};

/** Natural triples of a new rank, the best ones first. */
const newNaturalMeld = (table: HandState, seat: Seat): MeldGroup[] | null => {
    const me = table.players[seat];
    const options = [...naturalsOf(me.hand).entries()]
        .filter(([rank, cards]) => cards.length >= 3 && !me.melds.some(meld => meld.rank === rank))
        .sort((a, b) => cardsValue(b[1]) - cardsValue(a[1]));
    for (const [rank, cards] of options) {
        const groups = [{ rank, cardIds: ids(cards) }];
        if (legal(table, seat, groups)) return groups;
    }
    return null;
};

const layOffNaturals = (table: HandState, seat: Seat): MeldGroup[] | null => {
    const me = table.players[seat];
    const naturals = naturalsOf(me.hand);
    // The meld nearest to a canasta first.
    const melds = [...me.melds].sort((a, b) => b.cards.length - a.cards.length);
    for (const meld of melds) {
        const cards = naturals.get(meld.rank);
        if (!cards) continue;
        const groups = [{ rank: meld.rank, cardIds: ids(cards) }];
        if (legal(table, seat, groups)) return groups;
    }
    return null;
};

/** Spend wilds where they turn a meld into a canasta. */
const wildsToReachSeven = (table: HandState, seat: Seat): MeldGroup[] | null => {
    const me = table.players[seat];
    const wilds = cheapestWilds(me.hand);
    if (wilds.length === 0) return null;
    const short = me.melds
        .filter(meld => !isCanasta(meld))
        .map(meld => ({ meld, need: CANASTA_SIZE - meld.cards.length }))
        .filter(({ meld, need }) => need <= wilds.length && wildsIn(meld) + need <= MAX_WILDS)
        .sort((a, b) => a.need - b.need);
    for (const { meld, need } of short) {
        const groups = [{ rank: meld.rank, cardIds: ids(wilds.slice(0, need)) }];
        if (legal(table, seat, groups)) return groups;
    }
    return null;
};

/** With a big hand, or when the other side is nearly out, wilds are better on the table. */
const wildsToShedCards = (table: HandState, seat: Seat): MeldGroup[] | null => {
    const me = table.players[seat];
    const wilds = cheapestWilds(me.hand);
    if (wilds.length === 0) return null;

    const pairs = [...naturalsOf(me.hand).entries()]
        .filter(([rank, cards]) => cards.length === 2 && !me.melds.some(meld => meld.rank === rank))
        .sort((a, b) => cardsValue(b[1]) - cardsValue(a[1]));
    for (const [rank, cards] of pairs) {
        const groups = [{ rank, cardIds: [...ids(cards), wilds[0].id] }];
        if (legal(table, seat, groups)) return groups;
    }

    // Natural canastas keep their 500; everything else may carry a wild.
    const hosts = me.melds
        .filter(meld => !isNaturalCanasta(meld) && wildsIn(meld) < MAX_WILDS)
        .sort((a, b) => b.cards.length - a.cards.length);
    for (const meld of hosts) {
        const groups = [{ rank: meld.rank, cardIds: [wilds[0].id] }];
        if (legal(table, seat, groups)) return groups;
    }
    return null;
};

const wantsToGoOut = (table: HandState, seat: Seat): boolean => {
    const me = table.players[seat];
    const them = table.players[otherSeat(seat)];
    const mine = table.startTotals[seat] + tableScore(me) + cardsValue(me.hand) + 100;
    const theirs = table.startTotals[otherSeat(seat)] + tableScore(them);
    return mine >= theirs || cookieLooksClose(table, seat) || table.stock.length <= 4;
};

// --------------------------------------------------------------------- discard

/** A lower number means a better card to throw away. */
export const discardCost = (table: HandState, seat: Seat, card: PlayingCard): number => {
    const me = table.players[seat];
    const them = table.players[otherSeat(seat)];
    const size = table.discard.length;

    if (isWild(card)) {
        // Only to freeze a large pile the other side could otherwise take.
        const freezes = size >= PILE_WORTH_FREEZING && !table.frozen && them.melds.length > 0;
        return freezes ? -100 + cardValue(card) : 1000 + cardValue(card);
    }
    if (isBlackThree(card)) {
        // A black three on top blocks the next turn, which matters when there is a lot to take.
        return size >= PILE_WORTH_BLOCKING && !table.frozen ? -50 : 12;
    }

    const copies = me.hand.filter(other => other.rank === card.rank).length;
    let cost = cardValue(card) + (copies - 1) * 15;
    if (me.melds.some(meld => meld.rank === card.rank)) cost += 40;
    // Do not feed the other side. A frozen pile is less of a gift, but still one.
    if (them.melds.some(meld => meld.rank === card.rank)) cost += table.frozen ? 60 : 200;
    if (them.tookRanks.includes(card.rank as MeldRank)) cost += table.frozen ? 40 : 100;
    return cost;
};

const chooseDiscard = (table: HandState, seat: Seat): Move => {
    const hand = table.players[seat].hand;
    let best = hand[0];
    let bestCost = Infinity;
    for (const card of hand) {
        const cost = discardCost(table, seat, card);
        if (cost < bestCost) {
            best = card;
            bestCost = cost;
        }
    }
    return { type: 'discard', cardId: best.id };
};

// ------------------------------------------------------------------- the turn

const choosePlay = (table: HandState, seat: Seat): Move => {
    const me = table.players[seat];

    if (goingOutPlan(table, seat) && wantsToGoOut(table, seat)) return { type: 'goOut' };

    if (me.melds.length === 0) {
        const first = findMinimumMeld(me.hand, minimumFor(table, seat));
        return first && legal(table, seat, first) ? meldMove(first) : chooseDiscard(table, seat);
    }

    const next =
        newNaturalMeld(table, seat) ??
        layOffNaturals(table, seat) ??
        wildsToReachSeven(table, seat) ??
        (me.hand.length >= LARGE_HAND || cookieLooksClose(table, seat) ? wildsToShedCards(table, seat) : null);
    return next ? meldMove(next) : chooseDiscard(table, seat);
};

/** The computer's next step, given only what it is allowed to see. */
export const chooseMove = (table: HandState, seat: Seat): Move =>
    table.phase === 'draw' ? chooseDraw(table, seat) : choosePlay(table, seat);

/** What the store calls: hides the secrets, then decides. */
export const computerMove = (state: HandState, seat: Seat): Move => chooseMove(redacted(state, seat), seat);

import type { Rank } from '../../types';
import { mulberry32 } from '../../utils/gameLogic';
import { buildDoubleDeck, isJoker, shuffled, turned, type PlayingCard } from '../shared/cards';

/**
 * The rules of classic two-handed Canasta, as pure functions. Nothing in here
 * knows about React or the screen: a move goes in with a state, and either a new
 * state comes out or a sentence in plain words saying why not. The table and the
 * computer player both go through `applyMove`, so neither can break a rule.
 */

export const SEATS = ['cookie', 'computer'] as const;
export type Seat = (typeof SEATS)[number];
export const otherSeat = (seat: Seat): Seat => (seat === 'cookie' ? 'computer' : 'cookie');

export const DECK_JOKERS = 4;
export const DECK_SIZE = 108;
export const HAND_SIZE = 15;
export const DRAW_COUNT = 2;
export const CANASTA_SIZE = 7;
export const MAX_WILDS = 3;
export const MATCH_TARGET = 5000;
/** How many canastas a player needs before they may go out. A setting: 1 or 2. */
export const DEFAULT_CANASTAS_TO_GO_OUT = 2;

export const NATURAL_CANASTA_BONUS = 500;
export const MIXED_CANASTA_BONUS = 300;
export const GOING_OUT_BONUS = 100;
export const CONCEALED_BONUS = 200;
export const RED_THREE_VALUE = 100;
export const ALL_RED_THREES_VALUE = 800;

/** Twos are wild and cannot have a meld of their own. */
export type MeldRank = Exclude<Rank, '2'>;

export interface Meld {
    rank: MeldRank;
    cards: PlayingCard[];
}

export interface Player {
    hand: PlayingCard[];
    melds: Meld[];
    redThrees: PlayingCard[];
    /** Ranks seen going into this hand with a taken pile. Everyone saw them. */
    tookRanks: Rank[];
}

export type Phase = 'draw' | 'play' | 'over';
export type HandEnding = 'out' | 'stock' | 'stuck';

export interface HandState {
    seed: number;
    /** The last card is the top of the stock. */
    stock: PlayingCard[];
    /** The last card is the top of the pile. */
    discard: PlayingCard[];
    /** Frozen for both players, until somebody takes the pile. */
    frozen: boolean;
    players: Record<Seat, Player>;
    turn: Seat;
    phase: Phase;
    /** Match totals when this hand began, which set each player's first-meld minimum. */
    startTotals: Record<Seat, number>;
    canastasNeeded: number;
    /** Had the player to move melded before this turn? A concealed hand has not. */
    meldedAtTurnStart: boolean;
    ending: HandEnding | null;
    wentOut: Seat | null;
    concealed: boolean;
}

/** Cards from a hand that go down together, onto a new or an existing meld of that rank. */
export interface MeldGroup {
    rank: MeldRank;
    cardIds: string[];
}

export type Move =
    | { type: 'draw' }
    /** The group for the top card's rank holds only the cards from the hand; the top joins it by itself. */
    | { type: 'take'; groups: MeldGroup[] }
    | { type: 'meld'; groups: MeldGroup[] }
    | { type: 'discard'; cardId: string }
    | { type: 'goOut' };

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };
const yes = <T>(value: T): Verdict<T> => ({ ok: true, value });
const no = <T>(reason: string): Verdict<T> => ({ ok: false, reason });

// ---------------------------------------------------------------- the cards

export const isWild = (card: PlayingCard): boolean => isJoker(card) || card.rank === '2';
export const isNatural = (card: PlayingCard): boolean => !isWild(card);
export const isRedThree = (card: PlayingCard): boolean =>
    card.rank === '3' && (card.suit === 'hearts' || card.suit === 'diamonds');
export const isBlackThree = (card: PlayingCard): boolean =>
    card.rank === '3' && (card.suit === 'clubs' || card.suit === 'spades');

export const cardValue = (card: PlayingCard): number => {
    switch (card.rank) {
        case 'joker':
            return 50;
        case '2':
        case 'ace':
            return 20;
        case 'king':
        case 'queen':
        case 'jack':
        case '10':
        case '9':
        case '8':
            return 10;
        default:
            return 5;
    }
};

export const cardsValue = (cards: PlayingCard[]): number => cards.reduce((sum, card) => sum + cardValue(card), 0);

/** The points a first meld has to reach, from a player's total when the hand began. */
export const initialMinimum = (total: number): number => {
    if (total < 0) return 15;
    if (total < 1500) return 50;
    if (total < 3000) return 90;
    return 120;
};

export const minimumFor = (state: HandState, seat: Seat): number => initialMinimum(state.startTotals[seat]);

const RANK_WORDS: Record<string, [string, string]> = {
    ace: ['ace', 'aces'],
    king: ['king', 'kings'],
    queen: ['queen', 'queens'],
    jack: ['jack', 'jacks'],
    '10': ['ten', 'tens'],
    '9': ['nine', 'nines'],
    '8': ['eight', 'eights'],
    '7': ['seven', 'sevens'],
    '6': ['six', 'sixes'],
    '5': ['five', 'fives'],
    '4': ['four', 'fours'],
    '3': ['black three', 'black threes'],
    '2': ['two', 'twos'],
    joker: ['joker', 'jokers'],
};
export const rankWord = (rank: string): string => RANK_WORDS[rank]?.[0] ?? rank;
export const rankWords = (rank: string): string => RANK_WORDS[rank]?.[1] ?? rank;

// --------------------------------------------------------------------- melds

export const isCanasta = (meld: Meld): boolean => meld.cards.length >= CANASTA_SIZE;
export const isNaturalCanasta = (meld: Meld): boolean => isCanasta(meld) && !meld.cards.some(isWild);
export const canastaBonus = (meld: Meld): number =>
    !isCanasta(meld) ? 0 : isNaturalCanasta(meld) ? NATURAL_CANASTA_BONUS : MIXED_CANASTA_BONUS;
export const countCanastas = (melds: Meld[]): number => melds.filter(isCanasta).length;

/** What is wrong with these cards as a meld of this rank, or null when they are fine. */
export const meldProblem = (rank: Rank, cards: PlayingCard[]): string | null => {
    const naturals = cards.filter(isNatural);
    const wilds = cards.filter(isWild);
    if (rank === '2') return 'Twos are wild cards, so they cannot have a meld of their own.';
    if (naturals.some(card => card.rank !== rank)) return 'A meld is all one rank, plus any wild cards.';
    if (rank === '3') {
        if (naturals.some(isRedThree)) return 'Red threes are never melded.';
        if (wilds.length > 0) return 'Black threes cannot go down with wild cards.';
        if (cards.length < 3 || cards.length > 4) return 'Black threes go down three or four together.';
        return null;
    }
    if (cards.length < 3) return 'A meld needs at least three cards.';
    if (naturals.length < 2) return 'A meld needs at least two cards that are not wild.';
    if (wilds.length > MAX_WILDS) return 'A meld can hold at most three wild cards.';
    return null;
};

/** Cards of one rank apart from wilds, keyed by rank, in the order they appear. */
const naturalsByRank = (cards: PlayingCard[]): Map<MeldRank, PlayingCard[]> => {
    const groups = new Map<MeldRank, PlayingCard[]>();
    for (const card of cards) {
        if (isWild(card)) continue;
        const rank = card.rank as MeldRank;
        const group = groups.get(rank);
        if (group) group.push(card);
        else groups.set(rank, [card]);
    }
    return groups;
};

/** Cheapest first, so that a joker is the last wild anyone gives up. */
const byValue = (cards: PlayingCard[]): PlayingCard[] => [...cards].sort((a, b) => cardValue(a) - cardValue(b));

export interface MeldCheck {
    melds: Meld[];
    hand: PlayingCard[];
    points: number;
}

/**
 * Whether a player may put these groups down, and what the table looks like if
 * they do. `top` is the pile's top card when the groups are taking the pile, and
 * `incoming` how many more cards are about to arrive in the hand with it.
 */
export const checkMeld = (
    state: HandState,
    seat: Seat,
    groups: MeldGroup[],
    top?: PlayingCard,
    incoming = 0,
): Verdict<MeldCheck> => {
    const player = state.players[seat];
    const hand = [...player.hand];
    const melds = [...player.melds];
    let points = 0;

    if (groups.length === 0 && !top) return no('Tap the cards you want to meld first.');

    const ranks = new Set<MeldRank>();
    for (const group of groups) {
        if (ranks.has(group.rank)) return no('One meld per rank.');
        ranks.add(group.rank);

        const cards: PlayingCard[] = [];
        for (const id of group.cardIds) {
            const at = hand.findIndex(card => card.id === id);
            if (at < 0) return no('That card is not in your hand.');
            cards.push(hand[at]);
            hand.splice(at, 1);
        }
        if (top && top.rank === group.rank) cards.push(top);
        points += cardsValue(cards);

        const at = melds.findIndex(meld => meld.rank === group.rank);
        const combined = at >= 0 ? [...melds[at].cards, ...cards] : cards;
        const problem = meldProblem(group.rank, combined);
        if (problem) return no(problem);
        const meld: Meld = { rank: group.rank, cards: combined.map(card => turned(card, true)) };
        if (at >= 0) melds[at] = meld;
        else melds.push(meld);
    }
    if (top && !ranks.has(top.rank as MeldRank)) return no('The top card of the pile has to go down at once.');

    if (player.melds.length === 0) {
        const minimum = minimumFor(state, seat);
        if (points < minimum) {
            return no(`Your first meld needs ${minimum} points. These cards make ${points}.`);
        }
    }

    // A hand can only shrink to nothing by going out, and that takes canastas.
    const canastas = countCanastas(melds);
    const cardsLeft = hand.length + incoming;
    if (cardsLeft < 2 && canastas < state.canastasNeeded) {
        const canastaWord = state.canastasNeeded === 1 ? 'one canasta' : 'two canastas';
        return no(`Keep a card to discard: you need ${canastaWord} before you can go out.`);
    }
    if (ranks.has('3') && (cardsLeft > 1 || canastas < state.canastasNeeded)) {
        return no('Black threes can only go down on the turn you go out.');
    }

    return yes({ melds, hand, points });
};

/**
 * Sort a player's chosen cards into melds: naturals go with their rank, wild
 * cards go where they are needed and then onto the largest meld with room. With
 * a `target` everything is meant for that one meld, as when she taps it.
 */
export const arrangeSelection = (player: Player, cards: PlayingCard[], target?: MeldRank): Verdict<MeldGroup[]> => {
    if (cards.length === 0) return no('Tap the cards you want to meld first.');
    if (target) {
        const stray = cards.find(card => isNatural(card) && card.rank !== target);
        if (stray) return no(`Only ${rankWords(target)} and wild cards can go on that meld.`);
        return yes([{ rank: target, cardIds: cards.map(card => card.id) }]);
    }

    const naturals = naturalsByRank(cards);
    const wilds = byValue(cards.filter(isWild));
    if (naturals.size === 0) {
        return no('Wild cards cannot make a meld by themselves. Tap one of your melds to add them to it.');
    }

    const hasMeld = (rank: MeldRank) => player.melds.some(meld => meld.rank === rank);
    const groups: { rank: MeldRank; cards: PlayingCard[] }[] = [];
    for (const [rank, group] of naturals) {
        if (rank === '3' && (group.length < 3 || group.length > 4)) {
            return no('Black threes go down three or four together, on the turn you go out.');
        }
        if (!hasMeld(rank) && group.length < 2) {
            return no(`A meld needs at least two ${rankWords(rank)}. A wild card can only be the third.`);
        }
        groups.push({ rank, cards: [...group] });
    }

    // Wilds go where a new meld is one short, then onto the largest.
    for (const group of groups) {
        if (group.rank !== '3' && !hasMeld(group.rank) && group.cards.length === 2) {
            const wild = wilds.shift();
            if (!wild) return no(`A meld needs at least three cards: two ${rankWords(group.rank)} and one more.`);
            group.cards.push(wild);
        }
    }
    const sizeOf = (group: { rank: MeldRank; cards: PlayingCard[] }) =>
        group.cards.length + (player.melds.find(meld => meld.rank === group.rank)?.cards.length ?? 0);
    const wildsIn = (group: { rank: MeldRank; cards: PlayingCard[] }) =>
        group.cards.filter(isWild).length +
        (player.melds.find(meld => meld.rank === group.rank)?.cards.filter(isWild).length ?? 0);
    for (const wild of wilds) {
        const host = groups
            .filter(group => group.rank !== '3' && wildsIn(group) < MAX_WILDS)
            .sort((a, b) => sizeOf(b) - sizeOf(a))[0];
        if (!host) return no('A meld can hold at most three wild cards.');
        host.cards.push(wild);
    }
    return yes(groups.map(group => ({ rank: group.rank, cardIds: group.cards.map(card => card.id) })));
};

/**
 * The cheapest way for these cards, plus an optional meld already started with
 * the pile's top card, to reach a points minimum: as few wilds as possible, and
 * no more natural melds than it takes. Null when it cannot be done.
 */
export const findMinimumMeld = (
    hand: PlayingCard[],
    minimum: number,
    start?: { rank: MeldRank; cards: PlayingCard[]; top: PlayingCard },
): MeldGroup[] | null => {
    const startIds = new Set(start?.cards.map(card => card.id));
    const pool = hand.filter(card => !startIds.has(card.id));
    const wilds = byValue(pool.filter(isWild));
    const naturals = naturalsByRank(pool.filter(card => card.rank !== '3'));
    const startExtras = start ? (naturals.get(start.rank) ?? []) : [];
    if (start) naturals.delete(start.rank);

    const value = (cards: PlayingCard[]) => cardsValue(cards);
    const triples = [...naturals.entries()]
        .filter(([, cards]) => cards.length >= 3)
        .sort((a, b) => value(b[1]) - value(a[1]));
    const pairs = [...naturals.entries()]
        .filter(([, cards]) => cards.length === 2)
        .sort((a, b) => value(b[1]) - value(a[1]));

    interface Draft {
        rank: MeldRank;
        cards: PlayingCard[];
    }

    const attempt = (chosenWilds: PlayingCard[]): MeldGroup[] | null => {
        const drafts: Draft[] = [];
        let total = cardsValue(chosenWilds);
        if (start) {
            drafts.push({ rank: start.rank, cards: [...start.cards] });
            total += value(start.cards) + cardValue(start.top);
        }

        const spare = [...chosenWilds];
        for (const [rank, cards] of pairs) {
            if (spare.length === 0) break;
            const wild = spare.shift()!;
            drafts.push({ rank, cards: [...cards, wild] });
            total += value(cards);
        }

        const remaining = [...triples];
        const addTriple = () => {
            const next = remaining.shift();
            if (!next) return false;
            drafts.push({ rank: next[0], cards: [...next[1]] });
            total += value(next[1]);
            return true;
        };

        // Any wild still in hand needs a meld with room.
        for (const wild of spare) {
            let host = drafts.find(draft => draft.cards.filter(isWild).length < MAX_WILDS);
            if (!host && addTriple()) host = drafts[drafts.length - 1];
            if (!host) return null;
            host.cards.push(wild);
        }

        // Then spend naturals, the cheapest thing to spend.
        if (start && drafts[0] && total < minimum && startExtras.length > 0) {
            drafts[0].cards.push(...startExtras);
            total += value(startExtras);
        }
        while (total < minimum && addTriple()) {
            /* keep adding melds until the points are met */
        }

        if (total < minimum || drafts.length === 0) return null;
        return drafts.map(draft => ({ rank: draft.rank, cardIds: draft.cards.map(card => card.id) }));
    };

    for (let count = 0; count <= wilds.length; count++) {
        const cheap = attempt(wilds.slice(0, count));
        if (cheap) return cheap;
        if (count > 0) {
            const dear = attempt(wilds.slice(wilds.length - count));
            if (dear) return dear;
        }
    }
    return null;
};

// ------------------------------------------------------------------ the deal

const blankPlayer = (): Player => ({ hand: [], melds: [], redThrees: [], tookRanks: [] });

/** Cookie sees her own cards; the computer's stay face down in its hand. */
const faceUpInHand = (seat: Seat): boolean => seat === 'cookie';

/**
 * Lay any red threes down and pull replacements from the stock until none are
 * left in the way. Returns what came of it; never mutates what it was given.
 */
const drawInto = (stock: PlayingCard[], player: Player, seat: Seat, count: number): [PlayingCard[], Player] => {
    const pile = [...stock];
    const hand = [...player.hand];
    const redThrees = [...player.redThrees];
    let wanted = count;
    while (wanted > 0 && pile.length > 0) {
        const card = pile.pop()!;
        if (isRedThree(card)) {
            redThrees.push(turned(card, true));
        } else {
            hand.push(turned(card, faceUpInHand(seat)));
            wanted--;
        }
    }
    return [pile, { ...player, hand, redThrees }];
};

export interface DealOptions {
    seed: number;
    first?: Seat;
    startTotals?: Record<Seat, number>;
    canastasNeeded?: number;
}

export const dealHand = ({
    seed,
    first = 'cookie',
    startTotals = { cookie: 0, computer: 0 },
    canastasNeeded = DEFAULT_CANASTAS_TO_GO_OUT,
}: DealOptions): HandState => {
    let stock = shuffled(buildDoubleDeck(DECK_JOKERS), mulberry32(seed));

    const players: Record<Seat, Player> = { cookie: blankPlayer(), computer: blankPlayer() };
    for (let i = 0; i < HAND_SIZE; i++) {
        for (const seat of [first, otherSeat(first)]) {
            players[seat].hand.push(stock.pop()!);
        }
    }

    // Turn up the first card. A wild or a red three goes under, and freezes the pile.
    const discard: PlayingCard[] = [];
    let frozen = false;
    for (;;) {
        const card = stock.pop()!;
        discard.push(turned(card, true));
        if (isWild(card) || isRedThree(card)) frozen = true;
        else break;
    }

    // Red threes dealt to a player are laid down and replaced at once.
    for (const seat of [first, otherSeat(first)]) {
        const player = players[seat];
        const kept = player.hand.filter(card => !isRedThree(card));
        const reds = player.hand.filter(isRedThree);
        const start: Player = {
            ...player,
            hand: kept.map(card => turned(card, faceUpInHand(seat))),
            redThrees: reds.map(card => turned(card, true)),
        };
        [stock, players[seat]] = drawInto(stock, start, seat, reds.length);
    }

    return {
        seed,
        stock,
        discard,
        frozen,
        players,
        turn: first,
        phase: 'draw',
        startTotals,
        canastasNeeded,
        meldedAtTurnStart: false,
        ending: null,
        wentOut: null,
        concealed: false,
    };
};

// ------------------------------------------------------------- taking the pile

/** The pile is frozen for a player who has not melded yet, as well as for everyone when a wild is in it. */
export const isFrozenFor = (state: HandState, seat: Seat): boolean =>
    state.frozen || state.players[seat].melds.length === 0;

export const pileTop = (state: HandState): PlayingCard | undefined => state.discard[state.discard.length - 1];

/** A reason the pile cannot be taken by anybody, whatever they hold. */
const pileProblem = (state: HandState): string | null => {
    const top = pileTop(state);
    if (!top) return 'The pile is empty.';
    if (isWild(top)) return 'A wild card is on top, so nobody can take the pile until another card covers it.';
    if (isBlackThree(top)) return 'A black three is on top, so the pile is blocked for this turn.';
    return null;
};

const checkTake = (state: HandState, seat: Seat, groups: MeldGroup[]): Verdict<MeldCheck> => {
    const problem = pileProblem(state);
    if (problem) return no(problem);
    const top = pileTop(state)!;
    const player = state.players[seat];
    const main = groups.find(group => group.rank === top.rank);
    if (!main) return no('The top card of the pile has to go down at once.');

    const fromHand = main.cardIds.map(id => player.hand.find(card => card.id === id));
    if (fromHand.some(card => !card)) return no('That card is not in your hand.');
    const matching = fromHand.filter(card => card && isNatural(card)).length;

    if (isFrozenFor(state, seat) && matching < 2) {
        return no(
            state.frozen
                ? `The pile is frozen: to take it you need two ${rankWords(top.rank)} in your hand, not counting wild cards.`
                : `Before your first meld, you need two ${rankWords(top.rank)} in your hand to take the pile, not counting wild cards.`,
        );
    }

    const incoming = state.discard.slice(0, -1).filter(card => !isRedThree(card)).length;
    return checkMeld(state, seat, groups, top, incoming);
};

export interface TakePlan {
    groups: MeldGroup[];
    /** Hand cards that will go down with the top card, for describing the move. */
    cards: PlayingCard[];
    usesWild: boolean;
}

const planFrom = (player: Player, groups: MeldGroup[]): TakePlan => {
    const ids = new Set(groups.flatMap(group => group.cardIds));
    const cards = player.hand.filter(card => ids.has(card.id));
    return { groups, cards, usesWild: cards.some(isWild) };
};

/** The cheapest legal way to take the pile, or why there is none. */
export const planTake = (state: HandState, seat: Seat): Verdict<TakePlan> => {
    if (state.phase !== 'draw' || state.turn !== seat) return no('You can only take the pile at the start of your turn.');
    const problem = pileProblem(state);
    if (problem) return no(problem);

    const top = pileTop(state)!;
    const rank = top.rank as MeldRank;
    const player = state.players[seat];
    const naturals = player.hand.filter(card => card.rank === top.rank);
    const wilds = byValue(player.hand.filter(isWild));
    const frozen = isFrozenFor(state, seat);
    const existing = player.melds.some(meld => meld.rank === rank);

    const bases: PlayingCard[][] = [];
    if (!frozen && existing) bases.push([]);
    if (naturals.length >= 2) bases.push(naturals.slice(0, 2));
    if (!frozen && naturals.length >= 1 && wilds.length > 0) bases.push([naturals[0], wilds[0]]);

    let reason: string | null = null;
    for (const base of bases) {
        let groups: MeldGroup[] | null = [{ rank, cardIds: base.map(card => card.id) }];
        if (player.melds.length === 0) {
            groups = findMinimumMeld(player.hand, minimumFor(state, seat), { rank, cards: base, top });
            if (!groups) {
                const points = cardsValue(base) + cardValue(top);
                reason =
                    `Your first meld needs ${minimumFor(state, seat)} points, and those cards with the top card ` +
                    `make only ${points}.`;
                continue;
            }
        }
        const check = checkTake(state, seat, groups);
        if (check.ok) return yes(planFrom(player, groups));
        reason = check.reason;
    }
    if (reason) return no(reason);

    if (state.frozen) {
        return no(`The pile is frozen: to take it you need two ${rankWords(rank)} in your hand, not counting wild cards.`);
    }
    if (player.melds.length === 0) {
        return no(`Before your first meld, you need two ${rankWords(rank)} in your hand to take the pile.`);
    }
    return no(`To take the pile you need two ${rankWords(rank)}, one and a wild card, or a meld of ${rankWords(rank)}.`);
};

/** The same, but using exactly the cards a player has chosen. */
export const planTakeWith = (state: HandState, seat: Seat, cards: PlayingCard[]): Verdict<TakePlan> => {
    if (state.phase !== 'draw' || state.turn !== seat) return no('You can only take the pile at the start of your turn.');
    const problem = pileProblem(state);
    if (problem) return no(problem);

    const top = pileTop(state)!;
    const rank = top.rank as MeldRank;
    const player = state.players[seat];
    // She may have chosen only the extra cards for a first meld: bring the matching pair along.
    const chosen = [...cards];
    const needsPair = isFrozenFor(state, seat) || !player.melds.some(meld => meld.rank === rank);
    if (needsPair && !chosen.some(card => card.rank === top.rank)) {
        chosen.push(...player.hand.filter(card => card.rank === top.rank).slice(0, 2));
    }
    // Think of the top card as already in the selection, so wilds find it.
    const arranged = arrangeSelection(player, [...chosen, top]);
    if (!arranged.ok) return arranged;
    const groups = arranged.value
        .map(group => ({ ...group, cardIds: group.cardIds.filter(id => id !== top.id) }))
        .filter(group => group.cardIds.length > 0 || group.rank === rank);
    const check = checkTake(state, seat, groups);
    return check.ok ? yes(planFrom(player, groups)) : check;
};

// --------------------------------------------------------------- going out

export interface GoingOutPlan {
    groups: MeldGroup[];
    /** The final discard, or null when every card goes down. */
    discard: string | null;
}

/** All these cards as melds on top of the existing ones, or null if some card has nowhere to go. */
const meldEverything = (player: Player, cards: PlayingCard[], needed: number): MeldGroup[] | null => {
    const drafts = new Map<MeldRank, { cards: PlayingCard[]; existing: PlayingCard[] }>();
    for (const [rank, naturals] of naturalsByRank(cards)) {
        const existing = player.melds.find(meld => meld.rank === rank);
        if (!existing) {
            if (rank === '3' && naturals.length !== 3 && naturals.length !== 4) return null;
            if (naturals.length < 2) return null;
        }
        drafts.set(rank, { cards: [...naturals], existing: existing?.cards ?? [] });
    }
    for (const meld of player.melds) {
        if (!drafts.has(meld.rank)) drafts.set(meld.rank, { cards: [], existing: meld.cards });
    }

    const wilds = byValue(cards.filter(isWild));
    for (const [rank, draft] of drafts) {
        if (rank !== '3' && draft.existing.length === 0 && draft.cards.length === 2) {
            const wild = wilds.shift();
            if (!wild) return null;
            draft.cards.push(wild);
        }
    }

    const sizeOf = (d: { cards: PlayingCard[]; existing: PlayingCard[] }) => d.cards.length + d.existing.length;
    const wildsIn = (d: { cards: PlayingCard[]; existing: PlayingCard[] }) =>
        d.cards.filter(isWild).length + d.existing.filter(isWild).length;
    // A natural canasta loses 200 points to a wild, so it is the last choice of home.
    const place = (d: { cards: PlayingCard[]; existing: PlayingCard[] }): number => {
        if (sizeOf(d) >= CANASTA_SIZE) return wildsIn(d) === 0 ? 2000 : 1000;
        return CANASTA_SIZE - sizeOf(d);
    };
    while (wilds.length > 0) {
        const wild = wilds.shift()!;
        const hosts = [...drafts.entries()]
            .filter(([rank, d]) => rank !== '3' && wildsIn(d) < MAX_WILDS)
            .sort((a, b) => place(a[1]) - place(b[1]));
        if (hosts.length === 0) return null;
        hosts[0][1].cards.push(wild);
    }

    const canastas = [...drafts.values()].filter(d => sizeOf(d) >= CANASTA_SIZE).length;
    if (canastas < needed) return null;

    return [...drafts.entries()]
        .filter(([, d]) => d.cards.length > 0)
        .map(([rank, d]) => ({ rank, cardIds: d.cards.map(card => card.id) }));
};

/** A way for this player to go out right now, or null. Keeps the most points on the table. */
export const goingOutPlan = (state: HandState, seat: Seat): GoingOutPlan | null => {
    if (state.phase !== 'play' || state.turn !== seat) return null;
    const player = state.players[seat];
    const minimum = player.melds.length === 0 ? minimumFor(state, seat) : 0;

    let best: GoingOutPlan | null = null;
    let bestPoints = -Infinity;
    const tried = new Set<string>();
    for (const leftover of [null, ...player.hand]) {
        const key = leftover ? leftover.rank : 'none';
        if (tried.has(key)) continue;
        tried.add(key);

        const rest = leftover ? player.hand.filter(card => card.id !== leftover.id) : player.hand;
        const groups = meldEverything(player, rest, state.canastasNeeded);
        if (!groups) continue;
        const points = cardsValue(rest);
        if (points < minimum) continue;
        if (points > bestPoints) {
            bestPoints = points;
            best = { groups, discard: leftover?.id ?? null };
        }
    }
    return best;
};

// --------------------------------------------------------------------- moves

const finish = (state: HandState, seat: Seat, ending: HandEnding): HandState => ({
    ...state,
    phase: 'over',
    ending,
    wentOut: ending === 'out' ? seat : null,
    concealed: ending === 'out' && !state.meldedAtTurnStart,
});

/**
 * The next player's turn, or the end of the hand. Choice recorded here: once the
 * stock is empty play carries on only while the player to move can legally take
 * the pile. A player who cannot ends the hand, and nobody gets a going-out bonus.
 */
const nextTurn = (state: HandState, seat: Seat): HandState => {
    const next = otherSeat(seat);
    const passed: HandState = {
        ...state,
        turn: next,
        phase: 'draw',
        meldedAtTurnStart: state.players[next].melds.length > 0,
    };
    if (passed.stock.length === 0 && !planTake(passed, next).ok) return finish(passed, next, 'stock');
    return passed;
};

const withPlayer = (state: HandState, seat: Seat, player: Player): HandState => ({
    ...state,
    players: { ...state.players, [seat]: player },
});

const applyMeld = (state: HandState, seat: Seat, groups: MeldGroup[]): Verdict<HandState> => {
    const check = checkMeld(state, seat, groups);
    if (!check.ok) return check;
    const { melds, hand } = check.value;
    const next = withPlayer(state, seat, { ...state.players[seat], melds, hand });
    return yes(hand.length === 0 ? finish(next, seat, 'out') : next);
};

const applyDiscard = (state: HandState, seat: Seat, cardId: string): Verdict<HandState> => {
    const player = state.players[seat];
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return no('That card is not in your hand.');
    const hand = player.hand.filter(c => c.id !== cardId);
    const next: HandState = {
        ...withPlayer(state, seat, { ...player, hand }),
        discard: [...state.discard, turned(card, true)],
        frozen: state.frozen || isWild(card),
    };
    if (hand.length > 0) return yes(nextTurn(next, seat));
    // Discarding the last card is going out. Without the canastas it can only
    // happen when the stock's last card was a red three, and it simply ends the hand.
    return yes(finish(next, seat, countCanastas(player.melds) >= state.canastasNeeded ? 'out' : 'stuck'));
};

const applyTake = (state: HandState, seat: Seat, groups: MeldGroup[]): Verdict<HandState> => {
    const check = checkTake(state, seat, groups);
    if (!check.ok) return check;

    const player = state.players[seat];
    const rest = state.discard.slice(0, -1);
    const redsInPile = rest.filter(isRedThree);
    const incoming = rest.filter(card => !isRedThree(card));
    const hand = [...check.value.hand, ...incoming.map(card => turned(card, faceUpInHand(seat)))];
    const seen = new Set<Rank>(player.tookRanks);
    for (const card of state.discard) {
        if (isNatural(card) && !isRedThree(card)) seen.add(card.rank as Rank);
    }

    const next: HandState = {
        ...withPlayer(state, seat, {
            ...player,
            hand,
            melds: check.value.melds,
            // A red three inside a taken pile is laid down, but brings no replacement.
            redThrees: [...player.redThrees, ...redsInPile],
            tookRanks: [...seen],
        }),
        discard: [],
        frozen: false,
        phase: 'play',
    };
    return yes(hand.length === 0 ? finish(next, seat, 'out') : next);
};

const applyGoOut = (state: HandState, seat: Seat): Verdict<HandState> => {
    const plan = goingOutPlan(state, seat);
    if (!plan) return no('You cannot go out yet.');
    let next = state;
    if (plan.groups.length > 0) {
        // Everything but the final discard goes down in one action.
        const check = checkMeld(state, seat, plan.groups);
        if (!check.ok) return check;
        next = withPlayer(state, seat, { ...state.players[seat], melds: check.value.melds, hand: check.value.hand });
    }
    if (plan.discard) return applyDiscard(next, seat, plan.discard);
    return yes(finish(next, seat, 'out'));
};

export const applyMove = (state: HandState, seat: Seat, move: Move): Verdict<HandState> => {
    if (state.phase === 'over') return no('This hand is over.');
    if (state.turn !== seat) return no('It is not your turn yet.');

    if (state.phase === 'draw') {
        switch (move.type) {
            case 'draw': {
                if (state.stock.length === 0) return no('The stock is empty, so the only thing to do is take the pile.');
                const [stock, player] = drawInto(state.stock, state.players[seat], seat, DRAW_COUNT);
                return yes({ ...withPlayer(state, seat, player), stock, phase: 'play' });
            }
            case 'take':
                return applyTake(state, seat, move.groups);
            default:
                return no('Draw two cards or take the pile first.');
        }
    }

    switch (move.type) {
        case 'meld':
            return applyMeld(state, seat, move.groups);
        case 'discard':
            return applyDiscard(state, seat, move.cardId);
        case 'goOut':
            return applyGoOut(state, seat);
        default:
            return no('You have already drawn this turn.');
    }
};

// ------------------------------------------------------------------- scoring

export interface SeatScore {
    canastas: number;
    redThrees: number;
    goingOut: number;
    melded: number;
    inHand: number;
    total: number;
}

const redThreeScore = (player: Player): number => {
    const count = player.redThrees.length;
    const value = count === 4 ? ALL_RED_THREES_VALUE : count * RED_THREE_VALUE;
    return player.melds.length > 0 ? value : -value;
};

export const scoreSeat = (state: HandState, seat: Seat): SeatScore => {
    const player = state.players[seat];
    const canastas = player.melds.reduce((sum, meld) => sum + canastaBonus(meld), 0);
    const redThrees = redThreeScore(player);
    const goingOut = state.wentOut === seat ? (state.concealed ? CONCEALED_BONUS : GOING_OUT_BONUS) : 0;
    const melded = player.melds.reduce((sum, meld) => sum + cardsValue(meld.cards), 0);
    const inHand = cardsValue(player.hand);
    return { canastas, redThrees, goingOut, melded, inHand, total: canastas + redThrees + goingOut + melded - inHand };
};

export const scoreHand = (state: HandState): Record<Seat, SeatScore> => ({
    cookie: scoreSeat(state, 'cookie'),
    computer: scoreSeat(state, 'computer'),
});

/**
 * Who has won the match, if anyone. It ends after a hand in which someone has
 * reached the target, and the higher total wins. A dead heat plays another hand.
 */
export const matchWinner = (totals: Record<Seat, number>): Seat | null => {
    if (totals.cookie < MATCH_TARGET && totals.computer < MATCH_TARGET) return null;
    if (totals.cookie === totals.computer) return null;
    return totals.cookie > totals.computer ? 'cookie' : 'computer';
};

// ------------------------------------------------------------------ for tests

/** Every card on the table, wherever it lies. All 108 of them, always. */
export const allCards = (state: HandState): PlayingCard[] => [
    ...state.stock,
    ...state.discard,
    ...SEATS.flatMap(seat => {
        const player = state.players[seat];
        return [...player.hand, ...player.redThrees, ...player.melds.flatMap(meld => meld.cards)];
    }),
];

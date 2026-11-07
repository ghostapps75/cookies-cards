import type { Rank, Suit } from '../../types';
import { mulberry32, RANKS, SUITS } from '../../utils/gameLogic';
import { buildDoubleDeck, cardName, isJoker, shuffled, turned, type PlayingCard } from '../shared/cards';

/**
 * Kalooki 51 for two, as pure functions: no timers, no storage, no screen.
 *
 * Families play this game differently, so everything a family might play
 * differently is one of the constants just below. The two most likely to
 * differ, the opening meld and the hand size, are also settings in the game.
 */

/* ------------------------------------------------------- rules that vary */

/** Jokers in the pack, on top of two full decks. */
export const JOKERS_IN_PACK = 4;
/** Cards dealt to each player. The first option is the default. */
export const HAND_SIZE_OPTIONS = [13, 15] as const;
export const DEFAULT_HAND_SIZE = 13;
/** Points the melds of a player's first lay-down must be worth. */
export const OPENING_OPTIONS = [51, 40] as const;
export const DEFAULT_OPENING = 51;
/** The match ends when someone has been charged this many points. */
export const MATCH_LIMIT = 150;

/** An ace, in opening melds and when charged at the end of a hand. */
export const ACE_VALUE = 11;
/** An ace at the bottom of ace-2-3 when working out an opening. Some families say 1. */
export const ACE_LOW_VALUE = 11;
/** King, queen, jack. */
export const COURT_VALUE = 10;
/** What a joker costs if it is still in your hand when the hand ends. */
export const JOKER_CHARGE = 25;
/** Going out in one turn without having opened: the other player's charge is multiplied by this. */
export const KALOOKI_MULTIPLIER = 2;

export const MIN_SET_SIZE = 3;
export const MAX_SET_SIZE = 4;
export const MIN_RUN_LENGTH = 3;
/** Ace-2-3 is a run. Runs never go round the corner (king-ace-2), whatever these say. */
export const ACE_CAN_BE_LOW = true;
/** Queen-king-ace is a run. */
export const ACE_CAN_BE_HIGH = true;
export const JOKERS_MAY_OUTNUMBER_NATURALS = false;

/** The top discard may only be taken if it is melded or laid off that same turn. */
export const TAKEN_DISCARD_MUST_BE_USED = true;
export const LAY_OFF_NEEDS_OPENING = true;
export const SWAP_NEEDS_OPENING = true;
/** A joker swapped off the table must go back down that same turn. */
export const SWAPPED_JOKER_MUST_BE_USED = true;
/** You go out by discarding your last card, so you may not lay every card down. */
export const GO_OUT_NEEDS_DISCARD = true;
/** When the stock runs out the discards are turned over. Set true to shuffle them too. */
export const SHUFFLE_TURNED_STOCK = false;
/** Cookie plays first in the first hand; after that the start goes back and forth. */
export const COOKIE_STARTS_FIRST_HAND = true;

/* ---------------------------------------------------------------- types */

export type Player = 'cookie' | 'computer';

export const otherPlayer = (player: Player): Player => (player === 'cookie' ? 'computer' : 'cookie');

/** What a card is, or what a joker stands for. A joker in a set stands for its rank in any suit left. */
export interface Face {
    rank: Rank;
    suit: Suit | null;
}

export interface Meld {
    id: string;
    owner: Player;
    kind: 'set' | 'run';
    /** In table order: a run goes low to high, with its jokers in place. */
    cards: PlayingCard[];
    /** What each card in `cards` stands for. */
    stands: Face[];
    /** A run's position in the suit: 1 is a low ace, 14 a high ace. Zero for a set. */
    low: number;
}

export type MeldShape = Pick<Meld, 'kind' | 'cards' | 'stands' | 'low'>;

export interface HandResult {
    /** Null only if the cards ran out with nobody able to draw. */
    wentOut: Player | null;
    kalooki: boolean;
    charges: Record<Player, number>;
}

export interface HandState {
    handNo: number;
    seed: number;
    opening: number;
    handSize: number;
    hands: Record<Player, PlayingCard[]>;
    /** Top of the stock is the end of the array. */
    stock: PlayingCard[];
    /** Top of the discard pile is the end of the array. */
    discard: PlayingCard[];
    melds: Meld[];
    nextMeldId: number;
    opened: Record<Player, boolean>;
    turn: Player;
    phase: 'draw' | 'play' | 'over';
    /** Cards that have to go down before this turn can end: a taken discard, a swapped joker. */
    mustUse: string[];
    /** What the melds laid this turn are worth, towards opening. */
    turnMeldValue: number;
    turnMeldIds: string[];
    openedThisTurn: boolean;
    /** What each player has shown an interest in: cards picked up and laid down. All public. */
    interest: Record<Player, Face[]>;
    /** Turns finished so far this hand. */
    turns: number;
    result: HandResult | null;
}

export type Outcome = { ok: true; state: HandState } | { ok: false; why: string };

const fail = (why: string): Outcome => ({ ok: false, why });
const done = (state: HandState): Outcome => ({ ok: true, state });

/** Cards that must stay in hand after laying down, for the final discard. */
const HELD_BACK = GO_OUT_NEEDS_DISCARD ? 1 : 0;

/* --------------------------------------------------------------- values */

export const rankValue = (rank: Rank): number => {
    if (rank === 'ace') return ACE_VALUE;
    if (rank === 'jack' || rank === 'queen' || rank === 'king') return COURT_VALUE;
    return Number(rank);
};

/** Position of a rank in a suit: ace 1, two 2, king 13. A high ace is 14. */
const rankPosition = (rank: Rank): number => RANKS.indexOf(rank) + 1;
const positionRank = (position: number): Rank => (position === 14 ? 'ace' : RANKS[position - 1]);
const positionsOf = (rank: Rank): number[] => (rank === 'ace' ? [1, 14] : [rankPosition(rank)]);
const positionValue = (position: number): number =>
    position === 1 ? ACE_LOW_VALUE : rankValue(positionRank(position));

const LOWEST_POSITION = ACE_CAN_BE_LOW ? 1 : 2;
const HIGHEST_POSITION = ACE_CAN_BE_HIGH ? 14 : 13;

/** What a card costs if it is still in hand at the end. */
export const cardCharge = (card: PlayingCard): number =>
    card.rank === 'joker' ? JOKER_CHARGE : rankValue(card.rank);

export const handCharge = (cards: PlayingCard[]): number => cards.reduce((sum, card) => sum + cardCharge(card), 0);

/** What a meld counts for towards opening. A joker is worth the card it stands for. */
export const meldValue = (meld: MeldShape): number =>
    meld.kind === 'run'
        ? meld.cards.reduce((sum, _card, i) => sum + positionValue(meld.low + i), 0)
        : meld.cards.length * rankValue(meld.stands[0].rank);

const faceOf = (card: PlayingCard): Face => ({ rank: card.rank as Rank, suit: card.suit });

const RANK_SHORT: Record<Rank, string> = {
    ace: 'A',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '8': '8',
    '9': '9',
    '10': '10',
    jack: 'J',
    queen: 'Q',
    king: 'K',
};
const SUIT_SYMBOL: Record<Suit, string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };

/** "7♥", or just "7" when a joker in a set could be any suit left. */
export const faceLabel = (face: Face): string =>
    `${RANK_SHORT[face.rank]}${face.suit ? SUIT_SYMBOL[face.suit] : ''}`;

/* ---------------------------------------------------------- what a meld is */

const naturalsOf = (cards: PlayingCard[]): PlayingCard[] => cards.filter(card => !isJoker(card));
const jokersOf = (cards: PlayingCard[]): PlayingCard[] => cards.filter(isJoker);

const SUIT_INDEX = (suit: Suit | null): number => (suit ? SUITS.indexOf(suit) : SUITS.length);

const arrangeSet = (naturals: PlayingCard[], jokers: PlayingCard[]): MeldShape | null => {
    const rank = naturals[0].rank as Rank;
    if (!naturals.every(card => card.rank === rank)) return null;
    const size = naturals.length + jokers.length;
    if (size < MIN_SET_SIZE || size > MAX_SET_SIZE) return null;
    if (new Set(naturals.map(card => card.suit)).size !== naturals.length) return null;
    const ordered = [...naturals].sort((a, b) => SUIT_INDEX(a.suit) - SUIT_INDEX(b.suit));
    return {
        kind: 'set',
        low: 0,
        cards: [...ordered, ...jokers],
        stands: [...ordered.map(faceOf), ...jokers.map(() => ({ rank, suit: null }))],
    };
};

/** Every way an ace or two can sit in a run: low, high, or one at each end. */
const acePlacements = (aces: number): number[][] => {
    if (aces === 0) return [[]];
    if (aces === 1) {
        const out: number[][] = [];
        if (ACE_CAN_BE_LOW) out.push([1]);
        if (ACE_CAN_BE_HIGH) out.push([14]);
        return out;
    }
    return aces === 2 && ACE_CAN_BE_LOW && ACE_CAN_BE_HIGH ? [[1, 14]] : [];
};

const arrangeRun = (naturals: PlayingCard[], jokers: PlayingCard[]): MeldShape | null => {
    const suit = naturals[0].suit;
    if (!naturals.every(card => card.suit === suit)) return null;
    if (naturals.length + jokers.length < MIN_RUN_LENGTH) return null;

    const aces = naturals.filter(card => card.rank === 'ace');
    const others = naturals.filter(card => card.rank !== 'ace');
    const otherPositions = others.map(card => rankPosition(card.rank as Rank));
    if (new Set(otherPositions).size !== otherPositions.length) return null;

    let best: { low: number; high: number; placement: number[]; value: number } | null = null;

    for (const placement of acePlacements(aces.length)) {
        const taken = [...otherPositions, ...placement];
        const min = Math.min(...taken);
        const max = Math.max(...taken);
        const gaps = max - min + 1 - taken.length;
        if (gaps > jokers.length) continue;
        const spare = jokers.length - gaps;
        // Spare jokers go on the ends; try all of them high first.
        for (let up = spare; up >= 0; up--) {
            const low = min - (spare - up);
            const high = max + up;
            if (low < LOWEST_POSITION || high > HIGHEST_POSITION) continue;
            let value = 0;
            for (let p = low; p <= high; p++) value += positionValue(p);
            if (!best || value > best.value) best = { low, high, placement, value };
        }
    }
    if (!best) return null;

    const atPosition = new Map<number, PlayingCard>();
    others.forEach((card, i) => atPosition.set(otherPositions[i], card));
    aces.forEach((card, i) => atPosition.set(best.placement[i], card));

    const spareJokers = [...jokers];
    const cards: PlayingCard[] = [];
    const stands: Face[] = [];
    for (let p = best.low; p <= best.high; p++) {
        cards.push(atPosition.get(p) ?? (spareJokers.shift() as PlayingCard));
        stands.push({ rank: positionRank(p), suit });
    }
    return { kind: 'run', low: best.low, cards, stands };
};

/**
 * Puts cards in meld order, or says they are not a meld. When a joker could go
 * either way (5-6 and a joker), it takes the place worth the most points.
 */
export const arrangeMeld = (cards: PlayingCard[]): MeldShape | null => {
    const naturals = naturalsOf(cards);
    const jokers = jokersOf(cards);
    if (naturals.length === 0) return null;
    if (!JOKERS_MAY_OUTNUMBER_NATURALS && jokers.length > naturals.length) return null;
    return arrangeSet(naturals, jokers) ?? arrangeRun(naturals, jokers);
};

export const whyNotMeld = (cards: PlayingCard[]): string => {
    if (cards.length < Math.min(MIN_SET_SIZE, MIN_RUN_LENGTH)) return 'A meld needs at least three cards.';
    const naturals = naturalsOf(cards);
    if (!JOKERS_MAY_OUTNUMBER_NATURALS && jokersOf(cards).length > naturals.length) {
        return 'A meld cannot have more jokers than real cards.';
    }
    if (
        naturals.length > 1 &&
        naturals.every(card => card.rank === naturals[0].rank) &&
        new Set(naturals.map(card => card.suit)).size !== naturals.length
    ) {
        return 'A set needs every card in a different suit.';
    }
    return 'Those cards do not make a meld. A set is 3 or 4 of a kind in different suits. A run is 3 or more in a row in one suit.';
};

/** Whether a meld on the table obeys the rules. Used by tests and when loading a save. */
export const meldIsSound = (meld: Meld): boolean => {
    const naturals = naturalsOf(meld.cards);
    const jokers = jokersOf(meld.cards);
    if (meld.stands.length !== meld.cards.length || naturals.length === 0) return false;
    if (!JOKERS_MAY_OUTNUMBER_NATURALS && jokers.length > naturals.length) return false;

    if (meld.kind === 'set') {
        const rank = meld.stands[0].rank;
        return (
            meld.cards.length >= MIN_SET_SIZE &&
            meld.cards.length <= MAX_SET_SIZE &&
            meld.stands.every(face => face.rank === rank) &&
            naturals.every(card => card.rank === rank) &&
            new Set(naturals.map(card => card.suit)).size === naturals.length
        );
    }

    const suit = naturals[0].suit;
    const high = meld.low + meld.cards.length - 1;
    if (meld.cards.length < MIN_RUN_LENGTH || meld.low < LOWEST_POSITION || high > HIGHEST_POSITION) return false;
    return meld.cards.every(
        (card, i) =>
            meld.stands[i].suit === suit &&
            meld.stands[i].rank === positionRank(meld.low + i) &&
            (isJoker(card) || (card.suit === suit && card.rank === positionRank(meld.low + i))),
    );
};

/* -------------------------------------------------- adding to a table meld */

const roomForJoker = (cards: PlayingCard[]): boolean =>
    JOKERS_MAY_OUTNUMBER_NATURALS || jokersOf(cards).length + 1 <= naturalsOf(cards).length;

/** Every meld this card could turn `meld` into: none, one, or (a joker on a run) two. */
export const layOffOptions = (meld: Meld, card: PlayingCard): Meld[] => {
    const up = turned(card, true);

    if (meld.kind === 'set') {
        if (meld.cards.length >= MAX_SET_SIZE) return [];
        if (isJoker(up) && !roomForJoker(meld.cards)) return [];
        const naturals = isJoker(up) ? naturalsOf(meld.cards) : [...naturalsOf(meld.cards), up];
        const jokers = isJoker(up) ? [...jokersOf(meld.cards), up] : jokersOf(meld.cards);
        const shape = arrangeSet(naturals, jokers);
        return shape ? [{ ...meld, ...shape }] : [];
    }

    const suit = meld.stands[0].suit;
    const high = meld.low + meld.cards.length - 1;
    const onTop = (): Meld => ({
        ...meld,
        cards: [...meld.cards, up],
        stands: [...meld.stands, { rank: positionRank(high + 1), suit }],
    });
    const below = (): Meld => ({
        ...meld,
        low: meld.low - 1,
        cards: [up, ...meld.cards],
        stands: [{ rank: positionRank(meld.low - 1), suit }, ...meld.stands],
    });

    const out: Meld[] = [];
    if (isJoker(up)) {
        if (!roomForJoker(meld.cards)) return [];
        if (high < HIGHEST_POSITION) out.push(onTop());
        if (meld.low > LOWEST_POSITION) out.push(below());
        return out;
    }
    if (up.suit !== suit) return [];
    const positions = positionsOf(up.rank as Rank);
    if (high < HIGHEST_POSITION && positions.includes(high + 1)) out.push(onTop());
    if (meld.low > LOWEST_POSITION && positions.includes(meld.low - 1)) out.push(below());
    return out;
};

/** Lays several cards on one meld in whatever order works, or says they will not all go. */
export const layOffMany = (meld: Meld, cards: PlayingCard[]): Meld | null => {
    if (cards.length === 0) return meld;
    for (const card of cards) {
        const rest = cards.filter(other => other !== card);
        for (const option of layOffOptions(meld, card)) {
            const result = layOffMany(option, rest);
            if (result) return result;
        }
    }
    return null;
};

/** Gives the natural card a joker stands for, and gets the joker back. Null if it does not match. */
export const swapOut = (meld: Meld, card: PlayingCard): { meld: Meld; joker: PlayingCard } | null => {
    if (isJoker(card)) return null;
    const up = turned(card, true);

    if (meld.kind === 'set') {
        const jokers = jokersOf(meld.cards);
        if (jokers.length === 0 || meld.stands[0].rank !== up.rank) return null;
        const naturals = naturalsOf(meld.cards);
        if (naturals.some(natural => natural.suit === up.suit)) return null;
        const shape = arrangeSet([...naturals, up], jokers.slice(1));
        return shape ? { meld: { ...meld, ...shape }, joker: jokers[0] } : null;
    }

    if (up.suit !== meld.stands[0].suit) return null;
    for (const position of positionsOf(up.rank as Rank)) {
        const index = position - meld.low;
        const held = meld.cards[index];
        if (held && isJoker(held)) {
            const cards = [...meld.cards];
            cards[index] = up;
            return { meld: { ...meld, cards }, joker: held };
        }
    }
    return null;
};

/* ------------------------------------------------- finding melds in a hand */

/** One meld that could be made from a hand, in terms of which faces it spends. */
interface MeldOption {
    faces: number[];
    jokers: number;
    value: number;
    charge: number;
}

interface Pool {
    faceCards: PlayingCard[][];
    jokers: PlayingCard[];
    options: MeldOption[];
}

export type MeldGoal = 'value' | 'charge';

export interface MeldPlan {
    melds: PlayingCard[][];
    /** What these melds are worth towards opening. */
    value: number;
    /** What these cards would have cost if left in hand. */
    charge: number;
    used: number;
}

const EMPTY_PLAN: MeldPlan = { melds: [], value: 0, charge: 0, used: 0 };

const buildPool = (hand: PlayingCard[]): Pool => {
    const faceIndex = new Map<string, number>();
    const faceCards: PlayingCard[][] = [];
    const jokers: PlayingCard[] = [];

    for (const card of hand) {
        if (isJoker(card)) {
            jokers.push(card);
            continue;
        }
        const key = `${card.rank}_${card.suit}`;
        let index = faceIndex.get(key);
        if (index === undefined) {
            index = faceCards.length;
            faceIndex.set(key, index);
            faceCards.push([]);
        }
        faceCards[index].push(card);
    }

    // Keep one option per (faces, jokers): where the jokers sit only changes the value.
    const seen = new Map<string, MeldOption>();
    const add = (faces: number[], jokerCount: number, value: number) => {
        const sorted = [...faces].sort((a, b) => a - b);
        const key = `${sorted.join(',')}|${jokerCount}`;
        const prior = seen.get(key);
        if (prior && prior.value >= value) return;
        const charge = sorted.reduce((sum, f) => sum + cardCharge(faceCards[f][0]), 0) + jokerCount * JOKER_CHARGE;
        seen.set(key, { faces: sorted, jokers: jokerCount, value, charge });
    };

    for (const rank of RANKS) {
        const present = SUITS.map(suit => faceIndex.get(`${rank}_${suit}`)).filter(
            (f): f is number => f !== undefined,
        );
        for (let mask = 1; mask < 1 << present.length; mask++) {
            const chosen = present.filter((_f, bit) => mask & (1 << bit));
            for (let j = 0; j <= jokers.length; j++) {
                const size = chosen.length + j;
                if (size < MIN_SET_SIZE || size > MAX_SET_SIZE) continue;
                if (!JOKERS_MAY_OUTNUMBER_NATURALS && j > chosen.length) continue;
                add(chosen, j, rankValue(rank) * size);
            }
        }
    }

    for (const suit of SUITS) {
        for (let low = LOWEST_POSITION; low <= HIGHEST_POSITION - MIN_RUN_LENGTH + 1; low++) {
            const faces: number[] = [];
            let missing = 0;
            let value = 0;
            for (let high = low; high <= HIGHEST_POSITION; high++) {
                const face = faceIndex.get(`${positionRank(high)}_${suit}`);
                const copies = face === undefined ? 0 : faceCards[face].length;
                const usedAlready = face === undefined ? 0 : faces.filter(f => f === face).length;
                if (face !== undefined && usedAlready < copies) faces.push(face);
                else missing++;
                value += positionValue(high);
                if (missing > jokers.length) break;
                if (high - low + 1 < MIN_RUN_LENGTH || faces.length === 0) continue;
                if (!JOKERS_MAY_OUTNUMBER_NATURALS && missing > faces.length) continue;
                add(faces, missing, value);
            }
        }
    }

    return { faceCards, jokers, options: [...seen.values()] };
};

const goalScore = (option: MeldOption, goal: MeldGoal): number => (goal === 'value' ? option.value : option.charge);

/**
 * The disjoint melds worth the most by the goal. Works through the faces in
 * order, and for each either leaves it out or spends it in a meld that starts
 * there, remembering every position it has already worked out.
 */
const searchPool = (pool: Pool, goal: MeldGoal): MeldOption[] => {
    const startingAt: MeldOption[][] = pool.faceCards.map(() => []);
    for (const option of pool.options) {
        if (option.faces.length > 0) startingAt[option.faces[0]].push(option);
    }

    const memo = new Map<string, { score: number; picks: MeldOption[] }>();

    const go = (start: number, counts: number[], jokers: number): { score: number; picks: MeldOption[] } => {
        let from = start;
        while (from < counts.length && counts[from] === 0) from++;
        if (from === counts.length) return { score: 0, picks: [] };

        const key = `${from}|${jokers}|${counts.slice(from).join('')}`;
        const known = memo.get(key);
        if (known) return known;

        let best = go(from + 1, counts, jokers);
        for (const option of startingAt[from]) {
            if (option.jokers > jokers) continue;
            const next = [...counts];
            let fits = true;
            for (const face of option.faces) {
                next[face]--;
                if (next[face] < 0) fits = false;
            }
            if (!fits) continue;
            const after = go(from, next, jokers - option.jokers);
            const score = goalScore(option, goal) + after.score;
            if (score > best.score) best = { score, picks: [option, ...after.picks] };
        }
        memo.set(key, best);
        return best;
    };

    return go(
        0,
        pool.faceCards.map(cards => cards.length),
        pool.jokers.length,
    ).picks;
};

interface Spares {
    faces: PlayingCard[][];
    jokers: PlayingCard[];
}

const sparesOf = (pool: Pool): Spares => ({ faces: pool.faceCards.map(cards => [...cards]), jokers: [...pool.jokers] });

/** Turns an option back into real cards, taking them from the front of each pile of spares. */
const spend = (spare: Spares, option: MeldOption): PlayingCard[] => {
    const cards: PlayingCard[] = [];
    for (const face of option.faces) cards.push(spare.faces[face].shift() as PlayingCard);
    for (let j = 0; j < option.jokers; j++) cards.push(spare.jokers.shift() as PlayingCard);
    return cards;
};

const planScore = (plan: MeldPlan, goal: MeldGoal): number => (goal === 'value' ? plan.value : plan.charge);

/**
 * The best melds in a hand, leaving `reserve` cards behind. The goal is either
 * the most points towards opening, or the most charge got out of the hand.
 */
export const bestMelds = (hand: PlayingCard[], goal: MeldGoal = 'value', reserve: number = HELD_BACK): MeldPlan => {
    if (hand.length < MIN_RUN_LENGTH) return EMPTY_PLAN;
    const pool = buildPool(hand);
    const picks = searchPool(pool, goal);
    const spare = sparesOf(pool);
    const melds = picks.map(option => spend(spare, option));
    const used = melds.reduce((sum, cards) => sum + cards.length, 0);
    const plan: MeldPlan = {
        melds,
        value: picks.reduce((sum, option) => sum + option.value, 0),
        charge: picks.reduce((sum, option) => sum + option.charge, 0),
        used,
    };
    if (hand.length - used >= reserve) return plan;

    // Every card would go down. Hold back whichever one costs the least to keep.
    let best: MeldPlan = EMPTY_PLAN;
    const tried = new Set<string>();
    for (const card of hand) {
        const key = isJoker(card) ? 'joker' : `${card.rank}_${card.suit}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const without = bestMelds(
            hand.filter(other => other !== card),
            goal,
            Math.max(0, reserve - 1),
        );
        if (planScore(without, goal) > planScore(best, goal)) best = without;
    }
    return best;
};

/**
 * The best melds in a hand that spend this particular card, with that card's
 * meld first. Null if no meld can hold it.
 */
export const bestMeldsWith = (
    hand: PlayingCard[],
    cardId: string,
    goal: MeldGoal = 'value',
    reserve: number = HELD_BACK,
): MeldPlan | null => {
    const must = hand.find(card => card.id === cardId);
    if (!must) return null;

    const pool = buildPool(hand);
    const mustFace = isJoker(must)
        ? -1
        : pool.faceCards.findIndex(cards => cards.some(card => card.id === cardId));
    // Put the wanted card at the front of its pile, so that it is the copy spent.
    const front = (spare: Spares): Spares => {
        const pile = mustFace >= 0 ? spare.faces[mustFace] : spare.jokers;
        pile.splice(pile.indexOf(must), 1);
        pile.unshift(must);
        return spare;
    };

    let best: MeldPlan | null = null;
    for (const option of pool.options) {
        const holds = mustFace >= 0 ? option.faces.includes(mustFace) : option.jokers > 0;
        if (!holds) continue;
        const cards = spend(front(sparesOf(pool)), option);
        if (hand.length - cards.length < reserve) continue;
        const rest = bestMelds(
            hand.filter(card => !cards.includes(card)),
            goal,
            reserve,
        );
        const plan: MeldPlan = {
            melds: [cards, ...rest.melds],
            value: option.value + rest.value,
            charge: option.charge + rest.charge,
            used: cards.length + rest.used,
        };
        if (!best || planScore(plan, goal) > planScore(best, goal)) best = plan;
    }
    return best;
};

/**
 * Whether this card, already in the hand, can go down this turn for a player
 * who has opened: on a meld directly, on a meld once the player's other cards
 * have built up to it, or in a new meld.
 */
export const canPlaceCard = (hand: PlayingCard[], cardId: string, melds: Meld[]): boolean => {
    const card = hand.find(other => other.id === cardId);
    if (!card) return false;
    const others = hand.filter(other => other !== card);

    for (const meld of melds) {
        let table = meld;
        let left = others;
        for (;;) {
            if (left.length >= HELD_BACK && layOffOptions(table, card).length > 0) return true;
            const step =
                left.find(other => !isJoker(other) && layOffOptions(table, other).length > 0) ??
                left.find(other => layOffOptions(table, other).length > 0);
            if (!step) break;
            table = layOffOptions(table, step)[0];
            left = left.filter(other => other !== step);
        }
    }
    return bestMeldsWith(hand, cardId, 'charge') !== null;
};

/* ----------------------------------------------------------- the top discard */

export interface TakeCheck {
    hand: PlayingCard[];
    top: PlayingCard | null;
    melds: Meld[];
    opened: boolean;
    opening: number;
}

const asTableMeld = (cards: PlayingCard[], id: string): Meld | null => {
    const shape = arrangeMeld(cards);
    return shape ? { ...shape, id, owner: 'cookie' } : null;
};

/** Why this player may not take the top discard now, in plain words; null if they may. */
export const whyNotTake = ({ hand, top, melds, opened, opening }: TakeCheck): string | null => {
    if (!top) return 'There is nothing on the pile to take.';
    if (!TAKEN_DISCARD_MUST_BE_USED) return null;
    const name = isJoker(top) ? 'the joker' : `the ${cardName(top)}`;
    const withTop = [...hand, top];

    if (opened) {
        if (canPlaceCard(withTop, top.id, melds)) return null;
        return `You can only take ${name} if you can use it this turn, and it will not go down anywhere yet. Draw from the stock instead.`;
    }

    const plan = bestMeldsWith(withTop, top.id, 'value');
    if (plan && plan.value >= opening) return null;

    // Open with what is already in hand, then lay the top card off.
    const alone = bestMelds(hand, 'value');
    if (alone.value >= opening) {
        const laidDown = alone.melds
            .map((cards, i) => asTableMeld(cards, `plan${i}`))
            .filter((meld): meld is Meld => meld !== null);
        const left = hand.filter(card => !alone.melds.some(cards => cards.includes(card)));
        if (canPlaceCard([...left, top], top.id, [...melds, ...laidDown])) return null;
    }

    if (plan) {
        return `With ${name} your melds would be worth ${plan.value}, and you need ${opening} to open. Draw from the stock instead.`;
    }
    return `You can only take ${name} if you can use it this turn, and it does not make a meld with your cards yet. Draw from the stock instead.`;
};

export const takeCheckFor = (state: HandState, player: Player = state.turn): TakeCheck => ({
    hand: state.hands[player],
    top: state.discard[state.discard.length - 1] ?? null,
    melds: state.melds,
    opened: state.opened[player],
    opening: state.opening,
});

/* ------------------------------------------------------------- the moves */

const showing = (player: Player, card: PlayingCard): PlayingCard => turned(card, player === 'cookie');

export const dealHand = (options: {
    seed: number;
    handNo?: number;
    opening?: number;
    handSize?: number;
    starter?: Player;
}): HandState => {
    const {
        seed,
        handNo = 1,
        opening = DEFAULT_OPENING,
        handSize = DEFAULT_HAND_SIZE,
        starter = COOKIE_STARTS_FIRST_HAND ? 'cookie' : 'computer',
    } = options;
    const stock = shuffled(buildDoubleDeck(JOKERS_IN_PACK), mulberry32(seed)).map(card => turned(card, false));
    const hands: Record<Player, PlayingCard[]> = { cookie: [], computer: [] };
    const second = otherPlayer(starter);
    for (let i = 0; i < handSize; i++) {
        hands[starter].push(showing(starter, stock.pop() as PlayingCard));
        hands[second].push(showing(second, stock.pop() as PlayingCard));
    }
    const upCard = turned(stock.pop() as PlayingCard, true);
    return {
        handNo,
        seed,
        opening,
        handSize,
        hands,
        stock,
        discard: [upCard],
        melds: [],
        nextMeldId: 1,
        opened: { cookie: false, computer: false },
        turn: starter,
        phase: 'draw',
        mustUse: [],
        turnMeldValue: 0,
        turnMeldIds: [],
        openedThisTurn: false,
        interest: { cookie: [], computer: [] },
        turns: 0,
        result: null,
    };
};

/** The charges for a finished hand: the one left holding cards pays, and a kalooki doubles it. */
export const settleHand = (
    hands: Record<Player, PlayingCard[]>,
    wentOut: Player | null,
    kalooki: boolean,
): Record<Player, number> => {
    const charge = (player: Player): number => {
        const owed = handCharge(hands[player]);
        return kalooki && wentOut === otherPlayer(player) ? owed * KALOOKI_MULTIPLIER : owed;
    };
    return { cookie: charge('cookie'), computer: charge('computer') };
};

const finish = (state: HandState, wentOut: Player | null): HandState => {
    const kalooki = wentOut !== null && state.openedThisTurn;
    return {
        ...state,
        phase: 'over',
        mustUse: [],
        result: { wentOut, kalooki, charges: settleHand(state.hands, wentOut, kalooki) },
    };
};

const nextTurn = (state: HandState): HandState => ({
    ...state,
    turn: otherPlayer(state.turn),
    phase: 'draw',
    mustUse: [],
    turnMeldValue: 0,
    turnMeldIds: [],
    openedThisTurn: false,
    turns: state.turns + 1,
});

/** Turns the discard pile over, keeping its top card, to make a new stock. */
export const turnOverDiscards = (state: HandState): HandState => {
    if (state.stock.length > 0 || state.discard.length <= 1) return state;
    const top = state.discard[state.discard.length - 1];
    // Turning a pile over puts the first card ever discarded on top.
    const turnedOver = state.discard
        .slice(0, -1)
        .reverse()
        .map(card => turned(card, false));
    const stock = SHUFFLE_TURNED_STOCK ? shuffled(turnedOver, mulberry32(state.seed + state.turns)) : turnedOver;
    return { ...state, stock, discard: [top] };
};

export const drawFromStock = (state: HandState): Outcome => {
    if (state.phase !== 'draw') return fail('You have already picked up a card this turn.');
    const refilled = turnOverDiscards(state);
    if (refilled.stock.length === 0) {
        // Every other card is in a hand or on the table. Nothing left to do but count up.
        return done(finish(refilled, null));
    }
    const player = refilled.turn;
    const stock = refilled.stock.slice(0, -1);
    const card = showing(player, refilled.stock[refilled.stock.length - 1]);
    return done({
        ...refilled,
        stock,
        hands: { ...refilled.hands, [player]: [...refilled.hands[player], card] },
        phase: 'play',
    });
};

export const takeDiscard = (state: HandState): Outcome => {
    if (state.phase !== 'draw') return fail('You have already picked up a card this turn.');
    const why = whyNotTake(takeCheckFor(state));
    if (why) return fail(why);
    const player = state.turn;
    const top = state.discard[state.discard.length - 1];
    const card = showing(player, top);
    return done({
        ...state,
        discard: state.discard.slice(0, -1),
        hands: { ...state.hands, [player]: [...state.hands[player], card] },
        phase: 'play',
        mustUse: TAKEN_DISCARD_MUST_BE_USED ? [card.id] : [],
        interest: {
            ...state.interest,
            [player]: isJoker(card) ? state.interest[player] : [...state.interest[player], faceOf(card)],
        },
    });
};

const pickCards = (hand: PlayingCard[], ids: string[]): PlayingCard[] | null => {
    const cards = ids.map(id => hand.find(card => card.id === id));
    if (new Set(ids).size !== ids.length || cards.some(card => !card)) return null;
    return cards as PlayingCard[];
};

const KEEP_ONE = 'Keep one card back: you go out by discarding your last card.';
const DRAW_FIRST = 'Pick up a card first.';

const shownInterest = (state: HandState, player: Player, cards: PlayingCard[]) => ({
    ...state.interest,
    [player]: [...state.interest[player], ...naturalsOf(cards).map(faceOf)],
});

/** Lays the chosen cards down as a new meld. */
export const meldCards = (state: HandState, ids: string[]): Outcome => {
    if (state.phase !== 'play') return fail(DRAW_FIRST);
    const player = state.turn;
    const hand = state.hands[player];
    const cards = pickCards(hand, ids);
    if (!cards) return fail('Those cards are not in your hand.');
    const shape = arrangeMeld(cards);
    if (!shape) return fail(whyNotMeld(cards));
    if (hand.length - cards.length < HELD_BACK) return fail(KEEP_ONE);

    const meld: Meld = {
        ...shape,
        id: `m${state.nextMeldId}`,
        owner: player,
        cards: shape.cards.map(card => turned(card, true)),
    };
    const turnMeldValue = state.turnMeldValue + meldValue(meld);
    const opensNow = !state.opened[player] && turnMeldValue >= state.opening;
    const next: HandState = {
        ...state,
        hands: { ...state.hands, [player]: hand.filter(card => !cards.includes(card)) },
        melds: [...state.melds, meld],
        nextMeldId: state.nextMeldId + 1,
        turnMeldValue,
        turnMeldIds: [...state.turnMeldIds, meld.id],
        opened: opensNow ? { ...state.opened, [player]: true } : state.opened,
        openedThisTurn: state.openedThisTurn || opensNow,
        mustUse: state.mustUse.filter(id => !ids.includes(id)),
        interest: shownInterest(state, player, cards),
    };
    return done(next.hands[player].length === 0 ? finish(next, player) : next);
};

/** Adds the chosen cards to a meld on the table: anyone's, once you have opened. */
export const layOffCards = (state: HandState, meldId: string, ids: string[]): Outcome => {
    if (state.phase !== 'play') return fail(DRAW_FIRST);
    const player = state.turn;
    if (LAY_OFF_NEEDS_OPENING && !state.opened[player]) {
        return fail(`You can add to melds once you have opened with ${state.opening} points.`);
    }
    const meld = state.melds.find(other => other.id === meldId);
    if (!meld) return fail('That meld is not on the table.');
    const hand = state.hands[player];
    const cards = pickCards(hand, ids);
    if (!cards || cards.length === 0) return fail('Pick a card from your hand first, then tap the meld.');
    const result = layOffMany(meld, cards);
    if (!result) {
        return fail(
            cards.length > 1
                ? 'Those cards do not all fit on that meld.'
                : `The ${cardName(cards[0])} does not fit on that meld.`,
        );
    }
    if (hand.length - cards.length < HELD_BACK) return fail(KEEP_ONE);

    const next: HandState = {
        ...state,
        hands: { ...state.hands, [player]: hand.filter(card => !cards.includes(card)) },
        melds: state.melds.map(other => (other.id === meldId ? result : other)),
        mustUse: state.mustUse.filter(id => !ids.includes(id)),
        interest: shownInterest(state, player, cards),
    };
    return done(next.hands[player].length === 0 ? finish(next, player) : next);
};

/** Gives the natural card a joker stands for and takes the joker into hand, to use this turn. */
export const swapJoker = (state: HandState, meldId: string, cardId: string): Outcome => {
    if (state.phase !== 'play') return fail(DRAW_FIRST);
    const player = state.turn;
    if (SWAP_NEEDS_OPENING && !state.opened[player]) {
        return fail(`You can swap a joker once you have opened with ${state.opening} points.`);
    }
    const meld = state.melds.find(other => other.id === meldId);
    if (!meld) return fail('That meld is not on the table.');
    const hand = state.hands[player];
    const card = hand.find(other => other.id === cardId);
    if (!card) return fail('Pick a card from your hand first.');
    if (!meld.cards.some(isJoker)) return fail('That meld has no joker in it.');

    const swapped = swapOut(meld, card);
    if (!swapped) {
        const needed = meld.stands.filter((_face, i) => isJoker(meld.cards[i])).map(faceLabel);
        return fail(`To swap, give the card that joker stands for: ${needed.join(' or ')}.`);
    }
    const joker = showing(player, swapped.joker);
    const nextHand = [...hand.filter(other => other !== card), joker];
    const melds = state.melds.map(other => (other.id === meldId ? swapped.meld : other));
    if (SWAPPED_JOKER_MUST_BE_USED && !canPlaceCard(nextHand, joker.id, melds)) {
        return fail('There would be nowhere to put the joker this turn, and it has to go straight back down.');
    }
    return done({
        ...state,
        hands: { ...state.hands, [player]: nextHand },
        melds,
        mustUse: SWAPPED_JOKER_MUST_BE_USED ? [...state.mustUse, joker.id] : state.mustUse,
        interest: shownInterest(state, player, [card]),
    });
};

/** Ends the turn by throwing a card on the pile. If it was the last card, the player is out. */
export const discardCard = (state: HandState, cardId: string): Outcome => {
    if (state.phase !== 'play') return fail(DRAW_FIRST);
    const player = state.turn;
    const hand = state.hands[player];
    const card = hand.find(other => other.id === cardId);
    if (!card) return fail('Pick a card from your hand first.');

    const stillToUse = hand.find(other => state.mustUse.includes(other.id));
    if (stillToUse) {
        const name = isJoker(stillToUse) ? 'the joker' : `the ${cardName(stillToUse)}`;
        return fail(`You have to use ${name} in a meld before you discard.`);
    }
    if (state.turnMeldIds.length > 0 && !state.opened[player]) {
        return fail(
            `You need ${state.opening} points to open; these are worth ${state.turnMeldValue}. Add another meld, or tap Take back.`,
        );
    }

    const next: HandState = {
        ...state,
        hands: { ...state.hands, [player]: hand.filter(other => other !== card) },
        discard: [...state.discard, turned(card, true)],
    };
    return done(next.hands[player].length === 0 ? finish(next, player) : nextTurn(next));
};

/* ---------------------------------------------------------------- checks */

export const everyCard = (state: HandState): PlayingCard[] => [
    ...state.hands.cookie,
    ...state.hands.computer,
    ...state.stock,
    ...state.discard,
    ...state.melds.flatMap(meld => meld.cards),
];

/** Anything wrong with this hand: cards missing or doubled, melds that break the rules. Empty if sound. */
export const handProblems = (state: HandState): string[] => {
    const problems: string[] = [];
    const cards = everyCard(state);
    const ids = new Set(cards.map(card => card.id));
    const expected = 104 + JOKERS_IN_PACK;
    if (cards.length !== expected) problems.push(`${cards.length} cards in play, expected ${expected}`);
    if (ids.size !== cards.length) problems.push('a card appears twice');
    for (const meld of state.melds) {
        if (!meldIsSound(meld)) problems.push(`meld ${meld.id} breaks the rules`);
    }
    for (const id of state.mustUse) {
        if (!state.hands[state.turn].some(card => card.id === id)) problems.push(`must-use ${id} is not in hand`);
    }
    return problems;
};

/* ------------------------------------------------------------- the match */

export interface HandRecord {
    handNo: number;
    wentOut: Player | null;
    kalooki: boolean;
    charges: Record<Player, number>;
}

export interface MatchState {
    /** The chosen settings, used from the next deal. */
    opening: number;
    handSize: number;
    history: HandRecord[];
    totals: Record<Player, number>;
    hand: HandState;
    /** The hand as it was before each thing laid down this turn, for Take back. */
    undo: HandState[];
    winner: Player | 'tie' | null;
}

/** The start of each hand goes back and forth. */
export const starterFor = (handNo: number): Player => {
    const first: Player = COOKIE_STARTS_FIRST_HAND ? 'cookie' : 'computer';
    return handNo % 2 === 1 ? first : otherPlayer(first);
};

export const newMatch = (
    seed: number,
    opening: number = DEFAULT_OPENING,
    handSize: number = DEFAULT_HAND_SIZE,
): MatchState => ({
    opening,
    handSize,
    history: [],
    totals: { cookie: 0, computer: 0 },
    hand: dealHand({ seed, handNo: 1, opening, handSize, starter: starterFor(1) }),
    undo: [],
    winner: null,
});

/** Lower total wins, once someone has reached the limit. */
export const matchWinner = (totals: Record<Player, number>): Player | 'tie' | null => {
    if (totals.cookie < MATCH_LIMIT && totals.computer < MATCH_LIMIT) return null;
    if (totals.cookie === totals.computer) return 'tie';
    return totals.cookie < totals.computer ? 'cookie' : 'computer';
};

/** Adds a finished hand's charges to the match. Safe to call more than once. */
export const recordHand = (match: MatchState): MatchState => {
    const { hand } = match;
    if (hand.phase !== 'over' || !hand.result) return match;
    if (match.history.some(record => record.handNo === hand.handNo)) return match;
    const totals = {
        cookie: match.totals.cookie + hand.result.charges.cookie,
        computer: match.totals.computer + hand.result.charges.computer,
    };
    return {
        ...match,
        totals,
        history: [
            ...match.history,
            {
                handNo: hand.handNo,
                wentOut: hand.result.wentOut,
                kalooki: hand.result.kalooki,
                charges: hand.result.charges,
            },
        ],
        winner: matchWinner(totals),
        undo: [],
    };
};

export const startNextHand = (match: MatchState, seed: number): MatchState => {
    const handNo = match.hand.handNo + 1;
    return {
        ...match,
        hand: dealHand({ seed, handNo, opening: match.opening, handSize: match.handSize, starter: starterFor(handNo) }),
        undo: [],
    };
};

/** Throws this hand in and deals it again. Nobody is charged. */
export const redealHand = (match: MatchState, seed: number): MatchState => {
    const { handNo } = match.hand;
    return {
        ...match,
        hand: dealHand({ seed, handNo, opening: match.opening, handSize: match.handSize, starter: starterFor(handNo) }),
        undo: [],
    };
};

/* ------------------------------------------------------- the line on screen */

/** The one line that always says what to do next. */
export const statusLine = (state: HandState, selected: PlayingCard[], choosingSwap = false): string => {
    if (state.phase === 'over') return 'The hand is over';
    if (state.turn === 'computer') return 'Computer is thinking…';
    if (state.phase === 'draw') return 'Draw a card, or take the top discard';
    if (choosingSwap) return 'Tap the meld that holds the joker';

    const shape = selected.length > 0 ? arrangeMeld(selected) : null;
    if (!state.opened.cookie) {
        const worth = state.turnMeldValue + (shape ? meldValue(shape) : 0);
        if (shape || state.turnMeldValue > 0) {
            if (worth >= state.opening) return `These are worth ${worth}, enough to open. Press Meld`;
            return `You need ${state.opening} points to open; these are worth ${worth}`;
        }
    }

    if (shape) return 'Press Meld to lay these down';
    const owing = state.hands.cookie.find(card => state.mustUse.includes(card.id));
    if (owing) {
        const name = isJoker(owing) ? 'the joker' : `the ${cardName(owing)}`;
        return `Now use ${name}: pick cards to meld with it, or tap a meld to add it`;
    }
    if (state.hands.cookie.length === 1) return 'Discard your last card to go out!';
    if (selected.length === 1) {
        return state.opened.cookie ? 'Press Discard, or tap a meld to add this card' : 'Press Discard to throw this card away';
    }
    if (!state.opened.cookie) return `Pick cards to meld (${state.opening} points to open), or one card to discard`;
    return 'Meld, lay off, then discard';
};

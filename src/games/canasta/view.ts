import type { PlayingCard } from '../shared/cards';
import {
    arrangeSelection,
    checkMeld,
    findMinimumMeld,
    isNatural,
    isWild,
    minimumFor,
    type HandState,
    type MeldCheck,
    type MeldGroup,
    type MeldRank,
    type Player,
    type Verdict,
} from './rules';

/** Small questions the table asks of the rules: how to sort a hand, what to say next. */

const RANK_ORDER = ['joker', '2', 'ace', 'king', 'queen', 'jack', '10', '9', '8', '7', '6', '5', '4', '3'];
const SUIT_ORDER = ['spades', 'hearts', 'clubs', 'diamonds'];

/** By rank with wilds at the left, so that pairs and triples sit side by side. */
export const sortHand = (cards: PlayingCard[]): PlayingCard[] =>
    [...cards].sort(
        (a, b) =>
            RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) ||
            SUIT_ORDER.indexOf(a.suit ?? '') - SUIT_ORDER.indexOf(b.suit ?? '') ||
            a.copy - b.copy,
    );

export interface MeldAttempt {
    groups: MeldGroup[];
    check: MeldCheck;
}

/** Can these chosen cards go down, as new melds or onto the named meld? */
export const tryMeld = (hand: HandState, cards: PlayingCard[], target?: MeldRank): Verdict<MeldAttempt> => {
    const player = hand.players.cookie;
    const arranged = arrangeSelection(player, cards, target);
    if (!arranged.ok) return arranged;
    const check = checkMeld(hand, 'cookie', arranged.value);
    if (!check.ok) return check;
    return { ok: true, value: { groups: arranged.value, check: check.value } };
};

/** Is there anything in this hand worth trying to meld right now? */
export const hasMeldToMake = (hand: HandState, player: Player): boolean => {
    if (player.melds.length === 0) return findMinimumMeld(player.hand, minimumFor(hand, 'cookie')) !== null;
    if (player.hand.some(card => isNatural(card) && player.melds.some(meld => meld.rank === card.rank))) return true;
    if (player.hand.some(isWild)) return true;
    const counts = new Map<string, number>();
    for (const card of player.hand) {
        if (isNatural(card) && card.rank !== '3') counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    }
    return [...counts.values()].some(count => count >= 3);
};

export interface Status {
    line: string;
    hint?: string;
}

export const statusFor = (options: {
    hand: HandState;
    selected: PlayingCard[];
    canTake: boolean;
    canGoOut: boolean;
    meld: Verdict<MeldAttempt> | null;
    canLayOff: boolean;
    lastAction: string | null;
}): Status => {
    const { hand, selected, canTake, canGoOut, meld, canLayOff, lastAction } = options;
    const player = hand.players.cookie;
    const minimum = minimumFor(hand, 'cookie');
    const firstMeldHint = player.melds.length === 0 ? `Your first meld needs ${minimum} points.` : undefined;

    if (hand.phase === 'over') return { line: 'The hand is over.' };
    if (hand.turn === 'computer') return { line: 'Computer is thinking…', hint: lastAction ?? undefined };

    if (hand.phase === 'draw') {
        if (hand.stock.length === 0) return { line: 'The stock is empty, so take the pile', hint: lastAction ?? undefined };
        return {
            line: canTake ? 'Draw two cards, or take the pile' : 'Draw two cards',
            hint: lastAction ?? firstMeldHint,
        };
    }

    if (selected.length === 0) {
        if (canGoOut) return { line: 'You can go out now, or keep playing', hint: 'Or meld, lay off and discard as usual.' };
        return hasMeldToMake(hand, player)
            ? { line: 'Meld or lay off, then discard', hint: firstMeldHint ?? 'Tap cards to choose them.' }
            : { line: 'Tap a card, then Discard', hint: firstMeldHint };
    }
    if (selected.length === 1) {
        return canLayOff
            ? { line: 'Press Discard, or tap one of your melds to add it' }
            : { line: 'Press Discard to throw this card away', hint: firstMeldHint };
    }
    if (meld?.ok) return { line: 'Press Meld to put these cards down' };
    if (canLayOff) return { line: 'Tap one of your melds to add these cards' };
    return { line: 'Meld or lay off, then discard', hint: meld && !meld.ok ? meld.reason : firstMeldHint };
};

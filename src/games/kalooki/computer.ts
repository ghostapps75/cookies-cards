import type { Rank } from '../../types';
import { RANKS } from '../../utils/gameLogic';
import { isJoker, type PlayingCard } from '../shared/cards';
import {
    GO_OUT_NEEDS_DISCARD,
    bestMelds,
    bestMeldsWith,
    canPlaceCard,
    cardCharge,
    discardCard,
    drawFromStock,
    layOffCards,
    layOffOptions,
    meldCards,
    otherPlayer,
    swapJoker,
    swapOut,
    takeDiscard,
    whyNotTake,
    type Face,
    type HandState,
    type Meld,
    type Outcome,
    type Player,
} from './rules';

/**
 * The computer as a pure function: given what it can see, its next single move.
 * It is asked again after every move, so the table can show them one at a time.
 */

/** Everything the computer is allowed to know. There is no way to reach Cookie's hand from here. */
export interface ComputerView {
    phase: 'draw' | 'play';
    hand: PlayingCard[];
    melds: Meld[];
    discardTop: PlayingCard | null;
    opened: boolean;
    opening: number;
    turnMeldValue: number;
    mustUse: string[];
    opponentOpened: boolean;
    /** Ranks and suits the other player has picked up and laid down. */
    opponentInterest: Face[];
}

export type ComputerMove =
    | { type: 'stock' }
    | { type: 'discardPile' }
    | { type: 'meld'; cardIds: string[] }
    | { type: 'layoff'; meldId: string; cardIds: string[] }
    | { type: 'swap'; meldId: string; cardId: string }
    | { type: 'discard'; cardId: string };

export const viewFor = (state: HandState, player: Player): ComputerView => {
    const opponent = otherPlayer(player);
    return {
        phase: state.phase === 'draw' ? 'draw' : 'play',
        hand: state.hands[player],
        melds: state.melds,
        discardTop: state.discard[state.discard.length - 1] ?? null,
        opened: state.opened[player],
        opening: state.opening,
        turnMeldValue: state.turnMeldValue,
        mustUse: state.mustUse,
        opponentOpened: state.opened[opponent],
        opponentInterest: state.interest[opponent],
    };
};

export const applyMove = (state: HandState, move: ComputerMove): Outcome => {
    switch (move.type) {
        case 'stock':
            return drawFromStock(state);
        case 'discardPile':
            return takeDiscard(state);
        case 'meld':
            return meldCards(state, move.cardIds);
        case 'layoff':
            return layOffCards(state, move.meldId, move.cardIds);
        case 'swap':
            return swapJoker(state, move.meldId, move.cardId);
        case 'discard':
            return discardCard(state, move.cardId);
    }
};

const HELD_BACK = GO_OUT_NEEDS_DISCARD ? 1 : 0;

const meldMove = (cards: PlayingCard[]): ComputerMove => ({ type: 'meld', cardIds: cards.map(card => card.id) });

const position = (rank: Rank): number => RANKS.indexOf(rank) + 1;

/** How far apart two ranks are in a suit, counting an ace at both ends. */
const rankGap = (a: Rank, b: Rank): number => {
    const ends = (rank: Rank) => (rank === 'ace' ? [1, 14] : [position(rank)]);
    let least = 99;
    for (const x of ends(a)) for (const y of ends(b)) least = Math.min(least, Math.abs(x - y));
    return least;
};

/* ---------------------------------------------------------- picking up */

const chooseDraw = (view: ComputerView): ComputerMove => {
    const canTake =
        whyNotTake({
            hand: view.hand,
            top: view.discardTop,
            melds: view.melds,
            opened: view.opened,
            opening: view.opening,
        }) === null;
    return canTake ? { type: 'discardPile' } : { type: 'stock' };
};

/* ------------------------------------------------------- what to throw */

/** How much this card helps what the computer is building. */
const usefulness = (card: PlayingCard, hand: PlayingCard[], inMelds: Set<string>): number => {
    if (isJoker(card)) return 1000;
    let score = inMelds.has(card.id) ? 30 : 0;
    for (const other of hand) {
        if (other === card || isJoker(other)) continue;
        if (other.rank === card.rank && other.suit !== card.suit) score += 8;
        if (other.suit === card.suit) {
            const gap = rankGap(other.rank as Rank, card.rank as Rank);
            if (gap === 1) score += 8;
            else if (gap === 2) score += 4;
        }
    }
    return score;
};

/** How much this card would help the other player, going by what they have shown. */
const danger = (card: PlayingCard, view: ComputerView): number => {
    if (isJoker(card)) return 20;
    let score = 0;
    if (view.melds.some(meld => layOffOptions(meld, card).length > 0)) score += view.opponentOpened ? 10 : 3;
    for (const face of view.opponentInterest) {
        if (face.rank === card.rank) score += 4;
        if (face.suit === card.suit && rankGap(face.rank, card.rank as Rank) <= 2) score += 4;
    }
    return Math.min(score, 20);
};

const chooseDiscard = (view: ComputerView): ComputerMove => {
    const candidates = view.hand.filter(card => !view.mustUse.includes(card.id));
    const pool = candidates.length > 0 ? candidates : view.hand;
    const inMelds = new Set(
        bestMelds(view.hand, 'charge', 0)
            .melds.flat()
            .map(card => card.id),
    );
    let best = pool[0];
    let bestScore = Infinity;
    for (const card of pool) {
        const score = usefulness(card, view.hand, inMelds) + danger(card, view) - cardCharge(card) * 0.5;
        if (score < bestScore) {
            bestScore = score;
            best = card;
        }
    }
    return { type: 'discard', cardId: best.id };
};

/* ------------------------------------------------------- playing a turn */

/** Gets a card that has to go down onto the table, one step at a time. */
const placeMustUse = (view: ComputerView, cardId: string): ComputerMove | null => {
    const card = view.hand.find(other => other.id === cardId);
    if (!card) return null;

    const plan = bestMeldsWith(view.hand, cardId, 'charge');
    if (plan) return meldMove(plan.melds[0]);

    const others = view.hand.filter(other => other !== card);
    if (others.length >= HELD_BACK) {
        for (const meld of view.melds) {
            if (layOffOptions(meld, card).length > 0) {
                return { type: 'layoff', meldId: meld.id, cardIds: [cardId] };
            }
        }
    }

    // It only fits once other cards have built the meld up to it: lay the next of those.
    for (const meld of view.melds) {
        let table = meld;
        let left = others;
        let firstStep: PlayingCard | null = null;
        for (;;) {
            if (firstStep && left.length >= HELD_BACK && layOffOptions(table, card).length > 0) {
                return { type: 'layoff', meldId: meld.id, cardIds: [firstStep.id] };
            }
            const step =
                left.find(other => !isJoker(other) && layOffOptions(table, other).length > 0) ??
                left.find(other => layOffOptions(table, other).length > 0);
            if (!step) break;
            firstStep = firstStep ?? step;
            table = layOffOptions(table, step)[0];
            left = left.filter(other => other !== step);
        }
    }
    return null;
};

const chooseBeforeOpening = (view: ComputerView): ComputerMove => {
    const needed = view.opening - view.turnMeldValue;
    const owing = view.mustUse[0];
    if (owing) {
        const withIt = bestMeldsWith(view.hand, owing, 'value');
        if (withIt && withIt.value >= needed) return meldMove(withIt.melds[0]);
        // Otherwise it took the card meaning to open from its hand and lay this off after.
        const others = view.hand.filter(card => card.id !== owing);
        const alone = bestMelds(others, 'value');
        if (alone.value >= needed && alone.melds.length > 0) return meldMove(alone.melds[0]);
    } else {
        const plan = bestMelds(view.hand, 'value');
        if (plan.value >= needed && plan.melds.length > 0) return meldMove(plan.melds[0]);
    }
    return chooseDiscard(view);
};

const chooseAfterOpening = (view: ComputerView): ComputerMove => {
    for (const owing of view.mustUse) {
        const move = placeMustUse(view, owing);
        if (move) return move;
    }

    const plan = bestMelds(view.hand, 'charge');
    if (plan.melds.length > 0) return meldMove(plan.melds[0]);

    const dearestFirst = [...view.hand].sort((a, b) => cardCharge(b) - cardCharge(a));
    const naturalsFirst = [...dearestFirst.filter(card => !isJoker(card)), ...dearestFirst.filter(isJoker)];
    if (view.hand.length > HELD_BACK) {
        for (const card of naturalsFirst) {
            for (const meld of view.melds) {
                if (layOffOptions(meld, card).length > 0) {
                    return { type: 'layoff', meldId: meld.id, cardIds: [card.id] };
                }
            }
        }
    }

    // Nothing else will go down. A swap sheds this card as long as the joker has somewhere to go.
    for (const card of dearestFirst) {
        for (const meld of view.melds) {
            const swapped = swapOut(meld, card);
            if (!swapped) continue;
            const hand = [...view.hand.filter(other => other !== card), swapped.joker];
            const melds = view.melds.map(other => (other.id === meld.id ? swapped.meld : other));
            if (canPlaceCard(hand, swapped.joker.id, melds)) {
                return { type: 'swap', meldId: meld.id, cardId: card.id };
            }
        }
    }

    return chooseDiscard(view);
};

/** The computer's next single move. */
export const chooseMove = (view: ComputerView): ComputerMove => {
    if (view.phase === 'draw') return chooseDraw(view);
    return view.opened ? chooseAfterOpening(view) : chooseBeforeOpening(view);
};

import { create } from 'zustand';
import type { Card, Pile, PileType } from '../types';
import { createDeck, shuffleDeck } from '../utils/gameLogic';

interface GameState {
    piles: Pile[];
    draggedCardId: string | null;
    draggedFromPileId: string | null;

    // Actions
    initializeGame: () => void;
    drawCards: () => void;
    startDrag: (pileId: string, cardId: string) => void;
    endDrag: (targetPileId: string | null) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
    piles: [],
    draggedCardId: null,
    draggedFromPileId: null,

    initializeGame: () => {
        const deck = shuffleDeck(createDeck());
        const piles: Pile[] = [];

        // 7 Tableau Piles (Upscaled Math: 150px columns, starting lower at 220px)
        for (let i = 0; i < 7; i++) {
            const cards = deck.splice(0, i + 1);
            cards[cards.length - 1].isFaceUp = true;
            piles.push({
                id: `tableau-${i}`,
                type: 'tableau',
                cards,
                x: i * 150,
                y: 220,
            });
        }

        // Foundations (Aligns perfectly starting at the 4th column)
        for (let i = 0; i < 4; i++) {
            piles.push({
                id: `foundation-${i}`,
                type: 'foundation',
                cards: [],
                x: 450 + i * 150,
                y: 20,
            });
        }

        // Waste (Aligns with 2nd column)
        piles.push({
            id: 'waste',
            type: 'waste',
            cards: [],
            x: 150,
            y: 20,
        });

        // Stock (Aligns with 1st column)
        piles.push({
            id: 'stock',
            type: 'stock',
            cards: deck,
            x: 0,
            y: 20,
        });

        set({ piles });
    },

    drawCards: () => {
        const { piles } = get();
        const stockPile = piles.find(p => p.id === 'stock');
        const wastePile = piles.find(p => p.id === 'waste');

        if (!stockPile || !wastePile) return;

        let newPiles = [...piles];

        if (stockPile.cards.length === 0) {
            // Recycle waste to stock
            const recycledCards = [...wastePile.cards].reverse().map(c => ({ ...c, isFaceUp: false }));
            newPiles = newPiles.map(p => {
                if (p.id === 'stock') return { ...p, cards: recycledCards };
                if (p.id === 'waste') return { ...p, cards: [] };
                return p;
            });
        } else {
            // Draw 3
            const drawnCount = Math.min(3, stockPile.cards.length);
            const drawnCards = stockPile.cards.splice(-drawnCount).reverse().map(c => ({ ...c, isFaceUp: true }));

            newPiles = newPiles.map(p => {
                if (p.id === 'stock') return { ...p, cards: [...stockPile.cards] };
                if (p.id === 'waste') return { ...p, cards: [...p.cards, ...drawnCards] };
                return p;
            });
        }

        set({ piles: newPiles });
    },

    startDrag: (pileId, cardId) => {
        set({
            draggedCardId: cardId,
            draggedFromPileId: pileId,
        });
    },

    endDrag: (targetPileId) => {
        const { draggedCardId, draggedFromPileId, piles } = get();
        if (!draggedCardId || !draggedFromPileId) return;

        const sourcePile = piles.find(p => p.id === draggedFromPileId);
        if (!sourcePile) return;

        const cardIndex = sourcePile.cards.findIndex(c => c.id === draggedCardId);
        if (cardIndex === -1) {
            set({ draggedCardId: null, draggedFromPileId: null });
            return;
        }

        const subStack = sourcePile.cards.slice(cardIndex);
        const targetPile = targetPileId ? piles.find(p => p.id === targetPileId) : null;
        let success = false;

        if (targetPile && targetPile.id !== draggedFromPileId) {
            const headCard = subStack[0];
            const topCard = targetPile.cards[targetPile.cards.length - 1];

            if (targetPile.type === 'tableau') {
                if (!topCard) {
                    success = headCard.rank === 'king';
                } else if (topCard.isFaceUp) {
                    const isOppositeColor = (['hearts', 'diamonds'].includes(headCard.suit) !== ['hearts', 'diamonds'].includes(topCard.suit));
                    const isNextRank = getRankValue(topCard.rank) === getRankValue(headCard.rank) + 1;
                    success = isOppositeColor && isNextRank;
                }
            } else if (targetPile.type === 'foundation' && subStack.length === 1) {
                if (!topCard) {
                    success = headCard.rank === 'ace';
                } else {
                    const isSameSuit = headCard.suit === topCard.suit;
                    const isNextRank = getRankValue(headCard.rank) === getRankValue(topCard.rank) + 1;
                    success = isSameSuit && isNextRank;
                }
            }
        }

        if (success && targetPile) {
            set({
                piles: piles.map(p => {
                    if (p.id === draggedFromPileId) {
                        return { ...p, cards: p.cards.slice(0, cardIndex) };
                    }
                    if (p.id === targetPile.id) {
                        return { ...p, cards: [...p.cards, ...subStack] };
                    }
                    return p;
                }),
                draggedCardId: null,
                draggedFromPileId: null
            });
        } else {
            set({ draggedCardId: null, draggedFromPileId: null });
        }

        // Auto-flip logic: if the original pile now has a face-down top card, flip it
        set(state => ({
            piles: state.piles.map(p => {
                if (p.id === draggedFromPileId && p.cards.length > 0 && !p.cards[p.cards.length - 1].isFaceUp && p.type === 'tableau') {
                    const newCards = [...p.cards];
                    newCards[newCards.length - 1] = { ...newCards[newCards.length - 1], isFaceUp: true };
                    return { ...p, cards: newCards };
                }
                return p;
            })
        }));
    }
}));

const getRankValue = (rank: string): number => {
    const values: Record<string, number> = {
        'ace': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
        '8': 8, '9': 9, '10': 10, 'jack': 11, 'queen': 12, 'king': 13
    };
    return values[rank];
};
import React from 'react';
import type { Card as CardType } from '../types';
import Card from './Card';

interface TableauPileProps {
    cards: CardType[];
    pileId: string;
    onDragStart: (pileId: string, cardId: string) => void;
    onDragEnd: (point: { x: number; y: number }) => void;
}

const TableauPile: React.FC<TableauPileProps> = ({ cards, pileId, onDragStart, onDragEnd }) => {
    if (cards.length === 0) return null;

    const [first, ...rest] = cards;

    return (
        <div data-pile-id={pileId} style={{ overflow: 'visible' }}>
            <Card
                card={first}
                pileId={pileId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                {rest.length > 0 && (
                    <div style={{ position: 'absolute', top: first.isFaceUp ? 25 : 10, left: 0 }}>
                        <TableauPile
                            cards={rest}
                            pileId={pileId}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                        />
                    </div>
                )}
            </Card>
        </div>
    );
};

export default TableauPile;

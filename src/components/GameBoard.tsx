import React, { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import Card from './Card';
import TableauPile from './TableauPile';

const GameBoard: React.FC = () => {
    const { piles, initializeGame, drawCards, startDrag, endDrag } = useGameStore();

    useEffect(() => {
        initializeGame();
    }, [initializeGame]);

    // Handle the drop logic using "Elements From Point"
    // This finds the pile under the mouse when you let go
    const handleDrop = (point: { x: number; y: number }) => {
        const elements = document.elementsFromPoint(point.x, point.y);

        // Find the first element with a data-pile-id attribute
        const targetElement = elements.find(el => el.hasAttribute('data-pile-id'));
        const targetPileId = targetElement?.getAttribute('data-pile-id');

        endDrag(targetPileId || null);
    };

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                backgroundColor: '#1a472a', // Casino Green
                position: 'relative',
                overflow: 'hidden', // Keeps the window clean
                userSelect: 'none'
            }}
        >
            {piles.map(pile => (
                <div
                    key={pile.id}
                    data-pile-id={pile.id} // Essential for the drop detector to find this pile!
                    style={{
                        position: 'absolute',
                        left: pile.x,
                        top: pile.y,
                        width: 100,
                        height: 140,
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        // overflow: 'visible' is default for divs, so cards can fly out
                    }}
                    onClick={() => pile.id === 'stock' ? drawCards() : null}
                >
                    {/* Render Tableau Piles Recursively */}
                    {pile.type === 'tableau' ? (
                        <TableauPile
                            cards={pile.cards}
                            pileId={pile.id}
                            onDragStart={startDrag}
                            onDragEnd={handleDrop}
                        />
                    ) : (
                        // Render Foundations/Stock/Waste normally (Flat)
                        pile.cards.map((card, index) => (
                            <div
                                key={card.id}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    zIndex: index
                                }}
                            >
                                <Card
                                    card={card}
                                    pileId={pile.id}
                                    onDragStart={startDrag}
                                    onDragEnd={handleDrop}
                                />
                            </div>
                        ))
                    )}
                </div>
            ))}
        </div>
    );
};

export default GameBoard;
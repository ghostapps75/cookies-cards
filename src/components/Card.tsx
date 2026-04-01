import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Card as CardType } from '../types';
import { getCardImageUrl, getCardBackUrl } from '../utils/assets';

interface CardProps {
    card: CardType;
    pileId: string;
    onDragStart?: (pileId: string, cardId: string) => void;
    onDragEnd?: (point: { x: number; y: number }) => void;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ card, pileId, onDragStart, onDragEnd, style, children }) => {
    // Local hover state to prevent "Bulging" parents
    const [isHovered, setIsHovered] = useState(false);

    return (
        <motion.div
            layoutId={card.id}
            // Only allow dragging if face up
            drag={card.isFaceUp}
            // 1. FIX MOLASSES: dragElastic={1} means 1:1 movement
            dragElastic={1}
            // 2. STOP SLIDING: Stop instantly when released
            dragMomentum={false}
            // 3. SNAP BACK: If invalid, snap back to origin
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}

            // Events
            onDragStart={() => onDragStart?.(pileId, card.id)}
            onDragEnd={(_, info) => onDragEnd?.(info.point)}

            // HOVER FIX: Stop propagation to prevent parent growth
            onPointerEnter={(e) => {
                e.stopPropagation();
                if (card.isFaceUp) setIsHovered(true);
            }}
            onPointerLeave={(e) => {
                e.stopPropagation();
                setIsHovered(false);
            }}

            // Visuals
            animate={{
                scale: isHovered ? 1.05 : 1,
                zIndex: isHovered ? 10 : 1
            }}
            whileDrag={{
                scale: 1.1,
                zIndex: 1000,
                cursor: 'grabbing',
                boxShadow: "0px 15px 30px rgba(0,0,0,0.3)"
            }}

            style={{
                ...style,
                width: 130,   // UPSCALED FOR CASINO SIZE
                height: 182,  // UPSCALED FOR CASINO SIZE
                position: 'relative', // Relative allows children to stack correctly
                backgroundColor: 'white', // Creates the white card border
                borderRadius: 8,
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                // PREVENT TEXT SELECTION WHILE DRAGGING
                userSelect: 'none',
                // ALLOW CHILDREN TO SHOW (Recursive Stack)
                overflow: 'visible',
                cursor: card.isFaceUp ? (isHovered ? 'grab' : 'pointer') : 'default'
            }}
        >
            <img
                src={card.isFaceUp ? getCardImageUrl(card.rank, card.suit) : getCardBackUrl()}
                alt={`${card.rank} of ${card.suit}`}
                draggable={false} // Disable native browser image drag ghost
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain', // Prevents stretching/squishing
                    padding: '6px',       // Forces white space around the numbers
                    pointerEvents: 'none', // Let clicks pass through image to the motion.div
                    display: 'block'
                }}
            />
            {/* Render the rest of the stack inside this card */}
            {children}
        </motion.div>
    );
};

export default Card;
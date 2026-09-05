import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Card as CardType, PileId } from '../types';
import { getCardBackUrl, getCardImageUrl } from '../utils/assets';
import { CARD_H, CARD_RADIUS, CARD_W } from '../utils/layout';

interface CardProps {
    card: CardType;
    pileId: PileId;
    x: number;
    y: number;
    z: number;
    /** Where the card flies in from when a new hand is dealt. */
    from?: { x: number; y: number };
    dragging?: boolean;
    hinted?: boolean;
    interactive?: boolean;
    /** Only the card on top of a pile lifts under the cursor; a card in the
     *  middle of a fan must stay tucked under the ones covering it. */
    topOfPile?: boolean;
    /** Stable across renders: the card hands its own identity back up. */
    onPointerDown?: (event: React.PointerEvent, card: CardType, pileId: PileId) => void;
}

const faceStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    backgroundColor: '#fdfdfb',
};

const imgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none',
    userSelect: 'none',
};

const RESTING_SHADOW = '0 1px 2px rgba(0,0,0,0.30), 0 5px 12px rgba(0,0,0,0.22)';
const LIFTED_SHADOW = '0 12px 26px rgba(0,0,0,0.42), 0 28px 52px rgba(0,0,0,0.28)';
const HINT_SHADOW = '0 0 0 3px rgba(255,214,102,0.95), 0 0 26px 6px rgba(255,196,54,0.75)';

const CardView: React.FC<CardProps> = ({
    card,
    pileId,
    x,
    y,
    z,
    from,
    dragging = false,
    hinted = false,
    interactive = false,
    topOfPile = false,
    onPointerDown,
}) => {
    const [hovered, setHovered] = useState(false);

    // A card in flight has to ride above everything it passes over, then drop
    // back into its pile's own order once it lands.
    const [flying, setFlying] = useState(true);

    const raised = interactive && hovered && topOfPile;

    return (
        <motion.div
            initial={from ? { x: from.x, y: from.y, scale: 0.92 } : false}
            animate={{
                x,
                y: y - (raised ? 7 : 0),
                scale: dragging ? 1.06 : 1,
                rotate: dragging ? -2.5 : 0,
            }}
            transition={
                dragging
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }
            }
            onAnimationStart={() => setFlying(true)}
            onAnimationComplete={() => setFlying(false)}
            onPointerDown={onPointerDown && (event => onPointerDown(event, card, pileId))}
            onPointerEnter={() => interactive && setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: CARD_W,
                height: CARD_H,
                zIndex: dragging ? 100000 : flying ? 900 + z : z,
                perspective: 1400,
                cursor: interactive ? (dragging ? 'grabbing' : 'grab') : 'default',
                touchAction: 'none',
                willChange: 'transform',
            }}
        >
            <motion.div
                animate={{ rotateY: card.isFaceUp ? 0 : 180 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative',
                    transformStyle: 'preserve-3d',
                    borderRadius: CARD_RADIUS,
                    boxShadow: hinted ? HINT_SHADOW : dragging || raised ? LIFTED_SHADOW : RESTING_SHADOW,
                    transition: 'box-shadow 160ms ease',
                }}
            >
                <div style={faceStyle}>
                    <img
                        src={getCardImageUrl(card.rank, card.suit)}
                        alt={`${card.rank} of ${card.suit}`}
                        draggable={false}
                        style={imgStyle}
                    />
                </div>
                <div style={{ ...faceStyle, transform: 'rotateY(180deg)' }}>
                    <img
                        src={getCardBackUrl()}
                        alt=""
                        draggable={false}
                        style={{ ...imgStyle, objectFit: 'cover' }}
                    />
                </div>
            </motion.div>
        </motion.div>
    );
};

export default React.memo(CardView);

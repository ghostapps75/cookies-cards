import React from 'react';
import { motion } from 'framer-motion';
import { getCardBackUrl, getCardImageUrl } from '../../utils/assets';
import { cardName, isRedCard, type PlayingCard as PlayingCardType } from './cards';
import './shared.css';

/**
 * A card that lives in normal page flow - a hand, a meld, a discard pile -
 * rather than in solitaire's absolute-position layout. Its size comes from the
 * CSS variable --card-w on any ancestor, so a whole table can be resized at
 * once. Cards are tracked by identity across the page: render the same card
 * inside a new parent and it flies there on its own.
 */
interface PlayingCardProps {
    card: PlayingCardType;
    /** Lifted and ringed, the way a chosen card sits in a hand. */
    selected?: boolean;
    /** Faded: a card that cannot be used right now. */
    dimmed?: boolean;
    /** Ringed in gold, for a hint or a legal place to put something. */
    highlighted?: boolean;
    /** Tap or click. The card hands its own identity back. */
    onClick?: (card: PlayingCardType) => void;
    /**
     * Animate between places by identity (the default). Turn it off for cards
     * that never move on their own, such as the face-down stock.
     */
    animate?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

const FLIGHT = { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 } as const;
const FLIP = { type: 'spring', stiffness: 260, damping: 26 } as const;

const PlayingCardView: React.FC<PlayingCardProps> = ({
    card,
    selected = false,
    dimmed = false,
    highlighted = false,
    onClick,
    animate = true,
    className,
    style,
}) => {
    const classes = [
        'pcard',
        onClick && 'is-clickable',
        selected && 'is-selected',
        dimmed && 'is-dimmed',
        highlighted && 'is-highlighted',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    const face =
        card.rank === 'joker' || card.suit === null ? (
            <div className={`pcard-joker${isRedCard(card) ? ' is-red' : ''}`}>🍪</div>
        ) : (
            <img src={getCardImageUrl(card.rank, card.suit)} alt="" draggable={false} />
        );

    return (
        <motion.div
            layout={animate ? 'position' : false}
            layoutId={animate ? card.id : undefined}
            transition={FLIGHT}
            className={classes}
            style={style}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={card.isFaceUp ? cardName(card) : 'a face-down card'}
            aria-pressed={onClick ? selected : undefined}
            onClick={onClick && (() => onClick(card))}
            onKeyDown={
                onClick &&
                (event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onClick(card);
                    }
                })
            }
        >
            <motion.div
                className="pcard-inner"
                animate={{ rotateY: card.isFaceUp ? 0 : 180, y: selected ? -14 : 0 }}
                transition={FLIP}
            >
                <div className="pcard-face">{face}</div>
                <div className="pcard-back">
                    <img src={getCardBackUrl()} alt="" draggable={false} />
                </div>
            </motion.div>
        </motion.div>
    );
};

export default React.memo(PlayingCardView);

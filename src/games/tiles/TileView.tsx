import React from 'react';
import { motion } from 'framer-motion';
import { isJoker, tileName, type JokerRole, type Tile } from './rules';

/**
 * One tile, drawn in CSS and sized by --tile-w on any ancestor. Tiles are tracked
 * by identity: render the same tile in a new place and it flies there. A
 * face-down tile puts nothing about itself in the page, not even its name.
 */

const tileClass = (tile: Tile): string => (isJoker(tile) ? 'is-joker' : `is-${tile.color}`);

/** The printing on a tile. */
const TileFace: React.FC<{ tile: Tile; role?: JokerRole }> = ({ tile, role }) =>
    isJoker(tile) ? (
        <>
            <span className="tile-cookie">🍪</span>
            {role && (
                <span className={`tile-role${role.colors.length === 1 ? ` is-${role.colors[0]}` : ''}`}>
                    {role.number}
                </span>
            )}
        </>
    ) : (
        <>
            <span className="tile-number">{tile.number}</span>
            <span className="tile-dot" />
        </>
    );

/** A tile that goes nowhere: the picture that follows the pointer during a drag. */
export const StaticTile: React.FC<{ tile: Tile }> = ({ tile }) => (
    <div className={`tile ${tileClass(tile)}`}>
        <div className="tile-inner">
            <TileFace tile={tile} />
        </div>
    </div>
);

interface TileViewProps {
    tile: Tile;
    faceDown?: boolean;
    /** Picked up: raised and ringed in gold. */
    lifted?: boolean;
    /** Just played by the computer. */
    fresh?: boolean;
    /** A joker that the tile in hand could be swapped for. */
    swappable?: boolean;
    /** What a joker on the table stands for. */
    role?: JokerRole;
    /** Tap or click. The tile hands back its id. */
    onTap?: (id: string) => void;
}

const FLIGHT = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const;
const LIFT = { type: 'spring', stiffness: 500, damping: 30 } as const;

const TileView: React.FC<TileViewProps> = ({
    tile,
    faceDown = false,
    lifted = false,
    fresh = false,
    swappable = false,
    role,
    onTap,
}) => {
    const classes = [
        'tile',
        faceDown ? 'is-down' : tileClass(tile),
        lifted && 'is-lifted',
        fresh && 'is-fresh',
        swappable && 'is-swap',
        onTap && 'is-tappable',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <motion.div
            layout="position"
            layoutId={tile.id}
            transition={FLIGHT}
            className={classes}
            data-tile={faceDown ? undefined : tile.id}
            role={onTap ? 'button' : undefined}
            tabIndex={onTap ? 0 : undefined}
            aria-label={faceDown ? undefined : tileName(tile)}
            aria-hidden={faceDown ? true : undefined}
            aria-pressed={onTap ? lifted : undefined}
            onClick={
                onTap &&
                (event => {
                    event.stopPropagation();
                    onTap(tile.id);
                })
            }
            onKeyDown={
                onTap &&
                (event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onTap(tile.id);
                    }
                })
            }
        >
            <motion.div
                className="tile-inner"
                animate={{ y: lifted ? 'calc(var(--tile-w) * -0.26)' : 0 }}
                transition={LIFT}
            >
                {!faceDown && <TileFace tile={tile} role={role} />}
            </motion.div>
        </motion.div>
    );
};

export default React.memo(TileView);

/**
 * Sizes the table so that all its sets fit in the window. These numbers are the
 * same ones `tiles.css` lays the table out with.
 */

export const TILE_RATIO = 1.28;
/** The dotted "new set" spot is as wide as a set of this many tiles. */
export const NEW_SET_SPOT_TILES = 2;

export interface Spacing {
    tileGap: number;
    setPad: number;
    setGap: number;
}

export const ROOMY: Spacing = { tileGap: 3, setPad: 4, setGap: 8 };
/** On a phone held sideways, every pixel between tiles is a pixel off the tiles. */
export const SNUG: Spacing = { tileGap: 2, setPad: 3, setGap: 4 };

export interface TableFit {
    /** Tile width in pixels. */
    tile: number;
    /** Even at the smallest size the sets do not fit; let the table scroll. */
    overflows: boolean;
}

/** Packs the sets the way a wrapping flex row would. Does it all fit at this tile size? */
export const fitsAt = (
    tile: number,
    width: number,
    height: number,
    sets: readonly number[],
    { tileGap, setPad, setGap }: Spacing = ROOMY,
): boolean => {
    const tileHeight = Math.round(tile * TILE_RATIO);
    let x = 0;
    let y = 0;
    let rowHeight = 0;

    for (const size of [...sets, NEW_SET_SPOT_TILES]) {
        let setWidth = size * tile + (size - 1) * tileGap + 2 * setPad;
        let setHeight = tileHeight + 2 * setPad;
        if (setWidth > width) {
            // Longer than the table is wide: it wraps inside its own box.
            const perRow = Math.max(1, Math.floor((width - 2 * setPad + tileGap) / (tile + tileGap)));
            const rows = Math.ceil(size / perRow);
            setWidth = width;
            setHeight = rows * tileHeight + (rows - 1) * tileGap + 2 * setPad;
        }
        if (x > 0 && x + setWidth > width) {
            y += rowHeight + setGap;
            x = 0;
            rowHeight = 0;
        }
        x += setWidth + setGap;
        rowHeight = Math.max(rowHeight, setHeight);
    }
    return y + rowHeight <= height;
};

/** The biggest tile that fits, between `min` and `max`. */
export const fitTable = (
    width: number,
    height: number,
    sets: readonly number[],
    min: number,
    max: number,
    spacing: Spacing = ROOMY,
): TableFit => {
    for (let tile = max; tile >= min; tile--) {
        if (fitsAt(tile, width, height, sets, spacing)) return { tile, overflows: false };
    }
    return { tile: min, overflows: true };
};

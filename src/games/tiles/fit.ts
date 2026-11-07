/**
 * Sizes the table so that all its sets fit in the window. These numbers are the
 * same ones `tiles.css` lays the table out with.
 */

export const TILE_RATIO = 1.28;
export const TILE_GAP = 3;
export const SET_PAD = 4;
export const SET_GAP = 8;
/** The dotted "new set" spot is as wide as a set of this many tiles. */
export const NEW_SET_SPOT_TILES = 2;

export interface TableFit {
    /** Tile width in pixels. */
    tile: number;
    /** Even at the smallest size the sets do not fit; let the table scroll. */
    overflows: boolean;
}

/** Packs the sets the way a wrapping flex row would. Does it all fit at this tile size? */
export const fitsAt = (tile: number, width: number, height: number, sets: readonly number[]): boolean => {
    const tileHeight = Math.round(tile * TILE_RATIO);
    let x = 0;
    let y = 0;
    let rowHeight = 0;

    for (const size of [...sets, NEW_SET_SPOT_TILES]) {
        let setWidth = size * tile + (size - 1) * TILE_GAP + 2 * SET_PAD;
        let setHeight = tileHeight + 2 * SET_PAD;
        if (setWidth > width) {
            // Longer than the table is wide: it wraps inside its own box.
            const perRow = Math.max(1, Math.floor((width - 2 * SET_PAD + TILE_GAP) / (tile + TILE_GAP)));
            const rows = Math.ceil(size / perRow);
            setWidth = width;
            setHeight = rows * tileHeight + (rows - 1) * TILE_GAP + 2 * SET_PAD;
        }
        if (x > 0 && x + setWidth > width) {
            y += rowHeight + SET_GAP;
            x = 0;
            rowHeight = 0;
        }
        x += setWidth + SET_GAP;
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
): TableFit => {
    for (let tile = max; tile >= min; tile--) {
        if (fitsAt(tile, width, height, sets)) return { tile, overflows: false };
    }
    return { tile: min, overflows: true };
};

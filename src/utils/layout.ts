import type { Card, CardPlacement, PileId } from '../types';

/**
 * The table is laid out in its own coordinate space and then scaled to fit the
 * screen. Cards are always the same size in that space; what changes with the
 * shape of the screen is how much table surrounds them. A phone held sideways
 * gets a shallow, wide table, which lets the scale factor — and so the cards —
 * come out considerably bigger than a one-size-fits-all board would allow.
 */

export const CARD_W = 132;
export const CARD_H = 192;
export const CARD_RADIUS = 10;

const TOP_Y = 20;
const HEAD_GAP = 44;
const TABLEAU_Y = TOP_Y + CARD_H + HEAD_GAP;
const BOTTOM_PAD = 14;

const MIN_GAP = 26;
const MAX_GAP = 56;
const MIN_MARGIN = 40;

const FAN_DOWN = 15;
const FAN_UP = 42;
const MIN_FAN_DOWN = 6;
// Never squeeze a face-up card below the height of its rank corner.
const MIN_FAN_UP = 20;

/**
 * Cards stop growing at this scale. A big monitor should get a bigger table,
 * not bigger cards: past roughly this size they stop reading as playing cards
 * and start reading as posters. Raise it if you want a chunkier deck.
 */
const MAX_SCALE = 1.1;

const clamp = (min: number, value: number, max: number): number =>
    Math.max(min, Math.min(max, value));

export interface Metrics {
    boardW: number;
    boardH: number;
    tableauRoom: number;
    wasteStep: number;
    origins: Record<PileId, { x: number; y: number }>;
}

export const metricsFor = (containerW: number, containerH: number): Metrics => {
    const aspect = containerW > 0 && containerH > 0 ? containerW / containerH : 16 / 9;

    // Deep table on squarish screens, shallow one on letterbox screens.
    let boardH = clamp(590, 760 - (aspect - 1.5) * 243, 760);
    let boardW = clamp(1160, aspect * boardH, 1760);

    // Past the cap, spend the extra room on table rather than on card size:
    // wider margins, and a deeper tableau so long columns stop compressing.
    if (containerW > 0 && containerH > 0
        && Math.min(containerW / boardW, containerH / boardH) > MAX_SCALE) {
        boardW = containerW / MAX_SCALE;
        boardH = containerH / MAX_SCALE;
    }
    boardW = Math.round(boardW);
    boardH = Math.round(boardH);

    const gap = clamp(MIN_GAP, (boardW - 2 * MIN_MARGIN - 7 * CARD_W) / 6, MAX_GAP);
    const colStep = CARD_W + gap;
    const marginX = Math.round((boardW - (7 * CARD_W + 6 * gap)) / 2);

    const columnX = (col: number) => marginX + col * colStep;
    const origins: Record<PileId, { x: number; y: number }> = {
        stock: { x: columnX(0), y: TOP_Y },
        waste: { x: columnX(1), y: TOP_Y },
    };
    for (let f = 0; f < 4; f++) origins[`foundation-${f}`] = { x: columnX(3 + f), y: TOP_Y };
    for (let t = 0; t < 7; t++) origins[`tableau-${t}`] = { x: columnX(t), y: TABLEAU_Y };

    return {
        boardW,
        boardH,
        tableauRoom: boardH - TABLEAU_Y - BOTTOM_PAD,
        wasteStep: Math.round(Math.min(38, gap + 8)),
        origins,
    };
};

/**
 * Offsets for one tableau column. Long columns compress so the bottom card
 * never falls off the table, but the rank corner always stays readable.
 */
export const tableauOffsets = (cards: Card[], metrics: Metrics): number[] => {
    const faceDown = cards.filter(c => !c.isFaceUp).length;
    const faceUp = cards.length - faceDown;

    let down = FAN_DOWN;
    let up = FAN_UP;

    const needed = faceDown * down + Math.max(0, faceUp - 1) * up + CARD_H;
    if (needed > metrics.tableauRoom) {
        const spare = metrics.tableauRoom - CARD_H;
        const weight = faceDown * FAN_DOWN + Math.max(0, faceUp - 1) * FAN_UP;
        const scale = weight > 0 ? spare / weight : 1;
        down = Math.max(MIN_FAN_DOWN, FAN_DOWN * scale);
        up = Math.max(MIN_FAN_UP, FAN_UP * scale);
    }

    const offsets: number[] = [];
    let y = 0;
    cards.forEach((_, i) => {
        if (i > 0) y += cards[i - 1].isFaceUp ? up : down;
        offsets.push(y);
    });
    return offsets;
};

export interface BoardState {
    stock: Card[];
    waste: Card[];
    foundations: Card[][];
    tableau: Card[][];
    /** How many cards on top of the waste are fanned out. */
    wasteFan: number;
}

/** Where every card on the table belongs right now. */
export const computePlacements = (
    board: BoardState,
    metrics: Metrics,
): Map<string, CardPlacement> => {
    const map = new Map<string, CardPlacement>();
    const { origins } = metrics;

    board.stock.forEach((card, i) => {
        map.set(card.id, {
            x: origins.stock.x,
            // A thicker deck sits very slightly higher: it reads as a real stack.
            y: origins.stock.y - Math.min(6, i * 0.22),
            z: i,
            pileId: 'stock',
        });
    });

    // The cards turned over this go fan out; everything under them is squared
    // up in a single pile, exactly where it would sit on a real table.
    const fanStart = board.waste.length - Math.min(board.wasteFan, board.waste.length);
    board.waste.forEach((card, i) => {
        map.set(card.id, {
            x: origins.waste.x + (i >= fanStart ? (i - fanStart) * metrics.wasteStep : 0),
            y: origins.waste.y,
            z: i,
            pileId: 'waste',
        });
    });

    board.foundations.forEach((pile, f) => {
        const origin = origins[`foundation-${f}`];
        pile.forEach((card, i) => {
            map.set(card.id, { x: origin.x, y: origin.y, z: i, pileId: `foundation-${f}` });
        });
    });

    board.tableau.forEach((pile, t) => {
        const origin = origins[`tableau-${t}`];
        const offsets = tableauOffsets(pile, metrics);
        pile.forEach((card, i) => {
            map.set(card.id, { x: origin.x, y: origin.y + offsets[i], z: i, pileId: `tableau-${t}` });
        });
    });

    return map;
};

export interface DropZone {
    pileId: PileId;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Hit rectangles for dropping. Tableau zones stretch to cover the whole fan. */
export const dropZones = (board: BoardState, metrics: Metrics): DropZone[] => {
    const zones: DropZone[] = [];

    board.foundations.forEach((_, f) => {
        const origin = metrics.origins[`foundation-${f}`];
        zones.push({ pileId: `foundation-${f}`, x: origin.x, y: origin.y, w: CARD_W, h: CARD_H });
    });

    board.tableau.forEach((pile, t) => {
        const origin = metrics.origins[`tableau-${t}`];
        const offsets = tableauOffsets(pile, metrics);
        const last = offsets.length ? offsets[offsets.length - 1] : 0;
        zones.push({ pileId: `tableau-${t}`, x: origin.x, y: origin.y, w: CARD_W, h: last + CARD_H });
    });

    return zones;
};

export const rectOverlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
): number => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
};

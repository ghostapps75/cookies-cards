export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank = 'ace' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'jack' | 'queen' | 'king';

export interface Card {
    id: string;
    suit: Suit;
    rank: Rank;
    isFaceUp: boolean;
}

export type PileType = 'stock' | 'waste' | 'foundation' | 'tableau';

/** e.g. 'stock' | 'waste' | 'foundation-0' | 'tableau-3' */
export type PileId = string;

/** The four kinds of pile, with nothing else about the game attached. */
export interface Board {
    stock: Card[];
    waste: Card[];
    foundations: Card[][];
    tableau: Card[][];
}

/** How many cards a turn of the deck lays on the waste. */
export type DrawCount = 1 | 3;

/** Where a card should be drawn on the logical board. */
export interface CardPlacement {
    x: number;
    y: number;
    z: number;
    /** Cards in a tableau that sit under others are squeezed; used for hit testing. */
    pileId: PileId;
}

export type FeltName = 'green' | 'cookie' | 'plum' | 'midnight';
/** Which side of the table the deck sits on. Cookie is right-handed: the deck on the right. */
export type DrawSide = 'left' | 'right';

export { };

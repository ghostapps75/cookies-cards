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

/** Where a card should be drawn on the logical board. */
export interface CardPlacement {
    x: number;
    y: number;
    z: number;
    /** Cards in a tableau that sit under others are squeezed; used for hit testing. */
    pileId: PileId;
}

export type FeltName = 'green' | 'cookie' | 'plum' | 'midnight';

export { };

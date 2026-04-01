export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank = 'ace' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'jack' | 'queen' | 'king';

export interface Card {
    id: string;
    suit: Suit;
    rank: Rank;
    isFaceUp: boolean;
}

export type PileType = 'stock' | 'waste' | 'foundation' | 'tableau';

export interface Pile {
    id: string;
    type: PileType;
    cards: Card[];
    x: number;
    y: number;
}

// Ensure this file is treated as a module at runtime even if all exports are types
export { };

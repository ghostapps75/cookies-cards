import { lazy } from 'react';
import type { GameDefinition } from '../types';

/** The original. Its code lives in src/components and src/store, from before there were other games. */
export const game: GameDefinition = {
    id: 'solitaire',
    title: 'Solitaire',
    tagline: 'Klondike, the quiet classic. Every hand dealt can be won.',
    mark: '♠️',
    order: 0,
    component: lazy(() => import('../../components/GameBoard')),
};

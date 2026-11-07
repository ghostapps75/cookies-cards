import { lazy } from 'react';
import type { GameDefinition } from '../types';

export const game: GameDefinition = {
    id: 'tiles',
    title: 'Tile Rummy',
    tagline: 'Lay down runs and groups of numbered tiles. Empty your rack first.',
    mark: '🀄',
    order: 3,
    component: lazy(() => import('./TileRummyGame')),
};

import { lazy } from 'react';
import type { GameDefinition } from '../types';

export const game: GameDefinition = {
    id: 'canasta',
    title: 'Canasta',
    tagline: 'Two decks, jokers wild, first to five thousand.',
    mark: '🃏',
    order: 1,
    component: lazy(() => import('./CanastaGame')),
};

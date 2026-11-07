import { lazy } from 'react';
import type { GameDefinition } from '../types';

export const game: GameDefinition = {
    id: 'kalooki',
    title: 'Kalooki',
    tagline: 'Make sets and runs, and be first to get rid of your cards.',
    mark: '🎴',
    order: 2,
    component: lazy(() => import('./KalookiGame')),
};

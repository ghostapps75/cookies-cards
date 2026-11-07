import type { GameDefinition } from './types';

/**
 * Finds every game folder at build time. Add a folder with an index.ts that
 * exports `game` and it appears on the home screen; delete the folder and it
 * is gone. The shared kit has no index.ts on purpose.
 */
const modules = import.meta.glob<{ game: GameDefinition }>('./*/index.ts', { eager: true });

export const games: GameDefinition[] = Object.values(modules)
    .map(module => module.game)
    .filter((game): game is GameDefinition => Boolean(game))
    .sort((a, b) => a.order - b.order);

export const findGame = (id: string): GameDefinition | undefined => games.find(game => game.id === id);

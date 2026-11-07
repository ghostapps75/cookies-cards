import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * One game on the home screen. Every folder under src/games with an index.ts
 * that exports `game` is picked up by the registry on its own; nothing else in
 * the app has to know a game exists.
 */
export interface GameDefinition {
    /** Also the address: the game lives at #/<id>. Lower-case, no spaces. */
    id: string;
    /** Shown after "Cookie's" in the toolbar and on the home tile: "Canasta". */
    title: string;
    /** One line under the title on the home tile. Plain words, no jargon. */
    tagline: string;
    /** A single emoji for the tile. */
    mark: string;
    /** Home-screen order; lower comes first. Solitaire is 0. */
    order: number;
    /**
     * The whole screen, toolbar and all. Lazy, so that one game's code never
     * slows the others down or breaks them.
     */
    component: LazyExoticComponent<ComponentType> | ComponentType;
}

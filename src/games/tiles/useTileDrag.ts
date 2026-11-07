import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTiles } from './store';

/**
 * Drag and drop on top of tapping. A drag is the same thing as lifting a tile and
 * tapping where it should go, so the rules live in one place: the store's taps.
 */

export interface DragGhost {
    x: number;
    y: number;
    /** The tile's width where it was picked up. */
    width: number;
}

/** A finger wobbles. Below this many pixels it is a tap, not a drag. */
const DRAG_START = 9;

/** The click that ends a drag must not also count as a tap. */
const swallowNextClick = (): void => {
    const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
        window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 250);
};

const dropAt = (x: number, y: number): void => {
    const store = useTiles.getState();
    const under = document.elementFromPoint(x, y);
    if (under?.closest('.tile-new-set')) {
        store.tapNewSet();
        return;
    }
    if (under?.closest('[data-rack]')) {
        store.tapRack();
        return;
    }
    const set = under?.closest<HTMLElement>('[data-set]');
    if (set?.dataset.set) {
        store.dropOnSet(set.dataset.set, under?.closest<HTMLElement>('[data-tile]')?.dataset.tile);
        return;
    }
    // Dropped on nothing in particular: it simply goes back where it came from.
    store.tapFelt();
};

export const useTileDrag = (enabled: boolean) => {
    const [ghost, setGhost] = useState<DragGhost | null>(null);

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
        if (!enabled || event.button !== 0) return;
        const tile = (event.target as Element).closest<HTMLElement>('[data-tile]');
        const id = tile?.dataset.tile;
        if (!tile || !id) return;

        const { pointerId, clientX: startX, clientY: startY } = event;
        const width = tile.getBoundingClientRect().width;
        let dragging = false;

        const finish = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
            setGhost(null);
        };

        const move = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            if (!dragging) {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_START) return;
                if (!useTiles.getState().grab(id)) {
                    finish();
                    return;
                }
                dragging = true;
            }
            setGhost({ x: e.clientX, y: e.clientY, width });
        };

        const up = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            finish();
            if (!dragging) return;
            swallowNextClick();
            dropAt(e.clientX, e.clientY);
        };

        const cancel = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            finish();
            if (dragging) useTiles.getState().tapFelt();
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
    };

    return { ghost, onPointerDown };
};

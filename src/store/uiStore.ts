import { create } from 'zustand';
import type { DrawSide, FeltName } from '../types';

const FELT_KEY = 'cookie-solitaire-felt';
const DRAW_SIDE_KEY = 'cookie-solitaire-draw-side';

const loadDrawSide = (): DrawSide => {
    try {
        const saved = localStorage.getItem(DRAW_SIDE_KEY);
        if (saved === 'left' || saved === 'right') return saved;
    } catch {
        /* ignore */
    }
    // Cookie's call: the deck under her right hand.
    return 'right';
};

const loadFelt = (): FeltName => {
    try {
        const saved = localStorage.getItem(FELT_KEY) as FeltName | null;
        if (saved === 'green' || saved === 'cookie' || saved === 'plum' || saved === 'midnight') {
            return saved;
        }
    } catch {
        /* ignore */
    }
    return 'green';
};

interface UiState {
    felt: FeltName;
    drawSide: DrawSide;
    settingsOpen: boolean;
    setFelt: (felt: FeltName) => void;
    setDrawSide: (side: DrawSide) => void;
    toggleSettings: (open?: boolean) => void;
}

export const useUiStore = create<UiState>(set => ({
    felt: loadFelt(),
    drawSide: loadDrawSide(),
    settingsOpen: false,
    setDrawSide: drawSide => {
        try {
            localStorage.setItem(DRAW_SIDE_KEY, drawSide);
        } catch {
            /* ignore */
        }
        set({ drawSide });
    },
    setFelt: felt => {
        try {
            localStorage.setItem(FELT_KEY, felt);
        } catch {
            /* ignore */
        }
        document.body.dataset.felt = felt;
        set({ felt });
    },
    toggleSettings: open => set(s => ({ settingsOpen: open ?? !s.settingsOpen })),
}));

document.body.dataset.felt = useUiStore.getState().felt;

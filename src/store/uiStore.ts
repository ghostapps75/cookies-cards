import { create } from 'zustand';
import type { FeltName } from '../types';

const FELT_KEY = 'cookie-solitaire-felt';

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
    settingsOpen: boolean;
    setFelt: (felt: FeltName) => void;
    toggleSettings: (open?: boolean) => void;
}

export const useUiStore = create<UiState>(set => ({
    felt: loadFelt(),
    settingsOpen: false,
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

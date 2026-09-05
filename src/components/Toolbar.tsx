import React from 'react';
import {
    Check,
    Clock,
    Lightbulb,
    Plus,
    Settings,
    Sparkles,
    Trophy,
    Undo2,
    Volume2,
    VolumeX,
} from 'lucide-react';
import type { FeltName } from '../types';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { formatTime } from '../utils/gameLogic';
import * as sfx from '../utils/sound';

interface ToolbarProps {
    autoRunning: boolean;
    onAutoComplete: () => void;
    dragging: boolean;
}

const FELTS: { id: FeltName; label: string; swatch: string }[] = [
    { id: 'green', label: 'Card room', swatch: '#1c6b45' },
    { id: 'cookie', label: 'Cookie blue', swatch: '#1f74b8' },
    { id: 'plum', label: 'Plum', swatch: '#5d2a52' },
    { id: 'midnight', label: 'Midnight', swatch: '#1d2a44' },
];

const Toolbar: React.FC<ToolbarProps> = ({ autoRunning, onAutoComplete, dragging }) => {
    const score = useGameStore(s => s.score);
    const moves = useGameStore(s => s.moves);
    const seconds = useGameStore(s => s.seconds);
    const historyLength = useGameStore(s => s.history.length);
    const drawCount = useGameStore(s => s.drawCount);
    const stats = useGameStore(s => s.stats);
    const canFinish = useGameStore(s => s.canAutoComplete());

    const { felt, setFelt, settingsOpen, toggleSettings } = useUiStore();
    const [soundOn, setSoundOn] = React.useState(sfx.isSoundEnabled());

    // Asked in-app rather than with window.confirm: embedded browsers often
    // suppress native dialogs, which would leave these buttons doing nothing.
    const [confirming, setConfirming] = React.useState<null | { text: string; go: () => void }>(null);

    const act = (fn: () => void) => () => {
        void sfx.unlockAudio();
        sfx.playClick();
        fn();
    };

    const newGame = () => {
        const store = useGameStore.getState();
        const midGame = store.moves > 0 && store.status === 'playing';
        if (midGame) {
            setConfirming({
                text: 'Start a new hand? This one will be cleared.',
                go: () => useGameStore.getState().newGame(),
            });
            return;
        }
        store.newGame();
        toggleSettings(false);
    };

    return (
        <header className="toolbar" style={{ opacity: dragging ? 0.45 : 1 }}>
            <div className="brand">
                <span className="brand-mark">🍪</span>
                <span className="brand-text">
                    <strong>Cookie&rsquo;s</strong> Solitaire
                </span>
            </div>

            <div className="stats" role="status" aria-live="off">
                <div className="stat">
                    <Trophy size={15} aria-hidden />
                    <span className="stat-value">{score}</span>
                    <span className="stat-label">score</span>
                </div>
                <div className="stat">
                    <Clock size={15} aria-hidden />
                    <span className="stat-value">{formatTime(seconds)}</span>
                    <span className="stat-label">time</span>
                </div>
                <div className="stat">
                    <span className="stat-value">{moves}</span>
                    <span className="stat-label">moves</span>
                </div>
            </div>

            <div className="actions">
                <button
                    className="btn btn-primary"
                    onClick={act(() => useGameStore.getState().undo())}
                    disabled={historyLength === 0}
                    title="Undo the last move (Ctrl+Z)"
                >
                    <Undo2 size={20} aria-hidden />
                    <span>Undo</span>
                </button>

                <button
                    className="btn"
                    onClick={act(() => useGameStore.getState().showHint())}
                    title="Show me a move (H)"
                >
                    <Lightbulb size={20} aria-hidden />
                    <span>Hint</span>
                </button>

                {(canFinish || autoRunning) && (
                    <button className="btn btn-gold" onClick={act(onAutoComplete)} disabled={autoRunning}>
                        <Sparkles size={20} aria-hidden />
                        <span>{autoRunning ? 'Finishing…' : 'Finish'}</span>
                    </button>
                )}

                <button className="btn btn-new" onClick={act(newGame)} title="Deal a new hand">
                    <Plus size={20} aria-hidden />
                    <span>New</span>
                </button>

                <button
                    className={`btn btn-icon${settingsOpen ? ' is-open' : ''}`}
                    onClick={act(() => toggleSettings())}
                    aria-label="Settings"
                    aria-expanded={settingsOpen}
                >
                    <Settings size={20} aria-hidden />
                </button>
            </div>

            {settingsOpen && (
                <>
                    <div className="settings-scrim" onClick={() => toggleSettings(false)} />
                    <div className="settings-panel" role="dialog" aria-label="Settings">
                        <section>
                            <h3>Sound</h3>
                            <button
                                className="row-btn"
                                onClick={() => {
                                    const next = !soundOn;
                                    sfx.setSoundEnabled(next);
                                    setSoundOn(next);
                                    if (next) sfx.playClick();
                                }}
                            >
                                {soundOn ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />}
                                <span>{soundOn ? 'Sound is on' : 'Sound is off'}</span>
                                {soundOn && <Check size={16} className="row-check" aria-hidden />}
                            </button>
                        </section>

                        <section>
                            <h3>Cards to turn over</h3>
                            {([1, 3] as const).map(count => (
                                <button
                                    key={count}
                                    className="row-btn"
                                    onClick={() => {
                                        if (drawCount === count) return;
                                        toggleSettings(false);
                                        if (useGameStore.getState().moves > 0) {
                                            setConfirming({
                                                text: 'Changing this deals a new hand.',
                                                go: () => useGameStore.getState().setDrawCount(count),
                                            });
                                        } else {
                                            useGameStore.getState().setDrawCount(count);
                                        }
                                    }}
                                >
                                    <span>{count === 1 ? 'Draw one (easier)' : 'Draw three (classic)'}</span>
                                    {drawCount === count && <Check size={16} className="row-check" aria-hidden />}
                                </button>
                            ))}
                        </section>

                        <section>
                            <h3>Table</h3>
                            <div className="felt-row">
                                {FELTS.map(option => (
                                    <button
                                        key={option.id}
                                        className={`felt-swatch${felt === option.id ? ' is-active' : ''}`}
                                        style={{ background: option.swatch }}
                                        onClick={() => {
                                            setFelt(option.id);
                                            sfx.playClick();
                                        }}
                                        aria-label={option.label}
                                        title={option.label}
                                    />
                                ))}
                            </div>
                        </section>

                        <section className="record">
                            <h3>Your record</h3>
                            <p>
                                {stats.won} won of {stats.played} played
                                {stats.bestTime !== null && <> &middot; best time {formatTime(stats.bestTime)}</>}
                                {stats.bestScore > 0 && <> &middot; best score {stats.bestScore}</>}
                            </p>
                        </section>
                    </div>
                </>
            )}

            {confirming && (
                <div className="confirm-scrim" onClick={() => setConfirming(null)}>
                    <div
                        className="confirm-box"
                        role="dialog"
                        aria-label="Please confirm"
                        onClick={event => event.stopPropagation()}
                    >
                        <p>{confirming.text}</p>
                        <div className="confirm-actions">
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    const { go } = confirming;
                                    setConfirming(null);
                                    sfx.playClick();
                                    go();
                                }}
                            >
                                Deal a new hand
                            </button>
                            <button className="btn" onClick={() => setConfirming(null)}>
                                Keep playing
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
};

export default Toolbar;

import React, { useState } from 'react';
import { Check, Home, Settings, Volume2, VolumeX } from 'lucide-react';
import type { FeltName } from '../../types';
import { useUiStore } from '../../store/uiStore';
import * as sfx from '../../utils/sound';
import './shared.css';

/**
 * The frame every game sits in: the cloth, and the toolbar across the top with
 * the Home button, "Cookie's <title>", the game's own stats and buttons, and a
 * settings cog whose panel already has Sound and Table in it.
 */

const FELTS: { id: FeltName; label: string; swatch: string }[] = [
    { id: 'green', label: 'Card room', swatch: '#1c6b45' },
    { id: 'cookie', label: 'Cookie blue', swatch: '#1f74b8' },
    { id: 'plum', label: 'Plum', swatch: '#5d2a52' },
    { id: 'midnight', label: 'Midnight', swatch: '#1d2a44' },
];

interface GameShellProps {
    /** Shown after "Cookie's": "Canasta". */
    title: string;
    /** Pills in the middle of the bar; use <Stat>. */
    stats?: React.ReactNode;
    /** Buttons on the right, before the settings cog. */
    actions?: React.ReactNode;
    /**
     * Extra <section>s for the settings panel, between Sound and Table. A
     * function form is handed `close` so a row can shut the panel.
     */
    settings?: React.ReactNode | ((close: () => void) => React.ReactNode);
    /** Fade the bar while something is being dragged across the table. */
    dimmed?: boolean;
    /** The table itself. It fills the space under the bar. */
    children: React.ReactNode;
}

const GameShell: React.FC<GameShellProps> = ({ title, stats, actions, settings, dimmed = false, children }) => {
    const [open, setOpen] = useState(false);
    const felt = useUiStore(s => s.felt);
    const setFelt = useUiStore(s => s.setFelt);
    const [soundOn, setSoundOn] = useState(sfx.isSoundEnabled());

    const close = () => setOpen(false);

    return (
        <div className="table-felt">
            <header className="toolbar" style={{ opacity: dimmed ? 0.45 : 1 }}>
                <a
                    className="btn btn-icon"
                    href="#/"
                    aria-label="All games"
                    title="Back to all games"
                    onClick={() => sfx.playClick()}
                >
                    <Home size={20} aria-hidden />
                </a>

                <div className="brand">
                    <span className="brand-mark">🍪</span>
                    <span className="brand-text">
                        <strong>Cookie&rsquo;s</strong> {title}
                    </span>
                </div>

                <div className="stats" role="status" aria-live="off">
                    {stats}
                </div>

                <div className="actions">
                    {actions}
                    <button
                        className={`btn btn-icon${open ? ' is-open' : ''}`}
                        onClick={() => {
                            void sfx.unlockAudio();
                            sfx.playClick();
                            setOpen(o => !o);
                        }}
                        aria-label="Settings"
                        aria-expanded={open}
                    >
                        <Settings size={20} aria-hidden />
                    </button>
                </div>

                {open && (
                    <>
                        <div className="settings-scrim" onClick={close} />
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

                            {typeof settings === 'function' ? settings(close) : settings}

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
                        </div>
                    </>
                )}
            </header>

            <div className="board-area">{children}</div>
        </div>
    );
};

export default GameShell;

/** One pill in the toolbar: a number and what it is. */
export const Stat: React.FC<{ value: React.ReactNode; label: string; icon?: React.ReactNode }> = ({
    value,
    label,
    icon,
}) => (
    <div className="stat">
        {icon}
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
    </div>
);

/**
 * A yes-or-no question in the app's own dialog. Embedded browsers often
 * swallow window.confirm, which would leave a button doing nothing.
 */
export const Confirm: React.FC<{
    text: string;
    yes: string;
    no?: string;
    onYes: () => void;
    onNo: () => void;
}> = ({ text, yes, no = 'Keep playing', onYes, onNo }) => (
    <div className="confirm-scrim" onClick={onNo}>
        <div className="confirm-box" role="dialog" aria-label="Please confirm" onClick={event => event.stopPropagation()}>
            <p>{text}</p>
            <div className="confirm-actions">
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        sfx.playClick();
                        onYes();
                    }}
                >
                    {yes}
                </button>
                <button className="btn" onClick={onNo}>
                    {no}
                </button>
            </div>
        </div>
    </div>
);

/** A short message over the bottom of the table that fades in. */
export const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="table-notice">{children}</div>
);

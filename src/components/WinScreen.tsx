import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { getCardImageUrl } from '../utils/assets';
import { formatTime } from '../utils/gameLogic';
import * as sfx from '../utils/sound';

interface Flyer {
    img: HTMLImageElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

const GRAVITY = 0.42;
const BOUNCE = 0.78;
const SPAWN_MS = 230;

/**
 * The reward: the whole board pours off the foundations and paints the screen,
 * the way Windows Solitaire has done it since 1990.
 */
const WinScreen: React.FC = () => {
    const status = useGameStore(s => s.status);
    const foundations = useGameStore(s => s.foundations);
    const score = useGameStore(s => s.score);
    const seconds = useGameStore(s => s.seconds);
    const moves = useGameStore(s => s.moves);
    const stats = useGameStore(s => s.stats);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [showPanel, setShowPanel] = useState(false);

    useEffect(() => {
        if (status !== 'won') {
            setShowPanel(false);
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Launch from where the four finished piles actually sit, at their
        // actual size, so the cascade grows straight out of the board.
        const slots = [0, 1, 2, 3].map(f =>
            document.querySelector(`[data-pile="foundation-${f}"]`)?.getBoundingClientRect(),
        );
        const first = slots.find(Boolean);
        const cardW = first ? first.width : Math.max(64, Math.min(120, width / 11));
        const cardH = first ? first.height : Math.round(cardW / 0.6875);

        // Deal the cascade off the top of each finished suit, high card first.
        const queue = foundations
            .flatMap((pile, f) => pile.map((card, i) => ({ card, f, i })))
            .sort((a, b) => b.i - a.i || a.f - b.f)
            .map(({ card, f }) => {
                const img = new Image();
                img.src = getCardImageUrl(card.rank, card.suit);
                const slot = slots[f];
                return {
                    img,
                    x: slot ? slot.left : width / 2 + (f - 1.5) * (cardW + 14) - cardW / 2,
                    y: slot ? slot.top : height * 0.12,
                };
            });

        const flyers: Flyer[] = [];
        let spawned = 0;
        let lastSpawn = 0;
        let lastBounce = 0;
        let previous = 0;
        let raf = 0;
        let stopped = false;

        const step = (time: number) => {
            if (stopped) return;

            // Measured in 60fps-sized steps, so the cascade falls at the same
            // speed on a 120Hz phone as on a tired old laptop.
            const dt = previous ? Math.min(3, (time - previous) / 16.667) : 1;
            previous = time;

            if (spawned < queue.length && time - lastSpawn > SPAWN_MS) {
                const next = queue[spawned++];
                lastSpawn = time;
                flyers.push({
                    img: next.img,
                    x: next.x,
                    y: next.y,
                    vx: (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 4.4),
                    vy: -3 - Math.random() * 3,
                });
            }

            for (let i = flyers.length - 1; i >= 0; i--) {
                const flyer = flyers[i];
                flyer.vy += GRAVITY * dt;
                flyer.x += flyer.vx * dt;
                flyer.y += flyer.vy * dt;

                if (flyer.y + cardH >= height) {
                    flyer.y = height - cardH;
                    flyer.vy = -flyer.vy * BOUNCE;
                    if (Math.abs(flyer.vy) < 2.2) {
                        flyers.splice(i, 1);
                        continue;
                    }
                    if (time - lastBounce > 55) {
                        lastBounce = time;
                        sfx.playBounce(Math.abs(flyer.vy));
                    }
                }

                if (flyer.x < -cardW * 1.5 || flyer.x > width + cardW * 1.5) {
                    flyers.splice(i, 1);
                    continue;
                }

                if (flyer.img.complete && flyer.img.naturalWidth > 0) {
                    ctx.drawImage(flyer.img, flyer.x, flyer.y, cardW, cardH);
                }
            }

            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
        const panelTimer = window.setTimeout(() => setShowPanel(true), 3800);

        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
            window.clearTimeout(panelTimer);
            ctx.clearRect(0, 0, width, height);
        };
    }, [status, foundations]);

    const playAgain = () => {
        sfx.playClick();
        useGameStore.getState().newGame();
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                className="win-canvas"
                style={{ display: status === 'won' ? 'block' : 'none' }}
            />

            <div className="win-panel-wrap">
            <AnimatePresence>
                {status === 'won' && showPanel && (
                    <motion.div
                        className="win-panel"
                        initial={{ opacity: 0, scale: 0.85, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    >
                        <div className="win-cookie">🍪</div>
                        <h2>You did it, Cookie!</h2>
                        <p className="win-sub">All fifty-two, home safe.</p>

                        <div className="win-stats">
                            <div>
                                <span className="win-value">{score}</span>
                                <span className="win-label">score</span>
                            </div>
                            <div>
                                <span className="win-value">{formatTime(seconds)}</span>
                                <span className="win-label">time</span>
                            </div>
                            <div>
                                <span className="win-value">{moves}</span>
                                <span className="win-label">moves</span>
                            </div>
                        </div>

                        {stats.won > 0 && (
                            <p className="win-record">
                                That&rsquo;s {stats.won} {stats.won === 1 ? 'win' : 'wins'}
                                {stats.bestTime !== null && <> &middot; best {formatTime(stats.bestTime)}</>}
                            </p>
                        )}

                        <div className="win-actions">
                            <button className="btn btn-primary btn-lg" onClick={playAgain}>
                                Play again
                            </button>
                            <button className="btn btn-lg" onClick={() => setShowPanel(false)}>
                                Watch the cards
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
        </>
    );
};

export default WinScreen;

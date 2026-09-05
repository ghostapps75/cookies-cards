import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card as CardType, PileId } from '../types';
import { useGameStore } from '../store/gameStore';
import { canStackOnFoundation, canStackOnTableau, isMovableRun } from '../utils/gameLogic';
import {
    CARD_H,
    CARD_W,
    computePlacements,
    dropZones,
    metricsFor,
    rectOverlap,
} from '../utils/layout';
import * as sfx from '../utils/sound';
import CardView from './Card';
import PileSlot from './PileSlot';
import Toolbar from './Toolbar';
import WinScreen from './WinScreen';

/** How far the pointer must travel before we call it a drag rather than a tap. */
const DRAG_THRESHOLD = 5;
const TOUCH_DRAG_THRESHOLD = 9;
/** Fingers wobble. A short, small movement still counts as a tap. */
const TAP_SLOP = 14;
const TAP_MS = 500;
/** Sending a card home takes two taps, the way Windows Solitaire has always
 *  done it. Generous windows, because this is not a reflex test. */
const DOUBLE_TAP_MS = 550;
const DOUBLE_TAP_SLOP = 32;

interface DragState {
    pileId: PileId;
    cardIds: string[];
    /** Vertical spacing of the dragged run, preserved while it is in hand. */
    offsets: number[];
    x: number;
    y: number;
    legalTargets: Set<PileId>;
    target: PileId | null;
}

const GameBoard: React.FC = () => {
    const state = useGameStore();
    const { stock, waste, foundations, tableau, drawCount, status, gameId, hint } = state;

    const wrapRef = useRef<HTMLDivElement>(null);
    const boardRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ w: 1280, h: 720 });
    const [drag, setDrag] = useState<DragState | null>(null);
    const [autoRunning, setAutoRunning] = useState(false);
    const lastTap = useRef<{ cardId: string; at: number; x: number; y: number } | null>(null);

    // --- shape the table to whatever screen she is playing on ---------------
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const fit = () => {
            const { width, height } = el.getBoundingClientRect();
            if (width && height) {
                setViewport(current =>
                    Math.abs(current.w - width) < 1 && Math.abs(current.h - height) < 1
                        ? current
                        : { w: width, h: height },
                );
            }
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        window.addEventListener('orientationchange', fit);
        return () => {
            observer.disconnect();
            window.removeEventListener('orientationchange', fit);
        };
    }, []);

    const metrics = useMemo(() => metricsFor(viewport.w, viewport.h), [viewport]);
    const scale = Math.min(viewport.w / metrics.boardW, viewport.h / metrics.boardH);

    const board = useMemo(
        () => ({ stock, waste, foundations, tableau, drawCount }),
        [stock, waste, foundations, tableau, drawCount],
    );

    const placements = useMemo(() => computePlacements(board, metrics), [board, metrics]);
    const zones = useMemo(() => dropZones(board, metrics), [board, metrics]);

    const cardsById = useMemo(() => {
        const map = new Map<string, { card: CardType; pileId: PileId }>();
        stock.forEach(card => map.set(card.id, { card, pileId: 'stock' }));
        waste.forEach(card => map.set(card.id, { card, pileId: 'waste' }));
        foundations.forEach((pile, f) =>
            pile.forEach(card => map.set(card.id, { card, pileId: `foundation-${f}` })),
        );
        tableau.forEach((pile, t) =>
            pile.forEach(card => map.set(card.id, { card, pileId: `tableau-${t}` })),
        );
        return map;
    }, [stock, waste, foundations, tableau]);

    // Stable render order so React never reshuffles the DOM; depth comes from z-index.
    const cardOrder = useMemo(() => [...cardsById.keys()].sort(), [cardsById]);

    // --- dealing -------------------------------------------------------------
    // Cards are handed out one at a time: an undealt card simply *lives* on the
    // deck until its turn comes, so a stray re-render can never strand one
    // mid-flight the way a staggered transition delay can.
    const dealOrder = useMemo(() => {
        const order = new Map<string, number>();
        let n = 0;
        for (let row = 0; row < 20; row++) {
            for (let col = 0; col < 7; col++) {
                const card = tableau[col]?.[row];
                if (card) order.set(card.id, n++);
            }
        }
        return order;
        // A fresh hand only; moves during play must not re-stagger the table.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId]);

    const [dealtCount, setDealtCount] = useState(0);

    useEffect(() => {
        const total = dealOrder.size;
        setDealtCount(0);
        let handed = 0;
        const id = window.setInterval(() => {
            handed += 1;
            setDealtCount(handed);
            sfx.playDeal();
            if (handed >= total) {
                window.clearInterval(id);
                window.setTimeout(() => useGameStore.getState().finishDeal(), 260);
            }
        }, 42);
        return () => window.clearInterval(id);
    }, [dealOrder]);

    // --- clock ---------------------------------------------------------------
    useEffect(() => {
        const id = window.setInterval(() => useGameStore.getState().tick(), 1000);
        return () => window.clearInterval(id);
    }, []);

    // --- auto finish ---------------------------------------------------------
    useEffect(() => {
        if (!autoRunning) return;
        let fruitlessDraws = 0;
        const id = window.setInterval(() => {
            const step = useGameStore.getState().autoCompleteStep();
            if (step === 'placed') fruitlessDraws = 0;
            if (step === 'drew') fruitlessDraws += 1;
            if (step === 'done' || fruitlessDraws > 60 || useGameStore.getState().status !== 'playing') {
                setAutoRunning(false);
            }
        }, 140);
        return () => window.clearInterval(id);
    }, [autoRunning]);

    /** Touching the table while it is still being dealt lands the rest at once. */
    const skipDeal = useCallback(() => {
        setDealtCount(dealOrder.size);
        useGameStore.getState().finishDeal();
    }, [dealOrder]);

    const toBoardPoint = useCallback((clientX: number, clientY: number) => {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return { x: clientX, y: clientY };
        const s = rect.width / metrics.boardW || 1;
        return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
    }, [metrics.boardW]);

    const pileCards = useCallback(
        (id: PileId): CardType[] => {
            if (id === 'stock') return stock;
            if (id === 'waste') return waste;
            const index = Number(id.slice(id.indexOf('-') + 1));
            return id.startsWith('foundation') ? foundations[index] : tableau[index];
        },
        [stock, waste, foundations, tableau],
    );

    const legalTargetsFor = useCallback(
        (run: CardType[], from: PileId): Set<PileId> => {
            const targets = new Set<PileId>();
            const head = run[0];
            if (run.length === 1) {
                foundations.forEach((pile, f) => {
                    const id = `foundation-${f}`;
                    if (id !== from && canStackOnFoundation(head, pile[pile.length - 1])) targets.add(id);
                });
            }
            tableau.forEach((pile, t) => {
                const id = `tableau-${t}`;
                if (id !== from && canStackOnTableau(head, pile[pile.length - 1])) targets.add(id);
            });
            return targets;
        },
        [foundations, tableau],
    );

    // --- picking cards up ----------------------------------------------------
    const handleCardPointerDown = useCallback(
        (event: React.PointerEvent, card: CardType, pileId: PileId) => {
            if (event.button !== 0) return;
            event.preventDefault();
            void sfx.unlockAudio();

            const store = useGameStore.getState();
            store.clearHint();
            if (store.status === 'dealing') {
                skipDeal();
                return;
            }
            if (store.status !== 'playing' || autoRunning) return;

            if (pileId === 'stock') {
                lastTap.current = null;
                store.draw();
                return;
            }

            const pile = pileCards(pileId);
            const index = pile.findIndex(c => c.id === card.id);
            if (index === -1) return;
            const isTop = index === pile.length - 1;
            const run = pile.slice(index);
            const draggable =
                card.isFaceUp && (pileId.startsWith('tableau') ? isMovableRun(run) : isTop);

            const start = { x: event.clientX, y: event.clientY };
            const startedAt = performance.now();
            const threshold = event.pointerType === 'mouse' ? DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD;
            const head = placements.get(card.id);
            const grab = toBoardPoint(event.clientX, event.clientY);
            const grabDX = head ? grab.x - head.x : CARD_W / 2;
            const grabDY = head ? grab.y - head.y : CARD_H / 2;
            const offsets = run.map(c => (placements.get(c.id)?.y ?? 0) - (head?.y ?? 0));

            let started = false;

            const onMove = (e: PointerEvent) => {
                if (!draggable) return;
                const dx = e.clientX - start.x;
                const dy = e.clientY - start.y;
                if (!started && Math.hypot(dx, dy) < threshold) return;

                const point = toBoardPoint(e.clientX, e.clientY);
                const x = point.x - grabDX;
                const y = point.y - grabDY;

                if (!started) {
                    started = true;
                    lastTap.current = null;
                    sfx.playPickup();
                }

                const rect = { x, y, w: CARD_W, h: CARD_H };
                let target: PileId | null = null;
                let best = 0;
                for (const zone of zones) {
                    const area = rectOverlap(rect, zone);
                    if (area > best) {
                        best = area;
                        target = zone.pileId;
                    }
                }

                setDrag(current => ({
                    pileId,
                    cardIds: run.map(c => c.id),
                    offsets,
                    legalTargets: current?.legalTargets ?? legalTargetsFor(run, pileId),
                    x,
                    y,
                    target,
                }));
            };

            const onUp = (e: PointerEvent) => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);

                const live = useGameStore.getState();

                let landed = false;
                if (started) {
                    // Drop onto whichever pile the card covers most, falling back
                    // through the others so a sloppy drop still finds a home.
                    const point = toBoardPoint(e.clientX, e.clientY);
                    const rect = { x: point.x - grabDX, y: point.y - grabDY, w: CARD_W, h: CARD_H };
                    const ranked = zones
                        .map(zone => ({ zone, area: rectOverlap(rect, zone) }))
                        .filter(entry => entry.area > 0)
                        .sort((a, b) => b.area - a.area);

                    for (const entry of ranked) {
                        if (live.moveCards(pileId, card.id, entry.zone.pileId)) {
                            landed = true;
                            break;
                        }
                    }
                }

                if (landed) {
                    lastTap.current = null;
                } else {
                    const travelled = Math.hypot(e.clientX - start.x, e.clientY - start.y);
                    const now = performance.now();
                    const wasTap = travelled < TAP_SLOP && now - startedAt < TAP_MS;

                    if (!wasTap) {
                        if (started) sfx.playInvalid();
                    } else if (!card.isFaceUp && isTop && pileId.startsWith('tableau')) {
                        // Turning a card over is still a single tap.
                        lastTap.current = null;
                        live.flipTableauTop(pileId);
                    } else if (card.isFaceUp && isTop) {
                        const previous = lastTap.current;
                        const isSecondTap =
                            previous !== null &&
                            previous.cardId === card.id &&
                            now - previous.at < DOUBLE_TAP_MS &&
                            Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < DOUBLE_TAP_SLOP;

                        if (isSecondTap) {
                            lastTap.current = null;
                            if (!live.sendHome(pileId, card.id)) sfx.playPickup();
                        } else {
                            // First of a possible pair. A lone tap does nothing,
                            // and says nothing, so it never reads as a failure.
                            lastTap.current = { cardId: card.id, at: now, x: e.clientX, y: e.clientY };
                        }
                    } else {
                        lastTap.current = null;
                    }
                }
                setDrag(null);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        },
        [autoRunning, legalTargetsFor, pileCards, placements, skipDeal, toBoardPoint, zones],
    );

    const handleStockSlot = useCallback((event: React.PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        void sfx.unlockAudio();
        const store = useGameStore.getState();
        store.clearHint();
        if (store.status === 'dealing') skipDeal();
        else if (store.status === 'playing') store.draw();
    }, [skipDeal]);

    // --- hint & drag highlighting -------------------------------------------
    const hintedIds = useMemo(() => {
        if (!hint) return new Set<string>();
        const ids = new Set(hint.cardIds);
        const target = hint.toPileId;
        if (target !== 'stock') {
            const pile = pileCards(target);
            const top = pile[pile.length - 1];
            if (top) ids.add(top.id);
        } else {
            stock.slice(-1).forEach(c => ids.add(c.id));
        }
        return ids;
    }, [hint, pileCards, stock]);

    const dragIds = useMemo(() => new Set(drag?.cardIds ?? []), [drag]);
    const dropTarget = drag && drag.target && drag.legalTargets.has(drag.target) ? drag.target : null;

    // --- keyboard ------------------------------------------------------------
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const store = useGameStore.getState();
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                store.undo();
                return;
            }
            if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON' && e.key === ' ') return;
            switch (e.key.toLowerCase()) {
                case 'u':
                    store.undo();
                    break;
                case 'h':
                    store.showHint();
                    break;
                case ' ':
                case 'enter':
                    e.preventDefault();
                    void sfx.unlockAudio();
                    store.draw();
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const stockOrigin = metrics.origins.stock;

    return (
        <div className="table-felt">
            <Toolbar
                autoRunning={autoRunning}
                onAutoComplete={() => setAutoRunning(true)}
                dragging={dragIds.size > 0}
            />

            <div ref={wrapRef} className="board-area">
                <div
                    ref={boardRef}
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: metrics.boardW,
                        height: metrics.boardH,
                        transform: `translate(-50%, -50%) scale(${scale})`,
                        transformOrigin: 'center center',
                    }}
                >
                    <PileSlot
                        kind="stock"
                        x={metrics.origins.stock.x}
                        y={metrics.origins.stock.y}
                        stockEmpty={stock.length === 0}
                        hinted={hint?.deckOnly}
                        onPointerDown={handleStockSlot}
                    />
                    <PileSlot kind="waste" x={metrics.origins.waste.x} y={metrics.origins.waste.y} />

                    {foundations.map((_, f) => {
                        const id = `foundation-${f}`;
                        return (
                            <PileSlot
                                key={id}
                                kind="foundation"
                                x={metrics.origins[id].x}
                                y={metrics.origins[id].y}
                                legal={drag?.legalTargets.has(id)}
                                active={dropTarget === id}
                                hinted={hint?.toPileId === id}
                            />
                        );
                    })}

                    {tableau.map((_, t) => {
                        const id = `tableau-${t}`;
                        return (
                            <PileSlot
                                key={id}
                                kind="tableau"
                                x={metrics.origins[id].x}
                                y={metrics.origins[id].y}
                                legal={drag?.legalTargets.has(id)}
                                active={dropTarget === id}
                                hinted={hint?.toPileId === id}
                            />
                        );
                    })}

                    {cardOrder.map(id => {
                        const entry = cardsById.get(id);
                        const place = placements.get(id);
                        if (!entry || !place) return null;

                        const dragIndex = drag ? drag.cardIds.indexOf(id) : -1;
                        const isDragging = dragIndex !== -1;
                        const pile = entry.pileId;
                        const cards = pileCards(pile);
                        const index = cards.findIndex(c => c.id === id);
                        const isTop = index === cards.length - 1;

                        // Still waiting its turn on the deck, face down like the rest.
                        const dealIndex = dealOrder.get(id);
                        const undealt =
                            status === 'dealing' && dealIndex !== undefined && dealIndex >= dealtCount;

                        const interactive =
                            status === 'playing' &&
                            !autoRunning &&
                            (pile === 'stock' ||
                                (entry.card.isFaceUp &&
                                    (pile.startsWith('tableau') ? isMovableRun(cards.slice(index)) : isTop)) ||
                                (!entry.card.isFaceUp && isTop && pile.startsWith('tableau')));

                        return (
                            <CardView
                                key={`${gameId}-${id}`}
                                card={undealt ? faceDown(entry.card) : entry.card}
                                x={isDragging ? drag!.x : undealt ? stockOrigin.x : place.x}
                                y={isDragging ? drag!.y + drag!.offsets[dragIndex] : undealt ? stockOrigin.y : place.y}
                                z={
                                    isDragging
                                        ? 100000 + dragIndex
                                        : undealt
                                          ? 800 - (dealIndex ?? 0)
                                          : baseZ(pile) + place.z
                                }
                                from={stockOrigin}
                                dragging={isDragging}
                                hinted={hintedIds.has(id)}
                                interactive={interactive}
                                topOfPile={isTop}
                                onPointerDown={event => handleCardPointerDown(event, entry.card, pile)}
                            />
                        );
                    })}
                </div>
            </div>

            <WinScreen />
        </div>
    );
};

const faceDownCache = new Map<string, CardType>();

/** The same card, shown back-up while it waits on the deck to be dealt. */
const faceDown = (card: CardType): CardType => {
    const cached = faceDownCache.get(card.id);
    if (cached) return cached;
    const hidden = { ...card, isFaceUp: false };
    faceDownCache.set(card.id, hidden);
    return hidden;
};

/** Keeps a card in flight above everything it passes over. */
const baseZ = (pileId: PileId): number => {
    if (pileId === 'stock') return 0;
    if (pileId.startsWith('tableau')) return 100;
    if (pileId === 'waste') return 300;
    return 500;
};

export default GameBoard;

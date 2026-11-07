import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PresenceContext } from 'framer-motion';
import {
    ArrowDownToLine,
    ArrowDownUp,
    ArrowLeftRight,
    ArrowUpFromLine,
    Check,
    Cookie,
    Cpu,
    Hand,
    Layers,
    Plus,
    RotateCcw,
    Undo2,
} from 'lucide-react';
import GameShell, { Confirm, Notice, Stat } from '../shared/GameShell';
import PlayingCard from '../shared/PlayingCard';
import { cardName, isJoker, turned, type PlayingCard as Card } from '../shared/cards';
import { unlockAudio } from '../../utils/sound';
import { fitMeldCard, sortHand } from './layout';
import {
    DEFAULT_HAND_SIZE,
    DEFAULT_OPENING,
    HAND_SIZE_OPTIONS,
    JOKER_CHARGE,
    MATCH_LIMIT,
    OPENING_OPTIONS,
    arrangeMeld,
    discardCard,
    faceLabel,
    layOffMany,
    statusLine,
    swapJoker,
    swapOut,
    takeCheckFor,
    whyNotTake,
    type HandRecord,
    type Meld,
} from './rules';
import { useKalooki } from './store';
import './kalooki.css';

const STOCK_LAYERS = 3;
const NOTICE_MS = 4200;

/**
 * A new PlayingCard springs from face up to its real side as it mounts, which
 * would flash the next stock card and the computer's hand at Cookie. This tells
 * every card under it to start on the side it is on. Flights are not affected.
 */
const START_SETTLED = {
    id: 'kalooki-table',
    isPresent: true,
    initial: false as const,
    register: () => () => {},
};

/** The computer's cards, face down, until the hand is over and they are shown. */
const ComputerHand: React.FC<{ cards: Card[]; reveal: boolean }> = ({ cards, reveal }) => {
    const shown = useMemo(() => (reveal ? cards.map(card => turned(card, true)) : cards), [cards, reveal]);
    const middle = (shown.length - 1) / 2;
    return (
        <div className="kal-computer" aria-label={`The computer has ${cards.length} cards`}>
            <span className="kal-who">
                <Cpu size={16} aria-hidden /> Computer
            </span>
            <div className="kal-fan">
                {shown.map((card, i) => (
                    <PlayingCard key={card.id} card={card} style={{ rotate: `${(i - middle) * 1.6}deg` }} />
                ))}
            </div>
            <span className="kal-count">{cards.length}</span>
        </div>
    );
};

const Stock: React.FC<{ cards: Card[]; live: boolean; onTap: () => void }> = ({ cards, live, onTap }) => {
    const layers = Math.min(STOCK_LAYERS, cards.length);
    const top = cards[cards.length - 1];
    return (
        <button
            type="button"
            className={`kal-pile kal-stock${live ? ' is-live' : ''}`}
            onClick={onTap}
            aria-label={`Stock, ${cards.length} cards left. Tap to draw.`}
        >
            {layers > 1 &&
                Array.from({ length: layers - 1 }, (_, i) => (
                    <PlayingCard
                        key={`under-${i}`}
                        card={cards[cards.length - 2 - i]}
                        animate={false}
                        style={{ position: 'absolute', top: (layers - 1 - i) * 2, left: (layers - 1 - i) * -2 }}
                    />
                ))}
            {top ? (
                <PlayingCard key={top.id} card={top} style={{ position: 'absolute', top: 0, left: 0 }} />
            ) : (
                <span className="kal-empty">Turn over</span>
            )}
            <span className="kal-pile-count">{cards.length}</span>
        </button>
    );
};

const DiscardPile: React.FC<{ cards: Card[]; live: boolean; onTap: () => void }> = ({ cards, live, onTap }) => {
    const top = cards[cards.length - 1];
    const under = cards[cards.length - 2];
    return (
        <button
            type="button"
            className={`kal-pile kal-discard${live ? ' is-live' : ''}`}
            onClick={onTap}
            aria-label={top ? `Discard pile, top card ${cardName(top)}` : 'Discard pile, empty'}
        >
            {!top && <span className="kal-empty">Discards</span>}
            {under && <PlayingCard key={under.id} card={under} style={{ position: 'absolute', top: 0, left: 0 }} />}
            {top && <PlayingCard key={top.id} card={top} style={{ position: 'absolute', top: 0, left: 0 }} />}
        </button>
    );
};

const TableMeld: React.FC<{
    meld: Meld;
    target: boolean;
    tentative: boolean;
    onTap: (id: string) => void;
}> = ({ meld, target, tentative, onTap }) => {
    const words = meld.kind === 'set' ? `Set of ${meld.stands[0].rank}s` : `Run of ${meld.stands[0].suit}`;
    return (
        <div
            className={`kal-meld${target ? ' is-target' : ''}${tentative ? ' is-tentative' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${words}: ${meld.cards.map(cardName).join(', ')}`}
            data-meld={meld.id}
            onClick={() => onTap(meld.id)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onTap(meld.id);
                }
            }}
        >
            {meld.cards.map((card, i) => (
                <div className="kal-meld-card" key={card.id}>
                    <PlayingCard card={card} />
                    {isJoker(card) && <span className="kal-stands">{faceLabel(meld.stands[i])}</span>}
                </div>
            ))}
        </div>
    );
};

const MeldGroup: React.FC<{
    label: string;
    melds: Meld[];
    targets: Set<string>;
    tentative: Set<string>;
    onTap: (id: string) => void;
}> = ({ label, melds, targets, tentative, onTap }) => (
    <section className="kal-group" aria-label={label}>
        <h3 className="kal-group-label">{label}</h3>
        <div className="kal-group-melds">
            {melds.map(meld => (
                <TableMeld
                    key={meld.id}
                    meld={meld}
                    target={targets.has(meld.id)}
                    tentative={tentative.has(meld.id)}
                    onTap={onTap}
                />
            ))}
        </div>
    </section>
);

/** The whole width of the table for melds, with the cards sized so they all fit. */
const MeldTable: React.FC<{
    melds: Meld[];
    targets: Set<string>;
    tentative: Set<string>;
    onTap: (id: string) => void;
}> = ({ melds, targets, tentative, onTap }) => {
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const element = box.current;
        if (!element) return;
        const watcher = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            setSize({ width, height });
        });
        watcher.observe(element);
        return () => watcher.disconnect();
    }, []);

    const mine = useMemo(() => melds.filter(meld => meld.owner === 'cookie'), [melds]);
    const theirs = useMemo(() => melds.filter(meld => meld.owner === 'computer'), [melds]);
    const cardWidth = fitMeldCard(size.width, size.height, [
        mine.map(meld => meld.cards.length),
        theirs.map(meld => meld.cards.length),
    ]);

    return (
        <div className="kal-melds" ref={box} style={{ '--meld-w': `${cardWidth}px` } as React.CSSProperties}>
            <MeldGroup label="Your melds" melds={mine} targets={targets} tentative={tentative} onTap={onTap} />
            <MeldGroup label="Computer’s melds" melds={theirs} targets={targets} tentative={tentative} onTap={onTap} />
        </div>
    );
};

const CookieHand: React.FC<{
    cards: Card[];
    selected: string[];
    mustUse: string[];
    onToggle: (card: Card) => void;
}> = ({ cards, selected, mustUse, onToggle }) => (
    <div className="kal-hand" aria-label="Your hand">
        {cards.map(card => {
            const picked = selected.includes(card.id);
            return (
                <div className="kal-slot" key={card.id} data-card={card.id}>
                    <PlayingCard
                        card={card}
                        selected={picked}
                        highlighted={!picked && mustUse.includes(card.id)}
                        onClick={onToggle}
                    />
                </div>
            );
        })}
    </div>
);

const HandOver: React.FC = () => {
    const match = useKalooki(s => s.match);
    const stats = useKalooki(s => s.stats);
    const nextHand = useKalooki(s => s.nextHand);
    const { hand, totals, winner } = match;
    const result = hand.result;
    if (!result) return null;

    const title = winner
        ? winner === 'cookie'
            ? 'You won the match!'
            : winner === 'computer'
              ? 'The computer won the match'
              : 'The match is a tie'
        : result.wentOut === 'cookie'
          ? 'You went out!'
          : result.wentOut === 'computer'
            ? 'The computer went out'
            : 'The cards ran out';

    const sub = result.kalooki
        ? result.wentOut === 'cookie'
            ? 'A kalooki! You went out in one go, so the computer pays double.'
            : 'A kalooki! The computer went out in one go, so you pay double.'
        : winner
          ? `${totals.computer >= totals.cookie ? 'The computer' : 'You'} reached ${MATCH_LIMIT}, so the lower score wins.`
          : `Whoever is left holding cards pays for them. ${MATCH_LIMIT} ends the match.`;

    return (
        <div className="win-panel-wrap">
            <div className="win-panel kal-panel" role="dialog" aria-label={title}>
                <div className="win-cookie kal-panel-cookie">🍪</div>
                <h2>{title}</h2>
                <p className="win-sub">{sub}</p>
                <div className="kal-panel-grid">
                    <span />
                    <span className="win-label">You</span>
                    <span className="win-label">Computer</span>

                    <span className="win-label kal-row-label">This hand</span>
                    <span className="win-value" data-charge="cookie">
                        {result.charges.cookie}
                    </span>
                    <span className="win-value" data-charge="computer">
                        {result.charges.computer}
                    </span>

                    <span className="win-label kal-row-label">Total</span>
                    <span className="win-value" data-total="cookie">
                        {totals.cookie}
                    </span>
                    <span className="win-value" data-total="computer">
                        {totals.computer}
                    </span>
                </div>
                {winner && (
                    <p className="win-record">
                        You have won {stats.won} of {stats.played} {stats.played === 1 ? 'match' : 'matches'}.
                    </p>
                )}
                <div className="win-actions">
                    <button className="btn btn-primary btn-lg" onClick={nextHand}>
                        {winner ? <RotateCcw size={20} aria-hidden /> : <ArrowDownToLine size={20} aria-hidden />}
                        <span>{winner ? 'New match' : 'Next hand'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const ScoreTable: React.FC<{ history: HandRecord[]; totals: { cookie: number; computer: number } }> = ({
    history,
    totals,
}) => (
    <div className="kal-scores">
        <table>
            <thead>
                <tr>
                    <th>Hand</th>
                    <th>You</th>
                    <th>Computer</th>
                </tr>
            </thead>
            <tbody>
                {history.map(record => (
                    <tr key={record.handNo}>
                        <td>
                            {record.handNo}
                            {record.kalooki && <span title="Kalooki: doubled"> ★</span>}
                        </td>
                        <td>{record.charges.cookie}</td>
                        <td>{record.charges.computer}</td>
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr>
                    <td>Total</td>
                    <td>{totals.cookie}</td>
                    <td>{totals.computer}</td>
                </tr>
            </tfoot>
        </table>
        {history.length === 0 && <p className="row-note">Nothing yet: charges appear here after each hand.</p>}
        {history.some(record => record.kalooki) && <p className="row-note">★ A kalooki, so the charge was doubled.</p>}
    </div>
);

const KalookiTable: React.FC = () => {
    const match = useKalooki(s => s.match);
    const selected = useKalooki(s => s.selected);
    const choosingSwap = useKalooki(s => s.choosingSwap);
    const sortBy = useKalooki(s => s.sortBy);
    const notice = useKalooki(s => s.notice);
    const stats = useKalooki(s => s.stats);
    const toggleCard = useKalooki(s => s.toggleCard);
    const toggleSort = useKalooki(s => s.toggleSort);
    const clearNotice = useKalooki(s => s.clearNotice);
    const draw = useKalooki(s => s.draw);
    const takeTopDiscard = useKalooki(s => s.takeTopDiscard);
    const tapDiscardPile = useKalooki(s => s.tapDiscardPile);
    const meldSelected = useKalooki(s => s.meldSelected);
    const tapMeld = useKalooki(s => s.tapMeld);
    const pressSwap = useKalooki(s => s.pressSwap);
    const discardSelected = useKalooki(s => s.discardSelected);
    const takeBack = useKalooki(s => s.takeBack);
    const throwInHand = useKalooki(s => s.throwInHand);
    const startNewMatch = useKalooki(s => s.startNewMatch);
    const setOpening = useKalooki(s => s.setOpening);
    const setHandSize = useKalooki(s => s.setHandSize);

    const [confirming, setConfirming] = useState<'hand' | 'match' | null>(null);

    const { hand, totals, history, undo } = match;

    /* The computer's turn, one visible step at a time. A reload picks up where it left off. */
    useEffect(() => {
        if (hand.phase === 'over' || hand.turn !== 'computer') return;
        const timer = window.setTimeout(() => useKalooki.getState().computerStep(), 600 + Math.random() * 600);
        return () => window.clearTimeout(timer);
    }, [hand]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(clearNotice, NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [notice, clearNotice]);

    const myTurn = hand.turn === 'cookie' && hand.phase !== 'over';
    const myDraw = myTurn && hand.phase === 'draw';
    const myPlay = myTurn && hand.phase === 'play';

    const sorted = useMemo(() => sortHand(hand.hands.cookie, sortBy), [hand.hands.cookie, sortBy]);
    const selectedCards = useMemo(
        () => hand.hands.cookie.filter(card => selected.includes(card.id)),
        [hand.hands.cookie, selected],
    );

    const takeOk = useMemo(() => myDraw && whyNotTake(takeCheckFor(hand, 'cookie')) === null, [hand, myDraw]);
    const meldReady = myPlay && selectedCards.length > 0 && arrangeMeld(selectedCards) !== null;

    const swapTargets = useMemo(() => {
        if (!myPlay || selectedCards.length !== 1 || !hand.opened.cookie) return [];
        return hand.melds.filter(meld => swapJoker(hand, meld.id, selectedCards[0].id).ok).map(meld => meld.id);
    }, [hand, myPlay, selectedCards]);

    const targets = useMemo(() => {
        if (!myPlay || selectedCards.length === 0 || !hand.opened.cookie) return new Set<string>();
        if (choosingSwap) return new Set(swapTargets);
        const fits = hand.melds.filter(
            meld =>
                layOffMany(meld, selectedCards) !== null ||
                (selectedCards.length === 1 && swapOut(meld, selectedCards[0]) !== null && swapTargets.includes(meld.id)),
        );
        return new Set(fits.map(meld => meld.id));
    }, [hand, myPlay, selectedCards, choosingSwap, swapTargets]);

    const tentative = useMemo(
        () => new Set(hand.opened.cookie ? [] : hand.turn === 'cookie' ? hand.turnMeldIds : []),
        [hand.opened.cookie, hand.turn, hand.turnMeldIds],
    );

    const discardReady = myPlay && selectedCards.length === 1 && discardCard(hand, selectedCards[0].id).ok;
    const lastCard = myPlay && hand.hands.cookie.length === 1;

    const line = statusLine(hand, selectedCards, choosingSwap);

    const off = (ready: boolean) => (ready ? '' : ' kal-off');

    const statsPills = (
        <>
            <Stat value={totals.cookie} label="you" icon={<Cookie size={15} aria-hidden />} />
            <Stat value={totals.computer} label="computer" icon={<Cpu size={15} aria-hidden />} />
            <Stat value={hand.handNo} label="hand" />
        </>
    );

    const actions = (
        <>
            <button
                className="btn btn-new kal-new"
                title="Deal a new hand"
                onClick={() => {
                    if (hand.phase === 'over') throwInHand();
                    else setConfirming('hand');
                }}
            >
                <Plus size={20} aria-hidden />
                <span>New hand</span>
            </button>
            {confirming === 'hand' && (
                <Confirm
                    text="Deal a new hand? This one will be thrown in, and nobody pays for it."
                    yes="Deal a new hand"
                    onYes={() => {
                        setConfirming(null);
                        throwInHand();
                    }}
                    onNo={() => setConfirming(null)}
                />
            )}
            {confirming === 'match' && (
                <Confirm
                    text="Start a new match? The scores go back to zero."
                    yes="Start a new match"
                    onYes={() => {
                        setConfirming(null);
                        startNewMatch();
                    }}
                    onNo={() => setConfirming(null)}
                />
            )}
        </>
    );

    const settings = (close: () => void) => (
        <>
            <section className="kal-settings">
                <h3>Points to open</h3>
                {OPENING_OPTIONS.map(option => (
                    <button key={option} className="row-btn" onClick={() => setOpening(option)}>
                        <span>
                            {option} points{option === DEFAULT_OPENING ? ' (the usual)' : ' (easier)'}
                        </span>
                        {match.opening === option && <Check size={16} className="row-check" aria-hidden />}
                    </button>
                ))}
            </section>
            <section>
                <h3>Cards in a hand</h3>
                {HAND_SIZE_OPTIONS.map(option => (
                    <button key={option} className="row-btn" onClick={() => setHandSize(option)}>
                        <span>
                            {option} cards{option === DEFAULT_HAND_SIZE ? ' (the usual)' : ''}
                        </span>
                        {match.handSize === option && <Check size={16} className="row-check" aria-hidden />}
                    </button>
                ))}
                {(match.opening !== hand.opening || match.handSize !== hand.handSize) && (
                    <p className="row-note">These start with the next hand.</p>
                )}
            </section>
            <section>
                <h3>Scores this match</h3>
                <ScoreTable history={history} totals={totals} />
            </section>
            <section className="record">
                <h3>Your record</h3>
                <p>
                    {stats.won} won of {stats.played} {stats.played === 1 ? 'match' : 'matches'}
                </p>
                <button
                    className="row-btn"
                    onClick={() => {
                        close();
                        setConfirming('match');
                    }}
                >
                    <RotateCcw size={18} aria-hidden />
                    <span>New match</span>
                </button>
            </section>
            <section className="kal-howto">
                <h3>How to play</h3>
                <p>On your turn, pick up a card, lay down what you can, then throw one away.</p>
                <p>A set is 3 or 4 of a kind in different suits. A run is 3 or more in a row in one suit.</p>
                <p>
                    Your first lay-down must add up to {hand.opening} points. Aces are 11, picture cards 10. A joker counts
                    as the card it stands for.
                </p>
                <p>Once you have opened you can add to any meld, and swap a joker for the card it stands for.</p>
                <p>
                    Lay down all but one card and throw that away to go out. Whoever still holds cards pays for them, with
                    jokers at {JOKER_CHARGE}. At {MATCH_LIMIT} the match ends and the lower score wins.
                </p>
            </section>
        </>
    );

    return (
        <GameShell title="Kalooki" stats={statsPills} actions={actions} settings={settings}>
            {/* A resumed game has had no tap yet to let the sounds play. */}
            <div className="kal-table" onPointerDownCapture={() => void unlockAudio()}>
                <ComputerHand cards={hand.hands.computer} reveal={hand.phase === 'over'} />

                <div className="kal-piles">
                    <Stock cards={hand.stock} live={myDraw} onTap={draw} />
                    <DiscardPile
                        cards={hand.discard}
                        live={myDraw ? takeOk : discardReady}
                        onTap={tapDiscardPile}
                    />
                </div>

                <MeldTable melds={hand.melds} targets={targets} tentative={tentative} onTap={tapMeld} />

                <div className="kal-bar">
                    <div className="kal-status" role="status" aria-live="polite">
                        {line}
                    </div>
                    <div className="kal-buttons">
                        {myDraw && (
                            <>
                                <button className="btn btn-primary" onClick={draw}>
                                    <ArrowDownToLine size={20} aria-hidden />
                                    <span>Draw</span>
                                </button>
                                <button
                                    className={`btn${off(takeOk)}`}
                                    aria-disabled={!takeOk}
                                    onClick={takeTopDiscard}
                                >
                                    <Hand size={20} aria-hidden />
                                    <span>Take discard</span>
                                </button>
                            </>
                        )}
                        {myPlay && (
                            <>
                                <button
                                    className={`btn${meldReady ? ' btn-primary' : ' kal-off'}`}
                                    aria-disabled={!meldReady}
                                    onClick={meldSelected}
                                >
                                    <Layers size={20} aria-hidden />
                                    <span>Meld</span>
                                </button>
                                <button
                                    className={`btn${off(swapTargets.length > 0)}`}
                                    aria-disabled={swapTargets.length === 0}
                                    onClick={pressSwap}
                                >
                                    <ArrowLeftRight size={20} aria-hidden />
                                    <span>Swap joker</span>
                                </button>
                                <button
                                    className={`btn${
                                        discardReady ? (lastCard ? ' btn-primary btn-gold' : ' btn-primary') : ' kal-off'
                                    }`}
                                    aria-disabled={!discardReady}
                                    onClick={discardSelected}
                                >
                                    <ArrowUpFromLine size={20} aria-hidden />
                                    <span>Discard</span>
                                </button>
                                <button
                                    className={`btn${tentative.size > 0 && !meldReady ? ' btn-primary' : ''}`}
                                    disabled={undo.length === 0}
                                    onClick={takeBack}
                                >
                                    <Undo2 size={20} aria-hidden />
                                    <span>Take back</span>
                                </button>
                            </>
                        )}
                        <button
                            className="btn"
                            onClick={toggleSort}
                            title={sortBy === 'suit' ? 'Sorted by suit. Tap to sort by rank.' : 'Sorted by rank. Tap to sort by suit.'}
                        >
                            <ArrowDownUp size={20} aria-hidden />
                            <span>Sort</span>
                        </button>
                    </div>
                </div>

                <CookieHand cards={sorted} selected={selected} mustUse={hand.mustUse} onToggle={toggleCard} />
            </div>

            {notice && <Notice key={notice.id}>{notice.text}</Notice>}
            {hand.phase === 'over' && <HandOver />}
        </GameShell>
    );
};

const KalookiGame: React.FC = () => (
    <PresenceContext.Provider value={START_SETTLED}>
        <KalookiTable />
    </PresenceContext.Provider>
);

export default KalookiGame;

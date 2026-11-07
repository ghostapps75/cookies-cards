import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpFromLine, Bot, Check, Combine, Grab, Layers, PartyPopper, RefreshCw, Trophy, Undo2 } from 'lucide-react';
import GameShell, { Confirm, Notice, Stat } from '../shared/GameShell';
import type { PlayingCard } from '../shared/cards';
import { cardName } from '../shared/cards';
import * as sfx from '../../utils/sound';
import { BackFan, DiscardPile, HandFan, HandPanel, MeldRow, Stock } from './parts';
import {
    cardsValue,
    countCanastas,
    goingOutPlan,
    isNaturalCanasta,
    isWild,
    minimumFor,
    planTake,
    planTakeWith,
    pileTop,
    rankWord,
    type MeldGroup,
    type MeldRank,
    type TakePlan,
} from './rules';
import { useCanastaStore } from './store';
import { sortHand, statusFor, tryMeld } from './view';
import './canasta.css';

/** Pause between the computer's steps, long enough to follow what it is doing. */
const STEP_MS = 950;
const NOTICE_MS = 3800;

interface Asking {
    text: string;
    yes: string;
    no?: string;
    run: () => void;
}

const nameCards = (cards: PlayingCard[]): string => {
    const names = cards.map(card => (card.rank === 'joker' ? 'a joker' : `the ${cardName(card)}`));
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

const ActionButton: React.FC<{
    icon: React.ReactNode;
    label: string;
    off: boolean;
    primary?: boolean;
    onClick: () => void;
}> = ({ icon, label, off, primary = false, onClick }) => (
    <button
        className={`btn${primary && !off ? ' btn-primary' : ''}${off ? ' cn-off' : ''}`}
        aria-disabled={off}
        onClick={onClick}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const CanastaGame: React.FC = () => {
    const hand = useCanastaStore(s => s.hand);
    const totals = useCanastaStore(s => s.totals);
    const handsPlayed = useCanastaStore(s => s.handsPlayed);
    const result = useCanastaStore(s => s.result);
    const winner = useCanastaStore(s => s.winner);
    const canastasNeeded = useCanastaStore(s => s.canastasNeeded);
    const stats = useCanastaStore(s => s.stats);
    const undo = useCanastaStore(s => s.undo);
    const selectedIds = useCanastaStore(s => s.selected);
    const notice = useCanastaStore(s => s.notice);
    const lastAction = useCanastaStore(s => s.lastAction);
    const play = useCanastaStore(s => s.play);
    const computerStep = useCanastaStore(s => s.computerStep);
    const toggle = useCanastaStore(s => s.toggle);
    const clearNotice = useCanastaStore(s => s.clearNotice);
    const say = useCanastaStore(s => s.say);
    const takeBack = useCanastaStore(s => s.takeBack);
    const nextHand = useCanastaStore(s => s.nextHand);
    const newHand = useCanastaStore(s => s.newHand);
    const newMatch = useCanastaStore(s => s.newMatch);
    const setCanastasNeeded = useCanastaStore(s => s.setCanastasNeeded);

    const [asking, setAsking] = useState<Asking | null>(null);

    const me = hand.players.cookie;
    const them = hand.players.computer;
    const myTurn = hand.turn === 'cookie' && hand.phase !== 'over';
    const drawing = myTurn && hand.phase === 'draw';
    const playing = myTurn && hand.phase === 'play';

    const sorted = useMemo(() => sortHand(me.hand), [me.hand]);
    const selected = useMemo(() => sorted.filter(card => selectedIds.includes(card.id)), [sorted, selectedIds]);

    // The computer plays itself, a step at a time, each after a pause.
    useEffect(() => {
        if (hand.phase === 'over' || hand.turn !== 'computer') return;
        const timer = window.setTimeout(computerStep, STEP_MS);
        return () => window.clearTimeout(timer);
    }, [hand, computerStep]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(clearNotice, NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [notice, clearNotice]);

    const take = useMemo(() => {
        const auto = planTake(hand, 'cookie');
        if (selected.length === 0) return auto;
        const chosen = planTakeWith(hand, 'cookie', selected);
        return chosen.ok ? chosen : auto;
    }, [hand, selected]);

    const meld = useMemo(() => (playing && selected.length > 0 ? tryMeld(hand, selected) : null), [hand, selected, playing]);
    const goOut = useMemo(() => (playing ? goingOutPlan(hand, 'cookie') : null), [hand, playing]);

    const layOffRanks = useMemo(() => {
        if (!playing || selected.length === 0) return new Set<MeldRank>();
        return new Set(me.melds.filter(m => tryMeld(hand, selected, m.rank).ok).map(m => m.rank));
    }, [hand, me.melds, playing, selected]);

    const minimum = minimumFor(hand, 'cookie');
    const firstMeld = me.melds.length === 0;
    const meldLabel =
        firstMeld && selected.length > 0 ? `Meld ${cardsValue(selected)} / ${minimum}` : 'Meld';
    const canTakeBack = playing && undo !== null && undo.players.cookie.hand.length !== me.hand.length;

    const status = statusFor({
        hand,
        selected,
        canTake: take.ok,
        canGoOut: goOut !== null,
        meld,
        canLayOff: layOffRanks.size > 0,
        lastAction,
    });

    const refuse = (text: string) => {
        sfx.playInvalid();
        say(text);
    };

    const notNow = (): boolean => {
        void sfx.unlockAudio();
        if (hand.phase === 'over') return true;
        if (!myTurn) {
            refuse('It is the computer’s turn. Yours is next.');
            return true;
        }
        return false;
    };

    const drawCards = () => {
        if (notNow()) return;
        if (!drawing) return refuse('You have already drawn. Meld or lay off, then discard.');
        play({ type: 'draw' });
    };

    const doTake = (plan: TakePlan) => play({ type: 'take', groups: plan.groups });

    const takePile = () => {
        if (notNow()) return;
        if (!drawing) return refuse('You have already drawn. Meld or lay off, then discard.');
        if (!take.ok) return refuse(take.reason);
        const plan = take.value;
        const top = pileTop(hand);
        // Anything beyond a plain pair of naturals gets asked about first.
        const naturalPair = plan.cards.length <= 2 && !plan.usesWild;
        if (naturalPair || !top) return void doTake(plan);
        setAsking({
            text: `Take the pile? The ${rankWord(top.rank)} on top goes down with ${nameCards(plan.cards)}.`,
            yes: 'Take the pile',
            no: 'Not now',
            run: () => doTake(plan),
        });
    };

    const askToGoOut = (run: () => void) =>
        setAsking({ text: 'Go out now? That ends the hand.', yes: 'Go out', run });

    const putDown = (groups: MeldGroup[], handLeft: number) => {
        if (handLeft === 0) askToGoOut(() => play({ type: 'meld', groups }));
        else play({ type: 'meld', groups });
    };

    const pressMeld = () => {
        if (notNow()) return;
        if (!playing) return refuse('Draw two cards or take the pile first.');
        if (selected.length === 0) return refuse('Tap the cards you want to meld first.');
        if (!meld) return;
        if (!meld.ok) return refuse(meld.reason);
        putDown(meld.value.groups, meld.value.check.hand.length);
    };

    const tapMeld = (rank: MeldRank) => {
        if (notNow()) return;
        if (!playing) return refuse('Draw two cards or take the pile first.');
        if (selected.length === 0) return refuse('Tap a card in your hand first, then tap this meld to add it.');
        const attempt = tryMeld(hand, selected, rank);
        if (!attempt.ok) return refuse(attempt.reason);
        const target = me.melds.find(m => m.rank === rank);
        const { groups, check } = attempt.value;
        if (target && isNaturalCanasta(target) && selected.some(isWild)) {
            setAsking({
                text: 'A wild card turns this natural canasta, worth 500, into a mixed one worth 300. Add it anyway?',
                yes: 'Add it',
                no: 'Leave it',
                run: () => putDown(groups, check.hand.length),
            });
            return;
        }
        putDown(groups, check.hand.length);
    };

    const pressDiscard = () => {
        if (notNow()) return;
        if (!playing) return refuse('Draw two cards or take the pile first.');
        if (selected.length !== 1) {
            return refuse(selected.length === 0 ? 'Tap the card you want to discard first.' : 'Choose just one card to discard.');
        }
        const cardId = selected[0].id;
        if (me.hand.length === 1 && countCanastas(me.melds) >= hand.canastasNeeded) {
            return askToGoOut(() => play({ type: 'discard', cardId }));
        }
        play({ type: 'discard', cardId });
    };

    const tapPile = () => {
        if (drawing) takePile();
        else if (playing) pressDiscard();
        else notNow();
    };

    const pressGoOut = () => {
        if (notNow()) return;
        if (goOut) askToGoOut(() => play({ type: 'goOut' }));
    };

    const tapCard = (card: PlayingCard) => {
        void sfx.unlockAudio();
        sfx.playClick();
        toggle(card.id);
    };

    const askNewHand = () =>
        setAsking({ text: 'Deal a new hand? This one will not count.', yes: 'Deal a new hand', run: newHand });
    const askNewMatch = () =>
        setAsking({ text: 'Start a new match? The scores go back to zero.', yes: 'Start a new match', run: newMatch });

    const handNumber = handsPlayed + (result ? 0 : 1);

    return (
        <GameShell
            title="Canasta"
            stats={
                <>
                    <Stat icon={<span className="cn-stat-mark">🍪</span>} value={totals.cookie} label="Cookie" />
                    <Stat icon={<Bot size={16} aria-hidden />} value={totals.computer} label="Computer" />
                    <Stat value={handNumber} label="Hand" />
                </>
            }
            actions={
                <button className="btn" onClick={askNewHand} title="Deal a new hand">
                    <RefreshCw size={18} aria-hidden />
                    <span>New hand</span>
                </button>
            }
            settings={close => (
                <>
                    <section>
                        <h3>Canastas needed to go out</h3>
                        <div className="cn-choice" role="radiogroup" aria-label="Canastas needed to go out">
                            {[1, 2].map(count => (
                                <button
                                    key={count}
                                    className={`row-btn${canastasNeeded === count ? ' is-active' : ''}`}
                                    role="radio"
                                    aria-checked={canastasNeeded === count}
                                    onClick={() => {
                                        sfx.playClick();
                                        setCanastasNeeded(count);
                                    }}
                                >
                                    <span>{count}</span>
                                    {canastasNeeded === count && <Check size={16} className="row-check" aria-hidden />}
                                </button>
                            ))}
                        </div>
                        <p className="row-note">A canasta is seven or more cards of one rank.</p>
                    </section>
                    <section>
                        <h3>This match</h3>
                        <p className="row-note">
                            Cookie {totals.cookie}, computer {totals.computer}, after {handsPlayed}{' '}
                            {handsPlayed === 1 ? 'hand' : 'hands'}. Matches won: {stats.won} of {stats.played}.
                        </p>
                        <button
                            className="row-btn"
                            onClick={() => {
                                close();
                                askNewHand();
                            }}
                        >
                            <RefreshCw size={18} aria-hidden />
                            <span>New hand</span>
                        </button>
                        <button
                            className="row-btn"
                            onClick={() => {
                                close();
                                askNewMatch();
                            }}
                        >
                            <Trophy size={18} aria-hidden />
                            <span>New match</span>
                        </button>
                    </section>
                </>
            )}
        >
            <div className="cn-root">
                <div className="cn-table">
                    <div className="cn-row cn-theirs">
                        <BackFan cards={them.hand} />
                        <MeldRow melds={them.melds} reds={them.redThrees} emptyText="The computer’s melds go here" />
                    </div>

                    <div className="cn-row cn-middle">
                        <div className="cn-piles">
                            <Stock cards={hand.stock} live={drawing && hand.stock.length > 0} onTap={drawCards} />
                            <DiscardPile
                                cards={hand.discard}
                                frozen={hand.frozen}
                                live={drawing && take.ok}
                                onTap={tapPile}
                            />
                        </div>
                        <div className="cn-controls">
                            <div className="cn-status" role="status" aria-live="polite">
                                <strong>{status.line}</strong>
                                <small>{status.hint ?? ' '}</small>
                            </div>
                            <div className="cn-buttons">
                                <ActionButton
                                    icon={<Layers size={18} aria-hidden />}
                                    label="Draw"
                                    off={!drawing || hand.stock.length === 0}
                                    primary={drawing}
                                    onClick={drawCards}
                                />
                                <ActionButton
                                    icon={<Grab size={18} aria-hidden />}
                                    label="Take pile"
                                    off={!drawing || !take.ok}
                                    primary={drawing && hand.stock.length === 0}
                                    onClick={takePile}
                                />
                                <ActionButton
                                    icon={<Combine size={18} aria-hidden />}
                                    label={meldLabel}
                                    off={!meld?.ok}
                                    primary={meld?.ok}
                                    onClick={pressMeld}
                                />
                                <ActionButton
                                    icon={<ArrowUpFromLine size={18} aria-hidden />}
                                    label="Discard"
                                    off={!playing || selected.length !== 1}
                                    primary={selected.length === 1 && !meld?.ok}
                                    onClick={pressDiscard}
                                />
                                {goOut && (
                                    <button className="btn btn-primary btn-gold" onClick={pressGoOut}>
                                        <PartyPopper size={18} aria-hidden />
                                        <span>Go out</span>
                                    </button>
                                )}
                                {canTakeBack && (
                                    <button className="btn" onClick={takeBack} title="Take back what you melded this turn">
                                        <Undo2 size={18} aria-hidden />
                                        <span>Take back</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="cn-row cn-mine">
                        <MeldRow
                            melds={me.melds}
                            reds={me.redThrees}
                            emptyText="Your melds go here"
                            highlight={rank => layOffRanks.has(rank)}
                            onTap={tapMeld}
                        />
                    </div>

                    <HandFan cards={sorted} selected={selectedIds} onTap={tapCard} />
                </div>

                {notice && !asking && <Notice key={notice.id}>{notice.text}</Notice>}
            </div>

            {asking &&
                createPortal(
                    <Confirm
                        text={asking.text}
                        yes={asking.yes}
                        no={asking.no}
                        onYes={() => {
                            const { run } = asking;
                            setAsking(null);
                            run();
                        }}
                        onNo={() => setAsking(null)}
                    />,
                    document.body,
                )}

            {result &&
                createPortal(
                    <HandPanel
                        result={result}
                        totals={totals}
                        winner={winner}
                        handsPlayed={handsPlayed}
                        stats={stats}
                        onNext={nextHand}
                    />,
                    document.body,
                )}
        </GameShell>
    );
};

export default CanastaGame;

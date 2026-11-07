import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    ArrowDown01,
    ArrowDownToLine,
    ArrowRight,
    Bot,
    Check,
    Flag,
    Palette,
    Plus,
    RotateCcw,
    SkipForward,
    Undo2,
} from 'lucide-react';
import GameShell, { Confirm, Notice, Stat } from '../shared/GameShell';
import * as sfx from '../../utils/sound';
import { fitTable } from './fit';
import {
    boardChanged,
    canReplaceJoker,
    currentBoard,
    isJoker,
    readSet,
    type RoundResult,
    type TableSet,
    type Tile,
} from './rules';
import { FAULT_WORD, cookieStatus } from './status';
import { turnCheck, useTiles, type RoundRecord } from './store';
import TileView, { StaticTile } from './TileView';
import { useElementSize } from './useElementSize';
import { useTileDrag } from './useTileDrag';
import './tiles.css';

type Vars = React.CSSProperties & Record<`--${string}`, string>;

interface Asking {
    text: string;
    yes: string;
    go: () => void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Under this board height the table is a phone held sideways: every row earns its keep. */
const COMPACT_HEIGHT = 500;

/* ----------------------------------------------------------- a set on the table */

interface TableSetViewProps {
    set: TableSet;
    lifted: readonly string[];
    liftedTiles: readonly Tile[];
    fresh: readonly string[];
    locked: boolean;
    active: boolean;
    onTile: (id: string) => void;
    onSet: (id: string) => void;
}

const TableSetView: React.FC<TableSetViewProps> = ({ set, lifted, liftedTiles, fresh, locked, active, onTile, onSet }) => {
    const reading = useMemo(() => readSet(set.tiles), [set.tiles]);

    // With tiles in hand, the sets that would take them glow. It costs nothing and teaches a lot.
    const welcomes =
        active &&
        !locked &&
        liftedTiles.length > 0 &&
        liftedTiles.some(tile => !set.tiles.some(held => held.id === tile.id)) &&
        readSet([...set.tiles.filter(tile => !lifted.includes(tile.id)), ...liftedTiles]).valid;

    const classes = [
        'tile-set',
        !reading.valid && 'is-invalid',
        welcomes && 'is-welcome',
        locked && 'is-locked',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <motion.div
            layout="position"
            className={classes}
            data-set={set.id}
            data-valid={reading.valid}
            onClick={event => {
                event.stopPropagation();
                onSet(set.id);
            }}
        >
            {set.tiles.map(tile => (
                <TileView
                    key={tile.id}
                    tile={tile}
                    lifted={lifted.includes(tile.id)}
                    fresh={fresh.includes(tile.id)}
                    swappable={
                        active &&
                        !locked &&
                        isJoker(tile) &&
                        liftedTiles.length === 1 &&
                        canReplaceJoker(set, tile.id, liftedTiles[0])
                    }
                    role={reading.valid ? reading.roles[tile.id] : undefined}
                    onTap={active ? onTile : undefined}
                />
            ))}
            {!reading.valid && <span className="tile-set-word">{FAULT_WORD[reading.fault]}</span>}
        </motion.div>
    );
};

const TableSetMemo = React.memo(TableSetView);

/* ------------------------------------------------------------- the end of a round */

const headline = (result: RoundResult): { title: string; sub: string } => {
    if (result.how === 'out') {
        return result.winner === 'cookie'
            ? { title: 'You went out!', sub: 'Your rack is empty. Well played.' }
            : { title: 'Computer went out', sub: 'Its rack is empty. You will get it next time.' };
    }
    const sub = 'The pool ran out and nobody could play, so the lower rack wins.';
    if (result.winner === 'cookie') return { title: 'You win the round!', sub };
    if (result.winner === 'computer') return { title: 'Computer wins the round', sub };
    return { title: 'It is a tie', sub: 'The pool ran out and both racks came to the same total.' };
};

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

const RoundPanel: React.FC<{
    result: RoundResult;
    record: RoundRecord | undefined;
    totals: { cookie: number; computer: number };
    number: number;
    onNext: () => void;
}> = ({ result, record, totals, number, onNext }) => {
    const { title, sub } = headline(result);
    return (
        <div className="win-panel-wrap">
            <motion.div
                className="win-panel tiles-round-panel"
                role="dialog"
                aria-label="Round over"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            >
                <div className="win-cookie">{result.winner === 'cookie' ? '🍪' : '🀄'}</div>
                <h2>{title}</h2>
                <p className="win-sub">{sub}</p>

                <table className="tiles-score">
                    <thead>
                        <tr>
                            <th scope="col">Round {number}</th>
                            <th scope="col">Tiles left</th>
                            <th scope="col">Worth</th>
                            <th scope="col">Score</th>
                            <th scope="col">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className={result.winner === 'cookie' ? 'is-winner' : undefined}>
                            <th scope="row">Cookie</th>
                            <td>{result.counts.cookie}</td>
                            <td>{result.values.cookie}</td>
                            <td>{signed(record?.cookie ?? 0)}</td>
                            <td>{totals.cookie}</td>
                        </tr>
                        <tr className={result.winner === 'computer' ? 'is-winner' : undefined}>
                            <th scope="row">Computer</th>
                            <td>{result.counts.computer}</td>
                            <td>{result.values.computer}</td>
                            <td>{signed(record?.computer ?? 0)}</td>
                            <td>{totals.computer}</td>
                        </tr>
                    </tbody>
                </table>

                <div className="win-actions">
                    <button className="btn btn-primary btn-lg" onClick={onNext}>
                        <ArrowRight size={20} aria-hidden />
                        <span>Next round</span>
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

/* ------------------------------------------------------------------ the game */

const TileRummyGame: React.FC = () => {
    const round = useTiles(s => s.round);
    const rounds = useTiles(s => s.rounds);
    const stats = useTiles(s => s.stats);
    const lifted = useTiles(s => s.lifted);
    const history = useTiles(s => s.history);
    const computer = useTiles(s => s.computer);
    const note = useTiles(s => s.note);
    const fresh = useTiles(s => s.fresh);
    const notice = useTiles(s => s.notice);
    const rackSort = useTiles(s => s.rackSort);

    const tapRackTile = useTiles(s => s.tapRackTile);
    const tapTableTile = useTiles(s => s.tapTableTile);
    const tapSet = useTiles(s => s.tapSet);
    const tapNewSet = useTiles(s => s.tapNewSet);
    const tapRack = useTiles(s => s.tapRack);
    const tapFelt = useTiles(s => s.tapFelt);
    const clearNotice = useTiles(s => s.clearNotice);

    const [asking, setAsking] = useState<Asking | null>(null);
    const [boardRef, boardSize] = useElementSize<HTMLDivElement>();
    const [wellRef, wellSize] = useElementSize<HTMLDivElement>();
    const [tableRef, tableSize] = useElementSize<HTMLDivElement>();

    // The computer's turn plays out one step at a time, and stops if she leaves the table.
    useEffect(() => {
        if (!computer) return;
        const timer = window.setTimeout(() => useTiles.getState().computerTick(), computer.delay);
        return () => window.clearTimeout(timer);
    }, [computer]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(clearNotice, 3200);
        return () => window.clearTimeout(timer);
    }, [notice, clearNotice]);

    /* ---------------------------------------------------------------- sizes */

    const compact = boardSize.height > 0 && boardSize.height < COMPACT_HEIGHT;
    const rack = round.racks.cookie;
    const rackColumns = Math.max(7, Math.ceil(rack.length / 2));
    const rackByWidth = wellSize.width > 0 ? (wellSize.width - (rackColumns - 1) * 3) / rackColumns : 44;
    const rackByHeight = compact ? Math.min(40, boardSize.height * 0.108) : clamp(boardSize.height * 0.082, 34, 56);
    const rackTile = Math.floor(clamp(Math.min(rackByWidth, rackByHeight), 16, 56));

    const tableSizes = useMemo(() => round.table.map(set => set.tiles.length), [round.table]);
    const fit = useMemo(
        () => fitTable(tableSize.width, tableSize.height, tableSizes, 18, compact ? 40 : 52),
        [tableSize.width, tableSize.height, tableSizes, compact],
    );

    const computerTile = compact ? 12 : 20;
    const computerRoom = compact ? 72 : 360;
    const computerStep =
        round.racks.computer.length > 1
            ? Math.min(computerTile + 2, (computerRoom - computerTile) / (round.racks.computer.length - 1))
            : 0;

    /* ---------------------------------------------------------------- state */

    const result = round.result;
    const myTurn = round.turn === 'cookie' && !result && !computer;
    const board = currentBoard(round);
    const changed = myTurn && boardChanged(round.start, board);
    const canEnd = myTurn && !turnCheck(round).problem;
    const poolEmpty = round.pool.length === 0;

    const liftedTiles = useMemo(() => {
        const all = [...round.racks.cookie, ...round.table.flatMap(set => set.tiles)];
        return lifted.map(id => all.find(tile => tile.id === id)).filter((tile): tile is Tile => Boolean(tile));
    }, [lifted, round.racks.cookie, round.table]);

    const lockedSets = useMemo(() => {
        const locked = new Set<string>();
        if (round.opened.cookie) return locked;
        const before = new Set(round.start.table.flatMap(set => set.tiles.map(tile => tile.id)));
        for (const set of round.table) {
            if (set.tiles.some(tile => before.has(tile.id))) locked.add(set.id);
        }
        return locked;
    }, [round.opened.cookie, round.start.table, round.table]);

    const totals = useMemo(
        () =>
            rounds.reduce(
                (sum, record) => ({ cookie: sum.cookie + record.cookie, computer: sum.computer + record.computer }),
                { cookie: 0, computer: 0 },
            ),
        [rounds],
    );

    const { ghost, onPointerDown } = useTileDrag(myTurn);

    let status: string;
    if (result) status = 'The round is over';
    else if (computer) status = computer.say;
    else status = cookieStatus(round, lifted);

    const act = (fn: () => void) => () => {
        void sfx.unlockAudio();
        fn();
    };

    const ask = (text: string, yes: string, go: () => void) => {
        void sfx.unlockAudio();
        sfx.playClick();
        setAsking({ text, yes, go });
    };

    const askNewRound = () => {
        if (result) {
            useTiles.getState().newRound();
            return;
        }
        ask('Deal a new round? This one will not count for anyone.', 'Deal a new round', () =>
            useTiles.getState().newRound(),
        );
    };

    const askNewGame = () => {
        ask('Start a new game? The scores so far will be cleared.', 'Start a new game', () =>
            useTiles.getState().newGame(),
        );
    };

    return (
        <GameShell
            title="Tile Rummy"
            dimmed={ghost !== null}
            stats={
                <>
                    <Stat value={totals.cookie} label="Cookie" icon={<span aria-hidden>🍪</span>} />
                    <Stat value={totals.computer} label="Computer" icon={<Bot size={15} aria-hidden />} />
                    <Stat value={round.number} label="Round" />
                </>
            }
            actions={
                <>
                    <button className="btn" onClick={askNewRound} title="Deal a new round">
                        <Plus size={20} aria-hidden />
                        <span>New round</span>
                    </button>
                    {asking && (
                        <Confirm
                            text={asking.text}
                            yes={asking.yes}
                            onYes={() => {
                                const { go } = asking;
                                setAsking(null);
                                go();
                            }}
                            onNo={() => setAsking(null)}
                        />
                    )}
                </>
            }
            settings={close => (
                <>
                    <section className="tiles-rounds">
                        <h3>Rounds</h3>
                        {rounds.length === 0 ? (
                            <p className="row-note">No rounds finished yet.</p>
                        ) : (
                            <div className="tiles-rounds-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th scope="col">Round</th>
                                            <th scope="col">Cookie</th>
                                            <th scope="col">Computer</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rounds.map(record => (
                                            <tr key={record.number}>
                                                <td>{record.number}</td>
                                                <td>{signed(record.cookie)}</td>
                                                <td>{signed(record.computer)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <th scope="row">Total</th>
                                            <td>{totals.cookie}</td>
                                            <td>{totals.computer}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                        <p className="row-note">
                            {stats.played === 0
                                ? 'Rounds you win are remembered here.'
                                : `You have won ${stats.won} of ${stats.played} rounds in all.`}
                        </p>
                    </section>
                    <section>
                        <h3>Start again</h3>
                        <button
                            className="row-btn"
                            onClick={() => {
                                close();
                                askNewRound();
                            }}
                        >
                            <Plus size={18} aria-hidden />
                            <span>New round</span>
                        </button>
                        <button
                            className="row-btn"
                            onClick={() => {
                                close();
                                askNewGame();
                            }}
                        >
                            <RotateCcw size={18} aria-hidden />
                            <span>New game</span>
                        </button>
                    </section>
                </>
            )}
        >
            <div
                ref={boardRef}
                className={`tiles-board${compact ? ' is-compact' : ''}${ghost ? ' is-dragging' : ''}`}
                onClick={tapFelt}
                onPointerDown={onPointerDown}
            >
                <div
                    className="tiles-computer"
                    style={{ '--tile-w': `${computerTile}px`, '--overlap': `${computerTile - computerStep}px` } as Vars}
                >
                    <span className="tiles-computer-name">
                        <Bot size={compact ? 14 : 16} aria-hidden />
                        <span className="tiles-computer-word">Computer</span>
                    </span>
                    <div className="tiles-computer-rack" aria-hidden>
                        {round.racks.computer.map(tile => (
                            <TileView key={tile.id} tile={tile} faceDown />
                        ))}
                    </div>
                    <span className="tiles-computer-count">
                        {round.racks.computer.length}
                        <span className="tiles-computer-word"> tiles</span>
                    </span>
                </div>

                <div className={`tiles-status${computer ? ' is-computer' : ''}`} role="status" aria-live="polite">
                    {note && myTurn && !changed && lifted.length === 0 && (
                        <span className="tiles-status-note">{note} </span>
                    )}
                    <span className="tiles-status-line">{status}</span>
                </div>

                <div
                    className="tiles-rack-area"
                    style={{ '--tile-w': `${rackTile}px`, '--rack-cols': String(rackColumns) } as Vars}
                >
                    <div className="tiles-sort">
                        <button
                            className={`btn${rackSort === 'color' ? ' is-sorted' : ''}`}
                            onClick={act(() => useTiles.getState().sortBy('color'))}
                            title="Sort your rack by colour"
                            aria-label="Sort by colour"
                        >
                            <Palette size={18} aria-hidden />
                            <span>Colour</span>
                        </button>
                        <button
                            className={`btn${rackSort === 'number' ? ' is-sorted' : ''}`}
                            onClick={act(() => useTiles.getState().sortBy('number'))}
                            title="Sort your rack by number"
                            aria-label="Sort by number"
                        >
                            <ArrowDown01 size={18} aria-hidden />
                            <span>Number</span>
                        </button>
                    </div>

                    <div ref={wellRef} className="tiles-well">
                        <div
                            className={`tiles-rack${myTurn && lifted.length > 0 ? ' is-open' : ''}`}
                            data-rack
                            onClick={event => {
                                event.stopPropagation();
                                tapRack();
                            }}
                        >
                            {rack.map(tile => (
                                <TileView
                                    key={tile.id}
                                    tile={tile}
                                    lifted={lifted.includes(tile.id)}
                                    onTap={myTurn ? tapRackTile : undefined}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <div className="tiles-side">
                    <div className="tiles-buttons">
                        <button
                            className={`btn btn-primary tiles-end${canEnd && rack.length === 0 ? ' btn-gold' : ''}`}
                            disabled={!canEnd}
                            onClick={act(() => useTiles.getState().endTurn())}
                            title="End your turn"
                        >
                            <Check size={20} aria-hidden />
                            <span>End turn</span>
                        </button>
                        {changed ? (
                            <button
                                className="btn"
                                onClick={() =>
                                    ask(
                                        poolEmpty
                                            ? 'Put everything back and pass?'
                                            : 'Put everything back and take a tile from the pool?',
                                        poolEmpty ? 'Yes, pass' : 'Yes, take a tile',
                                        () => useTiles.getState().giveUp(),
                                    )
                                }
                                title="Stuck? Put everything back and end your turn"
                                aria-label="Give up this turn"
                            >
                                <Flag size={20} aria-hidden />
                                <span>Give up</span>
                            </button>
                        ) : (
                            <button
                                className="btn"
                                disabled={!myTurn}
                                onClick={act(() => useTiles.getState().draw())}
                                title={poolEmpty ? 'Pass your turn' : 'Take a tile from the pool and end your turn'}
                                aria-label={poolEmpty ? 'Pass' : 'Draw'}
                            >
                                {poolEmpty ? (
                                    <SkipForward size={20} aria-hidden />
                                ) : (
                                    <ArrowDownToLine size={20} aria-hidden />
                                )}
                                <span>{poolEmpty ? 'Pass' : 'Draw'}</span>
                            </button>
                        )}
                        <button
                            className="btn"
                            disabled={!myTurn || history.length === 0}
                            onClick={act(() => useTiles.getState().undo())}
                            title="Take back your last move"
                            aria-label="Undo"
                        >
                            <Undo2 size={20} aria-hidden />
                            <span>Undo</span>
                        </button>
                        <button
                            className="btn"
                            disabled={!changed}
                            onClick={act(() => useTiles.getState().startOver())}
                            title="Put the table and your rack back as they were when your turn began"
                            aria-label="Start over"
                        >
                            <RotateCcw size={20} aria-hidden />
                            <span>Start over</span>
                        </button>
                    </div>

                    <div className="tiles-pool" style={{ '--tile-w': `${compact ? 24 : 34}px` } as Vars}>
                        <div className="tiles-pool-stack" aria-hidden>
                            {round.pool.length > 2 && <div className="tile is-down tiles-pool-under" />}
                            {round.pool.length > 1 && <div className="tile is-down tiles-pool-mid" />}
                            {round.pool[0] && <TileView tile={round.pool[0]} faceDown />}
                        </div>
                        <div className="tiles-pool-count" data-pool-count={round.pool.length}>
                            <strong>{round.pool.length}</strong>
                            <span>in pool</span>
                        </div>
                    </div>
                </div>

                <div
                    ref={tableRef}
                    className={`tiles-table${fit.overflows ? ' is-overflowing' : ''}`}
                    style={{ '--tile-w': `${fit.tile}px` } as Vars}
                >
                    {round.table.map(set => (
                        <TableSetMemo
                            key={set.id}
                            set={set}
                            lifted={lifted}
                            liftedTiles={liftedTiles}
                            fresh={fresh}
                            locked={lockedSets.has(set.id)}
                            active={myTurn}
                            onTile={tapTableTile}
                            onSet={tapSet}
                        />
                    ))}
                    <motion.button
                        layout="position"
                        className={`tile-new-set${myTurn && lifted.length > 0 ? ' is-welcome' : ''}`}
                        disabled={!myTurn}
                        onClick={event => {
                            event.stopPropagation();
                            tapNewSet();
                        }}
                        aria-label="Start a new set"
                    >
                        <Plus size={Math.max(12, fit.tile * 0.34)} aria-hidden />
                        <span>New set</span>
                    </motion.button>
                </div>
            </div>

            {ghost && (
                <div
                    className="tiles-ghost"
                    style={{ left: ghost.x, top: ghost.y, '--tile-w': `${ghost.width}px` } as Vars}
                    aria-hidden
                >
                    {liftedTiles.map(tile => (
                        <StaticTile key={tile.id} tile={tile} />
                    ))}
                </div>
            )}

            {notice && (
                <div className="tiles-notice">
                    <Notice>{notice}</Notice>
                </div>
            )}

            {result && (
                <RoundPanel
                    result={result}
                    record={rounds[rounds.length - 1]}
                    totals={totals}
                    number={round.number}
                    onNext={act(() => useTiles.getState().nextRound())}
                />
            )}
        </GameShell>
    );
};

export default TileRummyGame;

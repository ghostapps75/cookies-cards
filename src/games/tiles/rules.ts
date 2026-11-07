import { mulberry32 } from '../../utils/gameLogic';
import { shuffled } from '../shared/cards';

/**
 * Tile Rummy's rules, as pure functions. Nothing in here touches the screen,
 * the clock or storage, so whole rounds can be played in a test.
 *
 * A set's meaning comes from which tiles are in it, not from how they are laid
 * out: `readSet` works out whether they make a group or a run and what any joker
 * stands for, and `order` is simply the tidy way to show them.
 */

export const TILE_COLORS = ['black', 'blue', 'orange', 'red'] as const;
export type TileColor = (typeof TILE_COLORS)[number];
export type Player = 'cookie' | 'computer';

export const MAX_NUMBER = 13;
export const START_TILES = 14;
export const OPENING_POINTS = 30;
export const JOKER_RACK_VALUE = 30;
/** Tiles drawn when a turn cannot be finished. The official penalty is three, but this is for Cookie. */
export const FAILED_TURN_DRAW = 1;

export interface Tile {
    readonly id: string;
    /** Null for a joker. */
    readonly color: TileColor | null;
    /** 1 to 13; 0 for a joker. */
    readonly number: number;
}

export interface TableSet {
    readonly id: string;
    readonly tiles: readonly Tile[];
}

/** The tiles one player can see and move: the table and their own rack. */
export interface Board {
    readonly table: readonly TableSet[];
    readonly rack: readonly Tile[];
}

export const isJoker = (tile: Tile): boolean => tile.color === null;

export const tileName = (tile: Tile): string => (isJoker(tile) ? 'joker' : `${tile.color} ${tile.number}`);

/** All 106: one to thirteen in four colours, two of each, and two jokers. */
export const buildTiles = (): Tile[] => {
    const tiles: Tile[] = [];
    for (let copy = 0; copy < 2; copy++) {
        for (const color of TILE_COLORS) {
            for (let number = 1; number <= MAX_NUMBER; number++) {
                tiles.push({ id: `${color}_${number}_${copy}`, color, number });
            }
        }
        tiles.push({ id: `joker_${copy}`, color: null, number: 0 });
    }
    return tiles;
};

/* ------------------------------------------------------- reading one set */

export type SetFault = 'empty' | 'short' | 'mixed' | 'repeat' | 'gap' | 'long';

/** What a joker stands for. A group leaves the colour open, so `colors` can hold several. */
export interface JokerRole {
    number: number;
    colors: TileColor[];
}

export interface ValidSet {
    valid: true;
    kind: 'group' | 'run';
    /** Face value, with each joker worth the tile it stands for. */
    value: number;
    order: Tile[];
    roles: Record<string, JokerRole>;
}

export interface InvalidSet {
    valid: false;
    fault: SetFault;
    order: Tile[];
}

export type SetReading = ValidSet | InvalidSet;

const invalid = (fault: SetFault, order: readonly Tile[]): InvalidSet => ({ valid: false, fault, order: [...order] });

const readGroup = (tiles: readonly Tile[], reals: Tile[], jokers: Tile[]): SetReading | null => {
    const number = reals[0].number;
    if (reals.some(tile => tile.number !== number)) return null;
    const colors = reals.map(tile => tile.color as TileColor);
    if (new Set(colors).size < colors.length) return invalid('repeat', tiles);
    if (tiles.length < 3) return invalid('short', tiles);
    if (tiles.length > TILE_COLORS.length) return invalid('long', tiles);

    const missing = TILE_COLORS.filter(color => !colors.includes(color));
    const roles: Record<string, JokerRole> = {};
    for (const joker of jokers) roles[joker.id] = { number, colors: missing };
    return { valid: true, kind: 'group', value: number * tiles.length, order: [...tiles], roles };
};

const readRun = (reals: Tile[], jokers: Tile[]): SetReading | null => {
    const color = reals[0].color as TileColor;
    if (reals.some(tile => tile.color !== color)) return null;
    const sorted = [...reals].sort((a, b) => a.number - b.number);
    if (sorted.some((tile, i) => i > 0 && sorted[i - 1].number === tile.number)) {
        return invalid('repeat', [...sorted, ...jokers]);
    }

    const order: Tile[] = [];
    const roles: Record<string, JokerRole> = {};
    const spare = [...jokers];
    let value = 0;
    let hasGap = false;
    let next = sorted[0].number;

    // Jokers fill the holes first...
    for (const tile of sorted) {
        while (next < tile.number && spare.length > 0) {
            const joker = spare.shift() as Tile;
            order.push(joker);
            roles[joker.id] = { number: next, colors: [color] };
            value += next;
            next++;
        }
        if (next < tile.number) hasGap = true;
        order.push(tile);
        value += tile.number;
        next = tile.number + 1;
    }

    // ...and any left over go on the top end, the side worth more, then the
    // bottom. A run never goes round the corner, so 13 is as high as it climbs.
    let low = sorted[0].number;
    let high = next - 1;
    let overflow = false;
    for (const joker of spare) {
        if (high < MAX_NUMBER) {
            high++;
            order.push(joker);
            roles[joker.id] = { number: high, colors: [color] };
            value += high;
        } else if (low > 1) {
            low--;
            order.unshift(joker);
            roles[joker.id] = { number: low, colors: [color] };
            value += low;
        } else {
            order.push(joker);
            overflow = true;
        }
    }

    if (order.length < 3) return invalid('short', order);
    if (hasGap) return invalid('gap', order);
    if (overflow) return invalid('long', order);
    return { valid: true, kind: 'run', value, order, roles };
};

/** Is this a group or a run, what is it worth, and if it is neither, why not? */
export const readSet = (tiles: readonly Tile[]): SetReading => {
    if (tiles.length === 0) return invalid('empty', tiles);
    const reals = tiles.filter(tile => !isJoker(tile));
    const jokers = tiles.filter(isJoker);
    if (reals.length === 0) return invalid('short', tiles);

    const run = readRun(reals, jokers);
    const group = readGroup(tiles, reals, jokers);
    const goodRun = run?.valid ? run : null;
    const goodGroup = group?.valid ? group : null;

    // One tile and two jokers could be either: count it as whichever is worth more.
    if (goodRun && goodGroup) return goodGroup.value > goodRun.value ? goodGroup : goodRun;
    if (goodRun) return goodRun;
    if (goodGroup) return goodGroup;

    const order = run?.order ?? [...tiles];
    if (tiles.length < 3) return invalid('short', order);
    return run ?? group ?? invalid('mixed', tiles);
};

/** The tidy way to lay these tiles out: a run in number order, a group as it was built. */
export const arrangeSet = (tiles: readonly Tile[]): Tile[] => readSet(tiles).order;

export const firstInvalidSet = (table: readonly TableSet[]): TableSet | null =>
    table.find(set => !readSet(set.tiles).valid) ?? null;

export const isTableValid = (table: readonly TableSet[]): boolean => firstInvalidSet(table) === null;

/* -------------------------------------------------------- moving tiles */

const setNumber = (id: string): number => Number(id.slice(1)) || 0;

export const freshSetId = (table: readonly TableSet[]): string =>
    `s${table.reduce((highest, set) => Math.max(highest, setNumber(set.id)), 0) + 1}`;

export const findTile = (board: Board, id: string): Tile | null => {
    const inRack = board.rack.find(tile => tile.id === id);
    if (inRack) return inRack;
    for (const set of board.table) {
        const onTable = set.tiles.find(tile => tile.id === id);
        if (onTable) return onTable;
    }
    return null;
};

export const setHolding = (table: readonly TableSet[], id: string): TableSet | null =>
    table.find(set => set.tiles.some(tile => tile.id === id)) ?? null;

/**
 * Lifts tiles out of the table. A hole in the middle of a good run breaks it in
 * two when both halves still stand on their own, because that is what anyone
 * taking a tile from there means to do; otherwise the set stays in one piece
 * and shows up red until it is mended.
 */
export const pullTiles = (table: readonly TableSet[], ids: ReadonlySet<string>): TableSet[] => {
    let nextNumber = table.reduce((highest, set) => Math.max(highest, setNumber(set.id)), 0) + 1;
    const out: TableSet[] = [];

    for (const set of table) {
        if (!set.tiles.some(tile => ids.has(tile.id))) {
            out.push(set);
            continue;
        }

        const pieces: Tile[][] = [];
        let piece: Tile[] = [];
        for (const tile of set.tiles) {
            if (ids.has(tile.id)) {
                if (piece.length > 0) pieces.push(piece);
                piece = [];
            } else {
                piece.push(tile);
            }
        }
        if (piece.length > 0) pieces.push(piece);
        if (pieces.length === 0) continue;

        const reading = readSet(set.tiles);
        const splits =
            pieces.length > 1 && reading.valid && reading.kind === 'run' && pieces.every(p => readSet(p).valid);
        if (splits) {
            pieces.forEach((p, i) => {
                out.push({ id: i === 0 ? set.id : `s${nextNumber++}`, tiles: arrangeSet(p) });
            });
        } else {
            out.push({ id: set.id, tiles: arrangeSet(pieces.flat()) });
        }
    }
    return out;
};

export type MoveTarget = { kind: 'set'; setId: string } | { kind: 'new' } | { kind: 'rack' };

/** Moves tiles to a set, a new set or the rack. Checks nothing: a set may be wrong mid-turn. */
export const moveTiles = (board: Board, ids: readonly string[], target: MoveTarget): Board => {
    const tiles = ids.map(id => findTile(board, id)).filter((tile): tile is Tile => tile !== null);
    if (tiles.length === 0) return board;
    const wanted = new Set(tiles.map(tile => tile.id));

    if (target.kind === 'set') {
        const set = board.table.find(candidate => candidate.id === target.setId);
        if (set && tiles.every(tile => set.tiles.some(held => held.id === tile.id))) return board;
    }

    const rack = board.rack.filter(tile => !wanted.has(tile.id));
    const table = pullTiles(board.table, wanted);

    if (target.kind === 'rack') return { table, rack: [...rack, ...tiles] };

    if (target.kind === 'set' && table.some(set => set.id === target.setId)) {
        return {
            rack,
            table: table.map(set =>
                set.id === target.setId ? { id: set.id, tiles: arrangeSet([...set.tiles, ...tiles]) } : set,
            ),
        };
    }

    return { rack, table: [...table, { id: freshSetId(table), tiles: arrangeSet(tiles) }] };
};

/* ------------------------------------------------------- taking a joker */

/** Would this tile do the joker's job? Any tile that leaves the set good is the tile it stands for. */
export const canReplaceJoker = (set: TableSet, jokerId: string, tile: Tile): boolean => {
    if (isJoker(tile)) return false;
    if (!set.tiles.some(held => held.id === jokerId && isJoker(held))) return false;
    if (set.tiles.some(held => held.id === tile.id)) return false;
    return readSet(set.tiles.map(held => (held.id === jokerId ? tile : held))).valid;
};

/**
 * Swaps a tile, from the rack or the table, for a joker in a set. The joker goes
 * to a set of its own on the table: alone it is not a valid set, so the turn
 * cannot end until it has been played, which is the rule.
 */
export const retrieveJoker = (board: Board, setId: string, jokerId: string, tileId: string): Board | null => {
    const set = board.table.find(candidate => candidate.id === setId);
    const tile = findTile(board, tileId);
    if (!set || !tile || !canReplaceJoker(set, jokerId, tile)) return null;

    const joker = set.tiles.find(held => held.id === jokerId) as Tile;
    const pulled = pullTiles(board.table, new Set([tileId]));
    const table = pulled.map(candidate =>
        candidate.id === setId
            ? { id: setId, tiles: arrangeSet(candidate.tiles.map(held => (held.id === jokerId ? tile : held))) }
            : candidate,
    );
    return {
        rack: board.rack.filter(held => held.id !== tileId),
        table: [...table, { id: freshSetId(table), tiles: [joker] }],
    };
};

/* -------------------------------------------------------- checking a turn */

export type TurnProblem =
    | { kind: 'table-tile-taken'; tileId: string }
    | { kind: 'invalid-set'; setId: string; fault: SetFault; size: number }
    | { kind: 'nothing-played' }
    | { kind: 'opening-touched' }
    | { kind: 'opening-short'; value: number };

export interface TurnCheck {
    problem: TurnProblem | null;
    played: Tile[];
    /** What the sets laid down this turn add up to. Only an opening cares. */
    laidValue: number;
}

const setKey = (tiles: readonly Tile[]): string =>
    tiles
        .map(tile => tile.id)
        .sort()
        .join(',');

/** Sets on the table now that were not there, tile for tile, when the turn began. */
const newSets = (start: readonly TableSet[], now: readonly TableSet[]): TableSet[] => {
    const before = new Map<string, number>();
    for (const set of start) {
        const key = setKey(set.tiles);
        before.set(key, (before.get(key) ?? 0) + 1);
    }
    return now.filter(set => {
        const key = setKey(set.tiles);
        const left = before.get(key) ?? 0;
        if (left === 0) return true;
        before.set(key, left - 1);
        return false;
    });
};

/** May the turn end here? The first thing wrong, if anything. */
export const checkTurn = (start: Board, now: Board, opened: boolean): TurnCheck => {
    const onTable = new Set(now.table.flatMap(set => set.tiles.map(tile => tile.id)));
    const played = start.rack.filter(tile => onTable.has(tile.id));
    const added = newSets(start.table, now.table);
    const laidValue = added.reduce((sum, set) => {
        const reading = readSet(set.tiles);
        return sum + (reading.valid ? reading.value : 0);
    }, 0);
    const result = (problem: TurnProblem | null): TurnCheck => ({ problem, played, laidValue });

    for (const set of start.table) {
        for (const tile of set.tiles) {
            if (!onTable.has(tile.id)) return result({ kind: 'table-tile-taken', tileId: tile.id });
        }
    }

    for (const set of now.table) {
        const reading = readSet(set.tiles);
        if (!reading.valid) {
            return result({ kind: 'invalid-set', setId: set.id, fault: reading.fault, size: set.tiles.length });
        }
    }

    if (played.length === 0) return result({ kind: 'nothing-played' });

    if (!opened) {
        // Every set that was there must still be there, and only rack tiles may be new.
        if (now.table.length - added.length !== start.table.length) return result({ kind: 'opening-touched' });
        if (laidValue < OPENING_POINTS) return result({ kind: 'opening-short', value: laidValue });
    }

    return result(null);
};

/** Has anything moved since the turn began? */
export const boardChanged = (start: Board, now: Board): boolean => {
    if (start.rack.length !== now.rack.length) return true;
    if (start.table.length !== now.table.length) return true;
    return newSets(start.table, now.table).length > 0;
};

/* ------------------------------------------------------------- a round */

export interface RoundResult {
    /** Null when a blocked round ends level. */
    winner: Player | null;
    how: 'out' | 'blocked';
    values: Record<Player, number>;
    counts: Record<Player, number>;
    /** What the winner scores and the loser loses: the sum of the loser's rack. */
    points: number;
}

export interface Round {
    readonly number: number;
    readonly seed: number;
    readonly racks: Record<Player, readonly Tile[]>;
    /** Face down; the next tile drawn is the first. */
    readonly pool: readonly Tile[];
    readonly table: readonly TableSet[];
    readonly opened: Record<Player, boolean>;
    readonly turn: Player;
    /** Passes in a row, once the pool is empty. */
    readonly passes: number;
    /** How the table and the current player's rack stood when this turn began. */
    readonly start: Board;
    readonly result: RoundResult | null;
}

export const otherPlayer = (player: Player): Player => (player === 'cookie' ? 'computer' : 'cookie');

export const dealRound = (seed: number, number = 1): Round => {
    const deck = shuffled(buildTiles(), mulberry32(seed));
    const cookie = deck.slice(0, START_TILES);
    const computer = deck.slice(START_TILES, START_TILES * 2);
    return {
        number,
        seed,
        racks: { cookie, computer },
        pool: deck.slice(START_TILES * 2),
        table: [],
        opened: { cookie: false, computer: false },
        turn: 'cookie',
        passes: 0,
        start: { table: [], rack: cookie },
        result: null,
    };
};

export const currentBoard = (round: Round): Board => ({ table: round.table, rack: round.racks[round.turn] });

export const withBoard = (round: Round, board: Board): Round => ({
    ...round,
    table: board.table,
    racks: { ...round.racks, [round.turn]: board.rack },
});

const handOver = (round: Round): Round => {
    const turn = otherPlayer(round.turn);
    return { ...round, turn, start: { table: round.table, rack: round.racks[turn] } };
};

export const rackValue = (rack: readonly Tile[]): number =>
    rack.reduce((sum, tile) => sum + (isJoker(tile) ? JOKER_RACK_VALUE : tile.number), 0);

export const finishRound = (round: Round, how: RoundResult['how']): Round => {
    const values = { cookie: rackValue(round.racks.cookie), computer: rackValue(round.racks.computer) };
    const counts = { cookie: round.racks.cookie.length, computer: round.racks.computer.length };

    let winner: Player | null;
    if (how === 'out') winner = counts.cookie === 0 ? 'cookie' : 'computer';
    else if (values.cookie === values.computer) winner = null;
    else winner = values.cookie < values.computer ? 'cookie' : 'computer';

    const points = winner ? values[otherPlayer(winner)] : 0;
    return { ...round, result: { winner, how, values, counts, points } };
};

/** What this round did to each player's total. */
export const roundScore = (result: RoundResult): Record<Player, number> => {
    if (!result.winner) return { cookie: 0, computer: 0 };
    return result.winner === 'cookie'
        ? { cookie: result.points, computer: -result.points }
        : { cookie: -result.points, computer: result.points };
};

const passTurn = (round: Round): Round => {
    const next = { ...round, passes: round.passes + 1 };
    return next.passes >= 2 ? finishRound(next, 'blocked') : handOver(next);
};

/** Ends the turn as the board stands, if the board allows it. */
export const commitTurn = (round: Round): { round: Round; problem: TurnProblem | null } => {
    const check = checkTurn(round.start, currentBoard(round), round.opened[round.turn]);
    if (check.problem) return { round, problem: check.problem };
    const next: Round = { ...round, opened: { ...round.opened, [round.turn]: true }, passes: 0 };
    if (next.racks[round.turn].length === 0) return { round: finishRound(next, 'out'), problem: null };
    return { round: handOver(next), problem: null };
};

/** Nothing played: draw one tile and the turn ends. With the pool empty, it is a pass. */
export const drawTurn = (round: Round): Round => {
    const [tile, ...pool] = round.pool;
    if (!tile) return passTurn(round);
    return handOver({
        ...round,
        pool,
        passes: 0,
        racks: { ...round.racks, [round.turn]: [...round.racks[round.turn], tile] },
    });
};

/** The turn could not be finished: everything goes back, and the player draws. */
export const failTurn = (round: Round): Round => {
    const reverted = withBoard(round, round.start);
    const drawn = reverted.pool.slice(0, FAILED_TURN_DRAW);
    if (drawn.length === 0) return passTurn(reverted);
    return handOver({
        ...reverted,
        pool: reverted.pool.slice(drawn.length),
        passes: 0,
        racks: { ...reverted.racks, [round.turn]: [...round.start.rack, ...drawn] },
    });
};

/** Every one of the 106 tiles, once each, somewhere: racks, table or pool. */
export const everyTileAccountedFor = (round: Round): boolean => {
    const seen = [
        ...round.racks.cookie,
        ...round.racks.computer,
        ...round.pool,
        ...round.table.flatMap(set => set.tiles),
    ].map(tile => tile.id);
    const all = buildTiles().map(tile => tile.id);
    return seen.length === all.length && new Set(seen).size === all.length && all.every(id => seen.includes(id));
};

/* -------------------------------------------------------------- the rack */

export type RackSort = 'color' | 'number';

const colorRank = (tile: Tile): number => (tile.color === null ? TILE_COLORS.length : TILE_COLORS.indexOf(tile.color));

/** Jokers always end up last, where they are easy to find. */
export const sortRack = (rack: readonly Tile[], mode: RackSort): Tile[] =>
    [...rack].sort((a, b) => {
        if (isJoker(a) !== isJoker(b)) return isJoker(a) ? 1 : -1;
        const first = mode === 'color' ? colorRank(a) - colorRank(b) : a.number - b.number;
        const second = mode === 'color' ? a.number - b.number : colorRank(a) - colorRank(b);
        return first || second || a.id.localeCompare(b.id);
    });

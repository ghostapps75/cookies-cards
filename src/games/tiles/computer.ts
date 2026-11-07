import {
    MAX_NUMBER,
    OPENING_POINTS,
    TILE_COLORS,
    arrangeSet,
    canReplaceJoker,
    freshSetId,
    isJoker,
    isTableValid,
    pullTiles,
    readSet,
    retrieveJoker,
    type Board,
    type TableSet,
    type Tile,
    type TileColor,
} from './rules';

/**
 * The computer's whole mind. It sees its own rack, the table and how many tiles
 * are left in the pool, and answers with the steps of its turn. Every step
 * leaves a valid table and a smaller rack, so a turn can stop anywhere and
 * always stops. No steps at all means it draws.
 */

export interface ComputerView extends Board {
    opened: boolean;
    poolCount: number;
}

export interface ComputerStep extends Board {
    /** Said on screen while this step lands. */
    say: string;
}

/** How long the search for sets in a rack may run. A count, not a clock, so games replay exactly. */
const NODE_BUDGET = 20000;
/** Below this many tiles a joker is worth more on the table than it could ever earn in the rack. */
const JOKER_DUMP_RACK = 3;

const byNumberThenColor = (a: Tile, b: Tile): number =>
    a.number - b.number || TILE_COLORS.indexOf(a.color as TileColor) - TILE_COLORS.indexOf(b.color as TileColor);

interface MeldSearch {
    /** Jokers may be used. */
    jokers: boolean;
    /** The sets must add up to at least this. */
    minValue?: number;
    /** A tile that has to end up in one of the sets. */
    mustHold?: string;
}

/**
 * The best sets that can be made out of these tiles: most real tiles played,
 * then the most points, then the fewest jokers spent. Null if none will do.
 */
export const findMelds = (tiles: readonly Tile[], search: MeldSearch): Tile[][] | null => {
    const reals = tiles.filter(tile => !isJoker(tile)).sort(byNumberThenColor);
    const startingJokers = search.jokers ? tiles.filter(isJoker) : [];
    const minValue = search.minValue ?? 0;
    const used = new Set<string>();
    const melds: Tile[][] = [];
    let best: Tile[][] | null = null;
    let bestScore = -Infinity;
    let nodes = 0;

    const nextOf = (color: TileColor | null, number: number, after: number): Tile | undefined => {
        for (let i = after + 1; i < reals.length; i++) {
            const tile = reals[i];
            if (tile.number === number && tile.color === color && !used.has(tile.id)) return tile;
        }
        return undefined;
    };

    const runsFrom = (index: number, jokers: readonly Tile[]): Tile[][] => {
        const first = reals[index];
        const runs: Tile[][] = [];
        const run = [first];
        const spare = [...jokers];
        let number = first.number + 1;
        while (number <= MAX_NUMBER) {
            const next = nextOf(first.color, number, index);
            if (next) run.push(next);
            else if (spare.length > 0) run.push(spare.shift() as Tile);
            else break;
            number++;
            if (run.length >= 3) runs.push([...run]);
        }
        // Too near the top to reach three going up: the jokers go underneath instead.
        if (run.length < 3 && number > MAX_NUMBER && spare.length >= 3 - run.length) {
            runs.push([...run, ...spare.slice(0, 3 - run.length)]);
        }
        return runs;
    };

    const groupsFrom = (index: number, jokers: readonly Tile[]): Tile[][] => {
        const first = reals[index];
        const others = TILE_COLORS.filter(color => color !== first.color)
            .map(color => nextOf(color, first.number, index))
            .filter((tile): tile is Tile => tile !== undefined);
        const groups: Tile[][] = [];
        for (let mask = 0; mask < 1 << others.length; mask++) {
            const chosen = others.filter((_, bit) => mask & (1 << bit));
            for (let count = 0; count <= jokers.length; count++) {
                const size = 1 + chosen.length + count;
                if (size >= 3 && size <= 4) groups.push([first, ...chosen, ...jokers.slice(0, count)]);
            }
        }
        return groups;
    };

    const visit = (from: number, jokers: readonly Tile[], realCount: number, value: number, spent: number): void => {
        if (melds.length > 0 && value >= minValue) {
            const holdsIt = !search.mustHold || melds.some(meld => meld.some(tile => tile.id === search.mustHold));
            const score = realCount * 1000 + value - spent * 20;
            if (holdsIt && score > bestScore) {
                best = melds.map(meld => [...meld]);
                bestScore = score;
            }
        }

        for (let i = from; i < reals.length; i++) {
            if (used.has(reals[i].id)) continue;
            for (const candidate of [...runsFrom(i, jokers), ...groupsFrom(i, jokers)]) {
                if (nodes++ >= NODE_BUDGET) return;
                const reading = readSet(candidate);
                if (!reading.valid) continue;

                const realsHere = candidate.filter(tile => !isJoker(tile));
                const jokersHere = candidate.length - realsHere.length;
                realsHere.forEach(tile => used.add(tile.id));
                melds.push(reading.order);
                visit(
                    i + 1,
                    jokers.filter(joker => !candidate.includes(joker)),
                    realCount + realsHere.length,
                    value + reading.value,
                    spent + jokersHere,
                );
                melds.pop();
                realsHere.forEach(tile => used.delete(tile.id));
            }
        }
    };

    visit(0, startingJokers, 0, 0, 0);
    return best;
};

/* ---------------------------------------------------------- single moves */

const withoutTiles = (rack: readonly Tile[], gone: readonly Tile[]): Tile[] =>
    rack.filter(tile => !gone.some(other => other.id === tile.id));

const layMeld = (board: Board, meld: readonly Tile[]): Board => ({
    table: [...board.table, { id: freshSetId(board.table), tiles: arrangeSet(meld) }],
    rack: withoutTiles(board.rack, meld),
});

const addToSet = (table: readonly TableSet[], setId: string, tile: Tile): TableSet[] =>
    table.map(set => (set.id === setId ? { id: set.id, tiles: arrangeSet([...set.tiles, tile]) } : set));

/** Plays the first set found by the search, one step per set. */
const meldMove = (board: Board, jokers: boolean): ComputerStep | null => {
    const melds = findMelds(board.rack, { jokers });
    if (!melds) return null;
    return { ...layMeld(board, melds[0]), say: 'Computer played a new set' };
};

/** A tile from the rack on the end of a run, or as the missing colour of a group. */
const extendMove = (board: Board): ComputerStep | null => {
    // High tiles first: they cost the most if the round ends with them still held.
    const tiles = board.rack.filter(tile => !isJoker(tile)).sort((a, b) => b.number - a.number);
    for (const tile of tiles) {
        for (const set of board.table) {
            if (readSet([...set.tiles, tile]).valid) {
                return {
                    table: addToSet(board.table, set.id, tile),
                    rack: withoutTiles(board.rack, [tile]),
                    say: 'Computer added to a set',
                };
            }
        }
    }
    return null;
};

/** Table tiles that can be spared: ends of long runs, any tile of a full group, the middle of a very long run. */
export const spareTiles = (table: readonly TableSet[]): Tile[] => {
    const spare: Tile[] = [];
    for (const set of table) {
        const reading = readSet(set.tiles);
        if (!reading.valid) continue;
        const { order } = reading;
        if (reading.kind === 'group') {
            if (order.length === 4) spare.push(...order);
        } else {
            order.forEach((tile, i) => {
                const end = i === 0 || i === order.length - 1;
                const middle = i >= 3 && order.length - i - 1 >= 3;
                if ((end && order.length >= 4) || middle) spare.push(tile);
            });
        }
    }
    return spare.filter(tile => !isJoker(tile));
};

/** Completes a set of its own by borrowing one or two spare tiles from the table. */
const borrowMove = (board: Board): ComputerStep | null => {
    const spare = spareTiles(board.table);

    const attempt = (fromRack: readonly Tile[], borrowed: readonly Tile[]): ComputerStep | null => {
        const tiles = [...fromRack, ...borrowed];
        if (!readSet(tiles).valid) return null;
        const pulled = pullTiles(board.table, new Set(borrowed.map(tile => tile.id)));
        if (!isTableValid(pulled)) return null;
        return {
            table: [...pulled, { id: freshSetId(pulled), tiles: arrangeSet(tiles) }],
            rack: withoutTiles(board.rack, fromRack),
            say: 'Computer borrowed from the table to make a set',
        };
    };

    let best: ComputerStep | null = null;
    let bestPlayed = 0;
    const consider = (fromRack: readonly Tile[], borrowed: readonly Tile[]): void => {
        if (fromRack.length <= bestPlayed) return;
        const step = attempt(fromRack, borrowed);
        if (step) {
            best = step;
            bestPlayed = fromRack.length;
        }
    };

    const reals = board.rack.filter(tile => !isJoker(tile));
    for (const tile of reals) {
        // Groups: this tile, any others of its number from the rack, then borrowed colours.
        const sameNumber = reals.filter(other => other.number === tile.number && other.color !== tile.color);
        const partners = TILE_COLORS.map(color => sameNumber.find(other => other.color === color)).filter(
            (other): other is Tile => other !== undefined,
        );
        const groupRack = [tile, ...partners];
        const groupSpare = spare.filter(
            other => other.number === tile.number && !groupRack.some(held => held.color === other.color),
        );
        for (const a of groupSpare) {
            consider(groupRack, [a]);
            for (const b of groupSpare) {
                if (a.id < b.id && a.color !== b.color) consider(groupRack, [a, b]);
            }
        }

        // Runs: every window of three numbers this tile could sit in.
        for (let low = Math.max(1, tile.number - 2); low <= Math.min(tile.number, MAX_NUMBER - 2); low++) {
            const fromRack: Tile[] = [];
            const borrowed: Tile[] = [];
            let possible = true;
            for (let number = low; number < low + 3 && possible; number++) {
                const held = reals.find(other => other.color === tile.color && other.number === number);
                const lent = spare.find(other => other.color === tile.color && other.number === number);
                if (held) fromRack.push(held);
                else if (lent) borrowed.push(lent);
                else possible = false;
            }
            if (possible && borrowed.length > 0) consider(fromRack, borrowed);
        }
    }
    return best;
};

/** Slides a rack tile into a long run by breaking it in two at that number. */
const splitMove = (board: Board): ComputerStep | null => {
    for (const set of board.table) {
        const reading = readSet(set.tiles);
        if (!reading.valid || reading.kind !== 'run' || reading.order.length < 5) continue;
        for (const tile of board.rack) {
            if (tile.color !== reading.order.find(held => !isJoker(held))?.color) continue;
            const at = reading.order.findIndex(held => held.number === tile.number);
            if (at < 0) continue;
            const left = [...reading.order.slice(0, at), tile];
            const right = reading.order.slice(at);
            if (!readSet(left).valid || !readSet(right).valid) continue;
            const others = board.table.filter(other => other.id !== set.id);
            const first = { id: set.id, tiles: arrangeSet(left) };
            const withFirst = [...others, first];
            return {
                table: [...withFirst, { id: freshSetId(withFirst), tiles: arrangeSet(right) }],
                rack: withoutTiles(board.rack, [tile]),
                say: 'Computer split a run to fit a tile in',
            };
        }
    }
    return null;
};

/**
 * Trades a tile for a joker on the table, and only if the joker can then be
 * played straight away: in a new set with tiles from the rack, or, unless
 * `meldOnly`, on the end of something already there.
 */
const jokerMove = (board: Board, meldOnly: boolean): ComputerStep | null => {
    for (const set of board.table) {
        for (const joker of set.tiles.filter(isJoker)) {
            for (const tile of board.rack) {
                if (!canReplaceJoker(set, joker.id, tile)) continue;
                const swapped = retrieveJoker(board, set.id, joker.id, tile.id);
                if (!swapped) continue;

                // The joker sits alone at the end of the swapped table. Take it back up to place it.
                const table = swapped.table.filter(other => !other.tiles.some(held => held.id === joker.id));
                const rack = [...swapped.rack, joker];

                const melds = findMelds(rack, { jokers: true, mustHold: joker.id });
                const meld = melds?.find(found => found.some(held => held.id === joker.id));
                if (meld) {
                    return { ...layMeld({ table, rack }, meld), say: 'Computer swapped a tile for a joker' };
                }

                const home = meldOnly ? null : table.find(other => readSet([...other.tiles, joker]).valid);
                if (home) {
                    return {
                        table: addToSet(table, home.id, joker),
                        rack: withoutTiles(rack, [joker]),
                        say: 'Computer swapped a tile for a joker',
                    };
                }
            }
        }
    }
    return null;
};

/** Near the end a joker in the rack is a thirty-point risk: put it on anything that will take it. */
const dumpJokerMove = (board: Board, poolCount: number): ComputerStep | null => {
    if (board.rack.length > JOKER_DUMP_RACK && poolCount > 0) return null;
    const joker = board.rack.find(isJoker);
    if (!joker) return null;
    const home = board.table.find(set => readSet([...set.tiles, joker]).valid);
    if (!home) return null;
    return {
        table: addToSet(board.table, home.id, joker),
        rack: withoutTiles(board.rack, [joker]),
        say: 'Computer added a joker to a set',
    };
};

/* --------------------------------------------------------------- a turn */

const planOpening = (view: ComputerView): ComputerStep[] => {
    const melds = findMelds(view.rack, { jokers: true, minValue: OPENING_POINTS });
    if (!melds) return [];

    const total = melds.reduce((sum, meld) => {
        const reading = readSet(meld);
        return sum + (reading.valid ? reading.value : 0);
    }, 0);

    const steps: ComputerStep[] = [];
    let board: Board = { table: view.table, rack: view.rack };
    melds.forEach((meld, i) => {
        board = layMeld(board, meld);
        steps.push({
            ...board,
            say: i === melds.length - 1 ? `Computer opened with ${total} points` : 'Computer is opening',
        });
    });
    return steps;
};

const planAfterOpening = (view: ComputerView): ComputerStep[] => {
    const steps: ComputerStep[] = [];
    let board: Board = { table: view.table, rack: view.rack };

    while (board.rack.length > 0) {
        // A joker that unlocks a whole new set comes before plain additions,
        // which would otherwise use up the very tile that could have freed it.
        const step =
            meldMove(board, false) ??
            jokerMove(board, true) ??
            extendMove(board) ??
            meldMove(board, true) ??
            borrowMove(board) ??
            splitMove(board) ??
            jokerMove(board, false) ??
            dumpJokerMove(board, view.poolCount);

        // Each move must shrink the rack and leave the table sound, or it is not made.
        if (!step || step.rack.length >= board.rack.length || !isTableValid(step.table)) break;
        steps.push(step);
        board = step;
    }
    return steps;
};

export const planComputerTurn = (view: ComputerView): ComputerStep[] =>
    view.opened ? planAfterOpening(view) : planOpening(view);

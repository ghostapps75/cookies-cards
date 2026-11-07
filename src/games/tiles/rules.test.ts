import { describe, expect, it } from 'vitest';
import {
    FAILED_TURN_DRAW,
    JOKER_RACK_VALUE,
    OPENING_POINTS,
    START_TILES,
    arrangeSet,
    buildTiles,
    canReplaceJoker,
    checkTurn,
    commitTurn,
    dealRound,
    drawTurn,
    everyTileAccountedFor,
    failTurn,
    firstInvalidSet,
    isTableValid,
    moveTiles,
    pullTiles,
    rackValue,
    readSet,
    retrieveJoker,
    roundScore,
    sortRack,
    withBoard,
    type Round,
    type TableSet,
    type Tile,
    type TileColor,
} from './rules';

const t = (color: TileColor, number: number, copy = 0): Tile => ({ id: `${color}_${number}_${copy}`, color, number });
const J: Tile = { id: 'joker_0', color: null, number: 0 };
const J2: Tile = { id: 'joker_1', color: null, number: 0 };
const set = (id: string, ...tiles: Tile[]): TableSet => ({ id, tiles });

const valid = (tiles: Tile[]) => readSet(tiles).valid;
const fault = (tiles: Tile[]) => {
    const reading = readSet(tiles);
    return reading.valid ? null : reading.fault;
};

describe('the tiles', () => {
    it('makes 106 tiles: 13 numbers in four colours, twice, and two jokers', () => {
        const tiles = buildTiles();
        expect(tiles).toHaveLength(106);
        expect(new Set(tiles.map(tile => tile.id)).size).toBe(106);
        expect(tiles.filter(tile => tile.color === null)).toHaveLength(2);
        expect(tiles.filter(tile => tile.color === 'red' && tile.number === 7)).toHaveLength(2);
    });

    it('deals 14 to each player and the same deal from the same seed', () => {
        const round = dealRound(42);
        expect(round.racks.cookie).toHaveLength(START_TILES);
        expect(round.racks.computer).toHaveLength(START_TILES);
        expect(round.pool).toHaveLength(106 - 2 * START_TILES);
        expect(round.turn).toBe('cookie');
        expect(everyTileAccountedFor(round)).toBe(true);
        expect(dealRound(42)).toEqual(round);
        expect(dealRound(43).racks.cookie).not.toEqual(round.racks.cookie);
    });
});

describe('groups', () => {
    it('takes three or four of a number in different colours', () => {
        expect(valid([t('red', 5), t('blue', 5), t('black', 5)])).toBe(true);
        expect(valid([t('red', 5), t('blue', 5), t('black', 5), t('orange', 5)])).toBe(true);
    });

    it('refuses a repeated colour, a fifth tile, a mix and fewer than three', () => {
        expect(fault([t('red', 5), t('red', 5, 1), t('blue', 5)])).toBe('repeat');
        expect(fault([t('red', 5), t('blue', 5), t('black', 5), t('orange', 5), J])).toBe('long');
        expect(fault([t('red', 5), t('blue', 6), t('black', 7)])).toBe('mixed');
        expect(fault([t('red', 5), t('blue', 5)])).toBe('short');
        expect(fault([t('red', 5)])).toBe('short');
    });

    it('lets a joker stand for a missing colour', () => {
        const reading = readSet([t('red', 5), t('blue', 5), J]);
        expect(reading.valid && reading.kind).toBe('group');
        expect(reading.valid && reading.value).toBe(15);
        expect(reading.valid && reading.roles[J.id]).toEqual({ number: 5, colors: ['black', 'orange'] });
    });

    it('keeps the order a group was built in', () => {
        expect(arrangeSet([t('red', 5), t('black', 5), t('blue', 5)]).map(tile => tile.color)).toEqual([
            'red',
            'black',
            'blue',
        ]);
    });
});

describe('runs', () => {
    it('takes three or more consecutive numbers of one colour, in any order they arrive', () => {
        expect(valid([t('red', 3), t('red', 4), t('red', 5)])).toBe(true);
        expect(valid([t('red', 5), t('red', 3), t('red', 4)])).toBe(true);
        expect(arrangeSet([t('red', 5), t('red', 3), t('red', 4)]).map(tile => tile.number)).toEqual([3, 4, 5]);
    });

    it('runs from 1 up and from 13 down, but never round the corner', () => {
        expect(valid([t('blue', 1), t('blue', 2), t('blue', 3)])).toBe(true);
        expect(valid([t('blue', 11), t('blue', 12), t('blue', 13)])).toBe(true);
        expect(fault([t('blue', 12), t('blue', 13), t('blue', 1)])).toBe('gap');
    });

    it('takes all thirteen and no more', () => {
        const all = Array.from({ length: 13 }, (_, i) => t('orange', i + 1));
        expect(valid(all)).toBe(true);
        expect(fault([...all, J])).toBe('long');
    });

    it('refuses a gap, a repeat and a second colour', () => {
        expect(fault([t('red', 3), t('red', 5), t('red', 6)])).toBe('gap');
        expect(fault([t('red', 3), t('red', 3, 1), t('red', 4)])).toBe('repeat');
        expect(fault([t('red', 3), t('red', 4), t('blue', 5)])).toBe('mixed');
    });

    it('fills a hole with a joker', () => {
        const reading = readSet([t('red', 3), J, t('red', 5)]);
        expect(reading.valid && reading.kind).toBe('run');
        expect(reading.valid && reading.value).toBe(12);
        expect(reading.valid && reading.roles[J.id]).toEqual({ number: 4, colors: ['red'] });
        expect(reading.order.map(tile => tile.id)).toEqual(['red_3_0', 'joker_0', 'red_5_0']);
    });

    it('puts a spare joker on the high end, which is worth more', () => {
        const reading = readSet([t('red', 5), t('red', 6), J]);
        expect(reading.valid && reading.roles[J.id].number).toBe(7);
        expect(reading.valid && reading.value).toBe(18);
    });

    it('puts a joker underneath a run that already reaches 13', () => {
        const reading = readSet([t('red', 12), t('red', 13), J]);
        expect(reading.valid && reading.roles[J.id].number).toBe(11);
        expect(reading.order[0].id).toBe(J.id);
        expect(reading.valid && reading.value).toBe(36);
    });

    it('stretches a joker above a run that starts at 1', () => {
        const reading = readSet([t('red', 1), t('red', 2), J]);
        expect(reading.valid && reading.roles[J.id].number).toBe(3);
    });

    it('reads two jokers and one tile as whichever is worth more', () => {
        const low = readSet([t('red', 1), J, J2]);
        expect(low.valid && low.kind).toBe('run');
        expect(low.valid && low.value).toBe(6);

        const high = readSet([t('red', 13), J, J2]);
        expect(high.valid && high.kind).toBe('group');
        expect(high.valid && high.value).toBe(39);
    });

    it('never counts jokers alone as a set', () => {
        expect(fault([J])).toBe('short');
        expect(fault([J, J2])).toBe('short');
        expect(fault([t('red', 1), J])).toBe('short');
    });
});

describe('the whole table', () => {
    it('is valid only when every set is', () => {
        const good = set('s1', t('red', 3), t('red', 4), t('red', 5));
        const bad = set('s2', t('blue', 3), t('blue', 4));
        expect(isTableValid([])).toBe(true);
        expect(isTableValid([good])).toBe(true);
        expect(isTableValid([good, bad])).toBe(false);
        expect(firstInvalidSet([good, bad])?.id).toBe('s2');
    });
});

describe('the opening rule', () => {
    const empty = { table: [], rack: [] };
    const rack = [t('red', 10), t('red', 11), t('red', 12), t('blue', 2), t('black', 2), t('orange', 2)];

    it('accepts 30 or more points from the rack', () => {
        const now = moveTiles({ table: [], rack }, ['red_10_0', 'red_11_0', 'red_12_0'], { kind: 'new' });
        const check = checkTurn({ table: [], rack }, now, false);
        expect(check.problem).toBeNull();
        expect(check.laidValue).toBe(33);
    });

    it('refuses fewer than 30 points, and says how many it found', () => {
        const now = moveTiles({ table: [], rack }, ['blue_2_0', 'black_2_0', 'orange_2_0'], { kind: 'new' });
        const check = checkTurn({ table: [], rack }, now, false);
        expect(check.problem).toEqual({ kind: 'opening-short', value: 6 });
    });

    it('adds several sets together to reach 30', () => {
        const low = [t('blue', 9), t('black', 9), t('orange', 9), t('red', 1), t('red', 2), t('red', 3)];
        let now = moveTiles({ table: [], rack: low }, ['blue_9_0', 'black_9_0', 'orange_9_0'], { kind: 'new' });
        expect(checkTurn({ table: [], rack: low }, now, false).problem).toEqual({ kind: 'opening-short', value: 27 });
        now = moveTiles(now, ['red_1_0', 'red_2_0', 'red_3_0'], { kind: 'new' });
        expect(checkTurn({ table: [], rack: low }, now, false).problem).toBeNull();
    });

    it('counts a joker as the tile it stands for', () => {
        const withJoker = [t('red', 10), t('red', 11), J];
        const now = moveTiles({ table: [], rack: withJoker }, ['red_10_0', 'red_11_0', J.id], { kind: 'new' });
        const check = checkTurn({ table: [], rack: withJoker }, now, false);
        expect(check.problem).toBeNull();
        expect(check.laidValue).toBe(33);
    });

    it('refuses an opening that borrows from the table or adds to it', () => {
        const existing = set('s1', t('blue', 10), t('blue', 11), t('blue', 12), t('blue', 13));
        const hand = [t('blue', 7), t('blue', 8), t('blue', 9), t('red', 10), t('red', 11), t('red', 12), t('blue', 9, 1)];
        const start = { table: [existing], rack: hand };

        const borrowed = moveTiles(start, ['blue_7_0', 'blue_8_0', 'blue_9_0', 'blue_10_0'], { kind: 'new' });
        expect(isTableValid(borrowed.table)).toBe(true);
        expect(checkTurn(start, borrowed, false).problem?.kind).toBe('opening-touched');

        const clean = moveTiles(start, ['red_10_0', 'red_11_0', 'red_12_0'], { kind: 'new' });
        expect(checkTurn(start, clean, false).problem).toBeNull();
    });

    it('refuses a valid addition to the table as an opening, even with points to spare', () => {
        const existing = set('s1', t('blue', 7), t('blue', 8), t('blue', 9));
        const hand = [t('blue', 10), t('red', 10), t('red', 11), t('red', 12)];
        const start = { table: [existing], rack: hand };
        const now = moveTiles(moveTiles(start, ['red_10_0', 'red_11_0', 'red_12_0'], { kind: 'new' }), ['blue_10_0'], {
            kind: 'set',
            setId: 's1',
        });
        expect(isTableValid(now.table)).toBe(true);
        expect(checkTurn(start, now, false).problem?.kind).toBe('opening-touched');
    });

    it('needs something played at all', () => {
        expect(checkTurn(empty, empty, false).problem?.kind).toBe('nothing-played');
    });
});

describe('after opening', () => {
    const run = set('s1', t('red', 3), t('red', 4), t('red', 5), t('red', 6));

    it('needs at least one tile from the rack', () => {
        const rack = [t('blue', 3), t('black', 3), t('orange', 9)];
        const start = { table: [run], rack };
        expect(checkTurn(start, start, true).problem).toEqual({ kind: 'nothing-played' });

        // Rearranging alone is not enough either.
        const shuffled = moveTiles(start, ['red_6_0'], { kind: 'new' });
        const back = moveTiles(shuffled, ['red_6_0'], { kind: 'set', setId: 's1' });
        expect(checkTurn(start, back, true).problem).toEqual({ kind: 'nothing-played' });

        const played = moveTiles(start, ['red_3_0', 'blue_3_0', 'black_3_0'], { kind: 'new' });
        expect(checkTurn(start, played, true).problem).toBeNull();
    });

    it('needs every set valid when the turn ends', () => {
        const rack = [t('blue', 3)];
        const start = { table: [run], rack };
        const now = moveTiles(start, ['blue_3_0'], { kind: 'new' });
        const { problem } = checkTurn(start, now, true);
        expect(problem).toMatchObject({ kind: 'invalid-set', fault: 'short', size: 1 });
    });

    it('never lets a table tile go back to the rack', () => {
        const start = { table: [run], rack: [t('blue', 3)] };
        const now = moveTiles(start, ['red_6_0'], { kind: 'rack' });
        expect(checkTurn(start, now, true).problem).toEqual({ kind: 'table-tile-taken', tileId: 'red_6_0' });
    });

    it('sorts a tile into a run and appends one to a group', () => {
        const start = { table: [run], rack: [t('red', 7)] };
        const now = moveTiles(start, ['red_7_0'], { kind: 'set', setId: 's1' });
        expect(now.table[0].tiles.map(tile => tile.number)).toEqual([3, 4, 5, 6, 7]);

        const low = moveTiles({ table: [run], rack: [t('red', 2)] }, ['red_2_0'], { kind: 'set', setId: 's1' });
        expect(low.table[0].tiles.map(tile => tile.number)).toEqual([2, 3, 4, 5, 6]);

        const group = set('s2', t('red', 8), t('blue', 8), t('black', 8));
        const grown = moveTiles({ table: [group], rack: [t('orange', 8)] }, ['orange_8_0'], {
            kind: 'set',
            setId: 's2',
        });
        expect(grown.table[0].tiles[3].color).toBe('orange');
    });

    it('breaks a long run in two when a tile is taken from its middle and both halves stand', () => {
        const long = set('s1', ...[2, 3, 4, 5, 6, 7, 8].map(number => t('red', number)));
        const pulled = pullTiles([long], new Set(['red_5_0']));
        expect(pulled).toHaveLength(2);
        expect(pulled[0].tiles.map(tile => tile.number)).toEqual([2, 3, 4]);
        expect(pulled[1].tiles.map(tile => tile.number)).toEqual([6, 7, 8]);
        expect(isTableValid(pulled)).toBe(true);
    });

    it('leaves a set in one piece, marked wrong, when a half would not stand', () => {
        const pulled = pullTiles([run], new Set(['red_4_0']));
        expect(pulled).toHaveLength(1);
        expect(readSet(pulled[0].tiles).valid).toBe(false);
    });

    it('lets several tiles move together and removes a set left empty', () => {
        const small = set('s1', t('red', 3), t('red', 4), t('red', 5));
        const other = set('s2', t('red', 6), t('red', 7), t('red', 8));
        const joined = moveTiles({ table: [small, other], rack: [] }, ['red_3_0', 'red_4_0', 'red_5_0'], {
            kind: 'set',
            setId: 's2',
        });
        expect(joined.table).toHaveLength(1);
        expect(joined.table[0].tiles.map(tile => tile.number)).toEqual([3, 4, 5, 6, 7, 8]);
    });
});

describe('taking a joker', () => {
    const run = set('s1', t('red', 3), J, t('red', 5));

    it('takes the tile it stands for and refuses others', () => {
        expect(canReplaceJoker(run, J.id, t('red', 4))).toBe(true);
        expect(canReplaceJoker(run, J.id, t('red', 6))).toBe(false);
        expect(canReplaceJoker(run, J.id, t('blue', 4))).toBe(false);
        expect(canReplaceJoker(run, J.id, J2)).toBe(false);
    });

    it('in a group takes either missing colour', () => {
        const group = set('s1', t('red', 9), t('blue', 9), J);
        expect(canReplaceJoker(group, J.id, t('black', 9))).toBe(true);
        expect(canReplaceJoker(group, J.id, t('orange', 9))).toBe(true);
        expect(canReplaceJoker(group, J.id, t('red', 9, 1))).toBe(false);
        expect(canReplaceJoker(group, J.id, t('black', 8))).toBe(false);
    });

    it('swaps in a rack tile and leaves the joker alone on the table, which blocks the turn', () => {
        const start = { table: [run], rack: [t('red', 4), t('blue', 1), t('blue', 2)] };
        const swapped = retrieveJoker(start, 's1', J.id, 'red_4_0');
        expect(swapped).not.toBeNull();
        if (!swapped) return;
        expect(swapped.rack.map(tile => tile.id)).toEqual(['blue_1_0', 'blue_2_0']);
        expect(swapped.table[0].tiles.map(tile => tile.id)).toEqual(['red_3_0', 'red_4_0', 'red_5_0']);
        expect(swapped.table[1].tiles).toEqual([J]);
        expect(checkTurn(start, swapped, true).problem).toMatchObject({ kind: 'invalid-set', fault: 'short' });

        // Playing the joker on the two blues finishes the job.
        const done = moveTiles(swapped, ['blue_1_0', 'blue_2_0'], { kind: 'set', setId: swapped.table[1].id });
        expect(done.table[1].tiles).toHaveLength(3);
        expect(checkTurn(start, done, true).problem).toBeNull();
    });

    it('can swap in a tile from the table', () => {
        const long = set('s2', t('red', 4), t('red', 5, 1), t('red', 6), t('red', 7));
        const start = { table: [run, long], rack: [t('blue', 1), t('blue', 2)] };
        const swapped = retrieveJoker(start, 's1', J.id, 'red_4_0');
        expect(swapped?.table[0].tiles.map(tile => tile.id)).toEqual(['red_3_0', 'red_4_0', 'red_5_0']);
        expect(swapped?.table[1].tiles.map(tile => tile.number)).toEqual([5, 6, 7]);
    });

    it('refuses the wrong tile', () => {
        expect(retrieveJoker({ table: [run], rack: [t('red', 9)] }, 's1', J.id, 'red_9_0')).toBeNull();
    });

    it('cannot hide a retrieved joker back in the rack', () => {
        const start = { table: [run], rack: [t('red', 4), t('blue', 1)] };
        const swapped = retrieveJoker(start, 's1', J.id, 'red_4_0');
        if (!swapped) throw new Error('expected a swap');
        const hidden = moveTiles(swapped, [J.id], { kind: 'rack' });
        expect(checkTurn(start, hidden, true).problem).toEqual({ kind: 'table-tile-taken', tileId: J.id });
    });
});

/** A round in which Cookie has opened, with a known table and racks. */
const midRound = (changes: Partial<Round> = {}): Round => {
    const round = dealRound(7);
    const table = [set('s1', t('red', 3), t('red', 4), t('red', 5))];
    const cookie = [t('red', 6), t('blue', 9), J];
    return {
        ...round,
        opened: { cookie: true, computer: true },
        table,
        racks: { cookie, computer: [t('black', 2), t('black', 3)] },
        pool: [t('orange', 1), t('orange', 2), t('orange', 3)],
        start: { table, rack: cookie },
        ...changes,
    };
};

describe('ending a turn', () => {
    it('draws one tile for a turn with nothing played and hands over', () => {
        const round = midRound();
        const next = drawTurn(round);
        expect(next.racks.cookie).toHaveLength(4);
        expect(next.racks.cookie[3].id).toBe('orange_1_0');
        expect(next.pool).toHaveLength(2);
        expect(next.turn).toBe('computer');
        expect(next.start.rack).toEqual(next.racks.computer);
    });

    it('takes the table back and draws the penalty on a failed turn', () => {
        expect(FAILED_TURN_DRAW).toBe(1);
        const round = midRound();
        const board = moveTiles({ table: round.table, rack: round.racks.cookie }, ['blue_9_0'], { kind: 'new' });
        const messy = withBoard(round, board);
        expect(commitTurn(messy).problem?.kind).toBe('invalid-set');

        const after = failTurn(messy);
        expect(after.table).toEqual(round.table);
        expect(after.racks.cookie).toHaveLength(round.racks.cookie.length + FAILED_TURN_DRAW);
        expect(after.racks.cookie.map(tile => tile.id)).toContain('blue_9_0');
        expect(after.pool).toHaveLength(round.pool.length - FAILED_TURN_DRAW);
        expect(after.turn).toBe('computer');
    });

    it('commits a good turn, marks the player opened and hands over', () => {
        const round = midRound({ opened: { cookie: false, computer: true } });
        const rack = [t('red', 10), t('red', 11), t('red', 12), t('blue', 1)];
        const opening = withBoard({ ...round, start: { table: round.table, rack } }, {
            table: [...round.table, set('s2', t('red', 10), t('red', 11), t('red', 12))],
            rack: [t('blue', 1)],
        });
        const { round: next, problem } = commitTurn(opening);
        expect(problem).toBeNull();
        expect(next.opened.cookie).toBe(true);
        expect(next.turn).toBe('computer');
    });

    it('passes when the pool is empty, and ends the round after two passes in a row', () => {
        const round = midRound({ pool: [] });
        const once = drawTurn(round);
        expect(once.result).toBeNull();
        expect(once.passes).toBe(1);
        expect(once.turn).toBe('computer');

        const twice = drawTurn(once);
        expect(twice.result?.how).toBe('blocked');
        expect(twice.result?.winner).toBe('computer');
    });

    it('resets the passes when somebody plays', () => {
        const round = midRound({ pool: [], passes: 1 });
        const board = moveTiles({ table: round.table, rack: round.racks.cookie }, ['red_6_0'], {
            kind: 'set',
            setId: 's1',
        });
        const { round: next } = commitTurn(withBoard(round, board));
        expect(next.passes).toBe(0);
    });
});

describe('scoring', () => {
    it('counts a joker left on a rack as 30', () => {
        expect(JOKER_RACK_VALUE).toBe(30);
        expect(rackValue([t('red', 6), t('blue', 9), J])).toBe(45);
        expect(rackValue([])).toBe(0);
    });

    it('gives the winner the sum of the other rack and the loser the same as a negative', () => {
        const table = [set('s1', t('red', 3), t('red', 4), t('red', 5))];
        const cookie = [t('red', 6)];
        const round = midRound({ table, racks: { cookie, computer: [t('blue', 9), J] }, start: { table, rack: cookie } });
        const out = withBoard(round, moveTiles({ table, rack: cookie }, ['red_6_0'], { kind: 'set', setId: 's1' }));
        const { round: finished } = commitTurn(out);
        expect(finished.result).toMatchObject({ winner: 'cookie', how: 'out', points: 39 });
        expect(finished.result?.counts).toEqual({ cookie: 0, computer: 2 });
        expect(roundScore(finished.result!)).toEqual({ cookie: 39, computer: -39 });
    });

    it('in a blocked round gives it to the lower rack, and to nobody on a tie', () => {
        const lower = midRound({
            pool: [],
            passes: 1,
            racks: { cookie: [t('red', 2)], computer: [t('red', 9)] },
        });
        const won = drawTurn(lower).result;
        expect(won).toMatchObject({ winner: 'cookie', how: 'blocked', points: 9 });
        expect(roundScore(won!)).toEqual({ cookie: 9, computer: -9 });

        const level = midRound({
            pool: [],
            passes: 1,
            racks: { cookie: [t('red', 9)], computer: [t('blue', 9)] },
        });
        const tied = drawTurn(level).result;
        expect(tied?.winner).toBeNull();
        expect(roundScore(tied!)).toEqual({ cookie: 0, computer: 0 });
    });
});

describe('the rack', () => {
    const rack = [J, t('red', 2), t('black', 9), t('red', 1), t('black', 1)];

    it('sorts by colour with jokers last', () => {
        expect(sortRack(rack, 'color').map(tile => tile.id)).toEqual([
            'black_1_0',
            'black_9_0',
            'red_1_0',
            'red_2_0',
            'joker_0',
        ]);
    });

    it('sorts by number with jokers last', () => {
        expect(sortRack(rack, 'number').map(tile => tile.id)).toEqual([
            'black_1_0',
            'red_1_0',
            'red_2_0',
            'black_9_0',
            'joker_0',
        ]);
    });
});

describe('the opening number', () => {
    it('is 30', () => {
        expect(OPENING_POINTS).toBe(30);
    });
});

import { describe, expect, it } from 'vitest';
import { fitTable, fitsAt } from './fit';
import { dealRound, moveTiles, withBoard, type Round, type TableSet, type Tile, type TileColor } from './rules';
import { canSwapForJoker, cookieStatus } from './status';

const t = (color: TileColor, number: number, copy = 0): Tile => ({ id: `${color}_${number}_${copy}`, color, number });
const J: Tile = { id: 'joker_0', color: null, number: 0 };
const set = (id: string, ...tiles: Tile[]): TableSet => ({ id, tiles });

const position = (table: TableSet[], rack: Tile[], opened: boolean, poolEmpty = false): Round => ({
    ...dealRound(1),
    table,
    racks: { cookie: rack, computer: [] },
    pool: poolEmpty ? [] : [t('red', 1)],
    opened: { cookie: opened, computer: true },
    start: { table, rack },
});

describe('the line that says what to do', () => {
    it('asks for 30 points before opening', () => {
        expect(cookieStatus(position([], [t('red', 1)], false), [])).toContain(
            'Put down 30 points from your rack to open',
        );
    });

    it('offers everything after opening', () => {
        expect(cookieStatus(position([], [t('red', 1)], true), [])).toBe(
            'Play from your rack, rearrange the table, or draw',
        );
    });

    it('says pass when the pool is empty', () => {
        expect(cookieStatus(position([], [t('red', 1)], true, true), [])).toBe(
            'Play from your rack, rearrange the table, or pass',
        );
    });

    it('explains a red set in words', () => {
        const round = position([], [t('red', 1), t('red', 2), t('blue', 9)], true);
        const two = withBoard(round, moveTiles({ table: [], rack: round.racks.cookie }, ['red_1_0', 'red_2_0'], { kind: 'new' }));
        expect(cookieStatus(two, [])).toBe('Every set must be valid; the red one has only two tiles');
    });

    it('counts the points on the way to opening', () => {
        const rack = [t('red', 1), t('red', 2), t('red', 3), t('blue', 9)];
        const round = position([], rack, false);
        const laid = withBoard(round, moveTiles({ table: [], rack }, ['red_1_0', 'red_2_0', 'red_3_0'], { kind: 'new' }));
        expect(cookieStatus(laid, [])).toBe('That makes 6 points; you need 30 to open');
    });

    it('says when the turn can end, and when that wins it', () => {
        const table = [set('s1', t('red', 1), t('red', 2), t('red', 3))];
        const rack = [t('red', 4), t('blue', 9)];
        const round = position(table, rack, true);
        const placed = withBoard(round, moveTiles({ table, rack }, ['red_4_0'], { kind: 'set', setId: 's1' }));
        expect(cookieStatus(placed, [])).toBe('All good. Tap End turn, or keep playing');

        const last = position(table, [t('red', 4)], true);
        const out = withBoard(last, moveTiles({ table, rack: [t('red', 4)] }, ['red_4_0'], { kind: 'set', setId: 's1' }));
        expect(cookieStatus(out, [])).toBe('That is your last tile! Tap End turn to go out');
    });

    it('asks for a rack tile when only the table moved', () => {
        const table = [set('s1', t('red', 1), t('red', 2), t('red', 3), t('red', 4), t('red', 5), t('red', 6))];
        const round = position(table, [t('blue', 9)], true);
        const split = withBoard(
            round,
            moveTiles({ table, rack: round.racks.cookie }, ['red_4_0', 'red_5_0', 'red_6_0'], { kind: 'new' }),
        );
        expect(cookieStatus(split, [])).toContain('at least one tile from your rack');
    });

    it('tells her where to put what she has picked up', () => {
        const round = position([], [t('red', 1), t('red', 2)], true);
        expect(cookieStatus(round, ['red_1_0'])).toBe('Tap a set to add it, or the dotted spot for a new set');
        expect(cookieStatus(round, ['red_1_0', 'red_2_0'])).toBe(
            'Tap a set to add them, or the dotted spot for a new set',
        );
    });

    it('points out a joker the tile in hand could be swapped for', () => {
        const table = [set('s1', t('red', 3), J, t('red', 5))];
        const round = position(table, [t('red', 4), t('blue', 1)], true);
        expect(canSwapForJoker(round, ['red_4_0'])).toBe(true);
        expect(canSwapForJoker(round, ['blue_1_0'])).toBe(false);
        expect(cookieStatus(round, ['red_4_0'])).toContain('glowing joker');

        const closed = position(table, [t('red', 4)], false);
        expect(canSwapForJoker(closed, ['red_4_0'])).toBe(false);
    });
});

describe('fitting the table to the window', () => {
    it('uses the biggest tile when there is room', () => {
        expect(fitTable(1000, 400, [3, 3, 4], 18, 52)).toEqual({ tile: 52, overflows: false });
    });

    it('shrinks the tiles as the table fills', () => {
        const many = Array.from({ length: 30 }, () => 3);
        const { tile, overflows } = fitTable(620, 180, many, 18, 40);
        expect(overflows).toBe(false);
        expect(tile).toBeLessThan(40);
        expect(fitsAt(tile, 620, 180, many)).toBe(true);
        expect(fitsAt(tile + 1, 620, 180, many)).toBe(false);
    });

    it('says so when even the smallest tile will not fit', () => {
        const many = Array.from({ length: 40 }, () => 13);
        expect(fitTable(300, 100, many, 18, 40)).toEqual({ tile: 18, overflows: true });
    });
});

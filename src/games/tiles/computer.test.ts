import { describe, expect, it } from 'vitest';
import { findMelds, planComputerTurn, spareTiles, type ComputerView } from './computer';
import {
    commitTurn,
    currentBoard,
    dealRound,
    drawTurn,
    everyTileAccountedFor,
    isTableValid,
    readSet,
    withBoard,
    type Round,
    type TableSet,
    type Tile,
    type TileColor,
} from './rules';

const t = (color: TileColor, number: number, copy = 0): Tile => ({ id: `${color}_${number}_${copy}`, color, number });
const J: Tile = { id: 'joker_0', color: null, number: 0 };
const set = (id: string, ...tiles: Tile[]): TableSet => ({ id, tiles });
const ids = (tiles: readonly Tile[]) => tiles.map(tile => tile.id);

const view = (rack: Tile[], table: TableSet[] = [], opened = true, poolCount = 50): ComputerView => ({
    rack,
    table,
    opened,
    poolCount,
});

const lastStep = (v: ComputerView) => {
    const steps = planComputerTurn(v);
    return steps[steps.length - 1];
};

describe('finding sets in a rack', () => {
    it('finds runs and groups', () => {
        const melds = findMelds([t('red', 1), t('red', 2), t('red', 3), t('blue', 9), t('black', 9), t('orange', 9)], {
            jokers: false,
        });
        expect(melds).toHaveLength(2);
    });

    it('returns nothing from a hand with no sets', () => {
        expect(findMelds([t('red', 1), t('blue', 5), t('black', 9)], { jokers: true })).toBeNull();
    });

    it('prefers the split that plays the most tiles', () => {
        // Group of fives alone plays 3; the two runs through the fives play 6.
        const rack = [
            t('red', 4),
            t('red', 5),
            t('red', 6),
            t('blue', 4),
            t('blue', 5),
            t('blue', 6),
            t('black', 5),
        ];
        const melds = findMelds(rack, { jokers: false });
        expect(melds?.flat()).toHaveLength(6);
    });

    it('uses a joker only when told it may', () => {
        const rack = [t('red', 7), t('red', 8), J];
        expect(findMelds(rack, { jokers: false })).toBeNull();
        expect(findMelds(rack, { jokers: true })?.flat()).toHaveLength(3);
    });

    it('handles the top of the board: a joker goes beneath 12, 13', () => {
        const melds = findMelds([t('red', 12), t('red', 13), J], { jokers: true });
        expect(melds?.[0].map(tile => tile.id)).toEqual(['joker_0', 'red_12_0', 'red_13_0']);
    });

    it('stops searching at its budget on a huge rack and still answers', () => {
        const rack: Tile[] = [];
        for (const color of ['black', 'blue', 'orange', 'red'] as const) {
            for (let number = 1; number <= 13; number++) rack.push(t(color, number));
        }
        const melds = findMelds(rack, { jokers: false });
        expect(melds).not.toBeNull();
        expect(melds?.every(meld => readSet(meld).valid)).toBe(true);
    });
});

describe('opening', () => {
    it('opens as soon as it holds 30 points', () => {
        const rack = [t('red', 10), t('red', 11), t('red', 12), t('blue', 1)];
        const steps = planComputerTurn(view(rack, [], false));
        expect(steps).toHaveLength(1);
        expect(steps[0].rack).toEqual([t('blue', 1)]);
        expect(steps[0].say).toContain('33');
    });

    it('holds back if it has sets worth less than 30', () => {
        const rack = [t('red', 1), t('red', 2), t('red', 3), t('blue', 5)];
        expect(planComputerTurn(view(rack, [], false))).toEqual([]);
    });

    it('never touches the table when opening', () => {
        const table = [set('s1', t('blue', 7), t('blue', 8), t('blue', 9), t('blue', 10))];
        const rack = [t('red', 10), t('red', 11), t('red', 12), t('blue', 11), t('blue', 6)];
        const end = lastStep(view(rack, table, false));
        expect(end.table[0]).toEqual(table[0]);
        expect(ids(end.rack).sort()).toEqual(['blue_11_0', 'blue_6_0']);
    });
});

describe('after opening', () => {
    it('plays every set it holds', () => {
        const rack = [t('red', 1), t('red', 2), t('red', 3), t('blue', 9), t('black', 9), t('orange', 9), t('red', 13)];
        const end = lastStep(view(rack));
        expect(end.rack).toEqual([t('red', 13)]);
        expect(end.table).toHaveLength(2);
    });

    it('adds to the ends of runs', () => {
        const table = [set('s1', t('red', 4), t('red', 5), t('red', 6))];
        const end = lastStep(view([t('red', 3), t('red', 7), t('blue', 1)], table));
        expect(end.table[0].tiles.map(tile => tile.number)).toEqual([3, 4, 5, 6, 7]);
        expect(end.rack).toEqual([t('blue', 1)]);
    });

    it('adds the missing colour to a group', () => {
        const table = [set('s1', t('red', 8), t('blue', 8), t('black', 8))];
        const end = lastStep(view([t('orange', 8), t('blue', 1)], table));
        expect(end.table[0].tiles).toHaveLength(4);
    });

    it('takes an end tile off a run of four to complete a set of its own', () => {
        const table = [set('s1', t('orange', 5), t('orange', 6), t('orange', 7), t('orange', 8))];
        const end = lastStep(view([t('red', 5), t('blue', 5), t('black', 1)], table));
        expect(end.rack).toEqual([t('black', 1)]);
        expect(end.table).toHaveLength(2);
        expect(end.table[0].tiles.map(tile => tile.number)).toEqual([6, 7, 8]);
        expect(end.table[1].tiles.map(tile => tile.number)).toEqual([5, 5, 5]);
        expect(isTableValid(end.table)).toBe(true);
    });

    it('builds a run from a borrowed tile too', () => {
        const table = [set('s1', t('red', 4), t('red', 5), t('red', 6), t('red', 7))];
        const end = lastStep(view([t('red', 8, 1), t('red', 9), t('black', 1)], table));
        // 8 extends the run first, then 9 does: both are played either way.
        expect(end.rack).toEqual([t('black', 1)]);
        expect(isTableValid(end.table)).toBe(true);
    });

    it('splits a long run in two to insert a tile', () => {
        const table = [set('s1', ...[3, 4, 5, 6, 7, 8].map(number => t('red', number)))];
        const end = lastStep(view([t('red', 5, 1), t('blue', 1)], table));
        expect(end.rack).toEqual([t('blue', 1)]);
        expect(end.table).toHaveLength(2);
        expect(isTableValid(end.table)).toBe(true);
        expect(end.table[0].tiles.map(tile => tile.number)).toEqual([3, 4, 5]);
        expect(end.table[1].tiles.map(tile => tile.number)).toEqual([5, 6, 7, 8]);
    });

    it('takes a joker it can replace and plays it the same turn', () => {
        const table = [set('s1', t('red', 3), J, t('red', 5))];
        const rack = [t('red', 4, 1), t('blue', 8), t('blue', 9), t('black', 1)];
        const end = lastStep(view(rack, table));
        expect(ids(end.rack)).toEqual(['black_1_0']);
        const flat = end.table.flatMap(s => s.tiles);
        expect(flat.map(tile => tile.id)).toContain(J.id);
        expect(end.table[0].tiles.map(tile => tile.id)).toEqual(['red_3_0', 'red_4_1', 'red_5_0']);
        expect(isTableValid(end.table)).toBe(true);
    });

    it('will not take a joker it cannot then play', () => {
        const table = [set('s1', t('red', 3), J, t('red', 5))];
        const rack = [t('red', 4, 1), t('blue', 1), t('black', 9)];
        const steps = planComputerTurn(view(rack, table));
        // The 4 goes on as a plain addition, shifting the joker: nothing leaves the table.
        const end = steps[steps.length - 1];
        expect(end.table.flatMap(s => s.tiles).map(tile => tile.id)).toContain(J.id);
        expect(isTableValid(end.table)).toBe(true);
    });

    it('draws when it finds nothing', () => {
        const table = [set('s1', t('red', 3), t('red', 4), t('red', 5))];
        expect(planComputerTurn(view([t('blue', 9), t('black', 1)], table))).toEqual([]);
    });

    it('only spares what can be spared', () => {
        const short = set('s1', t('red', 3), t('red', 4), t('red', 5));
        const long = set('s2', t('blue', 3), t('blue', 4), t('blue', 5), t('blue', 6));
        const fullGroup = set('s3', t('red', 9), t('blue', 9), t('black', 9), t('orange', 9));
        const shortGroup = set('s4', t('red', 1), t('blue', 1), t('black', 1));
        const spare = ids(spareTiles([short, long, fullGroup, shortGroup]));
        expect(spare).toEqual(['blue_3_0', 'blue_6_0', 'red_9_0', 'blue_9_0', 'black_9_0', 'orange_9_0']);
    });

    it('never spares a joker', () => {
        const withJoker = set('s1', J, t('blue', 12), t('blue', 13), t('blue', 10));
        expect(ids(spareTiles([withJoker]))).not.toContain(J.id);
    });

    it('does not change what it was shown', () => {
        const table = [set('s1', t('red', 3), t('red', 4), t('red', 5), t('red', 6))];
        const rack = [t('red', 7), t('blue', 3), t('black', 3), J];
        const v = view(rack, table);
        const before = JSON.stringify(v);
        planComputerTurn(v);
        expect(JSON.stringify(v)).toBe(before);
    });

    it('plays the same turn from the same position', () => {
        const table = [set('s1', t('red', 3), t('red', 4), t('red', 5), t('red', 6))];
        const rack = [t('red', 7), t('blue', 3), t('black', 3), J];
        expect(planComputerTurn(view(rack, table))).toEqual(planComputerTurn(view(rack, table)));
    });
});

describe('self-play', () => {
    /** How many times each kind of move was made, by what the computer says about it. */
    const said = new Map<string, number>();

    const playRound = (seed: number) => {
        let round: Round = dealRound(seed);
        let turns = 0;

        while (!round.result) {
            turns++;
            if (turns > 2000) throw new Error(`seed ${seed} did not finish`);

            const player = round.turn;
            const opponentBefore = round.racks[player === 'cookie' ? 'computer' : 'cookie'];
            const steps = planComputerTurn({
                rack: round.racks[player],
                table: round.table,
                opened: round.opened[player],
                poolCount: round.pool.length,
            });

            let previous = currentBoard(round);
            for (const step of steps) {
                said.set(step.say.replace(/\d+/, 'N'), (said.get(step.say.replace(/\d+/, 'N')) ?? 0) + 1);
                // Every step of a turn leaves a good table and a smaller rack.
                expect(isTableValid(step.table), `seed ${seed} turn ${turns}: bad step`).toBe(true);
                expect(step.rack.length).toBeLessThan(previous.rack.length);
                previous = step;
                round = withBoard(round, step);
                expect(everyTileAccountedFor(round), `seed ${seed} turn ${turns}: lost a tile mid-turn`).toBe(true);
            }

            if (steps.length > 0) {
                const { round: next, problem } = commitTurn(round);
                expect(problem, `seed ${seed} turn ${turns}: illegal turn`).toBeNull();
                round = next;
            } else {
                round = drawTurn(round);
            }

            expect(isTableValid(round.table), `seed ${seed} turn ${turns}: bad table`).toBe(true);
            expect(everyTileAccountedFor(round), `seed ${seed} turn ${turns}: lost a tile`).toBe(true);
            // The other player's rack is none of this player's business.
            expect(round.racks[player === 'cookie' ? 'computer' : 'cookie']).toEqual(opponentBefore);
        }
        return { round, turns };
    };

    it('plays fifty rounds against itself with every tile accounted for and the table valid', () => {
        const ways = { out: 0, blocked: 0 };
        const openings: number[] = [];
        for (let seed = 1; seed <= 50; seed++) {
            const { round, turns } = playRound(seed * 7919);
            ways[round.result!.how]++;
            openings.push(turns);
            if (round.result!.how === 'out') {
                const winner = round.result!.winner!;
                expect(round.racks[winner]).toHaveLength(0);
            }
        }
        expect(ways.out + ways.blocked).toBe(50);
        // A healthy player goes out most of the time rather than running the pool dry.
        expect(ways.out).toBeGreaterThan(25);

        // Every kind of move turned up in real games, not only in the hand-made positions above.
        for (const move of [
            'Computer opened with N points',
            'Computer played a new set',
            'Computer added to a set',
            'Computer borrowed from the table to make a set',
            'Computer split a run to fit a tile in',
            'Computer swapped a tile for a joker',
        ]) {
            expect(said.get(move) ?? 0, `${move} never happened`).toBeGreaterThan(0);
        }
    });
});

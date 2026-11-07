import {
    OPENING_POINTS,
    boardChanged,
    canReplaceJoker,
    checkTurn,
    currentBoard,
    findTile,
    isJoker,
    type Round,
    type SetFault,
} from './rules';

/** The plain words the table uses. Kept apart from the rules so a test can read them. */

/** One word on a red set: why it is red. */
export const FAULT_WORD: Record<SetFault, string> = {
    empty: 'Empty',
    short: 'Too few',
    mixed: 'Mixed',
    repeat: 'Repeat',
    gap: 'Gap',
    long: 'Too many',
};

const faultSentence = (fault: SetFault, size: number): string => {
    switch (fault) {
        case 'short':
            return size <= 1 ? 'has only one tile' : 'has only two tiles';
        case 'mixed':
            return 'mixes different numbers and colours';
        case 'repeat':
            return 'has the same colour or number twice';
        case 'gap':
            return 'has a gap in its numbers';
        case 'long':
            return 'has too many tiles';
        default:
            return 'is empty';
    }
};

/** Could the one tile in hand be swapped for a joker on the table? */
export const canSwapForJoker = (round: Round, lifted: readonly string[]): boolean => {
    if (lifted.length !== 1 || !round.opened.cookie) return false;
    const tile = findTile(currentBoard(round), lifted[0]);
    if (!tile) return false;
    return round.table.some(set => set.tiles.some(held => isJoker(held) && canReplaceJoker(set, held.id, tile)));
};

/** What Cookie should do next, on her turn. */
export const cookieStatus = (round: Round, lifted: readonly string[]): string => {
    if (lifted.length > 0) {
        if (canSwapForJoker(round, lifted)) return 'Tap the glowing joker to swap this tile for it, or tap a set';
        const tile = lifted.length === 1 ? 'it' : 'them';
        return `Tap a set to add ${tile}, or the dotted spot for a new set`;
    }

    const opened = round.opened.cookie;
    const now = currentBoard(round);
    const drawWord = round.pool.length > 0 ? 'draw' : 'pass';

    if (!boardChanged(round.start, now)) {
        return opened
            ? `Play from your rack, rearrange the table, or ${drawWord}`
            : `Put down ${OPENING_POINTS} points from your rack to open, or ${drawWord}`;
    }

    const { problem, laidValue } = checkTurn(round.start, now, opened);
    if (!problem) {
        if (now.rack.length === 0) return 'That is your last tile! Tap End turn to go out';
        return 'All good. Tap End turn, or keep playing';
    }

    switch (problem.kind) {
        case 'invalid-set':
            return `Every set must be valid; the red one ${faultSentence(problem.fault, problem.size)}`;
        case 'nothing-played':
            return 'Put down at least one tile from your rack, or tap Start over';
        case 'opening-short':
            return `That makes ${laidValue} points; you need ${OPENING_POINTS} to open`;
        case 'opening-touched':
            return 'Your first play has to come from your own rack. Tap Start over';
        default:
            return 'Tiles from the table have to stay on the table. Tap Start over';
    }
};

import React from 'react';
import { Snowflake } from 'lucide-react';
import PlayingCardView from '../shared/PlayingCard';
import type { PlayingCard } from '../shared/cards';
import {
    canastaBonus,
    isBlackThree,
    isCanasta,
    isNaturalCanasta,
    isRedThree,
    isWild,
    rankWord,
    rankWords,
    type Meld,
    type MeldRank,
    type Seat,
} from './rules';
import type { HandResult, Stats } from './store';

/** The pieces of the table. Nothing here decides anything; it only draws what it is given. */

const asButton = (onTap?: () => void): React.HTMLAttributes<HTMLDivElement> =>
    onTap
        ? {
              role: 'button',
              tabIndex: 0,
              onClick: onTap,
              onKeyDown: event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onTap();
                  }
              },
          }
        : {};

/** One rank's meld, squared up: wilds peek out at the left, the rank stays on top, and seven glows. */
export const MeldStack: React.FC<{
    meld: Meld;
    highlighted?: boolean;
    onTap?: (rank: MeldRank) => void;
}> = ({ meld, highlighted = false, onTap }) => {
    const wilds = meld.cards.filter(isWild);
    const naturals = meld.cards.filter(card => !isWild(card));
    const ordered = [...wilds, ...naturals];
    const canasta = isCanasta(meld);
    const label = canasta
        ? `A ${isNaturalCanasta(meld) ? 'natural' : 'mixed'} canasta of ${rankWords(meld.rank)}, worth ${canastaBonus(meld)}, with ${meld.cards.length} cards`
        : `${meld.cards.length} cards on the ${rankWord(meld.rank)} meld, ${wilds.length} of them wild`;
    return (
        <div
            className={`cn-stack${canasta ? ' is-canasta' : ''}${onTap ? ' is-tappable' : ''}`}
            style={{ '--wilds': wilds.length } as React.CSSProperties}
            aria-label={label}
            title={label}
            {...asButton(onTap && (() => onTap(meld.rank)))}
        >
            {ordered.map((card, index) => {
                const wildSpot = Math.min(index, wilds.length);
                const naturalSpot = Math.max(0, index - wilds.length);
                return (
                    <div
                        key={card.id}
                        className="cn-stack-card"
                        style={
                            {
                                '--wild-spot': wildSpot,
                                '--natural-spot': Math.min(naturalSpot, 3),
                            } as React.CSSProperties
                        }
                    >
                        <PlayingCardView card={card} highlighted={highlighted && index === ordered.length - 1} />
                    </div>
                );
            })}
            <span className="cn-badge">{meld.cards.length}</span>
            {canasta && <span className="cn-worth">{canastaBonus(meld)}</span>}
        </div>
    );
};

export const RedThrees: React.FC<{ cards: PlayingCard[] }> = ({ cards }) =>
    cards.length === 0 ? null : (
        <div
            className="cn-stack cn-reds"
            style={{ '--wilds': 0 } as React.CSSProperties}
            aria-label={`${cards.length} red ${cards.length === 1 ? 'three' : 'threes'}`}
            title={`${cards.length} red ${cards.length === 1 ? 'three' : 'threes'}`}
        >
            {cards.map((card, index) => (
                <div
                    key={card.id}
                    className="cn-stack-card"
                    style={{ '--wild-spot': 0, '--natural-spot': Math.min(index, 3) } as React.CSSProperties}
                >
                    <PlayingCardView card={card} />
                </div>
            ))}
            <span className="cn-badge">{cards.length}</span>
        </div>
    );

/** A row of melds, or a quiet line saying where they will go. */
export const MeldRow: React.FC<{
    melds: Meld[];
    reds: PlayingCard[];
    emptyText: string;
    highlight?: (rank: MeldRank) => boolean;
    onTap?: (rank: MeldRank) => void;
}> = ({ melds, reds, emptyText, highlight, onTap }) => (
    <div className="cn-melds">
        <RedThrees cards={reds} />
        {melds.map(meld => (
            <MeldStack key={meld.rank} meld={meld} highlighted={highlight?.(meld.rank)} onTap={onTap} />
        ))}
        {melds.length === 0 && <span className="cn-empty-row">{emptyText}</span>}
    </div>
);

/** The computer's hand, tight together, every card a real one so it can fly from here. */
export const BackFan: React.FC<{ cards: PlayingCard[] }> = ({ cards }) => (
    <div className="cn-fan-wrap" aria-label={`The computer holds ${cards.length} cards`} role="img">
        <div className="cn-fan">
            {cards.map((card, index) => (
                <div key={card.id} className="cn-fan-slot">
                    <PlayingCardView card={card} />
                    {index === cards.length - 1 && <span className="cn-badge">{cards.length}</span>}
                </div>
            ))}
        </div>
    </div>
);

export const Stock: React.FC<{ cards: PlayingCard[]; live: boolean; onTap: () => void }> = ({ cards, live, onTap }) => (
    <div
        className={`cn-slot cn-stock${live ? ' is-live' : ''}`}
        aria-label={`The stock, ${cards.length} cards. Tap to draw.`}
        {...asButton(onTap)}
    >
        {cards.length === 0 && <span className="cn-slot-empty">Empty</span>}
        {cards.slice(-3).map((card, index) => (
            <div key={card.id} className="cn-pile-card" style={{ '--spot': index } as React.CSSProperties}>
                <PlayingCardView card={card} />
            </div>
        ))}
        <span className="cn-badge">{cards.length}</span>
        <span className="cn-slot-label">Stock</span>
    </div>
);

export const DiscardPile: React.FC<{
    cards: PlayingCard[];
    frozen: boolean;
    live: boolean;
    onTap: () => void;
}> = ({ cards, frozen, live, onTap }) => {
    const top = cards[cards.length - 1];
    // The card that froze the pile lies sideways, showing past whatever covers it.
    let sideways = -1;
    if (frozen) {
        for (let i = cards.length - 1; i >= 0; i--) {
            if (isWild(cards[i]) || isRedThree(cards[i])) {
                sideways = i;
                break;
            }
        }
    }
    const blocked = top ? isBlackThree(top) : false;
    return (
        <div
            className={`cn-slot cn-pile${live ? ' is-live' : ''}`}
            aria-label={`The discard pile, ${cards.length} cards${frozen ? ', frozen' : ''}.`}
            {...asButton(onTap)}
        >
            {cards.length === 0 && <span className="cn-slot-empty">Empty</span>}
            {cards.map((card, index) => (
                <div key={card.id} className="cn-pile-card">
                    <PlayingCardView
                        card={card}
                        highlighted={live && index === cards.length - 1}
                        style={index === sideways ? { rotate: '90deg' } : undefined}
                    />
                </div>
            ))}
            {cards.length > 0 && <span className="cn-badge">{cards.length}</span>}
            {frozen ? (
                <span className="cn-tag is-frozen">
                    <Snowflake size={11} aria-hidden /> frozen
                </span>
            ) : blocked ? (
                <span className="cn-tag">blocked</span>
            ) : null}
            <span className="cn-slot-label">Pile</span>
        </div>
    );
};

/** Cookie's hand. The slots shrink together, so any number of cards fits without scrolling. */
export const HandFan: React.FC<{
    cards: PlayingCard[];
    selected: string[];
    onTap: (card: PlayingCard) => void;
}> = ({ cards, selected, onTap }) => {
    const middle = (cards.length - 1) / 2 || 1;
    return (
        <div className="cn-hand" aria-label="Your hand">
            {cards.map((card, index) => {
                const lean = (index - middle) / middle;
                return (
                    <div
                        key={card.id}
                        className="cn-hand-slot"
                        style={{ '--arc': (lean * lean).toFixed(3) } as React.CSSProperties}
                    >
                        <PlayingCardView card={card} selected={selected.includes(card.id)} onClick={onTap} />
                    </div>
                );
            })}
        </div>
    );
};

const signed = (value: number): string => (value > 0 ? `${value}` : value < 0 ? `−${Math.abs(value)}` : '0');

const WHO: Record<Seat, string> = { cookie: 'Cookie', computer: 'The computer' };

const panelTitle = (result: HandResult, winner: Seat | null): string => {
    if (winner === 'cookie') return 'Cookie wins the match!';
    if (winner === 'computer') return 'The computer wins the match';
    if (result.wentOut) {
        if (result.concealed) return `${WHO[result.wentOut]} went out concealed!`;
        return `${WHO[result.wentOut]} went out${result.wentOut === 'cookie' ? '!' : ''}`;
    }
    return 'The stock ran out';
};

/** The cream card at the end of a hand, with how every point was made. */
export const HandPanel: React.FC<{
    result: HandResult;
    totals: Record<Seat, number>;
    winner: Seat | null;
    handsPlayed: number;
    stats: Stats;
    onNext: () => void;
}> = ({ result, totals, winner, handsPlayed, stats, onNext }) => {
    const { cookie, computer } = result.scores;
    const rows: [string, number, number][] = [
        ['Canastas', cookie.canastas, computer.canastas],
        ['Red threes', cookie.redThrees, computer.redThrees],
        ['Going out', cookie.goingOut, computer.goingOut],
        ['Melded cards', cookie.melded, computer.melded],
        ['Left in hand', -cookie.inHand, -computer.inHand],
    ];
    const sub = winner
        ? `After ${handsPlayed} ${handsPlayed === 1 ? 'hand' : 'hands'}. Matches won: ${stats.won} of ${stats.played}.`
        : `Hand ${handsPlayed}. First to 5,000 wins the match.`;
    return (
        <div className="win-panel-wrap">
            <div className="win-panel cn-panel" role="dialog" aria-label="Scores for this hand">
                {winner === 'cookie' && <div className="win-cookie">🍪</div>}
                <h2>{panelTitle(result, winner)}</h2>
                <p className="win-sub">{sub}</p>
                <table className="cn-scores">
                    <thead>
                        <tr>
                            <th />
                            <th>Cookie</th>
                            <th>Computer</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([label, mine, theirs]) => (
                            <tr key={label}>
                                <th scope="row">{label}</th>
                                <td>{signed(mine)}</td>
                                <td>{signed(theirs)}</td>
                            </tr>
                        ))}
                        <tr className="is-sum">
                            <th scope="row">This hand</th>
                            <td>{signed(cookie.total)}</td>
                            <td>{signed(computer.total)}</td>
                        </tr>
                        <tr className="is-total">
                            <th scope="row">Match total</th>
                            <td>{signed(totals.cookie)}</td>
                            <td>{signed(totals.computer)}</td>
                        </tr>
                    </tbody>
                </table>
                <div className="win-actions">
                    <button className="btn btn-primary" onClick={onNext} autoFocus>
                        <span>{winner ? 'New match' : 'Next hand'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

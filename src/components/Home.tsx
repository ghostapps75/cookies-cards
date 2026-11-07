import React, { useState } from 'react';
import { games } from '../games/registry';
import { navigate } from '../router';
import * as sfx from '../utils/sound';
import './Home.css';

/**
 * The days the home screen wears a party hat, as month-day. Cookie's birthday
 * falls on the first; the second is there so nobody misses it over a late
 * night.
 */
const PARTY_DAYS = new Set(['11-07', '11-08']);

const isPartyDay = (today = new Date()): boolean => {
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return PARTY_DAYS.has(`${month}-${day}`);
};

const Home: React.FC = () => {
    const [party, setParty] = useState(isPartyDay);

    const open = (id: string) => {
        void sfx.unlockAudio();
        sfx.playClick();
        navigate(id);
    };

    return (
        <div className="table-felt home">
            <header className="home-head">
                <span className="home-mark" aria-hidden>
                    🍪
                </span>
                <h1>Cookie&rsquo;s Cards</h1>
                <p>Pick a game. The table is yours.</p>
            </header>

            {party && (
                <div className="birthday" role="status">
                    <span className="birthday-cake" aria-hidden>
                        🎂
                    </span>
                    <div className="birthday-text">
                        <strong>Happy birthday, Cookie!</strong>
                        <span>There are new games on the table, just for you.</span>
                    </div>
                    <button className="birthday-close" aria-label="Close" onClick={() => setParty(false)}>
                        ×
                    </button>
                </div>
            )}

            <main className="home-grid">
                {games.map(game => (
                    <button key={game.id} className="game-tile" onClick={() => open(game.id)}>
                        <span className="tile-mark" aria-hidden>
                            {game.mark}
                        </span>
                        <span className="tile-title">{game.title}</span>
                        <span className="tile-tagline">{game.tagline}</span>
                    </button>
                ))}
            </main>

            <footer className="home-foot">Made for Cookie, with love.</footer>
        </div>
    );
};

export default Home;

import { Suspense, useEffect, useState } from 'react';
import Home from './components/Home';
import { findGame } from './games/registry';
import { useRoute } from './router';
import { createDeck } from './utils/gameLogic';
import { preloadCardImages } from './utils/assets';
import { unlockAudio, warmUpAudio } from './utils/sound';
import introVideo from './assets/intro.mp4';
import './App.css';

const INTRO_SEEN_KEY = 'cookie-solitaire-intro-seen';

/**
 * Only suggest rotating on something that can actually be rotated. A narrow
 * window on a desktop is not a phone held upright, and covering the whole game
 * there would leave no way to reach the toolbar at all.
 */
const ROTATE_QUERY = '(orientation: portrait) and (max-width: 900px) and (pointer: coarse)';

const alreadyGreeted = (): boolean => {
    try {
        return sessionStorage.getItem(INTRO_SEEN_KEY) === '1';
    } catch {
        return false;
    }
};

function App() {
    const [showIntro, setShowIntro] = useState(!alreadyGreeted());
    const [sideways, setSideways] = useState(false);
    const [playAnyway, setPlayAnyway] = useState(false);
    const route = useRoute();
    const game = findGame(route);

    useEffect(() => {
        preloadCardImages(createDeck());
        warmUpAudio();
    }, []);

    useEffect(() => {
        document.title = game ? `Cookie’s ${game.title}` : 'Cookie’s Cards';
    }, [game]);

    useEffect(() => {
        const query = window.matchMedia(ROTATE_QUERY);
        const update = () => setSideways(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    const dismissIntro = () => {
        try {
            sessionStorage.setItem(INTRO_SEEN_KEY, '1');
        } catch {
            /* ignore */
        }
        // The tap that leaves the intro is also what lets us make noise.
        void unlockAudio();
        setShowIntro(false);
    };

    if (showIntro) {
        return (
            <div className="intro-screen" onClick={dismissIntro}>
                <video src={introVideo} autoPlay muted playsInline onEnded={dismissIntro} />
                <button
                    className="intro-skip"
                    onClick={event => {
                        event.stopPropagation();
                        dismissIntro();
                    }}
                >
                    Skip
                </button>
            </div>
        );
    }

    const Game = game?.component;

    return (
        <>
            {sideways && !playAnyway && (
                <div className="rotate-overlay">
                    <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                        <line x1="12" y1="18" x2="12.01" y2="18" />
                    </svg>
                    <h2>Turn your phone sideways</h2>
                    <p>There is a lot more table that way.</p>
                    <button className="btn btn-lg rotate-anyway" onClick={() => setPlayAnyway(true)}>
                        Play like this
                    </button>
                </div>
            )}
            {Game ? (
                // Each game is its own chunk; the cloth shows while it loads.
                <Suspense fallback={<div className="table-felt" />}>
                    <Game />
                </Suspense>
            ) : (
                <Home />
            )}
        </>
    );
}

export default App;

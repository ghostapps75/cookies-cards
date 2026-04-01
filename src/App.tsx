import { useState, useEffect } from 'react';
import GameBoard from './components/GameBoard';
import introVideo from './assets/intro.mp4';
import './App.css';

function App() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    // Force logical width on mobile so Safari scales our game board correctly in Landscape
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      let viewportMeta = document.querySelector('meta[name="viewport"]');
      if (!viewportMeta) {
        viewportMeta = document.createElement('meta');
        viewportMeta.setAttribute('name', 'viewport');
        document.head.appendChild(viewportMeta);
      }
      // 1100px is the optimal horizontal size for our 7 columns
      viewportMeta.setAttribute('content', 'width=1100, user-scalable=no, viewport-fit=cover');
    }
  }, []);

  return (
    <>
      {showIntro ? (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video
            src={introVideo}
            autoPlay
            muted
            playsInline
            onEnded={() => setShowIntro(false)}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
          <button
            onClick={() => setShowIntro(false)}
            style={{
              position: 'absolute',
              bottom: '20px',
              right: '20px',
              zIndex: 50,
              padding: '10px 20px',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              fontFamily: 'sans-serif',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.borderColor = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
            }}
          >
            Skip
          </button>
        </div>
      ) : (
        <>
          <div className="rotate-overlay">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
              <line x1="12" y1="18" x2="12.01" y2="18"></line>
            </svg>
            <h2 style={{marginTop: '20px', marginBottom: '10px'}}>Please Rotate Device</h2>
            <p>This game is best played in landscape mode.</p>
          </div>
          <div className="App">
            <GameBoard />
          </div>
        </>
      )}
    </>
  );
}

export default App;

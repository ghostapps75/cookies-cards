import React, { useState } from 'react';
import GameBoard from './components/GameBoard';
import introVideo from './assets/intro.mp4';
import './App.css';

function App() {
  const [showIntro, setShowIntro] = useState(true);

  if (showIntro) {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: 'black' }}>
        <video
          src={introVideo}
          autoPlay
          muted
          playsInline
          onEnded={() => setShowIntro(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
    );
  }

  return (
    <div className="App">
      <GameBoard />
    </div>
  );
}

export default App;

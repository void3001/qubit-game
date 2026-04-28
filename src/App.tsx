import { useState, useEffect, useRef } from 'react';
import Game from './Game';
import './App.css';

export type Difficulty = 'easy' | 'normal' | 'hard';

const DIFFICULTY_INFO: Record<Difficulty, string> = {
  easy: 'Minimal decoherence. Higher gate pickup chance. Ideal for learning quantum mechanics.',
  normal: 'Balanced decoherence zones. Standard pickup rates. The intended experience.',
  hard: 'Aggressive decoherence. Lower pickup chance. True quantum chaos.',
};

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [numPlayers, setNumPlayers] = useState(2);
  const [numDice, setNumDice] = useState(1);
  const [isProcedural, setIsProcedural] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(20);
  const [playerNames, setPlayerNames] = useState<string[]>(['Qubit-1','Qubit-2','Qubit-3','Qubit-4','Qubit-5','Qubit-6']);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Particle Field ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: {x:number;y:number;vx:number;vy:number;r:number;alpha:number;color:string}[] = [];
    const colors = ['#00d1ff','#ff007f','#39ff14','#ffbe0b','#a200ff'];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.6 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    let animId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
      });
      // draw connecting lines between nearby particles
      ctx.globalAlpha = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = particles[i].color;
            ctx.globalAlpha = (1 - dist/100) * 0.15;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(animate);
    };
    animate();
    const handleResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', handleResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', handleResize); };
  }, []);

  if (isPlaying) {
    return (
      <Game 
        numPlayers={numPlayers} 
        numDice={numDice} 
        isProcedural={isProcedural}
        difficulty={difficulty}
        timerEnabled={timerEnabled}
        timerSeconds={timerSeconds}
        playerNames={playerNames.slice(0, numPlayers)}
        onExit={() => setIsPlaying(false)} 
      />
    );
  }

  return (
    <div className="lobby-container">
      <canvas ref={canvasRef} className="lobby-particle-canvas" />
      <div className="lobby-panel">
        <h1 className="glow-text-cyan title-mega">Quantum Track</h1>
        <h2 className="subtitle">Operational Prototype // v2.5</h2>
        
        <div className="settings">
          <div className="setting-group">
            <label>Subject Quanta (Players)</label>
            <div className="selector-pills">
              {[2, 3, 4, 5, 6].map(n => (
                <button 
                  key={n}
                  className={`pill-btn ${numPlayers === n ? 'active' : ''}`}
                  onClick={() => setNumPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-group">
            <label>Resolution Rank (Dice)</label>
            <div className="selector-pills">
              {[1, 2].map(n => (
                <button 
                  key={n}
                  className={`pill-btn ${numDice === n ? 'active' : ''}`}
                  onClick={() => setNumDice(n)}
                >
                  {n === 1 ? '3-Bit' : '4-Bit'}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-group">
            <label>Substrate Initialization</label>
            <div className="selector-pills">
              <button 
                className={`pill-btn ${!isProcedural ? 'active' : ''}`}
                onClick={() => setIsProcedural(false)}
              >
                Calibration Standard
              </button>
              <button 
                className={`pill-btn ${isProcedural ? 'active' : ''}`}
                onClick={() => setIsProcedural(true)}
              >
                Procedural Noise
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label>Coherence Shielding (Difficulty)</label>
            <div className="selector-pills">
              {(['easy', 'normal', 'hard'] as Difficulty[]).map(d => (
                <button 
                  key={d}
                  className={`pill-btn difficulty-pill ${d} ${difficulty === d ? 'active' : ''}`}
                  onClick={() => setDifficulty(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <p className="difficulty-desc">{DIFFICULTY_INFO[difficulty]}</p>

          <div className="setting-group">
            <label>Turn Timer</label>
            <div className="selector-pills">
              <button className={`pill-btn ${!timerEnabled ? 'active' : ''}`} onClick={() => setTimerEnabled(false)}>Off</button>
              <button className={`pill-btn ${timerEnabled ? 'active' : ''}`} onClick={() => setTimerEnabled(true)}>On</button>
            </div>
            {timerEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginTop: '0.5rem' }}>
                <span style={{ fontFamily: 'var(--font-tech)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>SECS:</span>
                {[10,15,20,30,45].map(s => (
                  <button key={s} className={`pill-btn ${timerSeconds === s ? 'active' : ''}`} style={{ padding: '0.4rem 0.7rem', minWidth: 'unset' }} onClick={() => setTimerSeconds(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>

          <div className="setting-group player-names-group">
            <label>Player Callsigns</label>
            <div className="player-name-inputs">
              {Array.from({ length: numPlayers }).map((_, i) => (
                <input
                  key={i}
                  className="player-name-input"
                  style={{ borderColor: ['#00f3ff','#ff00ff','#ffbe0b','#39ff14','#ff5e00','#a200ff'][i] }}
                  value={playerNames[i]}
                  maxLength={12}
                  onChange={e => setPlayerNames(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder={`Player ${i+1}`}
                />
              ))}
            </div>
          </div>
        </div>

        <button className="neon-btn start-btn" onClick={() => setIsPlaying(true)}>
          Initialize Simulation
        </button>
      </div>
    </div>
  );
}

export default App;

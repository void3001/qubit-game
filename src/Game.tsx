import { useState, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import './Game.css';
import type { Difficulty } from './App';
import type { Vector } from './quantumLogic';
import {
  createInitialState,
  applySingleQubitGate,
  applyCXGate,
  applySwapGate,
  GATES,
  partialTraceSingleQubit,
  getQubitPhase,
  measureQubit,
  areEntangled,
} from './quantumLogic';
import { playSound, startAmbientDrone, setMasterVolume } from './audio';
import { drawRandomCard } from './FateCards';
import type { FateCard } from './FateCards';

const NUM_TILES = 100;

type GateType = 'H' | 'X' | 'Y' | 'Z' | 'S' | 'M';
type TileData = {
  id: number;
  x: number;
  y: number;
  gate: GateType | null;
  wormholeTo?: number;
  isDecoherenceZone?: boolean;
};
type PlayerState = {
  id: number;
  position: number;
  status: 'playing' | 'won' | 'lost';
  inventory: GateType[];
};

const P_COLORS = ['#00f3ff', '#ff00ff', '#ffbe0b', '#39ff14', '#ff5e00', '#a200ff'];
const MAX_INVENTORY = 3;

// ── Board Generation ──

const generateBoard = (
  isProcedural: boolean
): { tiles: TileData[]; wormholes: Record<number, number> } => {
  const tiles: TileData[] = [];
  const wormholes: Record<number, number> = {};

  if (isProcedural) {
    for (let i = 0; i < 4; i++) {
      const start = Math.floor(Math.random() * 80) + 10;
      const end = Math.floor(Math.random() * 80) + 10;
      if (Math.abs(start - end) > 10) {
        wormholes[start] = end;
      }
    }
  } else {
    wormholes[14] = 44;
    wormholes[31] = 62;
    wormholes[85] = 22;
    wormholes[95] = 53;
  }

  for (let i = 0; i < NUM_TILES; i++) {
    const rowFromBottom = Math.floor(i / 10);
    const row = 9 - rowFromBottom;
    // Standard serpentine: even rows from bottom go L→R, odd go R→L
    // Tile 1 at bottom-left, CORE (tile 100) at top-left
    const col = (rowFromBottom % 2 === 0) ? (i % 10) : 9 - (i % 10);

    let gate: GateType | null = null;
    const isDecoherenceZone = i >= 40 && i <= 60;

    if (isProcedural) {
      if (
        i > 0 &&
        i < NUM_TILES - 1 &&
        !wormholes[i] &&
        Object.values(wormholes).indexOf(i) === -1
      ) {
        const r = Math.random();
        if (r < 0.08) gate = 'H';
        else if (r < 0.14) gate = 'X';
        else if (r < 0.18) gate = 'Z';
        else if (r < 0.22) gate = 'Y';
        else if (r < 0.26) gate = 'S';
        else if (r < 0.30) gate = 'M';
      }
    } else {
      if ([3, 11, 24, 38, 55, 68, 81, 92].includes(i)) gate = 'H';
      if ([6, 17, 29, 45, 60, 75, 88].includes(i)) gate = 'X';
      if ([9, 19, 34, 49, 70].includes(i)) gate = 'Z';
      if ([22, 42, 66, 84].includes(i)) gate = 'M';
      if ([13, 27, 52, 78].includes(i)) gate = 'Y';
      if ([8, 36, 63, 90].includes(i)) gate = 'S';
    }

    tiles.push({
      id: i,
      x: 10 + col * 60,
      y: 10 + row * 60,
      gate,
      wormholeTo: wormholes[i],
      isDecoherenceZone,
    });
  }
  return { tiles, wormholes };
};

// ── Difficulty-driven constants ──
const DIFFICULTY_CONFIG: Record<Difficulty, { pickupChance: number; decoIntensity: number }> = {
  easy:   { pickupChance: 0.40, decoIntensity: 0.5 },
  normal: { pickupChance: 0.25, decoIntensity: 1.0 },
  hard:   { pickupChance: 0.12, decoIntensity: 2.0 },
};

// ── Component ──

interface GameProps {
  numPlayers: number;
  numDice: number;
  isProcedural: boolean;
  difficulty: Difficulty;
  timerEnabled: boolean;
  timerSeconds: number;
  playerNames: string[];
  onExit: () => void;
}

export function Game({ numPlayers, numDice, isProcedural, difficulty, timerEnabled, timerSeconds, playerNames, onExit }: GameProps) {
  const diffConfig = DIFFICULTY_CONFIG[difficulty];
  const [boardData, setBoardData] = useState<{
    tiles: TileData[];
    wormholes: Record<number, number>;
  }>({ tiles: [], wormholes: {} });

  // ── Global Quantum State: one qubit per player ──
  const [globalState, setGlobalState] = useState<Vector>(() =>
    createInitialState(numPlayers)
  );

  useEffect(() => {
    setBoardData(generateBoard(isProcedural));
  }, [isProcedural]);

  const [players, setPlayers] = useState<PlayerState[]>(() =>
    Array.from({ length: numPlayers }).map((_, i) => ({
      id: i,
      position: 0,
      status: 'playing',
      inventory: [],
    }))
  );

  const [activePlayerIdx, setActivePlayerIdx] = useState(0);
  const [history, setHistory] = useState<string[]>(['Game Start.']);
  const [diceValue, setDiceValue] = useState<number | string>('?');
  const [isRolling, setIsRolling] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [modalResult, setModalResult] = useState<{
    title: string;
    message: string;
    won: boolean;
    nextAction?: () => void;
  } | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // ── NEW: Turn Timer ──
  const [timeLeft, setTimeLeft] = useState(timerSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── NEW: Fate Cards per player ──
  const [fateCards, setFateCards] = useState<FateCard[][]>(
    () => Array.from({ length: numPlayers }, () => [])
  );
  const [showFateCards, setShowFateCards] = useState(false);

  // ── NEW: Player Stats tracking ──
  type PlayerStats = { rolls: number; gatesHit: number; wormholes: number; cardsUsed: number };
  const [playerStats, setPlayerStats] = useState<PlayerStats[]>(
    () => Array.from({ length: numPlayers }, () => ({ rolls: 0, gatesHit: 0, wormholes: 0, cardsUsed: 0 }))
  );

  // ── NEW: Hoverd tile for tooltip ──
  const [hoveredTile, setHoveredTile] = useState<number | null>(null);

  // ── NEW: Mute / Volume ──
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);

  // ── NEW: Shield flag per player ──
  const [shielded, setShielded] = useState<boolean[]>(() => Array(numPlayers).fill(false));

  // ── NEW: Extra Roll flag ──
  const [extraRollPending, setExtraRollPending] = useState(false);

  // ── NEW: Win stats screen ──
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    startAmbientDrone();
    const timer = setTimeout(() => setIsInitializing(false), 2400);
    return () => clearTimeout(timer);
  }, []);

  // ── Volume / Mute sync ──
  useEffect(() => {
    setMasterVolume(muted ? 0 : volume);
  }, [muted, volume]);

  // ── Turn Timer ──
  useEffect(() => {
    if (!timerEnabled || isInitializing || isRolling || isMoving || modalResult) {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(timerSeconds);
      return;
    }
    setTimeLeft(timerSeconds);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          // Force roll on timeout
          handleRoll();
          return timerSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayerIdx, timerEnabled, isInitializing, isRolling, isMoving, modalResult]);

  const activePlayer = players[activePlayerIdx];

  // ── Entanglement Detection — for rendering tethers ──
  const getEntanglementPairs = useCallback((): [number, number][] => {
    const pairs: [number, number][] = [];
    for (let a = 0; a < numPlayers; a++) {
      for (let b = a + 1; b < numPlayers; b++) {
        if (
          players[a].status === 'playing' &&
          players[b].status === 'playing' &&
          areEntangled(globalState, a, b, numPlayers)
        ) {
          pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }, [globalState, numPlayers, players]);

  // ── Draw Fate Card ──
  const handleDrawFateCard = () => {
    if (isRolling || isMoving || modalResult || fateCards[activePlayerIdx].length >= 3) return;
    const card = drawRandomCard();
    setFateCards(prev => {
      const next = [...prev];
      next[activePlayerIdx] = [...next[activePlayerIdx], card];
      return next;
    });
    playSound('inventory');
    setHistory(prev => [
      `<span style="color:#ffbe0b">✦ ${playerNames[activePlayerIdx] || 'P' + (activePlayerIdx+1)} drew a Fate Card: ${card.emoji} ${card.name}!</span>`,
      ...prev,
    ]);
  };

  // ── Use Fate Card ──
  const useFateCard = (cardIdx: number) => {
    if (isRolling || isMoving || modalResult) return;
    const card = fateCards[activePlayerIdx][cardIdx];
    if (!card) return;
    const pid = activePlayerIdx;
    const pName = playerNames[pid] || `P${pid+1}`;

    playSound('gate');

    // Remove card first
    setFateCards(prev => {
      const next = [...prev];
      next[pid] = next[pid].filter((_, i) => i !== cardIdx);
      return next;
    });
    setPlayerStats(prev => {
      const n = [...prev]; n[pid] = { ...n[pid], cardsUsed: n[pid].cardsUsed + 1 }; return n;
    });

    if (card.type === 'TELEPORT') {
      const jump = Math.floor(Math.random() * 10) + 1;
      const newPos = Math.min(players[pid].position + jump, NUM_TILES - 1);
      setPlayers(prev => prev.map(p => p.id === pid ? { ...p, position: newPos } : p));
      setHistory(prev => [`<span style="color:#00d1ff">🌀 ${pName} used Quantum Tunnel! Jumped forward ${jump} tiles to Tile ${newPos+1}!</span>`, ...prev]);
    } else if (card.type === 'SHIELD') {
      setShielded(prev => { const n = [...prev]; n[pid] = true; return n; });
      setHistory(prev => [`<span style="color:#39ff14">🛡 ${pName} activated Coherence Shield! Next gate/deco blocked.</span>`, ...prev]);
    } else if (card.type === 'QUANTUM_SWAP') {
      const targets = players.filter(p => p.id !== pid && p.status === 'playing');
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        const myPos = players[pid].position;
        const theirPos = target.position;
        setPlayers(prev => prev.map(p => {
          if (p.id === pid) return { ...p, position: theirPos };
          if (p.id === target.id) return { ...p, position: myPos };
          return p;
        }));
        setHistory(prev => [`<span style="color:#ff00ff">⚡ ${pName} swapped positions with ${playerNames[target.id] || 'P'+(target.id+1)}!</span>`, ...prev]);
      }
    } else if (card.type === 'EXTRA_ROLL') {
      setExtraRollPending(true);
      setHistory(prev => [`<span style="color:#ffbe0b">🎲 ${pName} will get an extra roll after this turn!</span>`, ...prev]);
    } else if (card.type === 'DECOHERE_IMMUNITY') {
      setHistory(prev => [`<span style="color:#ff5e00">🔬 ${pName} activated Isolation Protocol! Decoherence zone bypassed this turn.</span>`, ...prev]);
      // handled in applyMove via shielded
      setShielded(prev => { const n = [...prev]; n[pid] = true; return n; });
    } else if (card.type === 'COLLAPSE_ENEMY') {
      const targets = players.filter(p => p.id !== pid && p.status === 'playing');
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        const { result, newState } = measureQubit(globalState, target.id, numPlayers);
        setGlobalState(newState);
        setHistory(prev => [`<span style="color:#ff3e3e">👁 ${pName} used Observer Effect on ${playerNames[target.id] || 'P'+(target.id+1)}! Collapsed to |${result}⟩!</span>`, ...prev]);
      }
    }
    setShowFateCards(false);
  };

  // ── Use Inventory Gate ──
  const useInventoryGate = (gateIdx: number) => {
    if (isRolling || isMoving || modalResult) return;
    const gate = activePlayer.inventory[gateIdx];
    if (!gate) return;

    playSound('inventory');
    let newGlobal = globalState;

    if (gate === 'M') {
      const { result, newState } = measureQubit(newGlobal, activePlayer.id, numPlayers);
      newGlobal = newState;
      setHistory((prev) => [
        `<span style="color:#ff0000">P${activePlayer.id + 1} used inventory M-Gate! Collapsed to |${result}⟩</span>`,
        ...prev,
      ]);
    } else {
      const gateMatrix = GATES[gate];
      if (gateMatrix) {
        newGlobal = applySingleQubitGate(newGlobal, gateMatrix, activePlayer.id, numPlayers);
        setHistory((prev) => [
          `<span style="color:#39ff14">P${activePlayer.id + 1} used inventory ${gate}-Gate!</span>`,
          ...prev,
        ]);
      }
    }
    setGlobalState(newGlobal);

    // Remove from inventory
    setPlayers((prev) =>
      prev.map((p) =>
        p.id === activePlayer.id
          ? { ...p, inventory: p.inventory.filter((_, idx) => idx !== gateIdx) }
          : p
      )
    );
    setShowInventory(false);
  };

  // ── Roll / Movement ──
  const handleRoll = () => {
    if (
      isRolling ||
      isMoving ||
      modalResult ||
      activePlayer.status !== 'playing' ||
      boardData.tiles.length === 0
    )
      return;

    setIsRolling(true);
    setShowInventory(false);
    setShowFateCards(false);
    playSound('roll');
    // Track stat
    setPlayerStats(prev => { const n=[...prev]; n[activePlayerIdx]={...n[activePlayerIdx], rolls: n[activePlayerIdx].rolls+1}; return n; });

    const rollInterval = setInterval(() => {
      const bitCount = numDice === 1 ? 3 : 4;
      const binStr = Array.from({ length: bitCount })
        .map(() => (Math.random() > 0.5 ? '1' : '0'))
        .join(' ');
      setDiceValue(binStr);
    }, 50);

    setTimeout(() => {
      clearInterval(rollInterval);

      const bitCount = numDice === 1 ? 3 : 4;
      const bits = Array.from({ length: bitCount }).map(() =>
        Math.random() > 0.5 ? '1' : '0'
      );
      const binStr = bits.join(' ');
      const rollAmount = parseInt(bits.join(''), 2);

      setDiceValue(`${binStr}  →  [ ${rollAmount} ]`);

      setIsRolling(false);
      setIsMoving(true);

      if (rollAmount === 0) {
        playSound('collide');
        setHistory((prev) => [
          `<span style="color:#ff0000">P${activePlayer.id + 1} collapsed 000! Quantum Freeze! Evaluates to 0 momentum.</span>`,
          ...prev,
        ]);
        setTimeout(() => {
          setIsMoving(false);
          passTurn(activePlayer.id, players);
        }, 1500);
        return;
      }

      let nextPos = activePlayer.position + rollAmount;
      if (nextPos >= NUM_TILES - 1) {
        nextPos = NUM_TILES - 1;
      }

      let currentStep = activePlayer.position;
      const stepInterval = setInterval(() => {
        if (currentStep < nextPos) {
          currentStep++;
          playSound('move');
          setPlayers((prev) =>
            prev.map((x) =>
              x.id === activePlayer.id ? { ...x, position: currentStep } : x
            )
          );
        } else {
          clearInterval(stepInterval);
          applyMove(activePlayer.id, nextPos, rollAmount);
        }
      }, 300);
    }, 800);
  };

  const applyMove = (pid: number, finalStepPos: number, rollAmount: number) => {
    let finalPos = finalStepPos;
    let viaWormhole = false;

    const tileLandedOn = boardData.tiles[finalPos];
    if (tileLandedOn.wormholeTo !== undefined) {
      finalPos = tileLandedOn.wormholeTo;
      viaWormhole = true;
      playSound('wormhole');
      setPlayerStats(prev => { const n=[...prev]; n[pid]={...n[pid], wormholes: n[pid].wormholes+1}; return n; });
    }

    let newGlobal = globalState;
    const finalTile = boardData.tiles[finalPos];
    let appliedGate = '';

    // ── Apply Tile Gate (respect shield) ──
    if (finalTile.gate && finalPos !== NUM_TILES - 1) {
      const gate = finalTile.gate;
      if (shielded[pid]) {
        // Shield absorbs the gate
        setShielded(prev => { const n=[...prev]; n[pid]=false; return n; });
        appliedGate = `SHIELDED:${gate}`;
      } else {
        // Check if it goes to inventory instead
        const canPickup =
          players[pid].inventory.length < MAX_INVENTORY &&
          Math.random() < diffConfig.pickupChance;

        if (canPickup) {
          playSound('inventory');
          appliedGate = `PICKUP:${gate}`;
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === pid ? { ...p, inventory: [...p.inventory, gate] } : p
            )
          );
        } else {
          playSound('gate');
          if (gate === 'M') {
            const { newState } = measureQubit(newGlobal, pid, numPlayers);
            newGlobal = newState;
          } else {
            const gateMatrix = GATES[gate];
            if (gateMatrix) {
              newGlobal = applySingleQubitGate(newGlobal, gateMatrix, pid, numPlayers);
            }
          }
          appliedGate = gate;
          setPlayerStats(prev => { const n=[...prev]; n[pid]={...n[pid], gatesHit: n[pid].gatesHit+1}; return n; });
        }
      }
    }

    // ── Decoherence Zone ──
    if (finalTile.isDecoherenceZone && finalPos !== NUM_TILES - 1) {
      if (shielded[pid]) {
        // Shield blocked deco
        setShielded(prev => { const n=[...prev]; n[pid]=false; return n; });
        appliedGate += appliedGate ? '+DECO-SHIELDED' : 'DECO-SHIELDED';
      } else {
        playSound('decohere');
        const decoGate = Math.random() > 0.5 ? GATES.Z : GATES.S;
        newGlobal = applySingleQubitGate(newGlobal, decoGate, pid, numPlayers);
        if (diffConfig.decoIntensity >= 2.0) {
          const extraGate = Math.random() > 0.6 ? GATES.X : (Math.random() > 0.5 ? GATES.Z : GATES.S);
          newGlobal = applySingleQubitGate(newGlobal, extraGate, pid, numPlayers);
        }
        if (diffConfig.decoIntensity < 1.0 && Math.random() > 0.5) {
          newGlobal = applySingleQubitGate(newGlobal, decoGate, pid, numPlayers);
        }
        appliedGate += appliedGate ? '+DECO' : 'DECO';
      }
    }

    // ── Check for Collision → True CNOT Entanglement ──
    let collisionOccurred = false;
    let collisionTargetId = -1;

    for (const p of players) {
      if (
        p.id !== pid &&
        p.position === finalPos &&
        p.status === 'playing' &&
        finalPos !== 0 &&
        finalPos !== NUM_TILES - 1
      ) {
        collisionOccurred = true;
        collisionTargetId = p.id;
        break;
      }
    }

    if (collisionOccurred) {
      playSound('entangle');
      // True CNOT entanglement: collision player = control, target = target
      newGlobal = applyCXGate(newGlobal, pid, collisionTargetId, numPlayers);
    }

    setGlobalState(newGlobal);

    // Update positions
    setPlayers((prev) =>
      prev.map((x) => (x.id === pid ? { ...x, position: finalPos } : x))
    );

    // Update history
    setHistory((prev) => {
      const pLabel = playerNames[pid] || `P${pid+1}`;
      let log = `${pLabel} rolled ${rollAmount}. Moved to Tile ${finalStepPos + 1}.`;
      if (viaWormhole) log += ` <span style="color:#a200ff">🌀 Tunneled to Tile ${finalPos + 1}!</span>`;
      if (appliedGate.startsWith('PICKUP:')) {
        log += ` <span style="color:#39ff14;font-weight:bold">Picked up ${appliedGate.slice(7)}-Gate Core!</span>`;
      } else if (appliedGate.startsWith('SHIELDED:')) {
        log += ` <span style="color:#39ff14">🛡 Shield absorbed ${appliedGate.slice(9)}-Gate!</span>`;
      } else if (appliedGate.includes('DECO-SHIELDED')) {
        log += ` <span style="color:#39ff14">🛡 Shield blocked Decoherence Zone!</span>`;
      } else if (appliedGate.includes('DECO')) {
        const base = appliedGate.replace('+DECO', '').replace('DECO', '');
        if (base) log += ` Hit ${base}-Gate.`;
        log += ` <span style="color:#ff5e00">⚠ DECOHERENCE NOISE applied!</span>`;
      } else if (appliedGate) {
        log += ` Hit ${appliedGate}-Gate.`;
      }
      if (collisionOccurred) {
        log += ` <span style="color:#ff007f;font-weight:bold">⚡ CNOT ENTANGLED with ${playerNames[collisionTargetId] || 'P'+(collisionTargetId+1)}!</span>`;
      }
      return [log, ...prev];
    });

    setIsMoving(false);

    if (finalPos === NUM_TILES - 1) {
      handleFinish(pid, newGlobal);
    } else if (extraRollPending) {
      setExtraRollPending(false);
      setHistory(prev => [`<span style="color:#ffbe0b">🎲 Extra roll triggered!</span>`, ...prev]);
      // small delay then roll again
      setTimeout(() => handleRoll(), 800);
    } else {
      passTurn(pid, players);
    }
  };

  const passTurn = (currentId: number, allPlayers: PlayerState[]) => {
    let next = (currentId + 1) % numPlayers;
    let safeGuard = 0;
    while (allPlayers[next].status !== 'playing' && safeGuard < numPlayers) {
      next = (next + 1) % numPlayers;
      safeGuard++;
    }

    if (safeGuard >= numPlayers) {
      setTimeout(
        () =>
          setModalResult({
            title: 'GAME OVER',
            message: 'The Multi-Player Simulation is complete.',
            won: false,
            nextAction: onExit,
          }),
        1000
      );
      return;
    }

    setActivePlayerIdx(next);
    setDiceValue('?');
  };

  // ── Finish: Brutal Entangled Collapse ──
  const handleFinish = (pid: number, currentGlobal: Vector) => {
    setTimeout(() => {
      // Measure the finishing player's qubit
      const { result, newState } = measureQubit(currentGlobal, pid, numPlayers);
      const won = result === 1;

      // Check for entanglement cascade - brutal mode
      // If this player was entangled with others, measuring this qubit
      // has already collapsed the wavefunction, affecting entangled partners
      const cascadeMessages: string[] = [];

      if (won) {
        // Check if measuring this player collapsed any entangled partner to |0⟩
        for (let i = 0; i < numPlayers; i++) {
          if (i === pid || players[i].status !== 'playing') continue;
          const [p0i] = partialTraceSingleQubit(newState, i, numPlayers);
          // If partner is now deterministically |0⟩, they're doomed
          if (p0i > 0.99) {
            cascadeMessages.push(
              `⚡ ENTANGLEMENT CASCADE: P${i + 1} has been forced into |0⟩ by the measurement!`
            );
          }
        }
      }

      let stateAfterCascade = newState;

      if (won) {
        playSound('win');
        confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
      } else {
        playSound('lose');
      }

      setGlobalState(stateAfterCascade);

      const statusVal: 'won' | 'lost' = won ? 'won' : 'lost';
      const nextPlayers = players.map((x) =>
        x.id === pid ? { ...x, status: statusVal } : x
      );
      setPlayers(nextPlayers);

      const cascadeText = cascadeMessages.length
        ? `\n${cascadeMessages.join('\n')}`
        : '';

      setModalResult({
        title: won
          ? `P${pid + 1} MEASURED |1⟩ - WINS!`
          : `P${pid + 1} COLLAPSED |0⟩!`,
        message: won
          ? `Player ${pid + 1} collapsed into |1⟩ and successfully passed the core logic!${cascadeText}`
          : `Player ${pid + 1} collapsed into |0⟩! They failed the measurement and are eliminated.${cascadeText}`,
        won,
        nextAction: () => {
          setModalResult(null);
          passTurn(pid, nextPlayers);
        },
      });
    }, 800);
  };

  // ── Derived State ──
  const activeProbs = partialTraceSingleQubit(
    globalState,
    activePlayerIdx,
    numPlayers
  );
  const activePhase = getQubitPhase(globalState, activePlayerIdx, numPlayers);
  const isSuperposition = activeProbs[0] > 0.01 && activeProbs[1] > 0.01;
  const pColor = P_COLORS[activePlayerIdx];
  const entanglementPairs = getEntanglementPairs();

  // ── Render SVG Wormhole Lines (curved bezier) ──
  const renderWormholeLines = () => {
    const lines = [];
    for (const [startTileId, endTileId] of Object.entries(boardData.wormholes)) {
      const start = boardData.tiles[Number(startTileId)];
      const end = boardData.tiles[endTileId];
      if (start && end) {
        const isLadder = endTileId > Number(startTileId);
        const x1 = start.x + 28, y1 = start.y + 28;
        const x2 = end.x + 28,   y2 = end.y + 28;
        // Control point: midpoint offset perpendicularly for a nice arc
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const curve = Math.min(len * 0.35, 90);
        const cx = mx - (dy / len) * curve;
        const cy = my + (dx / len) * curve;
        lines.push(
          <path
            key={`${startTileId}-${endTileId}`}
            className={`wormhole-line ${isLadder ? 'wormhole-ladder' : 'wormhole-snake'}`}
            d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
            fill="none"
            opacity="0.7"
          />
        );
        // Small dot markers at endpoints
        lines.push(
          <circle key={`s-${startTileId}`} cx={x1} cy={y1} r={3} fill={isLadder ? 'rgba(0,209,255,0.8)' : 'rgba(255,62,62,0.8)'} />,
          <circle key={`e-${endTileId}`}   cx={x2} cy={y2} r={3} fill={isLadder ? 'rgba(0,209,255,0.8)' : 'rgba(255,62,62,0.8)'} />
        );
      }
    }
    return lines;
  };

  // ── Render Entanglement Tether SVG ──
  const renderEntanglementTethers = () => {
    return entanglementPairs.map(([a, b]) => {
      const tileA = boardData.tiles[players[a].position];
      const tileB = boardData.tiles[players[b].position];
      if (!tileA || !tileB) return null;
      return (
        <line
          key={`ent-${a}-${b}`}
          className="entanglement-tether"
          x1={tileA.x + 28}
          y1={tileA.y + 28}
          x2={tileB.x + 28}
          y2={tileB.y + 28}
          strokeWidth="1.5"
          opacity="0.85"
        />
      );
    });
  };


  // ── Bloch Radar Component ──
  const BlochRadar = ({
    prob0,
    prob1,
    phase,
    color,
  }: {
    prob0: number;
    prob1: number;
    phase: number;
    color: string;
  }) => {
    const cx = 60,
      cy = 60,
      radius = 48;
    // θ = 2*arccos(√prob0) — the Bloch polar angle
    const theta = 2 * Math.acos(Math.sqrt(Math.max(0, Math.min(1, prob0))));
    // φ = phase
    const phi = phase;

    // Project onto XZ plane of Bloch sphere
    const bx = Math.sin(theta) * Math.cos(phi);
    const bz = Math.cos(theta);

    const dotX = cx + bx * radius;
    const dotY = cy - bz * radius;

    return (
      <svg width="120" height="120" viewBox="0 0 120 120" className="bloch-radar">
        {/* Wireframe sphere */}
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
        <ellipse cx={cx} cy={cy} rx={radius} ry={radius * 0.3} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        <ellipse cx={cx} cy={cy} rx={radius * 0.3} ry={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        
        {/* Crosshairs */}
        <line x1={cx - radius - 5} y1={cy} x2={cx + radius + 5} y2={cy} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        <line x1={cx} y1={cy - radius - 5} x2={cx} y2={cy + radius + 5} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        
        {/* State vector line */}
        <line x1={cx} y1={cy} x2={dotX} y2={dotY} stroke={color} strokeWidth="1" />
        
        {/* Core Dot */}
        <circle cx={dotX} cy={dotY} r="3" fill="#fff" style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
        <circle cx={dotX} cy={dotY} r="6" fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
      </svg>
    );
  };

  if (boardData.tiles.length === 0) return <div>Loading Engine...</div>;

  return (
    <div
      className="game-layout"
      style={{
        boxShadow: `inset 0 0 150px ${pColor}30`,
        transition: 'box-shadow 0.8s ease',
      }}
    >
      {isInitializing && (
        <div className="collapse-modal" style={{ background: 'var(--bg-deep)', zIndex: 2000 }}>
          <div style={{ textAlign: 'center' }}>
            <h1 className="glow-text-cyan" style={{ fontSize: '1.5rem', letterSpacing: '10px' }}>CALIBRATING...</h1>
            <div style={{ width: '300px', height: '2px', background: 'rgba(255,255,255,0.1)', margin: '20px auto', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: '-100%', width: '100%', height: '100%', background: 'var(--neon-cyan)', animation: 'energyFlow 1.5s infinite' }}></div>
            </div>
            <p style={{ fontStyle: 'italic', fontSize: '0.7rem', color: 'var(--text-muted)' }}>INITIALIZING QUANTUM DRAIN // SUBJECT QUANTA: {numPlayers}</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1
          className="glow-text-cyan"
          style={{
            fontSize: '1.2rem',
            margin: 0,
            fontFamily: 'var(--font-tech)',
            textTransform: 'uppercase',
            letterSpacing: '10px',
            opacity: 0.8
          }}
        >
          Quantum Track / Lab_Ref_{Math.floor(Math.random() * 9000) + 1000}
        </h1>
        <div style={{ height: '1px', flex: 1, background: 'linear-gradient(90deg, var(--neon-cyan), transparent)', opacity: 0.3 }}></div>
      </div>

      <div className="game-container">
        {/* Game Board */}
        <div className="glass-panel board">
          <svg className="wormhole-svg">
            {renderWormholeLines()}
            {renderEntanglementTethers()}
          </svg>

          {boardData.tiles.map((t) => {
            let tileClass = 'tile';
            if (t.gate) tileClass += ` gate-${t.gate}`;
            if (t.id === 0) tileClass += ' start-tile';
            if (t.id === NUM_TILES - 1) tileClass += ' end-tile';
            if (t.isDecoherenceZone && !t.gate && t.id !== 0 && t.id !== NUM_TILES - 1)
              tileClass += ' decoherence-tile';

            const tooltipParts: string[] = [];
            if (t.gate) tooltipParts.push(`${t.gate}-Gate`);
            if (t.wormholeTo !== undefined) tooltipParts.push(`→ Tile ${t.wormholeTo + 1}`);
            if (t.isDecoherenceZone && t.id !== 0 && t.id !== NUM_TILES - 1) tooltipParts.push('Deco Zone');

            return (
              <div
                key={t.id}
                className={tileClass}
                style={{ left: t.x, top: t.y }}
                onMouseEnter={() => setHoveredTile(t.id)}
                onMouseLeave={() => setHoveredTile(null)}
              >
                <div className="tile-number">{t.id + 1}</div>
                {hoveredTile === t.id && tooltipParts.length > 0 && (
                  <div className="tile-tooltip">{tooltipParts.join(' · ')}</div>
                )}
              </div>
            );
          })}

          {/* Players */}
          {players.map((p) => {
            const currentTile = boardData.tiles[p.position];
            const offsetTop = p.id * 3;
            const offsetLeft = p.id * 3;
            const pProbs = partialTraceSingleQubit(globalState, p.id, numPlayers);
            const superPosClass =
              pProbs[0] > 0.01 && pProbs[1] > 0.01 ? 'superposition' : '';

            let statusClass = '';
            if (p.status === 'lost') statusClass = 'token-lost';
            if (p.status === 'won') statusClass = 'token-won';

            // Check if this player is entangled with anyone
            const isEntangled = entanglementPairs.some(
              ([a, b]) => a === p.id || b === p.id
            );

            return (
              <div
                key={p.id}
                className={`qubit-token token-${p.id} ${superPosClass} ${statusClass} ${isEntangled ? 'entangled-glow' : ''}`}
                style={{
                  left: currentTile.x + 11 + offsetLeft,
                  top: currentTile.y + 11 + offsetTop,
                  zIndex:
                    p.status === 'won'
                      ? 100
                      : activePlayerIdx === p.id
                        ? 20
                        : 10,
                  borderColor: P_COLORS[p.id],
                  boxShadow: `0 0 ${isEntangled ? 18 : 10}px ${P_COLORS[p.id]}`,
                }}
              >
                {(playerNames[p.id] || `Q${p.id+1}`).slice(0,4)}
              </div>
            );
          })}

          {/* Modal Overlay */}
          {modalResult && (
            <div className="collapse-modal">
              <h1
                style={{
                  color: modalResult.won
                    ? 'var(--neon-green)'
                    : 'var(--neon-magenta)',
                  textShadow: `0 0 20px ${modalResult.won ? 'var(--neon-green)' : 'var(--neon-magenta)'}`,
                }}
              >
                {modalResult.title}
              </h1>
              <p
                style={{
                  fontSize: '1.2rem',
                  marginBottom: '2rem',
                  maxWidth: '400px',
                  textAlign: 'center',
                  whiteSpace: 'pre-line',
                }}
              >
                {modalResult.message}
              </p>
              <button className="neon-btn" onClick={modalResult.nextAction}>
                Continue
              </button>
            </div>
          )}
        </div>

        {/* Dashboard */}
        <div
          className="dashboard glass-panel"
          style={{ borderColor: pColor, boxShadow: `0 0 20px ${pColor}30` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, color: pColor, textShadow: `0 0 10px ${pColor}`, fontSize: '1rem' }}>
                {playerNames[activePlayerIdx] || `Player ${activePlayerIdx+1}`}'s Turn
              </h2>
              <div className="player-status-strip">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={`player-dot ${p.id === activePlayerIdx ? 'active' : ''} ${p.status === 'lost' ? 'lost' : ''} ${p.status === 'won' ? 'won' : ''}`}
                    style={{ background: P_COLORS[p.id] }}
                    title={`${playerNames[p.id] || 'P'+(p.id+1)} — Tile ${p.position + 1} (${p.status})`}
                  />
                ))}
                <span className={`difficulty-badge ${difficulty}`} style={{ marginLeft: '0.4rem' }}>
                  {difficulty}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {/* Audio Controls */}
              <button
                className="icon-btn"
                title={muted ? 'Unmute' : 'Mute'}
                onClick={() => setMuted(m => !m)}
                style={{ fontSize: '1rem', padding: '0.3rem 0.5rem' }}
              >
                {muted ? '🔇' : '🔊'}
              </button>
              <input
                type="range" min={0} max={1} step={0.05}
                value={muted ? 0 : volume}
                onChange={e => { setMuted(false); setVolume(Number(e.target.value)); }}
                className="volume-slider"
                title="Volume"
              />
              <button
                className="neon-btn"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderColor: '#888', color: '#888' }}
                onClick={onExit}
              >
                Exit
              </button>
            </div>
          </div>

          {/* Timer Bar */}
          {timerEnabled && !isInitializing && (
            <div className="timer-bar-container">
              <div
                className={`timer-bar ${timeLeft <= 5 ? 'timer-urgent' : ''}`}
                style={{ width: `${(timeLeft / timerSeconds) * 100}%`, background: timeLeft <= 5 ? 'var(--neon-red)' : pColor }}
              />
              <span className={`timer-label ${timeLeft <= 5 ? 'timer-urgent-text' : ''}`}>{timeLeft}s</span>
            </div>
          )}

          <div className="dice-container" style={{ borderColor: pColor }}>
            <div
              className={`dice-value ${isRolling ? 'dice-rolling' : ''}`}
              style={{ color: pColor, textShadow: `0 0 20px ${pColor}` }}
            >
              {diceValue}
            </div>
            <button
              className="neon-btn"
              style={{ width: '100%', borderColor: pColor, color: pColor }}
              onClick={handleRoll}
              disabled={isRolling || isMoving || modalResult !== null}
            >
              {isRolling || isMoving
                ? 'COMPUTING...'
                : `COLLAPSE MOMENTUM`}
            </button>
          </div>

          {/* Bloch Radar + Probability */}
          <div style={{ marginTop: '0.5rem' }}>
            <h2
              className="glow-text-cyan"
              style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-tech)', letterSpacing: '2px', marginBottom: '1rem' }}
            >
              SUBJECT_0{activePlayerIdx + 1} // STATE_ANALYSIS
            </h2>

            <div className="bloch-area">
              <BlochRadar
                prob0={activeProbs[0]}
                prob1={activeProbs[1]}
                phase={activePhase}
                color={pColor}
              />
              <div className="prob-bars-vertical">
                <div className="state-row" style={{ borderLeftColor: pColor }}>
                  <span style={{ width: 30, fontFamily: 'monospace' }}>|0⟩</span>
                  <div className="prob-bar-container">
                    <div
                      className="prob-bar"
                      style={{
                        width: `${activeProbs[0] * 100}%`,
                        background: pColor,
                      }}
                    ></div>
                  </div>
                  <span style={{ width: 50, textAlign: 'right' }}>
                    {(activeProbs[0] * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="state-row" style={{ borderLeftColor: pColor }}>
                  <span style={{ width: 30, fontFamily: 'monospace' }}>|1⟩</span>
                  <div className="prob-bar-container">
                    <div
                      className="prob-bar"
                      style={{
                        width: `${activeProbs[1] * 100}%`,
                        background: pColor,
                      }}
                    ></div>
                  </div>
                  <span style={{ width: 50, textAlign: 'right' }}>
                    {(activeProbs[1] * 100).toFixed(0)}%
                  </span>
                </div>

                {isSuperposition && (
                  <p
                    style={{
                      color: 'var(--neon-magenta)',
                      fontSize: '0.8rem',
                      textAlign: 'center',
                      marginTop: '5px',
                    }}
                  >
                    ⚠ In Superposition
                  </p>
                )}
                {entanglementPairs.some(
                  ([a, b]) => a === activePlayerIdx || b === activePlayerIdx
                ) && (
                  <p
                    style={{
                      color: '#a200ff',
                      fontSize: '0.8rem',
                      textAlign: 'center',
                      marginTop: '2px',
                      fontWeight: 'bold',
                    }}
                  >
                    ⚡ ENTANGLED
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Gate Inventory */}
          <div className="inventory-section">
            <div
              className="inventory-header"
              onClick={() => setShowInventory(!showInventory)}
            >
              <h3 className="glow-text-gold" style={{ fontSize: '1rem', margin: 0 }}>
                Gate Inventory ({activePlayer.inventory.length}/{MAX_INVENTORY})
              </h3>
              <span className="inventory-toggle">{showInventory ? '▲' : '▼'}</span>
            </div>
            {showInventory && (
              <div className="inventory-grid">
                {activePlayer.inventory.length === 0 ? (
                  <p
                    style={{
                      color: '#666',
                      fontSize: '0.8rem',
                      textAlign: 'center',
                    }}
                  >
                    No gates collected yet. Land on gate tiles for a chance to pickup!
                  </p>
                ) : (
                  activePlayer.inventory.map((gate, idx) => (
                    <button
                      key={idx}
                      className={`inv-gate-btn badge-${gate}`}
                      onClick={() => useInventoryGate(idx)}
                      disabled={isRolling || isMoving || modalResult !== null}
                      title={`Apply ${gate}-Gate to yourself`}
                    >
                      {gate}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Fate Cards ── */}
          <div className="inventory-section">
            <div
              className="inventory-header"
              onClick={() => setShowFateCards(!showFateCards)}
            >
              <h3 className="glow-text-gold" style={{ fontSize: '1rem', margin: 0 }}>
                ✦ Fate Cards ({fateCards[activePlayerIdx].length}/3)
              </h3>
              <span className="inventory-toggle">{showFateCards ? '▲' : '▼'}</span>
            </div>
            {showFateCards && (
              <div style={{ padding: '0.5rem 0' }}>
                <button
                  className="neon-btn fate-draw-btn"
                  onClick={handleDrawFateCard}
                  disabled={isRolling || isMoving || modalResult !== null || fateCards[activePlayerIdx].length >= 3}
                  style={{ width: '100%', marginBottom: '0.5rem', borderColor: '#ffbe0b', color: '#ffbe0b', fontSize: '0.75rem', padding: '0.5rem' }}
                >
                  {fateCards[activePlayerIdx].length >= 3 ? 'Fate Card Limit Reached' : 'Draw a Fate Card'}
                </button>
                <div className="fate-cards-grid">
                  {fateCards[activePlayerIdx].length === 0 ? (
                    <p style={{ color: '#666', fontSize: '0.75rem', textAlign: 'center' }}>No fate cards. Draw one above!</p>
                  ) : (
                    fateCards[activePlayerIdx].map((card, idx) => (
                      <button
                        key={card.id}
                        className="fate-card-btn"
                        style={{ borderColor: card.color, '--card-color': card.color } as React.CSSProperties}
                        onClick={() => useFateCard(idx)}
                        disabled={isRolling || isMoving || modalResult !== null}
                        title={card.description}
                      >
                        <span className="fate-card-emoji">{card.emoji}</span>
                        <span className="fate-card-name" style={{ color: card.color }}>{card.name}</span>
                        <span className="fate-card-desc">{card.description}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Target Goal */}
          <div
            style={{
              background: 'rgba(0,0,0,0.2)',
              padding: '10px',
              borderRadius: '8px',
              marginTop: '0.5rem',
            }}
          >
            <h3
              className="glow-text-gold"
              style={{ fontSize: '1rem', margin: 0 }}
            >
              Target Goal
            </h3>
            <p
              style={{
                fontSize: '0.85rem',
                color: '#ccc',
                margin: '5px 0 0 0',
              }}
            >
              Reach Tile 100 in State <strong>|1⟩</strong>.
              <br />
              <span style={{ color: '#a200ff', fontSize: '0.75rem' }}>
                ⚡ Entangled players share fate — measuring one can collapse another!
              </span>
            </p>
          </div>

          {/* Event Log */}
          <div
            style={{
              background: 'rgba(0,0,0,0.2)',
              padding: '10px',
              borderRadius: '8px',
              flex: 1,
              overflowY: 'auto',
            }}
          >
            <h4
              style={{
                color: '#8b949e',
                fontSize: '0.9rem',
                marginBottom: '8px',
              }}
            >
              Event Log
            </h4>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                fontSize: '0.75rem',
                color: '#aaa',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              {history.map((log, i) => (
                <li
                  key={i}
                  dangerouslySetInnerHTML={{ __html: `&gt; ${log}` }}
                ></li>
              ))}
            </ul>
          </div>
        </div>

        {/* Gate Glossary */}
        <div className="glass-panel glossary-panel">
          <h3 className="glow-text-cyan">Quantum Glossary &amp; Gate Legend</h3>
          <div className="glossary-grid">
            <div className="glossary-item">
              <span className="gate-badge badge-X">X Gate</span>
              <p>
                <strong>Pauli-X (NOT):</strong> Performs a 180-degree flip. If you
                are 100% |0⟩, you become 100% |1⟩.
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-Y">Y Gate</span>
              <p>
                <strong>Pauli-Y (Imaginary Flip):</strong> Rotates through the
                imaginary axis, simultaneously flipping and shifting phase. A
                complex cousin of the X-Gate.
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-H">H Gate</span>
              <p>
                <strong>Hadamard (Superposition):</strong> Puts your token into a
                50/50 mix. Be careful, collisions trigger CNOT entanglement!
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-M">M Gate</span>
              <p>
                <strong>Measurement (Observer):</strong> Forces an instant
                Wavefunction Collapse, snapping you definitively to |0⟩ or |1⟩!
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-Z">Z Gate</span>
              <p>
                <strong>Pauli-Z (Phase):</strong> Flips the mathematical phase.
                Alters how future gates affect you.
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-S">S Gate</span>
              <p>
                <strong>Phase-S (π/2 Rotation):</strong> A fractional phase gate —
                rotates phase by 90°. Used in decoherence zones as environmental
                noise.
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-Wormhole">Wormhole</span>
              <p>
                <strong>Quantum Tunneling:</strong> Instantly teleports you across
                spacetime. Both shortcuts and traps exist!
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-CNOT">CNOT</span>
              <p>
                <strong>Entanglement (Collision):</strong> When two players land on
                the same tile, a CNOT gate fires. Your quantum fates become
                physically linked!
              </p>
            </div>
            <div className="glossary-item">
              <span className="gate-badge badge-Decohere">⚠ Decoherence</span>
              <p>
                <strong>Noise Zone (Tiles 41-61):</strong> Environmental quantum
                noise degrades your state. Random Z or S gates are applied as you
                pass through.
              </p>
            </div>
          </div>
        </div>

        {/* ── Live Scoreboard ── */}
        <div className="glass-panel scoreboard-panel">
          <h3 className="glow-text-cyan" style={{ marginBottom: '1rem' }}>Live Scoreboard</h3>
          <div className="scoreboard-rows">
            {players.map((p) => {
              const pProbs = partialTraceSingleQubit(globalState, p.id, numPlayers);
              const isActive = p.id === activePlayerIdx;
              const stats = playerStats[p.id];
              const isEnt = entanglementPairs.some(([a,b]) => a===p.id || b===p.id);
              return (
                <div
                  key={p.id}
                  className={`scoreboard-row ${isActive ? 'scoreboard-active' : ''} ${p.status === 'won' ? 'scoreboard-won' : ''} ${p.status === 'lost' ? 'scoreboard-lost' : ''}`}
                  style={{ borderLeftColor: P_COLORS[p.id] }}
                >
                  <div className="scoreboard-player-id" style={{ color: P_COLORS[p.id] }}>
                    {playerNames[p.id] || `P${p.id+1}`}
                    {shielded[p.id] && <span title="Shielded"> 🛡</span>}
                    {isEnt && <span title="Entangled"> ⚡</span>}
                    {p.status === 'won' && <span> ✓</span>}
                    {p.status === 'lost' && <span> ✗</span>}
                  </div>
                  <div className="scoreboard-tile">Tile <strong>{p.position + 1}</strong></div>
                  <div className="scoreboard-state">
                    <span style={{ color: 'var(--neon-cyan)', fontSize: '0.7rem' }}>|0⟩{(pProbs[0]*100).toFixed(0)}%</span>
                    {' / '}
                    <span style={{ color: P_COLORS[p.id], fontSize: '0.7rem' }}>|1⟩{(pProbs[1]*100).toFixed(0)}%</span>
                  </div>
                  <div className="scoreboard-stats">
                    🎲{stats.rolls} 🔬{stats.gatesHit} 🌀{stats.wormholes} ✦{stats.cardsUsed}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SVG Arc Path Helper for Bloch Radar ──
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

export default Game;

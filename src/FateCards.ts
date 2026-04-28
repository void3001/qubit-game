// ── Quantum Fate Cards ──
// Special one-use power cards players can draw during their turn.

export type FateCardType =
  | 'TELEPORT'
  | 'SHIELD'
  | 'QUANTUM_SWAP'
  | 'EXTRA_ROLL'
  | 'DECOHERE_IMMUNITY'
  | 'COLLAPSE_ENEMY';

export type FateCard = {
  id: string;
  type: FateCardType;
  name: string;
  description: string;
  color: string;
  emoji: string;
};

const CARD_TEMPLATES: Omit<FateCard, 'id'>[] = [
  {
    type: 'TELEPORT',
    name: 'Quantum Tunnel',
    description: 'Jump forward 1–10 tiles instantly!',
    color: '#00d1ff',
    emoji: '🌀',
  },
  {
    type: 'SHIELD',
    name: 'Coherence Shield',
    description: 'Protect your qubit from the next gate or decoherence event.',
    color: '#39ff14',
    emoji: '🛡',
  },
  {
    type: 'QUANTUM_SWAP',
    name: 'State Swap',
    description: 'Swap your board position with any other active player.',
    color: '#ff00ff',
    emoji: '⚡',
  },
  {
    type: 'EXTRA_ROLL',
    name: 'Superposition Roll',
    description: 'Roll again immediately after your current move resolves.',
    color: '#ffbe0b',
    emoji: '🎲',
  },
  {
    type: 'DECOHERE_IMMUNITY',
    name: 'Isolation Protocol',
    description: 'Pass through the Decoherence Zone unaffected this turn.',
    color: '#ff5e00',
    emoji: '🔬',
  },
  {
    type: 'COLLAPSE_ENEMY',
    name: 'Observer Effect',
    description: 'Force an opponent to immediately measure their qubit!',
    color: '#ff3e3e',
    emoji: '👁',
  },
];

export const drawRandomCard = (): FateCard => {
  const template = CARD_TEMPLATES[Math.floor(Math.random() * CARD_TEMPLATES.length)];
  return {
    ...template,
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
};

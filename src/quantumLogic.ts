// ── Quantum Logic Engine v2.0 ──
// Full complex-number quantum simulation with global N-qubit state support.

export type ComplexObj = { r: number; i: number };
export type Vector = ComplexObj[]; // Size 2^n

// ── Complex Arithmetic ──

export const cZero: ComplexObj = { r: 0, i: 0 };
export const cOne: ComplexObj = { r: 1, i: 0 };

export const cAdd = (a: ComplexObj, b: ComplexObj): ComplexObj => ({
  r: a.r + b.r,
  i: a.i + b.i,
});
export const cSub = (a: ComplexObj, b: ComplexObj): ComplexObj => ({
  r: a.r - b.r,
  i: a.i - b.i,
});
export const cMul = (a: ComplexObj, b: ComplexObj): ComplexObj => ({
  r: a.r * b.r - a.i * b.i,
  i: a.r * b.i + a.i * b.r,
});
export const cMag2 = (a: ComplexObj): number => a.r * a.r + a.i * a.i;
export const cMag = (a: ComplexObj): number => Math.sqrt(cMag2(a));
export const cPhase = (a: ComplexObj): number => Math.atan2(a.i, a.r);
export const cScale = (a: ComplexObj, s: number): ComplexObj => ({
  r: a.r * s,
  i: a.i * s,
});

// ── State Creation ──

/** Create |00...0⟩ state vector for `n` qubits */
export const createInitialState = (numQubits: number): Vector => {
  const size = Math.pow(2, numQubits);
  const state: Vector = Array.from({ length: size }, () => ({ ...cZero }));
  state[0] = { ...cOne };
  return state;
};

// ── Single-Qubit Gate Application ──

export const applySingleQubitGate = (
  state: Vector,
  gateMatrix: ComplexObj[][],
  targetQubit: number,
  numQubits: number
): Vector => {
  const size = Math.pow(2, numQubits);
  const newState: Vector = Array.from({ length: size }, () => ({ ...cZero }));

  for (let i = 0; i < size; i++) {
    const bitVal = (i >> targetQubit) & 1;
    const flippedIdx = i ^ (1 << targetQubit);

    if (bitVal === 0) {
      newState[i] = cAdd(
        cMul(gateMatrix[0][0], state[i]),
        cMul(gateMatrix[0][1], state[flippedIdx])
      );
      newState[flippedIdx] = cAdd(
        cMul(gateMatrix[1][0], state[i]),
        cMul(gateMatrix[1][1], state[flippedIdx])
      );
    }
  }
  return newState;
};

// ── Two-Qubit Gate: CNOT (Controlled-X) ──

export const applyCXGate = (
  state: Vector,
  controlQubit: number,
  targetQubit: number,
  numQubits: number
): Vector => {
  const size = Math.pow(2, numQubits);
  const newState: Vector = state.map((s) => ({ ...s }));

  for (let i = 0; i < size; i++) {
    const isControl1 = ((i >> controlQubit) & 1) === 1;
    if (isControl1) {
      const bitValTarget = (i >> targetQubit) & 1;
      if (bitValTarget === 0) {
        const flippedIdx = i ^ (1 << targetQubit);
        const temp = { ...newState[i] };
        newState[i] = { ...newState[flippedIdx] };
        newState[flippedIdx] = temp;
      }
    }
  }
  return newState;
};

// ── Two-Qubit Gate: SWAP ──

export const applySwapGate = (
  state: Vector,
  qubitA: number,
  qubitB: number,
  numQubits: number
): Vector => {
  const size = Math.pow(2, numQubits);
  const newState: Vector = state.map((s) => ({ ...s }));

  for (let i = 0; i < size; i++) {
    const bitA = (i >> qubitA) & 1;
    const bitB = (i >> qubitB) & 1;
    if (bitA !== bitB) {
      const swappedIdx = i ^ (1 << qubitA) ^ (1 << qubitB);
      if (i < swappedIdx) {
        const temp = { ...newState[i] };
        newState[i] = { ...newState[swappedIdx] };
        newState[swappedIdx] = temp;
      }
    }
  }
  return newState;
};

// ── Gate Constants ──

const INV_SQRT2 = 1 / Math.sqrt(2);

export const GATES: Record<string, ComplexObj[][]> = {
  H: [
    [{ r: INV_SQRT2, i: 0 }, { r: INV_SQRT2, i: 0 }],
    [{ r: INV_SQRT2, i: 0 }, { r: -INV_SQRT2, i: 0 }],
  ],
  X: [
    [{ r: 0, i: 0 }, { r: 1, i: 0 }],
    [{ r: 1, i: 0 }, { r: 0, i: 0 }],
  ],
  Y: [
    [{ r: 0, i: 0 }, { r: 0, i: -1 }],
    [{ r: 0, i: 1 }, { r: 0, i: 0 }],
  ],
  Z: [
    [{ r: 1, i: 0 }, { r: 0, i: 0 }],
    [{ r: 0, i: 0 }, { r: -1, i: 0 }],
  ],
  S: [
    [{ r: 1, i: 0 }, { r: 0, i: 0 }],
    [{ r: 0, i: 0 }, { r: 0, i: 1 }],
  ],
  T: [
    [{ r: 1, i: 0 }, { r: 0, i: 0 }],
    [{ r: 0, i: 0 }, { r: INV_SQRT2, i: INV_SQRT2 }],
  ],
};

// ── Probability Helpers ──

/** Get full probability vector from state */
export const getProbabilities = (state: Vector): number[] => {
  return state.map((amp) => {
    const prob = cMag2(amp);
    return Math.round(prob * 10000) / 10000;
  });
};

/**
 * Partial trace: extract the reduced density-diagonal (probabilities) for a
 * single qubit out of an N-qubit global state.
 *
 * Returns [P(|0⟩), P(|1⟩)] for the requested qubit index.
 */
export const partialTraceSingleQubit = (
  globalState: Vector,
  qubitIndex: number,
  numQubits: number
): [number, number] => {
  const size = Math.pow(2, numQubits);
  let p0 = 0;
  let p1 = 0;

  for (let i = 0; i < size; i++) {
    const prob = cMag2(globalState[i]);
    if (((i >> qubitIndex) & 1) === 0) {
      p0 += prob;
    } else {
      p1 += prob;
    }
  }

  return [
    Math.round(p0 * 10000) / 10000,
    Math.round(p1 * 10000) / 10000,
  ];
};

/**
 * Get the effective phase of a qubit from the global state.
 * Uses partial-trace weighted average of phases for Bloch radar.
 */
export const getQubitPhase = (
  globalState: Vector,
  qubitIndex: number,
  numQubits: number
): number => {
  const size = Math.pow(2, numQubits);
  let weightedPhase0 = 0;
  let weightedPhase1 = 0;
  let totalWeight0 = 0;
  let totalWeight1 = 0;

  for (let i = 0; i < size; i++) {
    const amp = globalState[i];
    const mag = cMag2(amp);
    if (mag < 1e-10) continue;
    const phase = cPhase(amp);

    if (((i >> qubitIndex) & 1) === 0) {
      weightedPhase0 += phase * mag;
      totalWeight0 += mag;
    } else {
      weightedPhase1 += phase * mag;
      totalWeight1 += mag;
    }
  }

  const ph0 = totalWeight0 > 1e-10 ? weightedPhase0 / totalWeight0 : 0;
  const ph1 = totalWeight1 > 1e-10 ? weightedPhase1 / totalWeight1 : 0;
  return ph1 - ph0;
};

/**
 * Measure a specific qubit in the global state.
 * Collapses the full wavefunction and renormalizes.
 * Returns { result: 0|1, newState: Vector }
 */
export const measureQubit = (
  globalState: Vector,
  qubitIndex: number,
  numQubits: number
): { result: number; newState: Vector } => {
  const [p0] = partialTraceSingleQubit(globalState, qubitIndex, numQubits);
  const rand = Math.random();
  const result = rand >= p0 ? 1 : 0;

  const size = Math.pow(2, numQubits);
  const newState: Vector = Array.from({ length: size }, () => ({ ...cZero }));

  let normFactor = 0;
  for (let i = 0; i < size; i++) {
    const bitVal = (i >> qubitIndex) & 1;
    if (bitVal === result) {
      newState[i] = { ...globalState[i] };
      normFactor += cMag2(globalState[i]);
    }
  }

  // Renormalize
  const norm = Math.sqrt(normFactor);
  if (norm > 1e-10) {
    for (let i = 0; i < size; i++) {
      newState[i] = cScale(newState[i], 1 / norm);
    }
  }

  return { result, newState };
};

/**
 * Check if two qubits are entangled by checking if the joint distribution
 * factors into the product of marginals.
 */
export const areEntangled = (
  globalState: Vector,
  qubitA: number,
  qubitB: number,
  numQubits: number
): boolean => {
  const size = Math.pow(2, numQubits);
  const [pA0, pA1] = partialTraceSingleQubit(globalState, qubitA, numQubits);
  const [pB0, pB1] = partialTraceSingleQubit(globalState, qubitB, numQubits);

  // Compute joint probabilities P(a,b)
  let p00 = 0, p01 = 0, p10 = 0, p11 = 0;
  for (let i = 0; i < size; i++) {
    const prob = cMag2(globalState[i]);
    const bitA = (i >> qubitA) & 1;
    const bitB = (i >> qubitB) & 1;
    if (bitA === 0 && bitB === 0) p00 += prob;
    else if (bitA === 0 && bitB === 1) p01 += prob;
    else if (bitA === 1 && bitB === 0) p10 += prob;
    else p11 += prob;
  }

  // Check if P(a,b) ≈ P(a)*P(b) for all combos
  const eps = 0.02;
  if (Math.abs(p00 - pA0 * pB0) > eps) return true;
  if (Math.abs(p01 - pA0 * pB1) > eps) return true;
  if (Math.abs(p10 - pA1 * pB0) > eps) return true;
  if (Math.abs(p11 - pA1 * pB1) > eps) return true;

  return false;
};

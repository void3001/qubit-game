# Quantum Track: Technical & Scientific Explanation

**Quantum Track** (subtitled *Schrödinger's Race*) is a high-fidelity quantum simulation board game built with React and TypeScript. Unlike traditional "Snakes and Ladders," every movement and interaction in this game is dictated by the actual laws of quantum mechanics, simulated in real-time.

---

## 1. The High-Level Concept
In Quantum Track, you don't just move a piece on a board; you are a **Qubit**. Your "position" on the board is your physical location, but your "existence" is defined by a probability cloud (quantum state). 

- **Winning** isn't just about reaching the end; it's about reaching the end in the correct quantum state.
- **Interactions** aren't just bumping into players; they are quantum operations like **Entanglement**.

---

## 2. The Quantum Logic Engine (`quantumLogic.ts`)
The game is powered by a custom-built N-qubit simulation engine. It doesn't use simplified logic; it performs full complex-number matrix multiplication.

### State Representation
The game maintains a **Global State Vector**. For $n$ players, the universe exists in a $2^n$ dimensional space.
- If there are 2 players, the possible states are $|00\rangle, |01\rangle, |10\rangle, |11\rangle$.
- The engine tracks **Complex Amplitudes** ($a + bi$) for every possible combination.

### Complex Arithmetic
Since quantum mechanics relies on wave-like interference, the engine handles:
- **Phase**: The rotation of the qubit state.
- **Magnitude**: The probability of collapsing into a specific state.
- **Superposition**: Being in both $|0\rangle$ and $|1\rangle$ simultaneously.

---

## 3. Game Mechanics

### The Binary Dice (Momentum)
Instead of standard dice, players roll "Quantum Bits".
- **3-Bit (Easy)**: Rolls from `000` (0) to `111` (7).
- **4-Bit (Normal/Hard)**: Rolls from `0000` (0) to `1111` (15).
This represents the "quantization" of momentum.

### Quantum Gates (Board Tiles)
When a player lands on a gate tile, a mathematical operation is applied to their specific qubit within the global state:

| Gate | Name | Effect |
| :--- | :--- | :--- |
| **H** | Hadamard | The "Superposition Gate." It turns a stable $|0\rangle$ or $|1\rangle$ into a 50/50 coin flip. |
| **X** | Pauli-X | The "Quantum NOT Gate." Flips $|0\rangle \to |1\rangle$ and $|1\rangle \to |0\rangle$. |
| **Z** | Pauli-Z | Phase flip. It doesn't change probabilities, but changes how the qubit interacts with others. |
| **M** | Measurement | Forces the qubit to "choose" a state immediately. |

### Entanglement (CNOT Collisions)
This is the game's most advanced mechanic. If two players land on the **same tile**, they become **Entangled**.
- The engine applies a **CNOT (Controlled-NOT)** gate.
- One player becomes the "Control" and the other the "Target."
- Their fates are now mathematically linked. What happens to Player A will instantaneously affect Player B, no matter how far apart they move afterwards.

### Decoherence Zones
These represent external environmental noise. In these regions, a player's qubit undergoes random rotations (Z or S gates). This simulates "Quantum Noise," making it harder to maintain a winning state.

---

## 4. The Finish Line: Measurement
The final tile is the **Core Logic**. To win, you must successfully pass a **Measurement Test**.

1. When you reach Tile 100, the game measures your qubit.
2. **If you collapse into $|1\rangle$:** You Win!
3. **If you collapse into $|0\rangle$:** You Lose/Eliminate.

**The Entanglement Cascade:** If you are entangled with another player, your measurement might force *them* to collapse as well. If you win and you're linked to a teammate, you might accidentally pull them into a losing state (or vice-versa).

---

## 5. Visualizing the Invisible: The Bloch Radar
Since human brains can't easily visualize $2^n$ dimensional complex vectors, the game provides a **Bloch Radar** for each player:
- **The Vector**: Projection of the qubit on the Bloch Sphere.
- **The Dot**: High dot = $|0\rangle$ bias, Low dot = $|1\rangle$ bias.
- **The Glow**: Represents the degree of superposition.
- **Tethers**: Glowing lines between players indicate active Entanglement.

---

## 6. Technical Stack
- **Framework**: `React 18` + `Vite`
- **Language**: `TypeScript` (Strict typing for complex math objects)
- **Styling**: Vanilla CSS with **Glassmorphism** and **Neon** aesthetics.
- **Performance**: The state vector calculations are optimized to run at 60fps, even with multiple players entangled.
- **Audio**: A custom `audio.ts` triggers unique synthesizer sounds for gate applications and state collapses.

---

### Summary
Quantum Track is more than a game; it's a **playable laboratory**. By playing, you naturally learn how Hadamard gates create superposition, how CNOT gates create entanglement, and how measurement destroys quantum uncertainty.

# Zombie Army Shooter – React Re-render Optimization

## Current State

The game loop runs via `requestAnimationFrame` referencing a stale closure (`update`). Game state is stored in a `useRef` (`gameStateRef`) and mutated directly each frame for performance. When UI-visible fields change, `setGameState({ ...newState })` is called to push updates to React.

Two known re-render problems:

1. **Level transition re-renders every frame**: Inside `update()`, the branch `if (newState.isLevelTransition)` calls `setGameState(newState)` unconditionally with no snapshot check, causing a full React re-render at 60fps for the entire duration of every level transition.

2. **`gameStateRef.current = gameState` useEffect clobbers game state**: After every `setGameState` call, this effect replaces `gameStateRef.current` with the React state snapshot. Because the game loop continues mutating the ref between the `setGameState` call and the effect running, this overwrites in-progress mutations.

3. **Entire 2935-line App component re-renders on each `setGameState`**: The full JSX tree (header stats, canvas overlay, all buttons, motion components) is re-evaluated even when only score changed.

## Requested Changes (Diff)

### Add
- Separate `UiState` interface with only the fields the JSX actually reads: `score`, `health`, `armySize`, `weaponLevel`, `bulletDamage`, `activeSpecial`, `specialTimer`, `isGameOver`, `isVictory`, `isLevelTransition`, `isStarted`, `level`, `levelTimer`, `shootMode`, `isAutoShoot`
- `extractUiState(gs: GameState): UiState` helper function
- `GameHeader` React.memo component — renders header stats row and mode/board/landscape buttons. Props: all header-visible UiState fields + callbacks.
- `CanvasHUD` React.memo component — renders the health bar, special timer bar, and stat line below (Health / Damage / Fire Rate). Props: health, specialTimer, activeSpecial, bulletDamage, weaponLevel.

### Modify
- Replace `const [gameState, setGameState] = useState<GameState>` with `const [uiState, setUiState] = useState<UiState>`
- All JSX reads `uiState.*` instead of `gameState.*`
- The `update()` function's level-transition branch: apply the same snapshot check used in the normal gameplay path, then call `renderFrame()`, then schedule next rAF. No `setUiState` unless snapshot fields changed.
- The `update()` function's normal path: replace `setGameState({ ...newState })` with `setUiState(extractUiState(newState))`. Remove `{ ...newState }` spread — just pass the snapshot.
- Remove the `useEffect(() => { gameStateRef.current = gameState; }, [gameState])` effect entirely. The ref is now authoritative and never overwritten by React.
- `handleStartGame`: set `gameStateRef.current = makeInitialState(true, isLandscapeRef.current)` directly, then call `setUiState(extractUiState(gameStateRef.current))`.
- `startNextLevel`: mutate `gameStateRef.current` directly (level, levelTimer, entities, etc.), then call `setUiState(extractUiState(gameStateRef.current))`.
- Shoot mode / auto-shoot button handlers: write to `gameStateRef.current.shootMode` / `gameStateRef.current.isAutoShoot` directly, then call `setUiState(prev => ({...prev, shootMode: ...}))` or similar.
- The `useEffect` that starts the rAF loop: depends on `uiState.isStarted` and `uiState.isGameOver` (same semantics as before).
- The `uiSnapshotRef` fields should now also include `specialTimer` (needed by CanvasHUD) and `level`/`levelTimer`/`shootMode`/`isAutoShoot` (needed by GameHeader) so those panels re-render when their data changes.

### Remove
- `useEffect(() => { gameStateRef.current = gameState; }, [gameState])` — removed entirely.
- The unconditional `setGameState(newState)` in the level-transition branch of `update()`.

## Implementation Plan

1. Define `UiState` interface and `extractUiState` helper near the top of App.tsx.
2. Replace `useState<GameState>` with `useState<UiState>` initialized from `extractUiState(makeInitialState(false))`.
3. Remove the `gameStateRef.current = gameState` useEffect.
4. Update `handleStartGame` and `startNextLevel` to write directly to `gameStateRef.current` and call `setUiState`.
5. Update shoot mode / auto-shoot button handlers.
6. Fix the `update()` level-transition branch: add snapshot check, add `renderFrame()`, use `setUiState`.
7. Update the `update()` normal path snapshot check to use `setUiState(extractUiState(newState))`.
8. Update the rAF `useEffect` deps to use `uiState.isStarted` / `uiState.isGameOver`.
9. Extract `GameHeader` as a `React.memo` component above the App function. Receives all header props as primitives + stable callbacks (use `useCallback` for the callbacks passed to it).
10. Extract `CanvasHUD` as a `React.memo` component. Receives health, specialTimer, activeSpecial, bulletDamage, weaponLevel.
11. Replace the header section and canvas HUD section in the JSX with `<GameHeader .../>` and `<CanvasHUD .../>`.
12. Verify all JSX reads from `uiState` not `gameState`.
13. Run lint + typecheck + build and fix all errors.

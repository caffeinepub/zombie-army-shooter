# Zombie Army Shooter

## Current State
App.tsx is a ~2900 line React/Canvas game. The game loop runs via `requestAnimationFrame` calling `update()`. Every frame:
- `const newState = {...state}` creates a shallow copy of the full game state
- Entities are rebuilt with `.map(x => ({...x, ...}))` (heavy allocations)
- `getArmyPositions()` is called 8 times (expensive trig per soldier)
- `setGameState(newState)` is called, triggering a full React re-render 60x/second

This causes severe lag at high fire rates with explosive bullets.

## Requested Changes (Diff)

### Add
- A `uiStateRef` to track a lightweight UI snapshot (score, health, armySize, weaponLevel, activeSpecial, specialTimer, isGameOver, isVictory, isLevelTransition, isStarted) — only sync React state from this
- A `frameArmyPositionsRef` to cache `getArmyPositions()` result once per frame

### Modify
- Game loop: mutate `gameStateRef.current` directly (in-place object mutations) instead of shallow-copying the whole state each frame
- React state (`setGameState`) should only be called when: (a) the game is over/won, (b) level transition triggers, (c) health changes, (d) armySize changes, (e) score changes significantly — not every single frame. Best approach: call `setGameState` only when UI-visible fields change, checked with a lightweight comparison at end of each frame
- `getArmyPositions()` must be called exactly once per frame at the top of `update()`, result stored in a local `const armyPositions` variable, all 8 call sites replaced with this cached result
- Entity updates: mutate z.x, z.y, z.health, b.x, b.y etc. directly instead of `map(z => ({...z, ...}))`; use `filter()` only for removal (unavoidable)
- Keep max fire rate (weaponLevel: 15) and EXPLOSIVE always active (specialTimer: 9999999, activeSpecial: 'EXPLOSIVE') for this test draft

### Remove
- The per-frame `const newState = {...state}` shallow copy pattern
- Redundant `getArmyPositions()` calls (currently 8 per frame, reduce to 1)

## Implementation Plan
1. Change `update()` to work on `gameStateRef.current` directly (no shallow copy)
2. Compute `armyPositions` once at the start of each `update()` call and reuse everywhere
3. Replace `.map(z => ({...z, x: z.x + ..., y: z.y + ...}))` patterns with for-loops that mutate in place, keeping `.filter()` for removals
4. Add a UI sync check: compare key fields after update, only call `setGameState` if they changed
5. Keep test mode (weaponLevel=15, EXPLOSIVE always on)
6. Validate and deploy as draft

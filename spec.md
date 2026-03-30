# Zombie Army Shooter

## Current State
Fully client-side React/Canvas zombie shooter game running on-chain. Backend is empty (no APIs). No leaderboard exists.

## Requested Changes (Diff)

### Add
- On-chain high-score leaderboard: stores top scores (player name + score)
- After game over, prompt user to enter name and submit score
- Leaderboard panel visible in-game (e.g. sidebar or modal) showing top 10 scores

### Modify
- Game over screen: add name input + submit button to save score
- Main game UI: add a button or panel to view leaderboard

### Remove
- Nothing removed

## Implementation Plan
1. Backend: add `submitScore(name: Text, score: Nat)` and `getTopScores(): [(Text, Nat)]` Motoko functions
2. Frontend: wire backend calls after game over (submit score) and on leaderboard view (fetch scores)
3. Display leaderboard as a top-10 table overlay or sidebar

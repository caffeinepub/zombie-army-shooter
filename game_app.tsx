import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, MousePointer2, Play, RotateCcw, Shield, Swords, Target, Trophy, User, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Constants ---
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const PLAYER_Y = CANVAS_HEIGHT - 80;
const UNIT_RADIUS = 8; // Smaller, uniform size
const BULLET_SPEED = 7;
const ZOMBIE_SPEED_BASE = 1.0;
const GATE_SPEED = 1.5;
const SPAWN_RATE_ZOMBIE = 60; // More frequent base spawn
const SPAWN_RATE_GATE = 300; // frames
const MAX_ARMY_SIZE = 75;

const PLAYER_SPEED = 4;

// Helper to get army unit positions
const getArmyPositions = (playerX: number, armySize: number) => {
  const positions: { x: number; y: number }[] = [];
  const spacing = 12; // More compact spacing
  
  for (let i = 0; i < armySize; i++) {
    if (i === 0) {
      // Main unit at the center
      positions.push({ x: playerX, y: PLAYER_Y });
      continue;
    }
    
    // Fermat's spiral (Golden Angle) for circular distribution
    const angle = i * 137.508 * (Math.PI / 180);
    const radius = Math.sqrt(i) * spacing;
    
    const offsetX = Math.cos(angle) * radius;
    const offsetY = Math.sin(angle) * radius;
    
    positions.push({ x: playerX + offsetX, y: PLAYER_Y + offsetY });
  }
  return positions;
};

type GateType = 'ADD' | 'SUB' | 'MULT' | 'DIV' | 'SPECIAL' | 'TRAP' | 'UPGRADE' | 'RATE_UPGRADE';

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  specialType: 'NONE' | 'CURVED' | 'EXPLOSIVE';
  life: number;
  id: number;
  hitGateIds?: number[];
}

interface Zombie {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  speed: number;
  radius: number;
  type: 'NORMAL' | 'TANK' | 'BOSS_RANGED' | 'BOSS_GIANT';
  id: number;
  shootTimer?: number;
  attackAnimTimer?: number; // Frames remaining for attack animation
}

interface ZombieBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  id: number;
  health: number;
  maxHealth: number;
}

interface Gate {
  x: number;
  y: number;
  type: GateType;
  value: number;
  id: number;
  width: number;
  pairId?: number;
  hitProgress?: number;
  trapPenaltyTaken?: number;
}

interface Explosion {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  id: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number; // 0 to 1
  id: number;
}

interface DyingSoldier {
  x: number;
  y: number;
  angle: number;
  life: number; // in frames
  id: number;
}

interface SpawnFlash {
  index: number;
  life: number; // in frames
}

interface GameState {
  playerX: number;
  smoothPlayerX?: number;
  health: number;
  armySize: number;
  weaponLevel: number;
  score: number;
  level: number;
  levelTimer: number; // in frames
  levelUpTimer: number; // in frames
  bullets: Bullet[];
  zombies: Zombie[];
  zombieBullets: ZombieBullet[];
  gates: Gate[];
  explosions: Explosion[];
  floatingTexts: FloatingText[];
  dyingSoldiers: DyingSoldier[];
  spawnFlashes: SpawnFlash[];
  frame: number;
  specialTimer: number; // in frames
  activeSpecial: 'NONE' | 'CURVED' | 'EXPLOSIVE';
  bulletDamage: number;
  isGameOver: boolean;
  isStarted: boolean;
  isVictory: boolean;
  isLevelTransition: boolean;
  flashTimer: number;
  hitFlashTimer: number; // Frames remaining for player hit flash
  shootMode: 'AIM' | 'STRAIGHT';
  isAutoShoot: boolean;
}

// --- Rendering Helpers ---
const drawSoldier = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, isMain: boolean, weaponLevel: number, hitFlashTimer: number = 0, spawnFlashTimer: number = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Set glow if needed for silhouette
  if (hitFlashTimer > 0) {
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ef4444';
  } else if (spawnFlashTimer > 0) {
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#22c55e';
  }

  // Body (Camo/Uniform)
  let bodyColor = isMain ? '#1e3a8a' : '#3b82f6';
  if (hitFlashTimer > 0) {
    bodyColor = '#ef4444'; // Flash red when hit
  } else if (spawnFlashTimer > 0) {
    bodyColor = '#22c55e'; // Flash green when spawned
  }
  
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(-8, -10, 16, 20, 4);
  ctx.fill();
  
  // Tactical Vest
  ctx.fillStyle = hitFlashTimer > 0 ? '#7f1d1d' : (spawnFlashTimer > 0 ? '#14532d' : '#1e293b');
  ctx.fillRect(-6, -6, 12, 12);
  
  // Helmet
  ctx.fillStyle = hitFlashTimer > 0 ? '#991b1b' : (spawnFlashTimer > 0 ? '#166534' : '#0f172a');
  ctx.beginPath();
  ctx.arc(0, -2, 7, 0, Math.PI * 2);
  ctx.fill();
  
  // Reset shadow for gun and arms
  ctx.shadowBlur = 0;
  
  // Gun Logic
  ctx.fillStyle = '#000';
  if (weaponLevel < 4) {
    // Tier 1: Pistol/SMG
    ctx.fillRect(4, -2, 8, 3); // Barrel
    ctx.fillRect(4, 0, 3, 4);  // Grip
  } else if (weaponLevel < 8) {
    // Tier 2: Assault Rifle
    ctx.fillRect(4, -3, 16, 4); // Barrel
    ctx.fillRect(4, -1, 4, 6);  // Grip
    ctx.fillStyle = '#333';
    ctx.fillRect(8, -5, 6, 3);  // Scope
  } else if (weaponLevel < 13) {
    // Tier 3: Heavy Machine Gun
    ctx.fillStyle = '#111';
    ctx.fillRect(4, -4, 18, 6); // Thick Barrel
    ctx.fillRect(4, 0, 5, 8);   // Grip
    ctx.fillStyle = '#444';
    ctx.fillRect(10, 2, 6, 6);  // Drum Mag
  } else if (weaponLevel < 20) {
    // Tier 4: Plasma Rifle
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(4, -5, 20, 8); // Bulk Body
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(8, -3, 14, 4); // Energy Core
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#3b82f6';
    ctx.strokeRect(8, -3, 14, 4);
    ctx.shadowBlur = 0;
  } else {
    // Tier 5: Railgun
    ctx.fillStyle = '#000';
    ctx.fillRect(4, -6, 24, 10); // Massive Body
    ctx.fillStyle = '#facc15';
    ctx.fillRect(6, -2, 20, 2);  // Rail 1
    ctx.fillRect(6, 2, 20, 2);   // Rail 2
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#facc15';
    ctx.fillRect(22, -4, 4, 8);  // Muzzle Flash Point
    ctx.shadowBlur = 0;
  }
  
  // Arms
  ctx.strokeStyle = isMain ? '#1e3a8a' : '#3b82f6';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6, -4);
  ctx.lineTo(12, -2);
  ctx.stroke();

  ctx.restore();
};

const drawZombie = (ctx: CanvasRenderingContext2D, x: number, y: number, type: string, radius: number, frame: number, attackAnimTimer: number = 0) => {
  ctx.save();
  
  // Lunge effect when attacking
  const lunge = attackAnimTimer > 0 ? (10 - attackAnimTimer) * 2 : 0;
  ctx.translate(x, y + lunge);
  
  // Swaying animation
  const sway = Math.sin(frame * 0.1) * 0.1;
  ctx.rotate(sway);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.5, radius * 1.2, radius * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (Tattered clothes)
  let bodyColor = '#166534'; // Dark green
  let skinColor = '#4ade80'; // Pale green
  
  if (type === 'TANK') {
    bodyColor = '#064e3b';
    skinColor = '#10b981';
  } else if (type.startsWith('BOSS')) {
    bodyColor = '#4c1d95';
    skinColor = '#a78bfa';
  }

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(-radius * 0.8, -radius, radius * 1.6, radius * 2, 4);
  ctx.fill();
  
  // Torn parts
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(-radius * 0.4, 0, radius * 0.2, radius * 0.5);
  
  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  // Biting animation: head moves down slightly
  const biteOffset = attackAnimTimer > 0 ? Math.sin(attackAnimTimer * 0.5) * 4 : 0;
  ctx.arc(0, -radius * 0.6 + biteOffset, radius * 0.8, 0, Math.PI * 2);
  ctx.fill();
  
  // Eyes (Glowing Red)
  ctx.shadowBlur = 5;
  ctx.shadowColor = '#ef4444';
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.7 + biteOffset, 2.5, 0, Math.PI * 2);
  ctx.arc(radius * 0.3, -radius * 0.7 + biteOffset, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  // Mouth (Gaping/Biting)
  ctx.fillStyle = '#000';
  ctx.beginPath();
  // Mouth opens wider when biting
  const mouthScale = attackAnimTimer > 0 ? 1.5 : 1;
  ctx.ellipse(0, -radius * 0.3 + biteOffset, radius * 0.3 * mouthScale, radius * 0.2 * mouthScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Arms (Reaching out)
  ctx.fillStyle = skinColor;
  const armLength = radius * 1.2;
  const armSway = Math.sin(frame * 0.15) * 5;
  
  // Extend arms more when attacking
  const attackReach = attackAnimTimer > 0 ? 10 : 0;
  ctx.fillRect(-radius * 1.1, -radius * 0.2 + armSway + attackReach, radius * 0.5, radius * 0.4);
  ctx.fillRect(radius * 0.6, -radius * 0.2 - armSway + attackReach, radius * 0.5, radius * 0.4);

  // Add a "slash" effect if attacking
  if (attackAnimTimer > 5) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.5, radius);
    ctx.lineTo(radius * 1.5, radius + 10);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(radius * 1.5, radius);
    ctx.lineTo(-radius * 1.5, radius + 10);
    ctx.stroke();
  }

  ctx.restore();
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    playerX: CANVAS_WIDTH / 2,
    health: 100,
    armySize: 1,
    weaponLevel: 1,
    score: 0,
    level: 1,
    levelTimer: 60 * 60,
    levelUpTimer: 0,
    bullets: [],
    zombies: [],
    zombieBullets: [],
    gates: [],
    explosions: [],
    floatingTexts: [],
    dyingSoldiers: [],
    spawnFlashes: [],
    frame: 0,
    specialTimer: 0,
    activeSpecial: 'NONE',
    bulletDamage: 1,
    isGameOver: false,
    isStarted: false,
    isVictory: false,
    isLevelTransition: false,
    flashTimer: 0,
    hitFlashTimer: 0,
    shootMode: 'AIM',
    isAutoShoot: false,
  });

  const requestRef = useRef<number>(null);
  const gameStateRef = useRef<GameState>(gameState);
  const isSpacePressed = useRef(false);
  const isPointerDown = useRef(false);
  const isAKeyPressed = useRef(false);
  const isDKeyPressed = useRef(false);
  const mousePosRef = useRef({ x: CANVAS_WIDTH / 2, y: 0 });

  // Sync ref with state for the game loop
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed.current = true;
        e.preventDefault();
      }
      if (e.key.toLowerCase() === 'a') {
        isAKeyPressed.current = true;
      }
      if (e.key.toLowerCase() === 'd') {
        isDKeyPressed.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed.current = false;
      }
      if (e.key.toLowerCase() === 'a') {
        isAKeyPressed.current = false;
      }
      if (e.key.toLowerCase() === 'd') {
        isDKeyPressed.current = false;
      }
    };

    const handlePointerDown = () => { isPointerDown.current = true; };
    const handlePointerUp = () => { isPointerDown.current = false; };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const startGame = () => {
    setGameState({
      playerX: CANVAS_WIDTH / 2,
      health: 100,
      armySize: 1,
      weaponLevel: 1,
      score: 0,
      level: 1,
      levelTimer: 60 * 60,
      levelUpTimer: 0,
      bullets: [],
      zombies: [],
      zombieBullets: [],
      gates: [],
      explosions: [],
      floatingTexts: [],
      dyingSoldiers: [],
      spawnFlashes: [],
      frame: 0,
      specialTimer: 0,
      activeSpecial: 'NONE',
      bulletDamage: 1,
      isGameOver: false,
      isStarted: true,
      isVictory: false,
      isLevelTransition: false,
      flashTimer: 0,
      hitFlashTimer: 0,
      shootMode: 'AIM',
      isAutoShoot: false,
    });
  };

  const startNextLevel = () => {
    setGameState(prev => ({
      ...prev,
      level: prev.level + 1,
      levelTimer: 60 * 60,
      isLevelTransition: false,
      zombies: [],
      zombieBullets: [],
      gates: [],
      bullets: [],
      explosions: [],
      floatingTexts: [],
      dyingSoldiers: [],
      spawnFlashes: [],
      hitFlashTimer: 0,
    }));
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    let clientX: number;
    let clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      mousePosRef.current = { x, y };
    }
  };

  const update = () => {
    const state = gameStateRef.current;
    if (!state.isStarted || state.isGameOver) return;

    const newState = { ...state };
    const currentGateSpeed = GATE_SPEED * (1 + (newState.level - 1) * 0.15);
    const currentZombieSpeedBase = ZOMBIE_SPEED_BASE * (1 + (newState.level - 1) * 0.1);

    newState.frame++;
    if (newState.flashTimer > 0) {
      newState.flashTimer--;
    }
    if (newState.hitFlashTimer > 0) {
      newState.hitFlashTimer--;
    }
    
    // Update Dying Soldiers
    newState.dyingSoldiers = newState.dyingSoldiers
      .map(s => ({ ...s, life: s.life - 1 }))
      .filter(s => s.life > 0);

    // Update Spawn Flashes
    newState.spawnFlashes = newState.spawnFlashes
      .map(f => ({ ...f, life: f.life - 1 }))
      .filter(f => f.life > 0);
    if (newState.specialTimer > 0) {
      newState.specialTimer--;
      if (newState.specialTimer === 0) {
        newState.activeSpecial = 'NONE';
      }
    }
    if (newState.isLevelTransition) {
      setGameState(newState);
      requestRef.current = requestAnimationFrame(update);
      return;
    }
    
    // --- Level Logic ---
    if (newState.levelTimer > 0) {
      newState.levelTimer--;
    } else {
      // Soft limit reached. Wait for zombies and gates to clear.
      const noZombies = newState.zombies.length === 0;
      const noGates = newState.gates.length === 0;
      
      if (noZombies && noGates) {
        if (newState.level < 5) {
          newState.isLevelTransition = true;
          // Clear screen of immediate threats (bullets, explosions)
          newState.bullets = [];
          newState.explosions = [];
        } else {
          newState.isVictory = true;
        }
      }
    }

    // --- Spawn Logic ---
    const isGracePeriod = newState.level === 1 && newState.frame < 500;
    
    if (newState.levelTimer > 0) {
      const currentSpawnRate = Math.max(30, SPAWN_RATE_ZOMBIE - (newState.level - 1) * 8);
      if (newState.frame % (isGracePeriod ? currentSpawnRate * 2 : currentSpawnRate) === 0) {
        // Chance to spawn a boss instead of a horde
        const isBossSpawn = !isGracePeriod && newState.frame % (currentSpawnRate * 10) === 0 && newState.level >= 2;
        
        if (isBossSpawn) {
          const isGiant = Math.random() > 0.5;
          const levelScale = 1 + (newState.level - 1) * 0.2;
          
          newState.zombies.push({
            x: Math.random() * (CANVAS_WIDTH - 100) + 50,
            y: -50,
            health: isGiant ? 100 * levelScale : 40 * levelScale,
            maxHealth: isGiant ? 100 * levelScale : 40 * levelScale,
            speed: currentZombieSpeedBase * (isGiant ? 0.4 : 0.7),
            radius: isGiant ? UNIT_RADIUS * 4 * levelScale : UNIT_RADIUS * 2.5 * levelScale,
            type: isGiant ? 'BOSS_GIANT' : 'BOSS_RANGED',
            id: Date.now() + Math.random(),
            shootTimer: isGiant ? undefined : 60,
          });
        } else {
          // Spawn a horde (cluster) of zombies
          // Algorithmic Balancing: Scale horde size with army size
          const armyScale = Math.max(0.5, Math.min(2.0, newState.armySize / 15));
          const baseHordeSize = Math.floor(Math.random() * 5) + 3 + Math.floor(newState.level * 0.8);
          const hordeSize = Math.floor(baseHordeSize * armyScale);
          
          const centerX = Math.random() * (CANVAS_WIDTH - 100) + 50;
          
          for (let i = 0; i < hordeSize; i++) {
            const isTank = Math.random() > 0.9;
            // Always include small zombies (40% chance of being level 1 size)
            const isSmall = Math.random() < 0.4;
            const levelScale = isSmall ? 1 : (1 + (newState.level - 1) * 0.15);
            const baseRadius = isTank ? UNIT_RADIUS * 1.5 : UNIT_RADIUS;
            
            // Algorithmic Balancing: Scale zombie health with army size
            const armyHealthScale = Math.max(0.6, Math.min(2.5, newState.armySize / 10));
            const health = (isTank ? 15 : 5) * (1 + (newState.level - 1) * 0.2) * armyHealthScale;
            
            newState.zombies.push({
              x: centerX + (Math.random() - 0.5) * 80,
              y: -50 - Math.random() * 50,
              health: health,
              maxHealth: health,
              speed: currentZombieSpeedBase * (isTank ? 0.6 : 1) * (1 + (newState.level - 1) * 0.12),
              radius: baseRadius * levelScale,
              type: isTank ? 'TANK' : 'NORMAL',
              id: Date.now() + Math.random() + i,
            });
          }
        }
      }

      const currentGateRate = Math.max(180, SPAWN_RATE_GATE - (newState.level - 1) * 30);
      if (newState.frame % currentGateRate === 0) {
        const isChoicePair = Math.random() > 0.5; // 50% chance of choice pair

        if (isChoicePair) {
          const pairId = Date.now();
          
          // Algorithmic Balancing: Increase positive gate chance for small armies, decrease for large ones
          let positiveChance = 0.6;
          if (newState.armySize < 10) positiveChance = 0.85;
          if (newState.armySize > 35) positiveChance = 0.4;
          if (isGracePeriod) positiveChance = 1.0; // Guaranteed positive in grace period
          
          const isPositive = Math.random() < positiveChance;
          const leftIsPrimary = Math.random() > 0.5;
          
          const typeA: GateType = isPositive ? 'ADD' : 'SUB';
          const typeB: GateType = isPositive ? 'MULT' : 'DIV';
          
          // Adapt values to army size
          const valA = isPositive 
            ? Math.min(15, Math.floor(newState.armySize * 0.4) + 8) // More generous ADD
            : -(Math.floor(newState.armySize * (Math.random() > 0.8 ? 2.5 : 1.2)) + 20); // More punishing SUB
          const valB = isPositive 
            ? (Math.random() > 0.8 ? 3 : 2) 
            : (newState.armySize > 30 ? 3 : 2); // More frequent DIV for large armies
          
          // In grace period, ensure SUB/DIV are not too bad if they somehow spawn (though positiveChance is 1.0)
          const finalValA = (isGracePeriod && !isPositive) ? -5 : valA;
          const finalValB = (isGracePeriod && !isPositive) ? 2 : valB;

          const gateWidth = 180;
          newState.gates.push({
            x: 100,
            y: -100,
            type: leftIsPrimary ? typeA : typeB,
            value: leftIsPrimary ? finalValA : finalValB,
            width: gateWidth,
            id: Date.now() + Math.random(),
            pairId,
          });
          newState.gates.push({
            x: 300,
            y: -100,
            type: leftIsPrimary ? typeB : typeA,
            value: leftIsPrimary ? finalValB : finalValA,
            width: gateWidth,
            id: Date.now() + Math.random(),
            pairId,
          });
        } else {
          const types: GateType[] = ['ADD', 'SUB', 'MULT', 'DIV', 'SPECIAL', 'TRAP', 'UPGRADE', 'RATE_UPGRADE'];
          
          // Algorithmic Balancing: Adjust single gate type selection based on army size
          let type = types[Math.floor(Math.random() * types.length)];
          
          if (isGracePeriod) {
            type = Math.random() > 0.5 ? 'ADD' : 'MULT';
          } else if (newState.armySize < 10) {
            // Favor positive gates when army is small
            if (['SUB', 'DIV', 'TRAP'].includes(type) && Math.random() > 0.3) {
              type = Math.random() > 0.5 ? 'ADD' : 'MULT';
            }
          } else if (newState.armySize > 35) {
            // Favor negative gates when army is large
            if (['ADD', 'MULT', 'UPGRADE', 'RATE_UPGRADE'].includes(type) && Math.random() > 0.4) {
              type = Math.random() > 0.5 ? 'SUB' : 'DIV';
            }
          }

          // Make UPGRADE, RATE_UPGRADE and SPECIAL rarer
          if ((type === 'UPGRADE' || type === 'RATE_UPGRADE' || type === 'SPECIAL') && Math.random() > 0.4) {
            type = Math.random() > 0.5 ? 'ADD' : 'SUB';
          }
          
          let value = 0;
          // Adapt values to army size
          if (type === 'ADD') value = Math.min(15, Math.floor(newState.armySize * 0.3) + 4); // More generous ADD
          if (type === 'SUB') value = -(Math.floor(newState.armySize * (Math.random() > 0.7 ? 2.0 : 1.0)) + 20); // More punishing SUB
          if (type === 'MULT') value = 2;
          if (type === 'DIV') value = newState.armySize > 30 ? 3 : 2; // More frequent DIV for large armies
          if (type === 'SPECIAL') value = 10 + Math.floor(newState.armySize * 0.5);
          if (type === 'TRAP') value = -1; // Penalty per hit
          if (type === 'UPGRADE') value = 30 + Math.floor(newState.level * 15); // Hits required
          if (type === 'RATE_UPGRADE') value = 25 + Math.floor(newState.level * 10); // Hits required

          newState.gates.push({
            x: Math.random() * (CANVAS_WIDTH - 150) + 75,
            y: -100,
            type,
            value,
            width: 120,
            id: Date.now() + Math.random(),
          });
        }
      }
    }

    // --- Movement Logic ---
    if (isAKeyPressed.current) {
      newState.playerX = Math.max(UNIT_RADIUS, newState.playerX - PLAYER_SPEED);
    }
    if (isDKeyPressed.current) {
      newState.playerX = Math.min(CANVAS_WIDTH - UNIT_RADIUS, newState.playerX + PLAYER_SPEED);
    }
    
    // Smooth player movement for better feel
    const targetX = newState.playerX;
    if (newState.smoothPlayerX === undefined) newState.smoothPlayerX = targetX;
    newState.smoothPlayerX += (targetX - newState.smoothPlayerX) * 0.15;

    // --- Shooting Logic ---
    const shootInterval = Math.max(3, 25 - newState.weaponLevel * 2);
    if ((isSpacePressed.current || isPointerDown.current || newState.isAutoShoot) && newState.frame % shootInterval === 0) {
      // Each unit in the army fires a bullet
      const positions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
      const mouseX = mousePosRef.current.x;
      const mouseY = mousePosRef.current.y;

      positions.forEach(pos => {
        let baseAngle: number;
        
        if (newState.shootMode === 'STRAIGHT') {
          // Shoot straight up
          baseAngle = -Math.PI / 2;
        } else {
          // Shoot towards the mouse/touch point
          const dx = mouseX - pos.x;
          const dy = mouseY - pos.y;
          baseAngle = Math.atan2(dy, dx);
        }
        
        // Add random spread to the shooting angle
        const spreadAmount = newState.shootMode === 'STRAIGHT' ? 0.4 : 0.25; // Wider spread for straight fire
        const angle = baseAngle + (Math.random() - 0.5) * spreadAmount;
        
        const vx = Math.cos(angle) * BULLET_SPEED;
        const vy = Math.sin(angle) * BULLET_SPEED;

        newState.bullets.push({
          x: pos.x,
          y: pos.y,
          vx,
          vy,
          specialType: newState.activeSpecial,
          life: 0,
          id: Date.now() + Math.random(),
          hitGateIds: [],
        });
      });
    }

    // --- Update Entities ---
    // Boss Shooting Logic
    newState.zombies.forEach(z => {
      if (z.type === 'BOSS_RANGED' && z.shootTimer !== undefined) {
        z.shootTimer--;
        if (z.shootTimer <= 0) {
          z.shootTimer = 90; // Shoot every 1.5s
          const dx = newState.playerX - z.x;
          const dy = PLAYER_Y - z.y;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = 4;
          newState.zombieBullets.push({
            x: z.x,
            y: z.y,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
            id: Date.now() + Math.random(),
            health: 5,
            maxHealth: 5,
          });
        }
      }
    });

    newState.bullets = newState.bullets
      .map(b => {
        let nx = b.x + b.vx;
        let ny = b.y + b.vy;
        
        if (b.specialType === 'CURVED') {
          // Add a curving effect (perpendicular to velocity)
          const speed = Math.hypot(b.vx, b.vy);
          const perpX = -b.vy / speed;
          const perpY = b.vx / speed;
          const curveAmount = Math.sin(b.life * 0.2) * 4;
          nx += perpX * curveAmount;
          ny += perpY * curveAmount;
        }

        return { ...b, x: nx, y: ny, life: b.life + 1 };
      })
      .filter(b => b.y > -20 && b.y < CANVAS_HEIGHT + 20 && b.x > -20 && b.x < CANVAS_WIDTH + 20);

    newState.zombies = newState.zombies
      .map(z => {
        const nextAttackAnimTimer = (z.attackAnimTimer || 0) > 0 ? z.attackAnimTimer! - 1 : 0;
        return { ...z, y: z.y + z.speed, attackAnimTimer: nextAttackAnimTimer };
      })
      .filter(z => {
        if (z.y >= CANVAS_HEIGHT) {
          newState.health -= 5; // Penalty for escaping
          return false;
        }
        return true;
      });

    newState.zombieBullets = newState.zombieBullets
      .map(b => {
        return { ...b, x: b.x + b.vx, y: b.y + b.vy };
      })
      .filter(b => b.y < CANVAS_HEIGHT + 50 && b.y > -50 && b.x > -50 && b.x < CANVAS_WIDTH + 50);

    newState.gates = newState.gates
      .map(g => {
        return { ...g, y: g.y + currentGateSpeed };
      })
      .filter(g => g.y < CANVAS_HEIGHT + 100);

    // --- Explosion Logic ---
    newState.explosions = newState.explosions.map(e => ({
      ...e,
      radius: e.radius + 2,
    })).filter(e => e.radius < e.maxRadius);

    newState.explosions.forEach(e => {
      newState.zombies.forEach(z => {
        const dist = Math.hypot(z.x - e.x, z.y - e.y);
        if (dist < e.radius + 20) {
          z.health -= 0.05; // Continuous damage while in explosion
        }
      });
    });

    // Update Floating Texts
    newState.floatingTexts = newState.floatingTexts
      .map(t => ({ ...t, y: t.y - 1, life: t.life - 0.02 }))
      .filter(t => t.life > 0);

    // --- Collision Logic ---
    
    // Bullets vs Zombies
    newState.bullets = newState.bullets.filter(b => {
      let hit = false;
      newState.zombies = newState.zombies.map(z => {
        const dist = Math.hypot(b.x - z.x, b.y - z.y);
        if (dist < z.radius + 5 && !hit) {
          hit = true;
          const damage = (1 + (newState.weaponLevel * 0.5)) * newState.bulletDamage;
          
          // Hit effect
          newState.explosions.push({
            x: b.x,
            y: b.y,
            radius: 2,
            maxRadius: b.specialType === 'EXPLOSIVE' ? 60 : 15,
            id: Date.now() + Math.random(),
          });
          
          return { ...z, health: z.health - damage };
        }
        return z;
      });
      return !hit;
    });

    // Bullets vs Zombie Bullets
    newState.bullets = newState.bullets.filter(b => {
      let hit = false;
      newState.zombieBullets = newState.zombieBullets.map(zb => {
        const dist = Math.hypot(b.x - zb.x, b.y - zb.y);
        if (dist < 15 && !hit) { // Zombie bullets are a bit larger
          hit = true;
          const damage = (1 + (newState.weaponLevel * 0.5)) * newState.bulletDamage;
          
          // Hit effect
          newState.explosions.push({
            x: b.x,
            y: b.y,
            radius: 2,
            maxRadius: b.specialType === 'EXPLOSIVE' ? 60 : 15,
            id: Date.now() + Math.random(),
          });
          
          return { ...zb, health: zb.health - damage };
        }
        return zb;
      });
      return !hit;
    });

    // Remove dead zombie bullets
    newState.zombieBullets = newState.zombieBullets.filter(zb => zb.health > 0);

    // Bullets vs Gates
    newState.bullets = newState.bullets.map(b => {
      let updatedBullet = { ...b };
      newState.gates = newState.gates.map(g => {
        const inX = b.x > g.x - g.width / 2 && b.x < g.x + g.width / 2;
        const inY = b.y > g.y - 20 && b.y < g.y + 20;
        const alreadyHit = b.hitGateIds?.includes(g.id);

        if (inX && inY && !alreadyHit) {
          if (!updatedBullet.hitGateIds) updatedBullet.hitGateIds = [];
          updatedBullet.hitGateIds.push(g.id);
          if (g.type === 'ADD') {
            const newProgress = (g.hitProgress || 0) + 1;
            if (newProgress >= 2) {
              return { ...g, value: Math.min(15, g.value + 1), hitProgress: 0 };
            }
            return { ...g, hitProgress: newProgress };
          }
          if (g.type === 'SUB') {
            const newProgress = (g.hitProgress || 0) + 1;
            if (newProgress >= 2) {
              return { ...g, value: Math.min(15, g.value + 1), hitProgress: 0 };
            }
            return { ...g, hitProgress: newProgress };
          }
          if (g.type === 'SPECIAL') {
            return { ...g, value: g.value - 1 };
          }
          if (g.type === 'UPGRADE') {
            const newValue = g.value - 1;
            if (newValue <= 0) {
              newState.bulletDamage += 0.5;
              newState.flashTimer = 10; // Screen flash
              return { ...g, value: 0 };
            }
            return { ...g, value: newValue };
          }
          if (g.type === 'RATE_UPGRADE') {
            const newValue = g.value - 1;
            if (newValue <= 0) {
              newState.weaponLevel++;
              newState.flashTimer = 10; // Screen flash
              return { ...g, value: 0 };
            }
            return { ...g, value: newValue };
          }
          if (g.type === 'TRAP') {
            // Shooting a trap gate reduces army size, but cap it at 10 per gate
            const penaltyTaken = g.trapPenaltyTaken || 0;
            if (penaltyTaken < 10) {
              // Handle dying soldier for TRAP
              const currentPositions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
              const pos = currentPositions[currentPositions.length - 1];
              if (pos) {
                const mouseX = mousePosRef.current.x;
                const mouseY = mousePosRef.current.y;
                const angle = Math.atan2(mouseY - pos.y, mouseX - pos.x);
                newState.dyingSoldiers.push({
                  x: pos.x,
                  y: pos.y,
                  angle,
                  life: 30,
                  id: Date.now() + Math.random()
                });
              }
              
              newState.armySize = Math.max(1, newState.armySize - 1);
              return { ...g, trapPenaltyTaken: penaltyTaken + 1 };
            }
            return g;
          }
          // MULT and DIV are now fixed numbers and cannot be changed by shooting
        }
        return g;
      });
      return updatedBullet;
    });
    // Remove UPGRADE and RATE_UPGRADE gates that reached 0
    newState.gates = newState.gates.filter(g => !((g.type === 'UPGRADE' || g.type === 'RATE_UPGRADE') && g.value <= 0));

    // Remove dead zombies
    const initialZombieCount = newState.zombies.length;
    newState.zombies = newState.zombies.filter(z => z.health > 0);
    newState.score += (initialZombieCount - newState.zombies.length) * 10;

    // Helper to apply damage (reduces army size before health)
    const applyDamage = (amount: number) => {
      newState.hitFlashTimer = 10; // Trigger hit flash
      if (newState.armySize > 1) {
        // Capture positions of soldiers being removed
        const currentPositions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
        const newSize = Math.max(1, newState.armySize - amount);
        const removedCount = Math.floor(newState.armySize) - Math.floor(newSize);
        
        if (removedCount > 0) {
          const mouseX = mousePosRef.current.x;
          const mouseY = mousePosRef.current.y;
          
          for (let i = 0; i < removedCount; i++) {
            const pos = currentPositions[currentPositions.length - 1 - i];
            if (pos) {
              const angle = Math.atan2(mouseY - pos.y, mouseX - pos.x);
              newState.dyingSoldiers.push({
                x: pos.x,
                y: pos.y,
                angle,
                life: 30,
                id: Date.now() + Math.random() + i
              });
            }
          }
        }
        
        newState.armySize = newSize;
      } else {
        // Only the leader left, reduce health.
        newState.health -= amount;
      }
    };

    // Player vs Zombies
    const armyPositions = getArmyPositions(newState.playerX, newState.armySize);
    newState.zombies = newState.zombies.map(z => {
      // Check collision with any unit in the army
      const hitUnit = armyPositions.some(pos => Math.hypot(pos.x - z.x, pos.y - z.y) < z.radius + UNIT_RADIUS);
      if (hitUnit) {
        let damage = 0.2;
        if (z.type === 'TANK') damage = 0.5;
        if (z.type === 'BOSS_GIANT') damage = 2.0;
        if (z.type === 'BOSS_RANGED') damage = 1.0;
        applyDamage(damage);
        
        // Trigger attack animation
        return { ...z, attackAnimTimer: 10 };
      }
      return z;
    });

    // Player vs Zombie Bullets
    newState.zombieBullets = newState.zombieBullets.filter(b => {
      const hitUnit = armyPositions.some(pos => Math.hypot(pos.x - b.x, pos.y - b.y) < 15);
      if (hitUnit) {
        applyDamage(1.5);
        return false;
      }
      return true;
    });

    // Player vs Gates
    let hitPairId: number | undefined = undefined;
    newState.gates = newState.gates.filter(g => {
      // Check collision with any unit in the army
      const hitGate = armyPositions.some(pos => Math.hypot(pos.x - g.x, pos.y - g.y) < 40);
      if (hitGate) {
        if (g.type === 'UPGRADE') return true; // Must shoot upgrade gates
        if (g.type === 'ADD' || g.type === 'SUB') {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 0) {
            const bonus = g.value * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: '#facc15',
              life: 1.0,
              id: Date.now() + Math.random(),
            });
          }
          
          // Handle dying soldiers for SUB
          if (g.value < 0) {
            const currentPositions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
            const newSize = Math.max(1, newState.armySize + g.value);
            const removedCount = Math.floor(newState.armySize) - Math.floor(newSize);
            
            if (removedCount > 0) {
              const mouseX = mousePosRef.current.x;
              const mouseY = mousePosRef.current.y;
              for (let i = 0; i < removedCount; i++) {
                const pos = currentPositions[currentPositions.length - 1 - i];
                if (pos) {
                  const angle = Math.atan2(mouseY - pos.y, mouseX - pos.x);
                  newState.dyingSoldiers.push({
                    x: pos.x,
                    y: pos.y,
                    angle,
                    life: 30,
                    id: Date.now() + Math.random() + i
                  });
                }
              }
            }
          }
          
          // Handle spawn flashes for ADD
          if (g.value > 0) {
            const oldSize = Math.floor(newState.armySize);
            const newSize = Math.floor(Math.min(MAX_ARMY_SIZE, newState.armySize + g.value));
            for (let i = oldSize; i < newSize; i++) {
              newState.spawnFlashes.push({ index: i, life: 30 });
            }
          }
          
          newState.armySize = Math.min(MAX_ARMY_SIZE, Math.max(1, newState.armySize + g.value));
        } else if (g.type === 'MULT') {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 1) {
            const bonus = (newState.armySize * (g.value - 1)) * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: '#facc15',
              life: 1.0,
              id: Date.now() + Math.random(),
            });
          }

          // Handle spawn flashes for MULT
          if (g.value > 1) {
            const oldSize = Math.floor(newState.armySize);
            const newSize = Math.floor(Math.min(MAX_ARMY_SIZE, newState.armySize * g.value));
            for (let i = oldSize; i < newSize; i++) {
              newState.spawnFlashes.push({ index: i, life: 30 });
            }
          }

          newState.armySize = Math.min(MAX_ARMY_SIZE, newState.armySize * g.value);
        } else if (g.type === 'DIV') {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 1) {
            const bonus = (newState.armySize - (newState.armySize / g.value)) * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: '#facc15',
              life: 1.0,
              id: Date.now() + Math.random(),
            });
          }
          
          // Handle dying soldiers for DIV
          if (g.value > 1) {
            const currentPositions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
            const newSize = Math.max(1, newState.armySize / g.value);
            const removedCount = Math.floor(newState.armySize) - Math.floor(newSize);
            
            if (removedCount > 0) {
              const mouseX = mousePosRef.current.x;
              const mouseY = mousePosRef.current.y;
              for (let i = 0; i < removedCount; i++) {
                const pos = currentPositions[currentPositions.length - 1 - i];
                if (pos) {
                  const angle = Math.atan2(mouseY - pos.y, mouseX - pos.x);
                  newState.dyingSoldiers.push({
                    x: pos.x,
                    y: pos.y,
                    angle,
                    life: 30,
                    id: Date.now() + Math.random() + i
                  });
                }
              }
            }
          }
          
          newState.armySize = Math.max(1, Math.floor(newState.armySize / g.value));
        } else if (g.type === 'SPECIAL' && g.value <= 0) {
          const specials: ('CURVED' | 'EXPLOSIVE')[] = ['CURVED', 'EXPLOSIVE'];
          newState.activeSpecial = specials[Math.floor(Math.random() * specials.length)];
          newState.weaponLevel++;
          newState.specialTimer = 20 * 60; // 20 seconds at 60fps
        } else if (g.type === 'TRAP') {
          // Passing through a trap gate is very bad
          const currentPositions = getArmyPositions(newState.smoothPlayerX ?? newState.playerX, newState.armySize);
          const newSize = Math.max(1, newState.armySize - Math.floor(newState.armySize * 0.5));
          const removedCount = Math.floor(newState.armySize) - Math.floor(newSize);
          
          if (removedCount > 0) {
            const mouseX = mousePosRef.current.x;
            const mouseY = mousePosRef.current.y;
            for (let i = 0; i < removedCount; i++) {
              const pos = currentPositions[currentPositions.length - 1 - i];
              if (pos) {
                const angle = Math.atan2(mouseY - pos.y, mouseX - pos.x);
                newState.dyingSoldiers.push({
                  x: pos.x,
                  y: pos.y,
                  angle,
                  life: 30,
                  id: Date.now() + Math.random() + i
                });
              }
            }
          }
          
          newState.armySize = newSize;
          applyDamage(10);
        }
        
        if (g.pairId) {
          hitPairId = g.pairId;
        }
        return false;
      }
      return true;
    });

    // If a gate in a pair was hit, remove the other gate in the same pair
    if (hitPairId !== undefined) {
      newState.gates = newState.gates.filter(g => g.pairId !== hitPairId);
    }

    if (newState.health <= 0) {
      newState.isGameOver = true;
    }

    setGameState(newState);
    requestRef.current = requestAnimationFrame(update);
  };

  useEffect(() => {
    if (gameState.isStarted && !gameState.isGameOver) {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState.isStarted, gameState.isGameOver]);

  // --- Rendering ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background - Simple Grid
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // --- Entity Rendering ---
    
    // Draw Zombies
    gameState.zombies.forEach(z => {
      drawZombie(ctx, z.x, z.y, z.type, z.radius, gameState.frame, z.attackAnimTimer);
      
      const size = z.radius;
      ctx.save();
      ctx.translate(z.x, z.y);
      
      if (z.type.startsWith('BOSS')) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Health Bar
      ctx.fillStyle = '#333';
      ctx.fillRect(-size, -size - 15, size * 2, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-size, -size - 15, (size * 2) * (z.health / z.maxHealth), 4);
      
      ctx.restore();
    });

    // Draw Gates (Moved after zombies for visibility)
    gameState.gates.forEach(g => {
      ctx.save();
      ctx.translate(g.x, g.y);
      
      let color = '#71717a';
      let label = '';

      if (g.type === 'ADD' || g.type === 'SUB') {
        if (g.value > 0) {
          color = '#3b82f6';
          label = `+${g.value}`;
        } else if (g.value < 0) {
          color = '#ef4444';
          label = `${g.value}`;
        } else {
          color = '#71717a';
          label = '0';
        }
      } else if (g.type === 'MULT') {
        color = g.value > 1 ? '#3b82f6' : '#71717a';
        label = `x${g.value}`;
      } else if (g.type === 'DIV') {
        color = g.value > 1 ? '#ef4444' : '#3b82f6';
        label = `/${g.value}`;
      } else if (g.type === 'SPECIAL') {
        color = '#eab308';
        label = g.value <= 0 ? 'READY!' : `SPECIAL: ${g.value}`;
      } else if (g.type === 'TRAP') {
        const penaltyRemaining = 10 - (g.trapPenaltyTaken || 0);
        color = penaltyRemaining > 0 ? '#f97316' : '#71717a';
        label = penaltyRemaining > 0 ? `!!! TRAP (${penaltyRemaining}) !!!` : '- 50%';
      } else if (g.type === 'UPGRADE') {
        color = '#2dd4bf';
        label = `DMG UPGRADE: ${g.value}`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
      } else if (g.type === 'RATE_UPGRADE') {
        color = '#a855f7';
        label = `RATE UPGRADE: ${g.value}`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
      }

      ctx.fillStyle = color + '44';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fillRect(-g.width/2, -20, g.width, 40);
      ctx.strokeRect(-g.width/2, -20, g.width, 40);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      
      ctx.restore();
    });

    // Draw Player & Army
    const armyPositions = getArmyPositions(gameState.smoothPlayerX ?? gameState.playerX, gameState.armySize);
    const targetX = mousePosRef.current.x;
    const targetY = mousePosRef.current.y;

    armyPositions.forEach((pos, index) => {
      let angle: number;
      if (gameState.shootMode === 'STRAIGHT') {
        angle = -Math.PI / 2; // Face straight up
      } else {
        const dx = targetX - pos.x;
        const dy = targetY - pos.y;
        angle = Math.atan2(dy, dx);
      }
      const spawnFlash = gameState.spawnFlashes?.find(f => f.index === index);
      drawSoldier(ctx, pos.x, pos.y, angle, index === 0, gameState.weaponLevel, gameState.hitFlashTimer, spawnFlash?.life || 0);
    });

    // Draw Dying Soldiers
    gameState.dyingSoldiers.forEach(s => {
      ctx.save();
      ctx.globalAlpha = s.life / 30;
      drawSoldier(ctx, s.x, s.y, s.angle, false, gameState.weaponLevel, 10); // Pass hitFlashTimer=10 to force red color
      ctx.restore();
    });

    // Draw Floating Texts
    gameState.floatingTexts.forEach(t => {
      ctx.save();
      ctx.globalAlpha = t.life;
      ctx.fillStyle = t.color;
      ctx.font = 'bold 20px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });

    // Draw Zombie Bullets
    gameState.zombieBullets.forEach(b => {
      ctx.save();
      ctx.translate(b.x, b.y);
      
      // Glow effect
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#9333ea';
      
      // Main body
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner core
      ctx.fillStyle = '#f0abfc';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Health bar
      const barWidth = 20;
      const barHeight = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-barWidth/2, -15, barWidth, barHeight);
      
      const healthPercent = b.health / b.maxHealth;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-barWidth/2, -15, barWidth * healthPercent, barHeight);
      
      ctx.restore();
    });

    // Draw Explosions
    ctx.save();
    gameState.explosions.forEach(e => {
      const alpha = 1 - (e.radius / e.maxRadius);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 100, 0, ${alpha * 0.5})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();

    // Draw Bullets
    gameState.bullets.forEach(b => {
      ctx.save();
      ctx.fillStyle = b.specialType === 'CURVED' ? '#f472b6' : (b.specialType === 'EXPLOSIVE' ? '#fb923c' : '#facc15');
      ctx.beginPath();
      ctx.arc(b.x, b.y, (b.specialType !== 'NONE' ? 5 : 3), 0, Math.PI * 2);
      ctx.fill();
      
      if (b.specialType !== 'NONE') {
        ctx.shadowBlur = 10;
        ctx.shadowColor = b.specialType === 'CURVED' ? '#f472b6' : '#fb923c';
        ctx.stroke();
      }
      ctx.restore();
    });

    // Draw Crosshair
    if (gameState.isStarted && !gameState.isGameOver) {
      const mx = mousePosRef.current.x;
      const my = mousePosRef.current.y;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 10, my);
      ctx.lineTo(mx + 10, my);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx, my - 10);
      ctx.lineTo(mx, my + 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw Flash
    if (gameState.flashTimer > 0) {
      ctx.fillStyle = `rgba(45, 212, 191, ${gameState.flashTimer * 0.05})`;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

  }, [gameState]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col items-center justify-center p-4">
      {/* Header Stats */}
      <div className="w-full max-w-[400px] flex justify-between items-end mb-4 px-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Level {gameState.level}</span>
            <span className="text-[10px] text-zinc-600 font-mono">|</span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {Math.floor(gameState.levelTimer / 60)}s
            </span>
          </div>
          <span className="text-2xl font-bold font-mono">{gameState.score.toLocaleString()}</span>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Army</span>
            <div className="flex items-center gap-1">
              <User size={14} className="text-blue-400" />
              <span className="text-lg font-bold font-mono">
                {Math.floor(gameState.armySize) >= MAX_ARMY_SIZE ? 'MAX' : Math.floor(gameState.armySize)}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Weapon</span>
            <div className="flex items-center gap-1">
              <Zap size={14} className={`text-yellow-400 ${gameState.specialTimer > 0 ? 'animate-pulse' : ''}`} />
              <span className="text-lg font-bold font-mono">
                Lv.{gameState.weaponLevel}
                {gameState.specialTimer > 0 && (
                  <span className={`${gameState.activeSpecial === 'CURVED' ? 'text-pink-500' : 'text-orange-500'} ml-1 text-sm`}>
                    ({gameState.activeSpecial})
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Mode</span>
            <div className="flex gap-2">
              <button 
                onClick={() => setGameState(prev => ({ ...prev, shootMode: prev.shootMode === 'AIM' ? 'STRAIGHT' : 'AIM' }))}
                title={gameState.shootMode === 'AIM' ? 'Switch to Straight Fire' : 'Switch to Aimed Fire'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded border ${gameState.shootMode === 'STRAIGHT' ? 'bg-blue-900/40 border-blue-500 text-blue-200' : 'bg-zinc-800 border-zinc-700 text-zinc-300'} transition-all active:scale-95`}
              >
                {gameState.shootMode === 'STRAIGHT' ? <ArrowUp size={12} /> : <Target size={12} />}
                <span className="text-[10px] font-bold uppercase tracking-wider">{gameState.shootMode}</span>
              </button>
              <button 
                onClick={() => setGameState(prev => ({ ...prev, isAutoShoot: !prev.isAutoShoot }))}
                title={gameState.isAutoShoot ? 'Disable Auto-Shoot' : 'Enable Auto-Shoot'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded border ${gameState.isAutoShoot ? 'bg-orange-900/40 border-orange-500 text-orange-200' : 'bg-zinc-800 border-zinc-700 text-zinc-300'} transition-all active:scale-95`}
              >
                <Zap size={12} className={gameState.isAutoShoot ? 'fill-current' : ''} />
                <span className="text-[10px] font-bold uppercase tracking-wider">{gameState.isAutoShoot ? 'AUTO' : 'MANUAL'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Game Canvas Container */}
      <div className="relative group">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onMouseMove={handleMouseMove}
          onTouchMove={handleMouseMove}
          className="rounded-xl shadow-2xl border border-zinc-800 cursor-none touch-none"
        />

        {/* HUD Overlay */}
        <div className="absolute top-4 left-4 right-4 flex flex-col gap-2 pointer-events-none">
          <div className="w-full bg-zinc-900/80 h-2 rounded-full overflow-hidden border border-zinc-700">
            <motion.div
              className="h-full bg-red-500"
              initial={{ width: '100%' }}
              animate={{ width: `${gameState.health}%` }}
            />
          </div>
          {gameState.specialTimer > 0 && (
            <div className="w-full bg-zinc-900/80 h-1.5 rounded-full overflow-hidden border border-zinc-700">
              <motion.div
                className={`h-full ${gameState.activeSpecial === 'CURVED' ? 'bg-pink-500' : 'bg-orange-500'}`}
                initial={{ width: '100%' }}
                animate={{ width: `${(gameState.specialTimer / (20 * 60)) * 100}%` }}
              />
            </div>
          )}
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            <span>Health: {Math.ceil(gameState.health)}%</span>
            <span>Damage: x{gameState.bulletDamage.toFixed(1)}</span>
          </div>
        </div>

        {/* Start / Game Over Overlays */}
        <AnimatePresence>
          {!gameState.isStarted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl p-8 text-center"
            >
              <Swords size={64} className="text-blue-500 mb-6" />
              <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">Horde Rush</h1>
              <p className="text-zinc-400 text-sm mb-8 max-w-[250px]">
                Build your army, upgrade your weapons, and survive the zombie onslaught.
              </p>
              <button
                onClick={startGame}
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all active:scale-95"
              >
                <Play size={20} fill="currentColor" />
                START DEFENSE
              </button>
            </motion.div>
          )}

          {gameState.isGameOver && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center rounded-xl p-8 text-center"
            >
              <Shield size={64} className="text-red-500 mb-6" />
              <h2 className="text-5xl font-black uppercase tracking-tighter mb-2 italic">Defeated</h2>
              <div className="flex flex-col gap-1 mb-8">
                <span className="text-zinc-400 text-xs uppercase tracking-widest">Final Score</span>
                <span className="text-4xl font-mono font-bold">{gameState.score.toLocaleString()}</span>
              </div>
              <button
                onClick={startGame}
                className="bg-white text-red-950 px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all hover:bg-zinc-200 active:scale-95"
              >
                <RotateCcw size={20} />
                TRY AGAIN
              </button>
            </motion.div>
          )}

          {gameState.isVictory && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-blue-950/90 backdrop-blur-md flex flex-col items-center justify-center rounded-xl p-8 text-center"
            >
              <Trophy size={64} className="text-yellow-400 mb-6" />
              <h2 className="text-5xl font-black uppercase tracking-tighter mb-2 italic">Victory</h2>
              <p className="text-zinc-300 text-sm mb-8">
                You survived all 5 levels of the zombie onslaught!
              </p>
              <div className="flex flex-col gap-1 mb-8">
                <span className="text-zinc-400 text-xs uppercase tracking-widest">Total Score</span>
                <span className="text-4xl font-mono font-bold">{gameState.score.toLocaleString()}</span>
              </div>
              <button
                onClick={startGame}
                className="bg-white text-blue-950 px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all hover:bg-zinc-200 active:scale-95"
              >
                <RotateCcw size={20} />
                PLAY AGAIN
              </button>
            </motion.div>
          )}

          {gameState.isLevelTransition && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl p-8 text-center"
            >
              <div className="bg-blue-600/90 backdrop-blur-sm px-12 py-8 rounded-2xl border-2 border-blue-400 shadow-[0_0_50px_rgba(37,99,235,0.5)]">
                <h3 className="text-sm font-mono uppercase tracking-[0.3em] text-blue-200 mb-1">Level Complete</h3>
                <h2 className="text-6xl font-black italic uppercase tracking-tighter mb-6">Level {gameState.level}</h2>
                <button
                  onClick={startNextLevel}
                  className="bg-white text-blue-600 px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all hover:bg-zinc-100 active:scale-95 mx-auto"
                >
                  <Play size={20} fill="currentColor" />
                  START LEVEL {gameState.level + 1}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Instructions */}
      <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-[400px]">
        <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs">
            A/D
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase text-zinc-500 font-bold">Move</span>
            <span className="text-xs">Left / Right</span>
          </div>
        </div>
        <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-yellow-500/20 flex items-center justify-center text-yellow-400">
            <Zap size={16} />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase text-zinc-500 font-bold">Aim & Shoot</span>
            <span className="text-xs">Mouse + Space</span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-mono">
        System v1.0.4 // Combat Ready
      </div>
    </div>
  );
}

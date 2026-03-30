import {
  ArrowUp,
  Monitor,
  Play,
  RotateCcw,
  Shield,
  Swords,
  Target,
  Trophy,
  User,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { useGetTopScores, useSubmitScore } from "./hooks/useLeaderboard";

// --- ID Counter ---
let _nextId = 0;
const nextId = () => ++_nextId;

// --- Constants ---
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const PLAYER_Y = CANVAS_HEIGHT - 80;
const LAND_W = 600;
const LAND_H = 400;
const PLAYER_LAND_X = 80;
const UNIT_RADIUS = 8;
const BULLET_SPEED = 7;
const ZOMBIE_SPEED_BASE = 1.0;
const GATE_SPEED = 1.5;
const SPAWN_RATE_ZOMBIE = 60;
const SPAWN_RATE_GATE = 300;
const MAX_ARMY_SIZE = 75;
const PLAYER_SPEED = 4;

function buildZombieGrid(
  zombies: Zombie[],
  cellSize: number,
): Map<string, Zombie[]> {
  const grid = new Map<string, Zombie[]>();
  for (const z of zombies) {
    const cx = Math.floor(z.x / cellSize);
    const cy = Math.floor(z.y / cellSize);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(z);
  }
  return grid;
}

function getNearbyZombies(
  grid: Map<string, Zombie[]>,
  x: number,
  y: number,
  cellSize: number,
): Zombie[] {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const result: Zombie[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const neighbors = grid.get(`${cx + dx},${cy + dy}`);
      if (neighbors) for (const n of neighbors) result.push(n);
    }
  }
  return result;
}

const getArmyPositions = (
  playerX: number,
  armySize: number,
  isLandscape = false,
  playerY = LAND_H / 2,
) => {
  const positions: { x: number; y: number }[] = [];
  const spacing = 12;
  const anchorX = isLandscape ? PLAYER_LAND_X : playerX;
  const anchorY = isLandscape ? playerY : PLAYER_Y;

  for (let i = 0; i < armySize; i++) {
    if (i === 0) {
      positions.push({ x: anchorX, y: anchorY });
      continue;
    }
    const angle = i * 137.508 * (Math.PI / 180);
    const radius = Math.sqrt(i) * spacing;
    positions.push({
      x: anchorX + Math.cos(angle) * radius,
      y: anchorY + Math.sin(angle) * radius,
    });
  }
  return positions;
};

type GateType =
  | "ADD"
  | "SUB"
  | "MULT"
  | "DIV"
  | "SPECIAL"
  | "TRAP"
  | "UPGRADE"
  | "RATE_UPGRADE";

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  specialType: "NONE" | "CURVED" | "EXPLOSIVE";
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
  type: "NORMAL" | "TANK" | "BOSS_RANGED" | "BOSS_GIANT";
  id: number;
  shootTimer?: number;
  attackAnimTimer?: number;
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
  bulletHitFlash?: number;
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
  life: number;
  id: number;
}

interface DyingSoldier {
  x: number;
  y: number;
  angle: number;
  life: number;
  id: number;
}

interface SpawnFlash {
  index: number;
  life: number;
}

interface BackgroundElement {
  x: number;
  y: number;
  type: "RUBBLE" | "CRACK" | "WALL";
  size: number;
  rotation: number;
  id: number;
}

interface HerbPatch {
  x: number;
  y: number;
  size: number;
  rotation: number;
  id: number;
  colors: string[];
}
interface MudPond {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  health: number;
  maxHealth: number;
  id: number;
  attackers: { x: number; y: number }[];
}

interface GameState {
  playerX: number;
  playerY: number;
  smoothPlayerX?: number;
  smoothPlayerY?: number;
  health: number;
  armySize: number;
  weaponLevel: number;
  score: number;
  level: number;
  levelTimer: number;
  levelUpTimer: number;
  bullets: Bullet[];
  zombies: Zombie[];
  zombieBullets: ZombieBullet[];
  gates: Gate[];
  explosions: Explosion[];
  floatingTexts: FloatingText[];
  dyingSoldiers: DyingSoldier[];
  spawnFlashes: SpawnFlash[];
  backgroundElements: BackgroundElement[];
  mudPonds: MudPond[];
  herbPatches: HerbPatch[];
  frame: number;
  specialTimer: number;
  activeSpecial: "NONE" | "CURVED" | "EXPLOSIVE";
  bulletDamage: number;
  isGameOver: boolean;
  isStarted: boolean;
  isVictory: boolean;
  isLevelTransition: boolean;
  flashTimer: number;
  hitFlashTimer: number;
  shootMode: "AIM" | "STRAIGHT";
  isAutoShoot: boolean;
}

// --- Rendering Helpers ---
const drawSoldier = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  isMain: boolean,
  weaponLevel: number,
  hitFlashTimer = 0,
  spawnFlashTimer = 0,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (hitFlashTimer > 0) {
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ef4444";
  } else if (spawnFlashTimer > 0) {
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#22c55e";
  }

  let bodyColor = isMain ? "#1e3a8a" : "#3b82f6";
  if (hitFlashTimer > 0) bodyColor = "#ef4444";
  else if (spawnFlashTimer > 0) bodyColor = "#22c55e";

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(-8, -10, 16, 20, 4);
  ctx.fill();

  ctx.fillStyle =
    hitFlashTimer > 0 ? "#7f1d1d" : spawnFlashTimer > 0 ? "#14532d" : "#1e293b";
  ctx.fillRect(-6, -6, 12, 12);

  ctx.fillStyle =
    hitFlashTimer > 0 ? "#991b1b" : spawnFlashTimer > 0 ? "#166534" : "#0f172a";
  ctx.beginPath();
  ctx.arc(0, -2, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.fillStyle = "#000";
  if (weaponLevel < 4) {
    ctx.fillRect(4, -2, 8, 3);
    ctx.fillRect(4, 0, 3, 4);
  } else if (weaponLevel < 8) {
    ctx.fillRect(4, -3, 16, 4);
    ctx.fillRect(4, -1, 4, 6);
    ctx.fillStyle = "#333";
    ctx.fillRect(8, -5, 6, 3);
  } else if (weaponLevel < 13) {
    ctx.fillStyle = "#111";
    ctx.fillRect(4, -4, 18, 6);
    ctx.fillRect(4, 0, 5, 8);
    ctx.fillStyle = "#444";
    ctx.fillRect(10, 2, 6, 6);
  } else if (weaponLevel < 20) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(4, -5, 20, 8);
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(8, -3, 14, 4);
    ctx.shadowBlur = 5;
    ctx.shadowColor = "#3b82f6";
    ctx.strokeRect(8, -3, 14, 4);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(4, -6, 24, 10);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(6, -2, 20, 2);
    ctx.fillRect(6, 2, 20, 2);
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#facc15";
    ctx.fillRect(22, -4, 4, 8);
    ctx.shadowBlur = 0;
  }

  ctx.strokeStyle = isMain ? "#1e3a8a" : "#3b82f6";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(6, -4);
  ctx.lineTo(12, -2);
  ctx.stroke();

  ctx.restore();
};

const drawZombie = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: string,
  radius: number,
  frame: number,
  attackAnimTimer = 0,
  isLandscape = false,
  swayOverride?: number,
) => {
  ctx.save();

  const lunge = attackAnimTimer > 0 ? (10 - attackAnimTimer) * 2 : 0;
  if (isLandscape) {
    ctx.translate(x - lunge, y);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(x, y + lunge);
  }

  const sway =
    swayOverride !== undefined ? swayOverride : Math.sin(frame * 0.1) * 0.1;
  ctx.rotate(sway);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.5, radius * 1.2, radius * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  let bodyColor = "#166534";
  let skinColor = "#4ade80";

  if (type === "TANK") {
    bodyColor = "#064e3b";
    skinColor = "#10b981";
  } else if (type.startsWith("BOSS")) {
    bodyColor = "#4c1d95";
    skinColor = "#a78bfa";
  }

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(-radius * 0.8, -radius, radius * 1.6, radius * 2, 4);
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(-radius * 0.4, 0, radius * 0.2, radius * 0.5);

  ctx.fillStyle = skinColor;
  ctx.beginPath();
  const biteOffset =
    attackAnimTimer > 0 ? Math.sin(attackAnimTimer * 0.5) * 4 : 0;
  ctx.arc(0, -radius * 0.6 + biteOffset, radius * 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 5;
  ctx.shadowColor = "#ef4444";
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-radius * 0.3, -radius * 0.7 + biteOffset, 2.5, 0, Math.PI * 2);
  ctx.arc(radius * 0.3, -radius * 0.7 + biteOffset, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#000";
  ctx.beginPath();
  const mouthScale = attackAnimTimer > 0 ? 1.5 : 1;
  ctx.ellipse(
    0,
    -radius * 0.3 + biteOffset,
    radius * 0.3 * mouthScale,
    radius * 0.2 * mouthScale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = skinColor;
  const armSway = Math.sin(frame * 0.15) * 5;
  const attackReach = attackAnimTimer > 0 ? 10 : 0;
  ctx.fillRect(
    -radius * 1.1,
    -radius * 0.2 + armSway + attackReach,
    radius * 0.5,
    radius * 0.4,
  );
  ctx.fillRect(
    radius * 0.6,
    -radius * 0.2 - armSway + attackReach,
    radius * 0.5,
    radius * 0.4,
  );

  if (attackAnimTimer > 5) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
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

const isMobileDevice = () =>
  typeof window !== "undefined" &&
  (/Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent) ||
    navigator.maxTouchPoints > 1);

const generateMudPonds = (CW: number, CH: number, level = 1): MudPond[] => {
  const count = 2 + Math.floor(Math.random() * 4); // 2-5
  const ponds: MudPond[] = [];
  for (let i = 0; i < count; i++) {
    const radiusX = 30 + Math.random() * 25;
    const radiusY = 18 + Math.random() * 18;
    const margin = 80;
    const maxHealth = (60 + level * 20) * (0.8 + Math.random() * 0.4);
    ponds.push({
      x: margin + Math.random() * (CW - margin * 2),
      y: margin + Math.random() * (CH - margin * 2),
      radiusX,
      radiusY,
      health: maxHealth,
      maxHealth,
      id: nextId(),
      attackers: [],
    });
  }
  return ponds;
};

const generateHerbPatches = (CW: number, CH: number): HerbPatch[] =>
  Array.from({ length: 20 + Math.floor(Math.random() * 6) }, (_, i) => ({
    x: Math.random() * CW,
    y: Math.random() * CH,
    size: 6 + Math.random() * 12,
    rotation: Math.random() * Math.PI * 2,
    id: i,
    colors: Array.from({ length: 4 }, () =>
      Math.random() > 0.5 ? "#162b16" : "#1f401f",
    ),
  }));

const makeInitialState = (
  isStarted: boolean,
  landscape = false,
): GameState => ({
  playerX: CANVAS_WIDTH / 2,
  playerY: LAND_H / 2,
  health: 100,
  armySize: 1,
  weaponLevel: 15,
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
  mudPonds: generateMudPonds(
    landscape ? LAND_W : CANVAS_WIDTH,
    landscape ? LAND_H : CANVAS_HEIGHT,
  ),
  herbPatches: generateHerbPatches(
    landscape ? LAND_W : CANVAS_WIDTH,
    landscape ? LAND_H : CANVAS_HEIGHT,
  ),
  backgroundElements: Array.from({ length: 20 }, (_, i) => ({
    x: Math.random() * (landscape ? LAND_W : CANVAS_WIDTH),
    y: Math.random() * (landscape ? LAND_H : CANVAS_HEIGHT),
    type: (["RUBBLE", "CRACK", "WALL"] as const)[Math.floor(Math.random() * 3)],
    size: 10 + Math.random() * 30,
    rotation: Math.random() * Math.PI * 2,
    id: i,
  })),
  frame: 0,
  specialTimer: 9999999,
  activeSpecial: "EXPLOSIVE",
  bulletDamage: 1,
  isGameOver: false,
  isStarted,
  isVictory: false,
  isLevelTransition: false,
  flashTimer: 0,
  hitFlashTimer: 0,
  shootMode: "AIM",
  isAutoShoot: isMobileDevice(),
});

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Landscape / pause state (separate from GameState)
  const [isLandscape, setIsLandscape] = useState(
    () =>
      typeof window !== "undefined" && window.innerWidth > window.innerHeight,
  );
  const [isPaused, setIsPaused] = useState(false);

  const [gameState, setGameState] = useState<GameState>(
    makeInitialState(false),
  );

  // Leaderboard state
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const { data: topScores, refetch: refetchScores } = useGetTopScores();
  const submitScoreMutation = useSubmitScore();

  const requestRef = useRef<number>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgDirtyRef = useRef(true);
  const gameStateRef = useRef<GameState>(gameState);
  const uiSnapshotRef = useRef({
    score: 0,
    health: 100,
    armySize: 1,
    weaponLevel: 0,
    bulletDamage: 1.0,
    activeSpecial: "NONE" as string,
    isGameOver: false,
    isVictory: false,
    isLevelTransition: false,
    isStarted: false,
  });
  const isLandscapeRef = useRef(isLandscape);
  const isPausedRef = useRef(isPaused);
  const isSpacePressed = useRef(false);
  const isPointerDown = useRef(false);
  const isAKeyPressed = useRef(false);
  const isDKeyPressed = useRef(false);
  const isWKeyPressed = useRef(false);
  const isSKeyPressed = useRef(false);
  const mousePosRef = useRef({ x: CANVAS_WIDTH / 2, y: 0 });
  const moveTargetXRef = useRef(CANVAS_WIDTH / 2);
  const moveTargetYRef = useRef(LAND_H / 2);
  const touchActiveRef = useRef(false);
  const prevTouch0Ref = useRef<{ x: number; y: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const prevMouseRef = useRef<{ x: number; y: number } | null>(null);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const mouseMovedRef = useRef(false);
  const mouseButtonDownRef = useRef(false);
  const TOUCH_DEAD_ZONE = 6;

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    isLandscapeRef.current = isLandscape;
  }, [isLandscape]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Orientation change detection (mobile auto-detect + resize)
  useEffect(() => {
    const handleOrientationChange = () => {
      const landscape = window.innerWidth > window.innerHeight;
      if (landscape !== isLandscapeRef.current) {
        setIsLandscape(landscape);
        const state = gameStateRef.current;
        if (state.isStarted && !state.isGameOver && !state.isVictory) {
          setIsPaused(true);
        }
      }
    };
    window.addEventListener("resize", handleOrientationChange);
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => {
      window.removeEventListener("resize", handleOrientationChange);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed.current = true;
        e.preventDefault();
      }
      if (e.key.toLowerCase() === "a" || e.key === "ArrowLeft") {
        isAKeyPressed.current = true;
      }
      if (e.key.toLowerCase() === "d" || e.key === "ArrowRight") {
        isDKeyPressed.current = true;
      }
      if (e.key.toLowerCase() === "w" || e.key === "ArrowUp") {
        isWKeyPressed.current = true;
        e.preventDefault();
      }
      if (e.key.toLowerCase() === "s" || e.key === "ArrowDown") {
        isSKeyPressed.current = true;
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") isSpacePressed.current = false;
      if (e.key.toLowerCase() === "a" || e.key === "ArrowLeft")
        isAKeyPressed.current = false;
      if (e.key.toLowerCase() === "d" || e.key === "ArrowRight")
        isDKeyPressed.current = false;
      if (e.key.toLowerCase() === "w" || e.key === "ArrowUp")
        isWKeyPressed.current = false;
      if (e.key.toLowerCase() === "s" || e.key === "ArrowDown")
        isSKeyPressed.current = false;
    };
    const handlePointerDown = () => {
      isPointerDown.current = true;
    };
    const handlePointerUp = () => {
      isPointerDown.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const handleStartGame = () => {
    setScoreSubmitted(false);
    setPlayerName("");
    setIsPaused(false);
    bgDirtyRef.current = true;
    setGameState(makeInitialState(true, isLandscapeRef.current));
  };

  const startNextLevel = () => {
    bgDirtyRef.current = true;
    setGameState((prev) => ({
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
      mudPonds: generateMudPonds(
        isLandscapeRef.current ? LAND_W : CANVAS_WIDTH,
        isLandscapeRef.current ? LAND_H : CANVAS_HEIGHT,
        prev.level + 1,
      ),
      herbPatches: generateHerbPatches(
        isLandscapeRef.current ? LAND_W : CANVAS_WIDTH,
        isLandscapeRef.current ? LAND_H : CANVAS_HEIGHT,
      ),
      hitFlashTimer: 0,
    }));
  };

  const handleToggleLandscape = () => {
    const newLandscape = !isLandscape;
    setIsLandscape(newLandscape);
    const state = gameStateRef.current;
    if (state.isStarted && !state.isGameOver && !state.isVictory) {
      setIsPaused(true);
    }
  };

  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    const rect = canvas.getBoundingClientRect();
    const cw = isLandscapeRef.current ? LAND_W : CANVAS_WIDTH;
    const ch = isLandscapeRef.current ? LAND_H : CANVAS_HEIGHT;
    return {
      x: (clientX - rect.left) * (cw / rect.width),
      y: (clientY - rect.top) * (ch / rect.height),
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    mousePosRef.current = pos;
    if (
      mouseButtonDownRef.current &&
      prevMouseRef.current &&
      mouseStartRef.current
    ) {
      if (!mouseMovedRef.current) {
        const dist = Math.sqrt(
          (pos.x - mouseStartRef.current.x) ** 2 +
            (pos.y - mouseStartRef.current.y) ** 2,
        );
        if (dist > TOUCH_DEAD_ZONE) mouseMovedRef.current = true;
      }
      if (mouseMovedRef.current) {
        const dx = pos.x - prevMouseRef.current.x;
        const dy = pos.y - prevMouseRef.current.y;
        const state = gameStateRef.current;
        if (isLandscapeRef.current) {
          const curY = state.playerY ?? LAND_H / 2;
          moveTargetYRef.current = Math.max(
            UNIT_RADIUS,
            Math.min(LAND_H - UNIT_RADIUS, curY + dy),
          );
        } else {
          moveTargetXRef.current = Math.max(
            UNIT_RADIUS,
            Math.min(CANVAS_WIDTH - UNIT_RADIUS, state.playerX + dx),
          );
        }
      }
    }
    prevMouseRef.current = pos;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e.clientX, e.clientY);
    mouseButtonDownRef.current = true;
    mouseStartRef.current = pos;
    prevMouseRef.current = pos;
    mouseMovedRef.current = false;
    if (isPausedRef.current) {
      setIsPaused(false);
    }
  };

  const handleMouseUp = () => {
    mouseButtonDownRef.current = false;
    prevMouseRef.current = null;
    mouseStartRef.current = null;
    mouseMovedRef.current = false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    if (isPausedRef.current) {
      setIsPaused(false);
      return;
    }
    touchActiveRef.current = true;
    if (e.touches.length >= 1) {
      const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      prevTouch0Ref.current = pos;
      touchStartRef.current = pos;
      touchMovedRef.current = false;
    }
    if (e.touches.length >= 2) {
      const pos = getCanvasPos(e.touches[1].clientX, e.touches[1].clientY);
      mousePosRef.current = pos;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    touchActiveRef.current = e.touches.length > 0;
    if (e.touches.length >= 1) {
      const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      const prev = prevTouch0Ref.current;
      const start = touchStartRef.current;
      if (prev && start) {
        if (!touchMovedRef.current) {
          const dist = Math.sqrt(
            (pos.x - start.x) ** 2 + (pos.y - start.y) ** 2,
          );
          if (dist > TOUCH_DEAD_ZONE) touchMovedRef.current = true;
        }
        if (touchMovedRef.current) {
          const dx = pos.x - prev.x;
          const dy = pos.y - prev.y;
          const state = gameStateRef.current;
          if (isLandscapeRef.current) {
            const curY = state.playerY ?? LAND_H / 2;
            moveTargetYRef.current = Math.max(
              UNIT_RADIUS,
              Math.min(LAND_H - UNIT_RADIUS, curY + dy),
            );
          } else {
            moveTargetXRef.current = Math.max(
              UNIT_RADIUS,
              Math.min(CANVAS_WIDTH - UNIT_RADIUS, state.playerX + dx),
            );
          }
        }
      }
      prevTouch0Ref.current = pos;
    }
    if (e.touches.length >= 2) {
      const pos = getCanvasPos(e.touches[1].clientX, e.touches[1].clientY);
      mousePosRef.current = pos;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    touchActiveRef.current = e.touches.length > 0;
    if (e.touches.length === 0) {
      prevTouch0Ref.current = null;
      touchStartRef.current = null;
      touchMovedRef.current = false;
    } else {
      const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      prevTouch0Ref.current = pos;
      touchStartRef.current = pos;
      touchMovedRef.current = false;
      if (e.touches.length >= 2) {
        const pos2 = getCanvasPos(e.touches[1].clientX, e.touches[1].clientY);
        mousePosRef.current = pos2;
      }
    }
  };

  const handleCanvasClick = () => {
    if (isPausedRef.current) {
      setIsPaused(false);
    }
  };

  const update = () => {
    const gs = gameStateRef.current;
    if (!gs.isStarted || gs.isGameOver) return;

    if (isPausedRef.current) {
      requestRef.current = requestAnimationFrame(update);
      return;
    }

    const landscape = isLandscapeRef.current;
    const CW = landscape ? LAND_W : CANVAS_WIDTH;
    const CH = landscape ? LAND_H : CANVAS_HEIGHT;

    // Work directly on gameStateRef.current (no shallow copy)
    const newState = gs;
    const currentGateSpeed = GATE_SPEED * (1 + (newState.level - 1) * 0.15);
    const currentZombieSpeedBase =
      ZOMBIE_SPEED_BASE * (1 + (newState.level - 1) * 0.1);

    newState.frame++;
    if (newState.flashTimer > 0) newState.flashTimer--;
    if (newState.hitFlashTimer > 0) newState.hitFlashTimer--;

    for (const s of newState.dyingSoldiers) s.life--;
    newState.dyingSoldiers = newState.dyingSoldiers.filter((s) => s.life > 0);

    for (const f of newState.spawnFlashes) f.life--;
    newState.spawnFlashes = newState.spawnFlashes.filter((f) => f.life > 0);

    if (newState.specialTimer > 0) {
      newState.specialTimer--;
      if (newState.specialTimer === 0) newState.activeSpecial = "NONE";
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
      const noZombies = newState.zombies.length === 0;
      const noGates = newState.gates.length === 0;
      if (noZombies && noGates) {
        if (newState.level < 5) {
          newState.isLevelTransition = true;
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
      const currentSpawnRate = Math.max(
        30,
        SPAWN_RATE_ZOMBIE - (newState.level - 1) * 8,
      );
      if (
        newState.frame %
          (isGracePeriod ? currentSpawnRate * 2 : currentSpawnRate) ===
        0
      ) {
        const isBossSpawn =
          !isGracePeriod &&
          newState.frame % (currentSpawnRate * 10) === 0 &&
          newState.level >= 2;

        if (isBossSpawn) {
          const isGiant = Math.random() > 0.5;
          const levelScale = 1 + (newState.level - 1) * 0.2;
          newState.zombies.push({
            x: landscape ? CW + 50 : Math.random() * (CANVAS_WIDTH - 100) + 50,
            y: landscape ? Math.random() * (CH - 100) + 50 : -50,
            health: isGiant ? 600 * levelScale : 120 * levelScale,
            maxHealth: isGiant ? 600 * levelScale : 120 * levelScale,
            speed: currentZombieSpeedBase * (isGiant ? 0.4 : 0.7),
            radius: isGiant
              ? UNIT_RADIUS * 4 * levelScale
              : UNIT_RADIUS * 2.5 * levelScale,
            type: isGiant ? "BOSS_GIANT" : "BOSS_RANGED",
            id: nextId(),
            shootTimer: isGiant ? undefined : 60,
          });
        } else {
          const armyScale = Math.max(
            0.5,
            Math.min(2.0, newState.armySize / 15),
          );
          const baseHordeSize =
            Math.floor(Math.random() * 5) +
            3 +
            Math.floor(newState.level * 0.8);
          const hordeSize = Math.floor(baseHordeSize * armyScale);

          const spawnCenterX = landscape
            ? CW + 50 + Math.random() * 50
            : Math.random() * (CANVAS_WIDTH - 100) + 50;
          const spawnCenterY = landscape
            ? Math.random() * (CH - 100) + 50
            : -50;

          for (let i = 0; i < hordeSize; i++) {
            const isTank = Math.random() > 0.9;
            const isSmall = Math.random() < 0.4;
            const levelScale = isSmall ? 1 : 1 + (newState.level - 1) * 0.15;
            const baseRadius = isTank ? UNIT_RADIUS * 1.5 : UNIT_RADIUS;
            const armyHealthScale = Math.max(
              0.6,
              Math.min(2.5, newState.armySize / 10),
            );
            const health =
              (isTank ? 15 : 5) *
              (1 + (newState.level - 1) * 0.2) *
              armyHealthScale;
            newState.zombies.push({
              x: landscape
                ? spawnCenterX + Math.random() * 50
                : spawnCenterX + (Math.random() - 0.5) * 80,
              y: landscape
                ? spawnCenterY + (Math.random() - 0.5) * 80
                : spawnCenterY - Math.random() * 50,
              health,
              maxHealth: health,
              speed:
                currentZombieSpeedBase *
                (isTank ? 0.6 : 1) *
                (1 + (newState.level - 1) * 0.12),
              radius: baseRadius * levelScale,
              type: isTank ? "TANK" : "NORMAL",
              id: nextId(),
            });
          }
        }
      }

      const currentGateRate = Math.max(
        180,
        SPAWN_RATE_GATE - (newState.level - 1) * 30,
      );
      if (newState.frame % currentGateRate === 0) {
        const isChoicePair = Math.random() > 0.5;

        if (isChoicePair) {
          const pairId = nextId();
          let positiveChance = 0.6;
          if (newState.armySize < 10) positiveChance = 0.85;
          if (newState.armySize > 35) positiveChance = 0.4;
          if (isGracePeriod) positiveChance = 1.0;

          const isPositive = Math.random() < positiveChance;
          const leftIsPrimary = Math.random() > 0.5;
          const typeA: GateType = isPositive ? "ADD" : "SUB";
          const typeB: GateType = isPositive ? "MULT" : "DIV";

          const valA = isPositive
            ? Math.min(15, Math.floor(newState.armySize * 0.4) + 8)
            : -(
                Math.floor(
                  newState.armySize * (Math.random() > 0.8 ? 2.5 : 1.2),
                ) + 20
              );
          const valB = isPositive
            ? Math.random() > 0.8
              ? 3
              : 2
            : newState.armySize > 30
              ? 3
              : 2;

          const finalValA = isGracePeriod && !isPositive ? -5 : valA;
          const finalValB = isGracePeriod && !isPositive ? 2 : valB;

          const gateWidth = landscape ? 120 : 180;

          if (landscape) {
            const gateX = CW + 100;
            newState.gates.push({
              x: gateX,
              y: CH * 0.25,
              type: leftIsPrimary ? typeA : typeB,
              value: leftIsPrimary ? finalValA : finalValB,
              width: gateWidth,
              id: nextId(),
              pairId,
            });
            newState.gates.push({
              x: gateX,
              y: CH * 0.75,
              type: leftIsPrimary ? typeB : typeA,
              value: leftIsPrimary ? finalValB : finalValA,
              width: gateWidth,
              id: nextId(),
              pairId,
            });
          } else {
            newState.gates.push({
              x: 100,
              y: -100,
              type: leftIsPrimary ? typeA : typeB,
              value: leftIsPrimary ? finalValA : finalValB,
              width: gateWidth,
              id: nextId(),
              pairId,
            });
            newState.gates.push({
              x: 300,
              y: -100,
              type: leftIsPrimary ? typeB : typeA,
              value: leftIsPrimary ? finalValB : finalValA,
              width: gateWidth,
              id: nextId(),
              pairId,
            });
          }
        } else {
          const types: GateType[] = [
            "ADD",
            "SUB",
            "MULT",
            "DIV",
            "SPECIAL",
            "TRAP",
            "UPGRADE",
            "RATE_UPGRADE",
          ];
          let type = types[Math.floor(Math.random() * types.length)];

          if (isGracePeriod) {
            type = Math.random() > 0.5 ? "ADD" : "MULT";
          } else if (newState.armySize < 10) {
            if (["SUB", "DIV", "TRAP"].includes(type) && Math.random() > 0.3) {
              type = Math.random() > 0.5 ? "ADD" : "MULT";
            }
          } else if (newState.armySize > 35) {
            if (
              ["ADD", "MULT", "UPGRADE", "RATE_UPGRADE"].includes(type) &&
              Math.random() > 0.4
            ) {
              type = Math.random() > 0.5 ? "SUB" : "DIV";
            }
          }

          if (
            (type === "UPGRADE" ||
              type === "RATE_UPGRADE" ||
              type === "SPECIAL") &&
            Math.random() > 0.4
          ) {
            type = Math.random() > 0.5 ? "ADD" : "SUB";
          }

          let value = 0;
          if (type === "ADD")
            value = Math.min(15, Math.floor(newState.armySize * 0.3) + 4);
          if (type === "SUB")
            value = -(
              Math.floor(
                newState.armySize * (Math.random() > 0.7 ? 2.0 : 1.0),
              ) + 20
            );
          if (type === "MULT") value = 2;
          if (type === "DIV") value = newState.armySize > 30 ? 3 : 2;
          if (type === "SPECIAL")
            value = 10 + Math.floor(newState.armySize * 0.5);
          if (type === "TRAP") value = -1;
          if (type === "UPGRADE") value = 30 + Math.floor(newState.level * 15);
          if (type === "RATE_UPGRADE")
            value = 25 + Math.floor(newState.level * 10);

          newState.gates.push({
            x: landscape ? CW + 100 : Math.random() * (CANVAS_WIDTH - 150) + 75,
            y: landscape ? Math.random() * (CH * 0.6) + CH * 0.2 : -100,
            type,
            value,
            width: 120,
            id: nextId(),
          });
        }
      }
    }

    // --- Movement Logic ---
    if (landscape) {
      const curY = newState.playerY ?? LAND_H / 2;
      if (isWKeyPressed.current) {
        newState.playerY = Math.max(UNIT_RADIUS, curY - PLAYER_SPEED);
      } else if (isSKeyPressed.current) {
        newState.playerY = Math.min(CH - UNIT_RADIUS, curY + PLAYER_SPEED);
      } else if (isPointerDown.current || touchActiveRef.current) {
        newState.playerY = Math.max(
          UNIT_RADIUS,
          Math.min(CH - UNIT_RADIUS, moveTargetYRef.current),
        );
      }
      const targetY = newState.playerY ?? LAND_H / 2;
      if (newState.smoothPlayerY === undefined)
        newState.smoothPlayerY = targetY;
      newState.smoothPlayerY += (targetY - newState.smoothPlayerY) * 0.15;
    } else {
      if (isAKeyPressed.current) {
        newState.playerX = Math.max(
          UNIT_RADIUS,
          newState.playerX - PLAYER_SPEED,
        );
      } else if (isDKeyPressed.current) {
        newState.playerX = Math.min(
          CANVAS_WIDTH - UNIT_RADIUS,
          newState.playerX + PLAYER_SPEED,
        );
      } else if (isPointerDown.current || touchActiveRef.current) {
        const targetX = Math.max(
          UNIT_RADIUS,
          Math.min(CANVAS_WIDTH - UNIT_RADIUS, moveTargetXRef.current),
        );
        newState.playerX = targetX;
      }
      const targetX = newState.playerX;
      if (newState.smoothPlayerX === undefined)
        newState.smoothPlayerX = targetX;
      newState.smoothPlayerX += (targetX - newState.smoothPlayerX) * 0.15;
    }

    const curSmoothX = newState.smoothPlayerX ?? newState.playerX;
    const curSmoothY = newState.smoothPlayerY ?? newState.playerY ?? LAND_H / 2;

    // Cache army positions once per frame (expensive trig)
    const cachedArmyPositions = getArmyPositions(
      curSmoothX,
      newState.armySize,
      landscape,
      curSmoothY,
    );

    // --- Shooting Logic ---
    const shootInterval = Math.max(3, 25 - newState.weaponLevel * 2);
    if (
      (isSpacePressed.current ||
        isPointerDown.current ||
        newState.isAutoShoot) &&
      newState.frame % shootInterval === 0
    ) {
      const positions = cachedArmyPositions;
      const mouseX = mousePosRef.current.x;
      const mouseY = mousePosRef.current.y;

      // biome-ignore lint/complexity/noForEach: game loop performance
      positions.forEach((pos) => {
        let baseAngle: number;
        if (newState.shootMode === "STRAIGHT") {
          baseAngle = landscape ? 0 : -Math.PI / 2;
        } else {
          const dx = mouseX - pos.x;
          const dy = mouseY - pos.y;
          baseAngle = Math.atan2(dy, dx);
        }
        const spreadAmount = newState.shootMode === "STRAIGHT" ? 0.4 : 0.25;
        const angle = baseAngle + (Math.random() - 0.5) * spreadAmount;
        newState.bullets.push({
          x: pos.x,
          y: pos.y,
          vx: Math.cos(angle) * BULLET_SPEED,
          vy: Math.sin(angle) * BULLET_SPEED,
          specialType: newState.activeSpecial,
          life: 0,
          id: nextId(),
          hitGateIds: [],
        });
      });
    }

    // --- Update Entities ---
    // Boss Shooting Logic
    // biome-ignore lint/complexity/noForEach: game loop performance
    newState.zombies.forEach((z) => {
      if (z.type === "BOSS_RANGED" && z.shootTimer !== undefined) {
        z.shootTimer--;
        if (z.shootTimer <= 0) {
          z.shootTimer = 90;
          const targetX = landscape ? PLAYER_LAND_X : newState.playerX;
          const targetY = landscape ? curSmoothY : PLAYER_Y;
          const dx = targetX - z.x;
          const dy = targetY - z.y;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = 4;
          newState.zombieBullets.push({
            x: z.x,
            y: z.y,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
            id: nextId(),
            health: 5,
            maxHealth: 5,
          });
        }
      }
    });

    for (const b of newState.bullets) {
      let nx = b.x + b.vx;
      let ny = b.y + b.vy;
      if (b.specialType === "CURVED") {
        const speed = Math.hypot(b.vx, b.vy);
        const perpX = -b.vy / speed;
        const perpY = b.vx / speed;
        const curveAmount = Math.sin(b.life * 0.2) * 4;
        nx += perpX * curveAmount;
        ny += perpY * curveAmount;
      }
      b.x = nx;
      b.y = ny;
      b.life++;
    }
    newState.bullets = newState.bullets.filter(
      (b) => b.y > -20 && b.y < CH + 20 && b.x > -20 && b.x < CW + 20,
    );

    // --- Mud Pond Logic: reset attackers ---
    for (const p of newState.mudPonds) p.attackers.length = 0;

    for (const z of newState.zombies) {
      let effectiveSpeed = z.speed;
      let stoppedByPond = false;

      for (const pond of newState.mudPonds) {
        if (pond.health <= 0) continue;
        const dx = z.x - pond.x;
        const dy = z.y - pond.y;
        const normDist = Math.sqrt(
          (dx / pond.radiusX) ** 2 + (dy / pond.radiusY) ** 2,
        );
        const innerNorm = 1.0;
        const outerNorm = 2.2;
        if (normDist <= innerNorm) {
          stoppedByPond = true;
          pond.attackers.push({ x: z.x, y: z.y });
          pond.health -= 0.4 / Math.max(1, pond.attackers.length * 0.5);
          break;
        }
        if (normDist <= outerNorm) {
          const factor = (normDist - innerNorm) / (outerNorm - innerNorm);
          effectiveSpeed = z.speed * (0.15 + factor * 0.85);
        }
      }

      if (stoppedByPond) {
        z.attackAnimTimer = 10;
      } else {
        if (landscape) z.x -= effectiveSpeed;
        else z.y += effectiveSpeed;
        z.attackAnimTimer =
          (z.attackAnimTimer || 0) > 0 ? z.attackAnimTimer! - 1 : 0;
      }
    }
    newState.zombies = newState.zombies.filter((z) => {
      const escaped = landscape ? z.x <= 0 : z.y >= CANVAS_HEIGHT;
      if (escaped) {
        newState.health -= 5;
        return false;
      }
      return true;
    });

    // Remove destroyed ponds
    newState.mudPonds = newState.mudPonds.filter((p) => p.health > 0);

    for (const b of newState.zombieBullets) {
      b.x += b.vx;
      b.y += b.vy;
    }
    newState.zombieBullets = newState.zombieBullets.filter(
      (b) => b.y < CH + 50 && b.y > -50 && b.x > -50 && b.x < CW + 50,
    );

    for (const g of newState.gates) {
      if (landscape) g.x -= currentGateSpeed;
      else g.y += currentGateSpeed;
      if (g.bulletHitFlash && g.bulletHitFlash > 0) g.bulletHitFlash--;
      else g.bulletHitFlash = 0;
    }
    newState.gates = newState.gates.filter((g) =>
      landscape ? g.x > -100 : g.y < CANVAS_HEIGHT + 100,
    );

    for (const e of newState.explosions) e.radius += 2;
    newState.explosions = newState.explosions.filter(
      (e) => e.radius < e.maxRadius,
    );
    if (newState.explosions.length > 30)
      newState.explosions = newState.explosions.slice(-30);

    for (const t of newState.floatingTexts) {
      t.y -= 1;
      t.life -= 0.02;
    }
    newState.floatingTexts = newState.floatingTexts.filter((t) => t.life > 0);

    // Bullets vs Zombies
    const zombieGrid = buildZombieGrid(newState.zombies, 80);
    newState.bullets = newState.bullets.filter((b) => {
      let hit = false;
      const nearbyZombies = getNearbyZombies(zombieGrid, b.x, b.y, 80);
      for (const z of newState.zombies) {
        if (!nearbyZombies.includes(z)) continue;
        const dist = Math.hypot(b.x - z.x, b.y - z.y);
        if (dist < z.radius + 5 && !hit) {
          hit = true;
          const damage =
            (1 + newState.weaponLevel * 0.5) * newState.bulletDamage;
          const splashRadius = b.specialType === "EXPLOSIVE" ? 60 : 15;
          newState.explosions.push({
            x: b.x,
            y: b.y,
            radius: 2,
            maxRadius: splashRadius,
            id: nextId(),
          });
          if (b.specialType === "EXPLOSIVE") {
            for (const oz of newState.zombies) {
              if (oz === z) continue;
              const sd = Math.hypot(oz.x - b.x, oz.y - b.y);
              if (sd < splashRadius)
                oz.health -= damage * (1 - sd / splashRadius);
            }
          }
          z.health -= damage;
        }
      }
      return !hit;
    });

    // Bullets vs Zombie Bullets
    newState.bullets = newState.bullets.filter((b) => {
      let hit = false;
      for (const zb of newState.zombieBullets) {
        const dist = Math.hypot(b.x - zb.x, b.y - zb.y);
        if (dist < 15 && !hit) {
          hit = true;
          const damage =
            (1 + newState.weaponLevel * 0.5) * newState.bulletDamage;
          newState.explosions.push({
            x: b.x,
            y: b.y,
            radius: 2,
            maxRadius: b.specialType === "EXPLOSIVE" ? 60 : 15,
            id: nextId(),
          });
          zb.health -= damage;
        }
      }
      return !hit;
    });

    newState.zombieBullets = newState.zombieBullets.filter(
      (zb) => zb.health > 0,
    );

    // Bullets vs Gates
    newState.bullets = newState.bullets.map((b) => {
      const updatedBullet = { ...b };
      newState.gates = newState.gates.map((g) => {
        const inX = landscape
          ? b.x > g.x - 20 && b.x < g.x + 20
          : b.x > g.x - g.width / 2 && b.x < g.x + g.width / 2;
        const inY = landscape
          ? b.y > g.y - g.width / 2 && b.y < g.y + g.width / 2
          : b.y > g.y - 20 && b.y < g.y + 20;
        const alreadyHit = b.hitGateIds?.includes(g.id);
        if (inX && inY && !alreadyHit) {
          if (!updatedBullet.hitGateIds) updatedBullet.hitGateIds = [];
          updatedBullet.hitGateIds.push(g.id);
          const updatedG = { ...g, bulletHitFlash: 8 };
          if (g.type === "ADD" || g.type === "SUB") {
            const newProgress = (g.hitProgress || 0) + 1;
            if (newProgress >= 2)
              return {
                ...updatedG,
                value: Math.min(15, g.value + 1),
                hitProgress: 0,
              };
            return { ...updatedG, hitProgress: newProgress };
          }
          if (g.type === "SPECIAL") return { ...updatedG, value: g.value - 1 };
          if (g.type === "UPGRADE") {
            const newValue = g.value - 1;
            if (newValue <= 0) {
              newState.bulletDamage += 0.5;
              newState.flashTimer = 10;
              return { ...updatedG, value: 0 };
            }
            return { ...updatedG, value: newValue };
          }
          if (g.type === "RATE_UPGRADE") {
            const newValue = g.value - 1;
            if (newValue <= 0) {
              newState.weaponLevel++;
              newState.flashTimer = 10;
              return { ...updatedG, value: 0 };
            }
            return { ...updatedG, value: newValue };
          }
          if (g.type === "TRAP") {
            const penaltyTaken = g.trapPenaltyTaken || 0;
            if (penaltyTaken < 10) {
              const currentPositions = cachedArmyPositions;
              const pos = currentPositions[currentPositions.length - 1];
              if (pos) {
                const angle = Math.atan2(
                  mousePosRef.current.y - pos.y,
                  mousePosRef.current.x - pos.x,
                );
                newState.dyingSoldiers.push({
                  x: pos.x,
                  y: pos.y,
                  angle,
                  life: 30,
                  id: nextId(),
                });
              }
              newState.armySize = Math.max(1, newState.armySize - 1);
              return { ...updatedG, trapPenaltyTaken: penaltyTaken + 1 };
            }
            return updatedG;
          }
          return updatedG;
        }
        return g;
      });
      return updatedBullet;
    });

    newState.gates = newState.gates.filter(
      (g) =>
        !((g.type === "UPGRADE" || g.type === "RATE_UPGRADE") && g.value <= 0),
    );

    const initialZombieCount = newState.zombies.length;
    newState.zombies = newState.zombies.filter((z) => z.health > 0);
    newState.score += (initialZombieCount - newState.zombies.length) * 10;

    const applyDamage = (amount: number) => {
      newState.hitFlashTimer = 10;
      if (newState.armySize > 1) {
        const newSize = Math.max(1, newState.armySize - amount);
        const removedCount =
          Math.floor(newState.armySize) - Math.floor(newSize);
        if (removedCount > 0) {
          const currentPositions = cachedArmyPositions;
          for (let i = 0; i < removedCount; i++) {
            const pos = currentPositions[currentPositions.length - 1 - i];
            if (pos) {
              const angle = Math.atan2(
                mousePosRef.current.y - pos.y,
                mousePosRef.current.x - pos.x,
              );
              newState.dyingSoldiers.push({
                x: pos.x,
                y: pos.y,
                angle,
                life: 30,
                id: nextId(),
              });
            }
          }
        }
        newState.armySize = newSize;
      } else {
        newState.health -= amount;
      }
    };

    const armyPositions = cachedArmyPositions;

    for (const z of newState.zombies) {
      const hitUnit = armyPositions.some(
        (pos) => Math.hypot(pos.x - z.x, pos.y - z.y) < z.radius + UNIT_RADIUS,
      );
      if (hitUnit) {
        let damage = 0.2;
        if (z.type === "TANK") damage = 0.5;
        if (z.type === "BOSS_GIANT") damage = 2.0;
        if (z.type === "BOSS_RANGED") damage = 1.0;
        applyDamage(damage);
        z.attackAnimTimer = 10;
      }
    }

    newState.zombieBullets = newState.zombieBullets.filter((b) => {
      const hitUnit = armyPositions.some(
        (pos) => Math.hypot(pos.x - b.x, pos.y - b.y) < 15,
      );
      if (hitUnit) {
        applyDamage(1.5);
        return false;
      }
      return true;
    });

    // Player vs Gates
    let hitPairId: number | undefined = undefined;
    newState.gates = newState.gates.filter((g) => {
      const hitGate = landscape
        ? armyPositions.some(
            (pos) =>
              Math.abs(pos.x - g.x) < 28 &&
              Math.abs(pos.y - g.y) < g.width / 2 + 8,
          )
        : armyPositions.some(
            (pos) =>
              Math.abs(pos.x - g.x) < g.width / 2 + 8 &&
              Math.abs(pos.y - g.y) < 28,
          );

      if (hitGate) {
        if (g.type === "UPGRADE") return true;
        if (g.type === "ADD" || g.type === "SUB") {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 0) {
            const bonus = g.value * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: "#facc15",
              life: 1.0,
              id: nextId(),
            });
          }
          if (g.value < 0) {
            const currentPositions = cachedArmyPositions;
            const newSize = Math.max(1, newState.armySize + g.value);
            const removedCount =
              Math.floor(newState.armySize) - Math.floor(newSize);
            if (removedCount > 0) {
              for (let i = 0; i < removedCount; i++) {
                const pos = currentPositions[currentPositions.length - 1 - i];
                if (pos) {
                  const angle = Math.atan2(
                    mousePosRef.current.y - pos.y,
                    mousePosRef.current.x - pos.x,
                  );
                  newState.dyingSoldiers.push({
                    x: pos.x,
                    y: pos.y,
                    angle,
                    life: 30,
                    id: nextId(),
                  });
                }
              }
            }
          }
          if (g.value > 0) {
            const oldSize = Math.floor(newState.armySize);
            const newSize = Math.floor(
              Math.min(MAX_ARMY_SIZE, newState.armySize + g.value),
            );
            for (let i = oldSize; i < newSize; i++) {
              newState.spawnFlashes.push({ index: i, life: 30 });
            }
          }
          newState.armySize = Math.min(
            MAX_ARMY_SIZE,
            Math.max(1, newState.armySize + g.value),
          );
        } else if (g.type === "MULT") {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 1) {
            const bonus = newState.armySize * (g.value - 1) * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: "#facc15",
              life: 1.0,
              id: nextId(),
            });
          }
          if (g.value > 1) {
            const oldSize = Math.floor(newState.armySize);
            const newSize = Math.floor(
              Math.min(MAX_ARMY_SIZE, newState.armySize * g.value),
            );
            for (let i = oldSize; i < newSize; i++) {
              newState.spawnFlashes.push({ index: i, life: 30 });
            }
          }
          newState.armySize = Math.min(
            MAX_ARMY_SIZE,
            newState.armySize * g.value,
          );
        } else if (g.type === "DIV") {
          if (newState.armySize >= MAX_ARMY_SIZE && g.value > 1) {
            const bonus =
              (newState.armySize - newState.armySize / g.value) * 10;
            newState.score += bonus;
            newState.floatingTexts.push({
              x: g.x,
              y: g.y,
              text: `+${bonus} PTS`,
              color: "#facc15",
              life: 1.0,
              id: nextId(),
            });
          }
          if (g.value > 1) {
            const currentPositions = cachedArmyPositions;
            const newSize = Math.max(1, newState.armySize / g.value);
            const removedCount =
              Math.floor(newState.armySize) - Math.floor(newSize);
            if (removedCount > 0) {
              for (let i = 0; i < removedCount; i++) {
                const pos = currentPositions[currentPositions.length - 1 - i];
                if (pos) {
                  const angle = Math.atan2(
                    mousePosRef.current.y - pos.y,
                    mousePosRef.current.x - pos.x,
                  );
                  newState.dyingSoldiers.push({
                    x: pos.x,
                    y: pos.y,
                    angle,
                    life: 30,
                    id: nextId(),
                  });
                }
              }
            }
          }
          newState.armySize = Math.max(
            1,
            Math.floor(newState.armySize / g.value),
          );
        } else if (g.type === "SPECIAL" && g.value <= 0) {
          const specials: ("CURVED" | "EXPLOSIVE")[] = ["CURVED", "EXPLOSIVE"];
          newState.activeSpecial =
            specials[Math.floor(Math.random() * specials.length)];
          newState.weaponLevel++;
          newState.specialTimer = 20 * 60;
        } else if (g.type === "TRAP") {
          const currentPositions = cachedArmyPositions;
          const newSize = Math.max(
            1,
            newState.armySize - Math.floor(newState.armySize * 0.5),
          );
          const removedCount =
            Math.floor(newState.armySize) - Math.floor(newSize);
          if (removedCount > 0) {
            for (let i = 0; i < removedCount; i++) {
              const pos = currentPositions[currentPositions.length - 1 - i];
              if (pos) {
                const angle = Math.atan2(
                  mousePosRef.current.y - pos.y,
                  mousePosRef.current.x - pos.x,
                );
                newState.dyingSoldiers.push({
                  x: pos.x,
                  y: pos.y,
                  angle,
                  life: 30,
                  id: nextId(),
                });
              }
            }
          }
          newState.armySize = newSize;
          applyDamage(10);
        }
        if (g.pairId) hitPairId = g.pairId;
        return false;
      }
      return true;
    });

    if (hitPairId !== undefined) {
      newState.gates = newState.gates.filter((g) => g.pairId !== hitPairId);
    }

    if (newState.health <= 0) newState.isGameOver = true;

    // Only re-render React when UI-visible fields actually change
    const snap = uiSnapshotRef.current;
    if (
      snap.score !== newState.score ||
      snap.health !== newState.health ||
      snap.armySize !== newState.armySize ||
      snap.weaponLevel !== newState.weaponLevel ||
      snap.bulletDamage !== newState.bulletDamage ||
      snap.activeSpecial !== newState.activeSpecial ||
      snap.isGameOver !== newState.isGameOver ||
      snap.isVictory !== newState.isVictory ||
      snap.isLevelTransition !== newState.isLevelTransition ||
      snap.isStarted !== newState.isStarted
    ) {
      uiSnapshotRef.current = {
        score: newState.score,
        health: newState.health,
        armySize: newState.armySize,
        weaponLevel: newState.weaponLevel,
        bulletDamage: newState.bulletDamage,
        activeSpecial: newState.activeSpecial,
        isGameOver: newState.isGameOver,
        isVictory: newState.isVictory,
        isLevelTransition: newState.isLevelTransition,
        isStarted: newState.isStarted,
      };
      setGameState({ ...newState });
    }
    requestRef.current = requestAnimationFrame(update);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: game loop ref pattern
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CW = isLandscape ? LAND_W : CANVAS_WIDTH;
    const CH = isLandscape ? LAND_H : CANVAS_HEIGHT;

    // --- Offscreen background cache ---
    if (
      bgDirtyRef.current ||
      !bgCanvasRef.current ||
      bgCanvasRef.current.width !== CW ||
      bgCanvasRef.current.height !== CH
    ) {
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = CW;
      bgCanvas.height = CH;
      bgCanvasRef.current = bgCanvas;
      const bgCtx = bgCanvas.getContext("2d")!;

      bgCtx.fillStyle = "#111";
      bgCtx.fillRect(0, 0, CW, CH);

      bgCtx.strokeStyle = "#222";
      bgCtx.lineWidth = 1;
      for (let x = 0; x <= CW; x += 40) {
        bgCtx.beginPath();
        bgCtx.moveTo(x, 0);
        bgCtx.lineTo(x, CH);
        bgCtx.stroke();
      }
      for (let y = 0; y <= CH; y += 40) {
        bgCtx.beginPath();
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(CW, y);
        bgCtx.stroke();
      }

      // biome-ignore lint/complexity/noForEach: game loop performance
      gameState.backgroundElements.forEach((el) => {
        bgCtx.save();
        bgCtx.translate(el.x, el.y);
        bgCtx.rotate(el.rotation);
        bgCtx.globalAlpha = 0.3;
        if (el.type === "RUBBLE") {
          bgCtx.fillStyle = "#444";
          bgCtx.beginPath();
          bgCtx.moveTo(-el.size / 2, -el.size / 2);
          bgCtx.lineTo(el.size / 2, -el.size / 3);
          bgCtx.lineTo(el.size / 3, el.size / 2);
          bgCtx.lineTo(-el.size / 3, el.size / 3);
          bgCtx.closePath();
          bgCtx.fill();
        } else if (el.type === "CRACK") {
          bgCtx.strokeStyle = "#333";
          bgCtx.lineWidth = 2;
          bgCtx.beginPath();
          bgCtx.moveTo(-el.size / 2, 0);
          bgCtx.lineTo(0, el.size / 4);
          bgCtx.lineTo(el.size / 2, -el.size / 4);
          bgCtx.stroke();
        } else if (el.type === "WALL") {
          bgCtx.fillStyle = "#222";
          bgCtx.fillRect(-el.size / 2, -el.size / 4, el.size, el.size / 2);
          bgCtx.strokeStyle = "#333";
          bgCtx.strokeRect(-el.size / 2, -el.size / 4, el.size, el.size / 2);
        }
        bgCtx.restore();
      });

      // Draw herb patches
      // biome-ignore lint/complexity/noForEach: game loop performance
      gameState.herbPatches.forEach((patch) => {
        bgCtx.save();
        bgCtx.translate(patch.x, patch.y);
        bgCtx.globalAlpha = 0.55;
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 + patch.rotation;
          const bx = Math.cos(angle) * patch.size * 0.3;
          const by = Math.sin(angle) * patch.size * 0.3;
          bgCtx.fillStyle = patch.colors[i];
          bgCtx.beginPath();
          bgCtx.ellipse(
            bx,
            by,
            patch.size * 0.15,
            patch.size * 0.42,
            angle,
            0,
            Math.PI * 2,
          );
          bgCtx.fill();
        }
        bgCtx.restore();
      });

      bgDirtyRef.current = false;
    }

    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(bgCanvasRef.current, 0, 0);

    // Draw mud ponds
    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.mudPonds.forEach((pond) => {
      const { x, y, radiusX, radiusY, health, maxHealth, attackers, id } = pond;
      const pct = health / maxHealth;
      ctx.save();
      ctx.translate(x, y);

      // Stage-based scale: pond shrinks as it dries out
      const scale = 0.4 + pct * 0.6;
      const rX = radiusX * scale;
      const rY = radiusY * scale;

      // Shadow / depth
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(0,0,0,0.6)";

      // Base mud fill
      let baseColor: string;
      let rimColor: string;
      if (pct > 0.75) {
        baseColor = "#3d2a0a";
        rimColor = "#5a3d12";
      } else if (pct > 0.5) {
        baseColor = "#4a3210";
        rimColor = "#6b4c1a";
      } else if (pct > 0.25) {
        baseColor = "#5c4520";
        rimColor = "#7a5e30";
      } else {
        baseColor = "#6b5535";
        rimColor = "#8a7050";
      }

      // Main oval
      ctx.beginPath();
      ctx.ellipse(0, 0, rX, rY, 0, 0, Math.PI * 2);
      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Rim highlight
      ctx.beginPath();
      ctx.ellipse(0, 0, rX, rY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Wet sheen when fresh
      if (pct > 0.5) {
        ctx.beginPath();
        ctx.ellipse(
          -rX * 0.25,
          -rY * 0.25,
          rX * 0.35,
          rY * 0.25,
          -0.3,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "rgba(120,80,20,0.25)";
        ctx.fill();
      }

      // Bubble/texture dots
      const seed = id * 137;
      for (let i = 0; i < Math.floor(3 + pct * 5); i++) {
        const bx = Math.cos((seed + i * 61) % (Math.PI * 2)) * rX * 0.6;
        const by = Math.sin((seed + i * 37) % (Math.PI * 2)) * rY * 0.6;
        ctx.beginPath();
        ctx.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2);
        ctx.fillStyle = rimColor;
        ctx.fill();
      }

      // Churned/bite marks where zombies are eating
      // biome-ignore lint/complexity/noForEach: game loop performance
      attackers.forEach((a) => {
        const ax = a.x - x;
        const ay = a.y - y;
        ctx.beginPath();
        ctx.arc(ax * 0.6, ay * 0.6, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(180,120,40,0.7)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ax * 0.5, ay * 0.5, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(220,160,60,0.5)";
        ctx.fill();
      });

      // Health bar above pond
      const barW = rX * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-barW / 2, -rY - 10, barW, 4);
      ctx.fillStyle =
        pct > 0.5 ? "#78350f" : pct > 0.25 ? "#b45309" : "#d97706";
      ctx.fillRect(-barW / 2, -rY - 10, barW * pct, 4);

      ctx.restore();
    });

    const zombieSway = Math.sin(gameState.frame * 0.1) * 0.1;
    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.zombies.forEach((z) => {
      drawZombie(
        ctx,
        z.x,
        z.y,
        z.type,
        z.radius,
        gameState.frame,
        z.attackAnimTimer,
        isLandscape,
        zombieSway,
      );
      const size = z.radius;
      ctx.save();
      ctx.translate(z.x, z.y);
      if (z.type.startsWith("BOSS")) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "#333";
      ctx.fillRect(-size, -size - 15, size * 2, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(-size, -size - 15, size * 2 * (z.health / z.maxHealth), 4);
      ctx.restore();
    });

    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.gates.forEach((g) => {
      ctx.save();
      ctx.translate(g.x, g.y);
      let color = "#71717a";
      let label = "";
      if (g.type === "ADD" || g.type === "SUB") {
        if (g.value > 0) {
          color = "#3b82f6";
          label = `+${g.value}`;
        } else if (g.value < 0) {
          color = "#ef4444";
          label = `${g.value}`;
        } else {
          color = "#71717a";
          label = "0";
        }
      } else if (g.type === "MULT") {
        color = g.value > 1 ? "#3b82f6" : "#71717a";
        label = `x${g.value}`;
      } else if (g.type === "DIV") {
        color = g.value > 1 ? "#ef4444" : "#3b82f6";
        label = `/${g.value}`;
      } else if (g.type === "SPECIAL") {
        color = "#eab308";
        label = g.value <= 0 ? "READY!" : `SPECIAL: ${g.value}`;
      } else if (g.type === "TRAP") {
        const penaltyRemaining = 10 - (g.trapPenaltyTaken || 0);
        color = penaltyRemaining > 0 ? "#f97316" : "#71717a";
        label = penaltyRemaining > 0 ? `TRAP (${penaltyRemaining})` : "- 50%";
      } else if (g.type === "UPGRADE") {
        color = "#2dd4bf";
        label = `DMG: ${g.value}`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
      } else if (g.type === "RATE_UPGRADE") {
        color = "#a855f7";
        label = `RATE: ${g.value}`;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
      }

      if (isLandscape) {
        ctx.fillStyle = `${color}44`;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.fillRect(-20, -g.width / 2, 40, g.width);
        ctx.strokeRect(-20, -g.width / 2, 40, g.width);
        if (g.bulletHitFlash && g.bulletHitFlash > 0) {
          const flashAlpha = g.bulletHitFlash / 8;
          ctx.save();
          ctx.strokeStyle = `rgba(255, 255, 255, ${flashAlpha * 0.8})`;
          ctx.lineWidth = 3;
          ctx.shadowBlur = 10;
          ctx.shadowColor = color;
          ctx.strokeRect(-21, -g.width / 2 - 1, 42, g.width + 2);
          ctx.restore();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0);
      } else {
        ctx.fillStyle = `${color}44`;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.fillRect(-g.width / 2, -20, g.width, 40);
        ctx.strokeRect(-g.width / 2, -20, g.width, 40);
        if (g.bulletHitFlash && g.bulletHitFlash > 0) {
          const flashAlpha = g.bulletHitFlash / 8;
          ctx.save();
          ctx.strokeStyle = `rgba(255, 255, 255, ${flashAlpha * 0.8})`;
          ctx.lineWidth = 3;
          ctx.shadowBlur = 10;
          ctx.shadowColor = color;
          ctx.strokeRect(-g.width / 2 - 1, -21, g.width + 2, 42);
          ctx.restore();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0);
      }
      ctx.restore();
    });

    const renderPlayerX = gameState.smoothPlayerX ?? gameState.playerX;
    const renderPlayerY =
      gameState.smoothPlayerY ?? gameState.playerY ?? LAND_H / 2;
    const armyPositions = getArmyPositions(
      renderPlayerX,
      gameState.armySize,
      isLandscape,
      renderPlayerY,
    );
    const targetX = mousePosRef.current.x;
    const targetY = mousePosRef.current.y;
    const flashMap = new Map<number, number>();
    for (const f of gameState.spawnFlashes ?? []) flashMap.set(f.index, f.life);
    armyPositions.forEach((pos, index) => {
      let angle: number;
      if (gameState.shootMode === "STRAIGHT") {
        angle = isLandscape ? 0 : -Math.PI / 2;
      } else {
        angle = Math.atan2(targetY - pos.y, targetX - pos.x);
      }
      const spawnFlashLife = flashMap.get(index);
      drawSoldier(
        ctx,
        pos.x,
        pos.y,
        angle,
        index === 0,
        gameState.weaponLevel,
        gameState.hitFlashTimer,
        spawnFlashLife ?? 0,
      );
    });

    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.dyingSoldiers.forEach((s) => {
      ctx.save();
      ctx.globalAlpha = s.life / 30;
      drawSoldier(ctx, s.x, s.y, s.angle, false, gameState.weaponLevel, 10);
      ctx.restore();
    });

    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.floatingTexts.forEach((t) => {
      ctx.save();
      ctx.globalAlpha = t.life;
      ctx.fillStyle = t.color;
      ctx.font = "bold 20px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });

    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.zombieBullets.forEach((b) => {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#9333ea";
      ctx.fillStyle = "#9333ea";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f0abfc";
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      const barWidth = 20;
      const barHeight = 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-barWidth / 2, -15, barWidth, barHeight);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(
        -barWidth / 2,
        -15,
        barWidth * (b.health / b.maxHealth),
        barHeight,
      );
      ctx.restore();
    });

    ctx.save();
    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.explosions.forEach((e) => {
      const alpha = 1 - e.radius / e.maxRadius;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 100, 0, ${alpha * 0.5})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();

    // biome-ignore lint/complexity/noForEach: game loop performance
    gameState.bullets.forEach((b) => {
      ctx.save();
      ctx.fillStyle =
        b.specialType === "CURVED"
          ? "#f472b6"
          : b.specialType === "EXPLOSIVE"
            ? "#fb923c"
            : "#facc15";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.specialType !== "NONE" ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (b.specialType !== "NONE") {
        ctx.shadowBlur = 10;
        ctx.shadowColor = b.specialType === "CURVED" ? "#f472b6" : "#fb923c";
        ctx.stroke();
      }
      ctx.restore();
    });

    if (gameState.isStarted && !gameState.isGameOver) {
      const mx = mousePosRef.current.x;
      const my = mousePosRef.current.y;
      ctx.strokeStyle = "#facc15";
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

    if (gameState.flashTimer > 0) {
      ctx.fillStyle = `rgba(45, 212, 191, ${gameState.flashTimer * 0.05})`;
      ctx.fillRect(0, 0, CW, CH);
    }

    // Pause overlay
    if (
      isPaused &&
      gameState.isStarted &&
      !gameState.isGameOver &&
      !gameState.isVictory
    ) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = "#fff";
      ctx.fillRect(CW / 2 - 18, CH / 2 - 40, 12, 36);
      ctx.fillRect(CW / 2 + 6, CH / 2 - 40, 12, 36);
      ctx.font = "bold 22px Inter, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", CW / 2, CH / 2 + 12);
      ctx.font = "13px Inter, sans-serif";
      ctx.fillStyle = "rgba(200,200,200,0.9)";
      ctx.fillText("Click or tap to continue", CW / 2, CH / 2 + 40);
    }
  }, [gameState, isLandscape, isPaused]);

  const isMobile = isMobileDevice();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col items-center justify-center p-4">
      {/* Header Stats */}
      <div
        className={`w-full ${
          isLandscape ? "max-w-[660px]" : "max-w-[420px]"
        } flex justify-between items-end mb-4 px-2 transition-all duration-300`}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
              Level {gameState.level}
            </span>
            <span className="text-[10px] text-zinc-600 font-mono">|</span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {Math.floor(gameState.levelTimer / 60)}s
            </span>
          </div>
          <span className="text-2xl font-bold font-mono">
            {gameState.score.toLocaleString()}
          </span>
        </div>
        <div className="flex gap-3 items-end">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
              Army
            </span>
            <div className="flex items-center gap-1">
              <User size={14} className="text-blue-400" />
              <span className="text-lg font-bold font-mono">
                {Math.floor(gameState.armySize) >= MAX_ARMY_SIZE
                  ? "MAX"
                  : Math.floor(gameState.armySize)}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
              Weapon
            </span>
            <div className="flex items-center gap-1">
              <Zap
                size={14}
                className={`text-yellow-400 ${
                  gameState.specialTimer > 0 ? "animate-pulse" : ""
                }`}
              />
              <span className="text-lg font-bold font-mono">
                Lv.{gameState.weaponLevel}
                {gameState.specialTimer > 0 && (
                  <span
                    className={`${
                      gameState.activeSpecial === "CURVED"
                        ? "text-pink-500"
                        : "text-orange-500"
                    } ml-1 text-sm`}
                  >
                    ({gameState.activeSpecial})
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex gap-1 mb-1">
              {!isMobile && (
                <button
                  type="button"
                  data-ocid="game.toggle"
                  onClick={handleToggleLandscape}
                  title={
                    isLandscape ? "Switch to Portrait" : "Switch to Landscape"
                  }
                  className={`flex items-center gap-1 px-2 py-0.5 rounded border ${
                    isLandscape
                      ? "bg-emerald-900/40 border-emerald-500 text-emerald-300"
                      : "bg-zinc-800 border-zinc-700 text-zinc-300"
                  } transition-all active:scale-95`}
                >
                  <Monitor size={12} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {isLandscape ? "LAND" : "PORT"}
                  </span>
                </button>
              )}
              <button
                type="button"
                data-ocid="leaderboard.open_modal_button"
                onClick={() => {
                  setShowLeaderboard(true);
                  refetchScores();
                }}
                title="View Leaderboard"
                className="flex items-center gap-1 px-2 py-0.5 rounded border bg-yellow-900/30 border-yellow-600/50 text-yellow-400 hover:bg-yellow-900/60 transition-all active:scale-95"
              >
                <Trophy size={12} />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Board
                </span>
              </button>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
              Mode
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setGameState((prev) => ({
                    ...prev,
                    shootMode: prev.shootMode === "AIM" ? "STRAIGHT" : "AIM",
                  }))
                }
                title={
                  gameState.shootMode === "AIM"
                    ? "Switch to Straight Fire"
                    : "Switch to Aimed Fire"
                }
                className={`flex items-center gap-1 px-2 py-0.5 rounded border ${
                  gameState.shootMode === "STRAIGHT"
                    ? "bg-blue-900/40 border-blue-500 text-blue-200"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300"
                } transition-all active:scale-95`}
              >
                {gameState.shootMode === "STRAIGHT" ? (
                  <ArrowUp size={12} />
                ) : (
                  <Target size={12} />
                )}
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {gameState.shootMode}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setGameState((prev) => ({
                    ...prev,
                    isAutoShoot: !prev.isAutoShoot,
                  }))
                }
                title={
                  gameState.isAutoShoot
                    ? "Disable Auto-Shoot"
                    : "Enable Auto-Shoot"
                }
                className={`flex items-center gap-1 px-2 py-0.5 rounded border ${
                  gameState.isAutoShoot
                    ? "bg-orange-900/40 border-orange-500 text-orange-200"
                    : "bg-zinc-800 border-zinc-700 text-zinc-300"
                } transition-all active:scale-95`}
              >
                <Zap
                  size={12}
                  className={gameState.isAutoShoot ? "fill-current" : ""}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {gameState.isAutoShoot ? "AUTO" : "MANUAL"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Game Canvas Container */}
      <div
        className={`relative group w-full ${
          isLandscape ? "max-w-[660px]" : "max-w-[450px]"
        } transition-all duration-300`}
      >
        <canvas
          ref={canvasRef}
          width={isLandscape ? LAND_W : CANVAS_WIDTH}
          height={isLandscape ? LAND_H : CANVAS_HEIGHT}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleCanvasClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleCanvasClick();
          }}
          className="w-full h-auto rounded-xl shadow-2xl border border-zinc-800 cursor-none touch-none"
        />

        {/* HUD Overlay */}
        <div className="absolute top-4 left-4 right-4 flex flex-col gap-2 pointer-events-none">
          <div className="w-full bg-zinc-900/80 h-2 rounded-full overflow-hidden border border-zinc-700">
            <motion.div
              className="h-full bg-red-500"
              initial={{ width: "100%" }}
              animate={{ width: `${gameState.health}%` }}
            />
          </div>
          {gameState.specialTimer > 0 && (
            <div className="w-full bg-zinc-900/80 h-1.5 rounded-full overflow-hidden border border-zinc-700">
              <motion.div
                className={`h-full ${
                  gameState.activeSpecial === "CURVED"
                    ? "bg-pink-500"
                    : "bg-orange-500"
                }`}
                initial={{ width: "100%" }}
                animate={{
                  width: `${(gameState.specialTimer / (20 * 60)) * 100}%`,
                }}
              />
            </div>
          )}
          <div className="flex justify-between items-start text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            <span>Health: {Math.ceil(gameState.health)}%</span>
            <div className="flex flex-col items-end">
              <span>Damage: x{gameState.bulletDamage.toFixed(1)}</span>
              <span>
                Fire Rate: x
                {(23 / Math.max(3, 25 - gameState.weaponLevel * 2)).toFixed(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Overlays */}
        <AnimatePresence>
          {!gameState.isStarted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl p-8 text-center"
            >
              <Swords size={64} className="text-blue-500 mb-6" />
              <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 italic">
                Horde Rush
              </h1>
              <p className="text-zinc-400 text-sm mb-8 max-w-[250px]">
                Build your army, upgrade your weapons, and survive the zombie
                onslaught.
              </p>
              <button
                type="button"
                onClick={handleStartGame}
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
              <h2 className="text-5xl font-black uppercase tracking-tighter mb-2 italic">
                Defeated
              </h2>
              <div className="flex flex-col gap-1 mb-8">
                <span className="text-zinc-400 text-xs uppercase tracking-widest">
                  Final Score
                </span>
                <span className="text-4xl font-mono font-bold">
                  {gameState.score.toLocaleString()}
                </span>
              </div>
              {!scoreSubmitted ? (
                <div className="flex flex-col gap-2 mb-6 w-full max-w-[240px]">
                  <Input
                    data-ocid="gameover.input"
                    type="text"
                    placeholder="Enter your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={20}
                    className="bg-red-900/30 border-red-700/50 text-white placeholder:text-red-400/60 text-center font-mono text-sm"
                  />
                  <Button
                    data-ocid="gameover.submit_button"
                    disabled={
                      !playerName.trim() || submitScoreMutation.isPending
                    }
                    onClick={async () => {
                      if (!playerName.trim()) return;
                      await submitScoreMutation.mutateAsync({
                        name: playerName.trim(),
                        score: gameState.score,
                      });
                      setScoreSubmitted(true);
                    }}
                    className="bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider"
                  >
                    {submitScoreMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin mr-1" />
                        Saving...
                      </>
                    ) : (
                      "Submit Score"
                    )}
                  </Button>
                </div>
              ) : (
                <div
                  data-ocid="gameover.success_state"
                  className="flex items-center gap-2 text-green-400 text-sm font-mono mb-6"
                >
                  <Trophy size={14} />
                  Score saved to leaderboard!
                </div>
              )}
              <button
                type="button"
                data-ocid="gameover.button"
                onClick={handleStartGame}
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
              <h2 className="text-5xl font-black uppercase tracking-tighter mb-2 italic">
                Victory
              </h2>
              <p className="text-zinc-300 text-sm mb-8">
                You survived all 5 levels of the zombie onslaught!
              </p>
              <div className="flex flex-col gap-1 mb-8">
                <span className="text-zinc-400 text-xs uppercase tracking-widest">
                  Total Score
                </span>
                <span className="text-4xl font-mono font-bold">
                  {gameState.score.toLocaleString()}
                </span>
              </div>
              {!scoreSubmitted ? (
                <div className="flex flex-col gap-2 mb-6 w-full max-w-[240px]">
                  <Input
                    data-ocid="victory.input"
                    type="text"
                    placeholder="Enter your name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={20}
                    className="bg-blue-900/30 border-blue-700/50 text-white placeholder:text-blue-400/60 text-center font-mono text-sm"
                  />
                  <Button
                    data-ocid="victory.submit_button"
                    disabled={
                      !playerName.trim() || submitScoreMutation.isPending
                    }
                    onClick={async () => {
                      if (!playerName.trim()) return;
                      await submitScoreMutation.mutateAsync({
                        name: playerName.trim(),
                        score: gameState.score,
                      });
                      setScoreSubmitted(true);
                    }}
                    className="bg-yellow-500 hover:bg-yellow-400 text-blue-950 font-bold text-xs uppercase tracking-wider"
                  >
                    {submitScoreMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin mr-1" />
                        Saving...
                      </>
                    ) : (
                      "Submit Score"
                    )}
                  </Button>
                </div>
              ) : (
                <div
                  data-ocid="victory.success_state"
                  className="flex items-center gap-2 text-green-300 text-sm font-mono mb-6"
                >
                  <Trophy size={14} />
                  Score saved to leaderboard!
                </div>
              )}
              <button
                type="button"
                data-ocid="victory.button"
                onClick={handleStartGame}
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
                <h3 className="text-sm font-mono uppercase tracking-[0.3em] text-blue-200 mb-1">
                  Level Complete
                </h3>
                <h2 className="text-6xl font-black italic uppercase tracking-tighter mb-6">
                  Level {gameState.level}
                </h2>
                <button
                  type="button"
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
      <div
        className={`mt-8 w-full ${
          isLandscape ? "max-w-[660px]" : "max-w-[420px]"
        } space-y-3 transition-all duration-300`}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-[10px] shrink-0">
              {isLandscape ? "W/S" : "A/D"}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">
                Move
              </span>
              <span className="text-xs">
                {isLandscape ? "Up / Down" : "Keys or Arrow"}
              </span>
            </div>
          </div>
          <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-yellow-500/20 flex items-center justify-center text-yellow-400 shrink-0">
              <Zap size={16} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">
                Shoot
              </span>
              <span className="text-xs">Space / Hold</span>
            </div>
          </div>
        </div>
        {isMobile && (
          <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-700/60 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-[10px] shrink-0">
              2✦
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">
                Mobile Controls
              </span>
              <span className="text-xs text-zinc-400">
                {isLandscape
                  ? "1st finger moves up/down · 2nd finger aims"
                  : "1st finger moves · 2nd finger aims"}
              </span>
            </div>
          </div>
        )}
        {isPaused && gameState.isStarted && !gameState.isGameOver && (
          <div className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-600/60 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-zinc-500/20 flex items-center justify-center text-zinc-300 text-lg shrink-0">
              ⏸
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">
                Paused
              </span>
              <span className="text-xs text-zinc-400">
                Click or tap the game to resume
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-mono">
        System v1.0.5 | Combat Ready
      </div>

      {/* Leaderboard Dialog */}
      <Dialog open={showLeaderboard} onOpenChange={setShowLeaderboard}>
        <DialogContent
          data-ocid="leaderboard.dialog"
          className="bg-zinc-900 border-zinc-700 text-white max-w-sm"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono uppercase tracking-wider text-yellow-400">
              <Trophy size={18} className="text-yellow-400" />
              Top Scores
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-80">
            {!topScores || topScores.length === 0 ? (
              <div
                data-ocid="leaderboard.empty_state"
                className="text-center text-zinc-500 text-sm py-8 font-mono"
              >
                No scores yet. Be the first!
              </div>
            ) : (
              <div className="space-y-1">
                {topScores.map((entry, i) => (
                  <div
                    key={`${entry.name}-${i}`}
                    data-ocid={`leaderboard.item.${i + 1}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded ${
                      i === 0
                        ? "bg-yellow-900/30 border border-yellow-700/40"
                        : i === 1
                          ? "bg-zinc-800/60"
                          : i === 2
                            ? "bg-zinc-800/40"
                            : "bg-zinc-800/20"
                    }`}
                  >
                    <span
                      className={`font-mono font-bold text-sm w-6 text-right ${
                        i === 0
                          ? "text-yellow-400"
                          : i === 1
                            ? "text-zinc-300"
                            : i === 2
                              ? "text-orange-400"
                              : "text-zinc-500"
                      }`}
                    >
                      #{i + 1}
                    </span>
                    <span className="flex-1 font-mono text-sm truncate">
                      {entry.name}
                    </span>
                    <span className="font-mono font-bold text-sm text-white">
                      {Number(entry.score).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <Button
            data-ocid="leaderboard.close_button"
            variant="outline"
            onClick={() => setShowLeaderboard(false)}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-mono text-xs uppercase tracking-wider"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

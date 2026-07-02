import { useCallback, useEffect, useRef, useState } from "react";

type OrbMode = "idle" | "listening" | "processing" | "dimmed" | "alert";

type ParticleOrbProps = {
  mode: OrbMode;
  amplitude?: number;
  amplitudeRef?: { current: number };
  size?: number;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

type OrbPoint = {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
};

const AMBER_PALETTE: Array<[number, number, number]> = [
  [183, 85, 6],
  [255, 211, 59],
  [255, 233, 168],
];
const ALERT_RED: [number, number, number] = [248, 94, 80];
const LISTENING_WARM_WHITE: [number, number, number] = [255, 245, 220];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function ParticleOrb({
  mode,
  amplitude = 0,
  amplitudeRef: externalAmplitudeSource,
  size = 380,
  onClick,
  disabled = false,
  className,
}: ParticleOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  const modeRef = useRef<OrbMode>(mode);
  const previousModeRef = useRef<OrbMode>(mode);
  const amplitudeValueRef = useRef<number>(amplitude);
  const externalAmplitudeRef = useRef<{ current: number } | null>(externalAmplitudeSource ?? null);
  const pointsRef = useRef<OrbPoint[]>([]);
  const noiseRef = useRef<(x: number, y: number, z: number) => number>(() => 0);
  const phaseRef = useRef(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const visualRef = useRef({
    speed: 0.0026,
    noiseAmp: 0.3,
    brightness: 1,
    dotScale: 1,
    alertMix: 0,
    opacity: 1,
  });

  const triggerReveal = useCallback(() => {
    setIsRevealed(false);
    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
    revealTimeoutRef.current = window.setTimeout(() => {
      setIsRevealed(true);
      revealTimeoutRef.current = null;
    }, 20);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      setIsRevealed(true);
      return;
    }
    triggerReveal();
    return () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
    };
  }, [triggerReveal]);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = mode;
    modeRef.current = mode;
    if (previousMode === "dimmed" && mode !== "dimmed") {
      triggerReveal();
    }
  }, [mode, triggerReveal]);

  useEffect(() => {
    amplitudeValueRef.current = clamp01(amplitude);
  }, [amplitude]);

  useEffect(() => {
    externalAmplitudeRef.current = externalAmplitudeSource ?? null;
  }, [externalAmplitudeSource]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const ctx = context;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const radius = size * 0.36;
    const centerX = size / 2;
    const centerY = size / 2;
    const perspective = 2.7;
    const count = 9000;

    pointsRef.current = buildOrbPoints(count, AMBER_PALETTE);
    noiseRef.current = createSimplexNoise3D(8123);

    function renderFrame() {
      const currentMode = modeRef.current;
      const sampledAmplitude = externalAmplitudeRef.current?.current ?? amplitudeValueRef.current;
      const currentAmplitude = clamp01(sampledAmplitude);
      const targets = modeTargets(currentMode, currentAmplitude);
      const visuals = visualRef.current;
      const lerpStrength = 0.12;
      visuals.speed += (targets.speed - visuals.speed) * lerpStrength;
      visuals.noiseAmp += (targets.noiseAmp - visuals.noiseAmp) * lerpStrength;
      visuals.brightness += (targets.brightness - visuals.brightness) * lerpStrength;
      visuals.dotScale += (targets.dotScale - visuals.dotScale) * lerpStrength;
      visuals.alertMix += (targets.alertMix - visuals.alertMix) * lerpStrength;
      visuals.opacity += (targets.opacity - visuals.opacity) * lerpStrength;

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";

      if (currentMode !== "dimmed") {
        phaseRef.current += visuals.speed;
      }

      const spinY = phaseRef.current * 0.62;
      const spinX = Math.sin(phaseRef.current * 0.35) * 0.28;
      const cosY = Math.cos(spinY);
      const sinY = Math.sin(spinY);
      const cosX = Math.cos(spinX);
      const sinX = Math.sin(spinX);

      const points = pointsRef.current;
      const noise = noiseRef.current;
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const combinedNoise =
          noise(point.x * 1.5 + phaseRef.current, point.y * 1.5, point.z * 1.5 + phaseRef.current * 0.7) * 0.72 +
          noise(point.x * 3 + phaseRef.current * 1.3, point.y * 3, point.z * 3) * 0.28;
        const displacement = 1 + combinedNoise * visuals.noiseAmp;
        const zJitter =
          currentMode === "processing"
            ? Math.sin(phaseRef.current * 5.2 + index * 0.01) * 0.01
            : 0;

        const px = point.x * displacement;
        const py = point.y * displacement;
        const pz = point.z * displacement + zJitter;

        const rx = px * cosY - pz * sinY;
        const rz = px * sinY + pz * cosY;
        const ry = py * cosX - rz * sinX;
        const rz2 = py * sinX + rz * cosX;

        const scale = perspective / (perspective - rz2);
        const screenX = centerX + rx * radius * scale;
        const screenY = centerY + ry * radius * scale;
        const depth = clamp01((rz2 + 1.35) / 2.7);

        const alpha = (0.16 + depth * depth * 0.92) * visuals.opacity;
        const dotSize = (0.6 + depth * depth * 1.6) * visuals.dotScale;
        const warmMix = currentMode === "listening" ? currentAmplitude * 0.45 : 0;
        const warmed = blendColor(point.color, LISTENING_WARM_WHITE, warmMix);
        const redShifted = blendColor(warmed, ALERT_RED, visuals.alertMix);
        const brightened = scaleColor(redShifted, visuals.brightness);
        const [r, g, b] = brightened;
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.fillRect(screenX, screenY, dotSize, dotSize);
      }

      ctx.globalCompositeOperation = "source-over";
      rafRef.current = window.requestAnimationFrame(renderFrame);
    }

    rafRef.current = window.requestAnimationFrame(renderFrame);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [size]);

  return (
    <div
      style={{
        opacity: isRevealed ? 1 : 0.1,
        transform: isRevealed ? "scale(1)" : "scale(0.94)",
        transition: "opacity 400ms cubic-bezier(0.22, 1, 0.36, 1), transform 400ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={mode === "listening" ? "Stop listening" : "Start listening"}
        aria-disabled={disabled}
        disabled={disabled}
        style={{ opacity: mode === "dimmed" ? 0.35 : 1 }}
      >
        <canvas ref={canvasRef} />
      </button>
    </div>
  );
}

function modeTargets(mode: OrbMode, amplitude: number): {
  speed: number;
  noiseAmp: number;
  brightness: number;
  dotScale: number;
  alertMix: number;
  opacity: number;
} {
  if (mode === "listening") {
    return {
      speed: 0.0026 * (1 + amplitude * 1.5),
      noiseAmp: 0.3 + amplitude * 0.55,
      brightness: 1,
      dotScale: 1 + amplitude * 0.4,
      alertMix: 0,
      opacity: 1,
    };
  }
  if (mode === "processing") {
    return {
      speed: 0.0065,
      noiseAmp: 0.55,
      brightness: 1.08,
      dotScale: 1.05,
      alertMix: 0,
      opacity: 1,
    };
  }
  if (mode === "dimmed") {
    return {
      speed: 0,
      noiseAmp: 0.3,
      brightness: 1,
      dotScale: 1,
      alertMix: 0,
      opacity: 0.35,
    };
  }
  if (mode === "alert") {
    return {
      speed: 0.0026,
      noiseAmp: 0.3,
      brightness: 1,
      dotScale: 1,
      alertMix: 0.75,
      opacity: 1,
    };
  }
  return {
    speed: 0.0026,
    noiseAmp: 0.3,
    brightness: 1,
    dotScale: 1,
    alertMix: 0,
    opacity: 1,
  };
}

function buildOrbPoints(count: number, palette: Array<[number, number, number]>): OrbPoint[] {
  const points: OrbPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const ringRadius = Math.sqrt(1 - y * y);
    const theta = GOLDEN * index;
    const x = Math.cos(theta) * ringRadius;
    const z = Math.sin(theta) * ringRadius;
    points.push({
      x,
      y,
      z,
      color: interpolateColor(y * 0.5 + 0.5, palette),
    });
  }
  return points;
}

function interpolateColor(position: number, palette: Array<[number, number, number]>): [number, number, number] {
  const t = clamp01(position);
  const segment = 1 / (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(t / segment));
  const blend = (t - index * segment) / segment;
  const start = palette[index];
  const end = palette[index + 1];
  return [
    Math.round(start[0] + (end[0] - start[0]) * blend),
    Math.round(start[1] + (end[1] - start[1]) * blend),
    Math.round(start[2] + (end[2] - start[2]) * blend),
  ];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function blendColor(
  base: [number, number, number],
  target: [number, number, number],
  amount: number,
): [number, number, number] {
  const t = clamp01(amount);
  return [
    Math.round(base[0] + (target[0] - base[0]) * t),
    Math.round(base[1] + (target[1] - base[1]) * t),
    Math.round(base[2] + (target[2] - base[2]) * t),
  ];
}

function scaleColor(
  color: [number, number, number],
  brightness: number,
): [number, number, number] {
  const multiplier = Math.max(0, brightness);
  return [
    Math.min(255, Math.round(color[0] * multiplier)),
    Math.min(255, Math.round(color[1] * multiplier)),
    Math.min(255, Math.round(color[2] * multiplier)),
  ];
}

function createSimplexNoise3D(seed: number): (x: number, y: number, z: number) => number {
  const gradients = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  ] as const;

  const permutation = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) {
    permutation[index] = index;
  }

  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let index = 255; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = permutation[index];
    permutation[index] = permutation[swapIndex];
    permutation[swapIndex] = value;
  }

  const perm = new Uint8Array(512);
  const permMod = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) {
    perm[index] = permutation[index & 255];
    permMod[index] = perm[index] % 12;
  }

  const skewFactor = 1 / 3;
  const unskewFactor = 1 / 6;

  return (xIn: number, yIn: number, zIn: number) => {
    const skew = (xIn + yIn + zIn) * skewFactor;
    const i = Math.floor(xIn + skew);
    const j = Math.floor(yIn + skew);
    const k = Math.floor(zIn + skew);

    const unskew = (i + j + k) * unskewFactor;
    const x0 = xIn - (i - unskew);
    const y0 = yIn - (j - unskew);
    const z0 = zIn - (k - unskew);

    let i1: number;
    let j1: number;
    let k1: number;
    let i2: number;
    let j2: number;
    let k2: number;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1;
      i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0;
      i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0;
      i2 = 1; j2 = 1; k2 = 0;
    }

    const x1 = x0 - i1 + unskewFactor;
    const y1 = y0 - j1 + unskewFactor;
    const z1 = z0 - k1 + unskewFactor;
    const x2 = x0 - i2 + 2 * unskewFactor;
    const y2 = y0 - j2 + 2 * unskewFactor;
    const z2 = z0 - k2 + 2 * unskewFactor;
    const x3 = x0 - 1 + 3 * unskewFactor;
    const y3 = y0 - 1 + 3 * unskewFactor;
    const z3 = z0 - 1 + 3 * unskewFactor;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    const contribution = (
      x: number,
      y: number,
      z: number,
      gi: number,
    ) => {
      let t = 0.6 - x * x - y * y - z * z;
      if (t < 0) return 0;
      t *= t;
      return t * t * (gradients[gi][0] * x + gradients[gi][1] * y + gradients[gi][2] * z);
    };

    const n0 = contribution(x0, y0, z0, permMod[ii + perm[jj + perm[kk]]]);
    const n1 = contribution(x1, y1, z1, permMod[ii + i1 + perm[jj + j1 + perm[kk + k1]]]);
    const n2 = contribution(x2, y2, z2, permMod[ii + i2 + perm[jj + j2 + perm[kk + k2]]]);
    const n3 = contribution(x3, y3, z3, permMod[ii + 1 + perm[jj + 1 + perm[kk + 1]]]);
    return 32 * (n0 + n1 + n2 + n3);
  };
}

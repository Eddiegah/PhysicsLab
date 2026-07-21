"use client";
/**
 * FluidCanvas.tsx
 *
 * Full-screen WebGL2 fluid simulation canvas.
 * Uses a stable ref pattern for the rAF loop to avoid stale closure issues.
 */

import { useEffect, useRef } from "react";
import {
  FluidSimulation,
  DEFAULT_CONFIG,
  type FluidConfig,
  type PaletteName,
} from "@/lib/fluid/FluidSimulation";

interface FluidCanvasProps {
  config: Partial<FluidConfig>;
  palette: PaletteName;
  onFpsUpdate?: (fps: number) => void;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  down: boolean;
  moved: boolean;
  color: [number, number, number];
}

export default function FluidCanvas({ config, palette, onFpsUpdate }: FluidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FluidSimulation | null>(null);

  // Stable refs so the rAF loop always reads the latest values without re-creating
  const configRef = useRef(config);
  const paletteRef = useRef(palette);
  const onFpsRef = useRef(onFpsUpdate);
  configRef.current = config;
  paletteRef.current = palette;
  onFpsRef.current = onFpsUpdate;

  const pointersRef = useRef<Map<number, Pointer>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fpsRef = useRef({ frames: 0, lastTime: 0 });
  const autoSplatRef = useRef(0);

  // ── Main lifecycle: init sim + start loop ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to fill the window
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      simRef.current?.resize();
    };
    resize();

    // Init simulation
    let sim: FluidSimulation;
    try {
      sim = new FluidSimulation(canvas, { ...DEFAULT_CONFIG, ...configRef.current });
      simRef.current = sim;
    } catch (e) {
      console.error("FluidSimulation init failed:", e);
      return;
    }

    // ── rAF loop ─────────────────────────────────────────────────────────────
    // Uses a plain function (not useCallback) so it never goes stale.
    // Reads everything it needs from stable refs.
    const tick = (timestamp: number) => {
      const s = simRef.current;
      if (!s) return;

      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 1 / 30);
      lastTimeRef.current = timestamp;

      // Sync palette + config on every frame (cheap ref reads)
      s.setPalette(paletteRef.current);
      s.updateConfig(configRef.current);

      // FPS counter
      fpsRef.current.frames++;
      if (timestamp - fpsRef.current.lastTime >= 1000) {
        onFpsRef.current?.(fpsRef.current.frames);
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = timestamp;
      }

      // Auto-splats keep the sim alive and interesting with no user input
      autoSplatRef.current += dt;
      if (autoSplatRef.current > 2.5) {
        autoSplatRef.current = 0;
        s.splat(
          Math.random(),
          Math.random(),
          (Math.random() - 0.5) * 0.25,
          (Math.random() - 0.5) * 0.25,
          s.getNextColor()
        );
      }

      // Flush pointer input
      for (const ptr of pointersRef.current.values()) {
        if (ptr.moved) {
          s.splat(ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.color);
          ptr.moved = false;
          // Give the pointer a fresh color next time it moves
          ptr.color = s.getNextColor();
        }
      }

      s.step(dt);
      s.render();

      rafRef.current = requestAnimationFrame(tick);
    };

    lastTimeRef.current = performance.now();
    fpsRef.current.lastTime = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    // Resize observer
    const ro = new ResizeObserver(resize);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      simRef.current?.dispose();
      simRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UV helpers ────────────────────────────────────────────────────────────
  const toUV = (clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    return {
      x: clientX / c.width,
      y: 1.0 - clientY / c.height, // WebGL UV: origin is bottom-left
    };
  };

  // ── Mouse ─────────────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y } = toUV(e.clientX, e.clientY);
    const color = simRef.current?.getNextColor() ?? [1, 0.5, 0.2];
    pointersRef.current.set(-1, { id: -1, x, y, dx: 0, dy: 0, down: true, moved: false, color });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const c = canvasRef.current!;
    const { x, y } = toUV(e.clientX, e.clientY);

    // Splat on hover (no click required) — the hallmark of great fluid demos
    let ptr = pointersRef.current.get(-1);
    if (!ptr) {
      // Create a hover pointer if it doesn't exist yet
      const color = simRef.current?.getNextColor() ?? [1, 0.5, 0.2];
      ptr = { id: -1, x, y, dx: 0, dy: 0, down: false, moved: false, color };
      pointersRef.current.set(-1, ptr);
    }

    const prevX = ptr.x;
    const prevY = ptr.y;
    ptr.dx = (x - prevX) * c.width * 0.003;
    ptr.dy = (y - prevY) * c.height * 0.003;
    ptr.x = x;
    ptr.y = y;

    // Only splat if there's meaningful movement
    const speed = Math.sqrt(ptr.dx * ptr.dx + ptr.dy * ptr.dy);
    if (speed > 0.0001) {
      ptr.moved = true;
    }
  };

  const onMouseUp = () => {
    const ptr = pointersRef.current.get(-1);
    if (ptr) ptr.down = false;
  };

  // ── Touch ─────────────────────────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const { x, y } = toUV(t.clientX, t.clientY);
      const color = simRef.current?.getNextColor() ?? [1, 0.5, 0.2];
      pointersRef.current.set(t.identifier, {
        id: t.identifier, x, y, dx: 0, dy: 0, down: true, moved: false, color,
      });
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const c = canvasRef.current!;
    for (const t of Array.from(e.changedTouches)) {
      const ptr = pointersRef.current.get(t.identifier);
      if (!ptr) continue;
      const { x, y } = toUV(t.clientX, t.clientY);
      ptr.dx = (x - ptr.x) * c.width * 0.003;
      ptr.dy = (y - ptr.y) * c.height * 0.003;
      ptr.x = x;
      ptr.y = y;
      ptr.moved = true;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      pointersRef.current.delete(t.identifier);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full cursor-crosshair"
      style={{ touchAction: "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
}

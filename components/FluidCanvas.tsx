"use client";
/**
 * FluidCanvas.tsx
 *
 * Full-screen WebGL2 fluid simulation canvas.
 * Handles:
 *   - WebGL2 context creation and FluidSimulation lifecycle
 *   - Mouse/touch input → velocity & dye splats
 *   - rAF render loop with variable timestep capping
 *   - Canvas resize (ResizeObserver)
 */

import { useEffect, useRef, useCallback } from "react";
import { FluidSimulation, DEFAULT_CONFIG, type FluidConfig, type PaletteName } from "@/lib/fluid/FluidSimulation";

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
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 });
  const pointersRef = useRef<Map<number, Pointer>>(new Map());
  const autoSplatTimerRef = useRef<number>(0);

  // ── Simulation loop ───────────────────────────────────────────────────────

  const loop = useCallback((timestamp: number) => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;

    // Compute timestep, cap to prevent huge jumps when tab is hidden
    const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 1 / 30);
    lastTimeRef.current = timestamp;

    // FPS tracking
    const fps = fpsCounterRef.current;
    fps.frames++;
    if (timestamp - fps.lastTime >= 1000) {
      onFpsUpdate?.(fps.frames);
      fps.frames = 0;
      fps.lastTime = timestamp;
    }

    // Occasional random auto-splats keep the simulation alive even without input
    autoSplatTimerRef.current += dt;
    if (autoSplatTimerRef.current > 3.0) {
      autoSplatTimerRef.current = 0;
      const x = Math.random();
      const y = Math.random();
      const dx = (Math.random() - 0.5) * 0.2;
      const dy = (Math.random() - 0.5) * 0.2;
      sim.splat(x, y, dx, dy, sim.getNextColor());
    }

    // Apply active pointer splats
    for (const ptr of pointersRef.current.values()) {
      if (ptr.down && ptr.moved) {
        sim.splat(ptr.x, ptr.y, ptr.dx, ptr.dy, ptr.color);
        ptr.moved = false;
      }
    }

    sim.step(dt);
    sim.render();

    rafRef.current = requestAnimationFrame(loop);
  }, [onFpsUpdate]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to full window
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      simRef.current?.resize();
    };
    resize();

    try {
      simRef.current = new FluidSimulation(canvas, { ...DEFAULT_CONFIG, ...config });
    } catch (e) {
      console.error("Failed to initialize fluid simulation:", e);
      return;
    }

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    const ro = new ResizeObserver(resize);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(rafRef.current);
      simRef.current?.dispose();
      simRef.current = null;
      ro.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync config changes without reinitializing
  useEffect(() => {
    simRef.current?.updateConfig(config);
  }, [config]);

  // Sync palette changes
  useEffect(() => {
    simRef.current?.setPalette(palette);
  }, [palette]);

  // ── Input Handling ─────────────────────────────────────────────────────────

  const getUVFromEvent = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    return {
      x: clientX / canvas.width,
      y: 1.0 - clientY / canvas.height, // Flip Y: WebGL UV origin is bottom-left
    };
  };

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = getUVFromEvent(e.clientX, e.clientY);
    const sim = simRef.current;
    const color = sim?.getNextColor() ?? [1, 0.5, 0.2];
    pointersRef.current.set(-1, { id: -1, x, y, dx: 0, dy: 0, down: true, moved: false, color });
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const ptr = pointersRef.current.get(-1);
    if (!ptr) return;
    const { x, y } = getUVFromEvent(e.clientX, e.clientY);
    const canvas = canvasRef.current!;
    ptr.dx = (x - ptr.x) * canvas.width * 0.002;
    ptr.dy = (y - ptr.y) * canvas.height * 0.002;
    ptr.x = x;
    ptr.y = y;
    ptr.moved = true;
    ptr.down = true;
  }, []);

  const onMouseUp = useCallback(() => {
    const ptr = pointersRef.current.get(-1);
    if (ptr) ptr.down = false;
  }, []);

  const onMouseEnter = useCallback((e: React.MouseEvent) => {
    if (e.buttons > 0) onMouseDown(e);
  }, [onMouseDown]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const { x, y } = getUVFromEvent(touch.clientX, touch.clientY);
      const color = simRef.current?.getNextColor() ?? [1, 0.5, 0.2];
      pointersRef.current.set(touch.identifier, { id: touch.identifier, x, y, dx: 0, dy: 0, down: true, moved: false, color });
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const ptr = pointersRef.current.get(touch.identifier);
      if (!ptr) continue;
      const canvas = canvasRef.current!;
      const { x, y } = getUVFromEvent(touch.clientX, touch.clientY);
      ptr.dx = (x - ptr.x) * canvas.width * 0.002;
      ptr.dy = (y - ptr.y) * canvas.height * 0.002;
      ptr.x = x;
      ptr.y = y;
      ptr.moved = true;
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    for (const touch of Array.from(e.changedTouches)) {
      pointersRef.current.delete(touch.identifier);
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full cursor-crosshair"
      style={{ touchAction: "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onMouseEnter={onMouseEnter}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
}

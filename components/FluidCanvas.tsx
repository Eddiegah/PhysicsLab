"use client";
import { useEffect, useRef } from "react";
import { FluidSimulation, DEFAULT_CONFIG, type FluidConfig, type PaletteName } from "@/lib/fluid/FluidSimulation";

interface Props {
  config: Partial<FluidConfig>;
  palette: PaletteName;
  onFpsUpdate?: (fps: number) => void;
}

export default function FluidCanvas({ config, palette, onFpsUpdate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Use refs for everything so the loop never captures stale values
  const simRef     = useRef<FluidSimulation | null>(null);
  const cfgRef     = useRef(config);
  const palRef     = useRef(palette);
  const fpsRef     = useRef(onFpsUpdate);
  cfgRef.current   = config;
  palRef.current   = palette;
  fpsRef.current   = onFpsUpdate;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let lastT = 0;
    let fpsFrames = 0;
    let fpsLast = 0;
    let autoTimer = 0;

    // Size canvas
    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      simRef.current?.resize();
    };
    resize();

    // Boot simulation
    let sim: FluidSimulation;
    try {
      sim = new FluidSimulation(canvas, { ...DEFAULT_CONFIG, ...cfgRef.current });
      simRef.current = sim;
    } catch (err) {
      console.error("[FluidCanvas] init failed:", err);
      return;
    }

    // Track mouse position for continuous hover splats
    let mx = 0.5, my = 0.5, pmx = 0.5, pmy = 0.5, mDown = false;

    const toUV = (cx: number, cy: number) => ({
      x: cx / canvas.width,
      y: 1 - cy / canvas.height,
    });

    const onMove = (e: MouseEvent) => {
      const uv = toUV(e.clientX, e.clientY);
      pmx = mx; pmy = my; mx = uv.x; my = uv.y;
    };
    const onDown = (e: MouseEvent) => {
      mDown = true;
      const uv = toUV(e.clientX, e.clientY);
      pmx = mx = uv.x; pmy = my = uv.y;
    };
    const onUp = () => { mDown = false; };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      const uv = toUV(t.clientX, t.clientY);
      pmx = mx; pmy = my; mx = uv.x; my = uv.y;
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      const uv = toUV(t.clientX, t.clientY);
      pmx = mx = uv.x; pmy = my = uv.y;
    };

    canvas.addEventListener("mousemove",  onMove);
    canvas.addEventListener("mousedown",  onDown);
    window.addEventListener("mouseup",    onUp);
    canvas.addEventListener("touchmove",  onTouchMove, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });

    // RAF loop — defined as named fn inside effect, never re-created
    const tick = (t: number) => {
      const dt = Math.min((t - lastT) / 1000, 1/30);
      lastT = t;

      // Sync palette/config every frame
      sim.setPalette(palRef.current);
      sim.updateConfig(cfgRef.current);

      // FPS
      fpsFrames++;
      if (t - fpsLast > 1000) {
        fpsRef.current?.(fpsFrames);
        fpsFrames = 0; fpsLast = t;
      }

      // Mouse splat: fire whenever mouse has moved
      const ddx = mx - pmx, ddy = my - pmy;
      const spd = Math.sqrt(ddx*ddx + ddy*ddy);
      if (spd > 0.0002) {
        sim.splat(mx, my, ddx * canvas.width * 0.003, ddy * canvas.height * 0.003, sim.nextColor());
        pmx = mx; pmy = my;
      }

      // Auto-splats so something always looks alive
      autoTimer += dt;
      if (autoTimer > 3) {
        autoTimer = 0;
        sim.splat(Math.random(), Math.random(),
          (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2,
          sim.nextColor());
      }

      sim.step(dt);
      sim.render();
      raf = requestAnimationFrame(tick);
    };

    lastT = performance.now();
    fpsLast = performance.now();
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove",  onMove);
      canvas.removeEventListener("mousedown",  onDown);
      window.removeEventListener("mouseup",    onUp);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      simRef.current?.dispose();
      simRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ cursor: "crosshair", touchAction: "none" }}
    />
  );
}

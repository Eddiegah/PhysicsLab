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
  const cfgRef    = useRef(config);
  const palRef    = useRef(palette);
  const fpsRef    = useRef(onFpsUpdate);
  cfgRef.current  = config;
  palRef.current  = palette;
  fpsRef.current  = onFpsUpdate;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to full viewport BEFORE creating the sim
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    let sim: FluidSimulation;
    try {
      sim = new FluidSimulation(canvas, { ...DEFAULT_CONFIG, ...cfgRef.current });
    } catch (err) {
      console.error("[FluidCanvas] init failed:", err);
      return;
    }

    // Mouse tracking
    let mx = 0.5, my = 0.5, pmx = 0.5, pmy = 0.5;

    const toUV = (cx: number, cy: number) => ({
      x: cx / canvas.width,
      y: 1.0 - cy / canvas.height, // WebGL UV: y=0 at bottom
    });

    const onMove = (e: MouseEvent) => {
      const uv = toUV(e.clientX, e.clientY);
      pmx = mx; pmy = my;
      mx = uv.x; my = uv.y;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const uv = toUV(e.touches[0].clientX, e.touches[0].clientY);
      pmx = mx; pmy = my;
      mx = uv.x; my = uv.y;
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const uv = toUV(e.touches[0].clientX, e.touches[0].clientY);
      pmx = mx = uv.x; pmy = my = uv.y;
    };

    window.addEventListener("mousemove",  onMove);
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });

    // rAF loop — plain function, no stale closures
    let raf = 0, lastT = performance.now();
    let fpsF = 0, fpsL = performance.now();
    let autoT = 0;

    const tick = (t: number) => {
      const dt = Math.min((t - lastT) / 1000, 1 / 30);
      lastT = t;

      sim.setPalette(palRef.current);
      sim.updateConfig(cfgRef.current);

      // FPS counter
      fpsF++;
      if (t - fpsL >= 1000) { fpsRef.current?.(fpsF); fpsF = 0; fpsL = t; }

      // Splat on mouse movement
      const ddx = mx - pmx;
      const ddy = my - pmy;
      if (Math.abs(ddx) > 0.0001 || Math.abs(ddy) > 0.0001) {
        sim.splat(mx, my, ddx * 12, ddy * 12, sim.nextColor());
        pmx = mx; pmy = my;
      }

      // Auto-splat every 2.5s so something is always moving
      autoT += dt;
      if (autoT >= 2.5) {
        autoT = 0;
        sim.splat(
          Math.random(), Math.random(),
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          sim.nextColor()
        );
      }

      sim.step(dt);
      sim.render();
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    // Resize
    const onResize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      sim.resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove",  onMove);
      window.removeEventListener("resize",     onResize);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      sim.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full block"
      style={{ cursor: "crosshair", touchAction: "none" }}
    />
  );
}

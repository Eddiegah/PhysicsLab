"use client";
import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ControlPanel from "@/components/ControlPanel";
import type { FluidConfig, PaletteName } from "@/lib/fluid/FluidSimulation";
import type { ClothConfig } from "@/lib/cloth/ClothSimulation";
import * as THREE from "three";

// Dynamic: both canvases are WebGL — skip SSR entirely
const FluidCanvas = dynamic(() => import("@/components/FluidCanvas"), { ssr: false });
const ClothCanvas = dynamic(() => import("@/components/ClothCanvas"), { ssr: false });

type Mode = "fluid" | "cloth";

export default function Page() {
  const [mode, setMode] = useState<Mode>("fluid");
  const [fps,  setFps]  = useState(0);
  const [intro, setIntro]    = useState(true);
  const [fading, setFading]  = useState(false);

  // Fluid state
  const [fluidConfig, setFluidConfig] = useState<Partial<FluidConfig>>({});
  const [palette, setPalette] = useState<PaletteName>("cosmic");

  // Cloth state
  const [clothConfig, setClothConfig] = useState<Partial<ClothConfig>>({});
  const [wireframe, setWireframe] = useState(false);
  const [clothKey,  setClothKey]  = useState(0);

  const dismiss = () => {
    if (!intro) return;
    setFading(true);
    setTimeout(() => setIntro(false), 600);
  };

  useEffect(() => {
    const h = () => dismiss();
    window.addEventListener("keydown",    h, { once: true });
    window.addEventListener("mousemove",  h, { once: true });
    window.addEventListener("touchstart", h, { once: true });
    return () => {
      window.removeEventListener("keydown",    h);
      window.removeEventListener("mousemove",  h);
      window.removeEventListener("touchstart", h);
    };
  }, [intro]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#07070f]">

      {/* ── Simulation ───────────────────────────────────────────────── */}
      {mode === "fluid" && (
        <FluidCanvas
          config={fluidConfig}
          palette={palette}
          onFpsUpdate={setFps}
        />
      )}
      {mode === "cloth" && (
        <ClothCanvas
          key={clothKey}
          config={clothConfig}
          wireframe={wireframe}
          onFpsUpdate={setFps}
        />
      )}

      {/* ── Vignette ─────────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none z-10
        bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.4)_100%)]" />

      {/* ── Title ────────────────────────────────────────────────────── */}
      <div className="fixed top-5 left-6 z-40 pointer-events-none">
        <div className="flex items-baseline gap-2.5">
          <span className="text-white/90 text-base font-semibold tracking-tight">PhysicsLab</span>
          <span className="text-white/25 text-[10px] font-mono uppercase tracking-[0.2em]">
            {mode === "fluid" ? "Navier–Stokes" : "Verlet Integration"}
          </span>
        </div>
      </div>

      {/* ── Intro overlay ────────────────────────────────────────────── */}
      {intro && (
        <div className={`fixed inset-0 z-30 flex flex-col items-center justify-center
          transition-opacity duration-500 pointer-events-none
          ${fading ? "opacity-0" : "opacity-100"}`}>
          <div className="text-center px-6 max-w-md pointer-events-auto" onClick={dismiss}>
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-3 tracking-tight">
              PhysicsLab
            </h1>
            <p className="text-white/45 text-sm md:text-base leading-relaxed mb-8">
              {mode === "fluid"
                ? "GPU fluid dynamics solving Navier–Stokes equations in real time"
                : "Cloth simulation using mass-spring physics and Verlet integration"}
            </p>
            <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full
              border border-white/20 bg-white/5 text-white/50 text-sm animate-pulse cursor-pointer">
              <span className="text-base">✦</span>
              {mode === "fluid" ? "Move your mouse to create fluid" : "Click and drag the cloth"}
            </div>
          </div>
        </div>
      )}

      {/* ── Cloth hint (always visible in cloth mode after intro) ─────── */}
      {!intro && mode === "cloth" && (
        <div className="fixed bottom-4 left-4 z-40 pointer-events-none">
          <p className="text-white/25 text-[11px] font-mono">
            click + drag · adjust wind in controls →
          </p>
        </div>
      )}

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <ControlPanel
        mode={mode}
        onModeChange={m => { setMode(m); dismiss(); }}
        fps={fps}
        fluidConfig={fluidConfig}
        onFluidConfig={c => setFluidConfig(p => ({...p,...c}))}
        palette={palette}
        onPalette={setPalette}
        clothConfig={clothConfig}
        onClothConfig={c => setClothConfig(p => ({...p,...c}))}
        wireframe={wireframe}
        onWireframe={setWireframe}
        onClothReset={() => setClothKey(k => k+1)}
      />
    </main>
  );
}

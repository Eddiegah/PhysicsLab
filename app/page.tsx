"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import ControlPanel from "@/components/ControlPanel";
import type { FluidConfig, PaletteName } from "@/lib/fluid/FluidSimulation";
import type { ClothConfig } from "@/lib/cloth/ClothSimulation";

const FluidCanvas = dynamic(() => import("@/components/FluidCanvas"), { ssr: false });
const ClothCanvas = dynamic(() => import("@/components/ClothCanvas"), { ssr: false });

type Mode = "fluid" | "cloth";

export default function Page() {
  const [mode, setMode]       = useState<Mode>("fluid");
  const [fps,  setFps]        = useState(0);
  const [intro, setIntro]     = useState(true);
  const [fading, setFading]   = useState(false);

  const [fluidConfig, setFluidConfig] = useState<Partial<FluidConfig>>({});
  const [palette, setPalette]         = useState<PaletteName>("cosmic");

  const [clothConfig, setClothConfig] = useState<Partial<ClothConfig>>({});
  const [wireframe, setWireframe]     = useState(false);
  const [clothKey, setClothKey]       = useState(0);

  const dismiss = () => {
    if (!intro) return;
    setFading(true);
    setTimeout(() => setIntro(false), 500);
  };

  // Only dismiss intro on click or keydown — not mousemove
  useEffect(() => {
    const onClick   = () => dismiss();
    const onKeydown = () => dismiss();
    window.addEventListener("click",   onClick,   { once: true });
    window.addEventListener("keydown", onKeydown, { once: true });
    // Auto-dismiss after 5s so it never blocks the sim
    const t = setTimeout(() => dismiss(), 5000);
    return () => {
      window.removeEventListener("click",   onClick);
      window.removeEventListener("keydown", onKeydown);
      clearTimeout(t);
    };
  }, [intro]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#07070f]">

      {/* Simulation — always rendered underneath everything */}
      {mode === "fluid" && (
        <FluidCanvas config={fluidConfig} palette={palette} onFpsUpdate={setFps} />
      )}
      {mode === "cloth" && (
        <ClothCanvas key={clothKey} config={clothConfig} wireframe={wireframe} onFpsUpdate={setFps} />
      )}

      {/* Subtle vignette */}
      <div className="fixed inset-0 pointer-events-none z-10
        bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.5)_100%)]" />

      {/* Title — top left */}
      <div className="fixed top-5 left-6 z-40 pointer-events-none select-none">
        <span className="text-white/80 text-base font-semibold tracking-tight">PhysicsLab</span>
        <span className="ml-2.5 text-white/25 text-[10px] font-mono uppercase tracking-[0.2em]">
          {mode === "fluid" ? "Navier–Stokes" : "Verlet Integration"}
        </span>
      </div>

      {/* Intro overlay */}
      {intro && (
        <div
          className={`fixed inset-0 z-30 flex flex-col items-center justify-center
            transition-opacity duration-500 cursor-pointer
            ${fading ? "opacity-0" : "opacity-100"}`}
          onClick={dismiss}
        >
          <div className="text-center px-6 max-w-lg">
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-4 tracking-tight leading-none">
              PhysicsLab
            </h1>
            <p className="text-white/40 text-sm md:text-base leading-relaxed mb-10 max-w-sm mx-auto">
              Real-time physics simulation — fluid dynamics and cloth mechanics — solved on the GPU in your browser.
            </p>
            <div className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full
              border border-white/20 bg-white/5 backdrop-blur-sm text-white/55 text-sm">
              <span>✦</span>
              <span>
                {mode === "fluid" ? "Move your mouse to paint fluid" : "Click and drag to pull the cloth"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Cloth hint */}
      {!intro && mode === "cloth" && (
        <div className="fixed bottom-16 left-5 z-40 pointer-events-none">
          <p className="text-white/20 text-[11px] font-mono">
            click + drag cloth · use sliders to change wind →
          </p>
        </div>
      )}

      {/* Controls */}
      <ControlPanel
        mode={mode}
        onModeChange={m => { setMode(m); dismiss(); }}
        fps={fps}
        fluidConfig={fluidConfig}
        onFluidConfig={c => setFluidConfig(p => ({ ...p, ...c }))}
        palette={palette}
        onPalette={setPalette}
        clothConfig={clothConfig}
        onClothConfig={c => setClothConfig(p => ({ ...p, ...c }))}
        wireframe={wireframe}
        onWireframe={setWireframe}
        onClothReset={() => setClothKey(k => k + 1)}
      />
    </main>
  );
}

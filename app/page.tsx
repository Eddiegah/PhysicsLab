"use client";
/**
 * page.tsx — PhysicsLab main experience
 *
 * Structure:
 *   - Full-screen simulation canvas (fluid or cloth) as the primary visual
 *   - Brief intro overlay that fades after first interaction
 *   - Minimal control panel in the bottom-right corner
 *
 * The simulation IS the page. Everything else serves it.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ControlPanel from "@/components/ControlPanel";
import type { FluidConfig, PaletteName } from "@/lib/fluid/FluidSimulation";
import type { ClothConfig } from "@/lib/cloth/ClothSimulation";
import * as THREE from "three";

// Dynamic imports: both canvases are client-only (WebGL) and should not SSR
const FluidCanvas = dynamic(() => import("@/components/FluidCanvas"), {
  ssr: false,
  loading: () => null,
});

const ClothCanvas = dynamic(() => import("@/components/ClothCanvas"), {
  ssr: false,
  loading: () => null,
});

type Mode = "fluid" | "cloth";

export default function PhysicsLabPage() {
  const [mode, setMode] = useState<Mode>("fluid");
  const [fps, setFps] = useState<number>(0);
  const [introVisible, setIntroVisible] = useState(true);
  const [introFading, setIntroFading] = useState(false);

  // Fluid config state
  const [fluidConfig, setFluidConfig] = useState<Partial<FluidConfig>>({
    VELOCITY_DISSIPATION: 0.98,
    DYE_DISSIPATION: 0.985,
    SPLAT_FORCE: 6000,
    SPLAT_RADIUS: 0.0012,
  });
  const [palette, setPalette] = useState<PaletteName>("cosmic");

  // Cloth config state
  const [clothConfig, setClothConfig] = useState<Partial<ClothConfig>>({
    GRAVITY: -12,
    WIND: new THREE.Vector3(0.5, 0, 0.3),
    STIFFNESS: 0.95,
  });
  const [wireframe, setWireframe] = useState(false);
  const clothResetKeyRef = useRef(0);
  const [clothResetKey, setClothResetKey] = useState(0);

  // Dismiss intro on first interaction
  const dismissIntro = useCallback(() => {
    if (!introVisible) return;
    setIntroFading(true);
    setTimeout(() => setIntroVisible(false), 800);
  }, [introVisible]);

  useEffect(() => {
    const handleKey = () => dismissIntro();
    window.addEventListener("keydown", handleKey, { once: true });
    return () => window.removeEventListener("keydown", handleKey);
  }, [dismissIntro]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    dismissIntro();
  }, [dismissIntro]);

  const handleClothReset = useCallback(() => {
    clothResetKeyRef.current += 1;
    setClothResetKey(clothResetKeyRef.current);
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#050510]">

      {/* ── Simulation canvas — the actual star of the show ─────────────── */}

      {mode === "fluid" && (
        <FluidCanvas
          config={fluidConfig}
          palette={palette}
          onFpsUpdate={setFps}
        />
      )}

      {mode === "cloth" && (
        <ClothCanvas
          key={clothResetKey}
          config={clothConfig}
          wireframe={wireframe}
          onFpsUpdate={setFps}
        />
      )}

      {/* ── Title / branding — minimal, non-competing ─────────────────────── */}
      <div className="fixed top-5 left-6 z-40 pointer-events-none">
        <div className="flex items-baseline gap-2">
          <h1 className="text-white/90 text-lg font-semibold tracking-tight leading-none">
            PhysicsLab
          </h1>
          <span className="text-white/30 text-xs font-mono uppercase tracking-widest">
            {mode === "fluid" ? "Navier–Stokes" : "Mass-Spring"}
          </span>
        </div>
      </div>

      {/* ── Intro overlay ─────────────────────────────────────────────────── */}
      {introVisible && (
        <div
          className={`fixed inset-0 z-30 flex flex-col items-center justify-center pointer-events-none
                      transition-opacity duration-700 ${introFading ? "opacity-0" : "opacity-100"}`}
        >
          <div className="text-center px-6 max-w-lg">
            {/* Large title */}
            <h2 className="text-white text-5xl md:text-7xl font-bold tracking-tight mb-4 leading-none">
              PhysicsLab
            </h2>

            {/* One-line descriptor */}
            <p className="text-white/50 text-base md:text-lg mb-8 leading-relaxed">
              Real-time fluid dynamics (Navier–Stokes) and cloth mechanics
              (Verlet integration) — solved on the GPU, in your browser.
            </p>

            {/* Interaction prompt */}
            <div
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full
                         border border-white/20 bg-white/5 backdrop-blur-sm
                         text-white/60 text-sm animate-pulse pointer-events-auto cursor-pointer"
              onClick={dismissIntro}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4 fill-white/60">
                <path d="M10 3a1 1 0 00-1 1v5H4a1 1 0 100 2h5v5a1 1 0 102 0v-5h5a1 1 0 100-2h-5V4a1 1 0 00-1-1z"/>
              </svg>
              Move your mouse to interact
            </div>
          </div>
        </div>
      )}

      {/* ── Subtle gradient vignette — makes text readable over simulation ── */}
      <div className="fixed inset-0 pointer-events-none z-10
                      bg-gradient-to-b from-black/30 via-transparent to-black/20" />

      {/* ── Control panel ─────────────────────────────────────────────────── */}
      <ControlPanel
        mode={mode}
        onModeChange={handleModeChange}
        fps={fps}
        fluidConfig={fluidConfig}
        onFluidConfigChange={(c) => setFluidConfig((prev) => ({ ...prev, ...c }))}
        palette={palette}
        onPaletteChange={setPalette}
        clothConfig={clothConfig}
        onClothConfigChange={(c) => setClothConfig((prev) => ({ ...prev, ...c }))}
        wireframe={wireframe}
        onWireframeChange={setWireframe}
        onClothReset={handleClothReset}
      />

      {/* ── WebGL2 unavailable warning ─────────────────────────────────────── */}
      <noscript>
        <div className="fixed inset-0 flex items-center justify-center bg-[#050510] z-50">
          <p className="text-white/60 text-center px-8">
            JavaScript is required for PhysicsLab — the simulation runs entirely in your browser.
          </p>
        </div>
      </noscript>
    </main>
  );
}

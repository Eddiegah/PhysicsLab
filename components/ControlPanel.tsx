"use client";
/**
 * ControlPanel.tsx
 *
 * Minimal, unobtrusive control panel.
 * Designed to stay out of the way — tucked in a corner, collapsible,
 * semi-transparent, and small enough that the simulation dominates visually.
 */

import { useState } from "react";
import * as THREE from "three";
import type { FluidConfig, PaletteName } from "@/lib/fluid/FluidSimulation";
import type { ClothConfig } from "@/lib/cloth/ClothSimulation";

type Mode = "fluid" | "cloth";

interface ControlPanelProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  fps?: number;

  // Fluid controls
  fluidConfig: Partial<FluidConfig>;
  onFluidConfigChange: (c: Partial<FluidConfig>) => void;
  palette: PaletteName;
  onPaletteChange: (p: PaletteName) => void;

  // Cloth controls
  clothConfig: Partial<ClothConfig>;
  onClothConfigChange: (c: Partial<ClothConfig>) => void;
  wireframe: boolean;
  onWireframeChange: (v: boolean) => void;
  onClothReset: () => void;
}

const PALETTES: { name: PaletteName; label: string; sample: string[] }[] = [
  { name: "cosmic", label: "Cosmic", sample: ["#cc22ee", "#2266ff", "#00ddcc"] },
  { name: "ocean",  label: "Ocean",  sample: ["#0099ff", "#00ee99", "#1144cc"] },
  { name: "fire",   label: "Fire",   sample: ["#ff2200", "#ff8800", "#ffdd00"] },
  { name: "aurora", label: "Aurora", sample: ["#00ff88", "#8800ff", "#00bbdd"] },
  { name: "monochrome", label: "Mono", sample: ["#ffffff", "#aaaaaa", "#666666"] },
];

export default function ControlPanel({
  mode, onModeChange, fps,
  fluidConfig, onFluidConfigChange, palette, onPaletteChange,
  clothConfig, onClothConfigChange, wireframe, onWireframeChange, onClothReset,
}: ControlPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50 select-none">
      {/* Collapsed state: just a small pill with mode toggle + expand button */}
      {!expanded && (
        <div className="flex items-center gap-2">
          {/* Mode toggle pills */}
          <div className="flex rounded-full overflow-hidden border border-white/10 backdrop-blur-md bg-black/40">
            <button
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                mode === "fluid" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"
              }`}
              onClick={() => onModeChange("fluid")}
            >
              Fluid
            </button>
            <button
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                mode === "cloth" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"
              }`}
              onClick={() => onModeChange("cloth")}
            >
              Cloth
            </button>
          </div>

          {/* FPS badge */}
          {fps !== undefined && (
            <div className="backdrop-blur-md bg-black/40 border border-white/10 rounded-full px-3 py-1.5 text-xs font-mono text-white/50">
              {fps}fps
            </div>
          )}

          {/* Expand button */}
          <button
            onClick={() => setExpanded(true)}
            className="w-8 h-8 rounded-full backdrop-blur-md bg-black/40 border border-white/10
                       flex items-center justify-center text-white/60 hover:text-white transition-colors"
            aria-label="Open controls"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
              <path d="M2 4h12v1.5H2zm0 3.25h12v1.5H2zm0 3.25h12v1.5H2z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="w-72 rounded-2xl backdrop-blur-xl bg-black/60 border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex gap-1">
              <button
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  mode === "fluid" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
                }`}
                onClick={() => onModeChange("fluid")}
              >
                Fluid
              </button>
              <button
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  mode === "cloth" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
                }`}
                onClick={() => onModeChange("cloth")}
              >
                Cloth
              </button>
            </div>
            <div className="flex items-center gap-2">
              {fps !== undefined && (
                <span className="text-xs font-mono text-white/40">{fps}fps</span>
              )}
              <button
                onClick={() => setExpanded(false)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white transition-colors"
                aria-label="Close controls"
              >
                <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
                  <path d="M12 4.7l-.7-.7L8 7.3 4.7 4l-.7.7L7.3 8 4 11.3l.7.7L8 8.7l3.3 3.3.7-.7L8.7 8z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Fluid controls */}
          {mode === "fluid" && (
            <div className="px-4 py-3 space-y-4">
              {/* Color palette */}
              <div>
                <label className="block text-xs text-white/50 mb-2 uppercase tracking-wider">Color Palette</label>
                <div className="flex gap-2 flex-wrap">
                  {PALETTES.map((p) => (
                    <button
                      key={p.name}
                      title={p.label}
                      onClick={() => onPaletteChange(p.name)}
                      className={`flex gap-0.5 rounded-md overflow-hidden border-2 transition-all ${
                        palette === p.name ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-90"
                      }`}
                    >
                      {p.sample.map((c, i) => (
                        <div key={i} className="w-5 h-5" style={{ backgroundColor: c }} />
                      ))}
                    </button>
                  ))}
                </div>
              </div>

              {/* Velocity dissipation */}
              <SliderControl
                label="Velocity Dissipation"
                value={fluidConfig.VELOCITY_DISSIPATION ?? 0.98}
                min={0.9} max={1.0} step={0.001}
                format={(v) => v.toFixed(3)}
                onChange={(v) => onFluidConfigChange({ VELOCITY_DISSIPATION: v })}
              />

              {/* Dye dissipation */}
              <SliderControl
                label="Color Dissipation"
                value={fluidConfig.DYE_DISSIPATION ?? 0.985}
                min={0.9} max={1.0} step={0.001}
                format={(v) => v.toFixed(3)}
                onChange={(v) => onFluidConfigChange({ DYE_DISSIPATION: v })}
              />

              {/* Splat force */}
              <SliderControl
                label="Force Strength"
                value={fluidConfig.SPLAT_FORCE ?? 6000}
                min={1000} max={15000} step={100}
                format={(v) => Math.round(v).toString()}
                onChange={(v) => onFluidConfigChange({ SPLAT_FORCE: v })}
              />

              {/* Splat radius */}
              <SliderControl
                label="Brush Size"
                value={(fluidConfig.SPLAT_RADIUS ?? 0.0012) * 10000}
                min={5} max={50} step={1}
                format={(v) => v.toFixed(0)}
                onChange={(v) => onFluidConfigChange({ SPLAT_RADIUS: v / 10000 })}
              />
            </div>
          )}

          {/* Cloth controls */}
          {mode === "cloth" && (
            <div className="px-4 py-3 space-y-4">
              {/* Wind strength */}
              <SliderControl
                label="Wind Strength"
                value={clothConfig.WIND ? Math.abs((clothConfig.WIND as {x:number}).x) : 0.5}
                min={0} max={3} step={0.1}
                format={(v) => v.toFixed(1)}
                onChange={(v) => {
                  onClothConfigChange({ WIND: new THREE.Vector3(v, 0, v * 0.5) });
                }}
              />

              {/* Gravity */}
              <SliderControl
                label="Gravity"
                value={Math.abs(clothConfig.GRAVITY ?? 12)}
                min={1} max={30} step={0.5}
                format={(v) => v.toFixed(1)}
                onChange={(v) => onClothConfigChange({ GRAVITY: -v })}
              />

              {/* Stiffness */}
              <SliderControl
                label="Stiffness"
                value={clothConfig.STIFFNESS ?? 0.95}
                min={0.5} max={1.0} step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => onClothConfigChange({ STIFFNESS: v })}
              />

              {/* Wireframe toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50 uppercase tracking-wider">Wireframe</span>
                <button
                  onClick={() => onWireframeChange(!wireframe)}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    wireframe ? "bg-blue-500" : "bg-white/20"
                  }`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full mx-0.5 transition-transform ${
                    wireframe ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>

              {/* Reset button */}
              <button
                onClick={onClothReset}
                className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white
                           text-xs font-medium transition-colors"
              >
                Reset Cloth
              </button>
            </div>
          )}

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-white/5">
            <p className="text-xs text-white/25 text-center">
              {mode === "fluid" ? "Move mouse to swirl fluid" : "Click and drag to pull cloth"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Slider Component ─────────────────────────────────────────────────────────

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderControl({ label, value, min, max, step, format, onChange }: SliderControlProps) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <label className="text-xs text-white/50 uppercase tracking-wider">{label}</label>
        <span className="text-xs font-mono text-white/60">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 appearance-none rounded-full bg-white/10
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-3.5
                   [&::-webkit-slider-thumb]:h-3.5
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:cursor-pointer
                   cursor-pointer"
      />
    </div>
  );
}

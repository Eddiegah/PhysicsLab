"use client";
import { useState } from "react";
import * as THREE from "three";
import type { FluidConfig, PaletteName } from "@/lib/fluid/FluidSimulation";
import type { ClothConfig } from "@/lib/cloth/ClothSimulation";

type Mode = "fluid" | "cloth";

interface Props {
  mode: Mode; onModeChange(m: Mode): void;
  fps?: number;
  fluidConfig: Partial<FluidConfig>;
  onFluidConfig(c: Partial<FluidConfig>): void;
  palette: PaletteName; onPalette(p: PaletteName): void;
  clothConfig: Partial<ClothConfig>;
  onClothConfig(c: Partial<ClothConfig>): void;
  wireframe: boolean; onWireframe(v: boolean): void;
  onClothReset(): void;
}

const PALS: { name: PaletteName; label: string; colors: string[] }[] = [
  { name: "cosmic",  label: "Cosmic",  colors: ["#cc22ee","#2266ff","#00ddcc"] },
  { name: "ocean",   label: "Ocean",   colors: ["#0099ff","#00ee99","#1144cc"] },
  { name: "fire",    label: "Fire",    colors: ["#ff2200","#ff8800","#ffdd00"] },
  { name: "aurora",  label: "Aurora",  colors: ["#00ff88","#8800ff","#00bbdd"] },
  { name: "mono",    label: "Mono",    colors: ["#ffffff","#aaaaaa","#555555"] },
];

export default function ControlPanel({
  mode, onModeChange, fps,
  fluidConfig, onFluidConfig, palette, onPalette,
  clothConfig, onClothConfig, wireframe, onWireframe, onClothReset,
}: Props) {
  const [open, setOpen] = useState(false);

  const modeBtn = (m: Mode, label: string) => (
    <button
      onClick={() => onModeChange(m)}
      className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
        mode === m
          ? "bg-white/20 text-white shadow-inner"
          : "text-white/40 hover:text-white/70"
      }`}
    >{label}</button>
  );

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">

      {/* Expanded panel */}
      {open && (
        <div className="w-72 rounded-2xl backdrop-blur-xl bg-black/70 border border-white/10 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex gap-1 bg-white/5 rounded-full p-0.5">
              {modeBtn("fluid","Fluid")}
              {modeBtn("cloth","Cloth")}
            </div>
            <div className="flex items-center gap-2">
              {fps !== undefined && (
                <span className="text-[11px] font-mono text-white/35">{fps}fps</span>
              )}
              <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">×</button>
            </div>
          </div>

          <div className="px-4 py-3 space-y-4">
            {mode === "fluid" && <>
              {/* Palette */}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Color Palette</p>
                <div className="flex gap-2 flex-wrap">
                  {PALS.map(p => (
                    <button key={p.name} title={p.label} onClick={() => onPalette(p.name)}
                      className={`flex rounded-md overflow-hidden border-2 transition-all ${palette === p.name ? "border-white scale-110" : "border-transparent opacity-50 hover:opacity-80"}`}>
                      {p.colors.map((c,i) => <div key={i} className="w-5 h-5" style={{background:c}}/>)}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="Velocity Decay" value={fluidConfig.VELOCITY_DISSIPATION??0.98} min={0.88} max={1.0} step={0.001} fmt={v=>v.toFixed(3)} onChange={v=>onFluidConfig({VELOCITY_DISSIPATION:v})}/>
              <Slider label="Color Decay"    value={fluidConfig.DYE_DISSIPATION??0.977} min={0.88} max={1.0} step={0.001} fmt={v=>v.toFixed(3)} onChange={v=>onFluidConfig({DYE_DISSIPATION:v})}/>
              <Slider label="Force"          value={fluidConfig.SPLAT_FORCE??6000}    min={1000} max={15000} step={100} fmt={v=>Math.round(v).toString()} onChange={v=>onFluidConfig({SPLAT_FORCE:v})}/>
              <Slider label="Brush Size"     value={(fluidConfig.SPLAT_RADIUS??0.004)*1000} min={1} max={20} step={0.5} fmt={v=>v.toFixed(1)} onChange={v=>onFluidConfig({SPLAT_RADIUS:v/1000})}/>
            </>}

            {mode === "cloth" && <>
              <Slider label="Wind"      value={clothConfig.WIND_X??0.6}      min={0} max={4}  step={0.1} fmt={v=>v.toFixed(1)} onChange={v=>onClothConfig({WIND_X:v, WIND_Z:v*0.4})}/>
              <Slider label="Gravity"   value={Math.abs(clothConfig.GRAVITY??14)} min={1} max={30} step={0.5} fmt={v=>v.toFixed(1)} onChange={v=>onClothConfig({GRAVITY:-v})}/>
              <Slider label="Stiffness" value={clothConfig.STIFFNESS??0.98}  min={0.5} max={1.0} step={0.01} fmt={v=>v.toFixed(2)} onChange={v=>onClothConfig({STIFFNESS:v})}/>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-white/40">Wireframe</span>
                <button onClick={()=>onWireframe(!wireframe)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${wireframe?"bg-indigo-500":"bg-white/15"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${wireframe?"left-5":"left-0.5"}`}/>
                </button>
              </div>
              <button onClick={onClothReset}
                className="w-full py-2 rounded-xl bg-white/8 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-colors">
                Reset Cloth
              </button>
            </>}
          </div>

          <div className="px-4 py-2 border-t border-white/5 text-center">
            <p className="text-[10px] text-white/20">
              {mode==="fluid" ? "Move mouse across canvas to create fluid" : "Click & drag the cloth · adjust wind with slider"}
            </p>
          </div>
        </div>
      )}

      {/* Collapsed bar */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-full overflow-hidden border border-white/10 backdrop-blur-md bg-black/50">
          {modeBtn("fluid","Fluid")}
          {modeBtn("cloth","Cloth")}
        </div>
        {fps !== undefined && (
          <div className="backdrop-blur-md bg-black/50 border border-white/10 rounded-full px-3 py-1.5 text-[11px] font-mono text-white/35">
            {fps}fps
          </div>
        )}
        <button onClick={() => setOpen(o=>!o)}
          className="w-8 h-8 rounded-full backdrop-blur-md bg-black/50 border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
            <rect x="2" y="3.5" width="12" height="1.5" rx="0.75"/>
            <rect x="2" y="7.25" width="12" height="1.5" rx="0.75"/>
            <rect x="2" y="11" width="12" height="1.5" rx="0.75"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt(v: number): string; onChange(v: number): void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-white/40">{label}</span>
        <span className="text-[10px] font-mono text-white/50">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-0.5 appearance-none rounded-full bg-white/15 cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

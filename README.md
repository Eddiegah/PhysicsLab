<div align="center">

# ✦ PhysicsLab

### Real-time physics — solved, not faked.

**GPU-accelerated Navier–Stokes fluid dynamics and mass-spring cloth mechanics,**
**running entirely in your browser via WebGL2.**

<br/>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-physicslab--lovat.vercel.app-6366f1?style=for-the-badge&logo=vercel&logoColor=white)](https://physicslab-lovat.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-Eddiegah%2FPhysicsLab-24292e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Eddiegah/PhysicsLab)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![WebGL2](https://img.shields.io/badge/WebGL2-GPU%20Shaders-990000?style=for-the-badge&logo=opengl)](https://www.khronos.org/webgl/)
[![Three.js](https://img.shields.io/badge/Three.js-r166-049ef4?style=for-the-badge&logo=three.js)](https://threejs.org)

<br/>

> *Move your mouse. Watch physics happen.*

<br/>

</div>

---

## ✦ What is this?

PhysicsLab is a full-screen, real-time physics simulation running entirely in the browser — no plugins, no backend, no tricks. Two separate simulations, each solving actual equations from physics:

| Mode | What it solves | Where it runs |
|------|---------------|---------------|
| 🌊 **Fluid** | Incompressible Navier–Stokes equations | GPU — WebGL2 fragment shaders |
| 🧵 **Cloth** | Mass-spring-damper + Verlet integration | CPU + Three.js GPU rendering |

Every swirl, every wave, every fold of fabric emerges from the math — not from hand-crafted animations or lookup tables.

---

## ✦ See it live

**[→ physicslab-lovat.vercel.app](https://physicslab-lovat.vercel.app)**

Open it. Move your mouse. That's it.

---

## ✦ The simulations

### 🌊 Fluid — Navier–Stokes on the GPU

The fluid simulation solves the **incompressible Navier–Stokes equations** in real time using the *stable fluids* method (Jos Stam, SIGGRAPH 1999) — the canonical approach used in essentially every serious real-time fluid demo ever made.

Each frame, five WebGL2 fragment shader passes fire in sequence across millions of pixels:

```
① Advection      →  move velocity through itself  (u · ∇)u
② Divergence     →  measure incompressibility violation  ∇ · u
③ Pressure solve →  Jacobi iteration, ~30 passes  ∇²p = ∇ · u
④ Projection     →  enforce  ∇ · u = 0  via  u = u − ∇p
⑤ Dye advection  →  carry color through the corrected field
```

Step ④ — the **Helmholtz pressure projection** — is the step that separates real fluid simulation from noise. Without it, velocity piles up and dissipates randomly. With it, the fluid curls, swirls, and conserves momentum the way real fluid does.

**Try it:** drag your mouse slowly for elegant laminar flow. Slash it fast for turbulent chaos.

---

### 🧵 Cloth — Verlet Integration + Spring Constraints

The cloth simulation models a grid of point masses connected by three types of springs — because getting cloth right requires all three:

| Spring type | Connects | Prevents |
|-------------|----------|----------|
| **Structural** | Horizontal + vertical neighbors | Stretching |
| **Shear** | Diagonal neighbors | Parallelogram deformation |
| **Bend** | Skip-one neighbors | Folding / bending |

Integration uses **Störmer–Verlet**, not naive Euler. The key insight: velocity is *implicit* — encoded as the difference between the current and previous position. This gives second-order accuracy, eliminates velocity drift, and stays stable even when springs are stiff.

```
x(t + dt) = 2x(t) − x(t − dt) + a · dt²
```

A collision sphere sits in the scene. The cloth drapes over it, reacts to gravity, billows in the wind, and can be grabbed and pulled with the mouse.

**Try it:** grab the cloth and drag it. Crank the wind slider. Hit reset and watch it fall again.

---

## ✦ Controls

The UI is intentionally minimal — a small collapsible panel in the bottom-right corner. The simulation is the star.

**Fluid mode**
- Color palette selector (Cosmic / Ocean / Fire / Aurora / Mono)
- Velocity dissipation — how long swirls persist
- Color dissipation — how quickly dye fades
- Force strength — how powerful your mouse strokes are
- Brush size

**Cloth mode**
- Wind strength
- Gravity
- Stiffness
- Wireframe toggle
- Reset

---

## ✦ Tech stack

```
Next.js 15        →  App Router shell, static export, Vercel deployment
TypeScript        →  Full type safety throughout
WebGL2 + GLSL     →  Raw fragment shaders for the entire fluid solver
Three.js r166     →  Cloth mesh rendering, scene, lighting, camera
Tailwind CSS      →  Control panel only — the simulation needs no CSS
```

No canvas libraries. No physics engines. No abstraction layers over the math.

---

## ✦ Project structure

```
PhysicsLab/
│
├── app/
│   └── page.tsx                    Main experience — mode switching, intro overlay
│
├── components/
│   ├── FluidCanvas.tsx             WebGL2 context, rAF loop, mouse → splat input
│   ├── ClothCanvas.tsx             Three.js scene, cloth mesh, mouse picking
│   └── ControlPanel.tsx            Collapsible parameter panel
│
├── lib/
│   ├── fluid/
│   │   ├── FluidSimulation.ts      Shader compilation, framebuffers, solver pipeline
│   │   └── shaders/
│   │       ├── advection.frag.glsl     Semi-Lagrangian back-tracing
│   │       ├── divergence.frag.glsl    ∇ · u computation
│   │       ├── pressure.frag.glsl      Jacobi Poisson solver
│   │       ├── gradientSubtract.frag.glsl  Helmholtz projection
│   │       ├── splat.frag.glsl         Gaussian force/dye injection
│   │       ├── display.frag.glsl       Gamma-corrected render + bloom
│   │       └── base.vert.glsl          Full-screen quad vertex shader
│   │
│   └── cloth/
│       ├── ClothSimulation.ts      Verlet integrator, spring constraints, sphere collision
│       └── collision.ts            Sphere / plane collision utilities
│
└── types/
    └── glsl.d.ts                   TypeScript declaration for .glsl imports
```

---

## ✦ Running locally

```bash
# Clone
git clone https://github.com/Eddiegah/PhysicsLab.git
cd PhysicsLab

# Install
npm install

# Run
npm run dev
```

Open `http://localhost:3000` — the simulation starts immediately.

**Requirements**
- Node.js 20+
- A browser with WebGL2: Chrome 56+, Firefox 51+, Safari 15+, Edge 79+
- Up-to-date GPU drivers (Intel integrated graphics may have limited half-float texture support)

**Windows note:** don't run from a OneDrive-synced folder — use `C:\Projects\` or similar to avoid sync conflicts with Next.js hot reload.

---

## ✦ The math (for the curious)

Both simulations belong to the category of **numerical dynamical systems** — differential equations discretized in space and time and marched forward step by step.

The Navier–Stokes equations are a continuous dynamical system on an infinite-dimensional function space. Their behavior — turbulence, vortices, the cascade of energy from large scales to small — emerges entirely from the nonlinear advection term `(u · ∇)u`. Taming that term numerically (without it exploding or smearing everything to nothing) is the central challenge of computational fluid dynamics, and what the stable-fluids method solves elegantly.

The cloth system is a high-dimensional Hamiltonian mechanical system with algebraic constraints. Verlet integration preserves its symplectic structure — meaning energy is correctly bounded over long simulation times, something forward Euler cannot guarantee with stiff springs.

---

## ✦ Performance

| Resolution | Typical FPS | Notes |
|-----------|-------------|-------|
| 128 sim / 512 dye | 60fps+ | Any modern GPU |
| 256 sim / 1024 dye | 60fps | Default — looks great |
| 512 sim / 1024 dye | 30–60fps | High-end GPUs |

Cloth at 28×28 segments (784 particles, ~6000 springs) runs comfortably at 60fps on any modern CPU. The fluid solver is the GPU-bound workload; the cloth solver is CPU-bound but fast enough at this resolution to leave plenty of headroom.

---

## ✦ Future directions

- **Vorticity confinement** — sharper, more vivid small-scale swirls in the fluid
- **3D fluid simulation** — requires 3D textures and WebGPU compute shaders; a substantial undertaking
- **GPU cloth physics** — WebGPU would allow moving Verlet integration to a compute shader for much higher resolution cloth
- **Cloth self-collision** — spatial hashing makes this O(N), but implementation is non-trivial
- **Multiple collision primitives** — boxes, planes, arbitrary meshes

---

## ✦ References

- Jos Stam — *Stable Fluids* (SIGGRAPH 1999)
- GPU Gems Chapter 38 — *Fast Fluid Dynamics Simulation on the GPU*
- Thomas Jakobsen — *Advanced Character Physics* (2001)
- [Pavel Dobryakov's WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)

---

<div align="center">

Built with WebGL2, Three.js, and the actual equations.

**[→ Try it live](https://physicslab-lovat.vercel.app)**

</div>

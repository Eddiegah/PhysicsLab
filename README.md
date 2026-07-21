# PhysicsLab

Real-time GPU-accelerated fluid dynamics and cloth mechanics simulation, running entirely in your browser via WebGL2.

**[Live demo → physicslab.vercel.app](#)**

---

## What This Is

PhysicsLab solves two real physical systems in real time:

1. **Fluid simulation** — the incompressible Navier–Stokes equations, discretized on a 2D Eulerian grid and solved entirely on the GPU as WebGL2 fragment shader passes.
2. **Cloth simulation** — a mass-spring-damper system integrated with Verlet's method, running on the CPU with Three.js GPU rendering.

Both are *actual numerical solvers*, not visual approximations or particle tricks. A technical reader can map every line of shader code directly to the corresponding term in the governing equations.

---

## The Physics

### Fluid: Incompressible Navier–Stokes

The Navier–Stokes equations for an incompressible Newtonian fluid in 2D:

```
∂u/∂t + (u · ∇)u = -∇p/ρ + ν∇²u + f
∇ · u = 0  (incompressibility constraint)
```

Where:
- **u** = velocity field (vector at each grid cell)
- **p** = pressure field (scalar)
- **ρ** = fluid density
- **ν** = kinematic viscosity
- **f** = external body forces (mouse/touch input)

This is a system of coupled nonlinear PDEs — a canonical example of a continuous dynamical system. The simulation discretizes these on a 2D grid using the **stable-fluids method** (Jos Stam, SIGGRAPH 1999), which remains one of the standard techniques used in real-time fluid graphics.

#### GPU Solver Pipeline (each frame)

Each step runs as a sequence of WebGL2 fragment shader passes operating on floating-point framebuffer textures:

| Pass | Equation Term | Shader | Description |
|------|--------------|--------|-------------|
| 1 | `∂u/∂t + (u·∇)u` | `advection.frag.glsl` | Semi-Lagrangian back-tracing: trace velocity backwards through itself |
| 2 | `∇·u` | `divergence.frag.glsl` | Compute how far the velocity field deviates from incompressibility |
| 3 | `∇²p = ∇·u` | `pressure.frag.glsl` | Jacobi iteration (~30 passes) to solve the pressure Poisson equation |
| 4 | `u = u - ∇p` | `gradientSubtract.frag.glsl` | Helmholtz-Hodge projection: subtract pressure gradient to enforce ∇·u = 0 |
| 5 | Dye advection | `advection.frag.glsl` | Advect the color/dye field through the corrected velocity |

**Step 4 is the critical step.** Without it, the simulation produces random noise that looks nothing like fluid. The pressure projection enforces the incompressibility constraint, which is what gives the simulation its characteristic swirling, curling behavior.

#### Why Semi-Lagrangian Advection?

The advection term `(u·∇)u` causes the classic CFL instability in naive forward Euler schemes — you need `dt < dx/|u|`. The semi-Lagrangian method sidesteps this entirely by tracing characteristics backwards:

```
q(x, t+dt) = q(x - dt·u(x), t)
```

This "where did this fluid parcel come from?" approach is unconditionally stable for any timestep, making it suitable for real-time use.

#### Note on Diffusion

The viscosity term `ν∇²u` is handled implicitly via velocity dissipation (multiplying velocity by a factor slightly below 1 each frame) rather than a full diffusion solve. This produces the "ink in water" visual style — low viscosity, high color persistence — which is more visually striking than solving full diffusion. The trade-off is documented in `advection.frag.glsl`.

---

### Cloth: Mass-Spring-Damper + Verlet Integration

The cloth is modeled as a 2D grid of **N×N point masses** connected by three types of springs:

```
F_spring = -k(|r| - L₀) * r̂ - b*v_rel
```

Where:
- **k** = spring stiffness constant
- **L₀** = rest length (initial particle separation)
- **r** = displacement vector between particles
- **b** = damping coefficient
- **v_rel** = relative velocity of endpoints

Three spring types produce physically realistic cloth (using only structural springs gives "net" behavior, not fabric):

| Type | Connections | Resists |
|------|-------------|---------|
| Structural | Horizontal + vertical neighbors | Stretching |
| Shear | Diagonal neighbors | Parallelogram shearing |
| Bend | Skip-one neighbors (2 cells away) | Folding/bending |

#### Verlet Integration

Instead of forward Euler (`x += v*dt, v += a*dt`), we use Störmer–Verlet:

```
x(t+dt) = 2x(t) - x(t-dt) + a(t)·dt²
```

Velocity is implicit — encoded as the difference `(x(t) - x(t-dt)) / dt`. This has two important properties:

1. **Time-reversible**: exact for conservative forces (good for oscillatory systems like springs)
2. **No velocity storage**: halves memory, and eliminates velocity drift in constrained systems

Spring constraints are solved using **relaxation** (position-based dynamics): compute the length error and move both particles toward the rest length, repeated N times per step. More iterations → more accurate but more CPU cost. 5 iterations at 3 sub-steps/frame gives stable cloth at 60fps.

#### Sphere Collision

Each particle is tested against a sphere each frame. If inside, it's pushed to the nearest surface point:

```
if |p - center| < r:
    p = center + (p - center) * r / |p - center|
```

This creates the cloth-draping-over-sphere visual without expensive mesh-mesh intersection.

---

## Technical Architecture

This is a real physical simulation project, not a web app. The Next.js/React layer is intentionally thin — it exists to provide hot reload during development and easy Vercel deployment, not to manage complex application state.

```
lib/fluid/FluidSimulation.ts     Core WebGL2 solver: compiles shaders, allocates
                                  framebuffers, runs the 5-pass simulation loop
lib/fluid/shaders/*.glsl         GLSL shader source for each solver pass
lib/cloth/ClothSimulation.ts     Verlet integrator, spring constraint solver,
                                  Three.js geometry sync
lib/cloth/collision.ts           Sphere/plane collision utilities
components/FluidCanvas.tsx        React wrapper: rAF loop, mouse→splat input
components/ClothCanvas.tsx        React wrapper: Three.js scene, mouse picking
components/ControlPanel.tsx       Minimal parameter UI
app/page.tsx                     Mode switching, intro overlay
```

### Why This Approach

- **GPU fluid**: A 256×256 Eulerian grid with 30 Jacobi iterations is ~2.5 million float operations per frame — easily GPU-feasible but will stutter at ~5fps on CPU. WebGL2 fragment shaders run this in <1ms on any modern GPU.
- **CPU cloth**: A 28×28 grid (784 particles, ~6000 springs) with Verlet integration runs in ~0.5ms/frame on a modern CPU. Moving this to compute shaders would require WebGPU (not WebGL2) and provides no measurable benefit at this resolution.

---

## Connection to Dynamical Systems

Both simulations belong to the broader field of **computational dynamical systems** — the study of how systems governed by differential equations evolve over time. 

The Navier–Stokes equations are a continuous-time dynamical system on an infinite-dimensional function space. Their numerical solution requires discretizing both space (finite difference grid) and time (integration scheme). The interesting behaviors — turbulence, vortices, swirling patterns — emerge from the nonlinear `(u·∇)u` term, which couples modes across scales.

The cloth system is a high-dimensional Hamiltonian mechanical system with constraints. The qualitatively different behaviors (crisp draping vs. fluttering vs. oscillation) arise from the interplay of stiffness, damping, and external driving forces — a classic parameter-space exploration problem in applied dynamics.

---

## Setup

### Prerequisites

- Node.js 20+ (verified with v24.12.0)
- A browser with WebGL2 support: Chrome 56+, Firefox 51+, Safari 15+, Edge 79+
- Windows: ensure GPU drivers are up to date (WebGL2 performance varies significantly with driver version)

### Install & Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The simulation starts immediately.

### Build

```bash
npm run build
npm start
```

### Environment Notes (Windows)

- **OneDrive**: Do not run from a OneDrive-synced folder. Real-time file writes during hot reload conflict with OneDrive sync and cause permission errors. Use `C:\Projects\` or similar.
- **Browser**: Use Chrome or Edge for best WebGL2 performance. Firefox works but may be ~20% slower due to different shader compilation.
- **GPU drivers**: If the simulation is slow or glitchy, update GPU drivers. Intel integrated graphics may not support `EXT_color_buffer_float` — the code falls back to RGBA8 in that case, which may reduce quality.

### WebGL2 Compatibility

WebGL2 is required. If your browser reports no WebGL2 support:

1. Check `chrome://gpu` (Chrome) for "WebGL2" status
2. Update GPU drivers
3. Try Chrome or Edge (wider WebGL2 support than Firefox on some hardware)
4. Disable browser flags that restrict GPU acceleration

---

## Deployment (Vercel)

This is a fully static/edge deployment — no server, no API routes, no backend.

```bash
npx vercel
```

Or connect the GitHub repo to Vercel for automatic deployment on push.

**Important**: After deploying, test in an incognito window on a different machine. Occasionally:
- Shader compilation fails in production builds due to stricter GLSL validation in some WebGL implementations
- Half-float texture formats behave differently on mobile GPUs
- Safari on iOS requires explicit `precision` declarations (already included in all shaders)

If shaders fail in production but work locally, check the browser console for GLSL compilation errors — the error messages are diagnostic.

---

## Performance Tuning

| Simulation resolution | FPS (typical) | GPU cost |
|----------------------|---------------|----------|
| 128×128 + 512 dye    | 60fps+        | Low      |
| 256×256 + 1024 dye   | 60fps         | Medium   |
| 512×512 + 1024 dye   | 30-60fps      | High     |

Adjust `SIM_RESOLUTION` and `DYE_RESOLUTION` in `lib/fluid/FluidSimulation.ts`.

Cloth resolution: 28 segments (28×28 = 784 particles) runs comfortably at 60fps. Going above 50 segments may drop below 60fps on slower CPUs.

---

## Future Work

- **3D fluid simulation**: Would require 3D textures and a 3D Poisson solver — substantially more complex and ~10× more GPU memory. WebGPU compute shaders would be the right approach.
- **Vorticity confinement**: A correction term that enhances small-scale swirling features, commonly used in smoke/fire simulations.
- **WebGPU compute shaders**: Would allow moving cloth physics to the GPU and enable much higher resolution cloth.
- **Cloth self-collision**: Requires spatial hashing (O(N) with hash grid) — feasible but not trivial to implement correctly.
- **Multiple collision objects**: Extend `collision.ts` with AABB and plane support.

---

## References

- Jos Stam, "Stable Fluids" (SIGGRAPH 1999) — foundational paper for the solver used here
- GPU Gems Chapter 38, "Fast Fluid Dynamics Simulation on the GPU"
- [Pavel Dobryakov's fluid simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) — a well-known WebGL implementation of the same technique
- Thomas Jakobsen, "Advanced Character Physics" (2001) — foundational paper for position-based Verlet cloth

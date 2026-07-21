/**
 * ClothSimulation.ts
 *
 * Implements a real-time mass-spring-damper cloth simulation using
 * Verlet integration — the standard, numerically stable approach for
 * real-time cloth/particle simulations.
 *
 * Physics model:
 *   - Cloth is a 2D grid of point masses connected by springs
 *   - Three spring types (all essential for realistic-looking cloth):
 *       • Structural: horizontal/vertical neighbors (resist stretching)
 *       • Shear: diagonal neighbors (resist shearing/parallelogram deformation)
 *       • Bend: next-neighbor horizontal/vertical (resist folding/bending)
 *   - Verlet integration: x(t+dt) = 2x(t) - x(t-dt) + a * dt²
 *       Advantage over Euler: velocity is implicit (no explicit velocity storage),
 *       naturally conserves energy better, and is unconditionally stable for
 *       stiff springs with proper constraint projection.
 *   - Constraint satisfaction: spring constraints are projected N times per step
 *     (position-based dynamics style) to prevent excessive elongation.
 *   - Sphere collision: each particle is tested against a sphere and pushed
 *     out if penetrating, giving convincing cloth-over-object draping.
 *
 * The cloth simulation runs on the CPU. At 20x20 to 40x40 resolution
 * (400–1600 particles, ~3000–12000 springs), this runs comfortably at 60fps.
 * Three.js handles GPU rendering of the resulting mesh each frame.
 */

import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClothConfig {
  /** Number of particles along each axis */
  SEGMENTS: number;
  /** Physical size of the cloth in world units */
  SIZE: number;
  /** Gravity acceleration (y-axis, negative = downward) */
  GRAVITY: number;
  /** Wind force vector */
  WIND: THREE.Vector3;
  /** Spring stiffness [0..1] — how strongly springs resist elongation */
  STIFFNESS: number;
  /** Damping factor per step [0..1] — how much velocity is preserved */
  DAMPING: number;
  /** Number of constraint relaxation passes per simulation step */
  CONSTRAINT_ITERATIONS: number;
  /** Sphere collision object radius */
  SPHERE_RADIUS: number;
}

export const DEFAULT_CLOTH_CONFIG: ClothConfig = {
  SEGMENTS: 28,
  SIZE: 6,
  GRAVITY: -12,
  WIND: new THREE.Vector3(0.5, 0, 0.3),
  STIFFNESS: 0.95,
  DAMPING: 0.999,
  CONSTRAINT_ITERATIONS: 5,
  SPHERE_RADIUS: 1.5,
};

interface Particle {
  /** Current position */
  pos: THREE.Vector3;
  /** Previous position (used by Verlet integration — encodes velocity implicitly) */
  prevPos: THREE.Vector3;
  /** Acceleration accumulator (reset each step) */
  acc: THREE.Vector3;
  /** Inverse mass: 0 = pinned/fixed, 1/m = moveable */
  invMass: number;
}

interface Spring {
  a: number;           // Index of particle A
  b: number;           // Index of particle B
  restLength: number;  // Natural length of the spring (separation at rest)
  stiffness: number;   // [0..1] constraint stiffness
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class ClothSimulation {
  private config: ClothConfig;
  private particles: Particle[] = [];
  private springs: Spring[] = [];

  /** Three.js mesh for rendering */
  public mesh: THREE.Mesh;
  /** Sphere the cloth drapes over */
  public sphereMesh: THREE.Mesh;
  /** Sphere position (center) */
  public sphereCenter: THREE.Vector3;

  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private normals: Float32Array;

  // Mouse interaction
  private dragParticleIndex = -1;
  private dragTarget = new THREE.Vector3();

  constructor(config: Partial<ClothConfig> = {}) {
    this.config = { ...DEFAULT_CLOTH_CONFIG, ...config };
    this.sphereCenter = new THREE.Vector3(0, 0.5, 0);

    // Build Three.js geometry and mesh
    const { geometry, positions, normals } = this.buildGeometry();
    this.geometry = geometry;
    this.positions = positions;
    this.normals = normals;

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x4466ff,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      opacity: 0.92,
      wireframe: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Sphere (collision object)
    const sphereGeo = new THREE.SphereGeometry(this.config.SPHERE_RADIUS, 32, 32);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0x222244,
      roughness: 0.3,
      metalness: 0.7,
    });
    this.sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.sphereMesh.position.copy(this.sphereCenter);
    this.sphereMesh.castShadow = true;
    this.sphereMesh.receiveShadow = true;

    // Initialize particles and springs
    this.reset();
  }

  // ─── Initialization ──────────────────────────────────────────────────────

  private buildGeometry(): { geometry: THREE.BufferGeometry; positions: Float32Array; normals: Float32Array } {
    const n = this.config.SEGMENTS + 1; // particles per axis
    const vertCount = n * n;
    const faceCount = this.config.SEGMENTS * this.config.SEGMENTS * 2;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint32Array(faceCount * 3);

    // UV coordinates
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        uvs[i * 2] = x / this.config.SEGMENTS;
        uvs[i * 2 + 1] = y / this.config.SEGMENTS;
      }
    }

    // Quad faces (two triangles each)
    let idx = 0;
    for (let y = 0; y < this.config.SEGMENTS; y++) {
      for (let x = 0; x < this.config.SEGMENTS; x++) {
        const a = y * n + x;
        const b = a + 1;
        const c = (y + 1) * n + x;
        const d = c + 1;
        indices[idx++] = a; indices[idx++] = c; indices[idx++] = b;
        indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return { geometry, positions, normals };
  }

  public reset(): void {
    const { SEGMENTS, SIZE } = this.config;
    const n = SEGMENTS + 1;
    const step = SIZE / SEGMENTS;
    const halfSize = SIZE / 2;

    this.particles = [];
    this.springs = [];

    // Create particles in a grid, initially flat/horizontal
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = x * step - halfSize;
        const py = SIZE + 1; // Start above the sphere
        const pz = y * step - halfSize;

        const pos = new THREE.Vector3(px, py, pz);
        const prevPos = pos.clone();

        // Pin the top two corners (index 0 and n-1 in top row)
        const isTopCorner = y === 0 && (x === 0 || x === SEGMENTS);
        const invMass = isTopCorner ? 0 : 1;

        this.particles.push({
          pos, prevPos,
          acc: new THREE.Vector3(),
          invMass,
        });
      }
    }

    // Create springs — three types for realistic cloth behaviour
    const addSpring = (ai: number, bi: number, stiffness: number) => {
      const restLength = this.particles[ai].pos.distanceTo(this.particles[bi].pos);
      this.springs.push({ a: ai, b: bi, restLength, stiffness });
    };

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;

        // Structural springs (horizontal): resist stretching left-right
        if (x < SEGMENTS) addSpring(i, i + 1, this.config.STIFFNESS);
        // Structural springs (vertical): resist stretching up-down
        if (y < SEGMENTS) addSpring(i, i + n, this.config.STIFFNESS);

        // Shear springs (diagonal): resist shearing deformation
        // Without these, cloth looks like a net, not fabric
        if (x < SEGMENTS && y < SEGMENTS) {
          addSpring(i, i + n + 1, this.config.STIFFNESS * 0.9);
          addSpring(i + 1, i + n, this.config.STIFFNESS * 0.9);
        }

        // Bend springs (skip-one): resist bending/folding
        // Connect to neighbors 2 steps away — these are the "bending stiffness"
        if (x < SEGMENTS - 1) addSpring(i, i + 2, this.config.STIFFNESS * 0.5);
        if (y < SEGMENTS - 1) addSpring(i, i + n * 2, this.config.STIFFNESS * 0.5);
      }
    }

    // Sync positions to geometry
    this.syncToGeometry();
  }

  // ─── Simulation Step ─────────────────────────────────────────────────────

  /**
   * Advance the simulation by one timestep.
   * Uses sub-stepping (multiple small steps) for stability with stiff springs.
   *
   * @param dt - elapsed time in seconds (clamped internally to prevent instability)
   */
  public step(dt: number): void {
    // Clamp dt — large timesteps cause instability even with Verlet
    const clampedDt = Math.min(dt, 1 / 30);
    // Sub-step count: more sub-steps = more stable, more CPU cost
    const subSteps = 3;
    const subDt = clampedDt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this.applyForces(subDt);
      this.integrateVerlet(subDt);
      this.satisfyConstraints();
      this.handleSphereCollision();
      this.handleMouseDrag();
    }

    this.syncToGeometry();
  }

  /**
   * Verlet integration: x(t+dt) = 2x(t) - x(t-dt) + a*dt²
   *
   * This is equivalent to a second-order Taylor expansion and is more
   * accurate than forward Euler while remaining unconditionally stable
   * for conservative forces. The "velocity" is implicit: v = (x - x_prev) / dt.
   * No explicit velocity variable is needed.
   */
  private integrateVerlet(dt: number): void {
    const dt2 = dt * dt;
    for (const p of this.particles) {
      if (p.invMass === 0) continue; // Pinned particle — doesn't move

      // Save current position — this becomes prevPos after the step
      const currentPos = p.pos.clone();

      // Verlet step: x_new = 2*x - x_prev + a*dt²
      // Rewritten as:  x_new = x + (x - x_prev) + a*dt²
      // where (x - x_prev) is the implicit velocity times dt
      const newPos = p.pos.clone()
        .multiplyScalar(2)
        .sub(p.prevPos)
        .addScaledVector(p.acc, dt2);

      // Apply damping: shrink the implicit velocity slightly
      // Effective velocity after step = (newPos - currentPos)
      // Damped: reduce by (1 - damping) factor
      const vel = newPos.clone().sub(currentPos);
      vel.multiplyScalar(this.config.DAMPING);

      p.pos.copy(currentPos.clone().add(vel));
      p.prevPos.copy(currentPos);
      p.acc.set(0, 0, 0); // Reset accumulator for next frame
    }
  }

  /** Accumulate external forces into acceleration. */
  private applyForces(_dt: number): void {
    const { GRAVITY, WIND } = this.config;
    // Wind varies slightly over time for organic feel
    const t = performance.now() * 0.001;
    const windNoise = Math.sin(t * 0.7) * 0.3 + Math.sin(t * 1.3) * 0.2;

    for (const p of this.particles) {
      if (p.invMass === 0) continue;

      // Gravity: a = g (directly, since F = m*g and we integrate acceleration)
      p.acc.y += GRAVITY;

      // Wind: add per-particle turbulence for an organic, billowing look
      p.acc.x += (WIND.x + windNoise) * (0.8 + Math.random() * 0.4);
      p.acc.z += WIND.z * (0.8 + Math.random() * 0.4);
    }
  }

  /**
   * Satisfy spring constraints using relaxation (position-based dynamics style).
   *
   * For each spring, we compute the current length vs rest length and
   * move both particles toward each other (or apart) proportionally to
   * their masses to correct the error. Running this N times per step
   * converges toward the physically correct spring length.
   *
   * This is more stable than force-based spring resolution for cloth.
   */
  private satisfyConstraints(): void {
    for (let iter = 0; iter < this.config.CONSTRAINT_ITERATIONS; iter++) {
      for (const spring of this.springs) {
        const pa = this.particles[spring.a];
        const pb = this.particles[spring.b];

        const delta = pb.pos.clone().sub(pa.pos);
        const currentLen = delta.length();
        if (currentLen < 1e-6) continue;

        // How stretched/compressed is this spring?
        const error = (currentLen - spring.restLength) / currentLen;
        // Apply correction scaled by stiffness
        const correction = delta.multiplyScalar(0.5 * error * spring.stiffness);

        // Distribute correction inversely proportional to mass
        const totalInvMass = pa.invMass + pb.invMass;
        if (totalInvMass === 0) continue;

        if (pa.invMass > 0) pa.pos.addScaledVector(correction, pa.invMass / totalInvMass * 2);
        if (pb.invMass > 0) pb.pos.addScaledVector(correction, -pb.invMass / totalInvMass * 2);
      }
    }
  }

  /**
   * Sphere collision: push particles outside the sphere.
   * Simple and effective for the "cloth draping over object" visual.
   */
  private handleSphereCollision(): void {
    const r = this.config.SPHERE_RADIUS + 0.05; // small offset to prevent z-fighting
    for (const p of this.particles) {
      if (p.invMass === 0) continue;

      const diff = p.pos.clone().sub(this.sphereCenter);
      const dist = diff.length();

      if (dist < r) {
        // Push the particle to the sphere surface
        p.pos.copy(this.sphereCenter).addScaledVector(diff, r / dist);
      }
    }
  }

  /** Apply mouse drag force to the grabbed particle. */
  private handleMouseDrag(): void {
    if (this.dragParticleIndex < 0) return;
    const p = this.particles[this.dragParticleIndex];
    if (!p || p.invMass === 0) return;

    // Gently pull particle toward the drag target (not instant snapping)
    p.pos.lerp(this.dragTarget, 0.3);
    p.prevPos.copy(p.pos); // Zero out implicit velocity to prevent launch
  }

  // ─── Geometry Sync ───────────────────────────────────────────────────────

  /** Copy particle positions to Three.js geometry and recompute normals. */
  private syncToGeometry(): void {
    const n = this.config.SEGMENTS + 1;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
    }

    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  // ─── Mouse Interaction ───────────────────────────────────────────────────

  /** Find the closest particle to a 3D world position (for mouse picking). */
  public grabParticle(worldPos: THREE.Vector3): void {
    let minDist = Infinity;
    let closest = -1;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass === 0) continue;
      const d = p.pos.distanceTo(worldPos);
      if (d < minDist) { minDist = d; closest = i; }
    }
    if (minDist < 2.0) { // Only grab if close enough
      this.dragParticleIndex = closest;
      this.dragTarget.copy(worldPos);
    }
  }

  public moveDrag(worldPos: THREE.Vector3): void {
    this.dragTarget.copy(worldPos);
  }

  public releaseDrag(): void {
    this.dragParticleIndex = -1;
  }

  // ─── Public Config ───────────────────────────────────────────────────────

  public updateConfig(partial: Partial<ClothConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  public getConfig(): ClothConfig {
    return { ...this.config };
  }

  public setWireframe(enabled: boolean): void {
    (this.mesh.material as THREE.MeshPhysicalMaterial).wireframe = enabled;
  }

  public dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

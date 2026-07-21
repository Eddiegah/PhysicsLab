/**
 * ClothSimulation.ts
 *
 * Mass-spring cloth simulation using Verlet integration.
 * A grid of point masses connected by structural, shear, and bend springs,
 * with sphere collision and mouse-grab interaction.
 */

import * as THREE from "three";

export interface ClothConfig {
  SEGMENTS: number;       // grid points per axis (segments+1 vertices)
  SIZE: number;           // world-space size
  GRAVITY: number;        // downward acceleration (negative = down)
  WIND_X: number;         // wind force X
  WIND_Z: number;         // wind force Z
  STIFFNESS: number;      // spring constraint strength 0..1
  DAMPING: number;        // velocity damping per step
  CONSTRAINT_ITERS: number;
  SPHERE_RADIUS: number;
}

export const DEFAULT_CLOTH_CONFIG: ClothConfig = {
  SEGMENTS: 24,
  SIZE: 6,
  GRAVITY: -14,
  WIND_X: 0.6,
  WIND_Z: 0.25,
  STIFFNESS: 0.98,
  DAMPING: 0.999,
  CONSTRAINT_ITERS: 6,
  SPHERE_RADIUS: 1.6,
};

// ─────────────────────────────────────────────────────────────────────────────

interface Particle {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  acc: THREE.Vector3;
  pinned: boolean;
}

interface Spring {
  a: number; b: number;
  rest: number;
  stiffness: number;
}

export class ClothSimulation {
  public mesh: THREE.Mesh;
  public sphereMesh: THREE.Mesh;
  public sphereCenter = new THREE.Vector3(0, 0.2, 0);

  private cfg: ClothConfig;
  private particles: Particle[] = [];
  private springs: Spring[] = [];
  private geo: THREE.BufferGeometry;
  private positions: Float32Array;
  private dragIdx = -1;
  private dragTarget = new THREE.Vector3();

  constructor(cfg: Partial<ClothConfig> = {}) {
    this.cfg = { ...DEFAULT_CLOTH_CONFIG, ...cfg };

    // Geometry
    const n = this.cfg.SEGMENTS + 1;
    const vc = n * n;
    this.positions = new Float32Array(vc * 3);
    const uvs      = new Float32Array(vc * 2);
    const seg      = this.cfg.SEGMENTS;
    const fc       = seg * seg * 2;
    const idx      = new Uint32Array(fc * 3);

    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y*n+x;
        uvs[i*2]   = x/seg;
        uvs[i*2+1] = y/seg;
      }

    let ii = 0;
    for (let y = 0; y < seg; y++)
      for (let x = 0; x < seg; x++) {
        const a=y*n+x, b=a+1, c=(y+1)*n+x, d=c+1;
        idx[ii++]=a; idx[ii++]=c; idx[ii++]=b;
        idx[ii++]=b; idx[ii++]=c; idx[ii++]=d;
      }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("uv",       new THREE.BufferAttribute(uvs, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));

    // Cloth material — shimmery fabric look
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.18, 0.25, 0.9),
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.0,
      transmission: 0.08,
      transparent: true,
      opacity: 0.94,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Sphere
    const sGeo = new THREE.SphereGeometry(this.cfg.SPHERE_RADIUS, 48, 48);
    const sMat = new THREE.MeshPhysicalMaterial({
      color: 0x111128,
      roughness: 0.15,
      metalness: 0.85,
      envMapIntensity: 1.0,
    });
    this.sphereMesh = new THREE.Mesh(sGeo, sMat);
    this.sphereMesh.position.copy(this.sphereCenter);
    this.sphereMesh.castShadow = true;
    this.sphereMesh.receiveShadow = true;

    this.reset();
  }

  reset(): void {
    const n   = this.cfg.SEGMENTS + 1;
    const seg = this.cfg.SEGMENTS;
    const sz  = this.cfg.SIZE;
    const step = sz / seg;
    const half = sz / 2;

    this.particles = [];
    this.springs   = [];

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = x*step - half;
        const py = sz + 2;         // start above sphere
        const pz = y*step - half;
        const pos  = new THREE.Vector3(px, py, pz);
        // Pin the top-left and top-right corners
        const pinned = y === 0 && (x === 0 || x === seg);
        this.particles.push({ pos, prev: pos.clone(), acc: new THREE.Vector3(), pinned });
      }
    }

    const add = (ai: number, bi: number, s: number) => {
      const r = this.particles[ai].pos.distanceTo(this.particles[bi].pos);
      this.springs.push({ a: ai, b: bi, rest: r, stiffness: s });
    };

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y*n+x;
        if (x < seg) add(i, i+1,     this.cfg.STIFFNESS);          // structural H
        if (y < seg) add(i, i+n,     this.cfg.STIFFNESS);          // structural V
        if (x < seg && y < seg) {
          add(i,   i+n+1, this.cfg.STIFFNESS*0.85);                // shear \
          add(i+1, i+n,   this.cfg.STIFFNESS*0.85);                // shear /
        }
        if (x < seg-1) add(i, i+2,   this.cfg.STIFFNESS*0.5);     // bend H
        if (y < seg-1) add(i, i+n*2, this.cfg.STIFFNESS*0.5);     // bend V
      }
    }

    this.syncGeo();
  }

  step(dt: number): void {
    const sub = 3;
    const sdt = Math.min(dt, 1/30) / sub;
    for (let s = 0; s < sub; s++) {
      this.forces(sdt);
      this.integrate(sdt);
      this.constrain();
      this.collide();
      this.applyDrag();
    }
    this.syncGeo();
  }

  private forces(_dt: number): void {
    const t = performance.now() * 0.001;
    const gust = Math.sin(t*0.6)*0.35 + Math.sin(t*1.4)*0.2;
    for (const p of this.particles) {
      if (p.pinned) continue;
      p.acc.y += this.cfg.GRAVITY;
      p.acc.x += (this.cfg.WIND_X + gust) * (0.7 + Math.random()*0.6);
      p.acc.z += this.cfg.WIND_Z * (0.7 + Math.random()*0.6);
    }
  }

  /** Störmer-Verlet: x_new = 2x - x_prev + a·dt²  */
  private integrate(dt: number): void {
    const dt2 = dt * dt;
    for (const p of this.particles) {
      if (p.pinned) { p.acc.set(0,0,0); continue; }
      const cur  = p.pos.clone();
      const vel  = cur.clone().sub(p.prev).multiplyScalar(this.cfg.DAMPING);
      p.pos.copy(cur.clone().add(vel).addScaledVector(p.acc, dt2));
      p.prev.copy(cur);
      p.acc.set(0,0,0);
    }
  }

  private constrain(): void {
    for (let iter = 0; iter < this.cfg.CONSTRAINT_ITERS; iter++) {
      for (const sp of this.springs) {
        const pa = this.particles[sp.a];
        const pb = this.particles[sp.b];
        const d  = pb.pos.clone().sub(pa.pos);
        const len = d.length();
        if (len < 1e-6) continue;
        const err = (len - sp.rest) / len;
        const corr = d.multiplyScalar(0.5 * err * sp.stiffness);
        const wA = pa.pinned ? 0 : 1;
        const wB = pb.pinned ? 0 : 1;
        const wSum = wA + wB; if (wSum === 0) continue;
        if (!pa.pinned) pa.pos.addScaledVector(corr,  wA/wSum * 2);
        if (!pb.pinned) pb.pos.addScaledVector(corr, -wB/wSum * 2);
      }
    }
  }

  private collide(): void {
    const r = this.cfg.SPHERE_RADIUS + 0.04;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const d = p.pos.clone().sub(this.sphereCenter);
      if (d.length() < r) p.pos.copy(this.sphereCenter).addScaledVector(d.normalize(), r);
    }
  }

  private applyDrag(): void {
    if (this.dragIdx < 0) return;
    const p = this.particles[this.dragIdx];
    if (!p || p.pinned) return;
    p.pos.lerp(this.dragTarget, 0.35);
    p.prev.copy(p.pos);
  }

  private syncGeo(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const { x, y, z } = this.particles[i].pos;
      this.positions[i*3]   = x;
      this.positions[i*3+1] = y;
      this.positions[i*3+2] = z;
    }
    this.geo.getAttribute("position").needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // ── Mouse interaction ───────────────────────────────────────────────────────
  grab(worldPos: THREE.Vector3): void {
    let best = Infinity, idx = -1;
    this.particles.forEach((p, i) => {
      if (p.pinned) return;
      const d = p.pos.distanceTo(worldPos);
      if (d < best) { best = d; idx = i; }
    });
    if (best < 3.0) { this.dragIdx = idx; this.dragTarget.copy(worldPos); }
  }
  drag(wp: THREE.Vector3): void { this.dragTarget.copy(wp); }
  release(): void { this.dragIdx = -1; }

  setWireframe(v: boolean): void {
    (this.mesh.material as THREE.MeshPhysicalMaterial).wireframe = v;
  }

  updateConfig(c: Partial<ClothConfig>): void {
    this.cfg = { ...this.cfg, ...c };
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

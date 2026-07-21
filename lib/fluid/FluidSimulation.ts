/**
 * FluidSimulation.ts
 *
 * Implements a real-time Eulerian fluid simulation on the GPU using WebGL2.
 * Based on Jos Stam's "Stable Fluids" (SIGGRAPH 1999) — the canonical method
 * for real-time, unconditionally stable fluid simulation.
 *
 * Each simulation step executes these GPU passes in order:
 *   1. Splat: inject user input (mouse velocity + color)
 *   2. Advection (velocity): move velocity through itself
 *   3. Divergence: compute ∇ · u to measure incompressibility violation
 *   4. Pressure solve: Jacobi iteration (~30 passes) to solve ∇²p = ∇ · u
 *   5. Gradient subtract: u = u - ∇p (enforces incompressibility ∇ · u = 0)
 *   6. Advection (dye): move color/dye through the corrected velocity field
 *   7. Display: render dye field to screen canvas
 *
 * All state lives in floating-point WebGL2 textures; the CPU only handles
 * input events and uniform updates — the solver is entirely GPU-bound.
 */

// Raw GLSL shader source strings (loaded by webpack as asset/source)
import baseVert from "./shaders/base.vert.glsl";
import advectionFrag from "./shaders/advection.frag.glsl";
import divergenceFrag from "./shaders/divergence.frag.glsl";
import pressureFrag from "./shaders/pressure.frag.glsl";
import gradientSubtractFrag from "./shaders/gradientSubtract.frag.glsl";
import splatFrag from "./shaders/splat.frag.glsl";
import displayFrag from "./shaders/display.frag.glsl";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DoubleFramebuffer {
  read: WebGLFramebuffer;
  write: WebGLFramebuffer;
  readTex: WebGLTexture;
  writeTex: WebGLTexture;
  swap: () => void;
  texelSize: [number, number];
  width: number;
  height: number;
}

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export interface FluidConfig {
  /** Simulation grid resolution. Higher = more detail but more GPU cost. */
  SIM_RESOLUTION: number;
  /** Dye texture resolution. Can be higher than sim for visual detail. */
  DYE_RESOLUTION: number;
  /** Jacobi iteration count for pressure solver. More = more accurate. */
  PRESSURE_ITERATIONS: number;
  /** Velocity field decay per frame (1.0 = no decay). */
  VELOCITY_DISSIPATION: number;
  /** Dye/color field decay per frame (1.0 = no decay). */
  DYE_DISSIPATION: number;
  /** Splat radius in UV space. */
  SPLAT_RADIUS: number;
  /** Splat force multiplier. */
  SPLAT_FORCE: number;
}

export const DEFAULT_CONFIG: FluidConfig = {
  SIM_RESOLUTION: 256,
  DYE_RESOLUTION: 1024,
  PRESSURE_ITERATIONS: 30,
  VELOCITY_DISSIPATION: 0.98,
  DYE_DISSIPATION: 0.985,
  SPLAT_RADIUS: 0.0012,
  SPLAT_FORCE: 6000,
};

// ─── Color Palettes ───────────────────────────────────────────────────────────

export type PaletteName = "cosmic" | "ocean" | "fire" | "aurora" | "monochrome";

export const PALETTES: Record<PaletteName, [number, number, number][]> = {
  cosmic: [
    [0.8, 0.1, 0.9],
    [0.1, 0.4, 1.0],
    [0.0, 0.9, 0.8],
    [0.9, 0.2, 0.5],
    [0.3, 0.1, 1.0],
  ],
  ocean: [
    [0.0, 0.6, 1.0],
    [0.0, 0.9, 0.7],
    [0.1, 0.3, 0.8],
    [0.0, 1.0, 0.5],
    [0.2, 0.5, 0.9],
  ],
  fire: [
    [1.0, 0.1, 0.0],
    [1.0, 0.5, 0.0],
    [1.0, 0.9, 0.0],
    [0.8, 0.0, 0.0],
    [1.0, 0.3, 0.1],
  ],
  aurora: [
    [0.0, 1.0, 0.5],
    [0.5, 0.0, 1.0],
    [0.0, 0.8, 0.9],
    [0.8, 0.0, 0.6],
    [0.0, 0.6, 0.4],
  ],
  monochrome: [
    [0.9, 0.9, 0.9],
    [0.7, 0.7, 0.7],
    [1.0, 1.0, 1.0],
    [0.6, 0.6, 0.6],
    [0.85, 0.85, 0.85],
  ],
};

// ─── Main Class ───────────────────────────────────────────────────────────────

export class FluidSimulation {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private config: FluidConfig;

  // Shader programs for each pass
  private advectionProgram!: ShaderProgram;
  private divergenceProgram!: ShaderProgram;
  private pressureProgram!: ShaderProgram;
  private gradientSubtractProgram!: ShaderProgram;
  private splatProgram!: ShaderProgram;
  private displayProgram!: ShaderProgram;

  // Framebuffer pairs for ping-pong rendering
  private velocity!: DoubleFramebuffer;
  private dye!: DoubleFramebuffer;
  private divergenceBuffer!: { fbo: WebGLFramebuffer; tex: WebGLTexture; texelSize: [number, number] };
  private pressure!: DoubleFramebuffer;

  // Full-screen quad geometry
  private quadVAO!: WebGLVertexArrayObject;
  private quadVBO!: WebGLBuffer;

  // Active color palette
  private palette: PaletteName = "cosmic";
  private colorIndex = 0;
  private lastColorChange = 0;

  constructor(canvas: HTMLCanvasElement, config: Partial<FluidConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });

    if (!gl) throw new Error("WebGL2 not supported in this browser/GPU");
    this.gl = gl;

    this.init();
  }

  // ─── Initialization ──────────────────────────────────────────────────────

  // Whether the GPU supports rendering to half-float / float textures
  private halfFloatSupport = false;
  private floatSupport = false;

  private init(): void {
    const gl = this.gl;

    // WebGL2 requires explicit extension opt-in for float render targets.
    // EXT_color_buffer_float covers both float and half-float.
    // EXT_color_buffer_half_float is the fallback for half-float only.
    this.floatSupport = !!gl.getExtension("EXT_color_buffer_float");
    if (!this.floatSupport) {
      this.halfFloatSupport = !!gl.getExtension("EXT_color_buffer_half_float");
      console.warn("EXT_color_buffer_float unavailable; halfFloat:", this.halfFloatSupport);
    } else {
      this.halfFloatSupport = true;
    }

    // LINEAR filtering on half-float textures (needed for advection bilinear)
    gl.getExtension("OES_texture_half_float_linear");
    gl.getExtension("OES_texture_float_linear");

    // Compile all shader programs
    this.advectionProgram = this.createProgram(baseVert, advectionFrag, [
      "u_velocity", "u_source", "u_texelSize", "u_dt", "u_dissipation",
    ]);
    this.divergenceProgram = this.createProgram(baseVert, divergenceFrag, [
      "u_velocity", "u_texelSize",
    ]);
    this.pressureProgram = this.createProgram(baseVert, pressureFrag, [
      "u_pressure", "u_divergence", "u_texelSize",
    ]);
    this.gradientSubtractProgram = this.createProgram(baseVert, gradientSubtractFrag, [
      "u_pressure", "u_velocity", "u_texelSize",
    ]);
    this.splatProgram = this.createProgram(baseVert, splatFrag, [
      "u_target", "u_point", "u_color", "u_radius", "u_isVelocity",
    ]);
    this.displayProgram = this.createProgram(baseVert, displayFrag, [
      "u_dye", "u_texelSize",
    ]);

    // Create full-screen quad VAO (two triangles covering NDC [-1,1])
    this.quadVAO = gl.createVertexArray()!;
    this.quadVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,   1, -1,   -1, 1,
       1, -1,   1,  1,   -1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Allocate simulation textures
    this.initFramebuffers();

    // Kick off some initial splats for immediate visual interest
    this.multipleRandomSplats(8);
  }

  private initFramebuffers(): void {
    const gl = this.gl;
    const { SIM_RESOLUTION, DYE_RESOLUTION } = this.config;

    const simSize = this.getResolution(SIM_RESOLUTION);
    const dyeSize = this.getResolution(DYE_RESOLUTION);

    // Choose texture formats based on GPU support.
    // Half-float (HALF_FLOAT) is preferred: sufficient precision, less memory.
    // Fall back to UNSIGNED_BYTE (RGBA8) if float render targets aren't supported.
    const useHalf = this.halfFloatSupport;
    const halfType = gl.HALF_FLOAT;
    const byteType = gl.UNSIGNED_BYTE;

    const velFmt = useHalf
      ? { internal: gl.RG16F,   format: gl.RG,   type: halfType }
      : { internal: gl.RGBA,    format: gl.RGBA,  type: byteType };
    const dyeFmt = useHalf
      ? { internal: gl.RGBA16F, format: gl.RGBA,  type: halfType }
      : { internal: gl.RGBA,    format: gl.RGBA,  type: byteType };
    const presFmt = useHalf
      ? { internal: gl.R16F,    format: gl.RED,   type: halfType }
      : { internal: gl.RGBA,    format: gl.RGBA,  type: byteType };

    this.velocity = this.createDoubleFramebuffer(
      simSize.w, simSize.h, velFmt.internal, velFmt.format, velFmt.type, gl.LINEAR);
    this.dye = this.createDoubleFramebuffer(
      dyeSize.w, dyeSize.h, dyeFmt.internal, dyeFmt.format, dyeFmt.type, gl.LINEAR);
    this.pressure = this.createDoubleFramebuffer(
      simSize.w, simSize.h, presFmt.internal, presFmt.format, presFmt.type, gl.NEAREST);

    const { tex: divTex, fbo: divFbo } = this.createFramebuffer(
      simSize.w, simSize.h, presFmt.internal, presFmt.format, presFmt.type, gl.NEAREST);
    this.divergenceBuffer = { fbo: divFbo, tex: divTex, texelSize: [1 / simSize.w, 1 / simSize.h] };
  }

  // ─── Shader & Framebuffer Utilities ─────────────────────────────────────

  private createProgram(vertSrc: string, fragSrc: string, uniformNames: string[]): ShaderProgram {
    const gl = this.gl;

    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      throw new Error(`Vertex shader compile error:\n${gl.getShaderInfoLog(vert)}`);
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      throw new Error(`Fragment shader compile error:\n${gl.getShaderInfoLog(frag)}`);
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    // Bind position attribute to location 0 (matches VAO setup)
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader program link error:\n${gl.getProgramInfoLog(program)}`);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return { program, uniforms };
  }

  private createTexture(
    w: number, h: number,
    internalFormat: number, format: number, type: number,
    filter: number
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    return tex;
  }

  private createFramebuffer(
    w: number, h: number,
    internalFormat: number, format: number, type: number, filter: number
  ): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl;
    const tex = this.createTexture(w, h, internalFormat, format, type, filter);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // Verify the framebuffer is complete — if not, the texture format is unsupported
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error(`Framebuffer incomplete: 0x${status.toString(16)} — format ${internalFormat} may be unsupported`);
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, tex };
  }

  private createDoubleFramebuffer(
    w: number, h: number,
    internalFormat: number, format: number, type: number, filter: number
  ): DoubleFramebuffer {
    const a = this.createFramebuffer(w, h, internalFormat, format, type, filter);
    const b = this.createFramebuffer(w, h, internalFormat, format, type, filter);

    const texelSize: [number, number] = [1 / w, 1 / h];

    const dfb: DoubleFramebuffer = {
      read: a.fbo, write: b.fbo,
      readTex: a.tex, writeTex: b.tex,
      texelSize, width: w, height: h,
      swap() {
        [dfb.read, dfb.write] = [dfb.write, dfb.read];
        [dfb.readTex, dfb.writeTex] = [dfb.writeTex, dfb.readTex];
      },
    };

    return dfb;
  }

  private getResolution(resolution: number): { w: number; h: number } {
    const ar = this.canvas.width / this.canvas.height;
    if (ar > 1) return { w: Math.round(resolution * ar), h: resolution };
    return { w: resolution, h: Math.round(resolution / ar) };
  }

  // ─── Render Passes ───────────────────────────────────────────────────────

  private runProgram(prog: ShaderProgram, targetFbo: WebGLFramebuffer | null, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private bindTexture(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Execute one full simulation step. Call each animation frame. */
  public step(dt: number): void {
    const gl = this.gl;
    const cfg = this.config;

    // ── Pass 1: Advect velocity through itself ─────────────────────────────
    // This moves the velocity vectors along their own flow, capturing the
    // inertia of the fluid. Uses back-tracing (semi-Lagrangian method).
    {
      const prog = this.advectionProgram;
      gl.useProgram(prog.program);
      this.bindTexture(0, this.velocity.readTex);
      this.bindTexture(1, this.velocity.readTex);
      gl.uniform1i(prog.uniforms["u_velocity"], 0);
      gl.uniform1i(prog.uniforms["u_source"], 1);
      gl.uniform2f(prog.uniforms["u_texelSize"], ...this.velocity.texelSize);
      gl.uniform1f(prog.uniforms["u_dt"], dt);
      gl.uniform1f(prog.uniforms["u_dissipation"], cfg.VELOCITY_DISSIPATION);
      this.runProgram(prog, this.velocity.write, this.velocity.width, this.velocity.height);
      this.velocity.swap();
    }

    // ── Pass 2: Compute divergence ∇ · u ──────────────────────────────────
    // After advection, velocity is no longer divergence-free. We measure
    // how far it deviates — this drives the pressure solve.
    {
      const prog = this.divergenceProgram;
      gl.useProgram(prog.program);
      this.bindTexture(0, this.velocity.readTex);
      gl.uniform1i(prog.uniforms["u_velocity"], 0);
      gl.uniform2f(prog.uniforms["u_texelSize"], ...this.velocity.texelSize);
      this.runProgram(prog, this.divergenceBuffer.fbo, this.velocity.width, this.velocity.height);
    }

    // ── Pass 3: Pressure solve (Jacobi iteration) ─────────────────────────
    // Iteratively solve the Poisson equation ∇²p = ∇ · u.
    // Each iteration improves the pressure estimate. 30 iterations gives
    // a good balance between accuracy and performance.
    // Note: We clear the pressure field each frame to avoid temporal artifacts.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read);
    gl.viewport(0, 0, this.pressure.width, this.pressure.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pressureProg = this.pressureProgram;
    gl.useProgram(pressureProg.program);
    gl.uniform2f(pressureProg.uniforms["u_texelSize"], ...this.velocity.texelSize);

    for (let i = 0; i < cfg.PRESSURE_ITERATIONS; i++) {
      this.bindTexture(0, this.pressure.readTex);
      this.bindTexture(1, this.divergenceBuffer.tex);
      gl.uniform1i(pressureProg.uniforms["u_pressure"], 0);
      gl.uniform1i(pressureProg.uniforms["u_divergence"], 1);
      this.runProgram(pressureProg, this.pressure.write, this.pressure.width, this.pressure.height);
      this.pressure.swap();
    }

    // ── Pass 4: Subtract pressure gradient ∇p from velocity ───────────────
    // u = u - ∇p  →  makes the velocity field divergence-free.
    // This is the Helmholtz projection that enforces incompressibility.
    {
      const prog = this.gradientSubtractProgram;
      gl.useProgram(prog.program);
      this.bindTexture(0, this.pressure.readTex);
      this.bindTexture(1, this.velocity.readTex);
      gl.uniform1i(prog.uniforms["u_pressure"], 0);
      gl.uniform1i(prog.uniforms["u_velocity"], 1);
      gl.uniform2f(prog.uniforms["u_texelSize"], ...this.velocity.texelSize);
      this.runProgram(prog, this.velocity.write, this.velocity.width, this.velocity.height);
      this.velocity.swap();
    }

    // ── Pass 5: Advect dye through the corrected velocity field ────────────
    // The dye (color) is a passive scalar transported by the fluid.
    // We advect it using the now-divergence-free velocity for realism.
    {
      const prog = this.advectionProgram;
      gl.useProgram(prog.program);
      this.bindTexture(0, this.velocity.readTex);
      this.bindTexture(1, this.dye.readTex);
      gl.uniform1i(prog.uniforms["u_velocity"], 0);
      gl.uniform1i(prog.uniforms["u_source"], 1);
      gl.uniform2f(prog.uniforms["u_texelSize"], ...this.dye.texelSize);
      gl.uniform1f(prog.uniforms["u_dt"], dt);
      gl.uniform1f(prog.uniforms["u_dissipation"], cfg.DYE_DISSIPATION);
      this.runProgram(prog, this.dye.write, this.dye.width, this.dye.height);
      this.dye.swap();
    }
  }

  /** Render the current dye field to the canvas. */
  public render(): void {
    const gl = this.gl;
    const prog = this.displayProgram;
    gl.useProgram(prog.program);
    this.bindTexture(0, this.dye.readTex);
    gl.uniform1i(prog.uniforms["u_dye"], 0);
    gl.uniform2f(prog.uniforms["u_texelSize"], 1 / this.canvas.width, 1 / this.canvas.height);
    // Render to screen (null = default framebuffer)
    this.runProgram(prog, null, this.canvas.width, this.canvas.height);
  }

  /** Inject velocity and color at a UV position (called on mouse/touch input). */
  public splat(x: number, y: number, dx: number, dy: number, color: [number, number, number]): void {
    const gl = this.gl;
    const cfg = this.config;
    const prog = this.splatProgram;
    gl.useProgram(prog.program);

    // Splat velocity
    this.bindTexture(0, this.velocity.readTex);
    gl.uniform1i(prog.uniforms["u_target"], 0);
    gl.uniform2f(prog.uniforms["u_point"], x, y);
    gl.uniform3f(prog.uniforms["u_color"], dx * cfg.SPLAT_FORCE, dy * cfg.SPLAT_FORCE, 0);
    gl.uniform1f(prog.uniforms["u_radius"], cfg.SPLAT_RADIUS);
    gl.uniform1i(prog.uniforms["u_isVelocity"], 1);
    this.runProgram(prog, this.velocity.write, this.velocity.width, this.velocity.height);
    this.velocity.swap();

    // Splat dye color
    this.bindTexture(0, this.dye.readTex);
    gl.uniform1i(prog.uniforms["u_target"], 0);
    gl.uniform3f(prog.uniforms["u_color"], color[0], color[1], color[2]);
    gl.uniform1i(prog.uniforms["u_isVelocity"], 0);
    this.runProgram(prog, this.dye.write, this.dye.width, this.dye.height);
    this.dye.swap();
  }

  /** Add a burst of random splats for visual interest on load / reset. */
  public multipleRandomSplats(count: number): void {
    const colors = PALETTES[this.palette];
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const dx = (Math.random() - 0.5) * 0.3;
      const dy = (Math.random() - 0.5) * 0.3;
      const color = colors[i % colors.length];
      this.splat(x, y, dx, dy, color);
    }
  }

  /** Get next color from palette, cycling through all colors. */
  public getNextColor(): [number, number, number] {
    const colors = PALETTES[this.palette];
    const color = colors[this.colorIndex % colors.length];
    this.colorIndex++;
    // Occasionally boost brightness for variety
    const boost = 0.5 + Math.random() * 0.5;
    return [color[0] * boost, color[1] * boost, color[2] * boost];
  }

  public setPalette(name: PaletteName): void {
    this.palette = name;
    this.colorIndex = 0;
  }

  public updateConfig(partial: Partial<FluidConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  public getConfig(): FluidConfig {
    return { ...this.config };
  }

  /** Handle canvas resize — reallocate framebuffers at new resolution. */
  public resize(): void {
    this.initFramebuffers();
  }

  /** Clean up all WebGL resources. */
  public dispose(): void {
    const gl = this.gl;
    [this.advectionProgram, this.divergenceProgram, this.pressureProgram,
     this.gradientSubtractProgram, this.splatProgram, this.displayProgram].forEach(p => {
      gl.deleteProgram(p.program);
    });
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteBuffer(this.quadVBO);
  }
}

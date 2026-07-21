/**
 * FluidSimulation.ts
 *
 * Real-time GPU Navier-Stokes fluid simulation via WebGL2.
 * Shader source is inlined as template strings — no file loader needed.
 *
 * Pipeline per frame:
 *   splat → advect velocity → divergence → pressure (Jacobi ×20) → gradient subtract → advect dye → display
 */

export type PaletteName = "cosmic" | "ocean" | "fire" | "aurora" | "mono";

export interface FluidConfig {
  SIM_RESOLUTION: number;
  DYE_RESOLUTION: number;
  PRESSURE_ITERATIONS: number;
  VELOCITY_DISSIPATION: number;
  DYE_DISSIPATION: number;
  SPLAT_RADIUS: number;
  SPLAT_FORCE: number;
}

export const DEFAULT_CONFIG: FluidConfig = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 512,
  PRESSURE_ITERATIONS: 20,
  VELOCITY_DISSIPATION: 0.98,
  DYE_DISSIPATION: 0.977,
  SPLAT_RADIUS: 0.004,  // UV-space radius — keep between 0.001 and 0.02
  SPLAT_FORCE: 6000,
};

export const PALETTES: Record<PaletteName, Array<[number,number,number]>> = {
  cosmic:  [[0.8,0.1,0.9],[0.1,0.4,1.0],[0.0,0.9,0.8],[0.9,0.2,0.5],[0.3,0.1,1.0]],
  ocean:   [[0.0,0.6,1.0],[0.0,0.9,0.7],[0.1,0.3,0.8],[0.0,1.0,0.5],[0.2,0.5,0.9]],
  fire:    [[1.0,0.1,0.0],[1.0,0.5,0.0],[1.0,0.9,0.0],[0.8,0.0,0.0],[1.0,0.3,0.1]],
  aurora:  [[0.0,1.0,0.5],[0.5,0.0,1.0],[0.0,0.8,0.9],[0.8,0.0,0.6],[0.0,0.6,0.4]],
  mono:    [[0.9,0.9,0.9],[0.7,0.7,0.7],[1.0,1.0,1.0],[0.6,0.6,0.6],[0.85,0.85,0.85]],
};

// ─── Inline GLSL ──────────────────────────────────────────────────────────────

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0,1);}`;

const ADVECT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_vel;
uniform sampler2D u_src;
uniform vec2 u_ts; // texel size of velocity texture
uniform float u_dt;
uniform float u_diss;
void main(){
  vec2 vel = texture(u_vel, v_uv).xy;
  vec2 prev = v_uv - u_dt * vel * u_ts;
  prev = clamp(prev, u_ts*0.5, 1.0-u_ts*0.5);
  o = u_diss * texture(u_src, prev);
}`;

const DIV_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_vel;
uniform vec2 u_ts;
void main(){
  float L=texture(u_vel,v_uv-vec2(u_ts.x,0)).x;
  float R=texture(u_vel,v_uv+vec2(u_ts.x,0)).x;
  float B=texture(u_vel,v_uv-vec2(0,u_ts.y)).y;
  float T=texture(u_vel,v_uv+vec2(0,u_ts.y)).y;
  o=vec4(0.5*((R-L)+(T-B)),0,0,1);
}`;

const PRESSURE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_p;
uniform sampler2D u_div;
uniform vec2 u_ts;
void main(){
  float L=texture(u_p,v_uv-vec2(u_ts.x,0)).r;
  float R=texture(u_p,v_uv+vec2(u_ts.x,0)).r;
  float B=texture(u_p,v_uv-vec2(0,u_ts.y)).r;
  float T=texture(u_p,v_uv+vec2(0,u_ts.y)).r;
  float d=texture(u_div,v_uv).r;
  o=vec4((L+R+B+T-d)*0.25,0,0,1);
}`;

const GRAD_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_p;
uniform sampler2D u_vel;
uniform vec2 u_ts;
void main(){
  float L=texture(u_p,v_uv-vec2(u_ts.x,0)).r;
  float R=texture(u_p,v_uv+vec2(u_ts.x,0)).r;
  float B=texture(u_p,v_uv-vec2(0,u_ts.y)).r;
  float T=texture(u_p,v_uv+vec2(0,u_ts.y)).r;
  vec2 vel=texture(u_vel,v_uv).xy;
  o=vec4(vel-0.5*vec2(R-L,T-B),0,1);
}`;

const SPLAT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tgt;
uniform vec2 u_pt;
uniform vec3 u_col;
uniform float u_r;
uniform int u_mode; // 0=dye 1=velocity
void main(){
  vec2 d=v_uv-u_pt;
  float sp=exp(-dot(d,d)/u_r);
  vec4 base=texture(u_tgt,v_uv);
  if(u_mode==1) o=base+vec4(u_col.xy*sp,0,1);
  else           o=base+vec4(u_col*sp,1);
}`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_dye;
void main(){
  vec3 c=texture(u_dye,v_uv).rgb;
  // Gamma correct
  c=pow(max(c,vec3(0.0)),vec3(1.0/2.2));
  o=vec4(c,1);
}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface FBO {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number; h: number;
  ts: [number, number]; // texel size
}

interface DFBO { read: FBO; write: FBO; swap(): void; }

interface Prog { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; }

// ─── Class ────────────────────────────────────────────────────────────────────

export class FluidSimulation {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  cfg: FluidConfig;

  private aVel!: Prog; private aDye!: Prog;
  private pDiv!: Prog;
  private pPre!: Prog;
  private pGrd!: Prog;
  private pSpl!: Prog;
  private pDis!: Prog;

  private vel!: DFBO;
  private dye!: DFBO;
  private div!: FBO;
  private pre!: DFBO;

  private vao!: WebGLVertexArrayObject;
  private palette: PaletteName = "cosmic";
  private ci = 0;

  constructor(canvas: HTMLCanvasElement, cfg: Partial<FluidConfig> = {}) {
    this.canvas = canvas;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };

    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false,
      stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // Extensions for float textures
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_half_float_linear");

    this.buildQuad();
    this.buildPrograms();
    this.buildFBOs();
    // Fire initial splats immediately — canvas is already sized by caller
    this.randomSplats(10);
  }

  // ── Quad ────────────────────────────────────────────────────────────────────
  private buildQuad(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray()!;
    const buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // ── Programs ─────────────────────────────────────────────────────────────────
  private buildPrograms(): void {
    const mk = (f: string, u: string[]) => this.mkProg(VERT, f, u);
    this.aVel = mk(ADVECT_FRAG, ["u_vel","u_src","u_ts","u_dt","u_diss"]);
    this.aDye = mk(ADVECT_FRAG, ["u_vel","u_src","u_ts","u_dt","u_diss"]);
    this.pDiv = mk(DIV_FRAG,    ["u_vel","u_ts"]);
    this.pPre = mk(PRESSURE_FRAG, ["u_p","u_div","u_ts"]);
    this.pGrd = mk(GRAD_FRAG,   ["u_p","u_vel","u_ts"]);
    this.pSpl = mk(SPLAT_FRAG,  ["u_tgt","u_pt","u_col","u_r","u_mode"]);
    this.pDis = mk(DISPLAY_FRAG,["u_dye"]);
  }

  private mkProg(vert: string, frag: string, unis: string[]): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`Shader error: ${gl.getShaderInfoLog(s)}\n---\n${src}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "a_pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(`Link error: ${gl.getProgramInfoLog(p)}`);
    const u: Record<string, WebGLUniformLocation | null> = {};
    unis.forEach(n => u[n] = gl.getUniformLocation(p, n));
    return { prog: p, u };
  }

  // ── FBOs ─────────────────────────────────────────────────────────────────────
  private buildFBOs(): void {
    const gl = this.gl;
    const c = this.canvas;
    const ar = c.width / Math.max(c.height, 1);

    const sW = Math.round(this.cfg.SIM_RESOLUTION * (ar > 1 ? ar : 1));
    const sH = Math.round(this.cfg.SIM_RESOLUTION * (ar > 1 ? 1 : 1/ar));
    const dW = Math.round(this.cfg.DYE_RESOLUTION * (ar > 1 ? ar : 1));
    const dH = Math.round(this.cfg.DYE_RESOLUTION * (ar > 1 ? 1 : 1/ar));

    // Try RGBA16F first; fall back to RGBA8 if incomplete
    const tryFmt = (iF: number, fmt: number, type: number, w: number, h: number, filter: number): FBO => {
      const tex = this.mkTex(w, h, iF, fmt, type, filter);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!ok) {
        // Fall back to RGBA8
        gl.deleteTexture(tex); gl.deleteFramebuffer(fbo);
        const t2 = this.mkTex(w, h, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, filter);
        const f2 = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, f2);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t2, 0);
        gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        return { fbo: f2, tex: t2, w, h, ts: [1/w, 1/h] };
      }
      gl.viewport(0,0,w,h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      return { fbo, tex, w, h, ts: [1/w, 1/h] };
    };

    const mkD = (w: number, h: number, iF: number, fmt: number, type: number, filter: number): DFBO => {
      const a = tryFmt(iF, fmt, type, w, h, filter);
      const b = tryFmt(iF, fmt, type, w, h, filter);
      const d: DFBO = { read: a, write: b, swap() { [d.read, d.write] = [d.write, d.read]; } };
      return d;
    };

    this.vel = mkD(sW, sH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.dye = mkD(dW, dH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.pre = mkD(sW, sH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.div = tryFmt(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, sW, sH, gl.NEAREST);
  }

  private mkTex(w: number, h: number, iF: number, fmt: number, type: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, iF, w, h, 0, fmt, type, null);
    return t;
  }

  // ── Draw helpers ─────────────────────────────────────────────────────────────
  private bind(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private draw(prog: Prog, target: FBO | null): void {
    const gl = this.gl;
    const w = target ? target.w : this.canvas.width;
    const h = target ? target.h : this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.prog);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // ── Public step / render ─────────────────────────────────────────────────────
  step(dt: number): void {
    const gl = this.gl;
    const cfg = this.cfg;

    // 1. Advect velocity
    gl.useProgram(this.aVel.prog);
    this.bind(0, this.vel.read.tex); gl.uniform1i(this.aVel.u["u_vel"], 0);
    this.bind(1, this.vel.read.tex); gl.uniform1i(this.aVel.u["u_src"], 1);
    gl.uniform2f(this.aVel.u["u_ts"], ...this.vel.read.ts);
    gl.uniform1f(this.aVel.u["u_dt"], dt);
    gl.uniform1f(this.aVel.u["u_diss"], cfg.VELOCITY_DISSIPATION);
    this.draw(this.aVel, this.vel.write); this.vel.swap();

    // 2. Divergence
    gl.useProgram(this.pDiv.prog);
    this.bind(0, this.vel.read.tex); gl.uniform1i(this.pDiv.u["u_vel"], 0);
    gl.uniform2f(this.pDiv.u["u_ts"], ...this.vel.read.ts);
    this.draw(this.pDiv, this.div);

    // 3. Pressure solve
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pre.read.fbo);
    gl.viewport(0,0,this.pre.read.w,this.pre.read.h);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < cfg.PRESSURE_ITERATIONS; i++) {
      gl.useProgram(this.pPre.prog);
      this.bind(0, this.pre.read.tex); gl.uniform1i(this.pPre.u["u_p"], 0);
      this.bind(1, this.div.tex);      gl.uniform1i(this.pPre.u["u_div"], 1);
      gl.uniform2f(this.pPre.u["u_ts"], ...this.vel.read.ts);
      this.draw(this.pPre, this.pre.write); this.pre.swap();
    }

    // 4. Gradient subtract
    gl.useProgram(this.pGrd.prog);
    this.bind(0, this.pre.read.tex); gl.uniform1i(this.pGrd.u["u_p"], 0);
    this.bind(1, this.vel.read.tex); gl.uniform1i(this.pGrd.u["u_vel"], 1);
    gl.uniform2f(this.pGrd.u["u_ts"], ...this.vel.read.ts);
    this.draw(this.pGrd, this.vel.write); this.vel.swap();

    // 5. Advect dye
    gl.useProgram(this.aDye.prog);
    this.bind(0, this.vel.read.tex); gl.uniform1i(this.aDye.u["u_vel"], 0);
    this.bind(1, this.dye.read.tex); gl.uniform1i(this.aDye.u["u_src"], 1);
    gl.uniform2f(this.aDye.u["u_ts"], ...this.dye.read.ts);
    gl.uniform1f(this.aDye.u["u_dt"], dt);
    gl.uniform1f(this.aDye.u["u_diss"], cfg.DYE_DISSIPATION);
    this.draw(this.aDye, this.dye.write); this.dye.swap();
  }

  render(): void {
    const gl = this.gl;
    gl.useProgram(this.pDis.prog);
    this.bind(0, this.dye.read.tex);
    gl.uniform1i(this.pDis.u["u_dye"], 0);
    this.draw(this.pDis, null);
  }

  splat(x: number, y: number, dx: number, dy: number, color: [number,number,number]): void {
    const gl = this.gl;
    const r = this.cfg.SPLAT_RADIUS; // already in UV space

    // Velocity splat
    gl.useProgram(this.pSpl.prog);
    this.bind(0, this.vel.read.tex); gl.uniform1i(this.pSpl.u["u_tgt"], 0);
    gl.uniform2f(this.pSpl.u["u_pt"], x, y);
    gl.uniform3f(this.pSpl.u["u_col"], dx * this.cfg.SPLAT_FORCE, dy * this.cfg.SPLAT_FORCE, 0);
    gl.uniform1f(this.pSpl.u["u_r"], r);
    gl.uniform1i(this.pSpl.u["u_mode"], 1);
    this.draw(this.pSpl, this.vel.write); this.vel.swap();

    // Dye splat
    this.bind(0, this.dye.read.tex); gl.uniform1i(this.pSpl.u["u_tgt"], 0);
    gl.uniform3f(this.pSpl.u["u_col"], color[0], color[1], color[2]);
    gl.uniform1i(this.pSpl.u["u_mode"], 0);
    this.draw(this.pSpl, this.dye.write); this.dye.swap();
  }

  randomSplats(n: number): void {
    const cols = PALETTES[this.palette];
    const savedR = this.cfg.SPLAT_RADIUS;
    this.cfg.SPLAT_RADIUS = 0.008; // bigger radius for initial burst
    for (let i = 0; i < n; i++) {
      this.splat(
        Math.random(), Math.random(),
        (Math.random()-0.5)*0.4, (Math.random()-0.5)*0.4,
        cols[i % cols.length]
      );
    }
    this.cfg.SPLAT_RADIUS = savedR;
  }

  nextColor(): [number,number,number] {
    const cols = PALETTES[this.palette];
    const c = cols[this.ci % cols.length]; this.ci++;
    const b = 0.5 + Math.random() * 0.5;
    return [c[0]*b, c[1]*b, c[2]*b];
  }

  setPalette(p: PaletteName): void { this.palette = p; }
  updateConfig(c: Partial<FluidConfig>): void { this.cfg = { ...this.cfg, ...c }; }

  resize(): void {
    this.buildFBOs();
    this.randomSplats(4);
  }

  dispose(): void { /* programs/textures cleaned up by GC on context loss */ }
}

/**
 * FluidSimulation.ts — proven WebGL2 Navier-Stokes fluid simulation
 * Based on the stable-fluids approach (Jos Stam 1999).
 * Shaders are inlined strings — no file loader dependency.
 */

export type PaletteName = "cosmic"|"ocean"|"fire"|"aurora"|"mono";

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
  SPLAT_RADIUS: 0.25,
  SPLAT_FORCE: 6000,
};

export const PALETTES: Record<PaletteName, [number,number,number][]> = {
  cosmic: [[0.8,0.1,0.9],[0.1,0.4,1.0],[0.0,0.9,0.8],[0.9,0.2,0.5],[0.3,0.1,1.0]],
  ocean:  [[0.0,0.6,1.0],[0.0,0.9,0.7],[0.1,0.3,0.8],[0.0,1.0,0.5],[0.2,0.5,0.9]],
  fire:   [[1.0,0.1,0.0],[1.0,0.5,0.0],[1.0,0.9,0.0],[0.8,0.0,0.0],[1.0,0.3,0.1]],
  aurora: [[0.0,1.0,0.5],[0.5,0.0,1.0],[0.0,0.8,0.9],[0.8,0.0,0.6],[0.0,0.6,0.4]],
  mono:   [[0.9,0.9,0.9],[0.7,0.7,0.7],[1.0,1.0,1.0],[0.6,0.6,0.6],[0.85,0.85,0.85]],
};

// ── Shader sources ──────────────────────────────────────────────────────────

const baseVertSrc = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const splatSrc = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}`;

const advectionSrc = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  gl_FragColor = dissipation * texture2D(uSource, coord);
  gl_FragColor.a = 1.0;
}`;

const divergenceSrc = `
precision mediump float;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

const curlSrc = `
precision mediump float;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`;

const vorticityConfineSrc = `
precision highp float;
varying vec2 vUv;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
}`;

const pressureSrc = `
precision mediump float;
varying vec2 vUv;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const gradientSubtractSrc = `
precision mediump float;
varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const displaySrc = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
void main () {
  vec3 C = texture2D(uTexture, vUv).rgb;
  float a = max(C.r, max(C.g, C.b));
  gl_FragColor = vec4(C, a);
}`;

// ── Types ───────────────────────────────────────────────────────────────────

interface FBO { texture: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number; attach(id: number): number; }
interface DoubleFBO { width: number; height: number; texelSizeX: number; texelSizeY: number; read: FBO; write: FBO; swap(): void; }
interface GLProgram { uniforms: Record<string,WebGLUniformLocation>; bind(): void; }

// ── Main class ───────────────────────────────────────────────────────────────

export class FluidSimulation {
  private gl: WebGLRenderingContext;
  private ext: { formatRGBA: {internalFormat:number;format:number}; formatRG: {internalFormat:number;format:number}; formatR: {internalFormat:number;format:number}; halfFloatTexType: number; supportLinearFiltering: boolean; };
  private canvas: HTMLCanvasElement;
  cfg: FluidConfig;
  private palette: PaletteName = "cosmic";
  private colorIndex = 0;

  private blit!: (dest: FBO|null, clear?: boolean) => void;
  private dye!: DoubleFBO;
  private velocity!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  private pressure!: DoubleFBO;

  private splatProgram!: GLProgram;
  private advectionProgram!: GLProgram;
  private divergenceProgram!: GLProgram;
  private curlProgram!: GLProgram;
  private vorticityProgram!: GLProgram;
  private pressureProgram!: GLProgram;
  private gradSubtractProgram!: GLProgram;
  private displayProgram!: GLProgram;

  constructor(canvas: HTMLCanvasElement, cfg: Partial<FluidConfig> = {}) {
    this.canvas = canvas;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };

    // Try WebGL2 first, fall back to WebGL1
    let gl = canvas.getContext("webgl2") as WebGLRenderingContext | null;
    const isWebGL2 = !!gl;
    if (!gl) gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this.ext = this.getSupportedFormats(gl, isWebGL2);
    this.initBlit();
    this.initPrograms();
    this.initFBOs();
    this.multipleSplats(parseInt((Math.random() * 20).toString()) + 5);
  }

  private getSupportedFormats(gl: WebGLRenderingContext, isWebGL2: boolean) {
    let halfFloat: OES_texture_half_float | null = null;
    let supportLinearFiltering = false;

    if (isWebGL2) {
      gl.getExtension("EXT_color_buffer_float");
      supportLinearFiltering = !!gl.getExtension("OES_texture_float_linear");
    } else {
      halfFloat = gl.getExtension("OES_texture_half_float");
      supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
    }

    gl.clearColor(0, 0, 0, 1);
    const halfFloatTexType = isWebGL2
      ? (gl as WebGL2RenderingContext).HALF_FLOAT
      : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE);

    let formatRGBA: {internalFormat:number;format:number};
    let formatRG:   {internalFormat:number;format:number};
    let formatR:    {internalFormat:number;format:number};

    if (isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      formatRGBA = this.getSupportedFormat(gl, gl2.RGBA16F, gl.RGBA, halfFloatTexType) || { internalFormat: gl.RGBA, format: gl.RGBA };
      formatRG   = this.getSupportedFormat(gl, gl2.RG16F,   gl2.RG,  halfFloatTexType) || { internalFormat: gl.RGBA, format: gl.RGBA };
      formatR    = this.getSupportedFormat(gl, gl2.R16F,    gl2.RED, halfFloatTexType) || { internalFormat: gl.RGBA, format: gl.RGBA };
    } else {
      formatRGBA = { internalFormat: gl.RGBA, format: gl.RGBA };
      formatRG   = { internalFormat: gl.RGBA, format: gl.RGBA };
      formatR    = { internalFormat: gl.RGBA, format: gl.RGBA };
    }
    return { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering };
  }

  private getSupportedFormat(gl: WebGLRenderingContext, internalFormat: number, format: number, type: number): {internalFormat:number;format:number}|null {
    if (!this.supportRenderTextureFormat(gl, internalFormat, format, type)) return null;
    return { internalFormat, format };
  }

  private supportRenderTextureFormat(gl: WebGLRenderingContext, internalFormat: number, format: number, type: number): boolean {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status === gl.FRAMEBUFFER_COMPLETE;
  }

  private initBlit(): void {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW);
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    this.blit = (destination: FBO|null, clear = false) => {
      if (destination == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, destination.width, destination.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo);
      }
      if (clear) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    return shader;
  }

  private createProgram(vertSrc: string, fragSrc: string): GLProgram {
    const gl = this.gl;
    const vert = this.compileShader(gl.VERTEX_SHADER, vertSrc);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert); gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) || "Program link failed");
    const uniforms: Record<string,WebGLUniformLocation> = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      uniforms[info.name] = gl.getUniformLocation(prog, info.name)!;
    }
    return { uniforms, bind() { gl.useProgram(prog); } };
  }

  private initPrograms(): void {
    this.splatProgram        = this.createProgram(baseVertSrc, splatSrc);
    this.advectionProgram    = this.createProgram(baseVertSrc, advectionSrc);
    this.divergenceProgram   = this.createProgram(baseVertSrc, divergenceSrc);
    this.curlProgram         = this.createProgram(baseVertSrc, curlSrc);
    this.vorticityProgram    = this.createProgram(baseVertSrc, vorticityConfineSrc);
    this.pressureProgram     = this.createProgram(baseVertSrc, pressureSrc);
    this.gradSubtractProgram = this.createProgram(baseVertSrc, gradientSubtractSrc);
    this.displayProgram      = this.createProgram(baseVertSrc, displaySrc);
  }

  private createFBO(w: number, h: number, internalFormat: number, format: number, type: number, filter: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
    const texelSizeX = 1.0 / w, texelSizeY = 1.0 / h;
    return { texture, fbo, width: w, height: h, attach(id) { gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; } };
  }

  private createDoubleFBO(w: number, h: number, iF: number, fmt: number, type: number, filter: number): DoubleFBO {
    let fbo1 = this.createFBO(w, h, iF, fmt, type, filter);
    let fbo2 = this.createFBO(w, h, iF, fmt, type, filter);
    return {
      width: w, height: h,
      texelSizeX: 1/w, texelSizeY: 1/h,
      get read() { return fbo1; }, get write() { return fbo2; },
      swap() { [fbo1, fbo2] = [fbo2, fbo1]; }
    };
  }

  private initFBOs(): void {
    const gl = this.gl; const ext = this.ext;
    const simRes = this.getResolution(this.cfg.SIM_RESOLUTION);
    const dyeRes = this.getResolution(this.cfg.DYE_RESOLUTION);
    const filter = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    const rgba = ext.formatRGBA, rg = ext.formatRG, r = ext.formatR;
    const hf = ext.halfFloatTexType;
    this.dye      = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, hf, filter);
    this.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat,   rg.format,   hf, filter);
    this.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, hf, gl.NEAREST);
    this.curl       = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, hf, gl.NEAREST);
    this.pressure   = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, hf, gl.NEAREST);
  }

  private getResolution(res: number): {width:number;height:number} {
    const ar = this.canvas.width / this.canvas.height;
    if (ar > 1) return { width: Math.round(res * ar), height: res };
    return { width: res, height: Math.round(res / ar) };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  step(dt: number): void {
    const gl = this.gl; const ext = this.ext;

    // Curl
    this.curlProgram.bind();
    gl.uniform2f(this.curlProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.curlProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    this.blit(this.curl);

    // Vorticity confinement
    this.vorticityProgram.bind();
    gl.uniform2f(this.vorticityProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.vorticityProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    gl.uniform1i(this.vorticityProgram.uniforms["uCurl"], this.curl.attach(1));
    gl.uniform1f(this.vorticityProgram.uniforms["curl"], 30);
    gl.uniform1f(this.vorticityProgram.uniforms["dt"], dt);
    this.blit(this.velocity.write); this.velocity.swap();

    // Divergence
    this.divergenceProgram.bind();
    gl.uniform2f(this.divergenceProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.divergenceProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    this.blit(this.divergence);

    // Clear pressure
    this.blit(this.pressure.read, true);

    // Pressure solve
    this.pressureProgram.bind();
    gl.uniform2f(this.pressureProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.pressureProgram.uniforms["uDivergence"], this.divergence.attach(0));
    for (let i = 0; i < this.cfg.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.pressureProgram.uniforms["uPressure"], this.pressure.read.attach(1));
      this.blit(this.pressure.write); this.pressure.swap();
    }

    // Gradient subtract
    this.gradSubtractProgram.bind();
    gl.uniform2f(this.gradSubtractProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.gradSubtractProgram.uniforms["uPressure"], this.pressure.read.attach(0));
    gl.uniform1i(this.gradSubtractProgram.uniforms["uVelocity"], this.velocity.read.attach(1));
    this.blit(this.velocity.write); this.velocity.swap();

    // Advect velocity
    this.advectionProgram.bind();
    gl.uniform2f(this.advectionProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.advectionProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    gl.uniform1i(this.advectionProgram.uniforms["uSource"], this.velocity.read.attach(0));
    gl.uniform1f(this.advectionProgram.uniforms["dt"], dt);
    gl.uniform1f(this.advectionProgram.uniforms["dissipation"], this.cfg.VELOCITY_DISSIPATION);
    this.blit(this.velocity.write); this.velocity.swap();

    // Advect dye
    gl.uniform1i(this.advectionProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    gl.uniform1i(this.advectionProgram.uniforms["uSource"], this.dye.read.attach(1));
    gl.uniform1f(this.advectionProgram.uniforms["dissipation"], this.cfg.DYE_DISSIPATION);
    this.blit(this.dye.write); this.dye.swap();
  }

  render(): void {
    const gl = this.gl;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    this.displayProgram.bind();
    gl.uniform1i(this.displayProgram.uniforms["uTexture"], this.dye.read.attach(0));
    this.blit(null);
  }

  splat(x: number, y: number, dx: number, dy: number, color: [number,number,number]): void {
    const gl = this.gl;
    this.splatProgram.bind();
    gl.uniform1i(this.splatProgram.uniforms["uTarget"], this.velocity.read.attach(0));
    gl.uniform1f(this.splatProgram.uniforms["aspectRatio"], this.canvas.width / this.canvas.height);
    gl.uniform2f(this.splatProgram.uniforms["point"], x, y);
    gl.uniform3f(this.splatProgram.uniforms["color"], dx, dy, 0);
    gl.uniform1f(this.splatProgram.uniforms["radius"], this.correctRadius(this.cfg.SPLAT_RADIUS / 100));
    this.blit(this.velocity.write); this.velocity.swap();

    gl.uniform1i(this.splatProgram.uniforms["uTarget"], this.dye.read.attach(0));
    gl.uniform3f(this.splatProgram.uniforms["color"], color[0], color[1], color[2]);
    this.blit(this.dye.write); this.dye.swap();
  }

  private correctRadius(r: number): number {
    const ar = this.canvas.width / this.canvas.height;
    if (ar > 1) r *= ar;
    return r;
  }

  multipleSplats(count: number): void {
    const cols = PALETTES[this.palette];
    for (let i = 0; i < count; i++) {
      const color = cols[i % cols.length];
      this.splat(Math.random(), Math.random(),
        (Math.random() * 2 - 1) * 5, (Math.random() * 2 - 1) * 5, color);
    }
  }

  nextColor(): [number,number,number] {
    const cols = PALETTES[this.palette];
    const c = cols[this.colorIndex % cols.length]; this.colorIndex++;
    return [c[0] * (0.5 + Math.random()*0.5), c[1] * (0.5 + Math.random()*0.5), c[2] * (0.5 + Math.random()*0.5)];
  }

  setPalette(p: PaletteName): void { this.palette = p; }
  updateConfig(c: Partial<FluidConfig>): void { this.cfg = { ...this.cfg, ...c }; }
  resize(): void { this.initFBOs(); }
  dispose(): void {}
}

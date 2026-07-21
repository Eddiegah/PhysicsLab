/**
 * FluidSimulation.ts
 * WebGL fluid simulation — works on WebGL1 and WebGL2.
 * Based on Pavel Dobryakov's approach (MIT licensed technique).
 */

export type PaletteName = "cosmic"|"ocean"|"fire"|"aurora"|"mono";
export interface FluidConfig {
  SIM_RESOLUTION: number; DYE_RESOLUTION: number;
  PRESSURE_ITERATIONS: number;
  VELOCITY_DISSIPATION: number; DYE_DISSIPATION: number;
  SPLAT_RADIUS: number; SPLAT_FORCE: number;
}
export const DEFAULT_CONFIG: FluidConfig = {
  SIM_RESOLUTION: 128, DYE_RESOLUTION: 512,
  PRESSURE_ITERATIONS: 20,
  VELOCITY_DISSIPATION: 0.98, DYE_DISSIPATION: 0.977,
  SPLAT_RADIUS: 0.25, SPLAT_FORCE: 6000,
};
export const PALETTES: Record<PaletteName,[number,number,number][]> = {
  cosmic:[[0.8,0.1,0.9],[0.1,0.4,1],[0,0.9,0.8],[0.9,0.2,0.5],[0.3,0.1,1]],
  ocean: [[0,0.6,1],[0,0.9,0.7],[0.1,0.3,0.8],[0,1,0.5],[0.2,0.5,0.9]],
  fire:  [[1,0.1,0],[1,0.5,0],[1,0.9,0],[0.8,0,0],[1,0.3,0.1]],
  aurora:[[0,1,0.5],[0.5,0,1],[0,0.8,0.9],[0.8,0,0.6],[0,0.6,0.4]],
  mono:  [[0.9,0.9,0.9],[0.7,0.7,0.7],[1,1,1],[0.6,0.6,0.6],[0.85,0.85,0.85]],
};

// ─── Shaders (WebGL1 GLSL — works in both WebGL1 and WebGL2) ────────────────

const vert = `
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform vec2 texelSize;
  void main(){
    vUv=aPosition*.5+.5;
    vL=vUv-vec2(texelSize.x,0);
    vR=vUv+vec2(texelSize.x,0);
    vT=vUv+vec2(0,texelSize.y);
    vB=vUv-vec2(0,texelSize.y);
    gl_Position=vec4(aPosition,0,1);
  }`;

const copyFrag = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  void main(){ gl_FragColor=texture2D(uTexture,vUv); }`;

const clearFrag = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main(){ gl_FragColor=value*texture2D(uTexture,vUv); }`;

const splatFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main(){
    vec2 p=vUv-point.xy;
    p.x*=aspectRatio;
    vec3 splat=exp(-dot(p,p)/radius)*color;
    vec3 base=texture2D(uTarget,vUv).xyz;
    gl_FragColor=vec4(base+splat,1);
  }`;

const advectionFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform vec2 dyeTexelSize;
  uniform float dt;
  uniform float dissipation;
  vec4 bilerp(sampler2D sam,vec2 uv,vec2 tsize){
    vec2 st=uv/tsize-.5;
    vec2 iuv=floor(st);
    vec2 fuv=fract(st);
    vec4 a=texture2D(sam,(iuv+vec2(.5,.5))*tsize);
    vec4 b=texture2D(sam,(iuv+vec2(1.5,.5))*tsize);
    vec4 c=texture2D(sam,(iuv+vec2(.5,1.5))*tsize);
    vec4 d=texture2D(sam,(iuv+vec2(1.5,1.5))*tsize);
    return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y);
  }
  void main(){
    vec2 coord=vUv-dt*bilerp(uVelocity,vUv,texelSize).xy*texelSize;
    gl_FragColor=dissipation*bilerp(uSource,coord,dyeTexelSize);
    gl_FragColor.a=1.0;
  }`;

const divergenceFrag = `
  precision mediump float;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform sampler2D uVelocity;
  void main(){
    float L=texture2D(uVelocity,vL).x;
    float R=texture2D(uVelocity,vR).x;
    float T=texture2D(uVelocity,vT).y;
    float B=texture2D(uVelocity,vB).y;
    gl_FragColor=vec4(.5*(R-L+T-B),0,0,1);
  }`;

const curlFrag = `
  precision mediump float;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform sampler2D uVelocity;
  void main(){
    float L=texture2D(uVelocity,vL).y;
    float R=texture2D(uVelocity,vR).y;
    float T=texture2D(uVelocity,vT).x;
    float B=texture2D(uVelocity,vB).x;
    gl_FragColor=vec4(.5*(R-L-T+B),0,0,1);
  }`;

const vorticityFrag = `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl; uniform float dt;
  void main(){
    float L=texture2D(uCurl,vL).x;
    float R=texture2D(uCurl,vR).x;
    float T=texture2D(uCurl,vT).x;
    float B=texture2D(uCurl,vB).x;
    float C=texture2D(uCurl,vUv).x;
    vec2 force=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));
    force/=length(force)+.0001;
    force*=curl*C; force.y*=-1.0;
    gl_FragColor=vec4(texture2D(uVelocity,vUv).xy+force*dt,0,1);
  }`;

const pressureFrag = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main(){
    float L=texture2D(uPressure,vL).x;
    float R=texture2D(uPressure,vR).x;
    float T=texture2D(uPressure,vT).x;
    float B=texture2D(uPressure,vB).x;
    float d=texture2D(uDivergence,vUv).x;
    gl_FragColor=vec4((L+R+B+T-d)*.25,0,0,1);
  }`;

const gradSubFrag = `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main(){
    float L=texture2D(uPressure,vL).x;
    float R=texture2D(uPressure,vR).x;
    float T=texture2D(uPressure,vT).x;
    float B=texture2D(uPressure,vB).x;
    vec2 v=texture2D(uVelocity,vUv).xy;
    gl_FragColor=vec4(v-vec2(R-L,T-B),0,1);
  }`;

const displayFrag = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uAlpha;
  void main(){
    vec3 c=texture2D(uTexture,vUv).rgb;
    float a=max(c.r,max(c.g,c.b));
    gl_FragColor=vec4(c,a);
  }`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FBO {
  texture: WebGLTexture; fbo: WebGLFramebuffer;
  width: number; height: number;
  texelSizeX: number; texelSizeY: number;
  attach(id: number): number;
}
interface DFBO { read: FBO; write: FBO; swap(): void; width: number; height: number; texelSizeX: number; texelSizeY: number; }
interface Prog { uniforms: Record<string,WebGLUniformLocation|null>; bind(): void; }

// ─── Class ────────────────────────────────────────────────────────────────────

export class FluidSimulation {
  private gl: WebGLRenderingContext;
  private canvas: HTMLCanvasElement;
  cfg: FluidConfig;
  private halfFloatType = 0;
  private linearFiltering = false;
  private palette: PaletteName = "cosmic";
  private ci = 0;

  private _blit!: (target: FBO|null, clear?: boolean) => void;
  private dye!: DFBO; private vel!: DFBO;
  private div!: FBO; private curl!: FBO; private pressure!: DFBO;

  private copyProg!: Prog; private clearProg!: Prog; private splatProg!: Prog;
  private advProg!: Prog; private divProg!: Prog; private curlProg!: Prog;
  private vorProg!: Prog; private presProg!: Prog; private gradProg!: Prog;
  private dispProg!: Prog;

  constructor(canvas: HTMLCanvasElement, cfg: Partial<FluidConfig> = {}) {
    this.canvas = canvas;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    const gl = (canvas.getContext("webgl", { alpha: true }) ||
                canvas.getContext("experimental-webgl", { alpha: true })) as WebGLRenderingContext;
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;
    this.initExts();
    this.initBlit();
    this.initPrograms();
    this.initFBOs();
    this.multipleSplats(Math.floor(Math.random() * 8) + 5);
  }

  private initExts(): void {
    const gl = this.gl;
    const hf = gl.getExtension("OES_texture_half_float");
    this.linearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
    this.halfFloatType = hf ? hf.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
    gl.getExtension("OES_texture_float");
    gl.getExtension("OES_texture_float_linear");
  }

  private initBlit(): void {
    const gl = this.gl;
    const vbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,1, 1,-1]), gl.STATIC_DRAW);
    const ibuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    this._blit = (target, clear = false) => {
      if (!target) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clear) { gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s);
      console.error("Shader error:", msg, "\n", src);
      throw new Error(msg || "compile failed");
    }
    return s;
  }

  private prog(frag: string): Prog {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, "aPosition");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
    const u: Record<string,WebGLUniformLocation|null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; u[info.name] = gl.getUniformLocation(p, info.name); }
    return { uniforms: u, bind() { gl.useProgram(p); } };
  }

  private initPrograms(): void {
    this.copyProg  = this.prog(copyFrag);
    this.clearProg = this.prog(clearFrag);
    this.splatProg = this.prog(splatFrag);
    this.advProg   = this.prog(advectionFrag);
    this.divProg   = this.prog(divergenceFrag);
    this.curlProg  = this.prog(curlFrag);
    this.vorProg   = this.prog(vorticityFrag);
    this.presProg  = this.prog(pressureFrag);
    this.gradProg  = this.prog(gradSubFrag);
    this.dispProg  = this.prog(displayFrag);
  }

  private mkFBO(w: number, h: number, fmt: number, type: number, filter: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, type, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0,0,w,h); gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture: tex, fbo, width: w, height: h, texelSizeX: 1/w, texelSizeY: 1/h,
      attach(id) { gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }

  private mkDFBO(w: number, h: number, fmt: number, type: number, filter: number): DFBO {
    let a = this.mkFBO(w,h,fmt,type,filter), b = this.mkFBO(w,h,fmt,type,filter);
    return { width:w, height:h, texelSizeX:1/w, texelSizeY:1/h,
      get read(){return a;}, get write(){return b;}, swap(){[a,b]=[b,a];} };
  }

  private initFBOs(): void {
    const gl = this.gl;
    const filter = this.linearFiltering ? gl.LINEAR : gl.NEAREST;
    const type = this.halfFloatType;
    const ar = this.canvas.width / Math.max(this.canvas.height, 1);
    const sw = Math.round(this.cfg.SIM_RESOLUTION * (ar>1?ar:1)), sh = Math.round(this.cfg.SIM_RESOLUTION * (ar>1?1:1/ar));
    const dw = Math.round(this.cfg.DYE_RESOLUTION * (ar>1?ar:1)), dh = Math.round(this.cfg.DYE_RESOLUTION * (ar>1?1:1/ar));
    this.dye      = this.mkDFBO(dw, dh, gl.RGBA, type, filter);
    this.vel      = this.mkDFBO(sw, sh, gl.RGBA, type, filter);
    this.div      = this.mkFBO(sw, sh, gl.RGBA, type, gl.NEAREST);
    this.curl     = this.mkFBO(sw, sh, gl.RGBA, type, gl.NEAREST);
    this.pressure = this.mkDFBO(sw, sh, gl.RGBA, type, gl.NEAREST);
  }

  step(dt: number): void {
    const gl = this.gl;

    // Curl
    this.curlProg.bind();
    gl.uniform2f(this.curlProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.curlProg.uniforms["uVelocity"]!, this.vel.read.attach(0));
    this._blit(this.curl);

    // Vorticity
    this.vorProg.bind();
    gl.uniform2f(this.vorProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.vorProg.uniforms["uVelocity"]!, this.vel.read.attach(0));
    gl.uniform1i(this.vorProg.uniforms["uCurl"]!, this.curl.attach(1));
    gl.uniform1f(this.vorProg.uniforms["curl"]!, 30);
    gl.uniform1f(this.vorProg.uniforms["dt"]!, dt);
    this._blit(this.vel.write); this.vel.swap();

    // Divergence
    this.divProg.bind();
    gl.uniform2f(this.divProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.divProg.uniforms["uVelocity"]!, this.vel.read.attach(0));
    this._blit(this.div);

    // Pressure
    this.clearProg.bind();
    gl.uniform1i(this.clearProg.uniforms["uTexture"]!, this.pressure.read.attach(0));
    gl.uniform1f(this.clearProg.uniforms["value"]!, 0.8);
    this._blit(this.pressure.write); this.pressure.swap();
    this.presProg.bind();
    gl.uniform2f(this.presProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.presProg.uniforms["uDivergence"]!, this.div.attach(0));
    for (let i = 0; i < this.cfg.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.presProg.uniforms["uPressure"]!, this.pressure.read.attach(1));
      this._blit(this.pressure.write); this.pressure.swap();
    }

    // Gradient subtract
    this.gradProg.bind();
    gl.uniform2f(this.gradProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.gradProg.uniforms["uPressure"]!, this.pressure.read.attach(0));
    gl.uniform1i(this.gradProg.uniforms["uVelocity"]!, this.vel.read.attach(1));
    this._blit(this.vel.write); this.vel.swap();

    // Advect velocity
    this.advProg.bind();
    gl.uniform2f(this.advProg.uniforms["texelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform2f(this.advProg.uniforms["dyeTexelSize"]!, this.vel.texelSizeX, this.vel.texelSizeY);
    gl.uniform1i(this.advProg.uniforms["uVelocity"]!, this.vel.read.attach(0));
    gl.uniform1i(this.advProg.uniforms["uSource"]!, this.vel.read.attach(0));
    gl.uniform1f(this.advProg.uniforms["dt"]!, dt);
    gl.uniform1f(this.advProg.uniforms["dissipation"]!, this.cfg.VELOCITY_DISSIPATION);
    this._blit(this.vel.write); this.vel.swap();

    // Advect dye
    gl.uniform2f(this.advProg.uniforms["dyeTexelSize"]!, this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(this.advProg.uniforms["uVelocity"]!, this.vel.read.attach(0));
    gl.uniform1i(this.advProg.uniforms["uSource"]!, this.dye.read.attach(1));
    gl.uniform1f(this.advProg.uniforms["dissipation"]!, this.cfg.DYE_DISSIPATION);
    this._blit(this.dye.write); this.dye.swap();
  }

  render(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    this.dispProg.bind();
    gl.uniform1i(this.dispProg.uniforms["uTexture"]!, this.dye.read.attach(0));
    this._blit(null);
  }

  splat(x: number, y: number, dx: number, dy: number, color: [number,number,number]): void {
    const gl = this.gl;
    const ar = this.canvas.width / this.canvas.height;
    let r = this.cfg.SPLAT_RADIUS / 100.0;
    if (ar > 1) r *= ar;
    this.splatProg.bind();
    gl.uniform1i(this.splatProg.uniforms["uTarget"]!, this.vel.read.attach(0));
    gl.uniform1f(this.splatProg.uniforms["aspectRatio"]!, ar);
    gl.uniform2f(this.splatProg.uniforms["point"]!, x, y);
    gl.uniform3f(this.splatProg.uniforms["color"]!, dx, dy, 0);
    gl.uniform1f(this.splatProg.uniforms["radius"]!, r);
    this._blit(this.vel.write); this.vel.swap();
    gl.uniform1i(this.splatProg.uniforms["uTarget"]!, this.dye.read.attach(0));
    gl.uniform3f(this.splatProg.uniforms["color"]!, color[0], color[1], color[2]);
    this._blit(this.dye.write); this.dye.swap();
  }

  multipleSplats(n: number): void {
    const cols = PALETTES[this.palette];
    for (let i = 0; i < n; i++)
      this.splat(Math.random(), Math.random(),
        (Math.random()*2-1)*this.cfg.SPLAT_FORCE*.001,
        (Math.random()*2-1)*this.cfg.SPLAT_FORCE*.001,
        cols[i%cols.length]);
  }

  nextColor(): [number,number,number] {
    const c = PALETTES[this.palette][this.ci++%PALETTES[this.palette].length];
    return [c[0]*(0.5+Math.random()*0.5), c[1]*(0.5+Math.random()*0.5), c[2]*(0.5+Math.random()*0.5)];
  }

  setPalette(p: PaletteName): void { this.palette = p; }
  updateConfig(c: Partial<FluidConfig>): void { this.cfg={...this.cfg,...c}; }
  resize(): void { this.initFBOs(); this.multipleSplats(3); }
  dispose(): void {}
}

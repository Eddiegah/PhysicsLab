// PRESSURE PASS — Jacobi iteration to solve the Poisson equation ∇²p = ∇ · u
//
// This is the mathematically crucial "pressure projection" step that enforces
// incompressibility. After advecting the velocity field, it becomes compressible
// (fluid is being created/destroyed at cells). We fix this by finding a pressure
// field p such that subtracting ∇p from the velocity makes it divergence-free.
//
// The pressure satisfies the Poisson equation:
//   ∇²p = ∇ · u  (derived from setting ∇ · (u - ∇p) = 0)
//
// Expanding the Laplacian in 2D with central differences:
//   (p_{i-1,j} + p_{i+1,j} + p_{i,j-1} + p_{i,j+1} - 4*p_{i,j}) / h² = div_{i,j}
//
// Rearranging for the Jacobi iterative solver (each step improves the estimate):
//   p_{i,j} = (p_{i-1,j} + p_{i+1,j} + p_{i,j-1} + p_{i,j+1} - h² * div_{i,j}) / 4
//
// With h = 1 (texel units), this simplifies to the formula below.
// We run this pass ~30-50 times per frame via ping-pong framebuffers to converge.
// More iterations = more accurate pressure = smoother, more realistic fluid.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pressure;    // Current pressure estimate (ping-pong)
uniform sampler2D u_divergence;  // ∇ · u computed in the divergence pass
uniform vec2 u_texelSize;

void main() {
  // Sample the four cardinal neighbors of the pressure field
  float pL = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).r;
  float pR = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).r;
  float pB = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).r;
  float pT = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).r;

  // The right-hand side: divergence at this cell
  float div = texture(u_divergence, v_uv).r;

  // Jacobi iteration step: one iteration of the Poisson solver
  // p_new = (neighbors_sum - div) / 4
  float pressure = (pL + pR + pB + pT - div) * 0.25;

  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}

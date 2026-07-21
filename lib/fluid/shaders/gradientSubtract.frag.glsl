// GRADIENT SUBTRACT PASS — u_new = u - ∇p
//
// This is the final step of the Helmholtz-Hodge decomposition / pressure projection.
//
// The Helmholtz decomposition theorem says any vector field u can be decomposed as:
//   u = w + ∇p
// where w is divergence-free (∇ · w = 0) and ∇p is curl-free.
//
// We want the divergence-free part w. Having solved for p in the pressure pass:
//   w = u - ∇p
//
// The discrete gradient using central differences:
//   ∇p ≈ [(p_{i+1,j} - p_{i-1,j}) / 2, (p_{i,j+1} - p_{i,j-1}) / 2]
//
// After this pass, the velocity field is divergence-free (incompressible).
// This is the step that makes the simulation look like REAL FLUID rather than
// random noise — without it, fluid would pile up and disappear everywhere.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
  // Sample pressure at cardinal neighbors for central difference gradient
  float pL = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).r;
  float pR = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).r;
  float pB = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).r;
  float pT = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).r;

  // Compute pressure gradient: ∇p ≈ (0.5 * [p_R - p_L, p_T - p_B])
  vec2 gradient = 0.5 * vec2(pR - pL, pT - pB);

  // Subtract pressure gradient from velocity to get divergence-free field
  vec2 vel = texture(u_velocity, v_uv).xy;
  vec2 correctedVel = vel - gradient;

  fragColor = vec4(correctedVel, 0.0, 1.0);
}

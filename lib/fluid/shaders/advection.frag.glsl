// ADVECTION PASS — Navier-Stokes term: -(u · ∇)u
//
// Advection moves quantities (velocity, dye) through the velocity field.
// We use the "semi-Lagrangian" (back-tracing) method from Jos Stam's
// "Stable Fluids" (SIGGRAPH 1999), which is unconditionally stable for
// any time step size (no CFL condition required — crucial for real-time use).
//
// Core idea: to find what value arrives at grid cell x at time t,
// trace the flow backwards one timestep along the velocity field to
// find where it came from: x_prev = x - dt * u(x).
// The quantity at x_prev is then interpolated and placed at x.
//
// This is the discretization of the material derivative Dq/Dt = 0
// (advection of a passive scalar q with no source terms).
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_velocity;   // Current velocity field (RG = x,y velocity)
uniform sampler2D u_source;     // Quantity being advected (velocity or dye)
uniform vec2 u_texelSize;       // 1.0 / textureSize — pixel size in UV space
uniform float u_dt;             // Timestep in seconds
uniform float u_dissipation;    // Decay factor: 1.0 = no dissipation, <1 = fade

void main() {
  // Sample the velocity at the current cell
  vec2 vel = texture(u_velocity, v_uv).xy;

  // Back-trace: where did this cell's content come from?
  // x_prev = x - dt * u(x)
  // We work in texel space: velocity is in texels/second
  vec2 prevUV = v_uv - u_dt * vel * u_texelSize;

  // Clamp to prevent sampling outside the grid (reflecting boundary)
  prevUV = clamp(prevUV, u_texelSize * 0.5, 1.0 - u_texelSize * 0.5);

  // Bilinear interpolation is handled automatically by the sampler (LINEAR filter)
  // Multiply by dissipation to allow quantities to naturally decay over time
  fragColor = u_dissipation * texture(u_source, prevUV);
}

// DIVERGENCE PASS — compute ∇ · u
//
// The divergence of the velocity field measures how much fluid is
// "flowing in or out" of each cell. For an incompressible fluid
// (like water or the abstracted fluid we're simulating), the
// divergence must be zero everywhere: ∇ · u = 0.
//
// After advection, the velocity field is generally NOT divergence-free.
// We compute the divergence here, then use the pressure solver to
// create a correction that enforces the incompressibility constraint.
//
// Discrete divergence using central differences:
// ∇ · u ≈ (u_{i+1,j} - u_{i-1,j}) / 2dx + (u_{i,j+1} - u_{i,j-1}) / 2dy
// In normalized texel units (dx = dy = 1 texel), this simplifies to:
// div = 0.5 * [(R_right - R_left) + (G_top - G_bottom)]
// where R = x-velocity, G = y-velocity
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
  // Sample the four cardinal neighbors
  float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).x;  // left x-vel
  float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).x;  // right x-vel
  float B = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).y;  // bottom y-vel
  float T = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).y;  // top y-vel

  // Central difference approximation of ∇ · u
  float div = 0.5 * ((R - L) + (T - B));

  // Store divergence in the R channel; other channels unused
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}

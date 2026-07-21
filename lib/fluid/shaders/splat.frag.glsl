// SPLAT PASS — inject user input (velocity and color) into the simulation
//
// When the user moves their mouse/touch, we "splat" a Gaussian blob of
// velocity and dye color into the simulation at the cursor position.
// The Gaussian shape provides a smooth, physically-plausible force/dye injection
// that avoids sharp discontinuities which could cause numerical instability.
//
// The splat is added to the existing field (additive blend) so repeated
// interactions accumulate naturally.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_target;  // Current field (velocity or dye) to add into
uniform vec2 u_point;        // Splat center in UV [0,1] coordinates
uniform vec3 u_color;        // Color/velocity to inject (RGB for dye, XY for velocity)
uniform float u_radius;      // Gaussian radius (in UV space)
uniform bool u_isVelocity;   // True: XY channels are velocity; False: RGB is dye

void main() {
  // Compute squared distance from splat center, correcting for aspect ratio
  vec2 diff = v_uv - u_point;
  // Gaussian function: e^(-|diff|² / r²)
  float splat = exp(-dot(diff, diff) / u_radius);

  vec4 current = texture(u_target, v_uv);

  if (u_isVelocity) {
    // Add velocity splat (u_color.xy used as velocity direction/magnitude)
    fragColor = current + vec4(u_color.xy * splat, 0.0, 1.0);
  } else {
    // Add dye color splat
    fragColor = current + vec4(u_color * splat, 1.0);
  }
}

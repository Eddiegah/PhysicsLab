// DISPLAY PASS — render the dye field to screen
//
// This is the final visual output pass. We take the dye color field
// and render it to the screen, applying a slight bloom/glow effect
// by mixing in a blurred version of bright areas.
// The dye field stores accumulated color from user splats, advected
// through the velocity field over time — producing the "ink in water" look.
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_dye;       // The dye/color field
uniform vec2 u_texelSize;

// Simple 9-tap box blur for a soft bloom on bright areas
vec3 sampleWithBloom(sampler2D tex, vec2 uv) {
  vec3 sum = vec3(0.0);
  float total = 0.0;

  // 3x3 neighborhood
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 offset = vec2(float(i), float(j)) * u_texelSize * 2.0;
      vec3 s = texture(tex, uv + offset).rgb;
      float w = 1.0;
      sum += s * w;
      total += w;
    }
  }
  return sum / total;
}

void main() {
  vec3 color = texture(u_dye, v_uv).rgb;

  // Add subtle bloom: blend in a blurred version for bright areas
  vec3 bloom = sampleWithBloom(u_dye, v_uv);
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722)); // luminance
  color = mix(color, bloom, brightness * 0.15);

  // Gamma correction for perceptually correct brightness
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}

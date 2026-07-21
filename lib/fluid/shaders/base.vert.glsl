// Base vertex shader used by all fluid simulation passes.
// The fluid solver operates entirely in screen space — each pass
// runs a full-screen quad and processes every texel as a grid cell.
#version 300 es

in vec2 a_position;  // [-1, 1] NDC quad corners

out vec2 v_uv;       // [0, 1] texture coordinates passed to fragment shaders

void main() {
  // Map from NDC [-1,1] to UV [0,1]
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}

/**
 * GLSL ES 3.00. a_x is an *integer* attribute (vertexAttribIPointer), so a Uint32 timestamp reaches
 * the shader exactly. See uniforms.ts for why the origin is split into an integer and a fraction.
 */
export const VERTEX_SHADER = `#version 300 es
in uint a_x;
in float a_y;
in float a_c;

uniform int u_xOrigin;
uniform float u_xFrac;
uniform float u_kx;
uniform float u_ky;
uniform float u_by;
uniform vec2 u_size;

out float v_c;

void main() {
  float px = (float(int(a_x) - u_xOrigin) - u_xFrac) * u_kx;
  float py = a_y * u_ky + u_by;
  gl_Position = vec4(px / u_size.x * 2.0 - 1.0, 1.0 - py / u_size.y * 2.0, 0.0, 1.0);
  v_c = a_c;
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float v_c;
uniform sampler2D u_ramp;
uniform float u_alpha;

out vec4 outColor;

void main() {
  vec4 color = texture(u_ramp, vec2(v_c, 0.5));
  outColor = vec4(color.rgb, color.a * u_alpha);
}
`;

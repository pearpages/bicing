/** Points in CSS pixels (top-left origin) → clip space; the size is in device pixels. */
export const POINT_VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
in float a_value;
uniform vec2 u_viewport;
uniform float u_size;
out float v_value;
void main() {
  gl_Position = vec4(a_pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - a_pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_size;
  v_value = a_value;
}`;

/**
 * Round points with a soft edge; -1 means "no data" and takes its own color, not the ramp's.
 * Values above 2 are dimmed (encode.ts adds DIM_OFFSET = 4) and drawn at u_dim of their alpha.
 */
export const POINT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in float v_value;
uniform sampler2D u_ramp;
uniform vec4 u_noData;
uniform float u_dim;
out vec4 color;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  bool dimmed = v_value > 2.0;
  float v = dimmed ? v_value - 4.0 : v_value;
  vec4 c = v < 0.0 ? u_noData : texture(u_ramp, vec2(v, 0.5));
  color = vec4(c.rgb, c.a * smoothstep(0.5, 0.4, r) * (dimmed ? u_dim : 1.0));
}`;

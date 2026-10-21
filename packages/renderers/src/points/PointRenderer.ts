import { resizeCanvas } from '../dpr';
import { DIM_ALPHA } from '../types';
import { parseColor, rampBytes, RAMP_SIZE } from '../webgl/colorRamp';
import { attribLocation, linkProgram, uniformLocation } from '../webgl/gl-utils';
import { encodeValues } from './encode';
import { POINT_FRAGMENT_SHADER, POINT_VERTEX_SHADER } from './shaders';

/** Scattered points with one value each: the station map (T2.7). */
export interface PointRenderer {
  readonly element: HTMLCanvasElement;
  /** CSS-pixel positions, top-left origin. Uploaded when they change (on resize). */
  setPositions(x: Float32Array, y: Float32Array): void;
  /** One value per point in [0, 1], or NaN for no data. Uploaded when the moment changes. */
  setValues(values: ArrayLike<number>): void;
  setColorScale(interpolate: (t: number) => string): void;
  /** One flag per point, 1 = dimmed (filtered out, ADR 0015); null dims nothing. */
  setDimmed(points: Uint8Array | null): void;
  setNoDataColor(css: string): void;
  resize(width: number, height: number, dpr: number): void;
  render(): void;
  destroy(): void;
}

export interface PointRendererOptions {
  readonly className?: string;
  /** Point diameter in CSS pixels. */
  readonly size?: number;
}

/** A station is one small dot, not a line among hundreds: dimmed, it keeps twice the lines' share or it vanishes. */
const POINT_DIM_ALPHA = DIM_ALPHA * 2;

interface Gpu {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly positions: WebGLBuffer;
  readonly values: WebGLBuffer;
  readonly ramp: WebGLTexture;
  readonly u: Record<'viewport' | 'size' | 'ramp' | 'noData' | 'dim', WebGLUniformLocation>;
}

/**
 * WebGL2 `gl.POINTS`: ~560 stations is tiny, but it keeps both views on the same technology and
 * the same color ramp texture as the lines. Positions and values are separate buffers, so a new
 * moment only re-uploads one float per station (P6).
 */
export class WebGLPointRenderer implements PointRenderer {
  readonly element: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly size: number;
  private gpu: Gpu | null;
  private count = 0;
  private positions = new Float32Array(0);
  private values = new Float32Array(0);
  private raw: ArrayLike<number> = new Float32Array(0);
  private dimmed: Uint8Array | null = null;
  private ramp = rampBytes(() => '#4c78a8');
  private noData: [number, number, number, number] = [0.5, 0.5, 0.5, 1];
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;

  constructor(options: PointRendererOptions = {}) {
    this.element = document.createElement('canvas');
    if (options.className) this.element.classList.add(options.className);
    const gl = this.element.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.size = options.size ?? 7;
    this.element.addEventListener('webglcontextlost', this.onContextLost);
    this.element.addEventListener('webglcontextrestored', this.onContextRestored);
    this.gpu = this.create();
  }

  setPositions(x: Float32Array, y: Float32Array): void {
    this.count = Math.min(x.length, y.length);
    this.positions = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      this.positions[2 * i] = x[i] as number;
      this.positions[2 * i + 1] = y[i] as number;
    }
    this.upload();
  }

  setValues(values: ArrayLike<number>): void {
    this.raw = values;
    this.values = encodeValues(values, this.dimmed);
    this.upload();
  }

  setDimmed(points: Uint8Array | null): void {
    this.dimmed = points;
    this.setValues(this.raw);
  }

  setColorScale(interpolate: (t: number) => string): void {
    this.ramp = rampBytes(interpolate);
    this.upload();
  }

  setNoDataColor(css: string): void {
    const [r, g, b, a] = parseColor(css);
    this.noData = [r / 255, g / 255, b / 255, a / 255];
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    this.dpr = dpr;
    resizeCanvas(this.element, width, height, dpr);
  }

  render(): void {
    const { gl, gpu } = this;
    gl.viewport(0, 0, this.element.width, this.element.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!gpu || this.count === 0 || this.values.length < this.count) return;
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.uniform2f(gpu.u.viewport, this.cssWidth, this.cssHeight);
    gl.uniform1f(gpu.u.size, this.size * this.dpr);
    gl.uniform4f(gpu.u.noData, ...this.noData);
    gl.uniform1f(gpu.u.dim, POINT_DIM_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.ramp);
    gl.uniform1i(gpu.u.ramp, 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    this.element.removeEventListener('webglcontextlost', this.onContextLost);
    this.element.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.gpu = null;
  }

  private create(): Gpu {
    const { gl } = this;
    const program = linkProgram(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
    const vao = gl.createVertexArray();
    const positions = gl.createBuffer();
    const values = gl.createBuffer();
    const ramp = gl.createTexture();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    const pos = attribLocation(gl, program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, values);
    const value = attribLocation(gl, program, 'a_value');
    gl.enableVertexAttribArray(value);
    gl.vertexAttribPointer(value, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, ramp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return {
      program,
      vao,
      positions,
      values,
      ramp,
      u: {
        viewport: uniformLocation(gl, program, 'u_viewport'),
        size: uniformLocation(gl, program, 'u_size'),
        ramp: uniformLocation(gl, program, 'u_ramp'),
        noData: uniformLocation(gl, program, 'u_noData'),
        dim: uniformLocation(gl, program, 'u_dim'),
      },
    };
  }

  private upload(): void {
    const { gl, gpu } = this;
    if (!gpu) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.positions);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.values);
    gl.bufferData(gl.ARRAY_BUFFER, this.values, gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, gpu.ramp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, RAMP_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.ramp);
  }

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the context is never restored.
    event.preventDefault();
    this.gpu = null;
  };

  private readonly onContextRestored = (): void => {
    this.gpu = this.create();
    this.upload();
  };
}

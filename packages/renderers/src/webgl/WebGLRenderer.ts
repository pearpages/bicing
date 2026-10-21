import { resizeCanvas } from '../dpr';
import { fillDrawList, lineCount } from '../lines';
import { projectionFor } from '../projection';
import {
  DIM_ALPHA,
  EMPTY_LINES,
  type LineSeriesData,
  type Renderer,
  type RenderStats,
  type Viewport,
} from '../types';
import { rampBytes, RAMP_SIZE } from './colorRamp';
import { attribLocation, linkProgram, uniformLocation } from './gl-utils';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import { xUniforms } from './uniforms';

/** WEBGL_multi_draw: every line strip in a single call instead of one drawArrays per line. */
interface MultiDraw {
  multiDrawArraysWEBGL(
    mode: GLenum,
    firsts: Int32Array,
    firstsOffset: number,
    counts: Int32Array,
    countsOffset: number,
    drawCount: number,
  ): void;
}

interface GpuResources {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly xBuffer: WebGLBuffer;
  readonly yBuffer: WebGLBuffer;
  readonly cBuffer: WebGLBuffer;
  readonly ramp: WebGLTexture;
  readonly multiDraw: MultiDraw | null;
  readonly u: {
    readonly xOrigin: WebGLUniformLocation;
    readonly xFrac: WebGLUniformLocation;
    readonly kx: WebGLUniformLocation;
    readonly ky: WebGLUniformLocation;
    readonly by: WebGLUniformLocation;
    readonly size: WebGLUniformLocation;
    readonly alpha: WebGLUniformLocation;
    readonly ramp: WebGLUniformLocation;
  };
}

export interface WebGLRendererOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly className?: string;
  readonly alpha?: number;
  /**
   * Multisample antialiasing. Off by default (ADR 0009): with millions of sub-pixel segments,
   * MSAA made a full-extent 10M-point frame about 6× slower (100 ms instead of 16.7 ms on an M4 Pro).
   * Worth enabling only for small datasets on dpr-1 screens.
   */
  readonly antialias?: boolean;
}

/**
 * WebGL2 line strips. setData uploads x (Uint32, an integer attribute), y (native type) and a per-vertex
 * color value (Uint8) once, 6 bytes per point. render only sets uniforms and issues one
 * multi-draw, so the per-frame CPU cost doesn't grow with the point count (P6). Lines are
 * still culled to their visible range by binary search: about 500 searches per frame, and it saves GPU vertex work when zoomed in.
 *
 * Known limitation: lines are 1 device pixel wide (WebGL ignores lineWidth > 1), and an isolated
 * single sample between two gaps isn't drawn (a 1-vertex strip is empty).
 */
export class WebGLRenderer implements Renderer {
  readonly kind = 'webgl';
  readonly element: HTMLCanvasElement;
  // 6 bytes/vertex: 60M points is about 360 MB of GPU buffers, the upper end for integrated GPUs.
  readonly maxPoints = 60_000_000;

  private readonly gl: WebGL2RenderingContext;
  private readonly alpha: number;
  private resources: GpuResources | null = null;
  private data: LineSeriesData = EMPTY_LINES;
  private ramp: Uint8Array = rampBytes(() => '#4c78a8');
  private firsts = new Int32Array(0);
  private counts = new Int32Array(0);
  private dimmed: Uint8Array | null = null;
  private cssWidth = 1;
  private cssHeight = 1;
  private lost = false;

  constructor(options: WebGLRendererOptions = {}) {
    this.element = options.canvas ?? document.createElement('canvas');
    if (options.className) this.element.classList.add(options.className);
    const gl = this.element.getContext('webgl2', {
      antialias: options.antialias ?? false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.alpha = options.alpha ?? 0.6;

    // Context loss happens (GPU reset, too many contexts, sleep). We keep the CPU-side data so we can rebuild.
    this.element.addEventListener('webglcontextlost', this.onContextLost);
    this.element.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resources = this.createResources();
  }

  setData(data: LineSeriesData): void {
    if (data.x.length > this.maxPoints) {
      throw new RangeError(`WebGLRenderer accepts at most ${String(this.maxPoints)} points`);
    }
    this.data = data;
    const lines = lineCount(data);
    this.firsts = new Int32Array(lines);
    this.counts = new Int32Array(lines);
    this.uploadData();
  }

  setColorScale(interpolate: (t: number) => string): void {
    this.ramp = rampBytes(interpolate);
    this.uploadRamp();
  }

  setDimmed(lines: Uint8Array | null): void {
    this.dimmed = lines;
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    resizeCanvas(this.element, width, height, dpr);
  }

  render(view: Viewport): RenderStats {
    const { gl, resources: r, data } = this;
    gl.viewport(0, 0, this.element.width, this.element.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.lost || !r) return { points: 0, drawCalls: 0 };

    const [x0, x1] = view.xDomain;
    const { drawCount, dimmedCount, points } = fillDrawList(
      data,
      x0,
      x1,
      this.dimmed,
      this.firsts,
      this.counts,
    );
    if (drawCount === 0) return { points: 0, drawCalls: 0 };

    const { ky, by } = projectionFor(view);
    const xu = xUniforms(view);
    gl.useProgram(r.program);
    gl.bindVertexArray(r.vao);
    gl.uniform1i(r.u.xOrigin, xu.xOrigin);
    gl.uniform1f(r.u.xFrac, xu.xFrac);
    gl.uniform1f(r.u.kx, xu.kx);
    gl.uniform1f(r.u.ky, ky);
    gl.uniform1f(r.u.by, by);
    gl.uniform2f(r.u.size, this.cssWidth, this.cssHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.ramp);
    gl.uniform1i(r.u.ramp, 0);

    let drawCalls = 0;
    const draw = (from: number, to: number) => {
      if (to <= from) return;
      if (r.multiDraw) {
        r.multiDraw.multiDrawArraysWEBGL(
          gl.LINE_STRIP,
          this.firsts,
          from,
          this.counts,
          from,
          to - from,
        );
        drawCalls++;
      } else {
        for (let i = from; i < to; i++) {
          gl.drawArrays(gl.LINE_STRIP, this.firsts[i] as number, this.counts[i] as number);
        }
        drawCalls += to - from;
      }
    };
    gl.uniform1f(r.u.alpha, this.alpha * DIM_ALPHA);
    draw(0, dimmedCount);
    gl.uniform1f(r.u.alpha, this.alpha);
    draw(dimmedCount, drawCount);
    gl.bindVertexArray(null);
    return { points, drawCalls };
  }

  destroy(): void {
    this.element.removeEventListener('webglcontextlost', this.onContextLost);
    this.element.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.deleteResources();
    this.data = EMPTY_LINES;
    // Free GPU memory now rather than at GC: benchmark mode swaps renderers repeatedly, and
    // browsers cap live WebGL contexts (about 16).
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.element.remove();
  }

  /** Whether the single-call multi-draw path is active (shown in the benchmark overlay). */
  get usesMultiDraw(): boolean {
    return this.resources?.multiDraw != null;
  }

  private readonly onContextLost = (event: Event): void => {
    // preventDefault signals that we'll handle restoration; without it, the context is gone for good.
    event.preventDefault();
    this.lost = true;
    this.resources = null;
  };

  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.resources = this.createResources();
    this.uploadData();
  };

  private createResources(): GpuResources {
    const { gl } = this;
    const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const vao = gl.createVertexArray();
    const xBuffer = gl.createBuffer();
    const yBuffer = gl.createBuffer();
    const cBuffer = gl.createBuffer();
    const ramp = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, ramp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resources: GpuResources = {
      program,
      vao,
      xBuffer,
      yBuffer,
      cBuffer,
      ramp,
      multiDraw: gl.getExtension('WEBGL_multi_draw'),
      u: {
        xOrigin: uniformLocation(gl, program, 'u_xOrigin'),
        xFrac: uniformLocation(gl, program, 'u_xFrac'),
        kx: uniformLocation(gl, program, 'u_kx'),
        ky: uniformLocation(gl, program, 'u_ky'),
        by: uniformLocation(gl, program, 'u_by'),
        size: uniformLocation(gl, program, 'u_size'),
        alpha: uniformLocation(gl, program, 'u_alpha'),
        ramp: uniformLocation(gl, program, 'u_ramp'),
      },
    };
    this.resources = resources;
    this.uploadRamp();
    return resources;
  }

  private uploadData(): void {
    const { gl, resources: r, data } = this;
    if (!r) return;
    const colorValues = perVertexColor(data);

    gl.bindVertexArray(r.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, r.xBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.x, gl.STATIC_DRAW);
    const ax = attribLocation(gl, r.program, 'a_x');
    gl.enableVertexAttribArray(ax);
    // The I variant keeps the attribute an integer end to end (no float conversion on the way in).
    gl.vertexAttribIPointer(ax, 1, gl.UNSIGNED_INT, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, r.yBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.y, gl.STATIC_DRAW);
    const ay = attribLocation(gl, r.program, 'a_y');
    gl.enableVertexAttribArray(ay);
    gl.vertexAttribPointer(ay, 1, glTypeOf(gl, data.y), false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, r.cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colorValues, gl.STATIC_DRAW);
    const ac = attribLocation(gl, r.program, 'a_c');
    gl.enableVertexAttribArray(ac);
    gl.vertexAttribPointer(ac, 1, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindVertexArray(null);
    if (gl.getError() === gl.OUT_OF_MEMORY) {
      throw new RangeError(`GPU out of memory uploading ${String(data.x.length)} points`);
    }
  }

  private uploadRamp(): void {
    const { gl, resources: r } = this;
    if (!r) return;
    gl.bindTexture(gl.TEXTURE_2D, r.ramp);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      RAMP_SIZE,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.ramp,
    );
  }

  private deleteResources(): void {
    const { gl, resources: r } = this;
    if (!r) return;
    gl.deleteBuffer(r.xBuffer);
    gl.deleteBuffer(r.yBuffer);
    gl.deleteBuffer(r.cBuffer);
    gl.deleteTexture(r.ramp);
    gl.deleteVertexArray(r.vao);
    gl.deleteProgram(r.program);
    this.resources = null;
  }
}

function glTypeOf(gl: WebGL2RenderingContext, y: LineSeriesData['y']): GLenum {
  if (y instanceof Uint8Array) return gl.UNSIGNED_BYTE;
  if (y instanceof Uint16Array) return gl.UNSIGNED_SHORT;
  return gl.FLOAT;
}

/** The per-line color value repeated for each vertex, normalized to a byte (the shader sees 0–1). */
export function perVertexColor(data: LineSeriesData): Uint8Array {
  const out = new Uint8Array(data.x.length);
  const lines = lineCount(data);
  for (let k = 0; k < lines; k++) {
    const v = data.lineValue[k] as number;
    const byte = Math.round((v < 0 || Number.isNaN(v) ? 0 : v > 1 ? 1 : v) * 255);
    out.fill(byte, data.lineStarts[k], data.lineStarts[k + 1]);
  }
  return out;
}

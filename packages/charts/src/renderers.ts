import {
  CanvasRenderer,
  SvgRenderer,
  WebGLRenderer,
  type Renderer,
  type RendererKind,
} from '@bicing/renderers';

export interface RendererSettings {
  /** Line opacity. Hundreds of overlapping series need a low value to show density. */
  readonly alpha?: number;
}

/**
 * Framework bindings choose a renderer by kind without depending on @bicing/renderers directly
 * (the package graph allows vue → charts, not vue → renderers).
 */
export function createRenderer(kind: RendererKind, settings: RendererSettings = {}): Renderer {
  const options = settings.alpha === undefined ? {} : { alpha: settings.alpha };
  switch (kind) {
    case 'svg':
      return new SvgRenderer(options);
    case 'canvas':
      return new CanvasRenderer(options);
    case 'webgl':
      return new WebGLRenderer(options);
  }
}

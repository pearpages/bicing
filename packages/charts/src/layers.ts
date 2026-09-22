const SVG_NS = 'http://www.w3.org/2000/svg';

/** The stacked layers of a chart (see ARCHITECTURE.md > Chart anatomy). Positioned by styles.css. */
export interface ChartDom {
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly axes: SVGSVGElement;
  readonly grid: SVGGElement;
  readonly xAxis: SVGGElement;
  readonly yAxis: SVGGElement;
  readonly hover: HoverDom;
  readonly overlay: HTMLDivElement;
}

/** Crosshair, marker and tooltip, drawn in SVG and positioned with attributes (no inline styles, P16). */
export interface HoverDom {
  readonly group: SVGGElement;
  readonly crosshair: SVGLineElement;
  readonly marker: SVGCircleElement;
  readonly tooltip: SVGGElement;
  readonly tooltipBox: SVGRectElement;
  readonly tooltipText: SVGTextElement;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  element.setAttribute('class', className);
  return element;
}

export function createChartDom(host: HTMLElement, label: string): ChartDom {
  const root = document.createElement('div');
  root.className = 'bp-chart';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);

  const plot = document.createElement('div');
  plot.className = 'bp-chart__plot';

  const axes = svg('svg', 'bp-chart__axes');
  const grid = svg('g', 'bp-chart__grid');
  const xAxis = svg('g', 'bp-chart__axis bp-chart__axis--x');
  const yAxis = svg('g', 'bp-chart__axis bp-chart__axis--y');
  // The grid sits in the axes layer, above the data. It's faint and doesn't hide marks, and the
  // renderers stay free of decoration.
  const hover = createHoverDom();
  axes.append(grid, xAxis, yAxis, hover.group);

  const overlay = document.createElement('div');
  overlay.className = 'bp-chart__overlay';

  root.append(plot, axes, overlay);
  host.append(root);
  return { root, plot, axes, grid, xAxis, yAxis, hover, overlay };
}

function createHoverDom(): HoverDom {
  const group = svg('g', 'bp-chart__hover');
  group.setAttribute('visibility', 'hidden');
  const crosshair = svg('line', 'bp-chart__crosshair');
  const marker = svg('circle', 'bp-chart__marker');
  // 4px radius = 8px marker, the minimum readable size, with a surface ring from the stylesheet.
  marker.setAttribute('r', '4');
  const tooltip = svg('g', 'bp-chart__tooltip');
  const tooltipBox = svg('rect', 'bp-chart__tooltip-box');
  tooltipBox.setAttribute('rx', '4');
  const tooltipText = svg('text', 'bp-chart__tooltip-text');
  tooltip.append(tooltipBox, tooltipText);
  group.append(crosshair, marker, tooltip);
  return { group, crosshair, marker, tooltip, tooltipBox, tooltipText };
}

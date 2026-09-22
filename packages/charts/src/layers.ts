const SVG_NS = 'http://www.w3.org/2000/svg';

/** The stacked layers of a chart (see ARCHITECTURE.md > Chart anatomy). Positioned by styles.css. */
export interface ChartDom {
  readonly root: HTMLDivElement;
  readonly plot: HTMLDivElement;
  readonly axes: SVGSVGElement;
  readonly grid: SVGGElement;
  readonly xAxis: SVGGElement;
  readonly yAxis: SVGGElement;
  readonly overlay: HTMLDivElement;
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
  axes.append(grid, xAxis, yAxis);

  const overlay = document.createElement('div');
  overlay.className = 'bp-chart__overlay';

  root.append(plot, axes, overlay);
  host.append(root);
  return { root, plot, axes, grid, xAxis, yAxis, overlay };
}

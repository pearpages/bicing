/** The SVG tooltip both views draw: a box and one line of text per entry. */
export interface TooltipDom {
  readonly tooltip: SVGGElement;
  readonly box: SVGRectElement;
  readonly text: SVGTextElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE_HEIGHT = 16;
const PADDING = 8;

export function createTooltip(className: string): TooltipDom {
  const tooltip = document.createElementNS(SVG_NS, 'g');
  tooltip.setAttribute('class', className);
  const box = document.createElementNS(SVG_NS, 'rect');
  box.setAttribute('class', `${className}-box`);
  box.setAttribute('rx', '4');
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('class', `${className}-text`);
  tooltip.append(box, text);
  return { tooltip, box, text };
}

/**
 * Fills the tooltip and puts it beside (px, py), inside a plot of `width` × `height`: right of the
 * point by default, flipped left or nudged up when it would leave the plot.
 */
export function placeTooltip(
  dom: TooltipDom,
  lines: readonly string[],
  px: number,
  py: number,
  width: number,
  height: number,
): void {
  dom.text.replaceChildren(
    ...lines.map((line, i) => {
      const tspan = document.createElementNS(SVG_NS, 'tspan');
      tspan.setAttribute('x', String(PADDING));
      tspan.setAttribute('dy', String(i === 0 ? 0 : LINE_HEIGHT));
      tspan.textContent = line;
      return tspan;
    }),
  );
  // Text can't be measured before layout in every environment, so estimate from the longest line.
  const boxWidth = Math.max(...lines.map((l) => l.length)) * 6.6 + PADDING * 2;
  const boxHeight = lines.length * LINE_HEIGHT + PADDING;
  dom.box.setAttribute('width', String(boxWidth));
  dom.box.setAttribute('height', String(boxHeight));
  dom.text.setAttribute('y', String(PADDING + 11));
  const tx = px + 12 + boxWidth > width ? px - 12 - boxWidth : px + 12;
  const ty = Math.min(Math.max(0, py - boxHeight / 2), height - boxHeight);
  dom.tooltip.setAttribute('transform', `translate(${String(tx)},${String(ty)})`);
}

import type { Messages } from './messages.ca';

export const en: Messages = {
  meta: {
    title: 'Bicing Pulse',
    description: 'Millions of Bicing readings, rendered smoothly with D3 and WebGL2.',
  },
  language: {
    legend: 'Language',
  },
  chart: {
    label: 'Bikes available per station over time',
    station: (number) => `Station ${String(number)}`,
    bikes: (count) => (count === 1 ? '1 bike' : `${String(count)} bikes`),
    capped: (renderer, max, requested) =>
      `${renderer} is capped at ${max} points (${requested} requested)`,
  },
};

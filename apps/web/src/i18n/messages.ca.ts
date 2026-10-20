/**
 * Catalan is the source language: this object's shape is the `Messages` type, so every other
 * dictionary must have exactly these keys (ADR 0011, P27).
 */
export const ca = {
  meta: {
    title: 'Bicing Pulse',
    description: 'Milions de lectures del Bicing dibuixades amb fluïdesa gràcies a D3 i WebGL2.',
  },
  language: {
    legend: 'Llengua',
  },
};

export type Messages = typeof ca;

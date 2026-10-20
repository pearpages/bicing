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
  chart: {
    label: 'Bicicletes disponibles per estació al llarg del temps',
    station: (number: number) => `Estació ${String(number)}`,
    bikes: (count: number) => (count === 1 ? '1 bicicleta' : `${String(count)} bicicletes`),
    capped: (renderer: string, max: string, requested: string) =>
      `${renderer}: com a màxim ${max} punts (se n'han demanat ${requested})`,
  },
};

export type Messages = typeof ca;

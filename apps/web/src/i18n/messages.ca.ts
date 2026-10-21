import type { Decimation } from '@bicing/charts';
import type { MachineInfo } from '../benchmark/machine';

const decimationNames: Record<Decimation, string> = {
  none: 'No',
  minmax: 'Mín./màx.',
  lttb: 'LTTB',
};

/**
 * Catalan is the source language: this object's shape is the `Messages` type, so every other
 * dictionary must have exactly these keys (ADR 0011, P27). Numbers arrive already formatted for
 * the locale; counts that pick a plural arrive as numbers.
 */
export const ca = {
  meta: {
    title: 'Bicing Pulse',
    description: 'Milions de lectures del Bicing dibuixades amb fluïdesa gràcies a D3 i WebGL2.',
  },
  language: {
    legend: 'Llengua',
  },
  app: {
    tagline: 'Bicicletes disponibles a cada estació del Bicing de Barcelona, al llarg del temps.',
    summary: (readings: string, stations: string, span: string) =>
      `${readings} lectures de ${stations} estacions en ${span}. Dades sintètiques amb l'esquema real.`,
    hours: (count: string) => `${count} hores`,
    days: (count: string) => `${count} dies`,
    chartArea: 'Bicicletes disponibles per estació',
    generating: (readings: string) => `Generant ${readings} lectures en un worker…`,
    loadingMonth: (month: string) => `Carregant ${month} d'Open Data BCN en un worker…`,
    realSummary: (readings: string, stations: string, month: string) =>
      `${readings} lectures de ${stations} estacions, ${month}. Dades reals d'Open Data BCN.`,
    loadMonthFailed: (month: string, cause: string) => `No s'ha pogut carregar ${month}: ${cause}.`,
    realUnavailable: (url: string) =>
      `No hi ha dades reals a ${url}. Genera-les amb pnpm prepare-data --build.`,
    loadFailed: (readings: string, cause: string) =>
      `No s'han pogut generar ${readings} lectures: ${cause}. Prova un conjunt de dades més petit.`,
    hint: "Fes servir la roda per fer zoom, arrossega per desplaçar-te i passa per sobre d'una línia per veure'n l'estació.",
  },
  controls: {
    source: 'Dades',
    sourceOptions: { synthetic: 'Sintètiques', real: 'Reals' },
    month: 'Mes',
    monthsLoading: 'Carregant la llista de mesos…',
    renderer: 'Motor de dibuix',
    svgTitle: 'Un <path> per línia, refet a cada fotograma. Limitat a 1M de punts.',
    readings: 'Lectures',
    stressTitle:
      "Prova d'estrès: uns 800 MB a la pestanya. Pot fallar en ordinadors amb menys memòria.",
    decimation: 'Reducció de punts',
    decimationOptions: { none: 'No', minmax: 'Mín./màx. per píxel', lttb: 'LTTB' },
    measureThis: 'Mesura aquesta configuració',
    measureAll: 'Mesura-ho tot',
    progress: (index: string, total: string, config: string) =>
      `Mesurant ${index} de ${total}: ${config}`,
  },
  tooltip: {
    available: (bikes: number, capacity: number) =>
      `${String(bikes)} de ${String(capacity)} bicicletes disponibles`,
    availableNoCapacity: (bikes: number) =>
      bikes === 1 ? '1 bicicleta disponible' : `${String(bikes)} bicicletes disponibles`,
  },
  chart: {
    label: 'Bicicletes disponibles per estació al llarg del temps',
    station: (number: number) => `Estació ${String(number)}`,
    bikes: (count: number) => (count === 1 ? '1 bicicleta' : `${String(count)} bicicletes`),
    capped: (renderer: string, max: string, requested: string) =>
      `${renderer}: com a màxim ${max} punts (se n'han demanat ${requested})`,
  },
  legend: {
    title: "Color de la línia: ocupació mitjana de l'estació",
    emptier: 'Més buida',
    fuller: 'Més plena',
  },
  perf: {
    label: 'Rendiment',
    fpsUnit: 'fotogrames per segon',
    frameTime: 'Temps de fotograma, mediana i percentil 95',
    frameTimeValue: (p50: string, p95: string) => `${p50} i ${p95}`,
    longFrames: 'Fotogrames de més de 50 ms',
    longest: (ms: string) => `(el més llarg, ${ms})`,
    memory: 'Memòria',
    memoryUnavailable: 'No disponible en aquest navegador',
    memoryPage: (mb: string) => `${mb} MB (pàgina i workers)`,
    memoryHeap: (mb: string) => `${mb} MB (memòria de JavaScript)`,
    lastFrame: 'Últim fotograma del gràfic',
    pointsSent: 'Punts enviats al motor de dibuix',
    pointsSentValue: (sent: string, total: string) => `${sent} de ${total}`,
    pointsDrawn: 'Punts dibuixats després de descartar els invisibles',
    pointsDrawnValue: (points: string, calls: number) =>
      calls === 1
        ? `${points} en 1 crida de dibuix`
        : `${points} en ${String(calls)} crides de dibuix`,
    prepare: 'Reducció de punts i càrrega',
    renderCpu: 'Temps de CPU de les crides de dibuix',
    waiting: 'Esperant el primer fotograma.',
    stale: "Es mostra la reducció anterior mentre fas zoom. S'afina quan t'atures.",
    skippedHint: 'Tria un conjunt de dades més petit o activa la reducció de punts.',
    loading: 'Càrrega',
    generated: 'Temps al worker (generar o carregar)',
    firstChart: 'Temps fins al primer gràfic',
    drawing: 'Dibuixant…',
  },
  trace: {
    label: (over: string, total: string) =>
      `Temps de fotograma recents: ${over} dels darrers ${total} fotogrames han superat el pressupost`,
    caption: (frames: string, budget: string) =>
      `Temps de fotograma dels darrers ${frames} fotogrames. La línia és el pressupost de ${budget} per a 60 fps.`,
  },
  results: {
    title: 'Resultats de les mesures',
    copy: 'Copia com a Markdown',
    copied: 'Copiat',
    close: 'Tanca',
    note: 'Cada execució reprodueix el mateix zoom i desplaçament de 5 segons. Mantén aquesta pestanya en primer pla: les pestanyes amagades alenteixen els fotogrames.',
    columns: {
      config: 'Configuració',
      fps: 'FPS',
      p95: 'Fotograma p95',
      longFrames: 'Fotogrames de més de 50 ms',
      firstChart: 'Primer gràfic',
      notes: 'Notes',
    },
    decimationNames,
    configLabel: (renderer: string, readings: string, decimation: Decimation) =>
      `${renderer}, ${readings} lectures, ${
        decimation === 'none'
          ? 'sense reducció'
          : `reducció ${decimation === 'minmax' ? 'mín./màx.' : 'LTTB'}`
      }`,
    notRun: 'no executat',
    staleFrames: (count: number) =>
      count === 1
        ? '1 fotograma amb la reducció anterior'
        : `${String(count)} fotogrames amb la reducció anterior`,
    backgroundTab:
      'Aquesta pestanya és en segon pla i el navegador hi atura els fotogrames. Porta-la al davant i torna-ho a provar.',
    hiddenDuringRun:
      "La pestanya s'ha amagat durant l'execució i el navegador ha alentit els fotogrames.",
    markdown: {
      header: [
        'Motor de dibuix',
        'Lectures',
        'Reducció',
        'FPS',
        'Fotograma p50 (ms)',
        'Fotograma p95 (ms)',
        'Fotogrames > 50 ms',
        'El més llarg (ms)',
        'CPU del gràfic p95 (ms)',
        'Memòria (MB)',
        'Primer gràfic (ms)',
        'Notes',
      ],
      measured: (date: string) =>
        `Mesurat el ${date} amb un zoom i desplaçament programat de 5 s (apps/web/src/benchmark/scenario.ts).`,
      machine: (machine: MachineInfo, cores: string, memory: string | null) =>
        `Ordinador: ${machine.platform}, ${cores} nuclis${
          memory === null ? '' : `, ≥${memory} GB de RAM`
        }, GPU ${machine.gpu}, devicePixelRatio ${String(machine.devicePixelRatio)}, finestra ${machine.viewport}.`,
      browser: (userAgent: string) => `Navegador: ${userAgent}.`,
      cpuNote:
        'CPU del gràfic = temps de reducció de punts, càrrega i crides de dibuix al fil principal. No inclou el temps de GPU (és asíncron), però es nota en el temps de fotograma.',
    },
  },
};

export type Messages = typeof ca;

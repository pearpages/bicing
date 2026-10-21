import {
  barcelonaHours,
  Crossfilter,
  lowerBound,
  Status,
  type ObservationColumns,
  type StationTable,
} from '@bicing/core';

/** Bins of ADR 0015's histograms: Barcelona hours, and occupancy in 5% steps. */
export const HOUR_BINS = 24;
export const FILL_BINS = 20;

type Range = readonly [number, number];

/** What the page asks for after each brush move; `null` means "not filtered". */
export interface FilterRequest {
  /** The dataset these filters are for; a mismatch means the page is behind a new load. */
  readonly generation: number;
  /** Half-open, minutes since the epoch. */
  readonly time: Range | null;
  /** Bins [lo, hi) of hour of day. */
  readonly hour: Range | null;
  /** Bins [lo, hi) of occupancy. */
  readonly fill: Range | null;
  readonly stations: readonly number[] | null;
}

/** Under 3 KB per update (ADR 0015): cloned to the page, never a shared mask. */
export interface FilterResult {
  readonly generation: number;
  /** Rows per hour bin passing every filter except the hour brush. */
  readonly hour: Uint32Array;
  /** Rows per occupancy bin passing every filter except the occupancy brush. */
  readonly fill: Uint32Array;
  /** Rows per station passing every filter: 0 means the station is dimmed. */
  readonly stations: Uint32Array;
  readonly passing: number;
  /** Rows taking part: in-service readings of stations with a capacity. */
  readonly rows: number;
}

const DIM = { hour: 0, fill: 1, station: 2 } as const;

/**
 * The worker's crossfilter for one loaded dataset (T3.2, ADR 0015). Built before the columns are
 * transferred to the page, from the rows a line draws: in-service readings (P9) of stations with
 * a capacity, since occupancy needs one.
 */
export class FilterState {
  readonly generation: number;
  /** Rows taking part, in time order, with what each dimension needs. */
  private readonly t: Uint32Array;
  private readonly station: Uint16Array;
  private readonly fill: Uint8Array;
  private readonly stationCount: number;
  /**
   * Built on the first filter request, not at load: the indexes cost ~60 ms for a month, and a
   * load shouldn't pay that for someone who never brushes (ADR 0015).
   */
  private crossfilter: Crossfilter | null = null;

  constructor(observations: ObservationColumns, stations: StationTable, generation: number) {
    this.generation = generation;
    this.stationCount = stations.length;
    const { status, stationIdx } = observations;
    const capacity = stations.capacity;
    // Locals, not imported names, in the per-row loops: a module binding read per row is slower
    // where imports are transformed (Vitest), and a local costs nothing in the browser bundle.
    const inService = Status.InService;
    const fillBins = FILL_BINS;
    let rows = 0;
    for (let i = 0; i < observations.length; i++)
      if (status[i] === inService && (capacity[stationIdx[i] as number] ?? 0) > 0) rows++;
    this.t = new Uint32Array(rows);
    this.station = new Uint16Array(rows);
    this.fill = new Uint8Array(rows);
    let at = 0;
    for (let i = 0; i < observations.length; i++) {
      if (status[i] !== inService) continue;
      const s = stationIdx[i] as number;
      const cap = capacity[s] ?? 0;
      if (cap === 0) continue;
      const bikes = (observations.bikesMech[i] as number) + (observations.bikesElec[i] as number);
      this.t[at] = observations.t[i] as number;
      this.station[at] = s;
      this.fill[at] = Math.min(fillBins - 1, Math.floor((bikes / cap) * fillBins));
      at++;
    }
  }

  /** Rows taking part: in-service readings of stations with a capacity. */
  get rows(): number {
    return this.t.length;
  }

  private build(): Crossfilter {
    const stations = Math.max(1, this.stationCount);
    return new Crossfilter({
      dimensions: [
        { bins: barcelonaHours(this.t), binCount: HOUR_BINS },
        { bins: this.fill, binCount: FILL_BINS },
        { bins: this.station, binCount: stations },
      ],
      group: { bins: this.station, binCount: stations },
    });
  }

  /** Applies every filter (unchanged ones cost nothing) and reads the counts. */
  apply(request: FilterRequest): FilterResult {
    this.crossfilter ??= this.build();
    const cf = this.crossfilter;
    // Rows are in time order: the time brush is a row range, found by binary search.
    if (request.time)
      cf.filterRows(lowerBound(this.t, request.time[0]), lowerBound(this.t, request.time[1]));
    else cf.filterRows(0, cf.rows);
    const range = (dim: number, value: Range | null) => {
      if (value) cf.filterRange(dim, value[0], value[1]);
      else cf.clear(dim);
    };
    range(DIM.hour, request.hour);
    range(DIM.fill, request.fill);
    if (request.stations) {
      const selected = new Uint8Array(Math.max(1, this.stationCount));
      for (const s of request.stations) if (s >= 0 && s < selected.length) selected[s] = 1;
      cf.filterBins(DIM.station, (s) => selected[s] === 1);
    } else cf.clear(DIM.station);
    // Copies: the crossfilter keeps updating its own counts on the next brush move.
    return {
      generation: this.generation,
      hour: cf.histogram(DIM.hour).slice(),
      fill: cf.histogram(DIM.fill).slice(),
      stations: cf.groupCounts().slice(),
      passing: cf.passing(),
      rows: cf.rows,
    };
  }
}

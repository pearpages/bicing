import {
  createRenderer,
  TimeSeriesChart,
  type ChartFormat,
  type ChartLocale,
  type Decimation,
  type FrameReport,
  type GapPeriod,
  type Hit,
  type RendererKind,
  type TimeRange,
} from '@bicing/charts';
import type { StationSeries } from '@bicing/core';
import {
  markRaw,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toRaw,
  watch,
  type Ref,
  type ShallowRef,
} from 'vue';

export interface UseTimeSeriesChartOptions {
  readonly series: Readonly<Ref<StationSeries | null>>;
  readonly renderer: Readonly<Ref<RendererKind>>;
  readonly decimation: Readonly<Ref<Decimation>>;
  readonly colorScale: Readonly<Ref<(t: number) => string>>;
  readonly locale: Readonly<Ref<ChartLocale>>;
  /** The zoom extent when it isn't the data's own: a whole-history view's coverage (T2.5b). */
  readonly extent?: Readonly<Ref<readonly [number, number] | undefined>>;
  /** Feed-wide silences to shade and explain (T2.6). */
  readonly gaps?: Readonly<Ref<readonly GapPeriod[] | undefined>>;
  /** New data keeps the current view instead of resetting the zoom (T2.5b). */
  readonly keepView?: Readonly<Ref<boolean | undefined>>;
  /** Line opacity, applied when a renderer is created. */
  readonly alpha?: Readonly<Ref<number | undefined>>;
  readonly describe?: (hit: Hit, format: ChartFormat) => readonly string[];
  /** The time brush (T3.3): on only for data the crossfilter covers (ADR 0015). */
  readonly brushEnabled?: Readonly<Ref<boolean | undefined>>;
  /** The selection the app holds; the chart reports user changes through onBrush. */
  readonly brush?: Readonly<Ref<TimeRange | null | undefined>>;
  /** One flag per station, 1 = filtered out. */
  readonly dimmedStations?: Readonly<Ref<Uint8Array | null | undefined>>;
  readonly onBrush?: (range: TimeRange | null) => void;
  readonly onFrame?: (report: FrameReport) => void;
  readonly onHover?: (hit: Hit | null) => void;
  readonly onView?: (domain: readonly [number, number]) => void;
}

/**
 * Binds a TimeSeriesChart to a host element for the component's lifetime (ADR 0007).
 *
 * Vue owns the host and the settings (renderer kind, decimation, colors, locale). It never owns the data. The
 * controller is `markRaw`ed and held in a `shallowRef`, and the series is `toRaw`ed before it reaches
 * the chart. A reactive StationSeries would route every `series.x[i]` in decimation and picking
 * through a Proxy trap. Watches are shallow, so new data means a new object identity, not a deep
 * diff over millions of values.
 */
export function useTimeSeriesChart(
  host: Readonly<Ref<HTMLElement | null>>,
  options: UseTimeSeriesChartOptions,
): ShallowRef<TimeSeriesChart | null> {
  const chart = shallowRef<TimeSeriesChart | null>(null);
  const dataOptions = () => {
    const extent = options.extent?.value;
    const keepView = options.keepView?.value ?? false;
    return extent === undefined ? { keepView } : { extent, keepView };
  };
  const settings = () => {
    const alpha = options.alpha?.value;
    return alpha === undefined ? {} : { alpha };
  };

  onMounted(() => {
    const element = host.value;
    if (!element) return;
    const instance = markRaw(
      new TimeSeriesChart(element, {
        renderer: createRenderer(options.renderer.value, settings()),
        decimation: options.decimation.value,
        colorScale: options.colorScale.value,
        locale: options.locale.value,
        ...(options.describe ? { describe: options.describe } : {}),
      }),
    );
    if (options.onFrame) instance.onFrame(options.onFrame);
    if (options.onHover) instance.onHover(options.onHover);
    if (options.onView) instance.onView(options.onView);
    if (options.onBrush) instance.onBrush(options.onBrush);
    instance.setData(rawSeries(options.series.value), dataOptions());
    instance.setGaps(options.gaps?.value ?? []);
    instance.setBrushEnabled(options.brushEnabled?.value ?? false);
    applyBrush(instance, options.brush?.value ?? null);
    instance.setDimmedStations(rawFlags(options.dimmedStations?.value));
    chart.value = instance;
  });

  watch(options.series, (series) => chart.value?.setData(rawSeries(series), dataOptions()));
  watch(options.renderer, (kind) => chart.value?.setRenderer(createRenderer(kind, settings())));
  watch(options.decimation, (decimation) => chart.value?.setDecimation(decimation));
  watch(options.colorScale, (colorScale) => chart.value?.setColorScale(colorScale));
  watch(options.locale, (locale) => chart.value?.setLocale(locale));
  if (options.gaps) watch(options.gaps, (gaps) => chart.value?.setGaps(gaps ?? []));
  if (options.brushEnabled) {
    watch(options.brushEnabled, (enabled) => chart.value?.setBrushEnabled(enabled ?? false));
  }
  if (options.brush) {
    watch(options.brush, (range) => {
      if (chart.value) applyBrush(chart.value, range ?? null);
    });
  }
  if (options.dimmedStations) {
    watch(options.dimmedStations, (dimmed) => chart.value?.setDimmedStations(rawFlags(dimmed)));
  }

  onBeforeUnmount(() => {
    chart.value?.destroy();
    chart.value = null;
  });

  return chart;
}

function rawSeries(series: StationSeries | null): StationSeries | null {
  return series ? toRaw(series) : null;
}

function rawFlags(flags: Uint8Array | null | undefined): Uint8Array | null {
  return flags ? toRaw(flags) : null;
}

/**
 * The app echoes every brush the user makes back as a prop. Moving the brush to where it already
 * is would interrupt the drag in progress, so only a different range is applied.
 */
function applyBrush(chart: TimeSeriesChart, range: TimeRange | null): void {
  const current = chart.brushRange;
  if (current?.[0] === range?.[0] && current?.[1] === range?.[1]) return;
  chart.setBrush(range);
}

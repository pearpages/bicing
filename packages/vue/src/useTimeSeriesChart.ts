import {
  createRenderer,
  TimeSeriesChart,
  type ChartFormat,
  type ChartLocale,
  type Decimation,
  type FrameReport,
  type Hit,
  type RendererKind,
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
  /** Line opacity, applied when a renderer is created. */
  readonly alpha?: Readonly<Ref<number | undefined>>;
  readonly describe?: (hit: Hit, format: ChartFormat) => readonly string[];
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
    instance.setData(rawSeries(options.series.value));
    chart.value = instance;
  });

  watch(options.series, (series) => chart.value?.setData(rawSeries(series)));
  watch(options.renderer, (kind) => chart.value?.setRenderer(createRenderer(kind, settings())));
  watch(options.decimation, (decimation) => chart.value?.setDecimation(decimation));
  watch(options.colorScale, (colorScale) => chart.value?.setColorScale(colorScale));
  watch(options.locale, (locale) => chart.value?.setLocale(locale));

  onBeforeUnmount(() => {
    chart.value?.destroy();
    chart.value = null;
  });

  return chart;
}

function rawSeries(series: StationSeries | null): StationSeries | null {
  return series ? toRaw(series) : null;
}

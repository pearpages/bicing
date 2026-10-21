import { HistogramChart, type BinRange } from '@bicing/charts';
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

export interface UseHistogramChartOptions {
  readonly bins: number;
  readonly label: Readonly<Ref<string>>;
  /** Rebuilt by the app when the language changes; the axis follows. */
  readonly tick: Readonly<Ref<(bin: number) => string>>;
  readonly tickEvery?: number;
  readonly formatNumber?: Readonly<Ref<((n: number) => string) | undefined>>;
  /** Per bin with no filter, drawn faintly. */
  readonly total: Readonly<Ref<ArrayLike<number> | null>>;
  /** Per bin passing every other filter (ADR 0015). */
  readonly passing: Readonly<Ref<ArrayLike<number> | null>>;
  /** The selection the app holds; the chart reports user changes through onBrush. */
  readonly brush: Readonly<Ref<BinRange | null>>;
  readonly onBrush?: (range: BinRange | null) => void;
}

/** Binds a HistogramChart to a host element for the component's lifetime, like the other charts (ADR 0007). */
export function useHistogramChart(
  host: Readonly<Ref<HTMLElement | null>>,
  options: UseHistogramChartOptions,
): ShallowRef<HistogramChart | null> {
  const chart = shallowRef<HistogramChart | null>(null);

  onMounted(() => {
    const element = host.value;
    if (!element) return;
    const formatNumber = options.formatNumber?.value;
    const instance = markRaw(
      new HistogramChart(element, {
        bins: options.bins,
        label: options.label.value,
        tick: options.tick.value,
        ...(options.tickEvery === undefined ? {} : { tickEvery: options.tickEvery }),
        ...(formatNumber ? { formatNumber } : {}),
      }),
    );
    if (options.onBrush) instance.onBrush(options.onBrush);
    applyCounts(instance);
    instance.setBrush(options.brush.value);
    chart.value = instance;
  });

  function applyCounts(instance: HistogramChart): void {
    const total = options.total.value;
    if (!total) return;
    instance.setCounts(toRaw(total), toRaw(options.passing.value ?? total));
  }

  watch([options.tick, () => options.formatNumber?.value], ([tick, formatNumber]) =>
    chart.value?.setFormat(tick, formatNumber),
  );
  watch([options.total, options.passing], () => {
    if (chart.value) applyCounts(chart.value);
  });
  watch(options.label, (label) => chart.value?.setLabel(label));
  watch(options.brush, (range) => {
    const current = chart.value?.brushRange ?? null;
    // The app echoes the user's own brush back: moving it there would interrupt the drag.
    if (current?.[0] === range?.[0] && current?.[1] === range?.[1]) return;
    chart.value?.setBrush(range);
  });

  onBeforeUnmount(() => {
    chart.value?.destroy();
    chart.value = null;
  });

  return chart;
}

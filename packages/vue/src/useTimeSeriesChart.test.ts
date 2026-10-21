import type { ChartLocale } from '@bicing/charts';
import type { StationSeries } from '@bicing/core';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, isProxy, nextTick, ref, shallowRef, type Ref } from 'vue';
import { useTimeSeriesChart } from './useTimeSeriesChart';

// The real controller needs a GPU. This records what the composable hands it.
const calls = vi.hoisted(() => ({
  setData: [] as unknown[],
  dataOptions: [] as unknown[],
  setRenderer: [] as string[],
  setDecimation: [] as string[],
  setLocale: [] as string[],
  destroyed: 0,
}));

vi.mock('@bicing/charts', () => ({
  createRenderer: (kind: string) => ({ kind }),
  TimeSeriesChart: class {
    setData(series: unknown, options: unknown) {
      calls.setData.push(series);
      calls.dataOptions.push(options);
    }
    setRenderer(renderer: { kind: string }) {
      calls.setRenderer.push(renderer.kind);
    }
    setDecimation(decimation: string) {
      calls.setDecimation.push(decimation);
    }
    setColorScale = () => undefined;
    setLocale(locale: { label: string }) {
      calls.setLocale.push(locale.label);
    }
    onFrame = () => undefined;
    onHover = () => undefined;
    onView = () => undefined;
    destroy() {
      calls.destroyed++;
    }
  },
}));

function series(): StationSeries {
  return {
    x: Uint32Array.of(0, 5),
    y: Uint8Array.of(1, 2),
    offsets: Uint32Array.of(0, 2),
    meanFill: Float32Array.of(0.5),
    lineStarts: Uint32Array.of(0, 2),
    lineStation: Uint16Array.of(0),
    maxGap: 15,
    xMin: 0,
    xMax: 5,
    yMax: 2,
  };
}

/** Only the label matters to the mock; the rest satisfies the type. */
function fakeLocale(label: string): ChartLocale {
  return {
    time: {
      dateTime: '%c',
      date: '%x',
      time: '%X',
      periods: ['AM', 'PM'],
      days: ['', '', '', '', '', '', ''],
      shortDays: ['', '', '', '', '', '', ''],
      months: ['', '', '', '', '', '', '', '', '', '', '', ''],
      shortMonths: ['', '', '', '', '', '', '', '', '', '', '', ''],
    },
    formatNumber: String,
    label,
    station: String,
    bikes: String,
    capped: () => '',
  };
}

function harness(data: Ref<StationSeries | null>) {
  const renderer = ref<'svg' | 'canvas' | 'webgl'>('webgl');
  const decimation = ref<'none' | 'minmax' | 'lttb'>('none');
  const locale = shallowRef(fakeLocale('ca'));
  const extent = shallowRef<readonly [number, number] | undefined>(undefined);
  const keepView = ref(false);
  const component = defineComponent({
    setup() {
      const host = ref<HTMLElement | null>(null);
      useTimeSeriesChart(host, {
        series: data,
        renderer,
        decimation,
        colorScale: ref(() => '#000'),
        locale,
        extent,
        keepView,
      });
      return () => h('div', { ref: host });
    },
  });
  return { wrapper: mount(component), renderer, decimation, locale, extent, keepView };
}

beforeEach(() => {
  calls.setData.length = 0;
  calls.dataOptions.length = 0;
  calls.setRenderer.length = 0;
  calls.setDecimation.length = 0;
  calls.setLocale.length = 0;
  calls.destroyed = 0;
});

describe('useTimeSeriesChart', () => {
  test('hands the chart raw data even when the parent made it deeply reactive', async () => {
    // The mistake this guards against: ref() deep-proxies the series object.
    const data = ref<StationSeries | null>(series());
    harness(data);
    expect(isProxy(data.value)).toBe(true);
    expect(calls.setData).toHaveLength(1);
    expect(isProxy(calls.setData[0])).toBe(false);

    data.value = series();
    await nextTick();
    expect(calls.setData).toHaveLength(2);
    expect(isProxy(calls.setData[1])).toBe(false);
  });

  test('shallow watching: mutating inside the series does not re-send it', async () => {
    const data = shallowRef<StationSeries | null>(series());
    harness(data);
    data.value?.y.fill(9);
    await nextTick();
    expect(calls.setData).toHaveLength(1);
  });

  test('settings flow to the controller imperatively', async () => {
    const { renderer, decimation, locale } = harness(shallowRef(series()));
    renderer.value = 'canvas';
    decimation.value = 'minmax';
    locale.value = fakeLocale('en');
    await nextTick();
    expect(calls.setRenderer).toEqual(['canvas']);
    expect(calls.setDecimation).toEqual(['minmax']);
    expect(calls.setLocale).toEqual(['en']);
  });

  test('passes the extent and keepView along with new data (T2.5b)', async () => {
    const data = shallowRef<StationSeries | null>(series());
    const { extent, keepView } = harness(data);
    expect(calls.dataOptions[0]).toEqual({ keepView: false });
    extent.value = [0, 100];
    keepView.value = true;
    data.value = series();
    await nextTick();
    expect(calls.dataOptions[1]).toEqual({ extent: [0, 100], keepView: true });
  });

  test('destroys the controller on unmount', () => {
    const { wrapper } = harness(shallowRef(series()));
    wrapper.unmount();
    expect(calls.destroyed).toBe(1);
  });
});

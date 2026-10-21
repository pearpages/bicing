import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, isProxy, nextTick, ref, shallowRef } from 'vue';
import { useHistogramChart } from './useHistogramChart';

// Records what the composable hands the controller; the real one is tested in @bicing/charts.
const calls = vi.hoisted(() => ({
  counts: [] as [unknown, unknown][],
  formats: [] as string[],
  setBrush: [] as unknown[],
  brushRange: null as readonly [number, number] | null,
  destroyed: 0,
}));

vi.mock('@bicing/charts', () => ({
  HistogramChart: class {
    setCounts(total: unknown, passing: unknown) {
      calls.counts.push([total, passing]);
    }
    setFormat(tick: (bin: number) => string) {
      calls.formats.push(tick(1));
    }
    setLabel = () => undefined;
    setBrush(range: readonly [number, number] | null) {
      calls.setBrush.push(range);
      calls.brushRange = range;
    }
    get brushRange() {
      return calls.brushRange;
    }
    onBrush = () => undefined;
    destroy() {
      calls.destroyed++;
    }
  },
}));

function harness() {
  const total = ref<Uint32Array | null>(Uint32Array.of(4, 8));
  const passing = shallowRef<Uint32Array | null>(null);
  const tick = shallowRef((bin: number) => `h${String(bin)}`);
  const brush = shallowRef<readonly [number, number] | null>(null);
  const component = defineComponent({
    setup() {
      const host = ref<HTMLElement | null>(null);
      useHistogramChart(host, { bins: 2, label: ref('Hours'), tick, total, passing, brush });
      return () => h('div', { ref: host });
    },
  });
  return { wrapper: mount(component), total, passing, tick, brush };
}

beforeEach(() => {
  calls.counts.length = 0;
  calls.formats.length = 0;
  calls.setBrush.length = 0;
  calls.brushRange = null;
  calls.destroyed = 0;
});

describe('useHistogramChart', () => {
  test('counts go in raw; with no filter yet, what passes is the total', async () => {
    const { passing } = harness();
    const [total, initialPassing] = calls.counts[0] ?? [];
    expect(isProxy(total)).toBe(false);
    expect(initialPassing).toBe(total);
    passing.value = Uint32Array.of(1, 2);
    await nextTick();
    expect(Array.from(calls.counts.at(-1)?.[1] as Uint32Array)).toEqual([1, 2]);
  });

  test('a new language reformats the axis without rebuilding the chart', async () => {
    const { tick } = harness();
    tick.value = (bin) => `${String(bin)} h`;
    await nextTick();
    expect(calls.formats).toEqual(['1 h']);
    expect(calls.destroyed).toBe(0);
  });

  test("the user's own brush echoed back isn't applied; clearing it is", async () => {
    const { brush } = harness();
    calls.setBrush.length = 0;
    calls.brushRange = [0, 1];
    brush.value = [0, 1];
    await nextTick();
    expect(calls.setBrush).toEqual([]);
    brush.value = null;
    await nextTick();
    expect(calls.setBrush).toEqual([null]);
  });

  test('destroys the chart on unmount', () => {
    harness().wrapper.unmount();
    expect(calls.destroyed).toBe(1);
  });
});

import type { StationTable } from '@bicing/core';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, isProxy, nextTick, ref, shallowRef, type Ref } from 'vue';
import { useStationMap } from './useStationMap';

// The real map needs WebGL. This records what the composable hands it.
const calls = vi.hoisted(() => ({
  stations: [] as unknown[],
  values: [] as unknown[],
  labels: [] as string[],
  refreshes: 0,
  destroyed: 0,
}));

vi.mock('@bicing/charts', () => ({
  createPointRenderer: () => ({}),
  StationMap: class {
    setStations(stations: unknown) {
      calls.stations.push(stations);
    }
    setValues(values: unknown) {
      calls.values.push(values);
    }
    setColorScale = () => undefined;
    setLabel(label: string) {
      calls.labels.push(label);
    }
    refreshTooltip() {
      calls.refreshes++;
    }
    onHover = () => undefined;
    destroy() {
      calls.destroyed++;
    }
  },
}));

const STATIONS: StationTable = {
  length: 1,
  ids: ['1'],
  names: ['A'],
  lat: Float32Array.of(41.4),
  lon: Float32Array.of(2.1),
  capacity: Uint8Array.of(20),
};

function harness(stations: Ref<StationTable | null>) {
  const values = shallowRef<Float32Array | null>(Float32Array.of(0.5));
  const label = ref('Estacions');
  const describe = shallowRef((station: number) => [`station ${String(station)}`]);
  const component = defineComponent({
    setup() {
      const host = ref<HTMLElement | null>(null);
      useStationMap(host, { stations, values, colorScale: ref(() => '#000'), label, describe });
      return () => h('div', { ref: host });
    },
  });
  return { wrapper: mount(component), values, label, describe };
}

beforeEach(() => {
  calls.stations.length = 0;
  calls.values.length = 0;
  calls.labels.length = 0;
  calls.refreshes = 0;
  calls.destroyed = 0;
});

describe('useStationMap', () => {
  test('hands the map raw data even when the parent made it deeply reactive', () => {
    harness(ref<StationTable | null>(STATIONS));
    expect(calls.stations).toHaveLength(1);
    expect(isProxy(calls.stations[0])).toBe(false);
    expect(calls.values[0]).toBeInstanceOf(Float32Array);
  });

  test('new values, label and wording flow to the map imperatively', async () => {
    const { values, label, describe } = harness(shallowRef<StationTable | null>(STATIONS));
    values.value = Float32Array.of(0.1);
    label.value = 'Stations';
    describe.value = (station) => [`estació ${String(station)}`];
    await nextTick();
    expect(calls.values).toHaveLength(2);
    expect(calls.labels).toEqual(['Stations']);
    expect(calls.refreshes).toBe(1);
  });

  test('destroys the map on unmount', () => {
    const { wrapper } = harness(shallowRef<StationTable | null>(STATIONS));
    wrapper.unmount();
    expect(calls.destroyed).toBe(1);
  });
});

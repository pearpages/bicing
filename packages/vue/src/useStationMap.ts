import { createPointRenderer, StationMap } from '@bicing/charts';
import type { StationTable } from '@bicing/core';
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

export interface UseStationMapOptions {
  readonly stations: Readonly<Ref<StationTable | null>>;
  /** Fill per station in [0, 1], NaN for no data. */
  readonly values: Readonly<Ref<Float32Array | null>>;
  readonly colorScale: Readonly<Ref<(t: number) => string>>;
  readonly label: Readonly<Ref<string>>;
  /** Rebuilt by the app when the moment or the language changes; the tooltip follows. */
  readonly describe: Readonly<Ref<(station: number) => readonly string[]>>;
  /** One flag per station, 1 = filtered out (ADR 0015). */
  readonly dimmedStations?: Readonly<Ref<Uint8Array | null | undefined>>;
  readonly onHover?: (station: number | null) => void;
  /** A click on a station, or null on empty map. */
  readonly onClick?: (station: number | null) => void;
}

/**
 * Binds a StationMap to a host element for the component's lifetime, like useTimeSeriesChart
 * (ADR 0007): the controller is markRaw'ed, data goes in toRaw'ed, and watches are shallow.
 */
export function useStationMap(
  host: Readonly<Ref<HTMLElement | null>>,
  options: UseStationMapOptions,
): ShallowRef<StationMap | null> {
  const map = shallowRef<StationMap | null>(null);

  onMounted(() => {
    const element = host.value;
    if (!element) return;
    const instance = markRaw(
      new StationMap(element, {
        renderer: createPointRenderer(),
        label: options.label.value,
        describe: (station) => options.describe.value(station),
      }),
    );
    if (options.onHover) instance.onHover(options.onHover);
    if (options.onClick) instance.onClick(options.onClick);
    const dimmed = options.dimmedStations?.value;
    if (dimmed) instance.setDimmedStations(toRaw(dimmed));
    instance.setColorScale(options.colorScale.value);
    const stations = options.stations.value;
    if (stations) instance.setStations(toRaw(stations));
    const values = options.values.value;
    if (values) instance.setValues(toRaw(values));
    map.value = instance;
  });

  watch(options.stations, (stations) => {
    if (stations) map.value?.setStations(toRaw(stations));
  });
  watch(options.values, (values) => {
    if (values) map.value?.setValues(toRaw(values));
  });
  watch(options.colorScale, (colorScale) => map.value?.setColorScale(colorScale));
  watch(options.label, (label) => map.value?.setLabel(label));
  watch(options.describe, () => map.value?.refreshTooltip());
  if (options.dimmedStations) {
    watch(options.dimmedStations, (dimmed) =>
      map.value?.setDimmedStations(dimmed ? toRaw(dimmed) : null),
    );
  }

  onBeforeUnmount(() => {
    map.value?.destroy();
    map.value = null;
  });

  return map;
}

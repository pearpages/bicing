import { interpolateRgbBasis } from 'd3-interpolate';
import { onBeforeUnmount, ref, type Ref } from 'vue';

export type ColorScheme = 'light' | 'dark';

/**
 * Mean station occupancy is a magnitude, so it gets one hue, light to dark (a sequential ramp).
 * These are the blue steps of the dataviz reference palette. On light surfaces the ramp starts at
 * step 250, so the emptiest stations still clear 2:1 against the background. On dark surfaces it
 * runs 600 → 100: low values recede toward the surface, and busy stations stand out.
 */
const RAMPS: Record<ColorScheme, readonly string[]> = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
};

export function rampStops(scheme: ColorScheme): readonly string[] {
  return RAMPS[scheme];
}

/** d3 emits "rgb(r, g, b)" strings, which every renderer (including the WebGL ramp texture) understands. */
export function occupancyScale(scheme: ColorScheme): (t: number) => string {
  return interpolateRgbBasis([...RAMPS[scheme]]);
}

/** Follows the OS setting live; the theme is chosen, not flipped (both ramps are defined above). */
export function useColorScheme(): Readonly<Ref<ColorScheme>> {
  const query = matchMedia('(prefers-color-scheme: dark)');
  const scheme = ref<ColorScheme>(query.matches ? 'dark' : 'light');
  const onChange = (event: MediaQueryListEvent) => {
    scheme.value = event.matches ? 'dark' : 'light';
  };
  query.addEventListener('change', onChange);
  onBeforeUnmount(() => {
    query.removeEventListener('change', onChange);
  });
  return scheme;
}

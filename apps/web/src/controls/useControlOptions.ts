import type { Decimation, RendererKind } from '@bicing/charts';
import { computed } from 'vue';
import type { Option } from '../components/SegmentedControl.vue';
import { SIZE_TIERS } from '../data/sizes';
import type { DataSource } from '../data/source';
import { LANGUAGE_NAMES, LOCALES, type Locale } from '../i18n/locales';
import { useI18n } from '../i18n/useI18n';

const DECIMATIONS: readonly Decimation[] = ['none', 'minmax', 'lttb'];

/** The header controls' options, labelled in the active language (P27). */
export function useControlOptions() {
  const { t } = useI18n();
  return {
    // Renderer names are product names, the same in every language; only the SVG hint is translated.
    renderer: computed<readonly Option<RendererKind>[]>(() => [
      { value: 'svg', label: 'SVG', title: t.value.controls.svgTitle },
      { value: 'canvas', label: 'Canvas 2D' },
      { value: 'webgl', label: 'WebGL2' },
    ]),
    decimation: computed<readonly Option<Decimation>[]>(() =>
      DECIMATIONS.map((value) => ({ value, label: t.value.controls.decimationOptions[value] })),
    ),
    size: computed<readonly Option<number>[]>(() =>
      SIZE_TIERS.map((tier) => ({
        value: tier.rows,
        label: tier.label,
        muted: tier.stress === true,
        ...(tier.stress ? { title: t.value.controls.stressTitle } : {}),
      })),
    ),
    source: computed<readonly Option<DataSource['kind']>[]>(() =>
      (['synthetic', 'real'] as const).map((value) => ({
        value,
        label: t.value.controls.sourceOptions[value],
      })),
    ),
    // Each language is named in itself, and marked so screen readers say it that way.
    language: LOCALES.map((value): Option<Locale> => ({
      value,
      label: LANGUAGE_NAMES[value],
      lang: value,
    })),
  };
}

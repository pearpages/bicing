import { fetchManifest, type MonthEntry } from '@bicing/data';
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { DATA_BASE_URL } from './source';

export interface RealMonths {
  /** The published months, oldest first; `null` until the manifest arrives. */
  readonly months: ShallowRef<readonly MonthEntry[] | null>;
  /** Set when there's no manifest at the data URL (nothing built or deployed yet). */
  readonly unavailable: Ref<boolean>;
  /** Fetches the manifest once. Resolves to the latest month, or `null` when there is none. */
  latest(): Promise<string | null>;
}

/** The month picker's options, from `manifest.json` (T2.3, ADR 0013). Fetched only when asked. */
export function useRealMonths(): RealMonths {
  const months = shallowRef<readonly MonthEntry[] | null>(null);
  const unavailable = ref(false);
  let request: Promise<readonly MonthEntry[] | null> | null = null;

  async function latest(): Promise<string | null> {
    request ??= fetchManifest(DATA_BASE_URL).then(
      (found) => (months.value = found),
      () => {
        unavailable.value = true;
        // A later attempt may succeed, e.g. after `pnpm prepare-data --build`.
        request = null;
        return null;
      },
    );
    return (await request)?.at(-1)?.month ?? null;
  }

  return { months, unavailable, latest };
}

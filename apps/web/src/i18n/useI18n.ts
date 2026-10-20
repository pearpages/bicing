import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import { resolveLocale, type Locale } from './locales';
import { ca, type Messages } from './messages.ca';
import { en } from './messages.en';

const STORAGE_KEY = 'bicing-pulse:lang';
const DICTIONARIES: Record<Locale, Messages> = { ca, en };

// Storage can throw (private mode, blocked site data); the language then just isn't remembered.
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not remembered; the current page still switches.
  }
}

function applyToDocument(locale: Locale, messages: Messages): void {
  document.documentElement.lang = locale;
  document.title = messages.meta.title;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', messages.meta.description);
}

// One language for the whole page, so the state is shared by every caller.
const locale = ref<Locale>(resolveLocale(location.search, readStored()));
const t = computed(() => DICTIONARIES[locale.value]);

watch(
  locale,
  (next) => {
    applyToDocument(next, DICTIONARIES[next]);
  },
  { immediate: true },
);

function setLocale(next: Locale): void {
  locale.value = next;
  writeStored(next);
  // A shared ?lang= link would otherwise override the visitor's choice on the next reload.
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', next);
    history.replaceState(history.state, '', url);
  }
}

export function useI18n(): {
  locale: Readonly<Ref<Locale>>;
  t: ComputedRef<Messages>;
  setLocale: (next: Locale) => void;
} {
  return { locale: readonly(locale), t, setLocale };
}

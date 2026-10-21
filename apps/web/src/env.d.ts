interface ImportMetaEnv {
  /** Where the published Parquet lives (ADR 0013). Defaults to `/data/`, served locally by serve-data.ts. */
  readonly VITE_DATA_BASE_URL?: string;
}

// vue-tsc resolves real SFC types; this shim is for typescript-eslint, which only speaks plain TS.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

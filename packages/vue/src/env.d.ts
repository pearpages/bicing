// vue-tsc resolves real SFC types; this shim is for typescript-eslint, which only speaks plain TS.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

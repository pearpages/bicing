// Vite turns `?url` imports into the emitted asset's URL; this declares that for tsc.
declare module '*?url' {
  const url: string;
  export default url;
}

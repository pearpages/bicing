export interface MachineInfo {
  readonly userAgent: string;
  readonly platform: string;
  readonly cores: number | null;
  readonly deviceMemoryGb: number | null;
  readonly gpu: string;
  readonly devicePixelRatio: number;
  readonly viewport: string;
}

/** Benchmark numbers are meaningless without the machine they came from (P5). */
export function machineInfo(): MachineInfo {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string };
  };
  return {
    userAgent: navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    cores: navigator.hardwareConcurrency || null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    gpu: gpuName(),
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${String(window.innerWidth)}×${String(window.innerHeight)}`,
  };
}

function gpuName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'WebGL2 unavailable';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return typeof name === 'string' ? name : 'unknown';
}

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { MonthlyResource } from './ckan';

/** What was downloaded, so a re-run can tell a cached archive from a changed one. */
export interface CacheEntry {
  readonly resourceId: string;
  readonly lastModified: string | null;
  readonly bytes: number;
  readonly downloadedAt: string;
}

export interface Manifest {
  readonly format: 'bicing-pulse/raw-cache@1';
  readonly files: Readonly<Record<string, CacheEntry>>;
}

export interface SyncOptions {
  /** The cache directory, e.g. `data/raw`. Nothing is written outside it. */
  readonly dir: string;
  readonly concurrency?: number;
  /** Re-checked on the final URL after redirects. */
  readonly allowUrl: (url: string) => boolean;
  readonly log?: (line: string) => void;
}

export interface SyncReport {
  readonly downloaded: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly path: string; readonly reason: string }[];
}

const MANIFEST = 'manifest.json';
/** A cap for archives CKAN gives no size for. The largest monthly archive is ~25 MB. */
const MAX_UNKNOWN_BYTES = 500_000_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/** Relative to the cache dir. Built from the parsed dataset and month, never from a response's name. */
export function cachePath(resource: MonthlyResource): string {
  return `${resource.dataset}/${resource.month}.7z`;
}

export async function readManifest(dir: string): Promise<Manifest> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'format' in parsed &&
      parsed.format === 'bicing-pulse/raw-cache@1' &&
      'files' in parsed &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
    )
      return parsed as Manifest;
  } catch {
    // Missing or unreadable: start from an empty cache, which only costs a re-download.
  }
  return { format: 'bicing-pulse/raw-cache@1', files: {} };
}

/**
 * Cached means: the manifest saw this exact resource version, and the file on disk has the bytes it
 * recorded. A size mismatch catches truncated files; a new `last_modified` catches re-uploads.
 */
export function isCached(
  entry: CacheEntry | undefined,
  resource: MonthlyResource,
  bytesOnDisk: number | null,
): boolean {
  return (
    entry?.resourceId === resource.id &&
    entry.lastModified === resource.lastModified &&
    bytesOnDisk === entry.bytes &&
    (resource.size === null || resource.size === entry.bytes)
  );
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** Streams to `<file>.part` and renames on success, so a crash never leaves a file that looks complete. */
async function download(
  resource: MonthlyResource,
  target: string,
  allowUrl: (url: string) => boolean,
): Promise<number> {
  const response = await fetch(resource.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  if (!allowUrl(response.url)) throw new Error(`redirected to a disallowed URL: ${response.url}`);
  if (!response.body) throw new Error('empty response');

  const limit = resource.size ?? MAX_UNKNOWN_BYTES;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(
        bytes > limit ? new Error(`more than the expected ${String(limit)} bytes`) : null,
        chunk,
      );
    },
  });
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await pipeline(
      // undici's web stream type and Node's are the same object at runtime.
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      counter,
      createWriteStream(part),
    );
    if (resource.size !== null && bytes !== resource.size)
      throw new Error(`got ${String(bytes)} bytes, expected ${String(resource.size)}`);
    await rename(part, target);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
  return bytes;
}

/** Downloads every resource that isn't cached yet. Running it twice downloads nothing the second time. */
export async function syncResources(
  resources: readonly MonthlyResource[],
  options: SyncOptions,
): Promise<SyncReport> {
  const log = options.log ?? (() => undefined);
  const files: Record<string, CacheEntry> = { ...(await readManifest(options.dir)).files };
  const downloaded: string[] = [];
  const skipped: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  // Written after every download, one write at a time, so an interrupted run keeps its progress.
  let saving = Promise.resolve();
  const save = () => {
    saving = saving.then(() =>
      writeFile(
        join(options.dir, MANIFEST),
        `${JSON.stringify({ format: 'bicing-pulse/raw-cache@1', files }, null, 2)}\n`,
      ),
    );
    return saving;
  };

  const queue = [...resources];
  const worker = async () => {
    for (let resource = queue.shift(); resource; resource = queue.shift()) {
      const path = cachePath(resource);
      const target = join(options.dir, path);
      if (isCached(files[path], resource, await fileSize(target))) {
        skipped.push(path);
        continue;
      }
      try {
        const bytes = await download(resource, target, options.allowUrl);
        files[path] = {
          resourceId: resource.id,
          lastModified: resource.lastModified,
          bytes,
          downloadedAt: new Date().toISOString(),
        };
        await save();
        downloaded.push(path);
        log(`downloaded ${path} (${(bytes / 1e6).toFixed(1)} MB)`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failed.push({ path, reason });
        log(`failed ${path}: ${reason}`);
      }
    }
  };

  await mkdir(options.dir, { recursive: true });
  const workers = Math.max(1, Math.min(options.concurrency ?? 3, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));
  await saving;
  // Workers finish in any order; report in path order so runs are comparable.
  const byPath = (a: string, b: string) => a.localeCompare(b);
  return {
    downloaded: downloaded.sort(byPath),
    skipped: skipped.sort(byPath),
    failed: failed.sort((a, b) => byPath(a.path, b.path)),
  };
}

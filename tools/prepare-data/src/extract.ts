import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import SevenZip from '7z-wasm';

/**
 * 7-Zip compiled to WASM extracts the monthly archives (ADR 0012). Only the archive's folder and the
 * scratch folder are mounted, so a hostile archive can't reach the rest of the disk, and the entry
 * list is checked before anything is extracted (security.md).
 */

export interface ArchiveEntry {
  readonly path: string;
  readonly size: number | null;
  readonly isDirectory: boolean;
}

/** A plain file name: no folders, no `..`, nothing absolute, and a CSV. */
export function isSafeCsvName(name: string): boolean {
  // No separators or drive colons means no folders and no absolute paths; no leading dot rules out `..`.
  return /^[^/\\:]+\.csv$/i.test(name) && !name.startsWith('.');
}

/** Parses `7z l -slt -ba` output: blank-line-separated blocks of `Key = value` lines. */
export function parseListing(lines: readonly string[]): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let current: { path?: string; size?: number; attributes?: string; folder?: string } = {};
  const flush = () => {
    if (current.path !== undefined)
      entries.push({
        path: current.path,
        size: current.size ?? null,
        isDirectory: current.folder === '+' || (current.attributes ?? '').startsWith('D'),
      });
    current = {};
  };
  for (const line of lines) {
    const match = /^(\w[\w ]*?) = (.*)$/.exec(line);
    if (!match) {
      if (line.trim() === '') flush();
      continue;
    }
    const [, key, value = ''] = match;
    if (key === 'Path') {
      flush();
      current.path = value;
    } else if (key === 'Size') current.size = Number(value);
    else if (key === 'Attributes') current.attributes = value;
    else if (key === 'Folder') current.folder = value;
  }
  flush();
  return entries;
}

type SevenZipModule = Awaited<ReturnType<typeof SevenZip>>;

async function sevenZip(archiveDir: string, outDir: string) {
  const output: string[] = [];
  let exitCode = 0;
  const module: SevenZipModule = await SevenZip({
    print: (line) => output.push(line),
    printErr: (line) => output.push(line),
    quit: (code) => {
      exitCode = code;
    },
  });
  module.FS.mkdir('/archive');
  module.FS.mount(module.NODEFS, { root: archiveDir }, '/archive');
  module.FS.mkdir('/out');
  module.FS.mount(module.NODEFS, { root: outDir }, '/out');

  return (args: readonly string[]): string[] => {
    output.length = 0;
    exitCode = 0;
    try {
      module.callMain([...args]);
    } catch (error) {
      // Emscripten reports a non-zero exit by throwing an ExitStatus.
      const status = (error as { status?: unknown }).status;
      exitCode = typeof status === 'number' ? status : 1;
    }
    if (exitCode !== 0)
      throw new Error(
        `7-Zip exited with ${String(exitCode)}: ${output.slice(-3).join(' ').trim()}`,
      );
    return [...output];
  };
}

/**
 * Extracts the archive's single CSV into `scratchDir` and returns its path. Rejects an archive with
 * any other content before extracting anything.
 */
export async function extractSingleCsv(archive: string, scratchDir: string): Promise<string> {
  const archivePath = resolve(archive);
  const out = resolve(scratchDir);
  await mkdir(out, { recursive: true });
  const run = await sevenZip(dirname(archivePath), out);
  const inArchive = `/archive/${basename(archivePath)}`;

  const entries = parseListing(run(['l', '-slt', '-ba', '-bsp0', inArchive]));
  const [entry, ...rest] = entries;
  if (!entry || rest.length > 0)
    throw new Error(`${basename(archive)}: expected one entry, found ${String(entries.length)}`);
  if (entry.isDirectory || !isSafeCsvName(entry.path))
    throw new Error(`${basename(archive)}: refusing entry "${entry.path}"`);

  run(['x', inArchive, '-o/out', '-y', '-bsp0', '-bso0', entry.path]);
  return join(out, entry.path);
}

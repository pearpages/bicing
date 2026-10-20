import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { extractSingleCsv, isSafeCsvName, parseListing } from './extract';
import { createArchive } from './fixture';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-extract-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extractSingleCsv', () => {
  test('extracts the one CSV into the scratch folder', async () => {
    const archive = await createArchive(join(dir, 'raw'), 'month.7z', { 'data.csv': 'a,b\n1,2\n' });
    const out = await extractSingleCsv(archive, join(dir, 'scratch'));
    expect(out).toBe(join(dir, 'scratch', 'data.csv'));
    expect(await readFile(out, 'utf8')).toBe('a,b\n1,2\n');
  });

  test('rejects an archive with more than one entry before extracting anything', async () => {
    const archive = await createArchive(join(dir, 'raw'), 'two.7z', {
      'a.csv': 'x',
      'b.csv': 'y',
    });
    await expect(extractSingleCsv(archive, join(dir, 'scratch'))).rejects.toThrow(
      /expected one entry, found 2/,
    );
    expect(await readdir(join(dir, 'scratch'))).toEqual([]);
  });

  test('rejects an entry that is not a plain CSV name', async () => {
    const archive = await createArchive(join(dir, 'raw'), 'odd.7z', { 'notes.txt': 'x' });
    await expect(extractSingleCsv(archive, join(dir, 'scratch'))).rejects.toThrow(
      /refusing entry "notes.txt"/,
    );
  });
});

describe('entry checks', () => {
  test('isSafeCsvName accepts plain CSV names only', () => {
    expect(isSafeCsvName('2026_09_Setembre_BicingNou_ESTACIONS.csv')).toBe(true);
    expect(isSafeCsvName('2019_03_Març_BICING2_STAT.csv')).toBe(true);
    for (const name of [
      '../x.csv',
      '/etc/x.csv',
      'a/b.csv',
      'a\\b.csv',
      'C:x.csv',
      '.csv',
      '.hidden.csv',
      'x.txt',
    ])
      expect(isSafeCsvName(name), name).toBe(false);
  });

  test('parseListing reads 7z technical listings', () => {
    const entries = parseListing([
      'Path = a.csv',
      'Size = 290689605',
      'Attributes = A -rwxrwx---',
      '',
      'Path = folder',
      'Folder = +',
      'Attributes = D drwxr-xr-x',
      '',
    ]);
    expect(entries).toEqual([
      { path: 'a.csv', size: 290689605, isDirectory: false },
      { path: 'folder', size: null, isDirectory: true },
    ]);
  });
});

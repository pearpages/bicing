import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { MonthlyResource } from './ckan';
import { isCached, readManifest, syncResources } from './download';

/** A local stand-in for the CKAN file host that counts what it serves. */
let server: Server;
let base: string;
let requests: string[];
const bodies = new Map<string, Buffer>();

beforeEach(async () => {
  requests = [];
  bodies.clear();
  server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push(path);
    const data = bodies.get(path);
    if (path === '/redirect') {
      res.writeHead(302, { location: 'https://elsewhere.example/a.7z' }).end();
      return;
    }
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-length': String(data.length) }).end(data);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepare-data-'));
});

afterEach(async () => {
  await new Promise((done) => server.close(done));
  await rm(dir, { recursive: true, force: true });
});

function resource(month: string, bytes: number, overrides: Partial<MonthlyResource> = {}) {
  const path = `/${month}.7z`;
  bodies.set(path, Buffer.alloc(bytes, month.charCodeAt(6)));
  const r: MonthlyResource = {
    dataset: 'estat-estacions-bicing',
    id: `res-${month}`,
    name: `${month.replace('-', '_')}_X_BicingNou_ESTACIONS.7z`,
    url: `${base}${path}`,
    month,
    size: bytes,
    lastModified: '2026-10-01T00:00:00',
    ...overrides,
  };
  return r;
}

const allowLocal = (url: string) => url.startsWith(base);

describe('syncResources', () => {
  test('a second run downloads nothing', async () => {
    const resources = [resource('2024-01', 1_000), resource('2024-02', 2_000)];
    const first = await syncResources(resources, { dir, allowUrl: allowLocal });
    expect(first.downloaded).toHaveLength(2);
    expect(requests).toHaveLength(2);

    const second = await syncResources(resources, { dir, allowUrl: allowLocal });
    expect(second.downloaded).toEqual([]);
    expect(second.skipped).toEqual([
      'estat-estacions-bicing/2024-01.7z',
      'estat-estacions-bicing/2024-02.7z',
    ]);
    expect(requests).toHaveLength(2);

    const bytes = await readFile(join(dir, 'estat-estacions-bicing/2024-02.7z'));
    expect(bytes.length).toBe(2_000);
    const manifest = await readManifest(dir);
    expect(manifest.files['estat-estacions-bicing/2024-01.7z']).toMatchObject({
      resourceId: 'res-2024-01',
      bytes: 1_000,
    });
  });

  test('downloads again when CKAN re-uploads the archive or the file is truncated', async () => {
    const original = resource('2024-01', 1_000);
    await syncResources([original], { dir, allowUrl: allowLocal });

    const reuploaded = { ...original, lastModified: '2026-10-15T08:31:46' };
    expect(
      (await syncResources([reuploaded], { dir, allowUrl: allowLocal })).downloaded,
    ).toHaveLength(1);

    await writeFile(join(dir, 'estat-estacions-bicing/2024-01.7z'), 'truncated');
    expect(
      (await syncResources([reuploaded], { dir, allowUrl: allowLocal })).downloaded,
    ).toHaveLength(1);
    expect(requests).toHaveLength(3);
  });

  test('a short or oversized body fails and leaves no file behind', async () => {
    const lying = resource('2024-01', 1_000, { size: 1_500 });
    const tooBig = resource('2024-02', 2_000, { size: 1_000 });
    const report = await syncResources([lying, tooBig], { dir, allowUrl: allowLocal });
    expect(report.failed.map((f) => f.path)).toEqual([
      'estat-estacions-bicing/2024-01.7z',
      'estat-estacions-bicing/2024-02.7z',
    ]);
    expect(await readdir(join(dir, 'estat-estacions-bicing'))).toEqual([]);
  });

  test('refuses a redirect to a disallowed host and reports HTTP errors', async () => {
    const redirected = { ...resource('2024-01', 10), url: `${base}/redirect` };
    const missing = { ...resource('2024-02', 10), url: `${base}/missing.7z` };
    const report = await syncResources([redirected, missing], {
      dir,
      allowUrl: allowLocal,
      concurrency: 1,
    });
    expect(report.downloaded).toEqual([]);
    expect(report.failed.map((f) => f.reason)).toEqual([
      expect.stringMatching(/fetch failed|disallowed/),
      'HTTP 404',
    ]);
  });
});

describe('isCached', () => {
  const r = {
    dataset: 'estat-estacions-bicing',
    id: 'a',
    name: 'n',
    url: 'u',
    month: '2024-01',
    size: 10,
    lastModified: null,
  } as const;
  const entry = { resourceId: 'a', lastModified: null, bytes: 10, downloadedAt: '' };

  test('needs a matching entry and the recorded bytes on disk', () => {
    expect(isCached(entry, r, 10)).toBe(true);
    expect(isCached(undefined, r, 10)).toBe(false);
    expect(isCached(entry, r, null)).toBe(false);
    expect(isCached(entry, r, 9)).toBe(false);
    expect(isCached({ ...entry, resourceId: 'b' }, r, 10)).toBe(false);
    expect(isCached(entry, { ...r, size: 11 }, 10)).toBe(false);
    expect(isCached(entry, { ...r, size: null }, 10)).toBe(true);
  });
});

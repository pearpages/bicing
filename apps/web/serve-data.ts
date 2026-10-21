import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Serves `data/parquet` (written by `pnpm prepare-data --build`) at `/data/` in `vite` and
 * `vite preview`, with range requests, so local runs load real data the way production will from
 * its external host (ADR 0013). The production build doesn't include the files.
 */

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.parquet': 'application/vnd.apache.parquet',
};

/** Only plain file names in the folder: no `..`, no subfolders. */
const FILE = /^\/data\/([\w-]+(\.parquet|\.json))$/;

async function serve(dir: string, req: IncomingMessage, res: ServerResponse, next: () => void) {
  const match = FILE.exec(req.url?.split('?')[0] ?? '');
  if (!match) {
    next();
    return;
  }
  const [, name = '', extension = ''] = match;
  const path = join(dir, name);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', TYPES[extension] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!range) {
    res.setHeader('Content-Length', String(size));
    createReadStream(path).pipe(res);
    return;
  }
  // `bytes=a-b`, `bytes=a-` and the suffix form `bytes=-n`.
  const [, from = '', to = ''] = range;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start > end || start >= size) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${String(size)}`);
    res.end();
    return;
  }
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${String(start)}-${String(end)}/${String(size)}`);
  res.setHeader('Content-Length', String(end - start + 1));
  createReadStream(path, { start, end }).pipe(res);
}

export function serveData(root: string): Plugin {
  const dir = resolve(root, 'data/parquet');
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void serve(dir, req, res, next);
  };
  return {
    name: 'bicing-serve-data',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

/// <reference lib="webworker" />
import { decodeInBrowser } from './decode-browser';
import { createHandler } from './handler';
import type { WorkerRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const handleRequest = createHandler({ decode: decodeInBrowser, fetch: (input) => fetch(input) });

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data).then(({ response, transfer }) => {
    self.postMessage(response, { transfer });
  });
});

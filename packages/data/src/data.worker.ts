/// <reference lib="webworker" />
import { handleRequest } from './handler';
import type { WorkerRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { response, transfer } = handleRequest(event.data);
  self.postMessage(response, { transfer });
});

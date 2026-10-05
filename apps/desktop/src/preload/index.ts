/**
 * The only surface the renderer gets. Node stays out of the renderer entirely,
 * which also keeps the renderer honest for a future browser build: everything
 * it needs arrives through this interface, so a web version swaps the
 * implementation rather than the UI.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  DesktopApi,
  LogSummary,
  ParseProgress,
  RunAnalysis,
  UpdateState,
  WorkerEvent,
} from '../shared.js';

type Handler<T> = (value: T) => void;

const handlers = {
  log: new Set<Handler<LogSummary>>(),
  progress: new Set<Handler<ParseProgress>>(),
  analysis: new Set<Handler<RunAnalysis>>(),
  done: new Set<Handler<number>>(),
  failed: new Set<Handler<string>>(),
  update: new Set<Handler<UpdateState>>(),
};

ipcRenderer.on('mplus:event', (_event: IpcRendererEvent, event: WorkerEvent) => {
  switch (event.type) {
    case 'log':
      for (const handler of handlers.log) handler(event.summary);
      return;
    case 'progress':
      for (const handler of handlers.progress) handler(event.progress);
      return;
    case 'analysis':
      for (const handler of handlers.analysis) handler(event.analysis);
      return;
    case 'done':
      for (const handler of handlers.done) handler(event.runCount);
      return;
    case 'failed':
      for (const handler of handlers.failed) handler(event.message);
      return;
  }
});

ipcRenderer.on('mplus:update', (_event: IpcRendererEvent, state: UpdateState) => {
  for (const handler of handlers.update) handler(state);
});

function subscribe<T>(set: Set<Handler<T>>, handler: Handler<T>): () => void {
  set.add(handler);
  return () => set.delete(handler);
}

const api: DesktopApi = {
  pickLog: () => ipcRenderer.invoke('mplus:pickLog') as Promise<string | null>,
  watchLog: () => ipcRenderer.invoke('mplus:watchLog') as Promise<string | null>,
  open: (path, tail) => ipcRenderer.invoke('mplus:open', path, tail) as Promise<void>,
  resolveIcons: (spellIds) =>
    ipcRenderer.invoke('mplus:icons', spellIds) as Promise<Record<number, string>>,
  resolveNamedIcons: (names) =>
    ipcRenderer.invoke('mplus:namedIcons', names) as Promise<Record<string, string>>,
  onLog: (handler) => subscribe(handlers.log, handler),
  onProgress: (handler) => subscribe(handlers.progress, handler),
  onAnalysis: (handler) => subscribe(handlers.analysis, handler),
  onDone: (handler) => subscribe(handlers.done, handler),
  onFailed: (handler) => subscribe(handlers.failed, handler),
  updateState: () => ipcRenderer.invoke('mplus:updateState') as Promise<UpdateState>,
  checkForUpdate: () => ipcRenderer.invoke('mplus:checkForUpdate') as Promise<void>,
  downloadUpdate: () => ipcRenderer.invoke('mplus:downloadUpdate') as Promise<void>,
  installUpdate: () => ipcRenderer.invoke('mplus:installUpdate') as Promise<void>,
  setAutomaticUpdates: (on) => ipcRenderer.invoke('mplus:setAutomaticUpdates', on) as Promise<void>,
  openReleases: () => ipcRenderer.invoke('mplus:openReleases') as Promise<void>,
  onUpdateState: (handler) => subscribe(handlers.update, handler),
};

contextBridge.exposeInMainWorld('mplus', api);

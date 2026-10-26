/**
 * Sonivex Studio - preload bridge.
 * Exposes a minimal, typed API surface via contextBridge. No Node primitives leak.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface ModelPayload { fileName: string; filePath: string; data: Uint8Array; error?: undefined }
export type OpenResult = ModelPayload | { error: string } | null;

const api = {
  openModel: (): Promise<OpenResult> => ipcRenderer.invoke('dialog:openModel'),
  openAudio: (): Promise<OpenResult> => ipcRenderer.invoke('dialog:openAudio'),
  openProject: (): Promise<{ filePath: string; json: string } | { error: string } | null> =>
    ipcRenderer.invoke('dialog:openProject'),
  saveProjectAs: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveProject', suggestedName),
  writeProject: (filePath: string, json: string): Promise<{ ok?: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:writeProject', filePath, json),
  writeExport: (suggestedName: string, mime: string, dataB64: string): Promise<{ ok?: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('fs:writeExport', suggestedName, mime, dataB64),
  printToPDF: (html: string): Promise<{ data?: string; error?: string }> =>
    ipcRenderer.invoke('report:printToPDF', html),
  autosaveWrite: (json: string): Promise<{ ok?: boolean; error?: string }> =>
    ipcRenderer.invoke('autosave:write', json),
  autosaveRead: (): Promise<{ json: string | null; mtime?: number }> =>
    ipcRenderer.invoke('autosave:read'),
  autosaveClear: (): Promise<{ ok?: boolean }> => ipcRenderer.invoke('autosave:clear'),
  appInfo: (): Promise<{ version: string; platform: string; userData: string }> =>
    ipcRenderer.invoke('app:info'),
  showItemInFolder: (p: string): Promise<{ ok?: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:showItem', p),
  readModelPath: (p: string): Promise<OpenResult> => ipcRenderer.invoke('fs:readModelPath', p),
  readAudioPath: (p: string): Promise<OpenResult> => ipcRenderer.invoke('fs:readAudioPath', p),
};

export type SonivexBridge = typeof api;

contextBridge.exposeInMainWorld('sonivex', api);

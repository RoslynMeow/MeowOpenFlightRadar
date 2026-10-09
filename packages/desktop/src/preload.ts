import { contextBridge } from 'electron';

const arg = process.argv.find((a) => a.startsWith('--fr-api-base='));
const apiBase = arg ? arg.slice('--fr-api-base='.length) : '';

contextBridge.exposeInMainWorld('__FLIGHTRADAR__', { apiBase });

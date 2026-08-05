import type { AnalysisResult } from '../types';
import type { PersistenceContext } from './database';

export interface AnalysisProgress { percent: number; stage: string; processed?: number; total?: number; liveTotals?: { movements: number; automatic: number; unreconciled: number; missingIdtr: number }; liveMovementTypes?: Record<string, { total: number; reconciled: number; unreconciled: number; missingIdtr: number }> }

type WorkerMessage =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string };

export async function analyzeWorkbook(file: File, onProgress?: (progress: AnalysisProgress) => void, preparePersistence?: (fileHash:string)=>Promise<{context:PersistenceContext;duplicate:boolean}>): Promise<AnalysisResult> {
  onProgress?.({ percent: 1, stage: 'A transferir o ficheiro para o motor de análise' });
  const buffer = await file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buffer);
  const sourceFileHash = Array.from(new Uint8Array(hashBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const persistence=preparePersistence?await preparePersistence(sourceFileHash):null;
  if(persistence?.duplicate) throw new Error('Este ficheiro já foi importado. Os movimentos existentes foram mantidos sem duplicação.');

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'progress') onProgress?.(data.progress);
      if (data.type === 'result') { worker.terminate(); resolve({ ...data.result, sourceFileHash, sourceFilename: file.name }); }
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'O motor de análise foi interrompido pelo navegador.'));
    };
    worker.postMessage({ name: file.name, buffer, persistence: persistence?.context }, [buffer]);
  });
}

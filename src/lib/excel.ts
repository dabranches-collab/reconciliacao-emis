import type { AnalysisResult } from '../types';

export interface AnalysisProgress { percent: number; stage: string; processed?: number; total?: number; liveTotals?: { movements: number; automatic: number; unreconciled: number; missingIdtr: number } }

type WorkerMessage =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string };

export async function analyzeWorkbook(file: File, onProgress?: (progress: AnalysisProgress) => void): Promise<AnalysisResult> {
  onProgress?.({ percent: 1, stage: 'A transferir o ficheiro para o motor de análise' });
  const buffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'progress') onProgress?.(data.progress);
      if (data.type === 'result') { worker.terminate(); resolve(data.result); }
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'O motor de análise foi interrompido pelo navegador.'));
    };
    worker.postMessage({ name: file.name, buffer }, [buffer]);
  });
}

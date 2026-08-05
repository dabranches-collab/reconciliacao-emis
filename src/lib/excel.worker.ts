import type { AnalysisProgress } from './excel';
import { analyzeRawExtract } from './rawExtractParser';
import type { PersistenceContext } from './database';

self.onmessage = async ({ data }: MessageEvent<{ name: string; buffer: ArrayBuffer; persistence?: PersistenceContext }>) => {
  try {
    const result = await analyzeRawExtract(data.name, data.buffer, (progress: AnalysisProgress) => self.postMessage({ type: 'progress', progress }),data.persistence);
    self.postMessage({ type: 'result', result });
  } catch (cause) {
    self.postMessage({ type: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.' });
  }
};

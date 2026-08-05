import type { AnalysisProgress } from './excel';
import { analyzeRawExtract } from './rawExtractParser';

self.onmessage = async ({ data }: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try {
    const result = await analyzeRawExtract(data.name, data.buffer, (progress: AnalysisProgress) => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'result', result });
  } catch (cause) {
    self.postMessage({ type: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.' });
  }
};

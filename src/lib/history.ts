import type { AnalysisResult } from '../types';

export interface HistorySnapshot {
  id: string; periodStart: string; reportDate: string; filename: string; fileHash: string; version: number;
  current: boolean; uploadCount: number; firstUploadedAt: string; lastUploadedAt: string; uploadedBy: string;
  totals: AnalysisResult['totals']; movementTypes: NonNullable<AnalysisResult['movementTypes']>;
}

const KEY = 'reconciliation-realtime-raw-history-v2';
export const loadHistory = (): HistorySnapshot[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistorySnapshot[]; } catch { return []; }
};

export const saveHistorySnapshot = (result: AnalysisResult, uploadedBy: string): HistorySnapshot[] => {
  const history = loadHistory(); const now = new Date().toISOString();
  const sameDate = history.filter((item) => item.reportDate === result.reportDate);
  const hash = result.sourceFileHash ?? `${result.reportDate}:${result.totals.movements}:${result.totals.amount}`;
  const repeated = sameDate.find((item) => item.fileHash === hash);
  for (const item of sameDate) item.current = false;
  if (repeated) {
    repeated.current = true; repeated.uploadCount++; repeated.lastUploadedAt = now; repeated.uploadedBy = uploadedBy;
  } else {
    history.push({ id: crypto.randomUUID(), periodStart: result.periodStart ?? result.reportDate, reportDate: result.reportDate, filename: result.sourceFilename ?? 'ficheiro.xlsx', fileHash: hash,
      version: Math.max(0, ...sameDate.map((item) => item.version)) + 1, current: true, uploadCount: 1,
      firstUploadedAt: now, lastUploadedAt: now, uploadedBy, totals: result.totals, movementTypes: result.movementTypes ?? {} });
  }
  localStorage.setItem(KEY, JSON.stringify(history)); return history;
};

export const currentHistory = (history = loadHistory()) => history.filter((item) => item.current).sort((a, b) => a.reportDate.localeCompare(b.reportDate));

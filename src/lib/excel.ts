import type { AnalysisResult, Movement } from '../types';
import { normalizeIdtr, reconcile } from './reconciliation';

const text = (value: unknown) => String(value ?? '').trim();
const numeric = (value: unknown) => typeof value === 'number' ? value : Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
const isoDate = (value: unknown) => {
  const raw = text(value).replace(/\D/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : text(value);
};

export async function analyzeWorkbook(file: File): Promise<AnalysisResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', dense: true, cellDates: true });
  const realTime = workbook.Sheets['REAL TIME'];
  if (!realTime) throw new Error('A folha "REAL TIME" não foi encontrada.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(realTime, { header: 1, raw: true, defval: null });
  const reportDate = isoDate(rows[8]?.[2]);
  const movements: Movement[] = [];
  for (let index = 21; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const amount = numeric(row[3]);
    if (!Number.isFinite(amount) || (!row[1] && !row[6] && !row[7])) continue;
    const info = text(row[8]);
    movements.push({
      id: `${file.name}:${index + 1}`,
      row: index + 1,
      reportDate: isoDate(row[1]) || reportDate,
      account: text(row[2]),
      amount,
      currency: text(row[5]),
      operationNumber: text(row[6]),
      description: text(row[7]),
      complementaryInfo: info,
      idtr: normalizeIdtr(info),
      status: 'unreconciled',
    });
  }
  const balanceSheet = workbook.Sheets.BL;
  const balanceRows = balanceSheet ? XLSX.utils.sheet_to_json<unknown[]>(balanceSheet, { header: 1, raw: true, defval: null }) : [];
  const accountingBalance = Number.isFinite(numeric(balanceRows[4]?.[5])) ? numeric(balanceRows[4]?.[5]) : null;
  return reconcile(movements, accountingBalance, reportDate);
}

import type { AnalysisResult, Movement, ReconciliationStatus } from '../types';
import { normalizeIdtr } from './reconciliation';
import { classifyMovement, type MovementTypeKey } from './movementType';

export interface AnalysisProgress { percent: number; stage: string; processed?: number; total?: number; liveTotals?: { movements: number; automatic: number; unreconciled: number; missingIdtr: number }; liveMovementTypes?: Record<string, TypeTotals> }
type DenseCell = { v?: unknown } | undefined;
type DenseSheet = Array<Array<DenseCell>> & { '!ref'?: string };
type TypeTotals = { total: number; reconciled: number; unreconciled: number; missingIdtr: number };

const value = (sheet: DenseSheet, row: number, column: number) => sheet[row]?.[column]?.v;
const text = (input: unknown) => String(input ?? '').trim();
const numeric = (input: unknown) => typeof input === 'number' ? input : Number(String(input ?? '').replace(/\s/g, '').replace(',', '.'));
const isoDate = (input: unknown) => {
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  const raw = text(input).replace(/\D/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : text(input);
};
const rowCount = (sheet: DenseSheet) => sheet.length;
const makeTypes = () => Object.fromEntries((['pos', 'atm', 'transfer', 'commission', 'service', 'other'] as MovementTypeKey[]).map((key) => [key, { total: 0, reconciled: 0, unreconciled: 0, missingIdtr: 0 }])) as Record<MovementTypeKey, TypeTotals>;
const addType = (types: Record<MovementTypeKey, TypeTotals>, description: string, status: ReconciliationStatus) => {
  const target = types[classifyMovement(description)];
  target.total++;
  if (status === 'automatic') target.reconciled++;
  else if (status === 'missing_idtr') target.missingIdtr++;
  else target.unreconciled++;
};
const movementAt = (sheet: DenseSheet, row: number, fileName: string, prefix: string, reportDate = ''): Movement | null => {
  const amount = numeric(value(sheet, row, 3));
  if (!Number.isFinite(amount) || (!value(sheet, row, 1) && !value(sheet, row, 6) && !value(sheet, row, 7))) return null;
  const info = text(value(sheet, row, 8));
  return {
    id: `${fileName}:${prefix}${row + 1}`, row: row + 1,
    reportDate: isoDate(value(sheet, row, 1)) || reportDate,
    account: text(value(sheet, row, 2)), amount, currency: text(value(sheet, row, 5)),
    operationNumber: text(value(sheet, row, 6)), description: text(value(sheet, row, 7)),
    complementaryInfo: info, idtr: normalizeIdtr(value(sheet, row, 9)) ?? normalizeIdtr(info), status: 'unreconciled',
  };
};

export async function analyzeWorkbookBuffer(fileName: string, buffer: ArrayBuffer, onProgress: (progress: AnalysisProgress) => void): Promise<AnalysisResult> {
  const XLSX = await import('xlsx');
  const readSheet = (name: string) => XLSX.read(buffer, { type: 'array', dense: true, cellDates: true, sheets: [name] }).Sheets[name] as DenseSheet | undefined;
  const movementTypes = makeTypes();
  const samples: Movement[] = [];
  const sampleCounts: Record<ReconciliationStatus, number> = { automatic: 0, manual: 0, unreconciled: 0, missing_idtr: 0, data_error: 0 };
  const totals = { movements: 0, automatic: 0, manual: 0, unreconciled: 0, missingIdtr: 0, amountCents: 0 };
  const liveTotals = () => ({ movements: totals.movements, automatic: totals.automatic, unreconciled: totals.unreconciled, missingIdtr: totals.missingIdtr });
  const copyTypes = (identified?: Record<MovementTypeKey, number>) => Object.fromEntries(Object.entries(movementTypes).map(([key, item]) => [key, { ...item, total: item.total + (identified?.[key as MovementTypeKey] ?? 0) }]));
  const keep = (movement: Movement) => { if (sampleCounts[movement.status] < 300) { samples.push(movement); sampleCounts[movement.status]++; } };

  onProgress({ percent: 4, stage: 'A abrir o balancete' });
  let bl = readSheet('BL');
  const balanceValue = bl ? numeric(value(bl, 4, 5)) : NaN;
  const accountingBalance = Number.isFinite(balanceValue) ? balanceValue : null;
  bl = undefined;

  onProgress({ percent: 10, stage: 'A abrir os movimentos já classificados' });
  let rec = readSheet('REC');
  if (rec) {
    const totalRows = rowCount(rec);
    for (let row = 3; row < totalRows; row++) {
      const movement = movementAt(rec, row, fileName, 'REC:');
      if (!movement) continue;
      const workbookStatus = text(value(rec, row, 10)).toLowerCase();
      movement.status = !movement.idtr ? 'missing_idtr' : workbookStatus === 'ok' ? 'automatic' : 'unreconciled';
      totals.movements++; totals.amountCents += Math.round(movement.amount * 100);
      if (movement.status === 'automatic') totals.automatic++;
      else if (movement.status === 'missing_idtr') totals.missingIdtr++;
      else totals.unreconciled++;
      addType(movementTypes, movement.description, movement.status); keep(movement);
      if (row % 10000 === 0) onProgress({ percent: 12 + Math.round((row / totalRows) * 23), stage: 'A analisar movimentos já classificados', processed: row, total: totalRows, liveTotals: liveTotals(), liveMovementTypes: copyTypes() });
    }
  }
  rec = undefined;

  onProgress({ percent: 38, stage: 'A abrir os movimentos pendentes' });
  const rt = readSheet('REAL TIME');
  if (!rt) throw new Error('A folha "REAL TIME" não foi encontrada.');
  const rtRows = rowCount(rt);
  const reportDate = isoDate(value(rt, 8, 2));
  const groups = new Map<string, number>();
  let rtIdentified = 0;
  const rtIdentifiedTypes = Object.fromEntries((Object.keys(movementTypes) as MovementTypeKey[]).map((key) => [key, 0])) as Record<MovementTypeKey, number>;
  for (let row = 21; row < rtRows; row++) {
    const movement = movementAt(rt, row, fileName, '', reportDate);
    if (movement) { rtIdentified++; rtIdentifiedTypes[classifyMovement(movement.description)]++; }
    if (movement?.idtr) groups.set(movement.idtr, (groups.get(movement.idtr) ?? 0) + Math.round(movement.amount * 100));
    if (row % 10000 === 0) onProgress({ percent: 40 + Math.round((row / rtRows) * 25), stage: 'A agrupar movimentos por IDTR', processed: row, total: rtRows, liveTotals: { ...liveTotals(), movements: totals.movements + rtIdentified }, liveMovementTypes: copyTypes(rtIdentifiedTypes) });
  }

  let effectiveReportDate = reportDate;
  for (let row = 21; row < rtRows; row++) {
    const movement = movementAt(rt, row, fileName, '', reportDate);
    if (!movement) continue;
    movement.status = !movement.idtr ? 'missing_idtr' : groups.get(movement.idtr) === 0 ? 'automatic' : 'unreconciled';
    if (movement.reportDate > effectiveReportDate) effectiveReportDate = movement.reportDate;
    totals.movements++; totals.amountCents += Math.round(movement.amount * 100);
    if (movement.status === 'automatic') totals.automatic++;
    else if (movement.status === 'missing_idtr') totals.missingIdtr++;
    else totals.unreconciled++;
    addType(movementTypes, movement.description, movement.status); keep(movement);
    if (row % 10000 === 0) onProgress({ percent: 67 + Math.round((row / rtRows) * 28), stage: 'A validar saldos e preparar resultados', processed: row, total: rtRows, liveTotals: liveTotals(), liveMovementTypes: copyTypes() });
  }

  onProgress({ percent: 98, stage: 'A construir o dashboard' });
  const result: AnalysisResult = {
    reportDate: effectiveReportDate, accountingBalance, movements: samples, groups: [],
    totals: { movements: totals.movements, automatic: totals.automatic, manual: 0, unreconciled: totals.unreconciled, missingIdtr: totals.missingIdtr, amount: totals.amountCents / 100 },
    movementTypes,
  };
  onProgress({ percent: 100, stage: 'Análise concluída' });
  return result;
}

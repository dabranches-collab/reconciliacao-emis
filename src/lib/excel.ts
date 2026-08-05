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
  // A área útil desta folha começa na coluna B. O SheetJS normaliza a linha
  // para índice zero: Data=B[0], Conta=C[1], Valor=D[2], ... IDTR=J[8].
  const reportDate = isoDate(rows[8]?.[1]);
  const movements: Movement[] = [];
  for (let index = 21; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const amount = numeric(row[2]);
    if (!Number.isFinite(amount) || (!row[0] && !row[5] && !row[6])) continue;
    const info = text(row[7]);
    movements.push({
      id: `${file.name}:${index + 1}`,
      row: index + 1,
      reportDate: isoDate(row[0]) || reportDate,
      account: text(row[1]),
      amount,
      currency: text(row[4]),
      operationNumber: text(row[5]),
      description: text(row[6]),
      complementaryInfo: info,
      idtr: normalizeIdtr(info),
      status: 'unreconciled',
    });
  }
  const reconciledMovements: Movement[] = [];
  const recSheet = workbook.Sheets.REC;
  if (recSheet) {
    const recRows = XLSX.utils.sheet_to_json<unknown[]>(recSheet, { header: 1, raw: true, defval: null });
    // A área usada de REC começa na linha 2; índice 2 corresponde à linha 4 do Excel.
    for (let index = 2; index < recRows.length; index += 1) {
      const row = recRows[index] ?? [];
      const amount = numeric(row[2]);
      if (!Number.isFinite(amount) || (!row[0] && !row[5] && !row[6])) continue;
      const info = text(row[7]);
      const idtr = normalizeIdtr(row[8]) ?? normalizeIdtr(info);
      const workbookStatus = text(row[9]);
      const status = !idtr ? 'missing_idtr' : workbookStatus === 'OK' ? 'manual' : workbookStatus.toLowerCase() === 'ok' ? 'automatic' : 'unreconciled';
      reconciledMovements.push({
        id: `${file.name}:REC:${index + 2}`,
        row: index + 2,
        reportDate: isoDate(row[0]),
        account: text(row[1]),
        amount,
        currency: text(row[4]),
        operationNumber: text(row[5]),
        description: text(row[6]),
        complementaryInfo: info,
        idtr,
        status,
      });
    }
  }
  const balanceSheet = workbook.Sheets.BL;
  const balanceRows = balanceSheet ? XLSX.utils.sheet_to_json<unknown[]>(balanceSheet, { header: 1, raw: true, defval: null }) : [];
  const accountingBalance = Number.isFinite(numeric(balanceRows[4]?.[5])) ? numeric(balanceRows[4]?.[5]) : null;
  const movementDates = movements.map((movement) => movement.reportDate).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const effectiveReportDate = movementDates.sort().at(-1) ?? reportDate;
  const realTimeResult = reconcile(movements, accountingBalance, effectiveReportDate);
  const allMovements = [...reconciledMovements, ...realTimeResult.movements];
  return {
    ...realTimeResult,
    movements: allMovements,
    totals: {
      movements: allMovements.length,
      automatic: allMovements.filter((movement) => movement.status === 'automatic').length,
      manual: allMovements.filter((movement) => movement.status === 'manual').length,
      unreconciled: allMovements.filter((movement) => movement.status === 'unreconciled').length,
      missingIdtr: allMovements.filter((movement) => movement.status === 'missing_idtr').length,
      amount: allMovements.reduce((sum, movement) => sum + Math.round(movement.amount * 100), 0) / 100,
    },
  };
}

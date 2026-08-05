import type { AnalysisResult, Movement, ReconciliationGroup } from '../types';

export const normalizeIdtr = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  const match = text.match(/IDTR=([A-Za-z0-9]{14})/i);
  return match ? `IDTR=${match[1].toUpperCase()}` : null;
};

export const reconcile = (movements: Movement[], accountingBalance: number | null, reportDate: string): AnalysisResult => {
  const byIdtr = new Map<string, Movement[]>();
  for (const movement of movements) {
    if (!movement.idtr) {
      movement.status = 'missing_idtr';
      continue;
    }
    const current = byIdtr.get(movement.idtr) ?? [];
    current.push(movement);
    byIdtr.set(movement.idtr, current);
  }

  const groups: ReconciliationGroup[] = [];
  for (const [idtr, members] of byIdtr) {
    const cents = members.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    const status = cents === 0 ? 'automatic' : 'unreconciled';
    const groupId = `auto:${idtr}`;
    for (const member of members) {
      member.status = status;
      member.groupId = groupId;
    }
    groups.push({ id: groupId, idtr, movementIds: members.map((item) => item.id), balance: cents / 100, status });
  }

  return {
    reportDate,
    accountingBalance,
    movements,
    groups,
    totals: {
      movements: movements.length,
      automatic: movements.filter((m) => m.status === 'automatic').length,
      manual: movements.filter((m) => m.status === 'manual').length,
      unreconciled: movements.filter((m) => m.status === 'unreconciled').length,
      missingIdtr: movements.filter((m) => m.status === 'missing_idtr').length,
      amount: movements.reduce((sum, m) => sum + Math.round(m.amount * 100), 0) / 100,
    },
  };
};

export const movementFingerprint = (movement: Movement): string =>
  [movement.account, movement.reportDate, movement.operationNumber, movement.idtr ?? '', movement.amount.toFixed(2), movement.currency, movement.description, movement.complementaryInfo].join('|');

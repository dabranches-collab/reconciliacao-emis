export type ReconciliationStatus = 'automatic' | 'manual' | 'unreconciled' | 'missing_idtr' | 'data_error';

export interface Movement {
  id: string;
  row: number;
  reportDate: string;
  account: string;
  amount: number;
  currency: string;
  operationNumber: string;
  description: string;
  complementaryInfo: string;
  idtr: string | null;
  status: ReconciliationStatus;
  groupId?: string;
}

export interface ReconciliationGroup {
  id: string;
  idtr: string;
  movementIds: string[];
  balance: number;
  status: ReconciliationStatus;
}

export interface AnalysisResult {
  sourceMode?: 'raw_extract';
  periodStart?: string;
  reportDate: string;
  accountingBalance: number | null;
  movements: Movement[];
  groups: ReconciliationGroup[];
  totals: { movements: number; automatic: number; manual: number; unreconciled: number; missingIdtr: number; amount: number };
  movementTypes?: Record<string, { total: number; reconciled: number; unreconciled: number; missingIdtr: number }>;
  sourceFileHash?: string;
  sourceFilename?: string;
  ageBuckets?: Record<string, { total: number; automatic: number; unreconciled: number; amount: number }>;
  rawAmounts?: { debits: number; credits: number; net: number; openingBalance: number | null; closingBalance: number | null };
  reconciliationTiming?: { averageDays: number; totalGroups: number; buckets: Record<string, number> };
  dailyMetrics?: Record<string, { movements: number; automatic: number; unreconciled: number; missingIdtr: number; amount: number }>;
}

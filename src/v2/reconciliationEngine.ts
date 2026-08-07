export type ReconciliationMethod = 'idtr' | 'operation_description' | 'reference_26';

export type CandidateMovement = {
  id: string;
  accountingDate: string;
  amountCents: number;
  nativeIdtr: string | null;
  operationNumber: string;
  descriptionNormalized: string;
  reference26: string | null;
};

export type ReconciledGroup = {
  method: ReconciliationMethod;
  key: string;
  movementIds: string[];
  balanceCents: number;
  ruleVersion: string;
};

export type ReconciliationOutcome = {
  groups: ReconciledGroup[];
  openMovementIds: string[];
};
import {reconciliationRuleVersion as RULE_VERSION} from './reconciliationRules';

const groupBy = <T>(rows: T[], keyOf: (row: T) => string | null) => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const members = groups.get(key) ?? [];
    members.push(row);
    groups.set(key, members);
  }
  return groups;
};

const oppositePairs = (members: CandidateMovement[]) => {
  const ordered = [...members].sort((a, b) =>
    a.accountingDate.localeCompare(b.accountingDate) || a.id.localeCompare(b.id),
  );
  const positives = new Map<number, CandidateMovement[]>();
  const negatives = new Map<number, CandidateMovement[]>();
  for (const member of ordered) {
    if (member.amountCents === 0) continue;
    const target = member.amountCents > 0 ? positives : negatives;
    const amount = Math.abs(member.amountCents);
    const rows = target.get(amount) ?? [];
    rows.push(member);
    target.set(amount, rows);
  }
  const result: [CandidateMovement, CandidateMovement][] = [];
  for (const [amount, credits] of positives) {
    const debits = negatives.get(amount) ?? [];
    const count = Math.min(credits.length, debits.length);
    for (let index = 0; index < count; index++) result.push([credits[index], debits[index]]);
  }
  return result;
};

export function reconcileCandidates(movements: CandidateMovement[]): ReconciliationOutcome {
  const open = new Map(movements.map((movement) => [movement.id, movement]));
  const groups: ReconciledGroup[] = [];

  for (const [idtr, members] of groupBy(movements, (movement) => movement.nativeIdtr)) {
    const balanceCents = members.reduce((sum, movement) => sum + movement.amountCents, 0);
    if (members.length < 2 || balanceCents !== 0) continue;
    groups.push({method:'idtr',key:idtr,movementIds:members.map(({id})=>id),balanceCents,ruleVersion:RULE_VERSION});
    for (const member of members) open.delete(member.id);
  }

  const secondary = groupBy([...open.values()], (movement) => {
    if (!movement.operationNumber || !movement.descriptionNormalized) return null;
    return `${movement.operationNumber}\u001f${movement.descriptionNormalized}`;
  });
  for (const [key, members] of secondary) {
    for (const [credit, debit] of oppositePairs(members)) {
      groups.push({method:'operation_description',key,movementIds:[credit.id,debit.id],balanceCents:0,ruleVersion:RULE_VERSION});
      open.delete(credit.id);
      open.delete(debit.id);
    }
  }

  return {groups,openMovementIds:[...open.keys()]};
}

export const reconciliationRuleVersion = RULE_VERSION;

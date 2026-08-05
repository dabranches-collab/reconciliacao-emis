import { describe, expect, it } from 'vitest';
import { normalizeIdtr, reconcile } from './reconciliation';
import type { Movement } from '../types';

const movement = (id: string, amount: number, idtr: string | null): Movement => ({ id, row: 1, reportDate: '2026-07-31', account: '2521247', amount, currency: 'AKZ', operationNumber: id, description: '', complementaryInfo: '', idtr, status: 'unreconciled' });

describe('reconciliation engine', () => {
  it('extracts the canonical 19-character IDTR', () => expect(normalizeIdtr('IDTR=02863800046789;NORD=123')).toBe('IDTR=02863800046789'));
  it('reconciles two movements with zero balance', () => expect(reconcile([movement('1', 100, 'IDTR=02863800046789'), movement('2', -100, 'IDTR=02863800046789')], null, '').totals.automatic).toBe(2));
  it('reconciles four movements with zero balance', () => expect(reconcile([movement('1', 100, 'IDTR=02863800046789'), movement('2', -2, 'IDTR=02863800046789'), movement('3', -100, 'IDTR=02863800046789'), movement('4', 2, 'IDTR=02863800046789')], null, '').totals.automatic).toBe(4));
  it('leaves a non-zero group unreconciled', () => expect(reconcile([movement('1', 100, 'IDTR=02863800046789'), movement('2', -90, 'IDTR=02863800046789')], null, '').totals.unreconciled).toBe(2));
});

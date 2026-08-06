import { describe, expect, it } from 'vitest';
import { operationalDaysBetween, shiftOperationalDay } from './operationalDays';

describe('dias operacionais', () => {
  it('classifica a sexta anterior a uma segunda como D+1', () => {
    expect(operationalDaysBetween('2026-07-10', '2026-07-13')).toBe(1);
  });

  it('não cria D+1 ou D+2 artificiais durante o fim de semana', () => {
    expect(shiftOperationalDay('2026-07-13', -1)).toBe('2026-07-10');
    expect(shiftOperationalDay('2026-07-13', -2)).toBe('2026-07-09');
  });

  it('mantém dias consecutivos dentro da semana', () => {
    expect(operationalDaysBetween('2026-07-08', '2026-07-10')).toBe(2);
  });
});

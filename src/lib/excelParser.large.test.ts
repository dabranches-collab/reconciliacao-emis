import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { analyzeWorkbookBuffer } from './excelParser';

const largeFile = 'inputs/BK_Real Time EMIS_2521247_ 2026_07_31_TST  certo.xlsx';

describe.skipIf(process.env.RUN_LARGE_EXCEL !== '1')('large workbook regression', () => {
  it('processes the workbook that previously crashed the browser', async () => {
    const bytes = await readFile(largeFile);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const progress: number[] = [];
    const result = await analyzeWorkbookBuffer(largeFile, buffer, (update) => progress.push(update.percent));
    expect(result.totals.movements).toBeGreaterThan(300_000);
    expect(result.movements.length).toBeLessThanOrEqual(1_200);
    expect(progress.at(-1)).toBe(100);
  }, 180_000);
});

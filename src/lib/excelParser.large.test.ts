import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeRawExtract } from './rawExtractParser';

const inputDirectory=process.env.RAW_EXTRACT_DIR??'inputs';
const largeFiles = process.env.RAW_EXTRACT_DIR ? [
  join(inputDirectory,'Extracto 01 a 03 Julho 2026.xlsx'),
  join(inputDirectory,'Extracto 06 a 08 Julho 2026.xlsx'),
] : [
  join(inputDirectory,'Extrato_08 a 14 de Julho 2026.xlsx'),
  join(inputDirectory,'Extrato_15 a 22 de Julho 2026.xlsx'),
  join(inputDirectory,'Extrato_23 a 28 de Julho 2026.xlsx'),
];

describe.skipIf(process.env.RUN_LARGE_EXCEL !== '1')('large workbook regression', () => {
  for (const largeFile of largeFiles) it(`processes ${largeFile}`, async () => {
      const bytes = await readFile(largeFile);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const progress: number[] = [];
      const result = await analyzeRawExtract(largeFile, buffer, (update) => progress.push(update.percent));
      console.log(JSON.stringify({file:largeFile,date:result.reportDate,totals:result.totals,amounts:result.rawAmounts,ages:result.ageBuckets,types:result.movementTypes}));
      expect(result.totals.movements).toBeGreaterThan(400_000);
      expect(result.sourceMode).toBe('raw_extract');
      expect(result.movements.length).toBeLessThanOrEqual(1_200);
      expect(progress.at(-1)).toBe(100);
    }, 240_000);
});

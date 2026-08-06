import {describe,expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {estimateXlsxRows,streamXlsxRows} from './xlsxRowStream';

describe('leitor XLSX por fluxo',()=>{
  it('lê cabeçalhos e valores sem carregar a folha através da API visual',async()=>{
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Extrato');
    sheet.addRow(['MRCCB','MRVLR','MRSALD']);sheet.addRow(['2521247',100,1100]);
    const bytes=await workbook.xlsx.writeBuffer(),rows:unknown[][]=[];
    const arrayBuffer=new Uint8Array(bytes).slice().buffer;
    expect(await estimateXlsxRows(arrayBuffer)).toBe(2);
    for await(const row of streamXlsxRows(arrayBuffer))rows.push(row);
    expect(rows).toEqual([['MRCCB','MRVLR','MRSALD'],['2521247',100,1100]]);
  });
});

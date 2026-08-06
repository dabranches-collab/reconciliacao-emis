import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
import {ingestRows} from './importPipeline';
import {streamXlsxRows} from './xlsxRowStream';

const file=process.env.REALTIME_V2_FILE;

describe.skipIf(!file)('importação V2 com extrato original',()=>{
  it('percorre o ficheiro completo sem persistir movimentos',async()=>{
    const bytes=await readFile(file!),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
    const result=await ingestRows(streamXlsxRows(buffer),{persist:async rows=>({inserted:rows.length,duplicates:0}),progress:async()=>{}},5000);
    console.log(JSON.stringify({file,result}));
    expect(result.processed).toBeGreaterThan(0);
  },600_000);
});

import {describe,expect,it} from 'vitest';
import {ingestRows,type ImportProgress,type PersistedMovement} from './importPipeline';

const headers=['MRCCB','MRVLR','MRMOED','MRDMOV','MRSALD','MRDTSIS','MRHORA','MRDATL','MRNOPR','MROBS','GBMRINFC'];
async function* source(rows:unknown[][]){for(const row of rows)yield row;}
const row=(amount:number,balance:number,operation:string)=>['2521247',amount,'AOA','TRANSFERÊNCIA',balance,20260710,120000,20260710,operation,'','IDTR=02863800046789'];

describe('pipeline de importação V2',()=>{
  it('persiste em lotes, conta duplicados e só avança para reconciliação depois da ingestão',async()=>{
    const progress:ImportProgress[]=[],persisted:PersistedMovement[]=[];
    const result=await ingestRows(source([headers,row(100,1100,'1'),row(-100,1000,'2')]),{persist:async rows=>{persisted.push(...rows);return {inserted:rows.length-1,duplicates:1};},progress:async value=>{progress.push(value);}},2);
    expect(result).toMatchObject({processed:2,inserted:1,duplicates:1,rejected:0,accountingAnomalies:0,rejectionSamples:[]});
    expect(persisted).toHaveLength(2);
    expect(progress.at(-1)?.stage).toBe('reconciling');
  });
  it('importa e sinaliza uma rutura de MRSALD sem perder o movimento',async()=>{
    const result=await ingestRows(source([headers,row(100,1100,'1'),row(50,999,'2')]),{persist:async rows=>({inserted:rows.length,duplicates:0}),progress:async()=>{}},10);
    expect(result).toMatchObject({processed:2,inserted:2,duplicates:0,rejected:0,accountingAnomalies:1});
    expect(result.accountingAnomalySamples[0]).toMatchObject({sourceRow:3});
  });
  it('marca o trabalho como falhado quando os cabeçalhos não são reconhecidos',async()=>{
    const progress:ImportProgress[]=[];
    await expect(ingestRows(source([['A','B'],[1,2]]),{persist:async()=>({inserted:0,duplicates:0}),progress:async value=>{progress.push(value);}})).rejects.toThrow(/cabeçalhos/);
    expect(progress.at(-1)?.stage).toBe('failed');
  });
});

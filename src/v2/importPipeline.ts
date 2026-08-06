import {resolveExtractHeaders,selectRawMovement} from './extractSchema';
import {BalanceSequenceValidator,normalizeMovementRow,type NormalizedMovement} from './normalizeMovement';

export type ImportStage='validating'|'ingesting'|'reconciling'|'calculating'|'completed'|'failed';
export type ImportProgress={stage:ImportStage;processed:number;inserted:number;duplicates:number;rejected:number;message:string;withNativeIdtr:number;withoutNativeIdtr:number;reference26:number;amountCents:number};
export type ImportRejection={sourceRow:number;message:string};
export type PersistedMovement=NormalizedMovement&{sourceRow:number;fingerprint:string;raw:ReturnType<typeof selectRawMovement>;balanceSequenceValid:boolean;expectedBalanceCents:number|null};
export type ImportSink={
  persist(rows:PersistedMovement[]):Promise<{inserted:number;duplicates:number}>;
  progress(value:ImportProgress):Promise<void>;
};

const fingerprint=(row:PersistedMovement)=>{
  const source=[row.systemDate,row.systemTime,row.accountingDate,row.account,row.amountCents,row.currency,row.operationNumber,row.raw.description,row.raw.observations,row.raw.complementaryInfo].join('\u001f');
  let left=2166136261,right=2246822507;
  for(let index=0;index<source.length;index++){const code=source.charCodeAt(index);left=Math.imul(left^code,16777619);right=Math.imul(right^code,3266489917);}
  return `${(left>>>0).toString(16).padStart(8,'0')}${(right>>>0).toString(16).padStart(8,'0')}`;
};

export async function ingestRows(rows:AsyncIterable<unknown[]>,sink:ImportSink,batchSize=1000){
  let columns:ReturnType<typeof resolveExtractHeaders>['columns']=null,headerRow=0,processed=0,inserted=0,duplicates=0,rejected=0,accountingAnomalies=0,rowNumber=0,withNativeIdtr=0,withoutNativeIdtr=0,reference26=0,amountCents=0;const rejectionSamples:ImportRejection[]=[],accountingAnomalySamples:ImportRejection[]=[];
  const balanceValidator=new BalanceSequenceValidator(),batch:PersistedMovement[]=[];
  const report=async(stage:ImportStage,message:string)=>sink.progress({stage,processed,inserted,duplicates,rejected,message,withNativeIdtr,withoutNativeIdtr,reference26,amountCents});
  try{
    await report('validating','A procurar e validar os cabeçalhos do extrato');
    for await(const row of rows){
      rowNumber++;
      if(!columns){const resolution=resolveExtractHeaders(row);if(resolution.columns){columns=resolution.columns;headerRow=rowNumber;}continue;}
      if(rowNumber<=headerRow)continue;
      const raw=selectRawMovement(row,columns);
      if(raw.amount===null||raw.amount===undefined||raw.amount==='')continue;
      try{
        const normalized=normalizeMovementRow(raw),balance=balanceValidator.validate(normalized);
        if(!balance.valid){accountingAnomalies++;if(accountingAnomalySamples.length<20)accountingAnomalySamples.push({sourceRow:rowNumber,message:`MRSALD não corresponde ao saldo anterior + MRVLR (esperado ${(balance.expectedBalanceCents/100).toFixed(2)}, recebido ${(balance.actualBalanceCents/100).toFixed(2)}).`});}
        const persisted={...normalized,sourceRow:rowNumber,fingerprint:'',raw,balanceSequenceValid:balance.valid,expectedBalanceCents:balance.valid?normalized.balanceCents:balance.expectedBalanceCents};persisted.fingerprint=fingerprint(persisted);batch.push(persisted);processed++;amountCents+=normalized.amountCents;if(normalized.nativeIdtr)withNativeIdtr++;else withoutNativeIdtr++;if(normalized.reference26)reference26++;
      }catch(cause){rejected++;if(rejectionSamples.length<20)rejectionSamples.push({sourceRow:rowNumber,message:cause instanceof Error?cause.message:'Linha inválida.'});}
      if(batch.length>=batchSize){const result=await sink.persist(batch.splice(0,batch.length));inserted+=result.inserted;duplicates+=result.duplicates;await report('ingesting',`A guardar movimentos — ${processed.toLocaleString('pt-AO')} linhas validadas`);}
    }
    if(!columns)throw new Error('Não foi encontrado um conjunto completo e inequívoco de cabeçalhos Real Time.');
    if(batch.length){const result=await sink.persist(batch);inserted+=result.inserted;duplicates+=result.duplicates;}
    await report('reconciling','Ingestão concluída; pronto para executar a reconciliação central');
    return {processed,inserted,duplicates,rejected,accountingAnomalies,rejectionSamples,accountingAnomalySamples};
  }catch(cause){await report('failed',cause instanceof Error?cause.message:'A importação falhou.');throw cause;}
}

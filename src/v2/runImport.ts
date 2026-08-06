import type {AnalysisProgress} from '../lib/excel';
import {createV2ImportSink,finalizeV2Import,loadV2Dashboard,loadV2ImportState,prepareV2Import} from './database';
import {ingestRows} from './importPipeline';
import {estimateXlsxRows,streamXlsxRows} from './xlsxRowStream';
import {resolveExtractHeaders} from './extractSchema';

const sha256=async(buffer:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(value=>value.toString(16).padStart(2,'0')).join('');
const wait=(milliseconds:number)=>new Promise(resolve=>window.setTimeout(resolve,milliseconds));

type LiveV2=NonNullable<AnalysisProgress['liveV2']>;

const centralProgress=(percent:number,stage:string,processed:number,inserted:number,liveV2:LiveV2):AnalysisProgress=>({
  percent,stage,processed,total:processed,unit:'linhas',storedRows:inserted,liveV2,
  liveTotals:{movements:processed,automatic:0,unreconciled:processed,missingIdtr:liveV2.withoutNativeIdtr},
});

async function waitForCentralCompletion(importId:string,onProgress:(progress:AnalysisProgress)=>void,liveV2:LiveV2){
  for(let attempt=0;attempt<300;attempt++){
    const state=await loadV2ImportState(importId);
    if(state.state==='completed')return;
    if(state.state==='failed')throw new Error(state.error_message||'A reconciliação central falhou.');
    onProgress(centralProgress(Math.max(82,Number(state.progress)||82),'Processamento em curso no servidor. Aguarde.',state.source_rows,state.inserted_rows,liveV2));
    await wait(2000);
  }
  throw new Error('A reconciliação continua no servidor. Consulte o Histórico para acompanhar a conclusão.');
}

async function loadCompletedDashboard(seriesId:string){
  let lastError:unknown;
  for(let attempt=0;attempt<6;attempt++){
    try{
      const dashboard=await loadV2Dashboard(seriesId);
      if(dashboard?.state==='completed'&&dashboard.result)return dashboard;
    }catch(cause){lastError=cause;}
    await wait(1500*(attempt+1));
  }
  if(lastError)throw lastError;
  throw new Error('A reconciliação terminou, mas os indicadores ainda não estão disponíveis.');
}

export async function runV2Import(file:File,onProgress:(progress:AnalysisProgress)=>void){
  onProgress({percent:1,stage:'A ler o ficheiro e calcular a assinatura'});
  const buffer=await file.arrayBuffer(),estimatedRows=Math.max(1,(await estimateXlsxRows(buffer)??1)-1),hash=await sha256(buffer);
  let headerValidated=false,scanned=0;
  for await(const row of streamXlsxRows(buffer)){scanned++;if(resolveExtractHeaders(row).columns){headerValidated=true;break;}if(scanned>=100)break;}
  if(!headerValidated)throw new Error('Não foi encontrado um conjunto completo e inequívoco de cabeçalhos Real Time. Nenhuma importação foi criada.');
  const prepared=await prepareV2Import(file,hash);
  if(prepared.duplicate){const dashboard=await loadV2Dashboard(prepared.context.seriesId);return {dashboard,duplicate:true,context:prepared.context};}
  let lastLiveV2:LiveV2={withNativeIdtr:0,withoutNativeIdtr:0,reference26:0,amountCents:0,duplicates:0,rejected:0,provisionalReconciled:0};
  const sink=createV2ImportSink(prepared.context,value=>{
    lastLiveV2={withNativeIdtr:value.withNativeIdtr,withoutNativeIdtr:value.withoutNativeIdtr,reference26:value.reference26,amountCents:value.amountCents,duplicates:value.duplicates,rejected:value.rejected,provisionalReconciled:value.provisionalReconciled};
    const ratio=value.processed/estimatedRows,percent=value.stage==='validating'?3:value.stage==='ingesting'?Math.min(78,5+Math.round(ratio*73)):value.stage==='reconciling'?82:value.stage==='failed'?0:100;
    onProgress({percent,stage:value.message,processed:value.processed,total:estimatedRows,unit:'linhas',storedRows:value.inserted,liveTotals:{movements:value.processed,automatic:value.provisionalReconciled,unreconciled:Math.max(0,value.processed-value.provisionalReconciled),missingIdtr:value.withoutNativeIdtr},liveV2:{withNativeIdtr:value.withNativeIdtr,withoutNativeIdtr:value.withoutNativeIdtr,reference26:value.reference26,amountCents:value.amountCents,duplicates:value.duplicates,rejected:value.rejected,provisionalReconciled:value.provisionalReconciled}});
  });
  let processed=0,inserted=0,duplicates=0,rejected=0;
  try{
    const ingestion=await ingestRows(streamXlsxRows(buffer),sink,1000);
    ({processed,inserted,duplicates,rejected}=ingestion);
    onProgress(centralProgress(82,'Processamento em curso no servidor. Aguarde.',ingestion.processed,ingestion.inserted,lastLiveV2));
    try{
      await finalizeV2Import(prepared.context);
    }catch{
      onProgress(centralProgress(88,'Processamento em curso no servidor. Aguarde.',ingestion.processed,ingestion.inserted,lastLiveV2));
      await waitForCentralCompletion(prepared.context.importId,onProgress,lastLiveV2);
    }
    onProgress(centralProgress(100,'Análise concluída.',ingestion.processed,ingestion.inserted,lastLiveV2));
    const dashboard=await loadCompletedDashboard(prepared.context.seriesId);
    return {dashboard,duplicate:false,context:prepared.context,ingestion};
  }catch(cause){
    const message=cause instanceof Error?cause.message:'Falha inesperada durante a importação V2.';
    try{
      const current=await loadV2ImportState(prepared.context.importId);
      if(current.state!=='completed')await sink.progress({...lastLiveV2,stage:'failed',processed,inserted,duplicates,rejected,message});
    }catch{/* Preservar o erro original. */}
    throw cause;
  }
}

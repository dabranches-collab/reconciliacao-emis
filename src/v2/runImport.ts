import type {AnalysisProgress} from '../lib/excel';
import {createV2ImportSink,finalizeV2Import,loadV2Dashboard,prepareV2Import} from './database';
import {ingestRows} from './importPipeline';
import {estimateXlsxRows,streamXlsxRows} from './xlsxRowStream';

const sha256=async(buffer:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(value=>value.toString(16).padStart(2,'0')).join('');

export async function runV2Import(file:File,onProgress:(progress:AnalysisProgress)=>void){
  onProgress({percent:1,stage:'A ler o ficheiro e calcular a assinatura'});
  const buffer=await file.arrayBuffer(),estimatedRows=Math.max(1,(await estimateXlsxRows(buffer)??1)-1),hash=await sha256(buffer);
  const prepared=await prepareV2Import(file,hash);
  if(prepared.duplicate){const dashboard=await loadV2Dashboard(prepared.context.seriesId);return {dashboard,duplicate:true,context:prepared.context};}
  const sink=createV2ImportSink(prepared.context,value=>{
    const ratio=value.processed/estimatedRows,percent=value.stage==='validating'?3:value.stage==='ingesting'?Math.min(78,5+Math.round(ratio*73)):value.stage==='reconciling'?82:value.stage==='failed'?0:100;
    onProgress({percent,stage:value.message,processed:value.processed,total:estimatedRows,unit:'linhas',storedRows:value.inserted,liveTotals:{movements:value.processed,automatic:0,unreconciled:value.processed,missingIdtr:0}});
  });
  const ingestion=await ingestRows(streamXlsxRows(buffer),sink,1000);
  onProgress({percent:82,stage:'Todas as linhas foram guardadas · a reconciliar',processed:ingestion.inserted,total:ingestion.processed,unit:'linhas',storedRows:ingestion.inserted});
  await finalizeV2Import(prepared.context);
  onProgress({percent:100,stage:'Importação, reconciliação e indicadores concluídos',processed:ingestion.processed,total:ingestion.processed,unit:'linhas',storedRows:ingestion.inserted});
  const dashboard=await loadV2Dashboard(prepared.context.seriesId);
  if(!dashboard||dashboard.state!=='completed'||!dashboard.result)throw new Error('A base terminou o trabalho mas não devolveu indicadores V2 concluídos.');
  return {dashboard,duplicate:false,context:prepared.context,ingestion};
}

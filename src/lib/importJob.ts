export const IMPORT_STAGES = [
  'uploading',
  'uploaded',
  'parsing',
  'reconciling_primary',
  'reconciling_secondary',
  'metrics',
  'balances',
  'validating',
  'completed',
] as const;

export type ImportStage=(typeof IMPORT_STAGES)[number];
export type ImportJobStatus='processing'|'retrying'|'failed'|'completed';

export type ImportJobSnapshot={
  status:ImportJobStatus;
  stage:ImportStage;
  expectedFileSize:number;
  storedFileSize:number;
  uploadPartsCompleted:number;
  uploadPartsTotal:number;
  movementCount:number;
  insertedCount:number;
  duplicateCount:number;
  rejectedCount:number;
  completedUnits:number;
  totalUnits:number;
  heartbeatAt:string|null;
  completedAt:string|null;
};

export type CompletionCheck={ok:boolean;failures:string[]};

export function validateImportCompletion(job:ImportJobSnapshot):CompletionCheck{
  const failures:string[]=[];
  if(job.expectedFileSize<=0)failures.push('Tamanho original do ficheiro desconhecido.');
  if(job.storedFileSize!==job.expectedFileSize)failures.push('O ficheiro guardado não tem o tamanho esperado.');
  if(job.uploadPartsTotal<=0||job.uploadPartsCompleted!==job.uploadPartsTotal)failures.push('Nem todas as partes do ficheiro foram confirmadas.');
  if(job.movementCount<=0)failures.push('O ficheiro não produziu movimentos válidos.');
  if(job.insertedCount+job.duplicateCount+job.rejectedCount!==job.movementCount)failures.push('A contagem das linhas não fecha.');
  if(job.totalUnits<=0||job.completedUnits!==job.totalUnits)failures.push('Existem blocos de processamento por concluir.');
  if(job.stage!=='completed')failures.push('A validação final ainda não terminou.');
  if(job.status!=='completed'||!job.completedAt)failures.push('O lote ainda não foi marcado como concluído pelo servidor.');
  return{ok:failures.length===0,failures};
}

export function importProgress(job:ImportJobSnapshot){
  if(job.status==='completed')return 100;
  const stageIndex=Math.max(0,IMPORT_STAGES.indexOf(job.stage));
  const stageBase=[0,18,20,68,82,90,94,98,100][stageIndex]??0;
  const nextBase=[18,20,68,82,90,94,98,100,100][stageIndex]??stageBase;
  const ratio=job.stage==='uploading'
    ?job.uploadPartsTotal?job.uploadPartsCompleted/job.uploadPartsTotal:0
    :job.totalUnits?job.completedUnits/job.totalUnits:0;
  return Math.min(99,Math.max(0,Math.round(stageBase+(nextBase-stageBase)*Math.min(1,ratio))));
}

export function isStalled(job:ImportJobSnapshot,now=Date.now(),limitMs=90_000){
  if(job.status!=='processing'||!job.heartbeatAt)return false;
  return now-Date.parse(job.heartbeatAt)>limitMs;
}

export type MultipartSession={batchId:string;uploadId:string;objectKey:string;partSize:number;fileSize:number;fileHash:string;completed:Record<number,string>};
export type MultipartProgress={uploadedBytes:number;totalBytes:number;completedParts:number;totalParts:number;percent:number};
type Request=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function json<T>(response:Response):Promise<T>{
  if(response.ok)return response.json() as Promise<T>;
  throw new Error((await response.text())||`Pedido recusado (${response.status}).`);
}

export function uploadSessionKey(fileHash:string){return `reconciliation-upload:${fileHash}`;}
export function readMultipartSession(fileHash:string,storage:Pick<Storage,'getItem'>=localStorage){
  const raw=storage.getItem(uploadSessionKey(fileHash));if(!raw)return null;
  try{return JSON.parse(raw) as MultipartSession;}catch{return null;}
}
export function saveMultipartSession(session:MultipartSession,storage:Pick<Storage,'setItem'>=localStorage){storage.setItem(uploadSessionKey(session.fileHash),JSON.stringify(session));}
export function clearMultipartSession(fileHash:string,storage:Pick<Storage,'removeItem'>=localStorage){storage.removeItem(uploadSessionKey(fileHash));}

async function requestWithRetry(request:Request,input:RequestInfo|URL,init:RequestInit,attempts=5){
  let last:unknown;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await request(input,init);if(response.ok||response.status<500&&response.status!==429)return response;
      last=new Error(await response.text());
    }catch(cause){last=cause;}
    if(attempt<attempts)await pause(Math.min(8_000,400*2**(attempt-1)));
  }
  throw last instanceof Error?last:new Error('Não foi possível enviar a parte do ficheiro.');
}

export async function createMultipartSession(file:File,fileHash:string,token:string,request:Request=fetch){
  const previous=readMultipartSession(fileHash);
  if(previous&&previous.fileSize===file.size)return previous;
  const response=await request('/api/imports/multipart/create',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,fileSize:file.size,fileHash})});
  const session=await json<MultipartSession>(response);saveMultipartSession(session);return session;
}

export async function uploadFileParts(file:File,session:MultipartSession,token:string,onProgress?:(value:MultipartProgress)=>void,request:Request=fetch,storage:Pick<Storage,'setItem'|'removeItem'>=localStorage){
  if(file.size!==session.fileSize)throw new Error('O ficheiro selecionado não corresponde à importação interrompida.');
  const totalParts=Math.ceil(file.size/session.partSize);
  const report=()=>{const uploadedBytes=Object.keys(session.completed).reduce((sum,key)=>{const part=Number(key);return sum+Math.min(session.partSize,file.size-(part-1)*session.partSize);},0);onProgress?.({uploadedBytes,totalBytes:file.size,completedParts:Object.keys(session.completed).length,totalParts,percent:Math.min(99,Math.round(uploadedBytes/file.size*100))});};
  report();
  for(let part=1;part<=totalParts;part++){
    if(session.completed[part])continue;
    const start=(part-1)*session.partSize,end=Math.min(file.size,start+session.partSize);
    const response=await requestWithRetry(request,`/api/imports/multipart/${encodeURIComponent(session.batchId)}/part/${part}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'X-Upload-Id':session.uploadId,'X-Object-Key':session.objectKey},body:file.slice(start,end)});
    const result=await json<{etag:string}>(response);session.completed[part]=result.etag;saveMultipartSession(session,storage);report();
  }
  const completed=await request(`/api/imports/multipart/${encodeURIComponent(session.batchId)}/complete`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({uploadId:session.uploadId,objectKey:session.objectKey,parts:Object.entries(session.completed).map(([partNumber,etag])=>({partNumber:Number(partNumber),etag}))})});
  await json(completed);clearMultipartSession(session.fileHash,storage);onProgress?.({uploadedBytes:file.size,totalBytes:file.size,completedParts:totalParts,totalParts,percent:100});
}

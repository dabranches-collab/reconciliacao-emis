import {describe,expect,it,vi} from 'vitest';
import {clearMultipartSession,readMultipartSession,saveMultipartSession,uploadFileParts,type MultipartSession} from './multipartUpload';

class MemoryStorage{values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}removeItem(k:string){this.values.delete(k);}}
const session:MultipartSession={batchId:'batch',uploadId:'upload',objectKey:'key',partSize:4,fileSize:10,fileHash:'hash',completed:{}};

describe('multipart upload',()=>{
  it('persists and clears a resumable session',()=>{const storage=new MemoryStorage();saveMultipartSession(session,storage);expect(readMultipartSession('hash',storage)?.uploadId).toBe('upload');clearMultipartSession('hash',storage);expect(readMultipartSession('hash',storage)).toBeNull();});
  it('uploads only missing parts and completes in order',async()=>{
    const current={...session,completed:{1:'existing'}};const calls:string[]=[];
    const request=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);return new Response(JSON.stringify(url.endsWith('/complete')?{ok:true}:{etag:`etag-${calls.length}`}),{status:200});});
    const progress:number[]=[];await uploadFileParts(new File(['0123456789'],'test.xlsx'),current,'token',value=>progress.push(value.percent),request,new MemoryStorage());
    expect(calls.filter(url=>url.includes('/part/'))).toEqual(['/api/imports/multipart/batch/part/2','/api/imports/multipart/batch/part/3']);
    expect(calls.at(-1)).toContain('/complete');expect(progress.at(-1)).toBe(100);
  });
  it('rejects a different file before sending data',async()=>{const request=vi.fn();await expect(uploadFileParts(new File(['small'],'x.xlsx'),session,'token',undefined,request,new MemoryStorage())).rejects.toThrow('não corresponde');expect(request).not.toHaveBeenCalled();});
});

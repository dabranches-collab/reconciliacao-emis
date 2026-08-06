import {describe,expect,it} from 'vitest';
import {importProgress,isStalled,validateImportCompletion,type ImportJobSnapshot} from './importJob';

const complete:ImportJobSnapshot={status:'completed',stage:'completed',expectedFileSize:100,storedFileSize:100,uploadPartsCompleted:4,uploadPartsTotal:4,movementCount:10,insertedCount:7,duplicateCount:2,rejectedCount:1,completedUnits:64,totalUnits:64,heartbeatAt:'2026-08-06T12:00:00Z',completedAt:'2026-08-06T12:01:00Z'};

describe('durable import job',()=>{
  it('accepts only a fully closed import',()=>expect(validateImportCompletion(complete)).toEqual({ok:true,failures:[]}));
  it.each([
    ['missing upload part',{uploadPartsCompleted:3}],
    ['truncated stored file',{storedFileSize:99}],
    ['unaccounted movement',{insertedCount:6}],
    ['unfinished processing block',{completedUnits:63}],
    ['false completion state',{status:'processing' as const,completedAt:null}],
  ])('rejects %s',(_name,change)=>expect(validateImportCompletion({...complete,...change}).ok).toBe(false));
  it('never reports 100 before server completion',()=>expect(importProgress({...complete,status:'processing',stage:'validating',completedAt:null})).toBe(99));
  it('reports resumable upload progress from confirmed parts',()=>expect(importProgress({...complete,status:'processing',stage:'uploading',uploadPartsCompleted:2,completedAt:null})).toBe(9));
  it('detects a stale heartbeat without flagging completed work',()=>{
    expect(isStalled({...complete,status:'processing',stage:'parsing',completedAt:null},Date.parse('2026-08-06T12:02:00Z'))).toBe(true);
    expect(isStalled(complete,Date.parse('2026-08-06T12:02:00Z'))).toBe(false);
  });
});

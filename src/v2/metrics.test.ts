import {describe,expect,it} from 'vitest';
import {calculateOperationalMetrics,pendingMetric} from './metrics';
import {reconcileCandidates,type CandidateMovement} from './reconciliationEngine';

const movement=(id:string,date:string,amountCents:number,idtr:string|null):CandidateMovement=>({id,accountingDate:date,amountCents,nativeIdtr:idtr,operationNumber:id,descriptionNormalized:'movimento',reference26:null});

describe('métricas centrais V2',()=>{
  it('nunca representa uma métrica pendente como zero',()=>expect(pendingMetric('v2')).toEqual({state:'pending',ruleVersion:'v2',calculatedAt:null,value:null,error:null}));
  it('conta sexta-feira anterior a segunda-feira como D+1',()=>{
    const rows=[movement('aberto','2026-07-10',500,null),movement('corte','2026-07-13',200,null)];
    const metric=calculateOperationalMetrics(rows,[],'v2').value!;
    expect(metric.openByAge['D+1']).toBe(1);
    expect(metric.openByAge['D+3']).toBe(0);
  });
  it('mede o fecho entre sexta e segunda como um dia útil',()=>{
    const rows=[movement('1','2026-07-10',1000,'IDTR=1'),movement('2','2026-07-13',-1000,'IDTR=1')];
    const outcome=reconcileCandidates(rows),metric=calculateOperationalMetrics(rows,outcome.groups,'v2').value!;
    expect(metric.reconciledByDelay['D+1']).toBe(1);
    expect(metric.averageReconciliationDays).toBe(1);
  });
});

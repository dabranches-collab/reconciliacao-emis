import {operationalDaysBetween} from '../lib/operationalDays';
import type {CandidateMovement,ReconciledGroup} from './reconciliationEngine';

export type MetricState='pending'|'processing'|'completed'|'failed';
export type MetricEnvelope<T>={state:MetricState;ruleVersion:string;calculatedAt:string|null;value:T|null;error:string|null};
export type OperationalAgeBucket='D+0'|'D+1'|'D+2'|'D+3'|'D+4–7'|'D+8+';
export type OperationalMetrics={
  cutoff:string;
  totals:{movements:number;reconciled:number;open:number;amountCents:number};
  openByAge:Record<OperationalAgeBucket,number>;
  reconciledByDelay:Record<'D+0'|'D+1'|'D+2'|'D+3'|'D+4+',number>;
  averageReconciliationDays:number|null;
};

const ageBucket=(days:number):OperationalAgeBucket=>days===0?'D+0':days===1?'D+1':days===2?'D+2':days===3?'D+3':days<=7?'D+4–7':'D+8+';
const delayBucket=(days:number)=>days===0?'D+0':days===1?'D+1':days===2?'D+2':days===3?'D+3':'D+4+';

export function calculateOperationalMetrics(movements:CandidateMovement[],groups:ReconciledGroup[],ruleVersion:string):MetricEnvelope<OperationalMetrics>{
  const calculatedAt=new Date().toISOString();
  if(!movements.length)return {state:'completed',ruleVersion,calculatedAt,value:{cutoff:'',totals:{movements:0,reconciled:0,open:0,amountCents:0},openByAge:{'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4–7':0,'D+8+':0},reconciledByDelay:{'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4+':0},averageReconciliationDays:null},error:null};
  const cutoff=movements.reduce((latest,movement)=>movement.accountingDate>latest?movement.accountingDate:latest,movements[0].accountingDate);
  const reconciledIds=new Set(groups.flatMap(group=>group.movementIds));
  const openByAge:OperationalMetrics['openByAge']={'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4–7':0,'D+8+':0};
  for(const movement of movements)if(!reconciledIds.has(movement.id))openByAge[ageBucket(operationalDaysBetween(movement.accountingDate,cutoff))]++;
  const byId=new Map(movements.map(movement=>[movement.id,movement]));
  const reconciledByDelay:OperationalMetrics['reconciledByDelay']={'D+0':0,'D+1':0,'D+2':0,'D+3':0,'D+4+':0};let totalDelay=0,measured=0;
  for(const group of groups){const members=group.movementIds.map(id=>byId.get(id)).filter((row):row is CandidateMovement=>Boolean(row));if(!members.length)continue;const first=members.reduce((v,row)=>row.accountingDate<v?row.accountingDate:v,members[0].accountingDate),last=members.reduce((v,row)=>row.accountingDate>v?row.accountingDate:v,members[0].accountingDate),delay=operationalDaysBetween(first,last);reconciledByDelay[delayBucket(delay)]+=members.length;totalDelay+=delay;measured++;}
  return {state:'completed',ruleVersion,calculatedAt,value:{cutoff,totals:{movements:movements.length,reconciled:reconciledIds.size,open:movements.length-reconciledIds.size,amountCents:movements.reduce((sum,row)=>sum+row.amountCents,0)},openByAge,reconciledByDelay,averageReconciliationDays:measured?totalDelay/measured:null},error:null};
}

export const pendingMetric=<T>(ruleVersion:string):MetricEnvelope<T>=>({state:'pending',ruleVersion,calculatedAt:null,value:null,error:null});

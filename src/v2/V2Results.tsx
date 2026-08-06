import {AlertTriangle,CheckCircle2,Clock3,Layers3} from 'lucide-react';
import type {V2Dashboard} from './database';
import './v2-results.css';

const number=(value:unknown)=>Number(value??0);
export default function V2Results({dashboard}:{dashboard:V2Dashboard}){
  const result=dashboard.result??{},totals=(result.totals??{}) as Record<string,unknown>,ages=(result.openByAge??{}) as Record<string,unknown>,delays=(result.reconciledByDelay??{}) as Record<string,unknown>;
  const cards=[['Movimentos',number(totals.movements),Layers3,'total'],['Reconciliados',number(totals.reconciled),CheckCircle2,'good'],['Em aberto',number(totals.open),Clock3,'warn'],['Anomalias MRSALD',number(totals.balance_anomalies),AlertTriangle,'bad']] as const;
  const ageKeys=['D+0','D+1','D+2','D+3','D+4–7','D+8+'],delayKeys=['D+0','D+1','D+2','D+3','D+4+'];
  return <div className="results-shell v2-results">
    <section className="v2-result-head"><div><p className="eyebrow">REAL TIME V2 · {dashboard.ruleVersion}</p><h2>Reconciliação concluída</h2></div><p>Calculado em {dashboard.calculatedAt?new Date(dashboard.calculatedAt).toLocaleString('pt-PT'):'—'}.</p></section>
    <section className="v2-main-metrics">{cards.map(([label,value,Icon,tone])=><article className={`v2-kpi ${tone}`} key={label}><span className="v2-kpi-icon"><Icon size={19}/></span><div><small>{label}</small><strong>{value.toLocaleString('pt-AO')}</strong></div></article>)}</section>
    <div className="v2-compact-panels">
      <section className="v2-compact-panel"><header><div><p className="eyebrow">PENDÊNCIAS</p><h3>Em aberto por antiguidade</h3></div><Clock3 size={20}/></header><div className="v2-bucket-grid">{ageKeys.map((key,index)=><article className={`traffic-${Math.min(index,3)}`} key={key}><span>{key}</span><strong>{number(ages[key]).toLocaleString('pt-AO')}</strong><small>movimentos</small></article>)}</div></section>
      <section className="v2-compact-panel"><header><div><p className="eyebrow">RECONCILIAÇÃO</p><h3>Grupos fechados por prazo</h3></div><CheckCircle2 size={20}/></header><div className="v2-bucket-grid five">{delayKeys.map((key,index)=><article className={`closed-${Math.min(index,3)}`} key={key}><span>{key}</span><strong>{number(delays[key]).toLocaleString('pt-AO')}</strong><small>grupos</small></article>)}</div></section>
    </div>
  </div>;
}

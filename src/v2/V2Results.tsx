import {AlertTriangle,CheckCircle2,Clock3,Layers3} from 'lucide-react';
import type {V2Dashboard} from './database';
import './v2-results.css';

const number=(value:unknown)=>Number(value??0);
export default function V2Results({dashboard}:{dashboard:V2Dashboard}){
  const result=dashboard.result??{},totals=(result.totals??{}) as Record<string,unknown>,ages=(result.openByAge??{}) as Record<string,unknown>,delays=(result.reconciledByDelay??{}) as Record<string,unknown>,reconciliations=(result.reconciliationsByDelay??{}) as Record<string,unknown>;
  const cards=[['Movimentos',number(totals.movements),Layers3,'total'],['Reconciliados',number(totals.reconciled),CheckCircle2,'good'],['Em aberto',number(totals.open),Clock3,'warn'],['Anomalias na evolução do saldo',number(totals.balance_anomalies),AlertTriangle,'bad']] as const;
  const ageKeys=['D+0','D+1','D+2','D+3','D+4–7','D+8+'],delayKeys=['D+0','D+1','D+2','D+3','D+4+'];
  const openTotal=ageKeys.reduce((sum,key)=>sum+number(ages[key]),0);
  const reconciliationTotal=delayKeys.reduce((sum,key)=>sum+number(reconciliations[key]),0);
  return <div className="results-shell v2-results">
    <section className="v2-result-head"><div><h2>Reconciliação concluída</h2></div><p>Calculado em {dashboard.calculatedAt?new Date(dashboard.calculatedAt).toLocaleString('pt-PT'):'—'}.</p></section>
    <section className="v2-main-metrics">{cards.map(([label,value,Icon,tone])=><article className={`v2-kpi ${tone}`} key={label}><span className="v2-kpi-icon"><Icon size={19}/></span><div><small>{label}</small><strong>{value.toLocaleString('pt-AO')}</strong></div></article>)}</section>
    <div className="v2-compact-panels">
      <section className="v2-compact-panel"><header><div><p className="eyebrow">MOVIMENTOS</p><h3>Abertos por antiguidade</h3></div><Clock3 size={20}/></header><div className="v2-bucket-grid">{ageKeys.map((key,index)=>{const value=number(ages[key]),rate=openTotal?value/openTotal*100:0;return <article className={`traffic-${Math.min(index,3)}`} key={key}><span>{key}</span><strong>{value.toLocaleString('pt-AO')}</strong><small>{rate.toFixed(1)}% dos movimentos abertos</small><div className="v2-percent-track"><i style={{width:`${rate}%`}}/></div></article>})}</div></section>
      <section className="v2-compact-panel"><header><div><p className="eyebrow">RECONCILIAÇÃO</p><h3>Movimentos fechados por prazo</h3></div><CheckCircle2 size={20}/></header><div className="v2-bucket-grid five">{delayKeys.map((key,index)=>{const movements=number(delays[key]),closed=number(reconciliations[key]),rate=reconciliationTotal?closed/reconciliationTotal*100:0;return <article className={`closed-${Math.min(index,3)}`} key={key}><span>{key}</span><strong>{rate.toFixed(1)}%</strong><small>{closed.toLocaleString('pt-AO')} reconciliações <em>({movements.toLocaleString('pt-AO')} movimentos)</em></small><div className="v2-percent-track"><i style={{width:`${rate}%`}}/></div></article>})}</div></section>
    </div>
  </div>;
}

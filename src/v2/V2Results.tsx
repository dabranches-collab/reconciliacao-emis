import {AlertTriangle,CheckCircle2,Clock3,Layers3} from 'lucide-react';
import type {V2Dashboard} from './database';

const number=(value:unknown)=>Number(value??0);
export default function V2Results({dashboard}:{dashboard:V2Dashboard}){
  const result=dashboard.result??{},totals=(result.totals??{}) as Record<string,unknown>,ages=(result.openByAge??{}) as Record<string,unknown>,delays=(result.reconciledByDelay??{}) as Record<string,unknown>;
  const cards=[['Movimentos',number(totals.movements),Layers3],['Reconciliados',number(totals.reconciled),CheckCircle2],['Em aberto',number(totals.open),Clock3],['Anomalias MRSALD',number(totals.balance_anomalies),AlertTriangle]] as const;
  return <div className="results-shell v2-results">
    <section className="section-heading"><div><p className="eyebrow">REAL TIME V2 · {dashboard.ruleVersion}</p><h2>Reconciliação concluída</h2></div><p>Indicadores calculados centralmente em {dashboard.calculatedAt?new Date(dashboard.calculatedAt).toLocaleString('pt-PT'):'—'}.</p></section>
    <section className="metrics-grid">{cards.map(([label,value,Icon])=><article className="metric" key={label}><Icon size={20}/><span>{label}</span><strong>{value.toLocaleString('pt-AO')}</strong></article>)}</section>
    <section className="aging-section"><div className="section-heading"><div><p className="eyebrow">PENDÊNCIAS</p><h2>Em aberto por dias úteis</h2></div></div><div className="aging-grid">{['D+0','D+1','D+2','D+3','D+4–7','D+8+'].map(key=><article key={key}><span>{key}</span><strong>{number(ages[key]).toLocaleString('pt-AO')}</strong><small>movimentos em aberto</small></article>)}</div></section>
    <section className="timing-section"><div className="section-heading"><div><p className="eyebrow">TEMPO DE RECONCILIAÇÃO</p><h2>Grupos fechados por dias úteis</h2></div></div><div className="timing-widgets">{['D+0','D+1','D+2','D+3','D+4+'].map(key=><article key={key}><span>{key}</span><strong>{number(delays[key]).toLocaleString('pt-AO')}</strong><small>grupos reconciliados</small></article>)}</div></section>
  </div>;
}

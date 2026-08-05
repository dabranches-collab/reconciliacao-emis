import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, Database, TrendingUp } from 'lucide-react';
import { currentHistory, loadHistory, type HistorySnapshot } from './lib/history';

const date = (value:string) => new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
const addDay = (value:string,days:number) => { const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10); };

export default function RealTimeOverview({revision}:{revision:number}){
  void revision; const history=currentHistory(loadHistory()); const first=history[0],last=history.at(-1);
  const gaps:{from:string;to:string}[]=[]; for(let i=1;i<history.length;i++){const expected=addDay(history[i-1].reportDate,1);if(history[i].periodStart>expected)gaps.push({from:expected,to:addDay(history[i].periodStart,-1)});}
  const avg=(pick:(item:HistorySnapshot)=>number)=>history.length?history.reduce((sum,item)=>sum+pick(item),0)/history.length:0;
  const avgRate=history.length?history.reduce((sum,item)=>sum+(item.totals.movements?item.totals.automatic/item.totals.movements:0),0)/history.length*100:0;
  return <section className="rt-overview"><div className="overview-head"><div><p className="eyebrow">VISÃO PERMANENTE</p><h2>Estado da Reconciliação Real Time</h2><p>{history.length?'Indicadores calculados pelas fotografias válidas dos extratos importados.':'Importe o primeiro extrato para iniciar a série histórica.'}</p></div><span className={gaps.length?'coverage-alert':'coverage-ok'}>{gaps.length?<><AlertTriangle size={16}/>{gaps.length} intervalo{gaps.length>1?'s':''} em falta</>:<><CheckCircle2 size={16}/>Cobertura contínua</>}</span></div><div className="overview-metrics">
    <article><Database/><span>Média por extrato</span><strong>{Math.round(avg(item=>item.totals.movements)).toLocaleString('pt-AO')}</strong><small>movimentos</small></article>
    <article><TrendingUp/><span>Reconciliação média</span><strong>{avgRate.toFixed(1)}%</strong><small>automática por IDTR</small></article>
    <article><Clock3/><span>Média de pendentes</span><strong>{Math.round(avg(item=>item.totals.unreconciled)).toLocaleString('pt-AO')}</strong><small>por fotografia</small></article>
    <article><CalendarRange/><span>Primeira data coberta</span><strong>{first?date(first.periodStart):'—'}</strong><small>{first?`até ${date(first.reportDate)}`:'sem dados'}</small></article>
    <article><CalendarRange/><span>Última data coberta</span><strong>{last?date(last.reportDate):'—'}</strong><small>{last?`desde ${date(last.periodStart)}`:'sem dados'}</small></article>
    <article><Clock3/><span>Último carregamento</span><strong>{last?new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(last.lastUploadedAt)):'—'}</strong><small>{last?.uploadedBy??'sem dados'}</small></article>
  </div>{gaps.length>0&&<div className="coverage-gaps"><AlertTriangle size={18}/><div><strong>Existem períodos sem dados</strong><p>{gaps.map(g=>`${date(g.from)} a ${date(g.to)}`).join(' · ')}</p></div></div>}</section>;
}

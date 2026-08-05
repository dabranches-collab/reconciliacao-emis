import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, Database, TrendingUp } from 'lucide-react';
import { currentHistory, loadHistory } from './lib/history';

const date = (value:string) => new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
const addDay = (value:string,days:number) => { const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10); };

export default function RealTimeOverview({revision}:{revision:number}){
  void revision; const history=currentHistory(loadHistory()); const lastUpload=history.at(-1);
  const dailyMap=new Map<string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}>();
  for(const snapshot of history) for(const [day,value] of Object.entries(snapshot.dailyMetrics??{})) dailyMap.set(day,value);
  const dailyDates=[...dailyMap.keys()].sort(),firstDay=dailyDates[0],lastDay=dailyDates.at(-1);
  const gaps:{from:string;to:string}[]=[]; for(let i=1;i<dailyDates.length;i++){const expected=addDay(dailyDates[i-1],1);if(dailyDates[i]>expected)gaps.push({from:expected,to:addDay(dailyDates[i],-1)});}
  const daily=[...dailyMap.values()];
  const avgDaily=daily.length?daily.reduce((sum,item)=>sum+item.movements,0)/daily.length:null;
  const dailyMovements=daily.reduce((sum,item)=>sum+item.movements,0),dailyAutomatic=daily.reduce((sum,item)=>sum+item.automatic,0);
  const avgRate=dailyMovements?dailyAutomatic/dailyMovements*100:null;
  const maxDaily=daily.length?Math.max(...daily.map(item=>item.movements)):null;
  return <section className={`rt-overview ${gaps.length?'has-coverage-gap':''}`}>{gaps.length>0&&<div className="coverage-critical" role="alert"><AlertTriangle size={28}/><div><strong>ATENÇÃO — EXISTEM DIAS SEM DADOS NA SÉRIE</strong><p>{gaps.map(g=>`${date(g.from)} a ${date(g.to)}`).join(' · ')}</p></div><span>DADOS DIÁRIOS EM FALTA</span></div>}<div className="overview-head"><div><p className="eyebrow">VISÃO PERMANENTE</p><h2>Estado da Reconciliação Real Time</h2><p>{dailyDates.length?'Indicadores calculados pela série diária consolidada.':'Importe ou reimporte os extratos para construir a série diária.'}</p></div><span className={gaps.length?'coverage-alert':'coverage-ok'}>{gaps.length?<><AlertTriangle size={16}/>{gaps.length} intervalo{gaps.length>1?'s':''} em falta</>:dailyDates.length?<><CheckCircle2 size={16}/>Série diária contínua</>:<><Clock3 size={16}/>Sem dados diários</>}</span></div><div className="overview-metrics">
    <article><Database/><span>Média diária</span><strong>{avgDaily===null?'—':Math.round(avgDaily).toLocaleString('pt-AO')}</strong><small>{avgDaily===null?'reimporte os extratos':`${daily.length} dias por MRDATL`}</small></article>
    <article><TrendingUp/><span>Reconciliação média diária</span><strong>{avgRate===null?'—':`${avgRate.toFixed(1)}%`}</strong><small>automática por IDTR</small></article>
    <article><Clock3/><span>Maior volume diário</span><strong>{maxDaily===null?'—':maxDaily.toLocaleString('pt-AO')}</strong><small>{maxDaily===null?'reimporte os extratos':'movimentos num dia'}</small></article>
    <article><CalendarRange/><span>Primeiro dia na base</span><strong>{firstDay?date(firstDay):'—'}</strong><small>{firstDay?'primeiro MRDATL consolidado':'sem dados diários'}</small></article>
    <article><CalendarRange/><span>Último dia na base</span><strong>{lastDay?date(lastDay):'—'}</strong><small>{lastDay?`${dailyDates.length} dias disponíveis`:'sem dados diários'}</small></article>
    <article><Clock3/><span>Último carregamento</span><strong>{lastUpload?new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(lastUpload.lastUploadedAt)):'—'}</strong><small>{lastUpload?.uploadedBy??'sem dados'}</small></article>
  </div></section>;
}

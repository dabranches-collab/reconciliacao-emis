import { useState } from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, Clock3, Database, TrendingUp } from 'lucide-react';
import type { AnalysisResult } from './types';

const date = (value:string) => new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
const addDay = (value:string,days:number) => { const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10); };
const isBusinessDay = (value:string) => { const weekday=new Date(`${value}T12:00:00`).getDay(); return weekday!==0&&weekday!==6; };
const daysBetween = (from:string,to:string) => { const days:string[]=[]; for(let day=from;day<=to;day=addDay(day,1)) if(isBusinessDay(day)) days.push(day); return days; };
const chartMaxEntry=(entries:[string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}][])=>entries.reduce<(typeof entries)[number]|undefined>((maximum,current)=>!maximum||current[1].movements>maximum[1].movements?current:maximum,undefined);

type CentralResult = AnalysisResult & { lastUploadedAt?:string; uploadedBy?:string };
export default function RealTimeOverview({revision,result}:{revision:number;result:CentralResult|null}){
  const [showGaps,setShowGaps]=useState(false);
  void revision;
  const dailyMap=new Map<string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}>();
  for(const [day,value] of Object.entries(result?.dailyMetrics??{})) dailyMap.set(day,value);
  const dailyDates=[...dailyMap.keys()].sort(),firstDay=dailyDates[0],lastDay=dailyDates.at(-1);
  const gaps:{from:string;to:string}[]=[]; for(let i=1;i<dailyDates.length;i++){const from=addDay(dailyDates[i-1],1),to=addDay(dailyDates[i],-1),missing=daysBetween(from,to);if(missing.length)gaps.push({from:missing[0],to:missing.at(-1)!});}
  const daily=[...dailyMap.values()];
  const avgDaily=daily.length?daily.reduce((sum,item)=>sum+item.movements,0)/daily.length:null;
  const dailyMovements=daily.reduce((sum,item)=>sum+item.movements,0),dailyAutomatic=daily.reduce((sum,item)=>sum+item.automatic,0);
  const avgRate=dailyMovements?dailyAutomatic/dailyMovements*100:null;
  const maxDailyEntry=chartMaxEntry([...dailyMap.entries()]);
  const maxDaily=maxDailyEntry?.[1].movements??null,maxDailyDate=maxDailyEntry?.[0];
  return <section className={`rt-overview ${gaps.length?'has-coverage-gap':''}`}>{gaps.length>0&&<><button className={`coverage-critical ${showGaps?'expanded':''}`} type="button" role="alert" aria-expanded={showGaps} onClick={()=>setShowGaps(value=>!value)}><AlertTriangle size={28}/><div><strong>ATENÇÃO — EXISTEM DIAS SEM DADOS NA SÉRIE</strong><p>{gaps.length} intervalo{gaps.length>1?'s':''}, num total de {gaps.reduce((sum,gap)=>sum+daysBetween(gap.from,gap.to).length,0)} dias sem movimentos. Clique para {showGaps?'fechar':'ver o detalhe'}.</p></div><span>VER INTERVALOS <ChevronDown size={16}/></span></button>{showGaps&&<div className="coverage-details">{gaps.map((gap,index)=>{const missingDays=daysBetween(gap.from,gap.to),before=addDay(gap.from,-1),after=addDay(gap.to,1),beforeData=dailyMap.get(before),afterData=dailyMap.get(after);return <article key={`${gap.from}-${gap.to}`}><div className="gap-heading"><span>INTERVALO {index+1}</span><strong>{date(gap.from)} a {date(gap.to)}</strong><b>{missingDays.length} dia{missingDays.length>1?'s':''} em falta</b></div><div className="gap-context"><div><small>Último dia anterior com dados</small><strong>{date(before)}</strong><span>{beforeData?.movements.toLocaleString('pt-AO')??'—'} movimentos</span></div><div className="missing-days"><small>Dias sem dados</small><div>{missingDays.map(day=><span key={day}>{date(day)}</span>)}</div></div><div><small>Primeiro dia seguinte com dados</small><strong>{date(after)}</strong><span>{afterData?.movements.toLocaleString('pt-AO')??'—'} movimentos</span></div></div><p>Verifique se existe um extrato que cubra estes dias. Se existir, importe-o; a plataforma integrará apenas os movimentos ainda não registados.</p></article>})}</div>}</>}<div className="overview-head"><div><p className="eyebrow">VISÃO PERMANENTE</p><h2>Estado da Reconciliação Real Time</h2><p>{dailyDates.length?'Indicadores calculados pela série diária consolidada.':'Importe ou reimporte os extratos para construir a série diária.'}</p></div><button type="button" className={gaps.length?'coverage-alert':'coverage-ok'} onClick={()=>gaps.length&&setShowGaps(value=>!value)}>{gaps.length?<><AlertTriangle size={16}/>{gaps.length} intervalo{gaps.length>1?'s':''} em falta</>:dailyDates.length?<><CheckCircle2 size={16}/>Série diária contínua</>:<><Clock3 size={16}/>Sem dados diários</>}</button></div><div className="overview-metrics">
    <article><Database/><span>Média diária</span><strong>{avgDaily===null?'—':Math.round(avgDaily).toLocaleString('pt-AO')}</strong><small>{avgDaily===null?'reimporte os extratos':`${daily.length} dias por MRDATL`}</small></article>
    <article><TrendingUp/><span>Reconciliação média diária</span><strong>{avgRate===null?'—':`${avgRate.toFixed(1)}%`}</strong><small>automática por IDTR</small></article>
    <article><Clock3/><span>Maior volume diário</span><strong>{maxDaily===null?'—':maxDaily.toLocaleString('pt-AO')}</strong><small>{maxDailyDate?`${date(maxDailyDate)} · máximo entre ${daily.length} dias`:'sem dados diários'}</small></article>
    <article><CalendarRange/><span>Primeiro dia na base</span><strong>{firstDay?date(firstDay):'—'}</strong><small>{firstDay?'primeiro MRDATL consolidado':'sem dados diários'}</small></article>
    <article><CalendarRange/><span>Último dia na base</span><strong>{lastDay?date(lastDay):'—'}</strong><small>{lastDay?`${dailyDates.length} dias disponíveis`:'sem dados diários'}</small></article>
    <article><Clock3/><span>Último carregamento</span><strong>{result?.lastUploadedAt?new Intl.DateTimeFormat('pt-AO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(result.lastUploadedAt)):'—'}</strong><small>{result?.uploadedBy??'sem dados centrais'}</small></article>
  </div></section>;
}

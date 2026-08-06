import {useCallback,useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,Clock3,Database,LoaderCircle} from 'lucide-react';
import {supabase} from '../lib/supabase';
import './v2-movements.css';

type StateFilter='open'|'reconciled'|'all';
type Movement={id:number;accounting_date:string;system_date:string|null;system_time:string|null;operation_number:string|null;raw_description:string|null;amount:number;balance:number|null;native_idtr:string|null;reference_26:string|null;status:string;reconciliation_method:string|null};
const PAGE=1000;
export default function V2Movements(){
  const [seriesId,setSeriesId]=useState<string|null>(null),[filter,setFilter]=useState<StateFilter>('open'),[rows,setRows]=useState<Movement[]>([]),[total,setTotal]=useState(0),[counts,setCounts]=useState({all:0,open:0,reconciled:0}),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;void supabase.from('rt_v2_series').select('id').order('created_at',{ascending:true}).limit(1).maybeSingle().then(({data,error})=>{if(!active)return;if(error)setError(error.message);else setSeriesId(data?.id??null);});return()=>{active=false};},[]);
  const load=useCallback(async(reset:boolean)=>{if(!seriesId)return;reset?setLoading(true):setLoadingMore(true);setError('');try{
    let query=supabase.from('rt_v2_movements').select('id,accounting_date,system_date,system_time,operation_number,raw_description,amount,balance,native_idtr,reference_26,status,reconciliation_method',{count:'exact'}).eq('series_id',seriesId).order('accounting_date',{ascending:false}).order('id',{ascending:false});
    if(filter!=='all')query=query.eq('status',filter);const from=reset?0:rows.length,response=await query.range(from,from+PAGE-1);if(response.error)throw response.error;setRows(previous=>reset?(response.data as Movement[]):[...previous,...(response.data as Movement[])]);setTotal(response.count??0);
  }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível carregar os movimentos V2.');}finally{setLoading(false);setLoadingMore(false);}},[seriesId,filter,rows.length]);
  useEffect(()=>{if(!seriesId)return;void Promise.all([
    supabase.from('rt_v2_movements').select('id',{count:'exact',head:true}).eq('series_id',seriesId),
    supabase.from('rt_v2_movements').select('id',{count:'exact',head:true}).eq('series_id',seriesId).eq('status','open'),
    supabase.from('rt_v2_movements').select('id',{count:'exact',head:true}).eq('series_id',seriesId).eq('status','reconciled'),
  ]).then(([all,open,reconciled])=>setCounts({all:all.count??0,open:open.count??0,reconciled:reconciled.count??0}));},[seriesId]);
  useEffect(()=>{if(seriesId)void load(true);},[seriesId,filter]);
  const choose=(value:StateFilter)=>{setRows([]);setFilter(value)};
  return <section className="panel v2-movements">
    <div className="v2-movement-summary"><button className={filter==='open'?'active warn':''} onClick={()=>choose('open')}><Clock3/><span>Pendentes</span><strong>{counts.open.toLocaleString('pt-AO')}</strong></button><button className={filter==='reconciled'?'active good':''} onClick={()=>choose('reconciled')}><CheckCircle2/><span>Reconciliados</span><strong>{counts.reconciled.toLocaleString('pt-AO')}</strong></button><button className={filter==='all'?'active total':''} onClick={()=>choose('all')}><Database/><span>Todos</span><strong>{counts.all.toLocaleString('pt-AO')}</strong></button></div>
    <div className="panel-head"><div><h2>Movimentos V2</h2><p>A mostrar {rows.length.toLocaleString('pt-AO')} de {total.toLocaleString('pt-AO')} movimentos no filtro selecionado.</p></div>{loading&&<LoaderCircle className="spinning"/>}</div>
    {error&&<div className="error"><AlertTriangle size={18}/>{error}</div>}
    <div className="table-wrap"><table><thead><tr><th>Período contabilístico</th><th>Data/hora sistema</th><th>Operação</th><th>Descrição original</th><th>Valor</th><th>Saldo</th><th>IDTR nativo</th><th>Referência /26</th><th>Estado</th><th>Método</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.accounting_date}</td><td>{row.system_date??'—'} {row.system_time??''}</td><td className="mono">{row.operation_number??'—'}</td><td>{row.raw_description??'—'}</td><td className="amount">{Number(row.amount).toLocaleString('pt-AO',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="amount">{row.balance===null?'—':Number(row.balance).toLocaleString('pt-AO',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="mono">{row.native_idtr??'—'}</td><td className="mono">{row.reference_26??'—'}</td><td><span className={`badge ${row.status==='reconciled'?'automatic':'unreconciled'}`}>{row.status==='reconciled'?'Reconciliado':'Pendente'}</span></td><td>{row.reconciliation_method==='idtr'?'IDTR':row.reconciliation_method==='operation_description'?'Operação + descrição + valor':row.reconciliation_method??'—'}</td></tr>)}</tbody></table></div>
    {rows.length<total&&<footer><button className="primary-button" disabled={loadingMore} onClick={()=>void load(false)}>{loadingMore?<><LoaderCircle className="spinning"/> A carregar…</>:`Carregar mais ${Math.min(PAGE,total-rows.length).toLocaleString('pt-AO')} linhas`}</button><span>{rows.length.toLocaleString('pt-AO')} / {total.toLocaleString('pt-AO')}</span></footer>}
  </section>;
}

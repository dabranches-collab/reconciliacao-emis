import { useMemo } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Files } from 'lucide-react';
import { currentHistory, loadHistory } from './lib/history';

const labels: Record<string,string> = { pos:'POS', atm:'ATM', transfer:'Transferências', commission:'Comissões', service:'Serviços', other:'Outros' };
const points = (values:number[], width=800, height=170) => values.map((value,index) => `${values.length === 1 ? width/2 : index*(width/(values.length-1))},${height-(value/Math.max(1,...values))*height}`).join(' ');

export default function HistoryDashboard({ revision }: { revision: number }) {
  const all = useMemo(() => loadHistory(), [revision]); const days = currentHistory(all); const latest = days.at(-1); const previous = days.at(-2);
  if (!latest) return <section className="panel empty-state"><Files size={28}/><h2>Ainda não existem análises guardadas</h2><p>O primeiro ficheiro concluído criará a primeira fotografia diária.</p></section>;
  const rate = latest.totals.movements ? latest.totals.automatic/latest.totals.movements*100 : 0;
  const previousPending = previous?.totals.unreconciled ?? latest.totals.unreconciled;
  const pendingChange = previousPending ? (latest.totals.unreconciled-previousPending)/previousPending*100 : 0;
  const alerts = Math.abs(pendingChange) >= 30 ? 1 : 0;
  const dailyMap=new Map<string,{movements:number;automatic:number;unreconciled:number;missingIdtr:number;amount:number}>();
  for(const snapshot of days) for(const [date,value] of Object.entries(snapshot.dailyMetrics??{})) dailyMap.set(date,value);
  const chartDays=[...dailyMap.entries()].sort(([a],[b])=>a.localeCompare(b));
  return <div className="history-page">
    <section className="history-kpis"><article><CalendarDays/><span>Dias analisados</span><strong>{chartDays.length}</strong></article><article><CheckCircle2/><span>Taxa reconciliada atual</span><strong>{rate.toFixed(1)}%</strong></article><article><Files/><span>Versões carregadas</span><strong>{all.length}</strong></article><article className={alerts?'alert':''}><AlertTriangle/><span>Alertas de variação</span><strong>{alerts}</strong></article></section>
    {chartDays.length?<section className="history-chart panel"><div className="panel-head"><div><h2>Movimentos processados por dia</h2><p>Um ponto por data contabilística <code>MRDATL</code>, não por ficheiro</p></div></div><svg viewBox="0 0 800 210" role="img" aria-label="Evolução diária do total de movimentos"><polyline className="total-line" points={points(chartDays.map(([,value])=>value.movements))}/>{chartDays.map(([date],index)=><text key={date} x={chartDays.length===1?400:index*(800/(chartDays.length-1))} y="202" textAnchor={index===0?'start':index===chartDays.length-1?'end':'middle'}>{date.slice(5)}</text>)}</svg><div className="history-legend"><span className="total">Movimentos do dia</span></div></section>:<section className="anomaly-alert"><CalendarDays/><div><strong>Dados diários ainda não calculados</strong><p>As importações existentes são anteriores à agregação diária. Reimporte os extratos para gerar um ponto real por cada MRDATL. O sistema não apresentará fotografias semanais como se fossem dias.</p></div></section>}
    {alerts>0&&<section className="anomaly-alert"><AlertTriangle/><div><strong>Variação fora do habitual</strong><p>Os não reconciliados variaram {pendingChange.toFixed(1)}% face à fotografia anterior. Convém verificar a composição por tipo.</p></div></section>}
    <section className="history-types"><div className="section-heading"><div><p className="eyebrow">ÚLTIMA IMPORTAÇÃO</p><h2>Composição por natureza</h2></div></div><div className="history-type-grid">{Object.entries(labels).map(([key,label])=>{const now=latest.movementTypes[key]?.total??0;return <article key={key}><span>{label}</span><strong>{now.toLocaleString('pt-AO')}</strong><small>movimentos no último extrato</small></article>})}</div></section>
    <section className="panel"><div className="panel-head"><div><h2>Importações e versões</h2><p>As versões substituídas mantêm-se apenas para auditoria</p></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Versão</th><th>Ficheiro</th><th>Carregamentos</th><th>Utilizador</th><th>Estado</th></tr></thead><tbody>{[...all].sort((a,b)=>b.lastUploadedAt.localeCompare(a.lastUploadedAt)).map(item=><tr key={item.id}><td>{item.reportDate}</td><td>v{item.version}</td><td>{item.filename}</td><td>{item.uploadCount}</td><td>{item.uploadedBy}</td><td><span className={`badge ${item.current?'automatic':'unreconciled'}`}>{item.current?'Fotografia válida':'Substituída'}</span></td></tr>)}</tbody></table></div></section>
  </div>;
}

import { useMemo, useState } from 'react';
import { Activity, FileSpreadsheet, LayoutDashboard, Search, ShieldCheck, Upload, Users } from 'lucide-react';
import type { AnalysisResult, Movement } from './types';
import { analyzeWorkbook } from './lib/excel';

const money = new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' });

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function Results({ result }: { result: AnalysisResult }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => result.movements.filter((m) => filter === 'all' || m.status === filter).slice(0, 250), [result, filter]);
  const statusLabel = (movement: Movement) => ({ automatic: 'Reconciliado automaticamente', manual: 'Reconciliado manualmente', unreconciled: 'Não reconciliado', missing_idtr: 'Sem IDTR', data_error: 'Erro de dados' })[movement.status];
  return <>
    <section className="metrics">
      <Metric label="Movimentos" value={result.totals.movements.toLocaleString('pt-AO')} />
      <Metric label="Reconciliados" value={result.totals.automatic.toLocaleString('pt-AO')} tone="good" />
      <Metric label="Não reconciliados" value={result.totals.unreconciled.toLocaleString('pt-AO')} tone="warn" />
      <Metric label="Sem IDTR" value={result.totals.missingIdtr.toLocaleString('pt-AO')} tone="bad" />
    </section>
    <section className="balance-card">
      <div><span>Saldo dos movimentos</span><strong>{money.format(result.totals.amount)}</strong></div>
      <div><span>Saldo contabilístico</span><strong>{result.accountingBalance === null ? 'Não encontrado' : money.format(result.accountingBalance)}</strong></div>
      <div><span>Diferença</span><strong>{result.accountingBalance === null ? '—' : money.format(result.totals.amount - result.accountingBalance)}</strong></div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Movimentos analisados</h2><p>Reporte de {result.reportDate || 'data não identificada'}</p></div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos os estados</option><option value="automatic">Reconciliados automaticamente</option><option value="unreconciled">Não reconciliados</option><option value="missing_idtr">Sem IDTR</option></select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Data</th><th>IDTR</th><th>Descrição</th><th>Valor</th><th>Estado</th></tr></thead><tbody>{rows.map((m) => <tr key={m.id}><td>{m.row}</td><td>{m.reportDate}</td><td className="mono">{m.idtr ?? '—'}</td><td>{m.description}</td><td className="amount">{money.format(m.amount)}</td><td><span className={`badge ${m.status}`}>{statusLabel(m)}</span></td></tr>)}</tbody></table></div>
      {rows.length === 250 && <p className="table-note">A mostrar os primeiros 250 movimentos do filtro selecionado.</p>}
    </section>
  </>;
}

export default function App() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const process = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { setResult(await analyzeWorkbook(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.'); }
    finally { setBusy(false); }
  };
  return <div className="app-shell">
    <aside><div className="brand"><div className="brand-mark">R</div><div><strong>Reconciliação</strong><span>EMIS Real Time</span></div></div>
      <nav><button className="active"><LayoutDashboard size={19}/>Análise</button><button><FileSpreadsheet size={19}/>Histórico</button><button><Users size={19}/>Utilizadores</button><button><Activity size={19}/>Auditoria</button></nav>
      <div className="admin"><ShieldCheck size={18}/><div><strong>Administrador</strong><span>dabranches@gmail.com</span></div></div>
    </aside>
    <main><header><div><p className="eyebrow">PAINEL OPERACIONAL</p><h1>{result ? 'Resultados da reconciliação' : 'Nova reconciliação'}</h1><p>{result ? 'Consulte os resultados e exceções identificadas.' : 'Arraste o ficheiro diário e receba os resultados automaticamente.'}</p></div><button className="icon-button" title="Pesquisar"><Search size={20}/></button></header>
      {!result && <section className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void process(e.dataTransfer.files[0]); }}>
        <div className="upload-icon"><Upload size={30}/></div><h2>{busy ? 'A processar o ficheiro…' : 'Arraste o ficheiro Excel para aqui'}</h2><p>A plataforma identifica automaticamente a data, movimentos, IDTR e saldo contabilístico.</p><label className="primary-button">Selecionar ficheiro<input type="file" accept=".xlsx,.xls,.xlsm" disabled={busy} onChange={(e) => void process(e.target.files?.[0])}/></label><small>Formatos aceites: XLSX, XLS e XLSM</small>{error && <div className="error">{error}</div>}
      </section>}
      {result && <><div className="actions"><button className="secondary-button" onClick={() => setResult(null)}>Analisar outro ficheiro</button><button className="primary-button">Integrar novos movimentos</button></div><Results result={result}/></>}
    </main>
  </div>;
}

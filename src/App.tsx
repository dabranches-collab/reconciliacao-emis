import { useMemo, useState } from 'react';
import { Activity, ArrowLeftRight, BarChart3, CircleEllipsis, CreditCard, FileSpreadsheet, History, Landmark, ReceiptText, Search, ShieldCheck, Upload, Users, Wrench } from 'lucide-react';
import type { AnalysisResult, Movement } from './types';
import { analyzeWorkbook } from './lib/excel';
import { useAuth } from './AuthGate';

const money = new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' });

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

const movementTypes = [
  { key: 'pos', label: 'Movimentos POS', hint: 'Compras e operações em terminais', icon: CreditCard, color: 'emerald' },
  { key: 'atm', label: 'Movimentos ATM', hint: 'Levantamentos e operações em caixas', icon: Landmark, color: 'blue' },
  { key: 'transfer', label: 'Transferências', hint: 'Transferências, NIB e canais digitais', icon: ArrowLeftRight, color: 'violet' },
  { key: 'commission', label: 'Comissões', hint: 'Comissões e encargos associados', icon: ReceiptText, color: 'orange' },
  { key: 'service', label: 'Serviços', hint: 'Pagamentos e serviços especiais', icon: Wrench, color: 'rose' },
  { key: 'other', label: 'Outros movimentos', hint: 'Restantes naturezas identificadas', icon: CircleEllipsis, color: 'slate' },
] as const;

function movementType(description: string): typeof movementTypes[number]['key'] {
  const text = description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (text.includes('COMISS')) return 'commission';
  if (text.includes('ATM')) return 'atm';
  if (text.includes('POS')) return 'pos';
  if (text.includes('TRANSF') || text.includes('TRF') || text.includes('/NIB') || text.includes('HBMB')) return 'transfer';
  if (text.includes('SERVIC') || text.includes('PAGAMENTO')) return 'service';
  return 'other';
}

function Results({ result }: { result: AnalysisResult }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => result.movements.filter((m) => filter === 'all' || m.status === filter).slice(0, 250), [result, filter]);
  const missingBySheet = useMemo(() => result.movements.reduce((counts, movement) => {
    if (movement.status === 'missing_idtr') movement.id.includes(':REC:') ? counts.rec++ : counts.realTime++;
    return counts;
  }, { realTime: 0, rec: 0 }), [result]);
  const typeSummaries = useMemo(() => {
    const counts = new Map(movementTypes.map((type) => [type.key, { total: 0, reconciled: 0, unreconciled: 0, missingIdtr: 0 }]));
    for (const movement of result.movements) {
      const count = counts.get(movementType(movement.description))!;
      count.total += 1;
      if (movement.status === 'automatic' || movement.status === 'manual') count.reconciled += 1;
      else if (movement.status === 'unreconciled') count.unreconciled += 1;
      else if (movement.status === 'missing_idtr') count.missingIdtr += 1;
    }
    return movementTypes.map((type) => {
      const count = counts.get(type.key)!;
      return { ...type, ...count, rate: count.total ? Math.round((count.reconciled / count.total) * 100) : 0 };
    });
  }, [result]);
  const statusLabel = (movement: Movement) => ({ automatic: 'Reconciliado no ficheiro', manual: 'Reconciliado manualmente na plataforma', unreconciled: 'Não reconciliado', missing_idtr: 'Sem IDTR', data_error: 'Erro de dados' })[movement.status];
  return <>
    <section className="metrics">
      <Metric label="Total movimentos" value={result.totals.movements.toLocaleString('pt-AO')} />
      <Metric label="Reconciliados no ficheiro" value={result.totals.automatic.toLocaleString('pt-AO')} tone="good" />
      <Metric label="Reconciliados manualmente na plataforma" value={result.totals.manual.toLocaleString('pt-AO')} tone="manual" />
      <Metric label="Não reconciliados" value={result.totals.unreconciled.toLocaleString('pt-AO')} tone="warn" />
      <Metric label={`Sem IDTR (${missingBySheet.realTime} REAL TIME + ${missingBySheet.rec} REC)`} value={result.totals.missingIdtr.toLocaleString('pt-AO')} tone="bad" />
    </section>
    <section className="balance-card">
      <div><span>Saldo dos movimentos</span><strong>{money.format(result.totals.amount)}</strong></div>
      <div><span>Saldo contabilístico</span><strong>{result.accountingBalance === null ? 'Não encontrado' : money.format(result.accountingBalance)}</strong></div>
      <div><span>Diferença</span><strong>{result.accountingBalance === null ? '—' : money.format(result.totals.amount - result.accountingBalance)}</strong></div>
    </section>
    <section className="movement-dashboard">
      <div className="section-heading"><div><p className="eyebrow">VISÃO POR NATUREZA</p><h2>Resultados por tipo de movimento</h2></div><p>Distribuição dos estados depois da aplicação automática das regras de reconciliação.</p></div>
      <div className="movement-grid">{typeSummaries.map((type) => {
        const Icon = type.icon;
        return <article className={`movement-card ${type.color}`} key={type.key}>
          <div className="movement-card-head"><div className="movement-icon"><Icon size={23}/></div><div><h3>{type.label}</h3><p>{type.hint}</p></div><strong>{type.total.toLocaleString('pt-AO')}</strong></div>
          <div className="progress-track"><span style={{ width: `${type.rate}%` }}/></div>
          <div className="movement-rate"><span>Taxa reconciliada</span><strong>{type.rate}%</strong></div>
          <div className="movement-states">
            <div className="state-good"><span>Reconciliados</span><strong>{type.reconciled.toLocaleString('pt-AO')}</strong></div>
            <div className="state-warn"><span>Não reconciliados</span><strong>{type.unreconciled.toLocaleString('pt-AO')}</strong></div>
            <div className="state-bad"><span>Sem IDTR</span><strong>{type.missingIdtr.toLocaleString('pt-AO')}</strong></div>
          </div>
        </article>;
      })}</div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Detalhe dos movimentos analisados</h2><p>Reporte de {result.reportDate || 'data não identificada'}</p></div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos os estados</option><option value="automatic">Reconciliados no ficheiro</option><option value="manual">Reconciliados manualmente na plataforma</option><option value="unreconciled">Não reconciliados</option><option value="missing_idtr">Sem IDTR</option></select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Data</th><th>IDTR</th><th>Descrição</th><th>Valor</th><th>Estado</th></tr></thead><tbody>{rows.map((m) => <tr key={m.id}><td>{m.row}</td><td>{m.reportDate}</td><td className="mono">{m.idtr ?? '—'}</td><td>{m.description}</td><td className="amount">{money.format(m.amount)}</td><td><span className={`badge ${m.status}`}>{statusLabel(m)}</span></td></tr>)}</tbody></table></div>
      {rows.length === 250 && <p className="table-note">A mostrar os primeiros 250 movimentos do filtro selecionado.</p>}
    </section>
  </>;
}

export default function App() {
  const identity = useAuth();
  const [view, setView] = useState<'import' | 'results' | 'history' | 'users' | 'audit'>('import');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const process = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { setResult(await analyzeWorkbook(file)); setView('results'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.'); }
    finally { setBusy(false); }
  };
  const pageTitle = view === 'import' ? 'Nova reconciliação' : view === 'results' ? 'Resultados da reconciliação' : view === 'history' ? 'Histórico de análises' : view === 'users' ? 'Gestão de utilizadores' : 'Auditoria da plataforma';
  const pageDescription = view === 'import' ? 'Arraste o ficheiro diário e receba os resultados automaticamente.' : view === 'results' ? 'Consulte os resultados e exceções identificadas.' : view === 'history' ? 'Consulte os carregamentos e resultados anteriores.' : view === 'users' ? 'Crie, edite, ative ou bloqueie utilizadores.' : 'Consulte ações, reconciliações e exportações realizadas.';
  return <div className="app-shell">
    <aside><div className="brand"><div className="brand-mark">R</div><div><strong>Reconciliação</strong><span>EMIS Real Time</span></div></div>
      <nav><button className={view === 'results' ? 'active' : ''} disabled={!result} title={result ? 'Voltar aos resultados da reconciliação' : 'Carregue primeiro um ficheiro'} onClick={() => setView('results')}><BarChart3 size={19}/>Resultados</button><button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={19}/>Histórico</button>{identity.isAdmin && <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><Users size={19}/>Utilizadores</button>}{identity.isAdmin && <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><Activity size={19}/>Auditoria</button>}<button className={`nav-import ${view === 'import' ? 'active' : ''}`} onClick={() => setView('import')}><Upload size={19}/>Importar ficheiro</button></nav>
      <div className="admin" title={identity.email}><ShieldCheck size={18}/><div><strong>{identity.name}</strong><span>{identity.isAdmin ? 'Administrador' : identity.role === 'auditor' ? 'Auditor' : 'Analista'}</span></div></div>
    </aside>
    <main><header><div><p className="eyebrow">PAINEL OPERACIONAL</p><h1>{pageTitle}</h1><p>{pageDescription}</p></div><button className="icon-button" title="Pesquisar"><Search size={20}/></button></header>
      {view === 'import' && <section className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void process(e.dataTransfer.files[0]); }}>
        <div className="upload-icon"><Upload size={30}/></div><h2>{busy ? 'A processar o ficheiro…' : 'Arraste o ficheiro Excel para aqui'}</h2><p>A plataforma identifica automaticamente a data, movimentos, IDTR e saldo contabilístico.</p><label className="primary-button">Selecionar ficheiro<input type="file" accept=".xlsx,.xls,.xlsm" disabled={busy} onChange={(e) => void process(e.target.files?.[0])}/></label><small>Formatos aceites: XLSX, XLS e XLSM</small>{error && <div className="error">{error}</div>}
      </section>}
      {view === 'results' && result && <><div className="actions"><button className="secondary-button" onClick={() => setView('import')}>Analisar outro ficheiro</button><button className="primary-button">Integrar novos movimentos</button></div><Results result={result}/></>}
      {view === 'history' && <section className="panel empty-state"><FileSpreadsheet size={28}/><h2>Ainda não existem análises guardadas</h2><p>Os carregamentos persistidos aparecerão aqui por data e lote.</p><button className="primary-button" onClick={() => setView('import')}>Importar primeiro ficheiro</button></section>}
      {view === 'users' && identity.isAdmin && <section className="panel empty-state"><Users size={28}/><h2>Gestão reservada ao administrador</h2><p>A criação e edição de utilizadores será ligada ao Supabase neste ecrã.</p></section>}
      {view === 'audit' && identity.isAdmin && <section className="panel empty-state"><Activity size={28}/><h2>Log de utilização</h2><p>As ações da plataforma serão apresentadas aqui com filtros e exportação.</p></section>}
    </main>
  </div>;
}

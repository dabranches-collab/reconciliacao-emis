import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeftRight, BarChart3, BookOpen, CheckCircle2, CircleEllipsis, Clock3, CreditCard, Grid2X2, History, Landmark, ReceiptText, Search, ShieldCheck, Upload, Users, Wrench } from 'lucide-react';
import type { AnalysisResult, Movement } from './types';
import { analyzeWorkbook, type AnalysisProgress } from './lib/excel';
import { useAuth } from './AuthGate';
import { classifyMovement } from './lib/movementType';
import { saveHistorySnapshot } from './lib/history';
import HistoryDashboard from './HistoryDashboard';
import RealTimeOverview from './RealTimeOverview';

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

function Results({ result }: { result: AnalysisResult }) {
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => result.movements.filter((m) => filter === 'all' || m.status === filter).slice(0, 250), [result, filter]);
  const typeSummaries = useMemo(() => {
    const counts = new Map(movementTypes.map((type) => [type.key, { total: 0, reconciled: 0, unreconciled: 0, missingIdtr: 0 }]));
    if (result.movementTypes) for (const [key, value] of Object.entries(result.movementTypes)) Object.assign(counts.get(key as typeof movementTypes[number]['key'])!, value);
    else for (const movement of result.movements) {
      const count = counts.get(classifyMovement(movement.description))!;
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
  const statusLabel = (movement: Movement) => ({ automatic: 'Reconciliado automaticamente por IDTR', manual: 'Reconciliado manualmente na plataforma', unreconciled: 'Não reconciliado', missing_idtr: 'Sem IDTR', data_error: 'Erro de dados' })[movement.status];
  const balances = result.balanceBreakdown ?? { realTime: result.totals.amount, rec: 0, difference: result.accountingBalance === null ? null : result.totals.amount - result.accountingBalance };
  return <>
    <section className="metrics">
      <Metric label="Total movimentos" value={result.totals.movements.toLocaleString('pt-AO')} />
      <Metric label="Reconciliados automaticamente por IDTR" value={result.totals.automatic.toLocaleString('pt-AO')} tone="good" />
      <Metric label="Reconciliados manualmente na plataforma" value={result.totals.manual.toLocaleString('pt-AO')} tone="manual" />
      <Metric label="Não reconciliados" value={result.totals.unreconciled.toLocaleString('pt-AO')} tone="warn" />
      <Metric label="Movimentos sem IDTR" value={result.totals.missingIdtr.toLocaleString('pt-AO')} tone="bad" />
    </section>
    {result.rawAmounts ? <section className="balance-section"><div className="section-heading"><div><p className="eyebrow">MONTANTES DO EXTRATO</p><h2>Débitos, créditos e saldo acumulado</h2></div><p>Valores calculados pela coluna monetária com sinal e pelo saldo <code>MRSALD</code>.</p></div><div className="balance-widgets">
      <article><span>Total de débitos</span><strong>{money.format(result.rawAmounts.debits)}</strong><small>Movimentos com sinal negativo</small></article><article><span>Total de créditos</span><strong>{money.format(result.rawAmounts.credits)}</strong><small>Movimentos com sinal positivo</small></article><article><span>Movimento líquido</span><strong>{money.format(result.rawAmounts.net)}</strong><small>Créditos menos débitos</small></article><article><span>Saldo final MRSALD</span><strong>{result.rawAmounts.closingBalance===null?'—':money.format(result.rawAmounts.closingBalance)}</strong><small>Saldo acumulado no fim do extrato</small></article>
    </div></section> : <section className="balance-section"><div className="section-heading"><div><p className="eyebrow">CONTROLO DE MONTANTES</p><h2>Comparação dos saldos</h2></div></div><div className="balance-widgets">
      <article><span>Saldo REAL TIME</span><strong>{money.format(balances.realTime)}</strong><small>Movimentos ainda em aberto</small></article>
      <article className={Math.abs(balances.rec) < .005 ? 'matched' : 'mismatch'}><span>Saldo REC</span><strong>{money.format(balances.rec)}</strong><small>{Math.abs(balances.rec) < .005 ? 'Fecha corretamente a zero' : 'Deveria fechar a zero'}</small></article>
      <article><span>Saldo contabilístico BL</span><strong>{result.accountingBalance === null ? 'Não encontrado' : money.format(result.accountingBalance)}</strong><small>Valor de controlo no ficheiro</small></article>
      <article className={balances.difference !== null && Math.abs(balances.difference) < .005 ? 'matched' : 'mismatch'}><span>Diferença REAL TIME − BL</span><strong>{balances.difference === null ? '—' : money.format(balances.difference)}</strong><small>{balances.difference === null ? 'Sem saldo contabilístico' : Math.abs(balances.difference) < .005 ? 'Saldos coincidentes' : 'Diferença a investigar'}</small></article>
    </div></section>}
    {result.ageBuckets && <section className="aging-section"><div className="section-heading"><div><p className="eyebrow">ENVELHECIMENTO</p><h2>Idade dos movimentos na data de corte</h2></div><p>Idade operacional por <code>MRDTSIS</code>; corte contabilístico por <code>MRDATL</code>.</p></div><div className="aging-grid">{['D+0','D+1','D+2','D+3','D+4–7','D+8+'].map(key=>{const item=result.ageBuckets?.[key]??{total:0,automatic:0,unreconciled:0,amount:0};const rate=item.total?item.automatic/item.total*100:0;return <article key={key}><span>{key}</span><strong>{item.unreconciled.toLocaleString('pt-AO')}</strong><small>pendentes de {item.total.toLocaleString('pt-AO')}</small><div><i style={{width:`${rate}%`}}/></div><b>{rate.toFixed(1)}% reconciliados</b></article>})}</div></section>}
    {result.reconciliationTiming && <section className="timing-section"><div className="section-heading"><div><p className="eyebrow">TEMPO DE RECONCILIAÇÃO</p><h2>Quanto demoraram os grupos IDTR a fechar</h2></div><p>Dias entre o primeiro e o último movimento de cada grupo que fecha a zero.</p></div><div className="timing-widgets"><article className="average"><span>Média</span><strong>{result.reconciliationTiming.averageDays.toFixed(2)}</strong><small>dias por grupo</small></article>{['D+0','D+1','D+2','D+3','D+4+'].map(key=>{const count=result.reconciliationTiming?.buckets[key]??0,rate=result.reconciliationTiming?.totalGroups?count/result.reconciliationTiming.totalGroups*100:0;return <article key={key}><span>{key==='D+0'?'No próprio dia':key==='D+4+'?'Mais de 3 dias':key.replace('+','+ ' )+'dia(s)'}</span><strong>{rate.toFixed(1)}%</strong><small>{count.toLocaleString('pt-AO')} grupos</small></article>})}</div></section>}
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
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos os estados</option><option value="automatic">Reconciliados automaticamente por IDTR</option><option value="manual">Reconciliados manualmente na plataforma</option><option value="unreconciled">Não reconciliados</option><option value="missing_idtr">Sem IDTR</option></select>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Data</th><th>IDTR</th><th>Descrição</th><th>Valor</th><th>Estado</th></tr></thead><tbody>{rows.map((m) => <tr key={m.id}><td>{m.row}</td><td>{m.reportDate}</td><td className="mono">{m.idtr ?? '—'}</td><td>{m.description}</td><td className="amount">{money.format(m.amount)}</td><td><span className={`badge ${m.status}`}>{statusLabel(m)}</span></td></tr>)}</tbody></table></div>
      {rows.length === 250 && <p className="table-note">A mostrar os primeiros 250 movimentos do filtro selecionado.</p>}
    </section>
  </>;
}

function ProcessingDashboard({ fileName, progress }: { fileName: string; progress: AnalysisProgress }) {
  const [seconds, setSeconds] = useState(0);
  const [displayPercent, setDisplayPercent] = useState(progress.percent);
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    setDisplayPercent((shown) => Math.max(shown, progress.percent));
    if (progress.percent !== 38) return;
    const timer = window.setInterval(() => setDisplayPercent((shown) => shown < 84 ? Math.min(84, shown + (shown < 60 ? 1 : .5)) : shown), 650);
    return () => window.clearInterval(timer);
  }, [progress.percent]);
  const step = progress.percent < 10 ? 1 : progress.percent < 38 ? 2 : progress.percent < 67 ? 3 : progress.percent < 98 ? 4 : 5;
  const liveMetrics = [
    ['Total movimentos', progress.liveTotals?.movements],
    ['Reconciliados por IDTR', progress.liveTotals?.automatic],
    ['Não reconciliados', progress.liveTotals?.unreconciled],
    ['Sem IDTR', progress.liveTotals?.missingIdtr],
  ] as const;
  return <section className="processing-dashboard" aria-live="polite">
    <div className="processing-hero"><div className="processing-spinner" aria-hidden="true"><i/><i/><i/></div><div><p className="eyebrow">ANÁLISE EM CURSO · MOTOR ATIVO</p><h2>Estamos a processar a reconciliação</h2><p>{fileName}</p></div><div className="processing-percent"><strong>{Math.floor(displayPercent)}%</strong><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span></div></div>
    <div className="processing-track"><span style={{ width: `${displayPercent}%` }}><i/></span></div>
    <div className="processing-status"><span className="processing-pulse"/><strong>{progress.percent === 38 ? 'A descomprimir a folha REAL TIME' : progress.stage}</strong><span className="line-counter">{progress.total ? <><b>{(progress.processed ?? 0).toLocaleString('pt-AO')}</b> de <b>{progress.total.toLocaleString('pt-AO')}</b> linhas</> : progress.percent === 38 ? <>Progresso estimado · a preparar a contagem real</> : <>A identificar o número de linhas<span className="counting-dots">…</span></>}</span></div>
    <div className="processing-steps">{['Receção', 'Classificados', 'Agrupamento IDTR', 'Validação', 'Dashboard'].map((label, index) => <div className={index + 1 < step ? 'done' : index + 1 === step ? 'active' : ''} key={label}><i>{index + 1 < step ? '✓' : index + 1}</i><span>{label}</span></div>)}</div>
    <div className="processing-metrics">{liveMetrics.map(([label, count]) => <article className={count !== undefined ? 'counting' : ''} key={label}><span>{label}</span>{count === undefined ? <i/> : <strong>{count.toLocaleString('pt-AO')}</strong>}</article>)}</div>
    <div className="processing-preview"><div><h3>Resultados por tipo de movimento</h3><p>Os cartões estão a ser preenchidos à medida que cada movimento é identificado e validado.</p></div><div className="processing-card-grid">{movementTypes.map((type) => {
      const Icon = type.icon; const counts = progress.liveMovementTypes?.[type.key];
      return <article className={`${type.color} ${counts ? 'counting' : ''}`} key={type.key}><div className="processing-type-head"><span><Icon size={17}/></span><strong>{type.label}</strong><b>{counts?.total.toLocaleString('pt-AO') ?? '—'}</b></div>{counts ? <div className="processing-type-states"><span><b>{counts.reconciled.toLocaleString('pt-AO')}</b> reconciliados</span><span><b>{counts.unreconciled.toLocaleString('pt-AO')}</b> pendentes</span><span><b>{counts.missingIdtr.toLocaleString('pt-AO')}</b> sem IDTR</span></div> : <><i/><i/></>}</article>;
    })}</div></div>
  </section>;
}

const historicalTransitions = [
  { period: '14 → 22 jul', initial: 61291, resolved: 59188, remaining: 2103, rate: 96.6 },
  { period: '22 → 28 jul', initial: 86647, resolved: 86544, remaining: 6, rate: 99.9 },
  { period: '28 → 31 jul', initial: 40133, resolved: 40127, remaining: 3, rate: 99.9 },
];

function Guide() {
  return <div className="guide-page">
    <section className="guide-hero"><div><p className="eyebrow">GUIA OPERACIONAL</p><h2>Como funciona a reconciliação</h2><p>O processo combina movimentos novos com pendências anteriores e volta a verificar cada operação na data de corte.</p></div><div className="guide-delay"><Clock3 size={25}/><strong>2–3 dias</strong><span>janela operacional habitual</span></div></section>
    <section className="guide-section"><div className="section-heading"><div><p className="eyebrow">CICLO DA ANÁLISE</p><h2>Da extração ao resultado auditável</h2></div></div><div className="process-flow">
      <article><span>1</span><strong>Extrato bruto</strong><p>Entram os movimentos novos com data, operação, valor e IDTR.</p></article><b>→</b><article><span>2</span><strong>Janela de espera</strong><p>Os processos bancários têm tempo para compensar a maioria dos pares.</p></article><b>→</b><article><span>3</span><strong>Integração</strong><p>Juntam-se movimentos novos e pendências da fotografia anterior.</p></article><b>→</b><article><span>4</span><strong>Reconciliação</strong><p>IDTR + operação + valor validam os grupos e o balanço zero.</p></article><b>→</b><article><span>5</span><strong>Resultado</strong><p>Reconciliados, N/Ok, REAL TIME e exceções ficam registados.</p></article>
    </div></section>
    <section className="guide-section guide-chart"><div className="section-heading"><div><p className="eyebrow">EVIDÊNCIA HISTÓRICA</p><h2>O que aconteceu às pendências</h2></div><p>Percentagem das pendências que passou para reconciliada na fotografia seguinte.</p></div><div className="transition-chart" role="img" aria-label="Taxa de resolução das pendências entre as fotografias históricas">{historicalTransitions.map((item) => <div className="transition-row" key={item.period}><div><strong>{item.period}</strong><span>{item.initial.toLocaleString('pt-AO')} pendentes iniciais</span></div><div className="transition-bar"><span style={{ width: `${item.rate}%` }}/></div><div><strong>{item.rate.toLocaleString('pt-AO')}%</strong><span>{item.resolved.toLocaleString('pt-AO')} resolvidos · {item.remaining.toLocaleString('pt-AO')} ainda em REAL TIME</span></div></div>)}</div></section>
    <section className="guide-section"><div className="section-heading"><div><p className="eyebrow">ESCOLHA DA DATA</p><h2>O impacto de analisar mais cedo ou mais tarde</h2></div></div><div className="timing-grid">
      <article className="timing-early"><span>0–1 dia</span><h3>Análise antecipada</h3><p>Muitos movimentos ainda estão em trânsito e aparecem como pendências temporárias.</p><ul><li>Mais falsos alertas operacionais</li><li>Mais volume para verificação manual</li><li>Resultado disponível mais cedo</li></ul></article>
      <article className="timing-best"><span><CheckCircle2 size={15}/> 2–3 dias</span><h3>Janela recomendada</h3><p>Equilibra a maturação automática dos movimentos com a rapidez da análise.</p><ul><li>Maior taxa de reconciliação</li><li>Menos trabalho manual desnecessário</li><li>Exceções ainda tratadas atempadamente</li></ul></article>
      <article className="timing-late"><span>4+ dias</span><h3>Análise tardia</h3><p>Pode reduzir pendências transitórias, mas atrasa a deteção de problemas reais.</p><ul><li>Informação operacional envelhecida</li><li>Resposta mais lenta a diferenças</li><li>Maior risco de acumulação</li></ul></article>
    </div></section>
    <section className="guide-rule"><ShieldCheck size={24}/><div><strong>Regra de auditoria</strong><p><code>Ok</code> e <code>OK</code> significam apenas reconciliado no ficheiro. Uma reconciliação manual só é identificável quando for feita na plataforma, com utilizador, data e motivo.</p></div></section>
  </div>;
}

export default function App() {
  const identity = useAuth();
  const [tool, setTool] = useState<'portal' | 'realtime' | 'stc'>('portal');
  const [view, setView] = useState<'import' | 'results' | 'guide' | 'history' | 'users' | 'audit'>('import');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress>({ percent: 0, stage: 'A aguardar ficheiro' });
  const [processingFile, setProcessingFile] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const process = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setProcessingFile(file.name); setProgress({ percent: 1, stage: 'Ficheiro recebido' }); setView('results');
    try { const analyzed = await analyzeWorkbook(file, (next) => setProgress((previous) => ({ ...previous, ...next, liveTotals: next.liveTotals ?? previous.liveTotals, liveMovementTypes: next.liveMovementTypes ?? previous.liveMovementTypes }))); setResult(analyzed); saveHistorySnapshot(analyzed, identity.email); setHistoryRevision((value) => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.'); setView('import'); }
    finally { setBusy(false); }
  };
  const pageTitle = view === 'import' ? 'Nova reconciliação' : view === 'results' ? 'Resultados da reconciliação' : view === 'guide' ? 'Como funciona' : view === 'history' ? 'Histórico de análises' : view === 'users' ? 'Gestão de utilizadores' : 'Auditoria da plataforma';
  const pageDescription = view === 'import' ? 'Importe diretamente o extrato Real Time, sem ficheiros intermédios.' : view === 'results' ? 'Consulte os resultados e exceções identificadas.' : view === 'guide' ? 'Compreenda o ciclo, as regras e o impacto da data escolhida.' : view === 'history' ? 'Consulte os carregamentos e resultados anteriores.' : view === 'users' ? 'Crie, edite, ative ou bloqueie utilizadores.' : 'Consulte ações, reconciliações e exportações realizadas.';
  if (tool === 'portal') return <div className="tool-portal"><header><div className="portal-brand"><div className="brand-mark">R</div><div><strong>Portal de Reconciliação</strong><span>Ferramentas operacionais</span></div></div><div className="portal-user"><ShieldCheck size={18}/><div><strong>{identity.name}</strong><span>{identity.email}</span></div></div></header><main><div className="portal-heading"><p className="eyebrow">SELECIONE UMA FERRAMENTA</p><h1>Reconciliações financeiras</h1><p>Cada ferramenta mantém as suas próprias regras, importações, resultados e histórico.</p></div><div className="tool-grid"><article className="tool-card realtime"><div className="tool-card-icon"><Activity size={30}/></div><span className="tool-status available">Disponível</span><h2>Reconciliação Real Time</h2><p>Importação direta dos extratos Real Time, reconciliação automática por IDTR e tratamento auditável das exceções.</p><ul><li>Extratos Real Time</li><li>Reconciliação automática e manual</li><li>Histórico e deteção de anomalias</li></ul><button className="primary-button" onClick={() => setTool('realtime')}>Abrir ferramenta</button></article><article className="tool-card stc"><div className="tool-card-icon"><ArrowLeftRight size={30}/></div><span className="tool-status preparing">Em preparação</span><h2>Reconciliação STC</h2><h3>Sistema de Transferências a Crédito</h3><p>Ferramenta dedicada ao tratamento e reconciliação das operações do STC, com regras e histórico independentes.</p><ul><li>Importações próprias do STC</li><li>Regras específicas de transferências</li><li>Auditoria separada</li></ul><button className="secondary-button" onClick={() => setTool('stc')}>Ver ferramenta</button></article></div></main></div>;
  if (tool === 'stc') return <div className="tool-placeholder"><div><div className="tool-card-icon"><ArrowLeftRight size={30}/></div><p className="eyebrow">NOVA FERRAMENTA</p><h1>Reconciliação STC</h1><h2>Sistema de Transferências a Crédito</h2><p>A estrutura está reservada e será desenvolvida com regras, importações e histórico próprios.</p><button className="primary-button" onClick={() => setTool('portal')}>Voltar às ferramentas</button></div></div>;
  return <div className="app-shell">
    <aside><div className="brand"><div className="brand-mark">R</div><div><strong>Reconciliação</strong><span>Real Time</span></div></div><button className="tool-switcher" onClick={() => setTool('portal')}><Grid2X2 size={17}/>Todas as ferramentas</button>
      <nav><button className={view === 'results' ? 'active' : ''} disabled={!result && !busy} title={result || busy ? 'Voltar aos resultados da reconciliação' : 'Carregue primeiro um ficheiro'} onClick={() => setView('results')}><BarChart3 size={19}/>Resultados</button><button className={view === 'guide' ? 'active' : ''} onClick={() => setView('guide')}><BookOpen size={19}/>Como funciona</button><button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={19}/>Histórico</button>{identity.isAdmin && <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><Users size={19}/>Utilizadores</button>}{identity.isAdmin && <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><Activity size={19}/>Auditoria</button>}<button className={`nav-import ${view === 'import' ? 'active' : ''}`} onClick={() => setView('import')}><Upload size={19}/>Importar ficheiro</button></nav>
      <div className="admin" title={identity.email}><ShieldCheck size={18}/><div><strong>{identity.name}</strong><span>{identity.isAdmin ? 'Administrador' : identity.role === 'auditor' ? 'Auditor' : 'Analista'}</span></div></div>
    </aside>
    <main><header><div><p className="eyebrow">PAINEL OPERACIONAL</p><h1>{pageTitle}</h1><p>{pageDescription}</p></div><button className="icon-button" title="Pesquisar"><Search size={20}/></button></header>
      <RealTimeOverview revision={historyRevision}/>
      {view === 'import' && <section className={`dropzone compact-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void process(e.dataTransfer.files[0]); }}>
        <div className="upload-icon"><Upload size={30}/></div><h2>{busy ? 'A processar o extrato…' : 'Arraste o extrato Real Time para aqui'}</h2><p>A plataforma lê diretamente as colunas MR, extrai o IDTR e reconcilia sem ficheiros intermédios.</p><label className="primary-button">Selecionar extrato<input type="file" accept=".xlsx" disabled={busy} onChange={(e) => void process(e.target.files?.[0])}/></label><small>Formato aceite: extrato Real Time em XLSX</small>{error && <div className="error">{error}</div>}
      </section>}
      {view === 'results' && busy && <ProcessingDashboard fileName={processingFile} progress={progress}/>}
      {view === 'results' && !busy && result && <><div className="actions"><button className="secondary-button" onClick={() => setView('import')}>Analisar outro ficheiro</button><button className="primary-button">Integrar novos movimentos</button></div><Results result={result}/></>}
      {view === 'guide' && <Guide/>}
      {view === 'history' && <HistoryDashboard revision={historyRevision}/>}
      {view === 'users' && identity.isAdmin && <section className="panel empty-state"><Users size={28}/><h2>Gestão reservada ao administrador</h2><p>A criação e edição de utilizadores será ligada ao Supabase neste ecrã.</p></section>}
      {view === 'audit' && identity.isAdmin && <section className="panel empty-state"><Activity size={28}/><h2>Log de utilização</h2><p>As ações da plataforma serão apresentadas aqui com filtros e exportação.</p></section>}
    </main>
  </div>;
}

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, CheckCircle2, CircleEllipsis, Clock3, CreditCard, Download, FileSpreadsheet, Grid2X2, History, Info, Landmark, Moon, ReceiptText, RefreshCw, ShieldCheck, Sun, Upload, Users, Wrench } from 'lucide-react';
import type { AnalysisResult } from './types';
import { analyzeWorkbook, type AnalysisProgress } from './lib/excel';
import { useAuth } from './AuthGate';
import { classifyMovement } from './lib/movementType';
import HistoryDashboard from './HistoryDashboard';
import RealTimeOverview from './RealTimeOverview';
import DataExplorer from './DataExplorer';
import AuditLogPanel from './AuditLogPanel';
import UserManagement from './UserManagement';
import { failPersistentImport, finalizePersistentImport, loadBoundaryBalanceSummary, loadPersistentResult, preparePersistentImport, type BoundaryBalanceSummary, type PersistenceContext } from './lib/database';
import packageJson from '../package.json';

const money = new Intl.NumberFormat('pt-AO', { style: 'currency', currency: 'AOA' });
const APP_BUILD = packageJson.version;
type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};

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
  const central=result as AnalysisResult&{analysisId?:string};
  const [excludeBoundaries,setExcludeBoundaries]=useState(true),[boundary,setBoundary]=useState<BoundaryBalanceSummary|null>(null);
  const displayedPendingBalance=boundary?(excludeBoundaries?boundary.totalOpenBalance-boundary.openingBalance:boundary.totalOpenBalance):0;
  const displayedPendingGroups=boundary?(excludeBoundaries?boundary.totalOpenGroups-boundary.openingGroups:boundary.totalOpenGroups):0;
  useEffect(()=>{if(!central.analysisId)return;let active=true;void loadBoundaryBalanceSummary(central.analysisId).then(value=>{if(active)setBoundary(value);});return()=>{active=false};},[central.analysisId]);
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
  return <>
    <section className="metrics">
      <Metric label="Total movimentos" value={result.totals.movements.toLocaleString('pt-AO')} />
      <Metric label="Reconciliados automaticamente por IDTR" value={result.totals.automatic.toLocaleString('pt-AO')} tone="good" />
      <Metric label="Não reconciliados" value={result.totals.unreconciled.toLocaleString('pt-AO')} tone="warn" />
      <Metric label="Movimentos sem IDTR" value={result.totals.missingIdtr.toLocaleString('pt-AO')} tone="bad" />
    </section>
    {result.rawAmounts && <section className="balance-section"><div className="section-heading"><div><p className="eyebrow">MONTANTES E CONTROLO</p><h2>Débitos, créditos e saldos de reconciliação</h2></div></div><div className="balance-widgets">
      <article><span>Total de débitos</span><strong>{money.format(result.rawAmounts.debits)}</strong><small>Movimentos com sinal negativo</small></article><article><span>Total de créditos</span><strong>{money.format(result.rawAmounts.credits)}</strong><small>Movimentos com sinal positivo</small></article><article><span>Movimento líquido</span><strong>{money.format(result.rawAmounts.net)}</strong><small>Créditos menos débitos</small></article><article><span>Saldo final MRSALD</span><strong>{result.rawAmounts.closingBalance===null?'—':money.format(result.rawAmounts.closingBalance)}</strong><small>Saldo acumulado no fim do extrato</small></article>
      {boundary&&<article className={`boundary-balance-card ${Math.abs(displayedPendingBalance)<.005?'matched':'mismatch'}`}><span>Saldo pendente {excludeBoundaries?'ajustado ao início':'bruto'}</span><strong>{money.format(displayedPendingBalance)}</strong><small>{displayedPendingGroups.toLocaleString('pt-AO')} grupos abertos{excludeBoundaries?', sem fechos anteriores ao primeiro ficheiro':''}</small><div className="boundary-toggle-wrap"><button type="button" className={`boundary-toggle ${excludeBoundaries?'active':''}`} aria-pressed={excludeBoundaries} onClick={()=>setExcludeBoundaries(value=>!value)}><Info size={17}/><span>Ajustar início da série</span><i/></button><div className="boundary-popover" role="tooltip"><strong>Ajuste do início da série</strong><p>Quando ativo, exclui do saldo apresentado apenas os movimentos de fecho cuja abertura teria ocorrido antes do primeiro ficheiro importado. A fronteira final continua incluída como pendência real. Nenhum movimento é apagado ou reconciliado.</p><dl><div><dt>Fechos anteriores ao primeiro ficheiro</dt><dd>{boundary.openingGroups.toLocaleString('pt-AO')} · {money.format(boundary.openingBalance)}</dd></div><div><dt>Pendências posteriores mantidas</dt><dd>{boundary.closingGroups.toLocaleString('pt-AO')} · {money.format(boundary.closingBalance)}</dd></div><div><dt>Saldo atualmente apresentado</dt><dd>{displayedPendingGroups.toLocaleString('pt-AO')} · {money.format(displayedPendingBalance)}</dd></div></dl></div></div></article>}
      {!boundary&&<article className="boundary-balance-card loading"><span>Saldo pendente ajustado ao início</span><strong>A calcular…</strong><small>A atualizar os grupos da série acumulada</small><div className="boundary-toggle-wrap"><button type="button" className="boundary-toggle active" disabled><Info size={17}/><span>Ajustar início da série</span><i/></button></div></article>}
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

function SavedResults({ revision, onImport }: { revision: number; onImport: () => void }) {
  void revision;
  return <section className="panel empty-state"><BarChart3 size={28}/><h2>Ainda não existem resultados centrais</h2><p>Importe o primeiro extrato para criar o dashboard.</p><button className="primary-button" onClick={onImport}>Importar extrato</button></section>;
}

function Guide() {
  return <div className="guide-page">
    <section className="guide-hero"><div><p className="eyebrow">GUIA OPERACIONAL</p><h2>Como funciona a reconciliação</h2><p>Os extratos alimentam uma série diária única; cada movimento é validado, deduplicado e reconciliado por IDTR.</p></div><div className="guide-delay"><Clock3 size={25}/><strong>Diário</strong><span>acompanhamento contínuo</span></div></section>
    <section className="guide-section"><div className="section-heading"><div><p className="eyebrow">CICLO DA ANÁLISE</p><h2>Da extração ao resultado auditável</h2></div></div><div className="process-flow">
      <article><span>1</span><strong>Extrato bruto</strong><p>Entram os movimentos com data, hora, operação, valor e informação complementar.</p></article><b>→</b><article><span>2</span><strong>Integridade</strong><p>Validam-se continuidade, intervalos e estrutura das colunas MR.</p></article><b>→</b><article><span>3</span><strong>Base diária</strong><p>Os movimentos novos são integrados e as sobreposições são deduplicadas.</p></article><b>→</b><article><span>4</span><strong>Reconciliação</strong><p>Os IDTR são agrupados e os movimentos que fecham a zero são reconciliados.</p></article><b>→</b><article><span>5</span><strong>Resultado</strong><p>Reconciliados, pendentes e exceções ficam disponíveis para análise e auditoria.</p></article>
    </div></section>
    <section className="guide-section impact-section"><div className="section-heading"><div><p className="eyebrow">ESCOLHA DA DATA</p><h2>O impacto de analisar mais cedo ou mais tarde</h2></div></div><div className="timing-grid">
      <article className="timing-early"><span>D+0</span><h3>Monitorização imediata</h3><p>Mostra a atividade do próprio dia e identifica cedo falhas de dados ou volumes anormais.</p><ul><li>Visibilidade operacional imediata</li><li>Pendências ainda recentes</li><li>Controlo da continuidade</li></ul></article>
      <article className="timing-best"><span><CheckCircle2 size={15}/> D+1 a D+3</span><h3>Acompanhamento</h3><p>Permite observar quais IDTR fecharam nos dias seguintes e quais continuam abertos.</p><ul><li>Taxa diária de resolução</li><li>Passagem de pendências entre dias</li><li>Priorização por antiguidade</li></ul></article>
      <article className="timing-late"><span>D+4+</span><h3>Escalonamento</h3><p>Pendências antigas exigem verificação e eventual decisão manual auditável.</p><ul><li>Investigação operacional</li><li>Justificação obrigatória</li><li>Controlo administrativo</li></ul></article>
    </div></section>
  </div>;
}

export default function App() {
  const identity = useAuth();
  type Tool = 'portal' | 'realtime' | 'stc';
  type View = 'import' | 'results' | 'movements' | 'guide' | 'history' | 'users' | 'audit';
  const [tool, setTool] = useState<Tool>(() => {
    const saved = sessionStorage.getItem('reconciliation-active-tool');
    return saved === 'realtime' || saved === 'stc' ? saved : 'portal';
  });
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem('reconciliation-active-view');
    return saved === 'import' || saved === 'results' || saved === 'movements' || saved === 'guide' || saved === 'history' || saved === 'users' || saved === 'audit'
      ? saved : 'import';
  });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress>({ percent: 0, stage: 'A aguardar ficheiro' });
  const [processingFile, setProcessingFile] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('reconciliation-theme')==='dark'?'dark':'light');
  const [refreshing,setRefreshing]=useState(false);
  const [installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);
  const coverageGaps=useMemo(()=>{const dates=Object.keys(result?.dailyMetrics??{}).sort();let gaps=0;for(let index=1;index<dates.length;index++){const cursor=new Date(`${dates[index-1]}T12:00:00`),end=new Date(`${dates[index]}T12:00:00`);cursor.setDate(cursor.getDate()+1);let missing=false;while(cursor<end){const day=cursor.getDay();if(day!==0&&day!==6)missing=true;cursor.setDate(cursor.getDate()+1);}if(missing)gaps++;}return gaps;},[result?.dailyMetrics]);
  useEffect(() => { sessionStorage.setItem('reconciliation-active-tool', tool); }, [tool]);
  useEffect(() => { sessionStorage.setItem('reconciliation-active-view', view); }, [view]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('reconciliation-theme',theme);},[theme]);
  useEffect(()=>{const capture=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPromptEvent);};window.addEventListener('beforeinstallprompt',capture);return()=>window.removeEventListener('beforeinstallprompt',capture);},[]);
  useEffect(()=>{let active=true;void loadPersistentResult().then(persisted=>{if(active&&persisted)setResult(persisted);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Não foi possível carregar os dados centrais.');});return()=>{active=false};},[]);
  const process = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setProcessingFile(file.name); setProgress({ percent: 1, stage: 'Ficheiro recebido' }); setView('results');
    let persistence:PersistenceContext|undefined;
    try { const analyzed = await analyzeWorkbook(file, (next) => setProgress((previous) => ({ ...previous, ...next, liveTotals: next.liveTotals ?? previous.liveTotals, liveMovementTypes: next.liveMovementTypes ?? previous.liveMovementTypes })),async hash=>{const prepared=await preparePersistentImport(file,hash);persistence=prepared.context;return prepared;});if(!persistence)throw new Error('Não foi possível preparar a importação central.');setProgress(previous=>({...previous,percent:99,stage:'A finalizar a importação na base central'}));await finalizePersistentImport(analyzed,persistence);const persisted=await loadPersistentResult();setResult(persisted??analyzed);setHistoryRevision((value) => value + 1); } catch (cause) { const message=cause instanceof Error ? cause.message : 'Não foi possível analisar o ficheiro.';if(persistence)try{await failPersistentImport(persistence,message);}catch{/* Preserva a mensagem original da importação. */}setError(message); setView('import'); }
    finally { setBusy(false); }
  };
  const refreshData=async()=>{if(refreshing)return;setRefreshing(true);setError('');try{const persisted=await loadPersistentResult();if(persisted)setResult(persisted);setHistoryRevision(value=>value+1);}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível atualizar os dados centrais.');}finally{setRefreshing(false);}};
  const installApp=async()=>{if(installPrompt){await installPrompt.prompt();const choice=await installPrompt.userChoice;if(choice.outcome==='accepted')setInstallPrompt(null);return;}window.alert(/iphone|ipad|ipod/i.test(navigator.userAgent)?'No Safari, toque em Partilhar e escolha “Adicionar ao ecrã principal”.':'Abra o menu do navegador e escolha “Instalar aplicação” ou “Adicionar ao ecrã principal”.');};
  const pageTitle = view === 'import' ? 'Nova reconciliação' : view === 'results' ? 'Resultados da reconciliação' : view === 'movements' ? 'Consulta e extração de movimentos' : view === 'guide' ? 'Como funciona' : view === 'history' ? 'Histórico de análises' : view === 'users' ? 'Gestão de utilizadores' : 'Auditoria da plataforma';
  const pageDescription = view === 'import' ? 'Importe diretamente o extrato Real Time, sem ficheiros intermédios.' : view === 'results' ? 'Consulte os resultados e exceções identificadas.' : view === 'movements' ? 'Filtre, ordene e extraia os movimentos disponíveis em Excel ou PDF.' : view === 'guide' ? 'Compreenda o ciclo, as regras e o impacto da data escolhida.' : view === 'history' ? 'Consulte os carregamentos e resultados anteriores.' : view === 'users' ? 'Crie, edite, ative ou bloqueie utilizadores.' : 'Consulte ações, reconciliações e exportações realizadas.';
  if (tool === 'portal') return <div className="tool-portal"><header><div className="portal-brand"><img className="keve-logo portal-logo" src="/keve-logo-purple.png" alt="Keve — O Banco que avança"/><div><strong>Portal de Reconciliação</strong><span>Ferramentas operacionais</span></div></div><div className="portal-header-actions"><button className="portal-install" onClick={()=>void installApp()}><Download size={17}/>Instalar aplicação</button><div className="portal-user"><ShieldCheck size={18}/><div><strong>{identity.name}</strong><span>{identity.email}</span></div></div></div></header><main><div className="portal-heading"><p className="eyebrow">SELECIONE UMA FERRAMENTA</p><h1>Reconciliações financeiras</h1><p>Cada ferramenta mantém as suas próprias regras, importações, resultados e histórico.</p><button className="portal-install-hero" onClick={()=>void installApp()}><Download size={18}/><span><strong>Instalar aplicação</strong><small>Disponível para Windows e iPhone</small></span></button></div><div className="tool-grid"><article className="tool-card realtime"><div className="tool-card-icon"><Activity size={30}/></div><span className="tool-status available">Disponível</span><h2>Reconciliação Real Time</h2><p>Importação direta dos extratos Real Time, reconciliação automática por IDTR e tratamento auditável das exceções.</p><ul><li>Extratos Real Time</li><li>Reconciliação automática e manual</li><li>Histórico e deteção de anomalias</li></ul><button className="primary-button" onClick={() => { setView('results'); setTool('realtime'); }}>Abrir ferramenta</button></article><article className="tool-card stc"><div className="tool-card-icon"><ArrowLeftRight size={30}/></div><span className="tool-status preparing">Em preparação</span><h2>Reconciliação STC</h2><h3>Sistema de Transferências a Crédito</h3><p>Ferramenta dedicada ao tratamento e reconciliação das operações do STC, com regras e histórico independentes.</p><ul><li>Importações próprias do STC</li><li>Regras específicas de transferências</li><li>Auditoria separada</li></ul><button className="secondary-button" onClick={() => { setView('results'); setTool('stc'); }}>Ver ferramenta</button></article></div></main></div>;
  if (tool === 'stc') return <div className="tool-placeholder"><div><div className="tool-card-icon"><ArrowLeftRight size={30}/></div><p className="eyebrow">NOVA FERRAMENTA</p><h1>Reconciliação STC</h1><h2>Sistema de Transferências a Crédito</h2><p>A estrutura está reservada e será desenvolvida com regras, importações e histórico próprios.</p><button className="primary-button" onClick={() => setTool('portal')}>Voltar às ferramentas</button></div></div>;
  return <div className="app-shell">
    <aside><div className="brand"><img className="keve-logo sidebar-logo" src="/keve-logo-green.png" alt="Keve — O Banco que avança"/><div><strong>Reconciliação</strong><span>Real Time</span></div></div><button className="tool-switcher" onClick={() => setTool('portal')}><Grid2X2 size={17}/>Todas as ferramentas</button>
      <nav><button className={view === 'guide' ? 'active' : ''} onClick={() => setView('guide')}><BookOpen size={19}/>Como funciona</button><button className={view === 'results' ? 'active' : ''} title="Abrir o último dashboard de resultados" onClick={() => setView('results')}><BarChart3 size={19}/>Resultados</button><button className={view === 'movements' ? 'active' : ''} onClick={() => setView('movements')}><FileSpreadsheet size={19}/>Movimentos</button><button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={19}/>Histórico</button>{identity.canManageUsers && <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><Users size={19}/>Utilizadores</button>}{identity.canViewAudit && <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><Activity size={19}/>Auditoria</button>}<button className={`nav-import ${view === 'import' ? 'active' : ''}`} onClick={() => setView('import')}><Upload size={19}/>Importar ficheiro</button></nav>
      <div className="admin" title={identity.email}><ShieldCheck size={18}/><div><strong>{identity.name}</strong><span>{identity.isPlatformOwner?'Proprietário da plataforma':identity.role==='client_admin'?'Administrador do cliente':identity.role==='auditor'?'Auditor':'Analista'}</span></div></div><div className="sidebar-build">DIOGO ABRANCHES · VERSÃO {APP_BUILD}</div>
    </aside>
    <main><header className="operational-header"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h1>{pageTitle}</h1><p>{pageDescription}</p></div><div className="header-controls"><span className={`header-series ${coverageGaps?'warning':'ok'}`}>{coverageGaps?<><AlertTriangle size={16}/>{coverageGaps} intervalo{coverageGaps>1?'s':''} em falta</>:<><CheckCircle2 size={16}/>Série diária contínua</>}</span><button type="button" title="Instalar aplicação no dispositivo" aria-label="Instalar aplicação no dispositivo" onClick={()=>void installApp()}><Download size={18}/></button><button type="button" title="Atualizar dados deste ecrã" aria-label="Atualizar dados deste ecrã" disabled={refreshing} onClick={()=>void refreshData()}><RefreshCw size={18} className={refreshing?'spinning':''}/></button><button type="button" title={theme==='light'?'Ativar modo escuro':'Ativar modo claro'} aria-label={theme==='light'?'Ativar modo escuro':'Ativar modo claro'} onClick={()=>setTheme(value=>value==='light'?'dark':'light')}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button></div></header>
      <RealTimeOverview revision={historyRevision} result={result}/>
      {view === 'import' && <section className={`dropzone compact-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void process(e.dataTransfer.files[0]); }}>
        <div className="upload-icon"><Upload size={30}/></div><h2>{busy ? 'A processar o extrato…' : 'Arraste o extrato Real Time para aqui'}</h2><p>A plataforma lê diretamente as colunas MR, extrai o IDTR e reconcilia sem ficheiros intermédios.</p><label className="primary-button">Selecionar extrato<input type="file" accept=".xlsx" disabled={busy} onChange={(e) => void process(e.target.files?.[0])}/></label><small>Formato aceite: extrato Real Time em XLSX</small>{error && <div className="error">{error}</div>}
      </section>}
      {view === 'results' && busy && <ProcessingDashboard fileName={processingFile} progress={progress}/>}
      {view === 'results' && !busy && result && <Results result={result}/>}
      {view === 'results' && !busy && !result && <SavedResults revision={historyRevision} onImport={() => setView('import')}/>}
      {view === 'guide' && <Guide/>}
      {view === 'history' && <HistoryDashboard result={result}/>}
      {view === 'movements' && <DataExplorer result={result} onImport={() => setView('import')}/>}
      {view === 'users' && identity.canManageUsers && <UserManagement/>}
      {view === 'audit' && identity.canViewAudit && <AuditLogPanel/>}
    </main>
  </div>;
}

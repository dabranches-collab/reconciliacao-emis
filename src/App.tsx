import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleEllipsis,
  Clock3,
  Cog,
  CreditCard,
  Download,
  FileSpreadsheet,
  Grid2X2,
  History,
  Info,
  Landmark,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sun,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { AnalysisResult } from "./types";
import { analyzeWorkbook, type AnalysisProgress } from "./lib/excel";
import { createMultipartSession, uploadFileParts } from "./lib/multipartUpload";
import { useAuth } from "./AuthGate";
import { classifyMovement } from "./lib/movementType";
import HistoryDashboard from "./HistoryDashboard";
import RealTimeOverview from "./RealTimeOverview";
import DataExplorer from "./DataExplorer";
import AuditLogPanel from "./AuditLogPanel";
import UserManagement from "./UserManagement";
import {
  failPersistentImport,
  finalizePersistentImport,
  loadBoundaryBalanceSummary,
  loadPersistentResult,
  loadRecoverableImport,
  preparePersistentImport,
  readableError,
  resumePersistentFinalization,
  type BoundaryBalanceSummary,
  type CentralImport,
  type PersistenceContext,
} from "./lib/database";
import packageJson from "../package.json";
import { demoResult } from "./demoData";
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./lib/supabase";
import { runV2Import } from "./v2/runImport";
import { finalizeV2Import, loadActiveV2Import, loadLatestV2Dashboard } from "./v2/database";
import V2History from "./v2/V2History";
import V2Movements from "./v2/V2Movements";
import {V2Assumptions,V2MovementGuide} from "./v2/V2Reference";
import V2Results from "./v2/V2Results";
import type { V2Dashboard } from "./v2/database";

const money = new Intl.NumberFormat("pt-AO", {
  style: "currency",
  currency: "AOA",
});
const APP_BUILD = packageJson.version;
const REALTIME_V2_ACTIVE = true;
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

const movementTypes = [
  {
    key: "pos",
    label: "Movimentos POS",
    hint: "Compras e operações em terminais",
    icon: CreditCard,
    color: "emerald",
  },
  {
    key: "atm",
    label: "Movimentos ATM",
    hint: "Levantamentos e operações em caixas",
    icon: Landmark,
    color: "blue",
  },
  {
    key: "transfer",
    label: "Transferências",
    hint: "Transferências, NIB e canais digitais",
    icon: ArrowLeftRight,
    color: "violet",
  },
  {
    key: "commission",
    label: "Comissões",
    hint: "Comissões e encargos associados",
    icon: ReceiptText,
    color: "orange",
  },
  {
    key: "service",
    label: "Serviços",
    hint: "Pagamentos e serviços especiais",
    icon: Wrench,
    color: "rose",
  },
  {
    key: "other",
    label: "Outros movimentos",
    hint: "Restantes naturezas identificadas",
    icon: CircleEllipsis,
    color: "slate",
  },
] as const;

function Results({ result }: { result: AnalysisResult }) {
  const central = result as AnalysisResult & { analysisId?: string;importHistory?:CentralImport[] };
  const latestImport=central.importHistory?.[0];
  const [excludeBoundaries, setExcludeBoundaries] = useState(true),
    [boundary, setBoundary] = useState<BoundaryBalanceSummary | null>(null);
  const displayedPendingBalance = boundary
    ? excludeBoundaries
      ? boundary.totalOpenBalance - boundary.openingBalance
      : boundary.totalOpenBalance
    : 0;
  const displayedPendingGroups = boundary
    ? excludeBoundaries
      ? boundary.totalOpenGroups - boundary.openingGroups
      : boundary.totalOpenGroups
    : 0;
  useEffect(() => {
    if (!central.analysisId) return;
    let active = true;
    void loadBoundaryBalanceSummary(central.analysisId).then((value) => {
      if (active) setBoundary(value);
    });
    return () => {
      active = false;
    };
  }, [central.analysisId]);
  const typeSummaries = useMemo(() => {
    const counts = new Map(
      movementTypes.map((type) => [
        type.key,
        { total: 0, reconciled: 0, unreconciled: 0, missingIdtr: 0 },
      ]),
    );
    if (result.movementTypes)
      for (const [key, value] of Object.entries(result.movementTypes))
        Object.assign(
          counts.get(key as (typeof movementTypes)[number]["key"])!,
          value,
        );
    else
      for (const movement of result.movements) {
        const count = counts.get(classifyMovement(movement.description))!;
        count.total += 1;
        if (movement.status === "automatic" || movement.status === "manual")
          count.reconciled += 1;
        else if (movement.status === "unreconciled") count.unreconciled += 1;
        else if (movement.status === "missing_idtr") count.missingIdtr += 1;
      }
    return movementTypes.map((type) => {
      const count = counts.get(type.key)!;
      return {
        ...type,
        ...count,
        rate: count.total
          ? Math.round((count.reconciled / count.total) * 100)
          : 0,
      };
    });
  }, [result]);
  return (
    <>
      {latestImport&&(
        <section className={`server-job-card ${latestImport.status}`} role="status">
          <div><span className="processing-pulse"/><div><small>PROCESSAMENTO NO SERVIDOR</small><strong>{latestImport.status==='completed'?'Concluído':latestImport.status==='processing'?'Em curso':'Requer atenção'}</strong></div></div>
          <div><small>Ficheiro</small><b>{latestImport.filename}</b></div>
          <div><small>Linhas</small><b>{latestImport.movementCount.toLocaleString('pt-AO')}</b></div>
          <div><small>Conclusão</small><b>{latestImport.completedAt?new Date(latestImport.completedAt).toLocaleString('pt-AO'):'a processar'}</b></div>
          <p>{latestImport.status==='completed'?'Todos os passos foram fechados e gravados centralmente.':'Pode fechar ou atualizar esta página; o trabalho continuará no servidor.'}</p>
        </section>
      )}
      <section className="metrics">
        <Metric
          label="Total movimentos"
          value={result.totals.movements.toLocaleString("pt-AO")}
        />
        <article className="metric good method-metric">
          <span>Reconciliados automaticamente</span>
          <strong>{result.totals.automatic.toLocaleString("pt-AO")}</strong>
          <div className="method-breakdown">
            <small><b>{(result.reconciliationMethods?.idtr ?? result.totals.automatic).toLocaleString("pt-AO")}</b> IDTR nativo</small>
            <small><b>{(result.reconciliationMethods?.observation_reference ?? 0).toLocaleString("pt-AO")}</b> referência /26 associada</small>
            <small><b>{(result.reconciliationMethods?.operation_description ?? 0).toLocaleString("pt-AO")}</b> operação + descrição + valor</small>
          </div>
        </article>
        <Metric
          label="Não reconciliados"
          value={result.totals.unreconciled.toLocaleString("pt-AO")}
          tone="warn"
        />
        <Metric
          label="Movimentos sem IDTR"
          value={result.totals.missingIdtr.toLocaleString("pt-AO")}
          tone="bad"
        />
      </section>
      {result.rawAmounts && (
        <section className="balance-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MONTANTES E CONTROLO</p>
              <h2>Débitos, créditos e saldos de reconciliação</h2>
            </div>
          </div>
          <div className="balance-widgets">
            <article>
              <span>Total de débitos</span>
              <strong>{money.format(result.rawAmounts.debits)}</strong>
              <small>Movimentos com sinal negativo</small>
            </article>
            <article>
              <span>Total de créditos</span>
              <strong>{money.format(result.rawAmounts.credits)}</strong>
              <small>Movimentos com sinal positivo</small>
            </article>
            <article>
              <span>Movimento líquido</span>
              <strong>{money.format(result.rawAmounts.net)}</strong>
              <small>Créditos menos débitos</small>
            </article>
            <article>
              <span>Saldo final MRSALD</span>
              <strong>
                {result.rawAmounts.closingBalance === null
                  ? "—"
                  : money.format(result.rawAmounts.closingBalance)}
              </strong>
              <small>Saldo acumulado no fim do extrato</small>
            </article>
            {boundary && (
              <article
                className={`boundary-balance-card ${Math.abs(displayedPendingBalance) < 0.005 ? "matched" : "mismatch"}`}
              >
                <span>
                  Saldo pendente{" "}
                  {excludeBoundaries ? "ajustado ao início" : "bruto"}
                </span>
                <strong>{money.format(displayedPendingBalance)}</strong>
                <small>
                  {displayedPendingGroups.toLocaleString("pt-AO")} grupos
                  abertos
                  {excludeBoundaries
                    ? ", sem fechos anteriores ao primeiro ficheiro"
                    : ""}
                </small>
                <div className="boundary-toggle-wrap">
                  <button
                    type="button"
                    className={`boundary-toggle ${excludeBoundaries ? "active" : ""}`}
                    aria-pressed={excludeBoundaries}
                    onClick={() => setExcludeBoundaries((value) => !value)}
                  >
                    <Info size={17} />
                    <span>Ajustar início da série</span>
                    <i />
                  </button>
                  <div className="boundary-popover" role="tooltip">
                    <strong>Ajuste do início da série</strong>
                    <p>
                      Quando ativo, exclui do saldo apresentado apenas os
                      movimentos de fecho cuja abertura teria ocorrido antes do
                      primeiro ficheiro importado. A fronteira final continua
                      incluída como pendência real. Nenhum movimento é apagado
                      ou reconciliado.
                    </p>
                    <dl>
                      <div>
                        <dt>Fechos anteriores ao primeiro ficheiro</dt>
                        <dd>
                          {boundary.openingGroups.toLocaleString("pt-AO")} ·{" "}
                          {money.format(boundary.openingBalance)}
                        </dd>
                      </div>
                      <div>
                        <dt>Pendências posteriores mantidas</dt>
                        <dd>
                          {boundary.closingGroups.toLocaleString("pt-AO")} ·{" "}
                          {money.format(boundary.closingBalance)}
                        </dd>
                      </div>
                      <div>
                        <dt>Saldo atualmente apresentado</dt>
                        <dd>
                          {displayedPendingGroups.toLocaleString("pt-AO")} ·{" "}
                          {money.format(displayedPendingBalance)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </article>
            )}
            {!boundary && (
              <article className="boundary-balance-card loading">
                <span>Saldo pendente ajustado ao início</span>
                <strong>A calcular…</strong>
                <small>A atualizar os grupos da série acumulada</small>
                <div className="boundary-toggle-wrap">
                  <button
                    type="button"
                    className="boundary-toggle active"
                    disabled
                  >
                    <Info size={17} />
                    <span>Ajustar início da série</span>
                    <i />
                  </button>
                </div>
              </article>
            )}
          </div>
        </section>
      )}
      {result.ageBuckets && (
        <section className="aging-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ENVELHECIMENTO</p>
              <h2>Idade dos movimentos na data de corte</h2>
            </div>
            <p>
              Idade pelo período contabilístico do movimento;
              fins de semana não aumentam o D+.
            </p>
          </div>
          <div className="aging-grid">
            {["D+0", "D+1", "D+2", "D+3", "D+4–7", "D+8+"].map((key) => {
              const item = result.ageBuckets?.[key] ?? {
                total: 0,
                automatic: 0,
                unreconciled: 0,
                amount: 0,
              };
              const rate = item.total ? (item.automatic / item.total) * 100 : 0;
              return (
                <article key={key}>
                  <span>{key}</span>
                  <strong>{item.unreconciled.toLocaleString("pt-AO")}</strong>
                  <small>
                    pendentes de {item.total.toLocaleString("pt-AO")}
                  </small>
                  <div>
                    <i style={{ width: `${rate}%` }} />
                  </div>
                  <b>{rate.toFixed(1)}% reconciliados</b>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {result.reconciliationTiming && (
        <section className="timing-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TEMPO DE RECONCILIAÇÃO</p>
              <h2>Quanto demoraram os grupos IDTR a fechar</h2>
            </div>
            <p>
              Dias úteis entre o primeiro e o último movimento de cada grupo que
              fecha a zero.
            </p>
          </div>
          <div className="timing-widgets">
            <article className="average">
              <span>Média</span>
              <strong>
                {result.reconciliationTiming.averageDays.toFixed(2)}
              </strong>
              <small>dias úteis por grupo</small>
            </article>
            {["D+0", "D+1", "D+2", "D+3", "D+4+"].map((key) => {
              const count = result.reconciliationTiming?.buckets[key] ?? 0,
                rate = result.reconciliationTiming?.totalGroups
                  ? (count / result.reconciliationTiming.totalGroups) * 100
                  : 0;
              return (
                <article key={key}>
                  <span>
                    {key === "D+0"
                      ? "No próprio dia"
                      : key === "D+4+"
                        ? "Mais de 3 dias"
                        : key.replace("+", "+ ") + "dia(s)"}
                  </span>
                  <strong>{rate.toFixed(1)}%</strong>
                  <small>{count.toLocaleString("pt-AO")} grupos</small>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <section className="movement-dashboard">
        <div className="section-heading">
          <div>
            <p className="eyebrow">VISÃO POR NATUREZA</p>
            <h2>Resultados por tipo de movimento</h2>
          </div>
          <p>
            Distribuição dos estados depois da aplicação automática das regras
            de reconciliação.
          </p>
        </div>
        <div className="movement-grid">
          {typeSummaries.map((type) => {
            const Icon = type.icon;
            return (
              <article className={`movement-card ${type.color}`} key={type.key}>
                <div className="movement-card-head">
                  <div className="movement-icon">
                    <Icon size={23} />
                  </div>
                  <div>
                    <h3>{type.label}</h3>
                    <p>{type.hint}</p>
                  </div>
                  <strong>{type.total.toLocaleString("pt-AO")}</strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${type.rate}%` }} />
                </div>
                <div className="movement-rate">
                  <span>Taxa reconciliada</span>
                  <strong>{type.rate}%</strong>
                </div>
                <div className="movement-states">
                  <div className="state-good">
                    <span>Reconciliados</span>
                    <strong>{type.reconciled.toLocaleString("pt-AO")}</strong>
                  </div>
                  <div className="state-warn">
                    <span>Não reconciliados</span>
                    <strong>{type.unreconciled.toLocaleString("pt-AO")}</strong>
                  </div>
                  <div className="state-bad">
                    <span>Sem IDTR</span>
                    <strong>{type.missingIdtr.toLocaleString("pt-AO")}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function ProcessingDashboard({
  fileName,
  progress,
}: {
  fileName: string;
  progress: AnalysisProgress;
}) {
  const [seconds, setSeconds] = useState(0);
  const [displayPercent, setDisplayPercent] = useState(progress.percent);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setDisplayPercent((shown) => Math.max(shown, progress.percent));
    if (progress.percent !== 38) return;
    const timer = window.setInterval(
      () =>
        setDisplayPercent((shown) =>
          shown < 84 ? Math.min(84, shown + (shown < 60 ? 1 : 0.5)) : shown,
        ),
      650,
    );
    return () => window.clearInterval(timer);
  }, [progress.percent]);
  const step =
    progress.percent < 10
      ? 1
      : progress.percent < 38
        ? 2
        : progress.percent < 67
          ? 3
          : progress.percent < 98
            ? 4
            : 5;
  const ingestionComplete = progress.percent >= 82;
  const liveMetrics = progress.liveV2
    ? [
        { label: "Processados", value: (progress.storedRows ?? progress.processed ?? 0).toLocaleString("pt-AO"), done: ingestionComplete, tone: "total" },
        { label: "Reconciliados · provisório", value: progress.percent >= 100 ? "Concluído" : progress.liveV2.provisionalReconciled.toLocaleString("pt-AO"), done: progress.percent >= 100, tone: "good" },
        { label: "Com IDTR", value: progress.liveV2.withNativeIdtr.toLocaleString("pt-AO"), done: ingestionComplete, tone: "idtr" },
        { label: "Sem IDTR ( /26)", value: progress.liveV2.withoutNativeIdtr.toLocaleString("pt-AO"), done: ingestionComplete, tone: "warn" },
        { label: "Saldo líquido", value: money.format(progress.liveV2.amountCents / 100), done: ingestionComplete, compact: true, tone: "balance" },
      ]
    : [
        { label: "Total movimentos", value: progress.liveTotals?.movements?.toLocaleString("pt-AO"), done: ingestionComplete, compact: false, tone: "total" },
        { label: "Reconciliados por IDTR", value: progress.liveTotals?.automatic?.toLocaleString("pt-AO"), done: progress.percent >= 100, compact: false, tone: "good" },
        { label: "Não reconciliados", value: progress.liveTotals?.unreconciled?.toLocaleString("pt-AO"), done: progress.percent >= 100, compact: false, tone: "warn" },
        { label: "Sem IDTR", value: progress.liveTotals?.missingIdtr?.toLocaleString("pt-AO"), done: ingestionComplete, compact: false, tone: "balance" },
      ];
  return (
    <section className="processing-dashboard" aria-live="polite">
      <div className="processing-hero">
        <div className="processing-spinner" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <p className="eyebrow">ANÁLISE EM CURSO · MOTOR ATIVO</p>
          <h2>Estamos a processar a reconciliação</h2>
          <p>{fileName}</p>
        </div>
        <div className="processing-percent">
          <strong>{displayPercent>=80&&displayPercent<100?displayPercent.toFixed(1):Math.floor(displayPercent)}%</strong>
          <span>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
      </div>
      <div className="processing-track">
        <span style={{ width: `${displayPercent}%` }}>
          <i />
        </span>
      </div>
      <div className="processing-status">
        <span className="processing-pulse" />
        <strong>
          {progress.percent === 38
            ? "A descomprimir a folha REAL TIME"
            : progress.stage}
        </strong>
        <span className="line-counter">
          {progress.serverBlocks ? (
            <><b>{progress.serverBlock?.toLocaleString("pt-AO")}</b> de <b>{progress.serverBlocks.toLocaleString("pt-AO")}</b> blocos</>
          ) : progress.total ? (
            <>
              <b>{(progress.processed ?? 0).toLocaleString("pt-AO")}</b> de{" "}
              <b>{progress.total.toLocaleString("pt-AO")}</b>{" "}
              {progress.unit ?? "linhas"}
            </>
          ) : progress.percent === 38 ? (
            <>Progresso estimado · a preparar a contagem real</>
          ) : (
            <>
              A identificar o número de linhas
              <span className="counting-dots">…</span>
            </>
          )}
        </span>
      </div>
      {progress.storedRows!==undefined&&(
        <div className="server-progress-meta">
          <span><b>{progress.storedRows.toLocaleString('pt-AO')}</b> linhas preservadas</span>
          <span>Tentativa <b>{Math.max(1,progress.attempt??1)}</b></span>
          <span>Última atividade <b>{progress.heartbeatAt?new Date(progress.heartbeatAt).toLocaleTimeString('pt-AO',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'a confirmar'}</b></span>
          <span>{progress.percent >= 82 ? "O processamento continua mesmo que feche esta página" : "Mantenha esta página aberta durante a leitura; se for interrompida, selecione novamente o mesmo ficheiro para retomar"}</span>
        </div>
      )}
      <div className="processing-steps">
        {[
          "Receção",
          "Classificados",
          "Agrupamento IDTR",
          "Validação",
          "Dashboard",
        ].map((label, index) => (
          <div
            className={
              index + 1 < step ? "done" : index + 1 === step ? "active" : ""
            }
            key={label}
          >
            <i>{index + 1 < step ? "✓" : index + 1}</i>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="processing-metrics">
        {liveMetrics.map(({label, value, done, compact, tone}) => (
          <article
            className={`${tone} ${value !== undefined ? `counting ${done ? "metric-done" : ""} ${compact ? "metric-compact" : ""}` : ""}`}
            key={label}
          >
            <span>{label}</span>
            {value === undefined ? (
              <i />
            ) : (
              <strong>{value}</strong>
            )}
            {value !== undefined && <b className="metric-state-icon" title={done ? "Contagem concluída" : "A calcular"}>{done ? <CheckCircle2 size={18}/> : <Cog className="metric-cog" size={18}/>}</b>}
          </article>
        ))}
      </div>
      <div className="processing-preview">
        <div>
          <h3>Resultados por tipo de movimento</h3>
          <p>
            Os cartões estão a ser preenchidos à medida que cada movimento é
            identificado e validado.
          </p>
        </div>
        <div className="processing-card-grid">
          {movementTypes.map((type) => {
            const Icon = type.icon;
            const counts = progress.liveMovementTypes?.[type.key];
            return (
              <article
                className={`${type.color} ${counts ? "counting" : ""}`}
                key={type.key}
              >
                <div className="processing-type-head">
                  <span>
                    <Icon size={17} />
                  </span>
                  <strong>{type.label}</strong>
                  <b>{counts?.total.toLocaleString("pt-AO") ?? "—"}</b>
                </div>
                {counts ? (
                  <div className="processing-type-states">
                    <span>
                      <b>{counts.reconciled.toLocaleString("pt-AO")}</b>{" "}
                      reconciliados
                    </span>
                    <span>
                      <b>{counts.unreconciled.toLocaleString("pt-AO")}</b>{" "}
                      pendentes
                    </span>
                    <span>
                      <b>{counts.missingIdtr.toLocaleString("pt-AO")}</b> sem
                      IDTR
                    </span>
                  </div>
                ) : (
                  <>
                    <i />
                    <i />
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SavedResults({
  revision,
  onImport,
}: {
  revision: number;
  onImport: () => void;
}) {
  void revision;
  return (
    <section className="panel empty-state">
      <BarChart3 size={28} />
      <h2>Ainda não existem resultados centrais</h2>
      <p>Importe o primeiro extrato para criar o dashboard.</p>
      <button className="primary-button" onClick={onImport}>
        Importar extrato
      </button>
    </section>
  );
}

function Guide() {
  return (
    <div className="guide-page">
      <section className="guide-hero">
        <div>
          <p className="eyebrow">GUIA OPERACIONAL</p>
          <h2>Como funciona a reconciliação</h2>
          <p>
            Os extratos alimentam uma série diária única; cada movimento é
            validado, deduplicado e reconciliado por IDTR.
          </p>
        </div>
        <div className="guide-delay">
          <Clock3 size={25} />
          <strong>Diário</strong>
          <span>acompanhamento contínuo</span>
        </div>
      </section>
      <section className="guide-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CICLO DA ANÁLISE</p>
            <h2>Da extração ao resultado auditável</h2>
          </div>
        </div>
        <div className="process-flow">
          <article>
            <span>1</span>
            <strong>Extrato bruto</strong>
            <p>
              Entram os movimentos com data, hora, operação, valor e informação
              complementar.
            </p>
          </article>
          <b>→</b>
          <article>
            <span>2</span>
            <strong>Integridade</strong>
            <p>
              Validam-se continuidade, intervalos e estrutura das colunas MR.
            </p>
          </article>
          <b>→</b>
          <article>
            <span>3</span>
            <strong>Base diária</strong>
            <p>
              Os movimentos novos são integrados e as sobreposições são
              deduplicadas.
            </p>
          </article>
          <b>→</b>
          <article>
            <span>4</span>
            <strong>Reconciliação</strong>
            <p>
              Os IDTR são agrupados e os movimentos que fecham a zero são
              reconciliados.
            </p>
          </article>
          <b>→</b>
          <article>
            <span>5</span>
            <strong>Resultado</strong>
            <p>
              Reconciliados, pendentes e exceções ficam disponíveis para análise
              e auditoria.
            </p>
          </article>
        </div>
      </section>
      <section className="guide-section impact-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ESCOLHA DA DATA</p>
            <h2>O impacto de analisar mais cedo ou mais tarde</h2>
          </div>
        </div>
        <div className="timing-grid">
          <article className="timing-early">
            <span>D+0</span>
            <h3>Monitorização imediata</h3>
            <p>
              Mostra a atividade do próprio dia e identifica cedo falhas de
              dados ou volumes anormais.
            </p>
            <ul>
              <li>Visibilidade operacional imediata</li>
              <li>Pendências ainda recentes</li>
              <li>Controlo da continuidade</li>
            </ul>
          </article>
          <article className="timing-best">
            <span>
              <CheckCircle2 size={15} /> D+1 a D+3
            </span>
            <h3>Acompanhamento</h3>
            <p>
              Permite observar quais IDTR fecharam nos dias seguintes e quais
              continuam abertos.
            </p>
            <ul>
              <li>Taxa diária de resolução</li>
              <li>Passagem de pendências entre dias</li>
              <li>Priorização por antiguidade</li>
            </ul>
          </article>
          <article className="timing-late">
            <span>D+4+</span>
            <h3>Escalonamento</h3>
            <p>
              Pendências antigas exigem verificação e eventual decisão manual
              auditável.
            </p>
            <ul>
              <li>Investigação operacional</li>
              <li>Justificação obrigatória</li>
              <li>Controlo administrativo</li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const identity = useAuth();
  type Tool = "portal" | "realtime" | "stc";
  type View =
    | "import"
    | "results"
    | "movements"
    | "guide"
    | "assumptions"
    | "movement-guide"
    | "history"
    | "users"
    | "audit";
  const [tool, setTool] = useState<Tool>(() => {
    const saved = sessionStorage.getItem("reconciliation-active-tool");
    return saved === "realtime" || saved === "stc" ? saved : "portal";
  });
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem("reconciliation-active-view");
    return saved === "import" ||
      saved === "results" ||
      saved === "movements" ||
      saved === "guide" ||
      saved === "assumptions" ||
      saved === "movement-guide" ||
      saved === "history" ||
      saved === "users" ||
      saved === "audit"
      ? saved
      : "import";
  });
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const selectView=(next:View)=>{setView(next);setMobileMenuOpen(false)};
  useEffect(()=>{if(!mobileMenuOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileMenuOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[mobileMenuOpen]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [v2Dashboard,setV2Dashboard]=useState<V2Dashboard|null>(null);
  const [centralLoading,setCentralLoading]=useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(()=>{
    document.body.dataset.appBusy=busy?'true':'false';
    return()=>{delete document.body.dataset.appBusy};
  },[busy]);
  const [progress, setProgress] = useState<AnalysisProgress>({
    percent: 0,
    stage: "A aguardar ficheiro",
  });
  const [processingFile, setProcessingFile] = useState("");
  const [recoverableImport, setRecoverableImport] = useState<(CentralImport & { analysisId: string }) | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("reconciliation-theme") === "dark" ? "dark" : "light",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const coverageGaps = useMemo(() => {
    const dates = Object.keys(result?.dailyMetrics ?? {}).sort();
    let gaps = 0;
    for (let index = 1; index < dates.length; index++) {
      const cursor = new Date(`${dates[index - 1]}T12:00:00`),
        end = new Date(`${dates[index]}T12:00:00`);
      cursor.setDate(cursor.getDate() + 1);
      let missing = false;
      while (cursor < end) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) missing = true;
        cursor.setDate(cursor.getDate() + 1);
      }
      if (missing) gaps++;
    }
    return gaps;
  }, [result?.dailyMetrics]);
  useEffect(() => {
    sessionStorage.setItem("reconciliation-active-tool", tool);
  }, [tool]);
  useEffect(() => {
    sessionStorage.setItem("reconciliation-active-view", view);
  }, [view]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("reconciliation-theme", theme);
  }, [theme]);
  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  useEffect(() => {
    if (identity.isDemo) {
      setResult(demoResult);
      setTool("realtime");
      setView("results");
      setError("");
      return;
    }
    let active = true;setCentralLoading(true);
    const recoverableTask=REALTIME_V2_ACTIVE?Promise.resolve():loadRecoverableImport().then(recoverable=>{if(active)setRecoverableImport(recoverable);}).catch(cause=>{if(active)setError(readableError(cause,"Não foi possível verificar importações interrompidas."));});
    const resultTask=REALTIME_V2_ACTIVE?Promise.resolve():loadPersistentResult().then(persisted=>{if(active&&persisted)setResult(persisted);}).catch(cause=>{if(active)setError(readableError(cause,"Não foi possível carregar os dados centrais."));});
    const v2Task=loadLatestV2Dashboard().then(dashboard=>{if(active&&dashboard)setV2Dashboard(dashboard);}).catch(cause=>{if(active)setError(readableError(cause,"Não foi possível carregar os indicadores V2."));});
    void Promise.allSettled([recoverableTask,resultTask,v2Task]).then(()=>{if(active)setCentralLoading(false);});
    return () => {
      active = false;
    };
  }, [identity.isDemo]);
  useEffect(()=>{
    if(identity.isDemo||!REALTIME_V2_ACTIVE)return;
    let active=true,hadServerImport=false;
    const sync=async()=>{
      try{
        const current=await loadActiveV2Import();if(!active)return;
        if(current){
          hadServerImport=true;setBusy(true);setProcessingFile(current.original_filename);setView('results');setError('');
          const processed=Number(current.source_rows??0),inserted=Number(current.inserted_rows??0),live=current.live_stats,total=Number(live?.estimatedRows??processed),blockMatch=String(current.stage??'').match(/bloco\s+(\d+)\s+de\s+(\d+)/i);
          if(current.state==='failed'&&processed>0&&processed===inserted&&String(current.error_message??'').startsWith('Não foi possível iniciar a reconciliação central')){
            setProgress(previous=>({...previous,percent:80,stage:'Movimentos guardados · a retomar a reconciliação central no servidor',processed,total,storedRows:inserted,unit:'linhas'}));
            await finalizeV2Import({seriesId:'',importId:current.id});
            return;
          }
          setProgress(previous=>({...previous,
            percent:Math.max(Number(current.progress)||0,previous.percent>81?previous.percent:0),
            stage:current.stage||'Processamento em curso no servidor. Aguarde.',processed,total,
            storedRows:inserted,unit:'linhas',heartbeatAt:current.heartbeat_at,
            serverBlock:blockMatch?Number(blockMatch[1]):undefined,serverBlocks:blockMatch?Number(blockMatch[2]):undefined,
            liveV2:live?{withNativeIdtr:Number(live.withNativeIdtr??0),withoutNativeIdtr:Number(live.withoutNativeIdtr??0),reference26:Number(live.reference26??0),amountCents:Number(live.amountCents??0),provisionalReconciled:Number(live.provisionalReconciled??0),duplicates:Number(current.duplicate_rows??0),rejected:Number(current.rejected_rows??0)}:previous.liveV2,
            liveMovementTypes:live?.movementTypes??previous.liveMovementTypes,
          }));
          return;
        }
        if(hadServerImport){
          hadServerImport=false;setBusy(false);
          const dashboard=await loadLatestV2Dashboard();
          if(active&&dashboard){setV2Dashboard(dashboard);setHistoryRevision(value=>value+1);setView('results');}
        }
      }catch(cause){if(active)setError(readableError(cause,'Não foi possível acompanhar a importação ativa.'));}
    };
    void sync();const timer=window.setInterval(()=>void sync(),3000);
    return()=>{active=false;window.clearInterval(timer);};
  },[identity.isDemo]);
  useEffect(()=>{
    if(identity.isDemo||recoverableImport?.processingStage!=='dashboard_summary')return;
    let active=true;
    const sync=async()=>{
      const current=await loadRecoverableImport();if(!active)return;
      if(!current){
        setRecoverableImport(null);setBusy(false);
        const persisted=await loadPersistentResult();if(active&&persisted){setResult(persisted);setHistoryRevision(value=>value+1);}
        return;
      }
      setRecoverableImport(current);setBusy(true);setProcessingFile(current.filename);setView('results');
      const done=current.dashboardSectionsCompleted??0,total=current.dashboardSectionsTotal??6;
      setProgress({percent:current.progressPercent??99,stage:`Cálculos protegidos no servidor · etapa ${Math.min(total,done+1)} de ${total}`,processed:done,total,unit:'blocos',storedRows:current.insertedCount,attempt:current.attemptCount,heartbeatAt:current.heartbeatAt});
    };
    void sync();const timer=window.setInterval(()=>void sync(),3000);
    return()=>{active=false;window.clearInterval(timer);};
  },[identity.isDemo,recoverableImport?.id,recoverableImport?.processingStage]);
  const process = async (file?: File) => {
    if (identity.isDemo) {
      setError("A importação está desativada no modo de demonstração.");
      return;
    }
    if (!file) return;
    if(REALTIME_V2_ACTIVE){
      setResult(null);setBusy(true);setError("");setProcessingFile(file.name);setProgress({percent:1,stage:"Ficheiro recebido"});setView("results");
      try{
        const outcome=await runV2Import(file,next=>setProgress(next));
        if(!outcome.dashboard)throw new Error("A importação terminou sem indicadores V2 disponíveis.");
        setV2Dashboard(outcome.dashboard);setHistoryRevision(value=>value+1);
      }catch(cause){setError(readableError(cause,"Não foi possível concluir a importação V2."));setView("import");}
      finally{setBusy(false);}
      return;
    }
    setBusy(true);
    setError("");
    setProcessingFile(file.name);
    setProgress({ percent: 1, stage: "Ficheiro recebido" });
    setView("results");
    let persistence: PersistenceContext | undefined;
    let importFinalized = false;
    try {
      const analyzed = await analyzeWorkbook(
        file,
        (next) =>
          setProgress((previous) => ({
            ...previous,
            ...next,
            liveTotals: next.liveTotals ?? previous.liveTotals,
            liveMovementTypes:
              next.liveMovementTypes ?? previous.liveMovementTypes,
          })),
        async (hash) => {
          const prepared = await preparePersistentImport(file, hash);
          persistence = prepared.context;
          return prepared;
        },
        async (source, hash, context) => {
          const session = await createMultipartSession(source, hash, context.batchId, context.accessToken);
          await uploadFileParts(source, session, context.accessToken, next => setProgress(previous=>({
            ...previous,
            percent:Math.max(previous.percent,1+Math.round(next.percent*.17)),
            stage:next.percent===100?'Ficheiro guardado e validado · a iniciar leitura':`A guardar o ficheiro com segurança · ${next.completedParts}/${next.totalParts} blocos`,
            processed:next.completedParts,
            total:next.totalParts,
            unit:'blocos',
          })));
        },
      );
      if (!persistence)
        throw new Error("Não foi possível preparar a importação central.");
      setProgress((previous) => ({
        ...previous,
        percent: 88,
        stage: "Movimentos guardados · a iniciar a reconciliação central",
      }));
      await finalizePersistentImport(analyzed, persistence, (next) =>
        setProgress((previous) => ({
          ...previous,
          percent: next.percent,
          stage: next.stage,
          processed: next.processed,
          total: next.total,
          unit: next.unit,
        })),
      );
      importFinalized = true;
      setRecoverableImport(null);
      const persisted = await loadPersistentResult();
      setResult(persisted ?? analyzed);
      setHistoryRevision((value) => value + 1);
    } catch (cause) {
      const message = readableError(cause,"Não foi possível analisar o ficheiro.");
      if (persistence && !importFinalized)
        try {
          await failPersistentImport(persistence, message);
          setRecoverableImport(await loadRecoverableImport());
        } catch {
          /* Preserva a mensagem original da importação. */
        }
      setError(
        importFinalized
          ? `A importação foi concluída, mas não foi possível atualizar o ecrã: ${message}. Utilize o botão Atualizar.`
          : message,
      );
      setView(importFinalized ? "results" : "import");
    } finally {
      setBusy(false);
    }
  };
  const resumeFinalization = async () => {
    if(!recoverableImport||busy)return;
    setBusy(true);setError("");setProcessingFile(recoverableImport.filename);setView("results");
    setProgress({percent:recoverableImport.progressPercent??88,stage:"A retomar a reconciliação central",processed:Math.max(0,(recoverableImport.processedBucket??-1)+1),total:recoverableImport.totalBuckets??64,unit:"blocos"});
    try{
      await resumePersistentFinalization(recoverableImport,(next)=>setProgress(previous=>({...previous,...next})));
      setRecoverableImport(null);
      const persisted=await loadPersistentResult();if(persisted)setResult(persisted);
      setHistoryRevision(value=>value+1);
    }catch(cause){
      const message=readableError(cause,"Não foi possível retomar a reconciliação.");
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(session)await failPersistentImport({url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,accessToken:session.access_token,analysisId:recoverableImport.analysisId,batchId:recoverableImport.id},message);
      }catch{/* A mensagem original continua a ser a relevante. */}
      setError(message);setRecoverableImport(await loadRecoverableImport());setView("import");
    }finally{setBusy(false);}
  };
  const refreshData = async () => {
    if (refreshing) return;
    if (identity.isDemo) {
      setResult(demoResult);
      setHistoryRevision((value) => value + 1);
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      if(!REALTIME_V2_ACTIVE){const persisted = await loadPersistentResult();if (persisted) setResult(persisted);}
      const dashboard=await loadLatestV2Dashboard();
      setV2Dashboard(dashboard);
      setHistoryRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar os dados centrais.",
      );
    } finally {
      setRefreshing(false);
    }
  };
  const installApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    window.alert(
      /iphone|ipad|ipod/i.test(navigator.userAgent)
        ? "No Safari, toque em Partilhar e escolha “Adicionar ao ecrã principal”."
        : "Abra o menu do navegador e escolha “Instalar aplicação” ou “Adicionar ao ecrã principal”.",
    );
  };
  const pageTitle =
    view === "import"
      ? "Nova reconciliação"
      : view === "results"
        ? "Resultados da reconciliação"
        : view === "movements"
          ? "Consulta e extração de movimentos"
          : view === "guide"
            ? "Como funciona"
            : view === "assumptions"
              ? "Pressupostos da reconciliação"
              : view === "movement-guide"
                ? "Instruções dos movimentos"
            : view === "history"
              ? "Histórico de análises"
              : view === "users"
                ? "Gestão de utilizadores"
                : "Auditoria da plataforma";
  const pageDescription =
    view === "import"
      ? "Importe diretamente o extrato Real Time, sem ficheiros intermédios."
      : view === "results"
        ? "Consulte os resultados e exceções identificadas."
        : view === "movements"
          ? "Filtre, ordene e extraia os movimentos disponíveis em Excel ou PDF."
          : view === "guide"
            ? "Compreenda o ciclo, as regras e o impacto da data escolhida."
            : view === "assumptions"
              ? "Consulte as regras contabilísticas e os critérios aplicados pelo motor."
              : view === "movement-guide"
                ? "Consulte como pesquisar, filtrar, carregar e exportar movimentos."
            : view === "history"
              ? "Consulte os carregamentos e resultados anteriores."
              : view === "users"
                ? "Crie, edite, ative ou bloqueie utilizadores."
                : "Consulte ações, reconciliações e exportações realizadas.";
  if (tool === "portal")
    return (
      <div className="tool-portal">
        <header>
          <div className="portal-brand">
            <img
              className="keve-logo portal-logo"
              src="/keve-logo-purple.png"
              alt="Keve — O Banco que avança"
            />
            <div>
              <strong>Portal de Reconciliação</strong>
              <span>Ferramentas operacionais</span>
            </div>
          </div>
          <div className="portal-header-actions">
            <div className="portal-user">
              <ShieldCheck size={18} />
              <div>
                <strong>{identity.name}</strong>
                <span>{identity.email}</span>
              </div>
            </div>
            <button className="portal-logout" onClick={() => void identity.signOut()}>
              <LogOut size={17} />
              Terminar sessão
            </button>
          </div>
        </header>
        <main>
          <div className="portal-heading">
            <p className="eyebrow">SELECIONE UMA FERRAMENTA</p>
            <h1>Reconciliações financeiras</h1>
            <p>
              Cada ferramenta mantém as suas próprias regras, importações,
              resultados e histórico.
            </p>
          </div>
          <div className="tool-grid">
            <article className="tool-card realtime">
              <div className="tool-card-icon">
                <Activity size={30} />
              </div>
              <span className="tool-status available">Disponível</span>
              <h2>Reconciliação Real Time</h2>
              <p>
                Importação direta dos extratos Real Time, reconciliação
                automática por IDTR e tratamento auditável das exceções.
              </p>
              <ul>
                <li>Extratos Real Time</li>
                <li>Reconciliação automática e auditável</li>
                <li>Histórico e deteção de anomalias</li>
              </ul>
              <button
                className="primary-button"
                onClick={() => {
                  setView("results");
                  setTool("realtime");
                }}
              >
                Abrir ferramenta
              </button>
            </article>
            <article className="tool-card stc">
              <div className="tool-card-icon">
                <ArrowLeftRight size={30} />
              </div>
              <span className="tool-status preparing">Em preparação</span>
              <h2>Reconciliação STC</h2>
              <h3>Sistema de Transferências a Crédito</h3>
              <p>
                Ferramenta dedicada ao tratamento e reconciliação das operações
                do STC, com regras e histórico independentes.
              </p>
              <ul>
                <li>Importações próprias do STC</li>
                <li>Regras específicas de transferências</li>
                <li>Auditoria separada</li>
              </ul>
              <button
                className="secondary-button"
                onClick={() => {
                  setView("results");
                  setTool("stc");
                }}
              >
                Ver ferramenta
              </button>
            </article>
          </div>
          <div className="portal-install-bottom">
            <button className="portal-install-hero" onClick={() => void installApp()}>
              <Download size={18} />
              <span><strong>Instalar aplicação</strong><small>Disponível para Windows e iPhone</small></span>
            </button>
          </div>
        </main>
      </div>
    );
  if (tool === "stc")
    return (
      <div className="tool-placeholder">
        <div>
          <div className="tool-card-icon">
            <ArrowLeftRight size={30} />
          </div>
          <p className="eyebrow">NOVA FERRAMENTA</p>
          <h1>Reconciliação STC</h1>
          <h2>Sistema de Transferências a Crédito</h2>
          <p>
            A estrutura está reservada e será desenvolvida com regras,
            importações e histórico próprios.
          </p>
          <button className="primary-button" onClick={() => setTool("portal")}>
            Voltar às ferramentas
          </button>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <button className="mobile-menu-toggle" type="button" aria-label={mobileMenuOpen?'Fechar menu':'Abrir menu'} aria-expanded={mobileMenuOpen} onClick={()=>setMobileMenuOpen(value=>!value)}>{mobileMenuOpen?<X size={22}/>:<Menu size={22}/>}</button>
      {mobileMenuOpen&&<button className="mobile-nav-backdrop" type="button" aria-label="Fechar menu" onClick={()=>setMobileMenuOpen(false)}/>}
      <aside className={mobileMenuOpen?'mobile-open':''}>
        <div className="brand">
          <img
            className="keve-logo sidebar-logo"
            src="/keve-logo-green.png"
            alt="Keve — O Banco que avança"
          />
          <div>
            <strong>Reconciliação</strong>
            <span>Real Time</span>
          </div>
        </div>
        <button className="tool-switcher" onClick={() => setTool("portal")}>
          <Grid2X2 size={17} />
          Todas as ferramentas
        </button>
        <nav>
          <button
            className={view === "guide" ? "active" : ""}
            onClick={() => selectView("guide")}
          >
            <BookOpen size={19} />
            Como funciona
          </button>
          <button
            className={`nav-submenu ${view === "assumptions" ? "active" : ""}`}
            onClick={() => selectView("assumptions")}
          >
            Pressupostos
          </button>
          <button
            className={view === "results" ? "active" : ""}
            title="Abrir o último dashboard de resultados"
            onClick={() => selectView("results")}
          >
            <BarChart3 size={19} />
            Resultados
          </button>
          <button
            className={view === "movements" ? "active" : ""}
            onClick={() => selectView("movements")}
          >
            <FileSpreadsheet size={19} />
            Movimentos
          </button>
          <button
            className={`nav-submenu ${view === "movement-guide" ? "active" : ""}`}
            onClick={() => selectView("movement-guide")}
          >
            Instruções
          </button>
          <button
            className={view === "history" ? "active" : ""}
            onClick={() => selectView("history")}
          >
            <History size={19} />
            Histórico
          </button>
          {identity.canManageUsers && (
            <button
              className={view === "users" ? "active" : ""}
              onClick={() => selectView("users")}
            >
              <Users size={19} />
              Utilizadores
            </button>
          )}
          {identity.canViewAudit && (
            <button
              className={view === "audit" ? "active" : ""}
              onClick={() => selectView("audit")}
            >
              <Activity size={19} />
              Auditoria
            </button>
          )}
          <button
            className={`nav-import ${view === "import" ? "active" : ""}`}
            disabled={identity.isDemo}
            title={identity.isDemo ? "Indisponível no modo de demonstração" : undefined}
            onClick={() => selectView("import")}
          >
            <Upload size={19} />
            Importar ficheiro
          </button>
          <button className="nav-logout" type="button" onClick={() => void identity.signOut()}>
            <LogOut size={19} />
            Terminar sessão
          </button>
        </nav>
        <div className="admin" title={identity.email}>
          <ShieldCheck size={18} />
          <div>
            <strong>{identity.name}</strong>
            <span>
              {identity.isPlatformOwner
                ? "Proprietário da plataforma"
                : identity.isDemo
                  ? "Demonstração"
                : identity.role === "client_admin"
                  ? "Administrador do cliente"
                  : identity.role === "auditor"
                    ? "Auditor"
                    : "Analista"}
            </span>
          </div>
        </div>
        <div className="sidebar-build">
          DIOGO ABRANCHES · VERSÃO {APP_BUILD}
        </div>
      </aside>
      <main>
        <header className="operational-header">
          <div>
            <p className="eyebrow">PAINEL OPERACIONAL</p>
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>
          <div className="header-controls">
            <span
              className={`header-series ${coverageGaps ? "warning" : "ok"}`}
            >
              {coverageGaps ? (
                <>
                  <AlertTriangle size={16} />
                  {coverageGaps} intervalo{coverageGaps > 1 ? "s" : ""} em falta
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Série diária contínua
                </>
              )}
            </span>
            <button
              type="button"
              title="Atualizar dados deste ecrã"
              aria-label="Atualizar dados deste ecrã"
              disabled={refreshing}
              onClick={() => void refreshData()}
            >
              <RefreshCw size={18} className={refreshing ? "spinning" : ""} />
            </button>
            <button
              type="button"
              title={
                theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"
              }
              aria-label={
                theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"
              }
              onClick={() =>
                setTheme((value) => (value === "light" ? "dark" : "light"))
              }
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>
        {identity.isDemo && (
          <div className="demo-mode-banner">
            MODO DEMONSTRAÇÃO · dados simulados · nenhuma alteração é enviada
            para a base central
          </div>
        )}
        {(!REALTIME_V2_ACTIVE || identity.isDemo) && <RealTimeOverview revision={historyRevision} result={result} />}
        {view === "import" && (
          <section
            className={`dropzone compact-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void process(e.dataTransfer.files[0]);
            }}
          >
            <div className="upload-icon">
              <Upload size={30} />
            </div>
            <h2>
              {busy
                ? "A processar o extrato…"
                : "Arraste o extrato Real Time para aqui"}
            </h2>
            <p>
              A plataforma lê diretamente as colunas MR, extrai o IDTR e
              reconcilia sem ficheiros intermédios.
            </p>
            <label className="primary-button">
              Selecionar extrato
              <input
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={(e) => void process(e.target.files?.[0])}
              />
            </label>
            <small>Formato aceite: extrato Real Time em XLSX</small>
            {recoverableImport && (
              <div className="import-recovery" role="status">
                <AlertTriangle size={20} />
                <div>
                  <strong>Existe uma importação por concluir</strong>
                  <span>{recoverableImport.filename}</span>
                  <small>
                    Fase: {recoverableImport.processingStage ?? "interrompida"} · {recoverableImport.progressPercent ?? 0}% · bloco {Math.max(0,(recoverableImport.processedBucket ?? -1)+1)} de {recoverableImport.totalBuckets ?? 16} concluído.
                  </small>
                  <p>Selecione novamente este mesmo ficheiro. As linhas já guardadas serão ignoradas e a reconciliação retomará no bloco seguinte.</p>
                  {recoverableImport.movementCount>0&&recoverableImport.insertedCount+recoverableImport.duplicateCount===recoverableImport.movementCount&&<button type="button" className="primary-button" disabled={busy} onClick={()=>void resumeFinalization()}>Retomar apenas os cálculos</button>}
                </div>
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </section>
        )}
        {view === "results" && busy && (
          <ProcessingDashboard fileName={processingFile} progress={progress} />
        )}
        {view === "results"&&!busy&&centralLoading&&!result&&(
          <section className="central-loading" role="status"><div className="processing-spinner"><i/><i/><i/></div><div><p className="eyebrow">A SINCRONIZAR</p><h2>A carregar dados centrais</h2><p>Indicadores, movimentos e histórico estão a ser lidos em paralelo. Não atualize a página.</p></div></section>
        )}
        {view === "results" && !busy && v2Dashboard && <V2Results dashboard={v2Dashboard} />}
        {view === "results" && !busy && !v2Dashboard && result && <Results result={result} />}
        {view === "results" && !busy && !v2Dashboard && !centralLoading && !result && (
          <SavedResults
            revision={historyRevision}
            onImport={() => setView("import")}
          />
        )}
        {view === "guide" && <Guide />}
        {view === "assumptions" && <V2Assumptions/>}
        {view === "movement-guide" && <V2MovementGuide/>}
        {view === "history" && (REALTIME_V2_ACTIVE?<V2History revision={historyRevision}/>:<HistoryDashboard result={result} />)}
        {view === "movements" && (REALTIME_V2_ACTIVE?<V2Movements revision={historyRevision}/>:<DataExplorer result={result} onImport={() => setView("import")} isDemo={identity.isDemo} />)}
        {view === "users" && identity.canManageUsers && <UserManagement />}
        {view === "audit" && identity.canViewAudit && <AuditLogPanel />}
      </main>
    </div>
  );
}

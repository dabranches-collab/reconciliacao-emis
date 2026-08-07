import {ArrowRight,CheckCircle2,Download,Filter,GitCompareArrows,Search,TableProperties,Upload} from 'lucide-react';
import {accountingAssumptions,reconciliationRules,reconciliationRuleVersion} from './reconciliationRules';
import './v2-reference.css';

export function V2Assumptions(){return <section className="v2-reference">
  <header><p className="eyebrow">DOCUMENTAÇÃO OPERACIONAL</p><h2>Pressupostos da reconciliação</h2><p>Regras contabilísticas aplicadas pelo motor · versão {reconciliationRuleVersion}</p></header>
  <div className="rule-flow"><div><Upload/><strong>Extrato original</strong><span>Preserva valores e identificadores</span></div><ArrowRight/><div><Search/><strong>Normalização auditável</strong><span>Cabeçalhos e campos derivados</span></div><ArrowRight/><div><GitCompareArrows/><strong>Reconciliação sequencial</strong><span>Sem fabricar IDTR</span></div><ArrowRight/><div><CheckCircle2/><strong>Resultado</strong><span>Fechados, abertos e anomalias</span></div></div>
  <div className="rule-cards">{reconciliationRules.map(rule=><article key={rule.id}><b>{rule.order}</b><h3>{rule.title}</h3><p>{rule.summary}</p><ul>{rule.conditions.map(condition=><li key={condition}><CheckCircle2/>{condition}</li>)}</ul></article>)}</div>
  <div className="assumption-grid">{accountingAssumptions.map(([title,text])=><article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div>
  <aside><strong>O que nunca acontece</strong><span>Um IDTR igual, isoladamente, não fecha movimentos; um lote não é encerrado só porque uma soma agregada deu zero; campos técnicos nunca são apresentados como IDTR nativo.</span></aside>
</section>}

export function V2MovementGuide(){return <section className="v2-reference">
  <header><p className="eyebrow">AJUDA À OPERAÇÃO</p><h2>Instruções</h2><p>Consulta, filtragem e extração dos movimentos contabilísticos.</p></header>
  <div className="rule-flow movement"><div><Filter/><strong>1. Filtrar</strong><span>Comece pelos movimentos em aberto e pela antiguidade.</span></div><ArrowRight/><div><TableProperties/><strong>2. Confirmar</strong><span>Veja o total do filtro antes de carregar mais linhas.</span></div><ArrowRight/><div><Download/><strong>3. Exportar</strong><span>Excel ou PDF contêm apenas o resultado filtrado.</span></div></div>
  <div className="assumption-grid"><article><h3>Prazos D+</h3><p>D+0 é o próprio período. “Há pelo menos D+1” inclui D+1 e todos os movimentos mais antigos.</p></article><article><h3>Carregamento</h3><p>A tabela mostra quantas linhas estão visíveis e quantas existem no filtro. Carregar mais acrescenta linhas sem perder filtros.</p></article><article><h3>Estados</h3><p>O ecrã abre nos pendentes. Os reconciliados e o total continuam disponíveis quando necessários.</p></article><article><h3>Exportação</h3><p>Antes de exportar confirme o número de movimentos. O PDF usa orientação horizontal e ajusta a largura a uma página.</p></article></div>
</section>}

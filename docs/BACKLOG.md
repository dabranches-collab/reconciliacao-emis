# Backlog do produto

Este documento regista melhorias comunicadas durante o desenvolvimento sem interromper o incremento em curso.

## Operações pendentes

- [x] Disponibilizar o ecrã Movimentos, aberto por defeito nos pendentes.
- [x] Mostrar as principais colunas contabilísticas e técnicas preservadas pela V2.
- [x] Filtrar por estado, período contabilístico e antiguidade operacional, com ordenação por coluna.
- [x] Exportar a lista filtrada para Excel.
- [x] Exportar a lista filtrada para PDF A4 horizontal, limitado a uma página de largura.
- [x] Registar no log de auditoria quem efetuou cada exportação, quando, quantas linhas e com que filtros.

## Concluído nas versões 2.1.3–2.1.4

- [x] Atualização real do menu Movimentos pelo botão global Atualizar.
- [x] Contagens D+ e consulta das linhas baseadas na mesma regra de dias operacionais.
- [x] Contadores por tipo de movimento durante a ingestão, persistentes após refresh.
- [x] Métricas de movimentos com/sem IDTR e reconciliados por método no dashboard.
- [x] Média ponderada do prazo de reconciliação.
- [x] Limpeza automática dos conjuntos técnicos de candidatos após cada importação.
- [x] Blocos futuros menores (128 IDTR / 64 secundários) para reduzir timeouts.
- [x] Cache diária de pendências, saldos, IDTR, métodos e anomalias para eliminar
  leituras integrais da série nos widgets e no fecho das importações.
- [x] Auditar a reaparição de IDTR já reconciliados sem desfazer pares anteriores
  que continuam a somar zero.
- [x] Servir contadores por cache diária e limitar cada página visual a 250
  movimentos para eliminar timeouts com a base fria.

## Evolução controlada

- [ ] Disponibilizar no seletor as restantes colunas brutas preservadas (conta, moeda, observações e informação complementar), ocultas por defeito.
- [ ] Configurar feriados bancários de Angola quando existir calendário oficial validado pelo cliente.
- [ ] Acrescentar pesquisa textual transversal no ecrã Movimentos depois de definir índices que não degradem milhões de linhas.
- [ ] Desenvolver a ferramenta STC quando forem entregues os ficheiros e regras próprios.

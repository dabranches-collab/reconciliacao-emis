# Reconciliação Real Time V2

## Objetivo

Substituir a cadeia atual por um processo único, durável, auditável e reproduzível. O navegador envia o ficheiro e apresenta o estado; toda a interpretação, reconciliação e agregação é executada de forma central.

## Dados preservados na transição

- `auth.users`
- `public.profiles`
- papéis, permissões e estado das contas
- `public.audit_logs`

Os dados operacionais da versão anterior podem ser eliminados depois da validação da V2: análises, importações, partes de upload, checkpoints, movimentos, grupos e métricas.

## Cadeia única

1. **Receção** — criação do trabalho e armazenamento durável do ficheiro original.
2. **Validação estrutural** — deteção de cabeçalhos por nomes normalizados e validação dos tipos.
3. **Ingestão imutável** — persistência dos valores originais sem alterar descrições, identificadores ou montantes.
4. **Deduplicação** — identificação determinística de movimentos já existentes.
5. **Reconciliação versionada** — execução sequencial das regras aprovadas, movimento a movimento.
6. **Métricas centrais** — cálculo a partir dos movimentos persistidos e dos grupos de reconciliação.
7. **Publicação** — o dashboard lê exclusivamente métricas concluídas.

## Princípios contabilísticos

- `MRVLR` é o valor original; o contra valor é sempre derivado como `-MRVLR`.
- `MRSALD` valida a evolução contabilística movimento a movimento.
- `MRDATL` é o eixo contabilístico principal.
- `MRDTSIS` é preservado para rastreabilidade.
- IDTR igual não chega: o grupo tem de conter pelo menos dois movimentos e fechar a zero.
- Regras secundárias emparelham movimentos, nunca fecham lotes apenas por soma agregada.
- O método e a versão da regra ficam registados em cada reconciliação.
- A idade D+ é medida em dias operacionais; fins de semana não aumentam o D+.
- Feriados serão fornecidos por um calendário operacional configurável e auditável.

## Contrato das métricas

Cada conjunto de métricas inclui:

- `analysis_id`
- `metric_date` ou período
- `rule_version`
- `calculation_status`: `pending`, `processing`, `completed` ou `failed`
- `calculated_at`
- totais e montantes necessários ao indicador

Uma métrica ausente ou ainda em cálculo nunca é apresentada como zero.

## Critérios para substituir a versão atual

- importação retomável após falha ou refresh;
- duplicados ignorados de forma determinística;
- totais conciliados com o número de linhas dos ficheiros;
- mesmas regras no dashboard, movimentos, filtros e exportações;
- testes de sexta-feira para segunda-feira como D+1;
- validação dos saldos `MRVLR`/`MRSALD`;
- comparação documentada com todos os extratos originais disponíveis;
- limpeza operacional executada apenas imediatamente antes da reimportação final.

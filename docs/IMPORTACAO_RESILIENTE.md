# Importação resiliente — contrato operacional

Este documento define o comportamento obrigatório da importação Real Time. O
browser é apenas a interface de acompanhamento; não é o executor do trabalho.

## Estados do lote

1. `uploading`: receção multipart do ficheiro original, com SHA-256 e número de
   partes confirmadas.
2. `uploaded`: objeto integral guardado e validado antes de ler movimentos.
3. `parsing`: leitura do XLSX e gravação idempotente dos movimentos.
4. `reconciling_primary`: reconciliação IDTR em blocos persistentes.
5. `reconciling_secondary`: referências `/26` e operação/descrição/valor.
6. `metrics`: agregados diários e indicadores.
7. `balances`: saldos e fronteira inicial.
8. `validating`: controlo cruzado de linhas, blocos e agregados.
9. `completed`: único estado apresentado como concluído.
10. `retrying` ou `failed`: interrupção recuperável ou falha que exige ação.

## Invariantes

- O ficheiro original é guardado antes do processamento.
- O hash identifica repetições; nunca se criam movimentos duplicados.
- Cada fase e cada bloco tem checkpoint central e idempotente.
- Fechar ou atualizar o browser não interrompe o executor.
- O estado mostrado no browser vem sempre da base central.
- Um lote só fica `completed` quando:
  - todas as partes do ficheiro foram confirmadas;
  - linhas lidas = inseridas + duplicadas + rejeitadas justificadas;
  - todos os checkpoints obrigatórios terminaram;
  - métricas diárias = totais globais;
  - saldos e resumo final foram calculados;
  - o registo de auditoria de conclusão foi criado.
- Uma falha nunca deixa o lote com aparência de trabalho ativo indefinidamente.

## Recuperação que tem de passar nos testes

- atualizar a página durante upload, leitura e reconciliação;
- fechar e reabrir o separador;
- perder a rede e recuperá-la;
- repetir o mesmo ficheiro;
- repetir uma parte do upload;
- falhar um bloco SQL e retomá-lo;
- expirar a sessão do utilizador depois do arranque;
- abrir o acompanhamento noutro computador.

## Progresso visível

O ecrã consulta o estado persistido e mostra fase, percentagem, unidades
processadas/total, última atividade e tentativa atual. Se não houver alteração
dentro do limite esperado, mostra `A retomar automaticamente`; nunca mostra
`Concluído` por ter terminado apenas uma chamada do browser.

# Análise do processo de reconciliação EMIS

## Regra temporal observada

Cada ficheiro de reconciliação é uma fotografia acumulada na data de corte. O processo junta:

1. os movimentos novos do extrato do período;
2. as operações que permaneciam pendentes no ficheiro anterior;
3. uma nova classificação entre `REC` (reconciliado) e `REAL TIME` (pendente).

O ficheiro é normalmente trabalhado dois a três dias depois da data de corte, permitindo que a maioria dos movimentos seja reconciliada pelos processos bancários entretanto executados.

## Significado dos estados de origem

- `Ok` e `OK`: o mesmo estado, reconciliado. A capitalização é inconsistente e não distingue reconciliação automática de manual.
- `N/Ok`: não reconciliado.
- `REAL TIME`: movimento ainda pendente na fotografia.
- Reconciliação manual: só pode ser identificada com segurança quando realizada na plataforma, registando utilizador, data, motivo e movimentos abrangidos.

## Cruzamento entre extratos e ficheiros trabalhados

| Período | Movimentos no extrato | Em REC | Em REAL TIME | N/Ok | Correspondência |
|---|---:|---:|---:|---:|---:|
| 08–14 julho | 857 883 | 796 746 | 61 137 | 0 | 100% |
| 15–22 julho | 919 126 | 834 582 | 84 544 | 0 | 100% |
| 23–28 julho | 745 248 | 705 120 | 40 127 | 1 | 100% |

Os extratos fornecem número de operação, valor com sinal, data contabilística, descrição e IDTR. Todos os movimentos dos três extratos foram encontrados no respetivo ficheiro trabalhado.

## Evolução das pendências

| Fotografia inicial | Pendentes | Reconciliados na fotografia seguinte | N/Ok | Ainda em REAL TIME | Não localizados |
|---|---:|---:|---:|---:|---:|
| 14 julho | 61 291 | 59 188 | 0 | 2 103 | 0 |
| 22 julho | 86 647 | 86 544 | 97 | 6 | 0 |
| 28 julho | 40 133 | 40 127 | 3 | 3 | 0 |

A reprodução histórica usou a combinação IDTR normalizado + número de operação + valor em cêntimos. Todas as pendências foram localizadas na fotografia seguinte, sem lacunas.

## Chaves recomendadas

A correspondência não deve usar apenas número de operação e valor, porque esses campos repetem-se. A chave de comparação deve priorizar:

1. IDTR normalizado (`IDTR=` + 14 caracteres);
2. número de operação;
3. valor em cêntimos;
4. conta e moeda;
5. data contabilística como verificação adicional.

Movimentos sem IDTR seguem para uma fila de exceção e nunca devem ser conciliados automaticamente apenas por semelhança textual.

## Fluxo recomendado para a plataforma

1. Reconhecer automaticamente se o ficheiro é extrato bruto ou reconciliação trabalhada.
2. Registar data de corte, data de carregamento e período coberto.
3. Importar movimentos novos sem duplicar movimentos previamente conhecidos.
4. Transportar todas as pendências da fotografia anterior.
5. Agrupar por IDTR e validar saldo zero em cêntimos.
6. Classificar como reconciliado, pendente, sem IDTR ou erro de dados.
7. Permitir reconciliação manual apenas com motivo obrigatório e log de auditoria.
8. Guardar cada fotografia para medir o tempo até reconciliação e reconstruir historicamente qualquer decisão.

# Análise dos extratos originais — agosto de 2026

Este documento regista a análise exploratória dos dois ficheiros confirmados pelo
utilizador como exportações não trabalhadas. Não constitui ainda autorização para
alterar a lógica de importação ou reconciliação.

## 1. Fontes normativas analisadas

Localização externa ao repositório:

`C:\Users\diogo\OneDrive\Diogo\PERSONAL\00 - APPS\APP RECONCILIAÇÃO EMIS\EXTRATOS`

- `Extracto 01 a 03 Julho 2026.xlsx`: 440 544 movimentos.
- `Extracto 06 a 08 Julho 2026.xlsx`: 637 181 movimentos.
- Total: 1 077 725 movimentos.

Os dois ficheiros têm uma folha chamada `Folha1`, 21 colunas, os mesmos
cabeçalhos e nenhuma fórmula. As datas dos nomes não foram usadas nos cálculos;
os períodos abaixo foram obtidos exclusivamente da coluna contabilística.

## 2. Dicionário de cabeçalhos

O formato original usa cabeçalhos descritivos. Os nomes técnicos observados nos
ficheiros antigos são aliases históricos, não nomes obrigatórios do formato.

| Campo semântico | Cabeçalho original confirmado | Alias técnico antigo |
| --- | --- | --- |
| Balcão da conta contabilística | Balcão da conta contabilística | `MRBALC` |
| Conta contabilística | Conta contabilística | `MRCCB` |
| Balcão | Balcão | `MRBAL` |
| Conta | Conta | `GBMRCONTA` |
| Tipo de documento | Tipo de documento | `MRTDOC` |
| Número do documento | Número documento | `MRNDOC` |
| Código da operação | Código operação | `MRCOPE` |
| Número da operação | Número da operação | `MRNOPR` |
| Valor original assinado | Valor do movimento | `MRVLR` |
| Moeda | Moeda | `MRMOED` |
| Descrição original | Descritivo movimento | `MRDMOV` |
| Saldo após o movimento | Saldo após movimento | `MRSALD` |
| Utilizador de lançamento | Lançado por | `MRUSER` |
| Data de sistema | Data de sistema | `MRDTSIS` |
| Hora de sistema | Hora de sistema | `MRHORA` |
| Data/período contabilístico | Periodo contabilístico de lançamento | `MRDATL` |
| Diário ou caixa | Diário ou caixa | `MRDRCX` |
| Estação de lançamento | Estação lançamento | `MRETRB` |
| Balcão do movimento | Balcão movimento | `MRBALM` |
| Observações | Observações | `MROBS` |
| Informação complementar | Informação Complementar do movimento | `GBMRINFC` |

O futuro importador deve resolver aliases por cabeçalho normalizado e validar a
semântica pelo conteúdo. Deve guardar o cabeçalho original detetado. A posição
física pode ser usada para diagnóstico, nunca como contrato.

## 3. Valores, saldos e datas

- `Valor do movimento` já é um valor original assinado.
- Não existe coluna auxiliar sem cabeçalho nem fórmula `=-MRVLR` nos originais.
- Em todas as 1 077 723 transições comparáveis, sem contar a primeira linha de
  cada ficheiro, verificou-se:
  `saldo anterior + valor do movimento = saldo após movimento`, com tolerância
  de 0,011 AKZ.
- Foram encontradas zero violações dessa relação.
- O primeiro ficheiro cobre contabilisticamente 1 a 3 de julho de 2026.
- O segundo cobre contabilisticamente 6 a 8 de julho de 2026.
- A data de sistema pode ser anterior à data contabilística. Deve ser preservada
  para rastreabilidade; a data contabilística é o eixo operacional.

## 4. IDTR nativo

`Informação Complementar do movimento` contém nativamente estruturas como
`IDTR=...;NORD=...;`. A extração deve preservar a string original e guardar o IDTR
num campo derivado, sem reescrever a origem.

Nos dois ficheiros:

- 1 075 423 linhas têm IDTR nativo.
- 2 302 linhas não têm IDTR.
- 917 670 linhas pertencem a grupos com o mesmo IDTR, pelo menos duas linhas e
  soma igual a zero.
- Existem 5 489 grupos reconciliados com mais de duas linhas, cobrindo 21 956
  movimentos. O maior grupo observado tem quatro movimentos.

Logo, não é válida uma regra limitada a exatamente duas linhas.

## 5. Referências `/26`

As 2 302 linhas sem IDTR têm todas, sem exceção, uma referência iniciada por
`/26` em `Observações`. Não foi encontrada nenhuma linha `/26` com IDTR nativo.

Ao retirar apenas a barra inicial e procurar o resultado como IDTR nativo:

- 1 939 referências encontram contraparte;
- em todos os 1 939 casos os valores são opostos e a soma é zero;
- são 3 878 movimentos reconciliáveis por esta relação;
- 363 referências não têm contraparte na janela analisada e devem permanecer
  pendentes até existirem dados adjacentes.

No ficheiro preparado de 8 a 14 de julho, os 362 casos sobrepostos do dia 8
foram todos transformados de `/26...` para `IDTR=26...` tanto em `MROBS` como em
`GBMRINFC`. Esta é uma regra derivada do processo manual, não um IDTR nativo.
Deve ser registada com método próprio, por exemplo `observation_reference`.

## 6. Anulações `ANL-`

O prefixo `ANL-` é nativo:

- 4 569 linhas originais começam por `ANL-`;
- todas têm IDTR nativo;
- 3 955 encontram um movimento de valor oposto, mesmo número de operação e
  mesma descrição após remover somente o prefixo para comparação;
- 3 920 desses pares têm a mesma data contabilística;
- 614 não encontram par exato na janela analisada.

A descrição original nunca deve ser alterada. A remoção de `ANL-` só pode existir
num campo de comparação derivado e auditável.

## 7. Método observado nos ficheiros BK

O BK marcado como certo usa este fluxo:

1. mantém Data, Conta, Valor, Número da operação, Descrição e Informação
   complementar na folha `REAL TIME`;
2. extrai os primeiros 19 caracteres da informação com `LEFT(...,19)`;
3. cria uma tabela dinâmica que agrupa uma chave e soma `Valor Movimento`;
4. classifica `OK` quando a soma agrupada é zero;
5. usa `VLOOKUP` para transportar o estado para cada linha;
6. mantém um saldo acumulado e compara o somatório com o saldo contabilístico.

O critério de procura não foi constante:

- BK 8–14 julho: `VLOOKUP` por número da operação;
- BK 15–22 julho: `VLOOKUP` por IDTR;
- BK 23–28 julho: `VLOOKUP` por número da operação;
- BK “certo”: `VLOOKUP` por IDTR.

Isto confirma variação humana do método entre períodos.

Os ficheiros preparados também mostram fórmulas auxiliares `=-MRVLR` e cópias
entre colunas depois de alterar `Observações`. Não são parte do formato original.

## 8. Sequência candidata, ainda não implementada

1. Validar esquema, tipos, período contabilístico e continuidade do saldo.
2. Reconciliar por IDTR nativo: pelo menos duas parcelas e soma zero.
3. Reconciliar `/26` contra IDTR nativo correspondente, guardando método
   `observation_reference`.
4. No residual, procurar movimento a movimento por número da operação,
   descrição normalizada, mesmo valor absoluto e sinais opostos. A data
   contabilística ajuda a desempatar, mas não deve impedir um par noutro dia.
5. Manter casos ambíguos ou sem contraparte como pendentes.
6. Guardar regra, versão, chave, movimentos associados, utilizador/origem e
   instante da decisão.

Após IDTR e `/26` ficam 156 177 movimentos. No residual, o critério exato de
operação + descrição normalizada + valor absoluto + sinais opostos identifica
16 462 linhas na mesma data ou 16 528 permitindo datas diferentes. Estes são
candidatos e ainda exigem uma política determinística para duplicados.

## 9. Decisões ainda necessárias

- Definir desempate quando existem várias parcelas equivalentes.
- Definir tolerância monetária oficial; a análise usou 0,005 para fecho e 0,011
  para continuidade de saldo devido a representação decimal do Excel.
- Definir como apresentar as 363 referências `/26` e as 614 anulações sem par na
  janela disponível.
- Validar a sequência candidata com mais dias adjacentes antes de mudar produção.


export const reconciliationRuleVersion='rt-v2.1.0';

export const openAgeDefinitions={
  current:'D+0 a D+7: movimentos ainda dentro da janela operacional corrente.',
  historical:'D+8 ou mais: movimentos antigos que continuam sem contrapartida, sem contar a fronteira inicial.',
} as const;

export const reconciliationRules=[
  {id:'idtr',order:1,title:'IDTR nativo',summary:'Fecha todos os movimentos com o mesmo IDTR apenas quando o conjunto soma zero.',conditions:['IDTR presente no extrato','Dois ou mais movimentos','Soma de MRVLR = 0,00'],method:'idtr'},
  {id:'operation_description_unique',order:2,title:'Par contabilístico único',summary:'Fecha automaticamente um único débito e um único crédito que se explicam sem ambiguidade.',conditions:['Mesmo número de operação','Mesma descrição comparável; ANL- pode ser apenas o prefixo de anulação','Valor absoluto igual e sinais opostos','Exatamente uma linha de cada sinal'],method:'operation_description'},
  {id:'operation_review',order:3,title:'Operação com soma zero',summary:'Cria uma proposta para confirmação técnica quando todas as parcelas da operação somam zero.',conditions:['Mesmo número de operação','Dois ou mais movimentos ainda abertos','Soma de MRVLR = 0,00','Linhas visíveis antes da decisão'],method:'operation'},
  {id:'operation_description_review',order:4,title:'Operação e descrição comparável',summary:'No residual, cria uma proposta auditável por operação e descrição, tratando ANL- apenas como prefixo de comparação.',conditions:['Mesmo número de operação','Descrição comparável após retirar o prefixo inicial ANL-','Soma de MRVLR = 0,00','Confirmação humana quando existem várias parcelas'],method:'operation_description'},
] as const;

export const accountingAssumptions=[
  ['Período contabilístico','É obtido dos dados do extrato; o nome do ficheiro nunca define datas.'],
  ['MRVLR','É o valor original e imutável. Um contra valor, quando necessário, é calculado como −MRVLR.'],
  ['Saldo contabilístico','A evolução recebida é validada movimento a movimento; divergências ficam como anomalias auditáveis.'],
  ['Data de sistema','É preservada para rastreabilidade, sem substituir o período contabilístico.'],
  ['Prazos D+','São contados em dias operacionais, excluindo sábado e domingo. O calendário de feriados fica explícito como configuração futura, não como regra presumida.'],
  ['Fronteira inicial','Pode excluir-se do saldo ajustado o efeito de movimentos cujo início é anterior ao primeiro extrato disponível.'],
  ['Abertos atuais e históricos',`${openAgeDefinitions.current} ${openAgeDefinitions.historical}`],
  ['Janela operacional','Todos os movimentos por reconciliar permanecem ativos. As reconciliações dos últimos 7 dias ficam na janela operacional; as anteriores permanecem disponíveis no histórico, nas métricas e nos grupos agregados, sem voltarem a entrar no motor.'],
  ['Confirmação técnica','As propostas secundárias mantêm todas as linhas disponíveis no menu Confirmações. A aprovação individual ou em lote volta a validar que as linhas estão abertas e que o saldo continua exatamente em zero.'],
] as const;

export const reconciliationRuleVersion='rt-v2.0.0';

export const reconciliationRules=[
  {id:'idtr',order:1,title:'IDTR nativo',summary:'Fecha todos os movimentos com o mesmo IDTR apenas quando o conjunto soma zero.',conditions:['IDTR presente no extrato','Dois ou mais movimentos','Soma de MRVLR = 0,00'],method:'idtr'},
  {id:'operation_description',order:2,title:'Operação, descrição e valor',summary:'Nos movimentos ainda abertos, emparelha débito e crédito movimento a movimento.',conditions:['Mesmo número de operação','Mesma descrição normalizada','Mesmo valor absoluto e sinais opostos'],method:'operation_description'},
] as const;

export const accountingAssumptions=[
  ['Período contabilístico','É obtido dos dados do extrato; o nome do ficheiro nunca define datas.'],
  ['MRVLR','É o valor original e imutável. Um contra valor, quando necessário, é calculado como −MRVLR.'],
  ['Saldo contabilístico','A evolução recebida é validada movimento a movimento; divergências ficam como anomalias auditáveis.'],
  ['Data de sistema','É preservada para rastreabilidade, sem substituir o período contabilístico.'],
  ['Prazos D+','São contados em dias operacionais, excluindo sábado e domingo. O calendário de feriados fica explícito como configuração futura, não como regra presumida.'],
  ['Fronteira inicial','Pode excluir-se do saldo ajustado o efeito de movimentos cujo início é anterior ao primeiro extrato disponível.'],
] as const;

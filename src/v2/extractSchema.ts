export const extractFields = {
  account: ['Conta contabilística','MRCCB'],
  amount: ['Valor do movimento','MRVLR'],
  currency: ['Moeda','MRMOED'],
  description: ['Descritivo movimento','MRDMOV'],
  balance: ['Saldo após movimento','MRSALD'],
  systemDate: ['Data de sistema','MRDTSIS'],
  systemTime: ['Hora de sistema','MRHORA'],
  accountingDate: ['Periodo contabilístico de lançamento','Período contabilístico de lançamento','MRDATL'],
  operationNumber: ['Número da operação','Numero da operação','MRNOPR'],
  observations: ['Observações','Observacoes','MROBS'],
  complementaryInfo: ['Informação Complementar do movimento','Informacao Complementar do movimento','GBMRINFC'],
} as const;

export type ExtractField = keyof typeof extractFields;
export type HeaderResolution = {
  columns: Record<ExtractField,number> | null;
  normalizedHeaders: string[];
  missing: ExtractField[];
  ambiguous: {field:ExtractField;indexes:number[]}[];
};

export const normalizeHeader=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function resolveExtractHeaders(headers:unknown[]):HeaderResolution{
  const normalizedHeaders=headers.map(normalizeHeader);
  const missing:ExtractField[]=[];
  const ambiguous:{field:ExtractField;indexes:number[]}[]=[];
  const columns={} as Record<ExtractField,number>;
  for(const [field,aliases] of Object.entries(extractFields) as [ExtractField,readonly string[]][]){
    const accepted=new Set(aliases.map(normalizeHeader));
    const indexes=normalizedHeaders.flatMap((header,index)=>accepted.has(header)?[index]:[]);
    if(indexes.length===0)missing.push(field);
    else if(indexes.length>1)ambiguous.push({field,indexes});
    else columns[field]=indexes[0];
  }
  return {columns:missing.length||ambiguous.length?null:columns,normalizedHeaders,missing,ambiguous};
}

export type RawMovementRow = Record<ExtractField,unknown>;

export function selectRawMovement(row:unknown[],columns:Record<ExtractField,number>):RawMovementRow{
  return Object.fromEntries((Object.keys(extractFields) as ExtractField[]).map(field=>[field,row[columns[field]]])) as RawMovementRow;
}

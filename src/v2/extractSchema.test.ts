import {describe,expect,it} from 'vitest';
import {resolveExtractHeaders,selectRawMovement} from './extractSchema';

const descriptive=['Conta contabilística','Valor do movimento','Moeda','Descritivo movimento','Saldo após movimento','Data de sistema','Hora de sistema','Período contabilístico de lançamento','Número da operação','Observações','Informação Complementar do movimento'];
const technical=['MRCCB','MRVLR','MRMOED','MRDMOV','MRSALD','MRDTSIS','MRHORA','MRDATL','MRNOPR','MROBS','GBMRINFC'];

describe('contrato dos extratos V2',()=>{
  it.each([{headers:descriptive},{headers:technical}])('resolve cabeçalhos por nome, independentemente da posição',({headers})=>{
    const shuffled=[headers[4],headers[2],...headers.slice(5),headers[0],headers[3],headers[1]];
    const result=resolveExtractHeaders(shuffled);
    expect(result.missing).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(selectRawMovement(shuffled,result.columns!).amount).toBe(headers[1]);
  });

  it('rejeita antes da ingestão quando falta uma coluna obrigatória',()=>{
    const result=resolveExtractHeaders(descriptive.filter(header=>header!=='Valor do movimento'));
    expect(result.columns).toBeNull();
    expect(result.missing).toContain('amount');
  });

  it('rejeita cabeçalhos ambíguos em vez de escolher silenciosamente',()=>{
    const result=resolveExtractHeaders([...descriptive,'MRVLR']);
    expect(result.columns).toBeNull();
    expect(result.ambiguous[0]).toMatchObject({field:'amount'});
  });
});

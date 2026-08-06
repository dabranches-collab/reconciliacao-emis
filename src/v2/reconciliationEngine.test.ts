import { describe, expect, it } from 'vitest';
import { reconcileCandidates, type CandidateMovement } from './reconciliationEngine';

const movement = (id:string,amountCents:number,overrides:Partial<CandidateMovement>={}):CandidateMovement=>({
  id,amountCents,accountingDate:'2026-07-10',nativeIdtr:null,operationNumber:'OP-1',descriptionNormalized:'transferencia',reference26:null,...overrides,
});

describe('motor de reconciliação V2',()=>{
  it('não fecha um IDTR isolado mesmo com valor zero',()=>{
    const result=reconcileCandidates([movement('1',0,{nativeIdtr:'IDTR=1'})]);
    expect(result.groups).toHaveLength(0);
    expect(result.openMovementIds).toEqual(['1']);
  });

  it('fecha dois ou mais movimentos do mesmo IDTR apenas quando o saldo é zero',()=>{
    const result=reconcileCandidates([
      movement('1',10000,{nativeIdtr:'IDTR=1'}),movement('2',-9900,{nativeIdtr:'IDTR=1'}),movement('3',-100,{nativeIdtr:'IDTR=1'}),
    ]);
    expect(result.groups[0]).toMatchObject({method:'idtr',movementIds:['1','2','3'],balanceCents:0});
  });

  it('mantém aberto um grupo IDTR cujo saldo não fecha',()=>{
    const result=reconcileCandidates([movement('1',10000,{nativeIdtr:'IDTR=1'}),movement('2',-9000,{nativeIdtr:'IDTR=1'})]);
    expect(result.groups).toHaveLength(0);
    expect(result.openMovementIds).toHaveLength(2);
  });

  it('emparelha os restantes movimento a movimento por operação, descrição e valor oposto',()=>{
    const result=reconcileCandidates([movement('1',10000),movement('2',-10000),movement('3',5000)]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({method:'operation_description',movementIds:['1','2']});
    expect(result.openMovementIds).toEqual(['3']);
  });

  it('não fecha um lote secundário só porque a soma agregada é zero',()=>{
    const result=reconcileCandidates([movement('1',10000),movement('2',-6000),movement('3',-4000)]);
    expect(result.groups).toHaveLength(0);
    expect(result.openMovementIds).toHaveLength(3);
  });
});

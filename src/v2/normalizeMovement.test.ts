import {describe,expect,it} from 'vitest';
import {BalanceSequenceValidator,normalizeMovementRow} from './normalizeMovement';
import type {RawMovementRow} from './extractSchema';

const raw=(overrides:Partial<RawMovementRow>={}):RawMovementRow=>({account:'2521247',amount:100,currency:'AOA',description:'ANL- TRANSFERÊNCIA',balance:1100,systemDate:20260710,systemTime:120000,accountingDate:20260710,operationNumber:'OP1',observations:'/2612345',complementaryInfo:'IDTR=02863800046789',...overrides});

describe('normalização auditável V2',()=>{
  it('mantém ANL na descrição derivada e não transforma /26 em IDTR',()=>{
    const movement=normalizeMovementRow(raw({complementaryInfo:'',observations:'/2612345'}));
    expect(movement.descriptionNormalized).toBe('anl transferencia');
    expect(movement.nativeIdtr).toBeNull();
    expect(movement.reference26).toBe('/2612345');
  });
  it('extrai apenas um IDTR nativo explicitamente identificado',()=>expect(normalizeMovementRow(raw()).nativeIdtr).toBe('IDTR=02863800046789'));
  it('usa MRDATL como data principal e MRDTSIS apenas como alternativa',()=>{
    expect(normalizeMovementRow(raw({accountingDate:20260709,systemDate:20260710})).accountingDate).toBe('2026-07-09');
    expect(normalizeMovementRow(raw({accountingDate:'',systemDate:20260710})).accountingDate).toBe('2026-07-10');
  });
  it('valida MRVLR contra a evolução de MRSALD por conta',()=>{
    const validator=new BalanceSequenceValidator();
    expect(validator.validate(normalizeMovementRow(raw({amount:100,balance:1100})))).toEqual({valid:true});
    expect(validator.validate(normalizeMovementRow(raw({amount:-40,balance:1060})))).toEqual({valid:true});
    expect(validator.validate(normalizeMovementRow(raw({amount:10,balance:999})))).toMatchObject({valid:false,expectedBalanceCents:107000,actualBalanceCents:99900});
    expect(validator.validate(normalizeMovementRow(raw({amount:1,balance:1000})))).toEqual({valid:true});
  });
  it('mantém sequências de saldo independentes por conta e moeda',()=>{
    const validator=new BalanceSequenceValidator();
    expect(validator.validate(normalizeMovementRow(raw({currency:'AOA',amount:100,balance:1100})))).toEqual({valid:true});
    expect(validator.validate(normalizeMovementRow(raw({currency:'USD',amount:5,balance:25})))).toEqual({valid:true});
    expect(validator.validate(normalizeMovementRow(raw({currency:'AOA',amount:-100,balance:1000})))).toEqual({valid:true});
  });
});

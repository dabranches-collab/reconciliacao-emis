import { describe, expect, it } from 'vitest';
import { movementFingerprint } from './rawExtractParser';

const movement=['2026-07-09','08:31:22','2026-07-09','627827','159300001',2500,'POS-MCX','/26 12345','IDTR=02861900000001'];

describe('movementFingerprint',()=>{
  it('identifica a mesma linha em ficheiros sobrepostos',()=>{
    expect(movementFingerprint(movement)).toBe(movementFingerprint([...movement]));
  });

  it.each([
    [2,'2026-07-10'],
    [4,'159300002'],
    [5,-2500],
    [6,'Fecho POS'],
    [8,'IDTR=02861900000002'],
  ])('distingue alterações relevantes na posição %s',(position,value)=>{
    const changed=[...movement];changed[Number(position)]=value;
    expect(movementFingerprint(changed)).not.toBe(movementFingerprint(movement));
  });
});

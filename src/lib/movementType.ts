export type MovementTypeKey = 'pos' | 'atm' | 'transfer' | 'commission' | 'service' | 'other';

export function classifyMovement(description: string): MovementTypeKey {
  const text = description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (text.includes('COMISS')) return 'commission';
  if (text.includes('ATM')) return 'atm';
  if (text.includes('POS')) return 'pos';
  if (text.includes('TRANSF') || text.includes('TRF') || text.includes('/NIB') || text.includes('HBMB')) return 'transfer';
  if (text.includes('SERVIC') || text.includes('PAGAMENTO')) return 'service';
  return 'other';
}

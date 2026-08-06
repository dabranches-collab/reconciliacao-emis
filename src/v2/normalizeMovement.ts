import {normalizeHeader,type RawMovementRow} from './extractSchema';

export type NormalizedMovement={
  systemDate:string|null;systemTime:string|null;accountingDate:string;account:string;
  amountCents:number;currency:string;operationNumber:string;descriptionNormalized:string;
  balanceCents:number|null;nativeIdtr:string|null;reference26:string|null;
};

const dateValue=(value:unknown)=>{
  const digits=String(value??'').replace(/\D/g,'');
  if(digits.length!==8)return null;
  const year=Number(digits.slice(0,4)),month=Number(digits.slice(4,6)),day=Number(digits.slice(6));
  const result=`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6)}`;
  const parsed=new Date(`${result}T12:00:00Z`);
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()+1===month&&parsed.getUTCDate()===day?result:null;
};
const cents=(value:unknown)=>{
  if(value===null||value===undefined||value==='')return null;
  const number=typeof value==='number'?value:Number(String(value).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(number)?Math.round(number*100):null;
};
const timeValue=(value:unknown)=>{
  if(value===null||value===undefined||value==='')return null;
  const text=String(value).trim();
  const separated=text.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  const digits=separated
    ?`${separated[1].padStart(2,'0')}${separated[2].padStart(2,'0')}${(separated[3]??'0').padStart(2,'0')}`
    :text.replace(/\D/g,'').padStart(6,'0').slice(-6);
  const hours=Number(digits.slice(0,2)),minutes=Number(digits.slice(2,4)),seconds=Number(digits.slice(4));
  if(hours>23||minutes>59||seconds>59)return null;
  return `${digits.slice(0,2)}:${digits.slice(2,4)}:${digits.slice(4)}`;
};
const nativeIdtr=(value:unknown)=>{
  const match=String(value??'').match(/(?:^|[;\s])IDTR\s*=\s*([A-Za-z0-9]{14})(?=$|[;\s])/i);
  return match?`IDTR=${match[1].toUpperCase()}`:null;
};
const reference26=(value:unknown)=>{
  const match=String(value??'').match(/(?:^|[;\s])\/(26\d+)(?=$|[;\s])/);
  return match?`/${match[1]}`:null;
};

export function normalizeMovementRow(raw:RawMovementRow):NormalizedMovement{
  const amountCents=cents(raw.amount),balanceCents=cents(raw.balance),systemDate=dateValue(raw.systemDate),accountingDate=dateValue(raw.accountingDate)??systemDate;
  if(amountCents===null)throw new Error('MRVLR não contém um valor numérico válido.');
  if(!accountingDate)throw new Error('MRDATL não contém uma data válida e não existe MRDTSIS utilizável.');
  return {systemDate,systemTime:timeValue(raw.systemTime),accountingDate,account:String(raw.account??'').trim(),amountCents,currency:String(raw.currency??'AOA').trim()||'AOA',operationNumber:String(raw.operationNumber??'').trim(),descriptionNormalized:normalizeHeader(raw.description),balanceCents,nativeIdtr:nativeIdtr(raw.complementaryInfo),reference26:reference26(raw.observations)};
}

export class BalanceSequenceValidator{
  private readonly last=new Map<string,number>();
  validate(movement:NormalizedMovement){
    const sequenceKey=`${movement.account}\u001f${movement.currency}`;
    const previous=this.last.get(sequenceKey);
    if(movement.balanceCents!==null){
      if(previous!==undefined&&previous+movement.amountCents!==movement.balanceCents){this.last.set(sequenceKey,movement.balanceCents);return {valid:false,expectedBalanceCents:previous+movement.amountCents,actualBalanceCents:movement.balanceCents};}
      this.last.set(sequenceKey,movement.balanceCents);
    }
    return {valid:true as const};
  }
}

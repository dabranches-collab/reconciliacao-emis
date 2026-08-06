import type { AnalysisResult, Movement } from "./types";
import type { CentralImport } from "./lib/database";

const movements: Movement[] = [
  { id:"demo-1", row:12, reportDate:"2026-08-01", account:"DEMO-001", amount:-125000, currency:"AOA", operationNumber:"OP-1001", description:"Compra POS", complementaryInfo:"Terminal DEMO 01", idtr:"IDTR=DEMO00000001", status:"automatic" },
  { id:"demo-2", row:13, reportDate:"2026-08-02", account:"DEMO-001", amount:125000, currency:"AOA", operationNumber:"OP-1002", description:"Liquidação POS", complementaryInfo:"Compensação simulada", idtr:"IDTR=DEMO00000001", status:"automatic" },
  { id:"demo-3", row:28, reportDate:"2026-08-03", account:"DEMO-002", amount:-85000, currency:"AOA", operationNumber:"OP-1003", description:"Levantamento ATM", complementaryInfo:"ATM DEMO 04", idtr:"IDTR=DEMO00000002", status:"unreconciled" },
  { id:"demo-4", row:35, reportDate:"2026-08-04", account:"DEMO-003", amount:240000, currency:"AOA", operationNumber:"OP-1004", description:"Transferência recebida", complementaryInfo:"Canal digital", idtr:"IDTR=DEMO00000003", status:"automatic" },
  { id:"demo-5", row:36, reportDate:"2026-08-05", account:"DEMO-003", amount:-240000, currency:"AOA", operationNumber:"OP-1005", description:"Transferência compensada", complementaryInfo:"Canal digital", idtr:"IDTR=DEMO00000003", status:"automatic" },
  { id:"demo-6", row:44, reportDate:"2026-08-05", account:"DEMO-004", amount:-3500, currency:"AOA", operationNumber:"OP-1006", description:"Comissão de serviço", complementaryInfo:"Movimento simulado", idtr:null, status:"missing_idtr" },
  { id:"demo-7", row:51, reportDate:"2026-08-06", account:"DEMO-005", amount:-42000, currency:"AOA", operationNumber:"OP-1007", description:"Pagamento de serviços", complementaryInfo:"Serviço DEMO", idtr:"IDTR=DEMO00000004", status:"unreconciled" },
  { id:"demo-8", row:59, reportDate:"2026-08-06", account:"DEMO-006", amount:96000, currency:"AOA", operationNumber:"OP-1008", description:"Operação diversa", complementaryInfo:"Amostra de consulta", idtr:"IDTR=DEMO00000005", status:"manual" },
];

const importHistory: CentralImport[] = [
  { id:"demo-batch-2", reportDate:"2026-08-06", filename:"Extrato_DEMO_01_a_06_Agosto.xlsx", uploadedAt:"2026-08-06T09:20:00Z", uploadedBy:"Utilizador Demo", movementCount:4200, insertedCount:4100, duplicateCount:100, errorCount:0, status:"completed", failureMessage:null, completedAt:"2026-08-06T09:22:00Z" },
  { id:"demo-batch-1", reportDate:"2026-07-31", filename:"Extrato_DEMO_25_a_31_Julho.xlsx", uploadedAt:"2026-08-01T08:10:00Z", uploadedBy:"Utilizador Demo", movementCount:3800, insertedCount:3800, duplicateCount:0, errorCount:0, status:"completed", failureMessage:null, completedAt:"2026-08-01T08:12:00Z" },
];

export const demoResult: AnalysisResult & { importHistory: CentralImport[] } = {
  periodStart:"2026-08-01",
  reportDate:"2026-08-06",
  accountingBalance:5350000,
  sourceFilename:"Extrato_DEMO_01_a_06_Agosto.xlsx",
  movements,
  groups:[],
  totals:{ movements:8000, automatic:7240, manual:120, unreconciled:639, missingIdtr:1, amount:377500 },
  rawAmounts:{ debits:124500000, credits:124877500, net:377500, openingBalance:4972500, closingBalance:5350000 },
  movementTypes:{
    pos:{total:3200,reconciled:3000,unreconciled:200,missingIdtr:0},
    atm:{total:1250,reconciled:1120,unreconciled:130,missingIdtr:0},
    transfer:{total:1800,reconciled:1690,unreconciled:110,missingIdtr:0},
    commission:{total:450,reconciled:410,unreconciled:39,missingIdtr:1},
    service:{total:900,reconciled:760,unreconciled:140,missingIdtr:0},
    other:{total:400,reconciled:380,unreconciled:20,missingIdtr:0},
  },
  dailyMetrics:{
    "2026-08-01":{movements:1200,automatic:1090,unreconciled:110,missingIdtr:0,amount:45000},
    "2026-08-02":{movements:1100,automatic:1010,unreconciled:90,missingIdtr:0,amount:-12000},
    "2026-08-03":{movements:1350,automatic:1215,unreconciled:135,missingIdtr:0,amount:81000},
    "2026-08-04":{movements:1280,automatic:1170,unreconciled:110,missingIdtr:0,amount:62500},
    "2026-08-05":{movements:1420,automatic:1275,unreconciled:144,missingIdtr:1,amount:103000},
    "2026-08-06":{movements:1650,automatic:1480,unreconciled:170,missingIdtr:0,amount:98000},
  },
  ageBuckets:{
    d0:{total:310,automatic:180,unreconciled:130,amount:42000},
    d1:{total:240,automatic:160,unreconciled:80,amount:-85000},
    d2:{total:160,automatic:120,unreconciled:40,amount:125000},
    d3:{total:90,automatic:70,unreconciled:20,amount:0},
    d4_7:{total:120,automatic:100,unreconciled:20,amount:0},
    d8_plus:{total:0,automatic:0,unreconciled:0,amount:0},
  },
  reconciliationTiming:{averageDays:1.2,totalGroups:3420,buckets:{d0:420,d1:2600,d2:380,d3:20,d4_plus:0}},
  importHistory,
};

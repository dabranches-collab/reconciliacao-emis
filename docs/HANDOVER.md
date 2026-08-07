# Handover — Reconciliação EMIS

Este documento permite continuar o projeto noutro computador sem depender do histórico da conversa anterior.

## 1. Localizar ou criar o espaço de trabalho

O agente deve executar esta sequência:

1. Verificar se existe `C:\Projetos\reconciliacao-emis` e se contém `.git`.
2. Se existir, usar essa pasta e nunca o clone do OneDrive.
3. Se não existir, perguntar: **“Em que pasta local do disco C: pretende criar o repositório? Recomendo `C:\Projetos\reconciliacao-emis`.”**
4. Criar apenas a pasta confirmada pelo utilizador.
5. Clonar `https://github.com/dabranches-collab/reconciliacao-emis.git` para essa localização.
6. O OneDrive pode conter extratos e documentos de apoio, mas não deve ser usado como pasta ativa de desenvolvimento devido a sincronização e bloqueios.

## 2. Verificações obrigatórias antes de trabalhar

Na pasta local:

```powershell
git remote -v
git branch --show-current
git status --short
git fetch origin
git log --oneline -5
```

- Confirmar que o remoto é `dabranches-collab/reconciliacao-emis`.
- Trabalhar normalmente no ramo `main`, salvo instrução diferente.
- Se existirem alterações locais, preservá-las e compreender a sua origem antes de editar.
- Comparar `HEAD` com `origin/main`; se o clone estiver atrasado e limpo, atualizar de forma não destrutiva.

## 3. Ferramentas e acessos

Confirmar, sem expor segredos:

- Git e acesso ao GitHub.
- Node.js e `pnpm`.
- Cloudflare/Wrangler autenticado na conta que publica `reconciliacao-emis`.
- Supabase ligado ao projeto `sxvhsqlaonrxuuehlcwt`.
- Sessão do utilizador no browser, quando forem necessários testes autenticados.

Nunca colocar no frontend, documentação ou GitHub:

- `SUPABASE_SERVICE_ROLE_KEY`.
- Tokens do GitHub ou Cloudflare.
- Passwords de utilizadores.

## 4. Instalação e servidor local

Instalar as dependências do lockfile:

```powershell
pnpm install
```

Iniciar o servidor local em segundo plano ou num terminal dedicado:

```powershell
pnpm exec vite --host 127.0.0.1 --port 4174
```

Abrir `http://127.0.0.1:4174/` no browser integrado. A sessão online não é partilhada automaticamente com a origem local; o utilizador poderá ter de iniciar sessão novamente. O agente nunca deve pedir nem preencher a password do utilizador.

## 5. Ambientes centrais

- Produção: `https://reconciliacao-emis.dabranches.workers.dev/`
- GitHub: `https://github.com/dabranches-collab/reconciliacao-emis`
- Supabase: projeto `sxvhsqlaonrxuuehlcwt`
- Administrador proprietário: `dabranches@gmail.com`

O código é centralizado no GitHub. Os dados, utilizadores e logs são centralizados no Supabase. A publicação web é feita no Cloudflare Workers.

## 6. Modelo atual de permissões

- `demo`: acesso de demonstração integrado na aplicação publicada, sempre na versão corrente. Usa apenas dados simulados no frontend, sem conta Supabase e sem leituras ou escritas na base central. Importação, reconciliação manual, gestão de utilizadores e auditoria ficam indisponíveis.

- `platform_owner`: proprietário da plataforma. Acesso total e exclusivo à Auditoria. A conta `dabranches@gmail.com` usa este perfil e é protegida.
- `client_admin`: administra contas operacionais e outros administradores do cliente, mas não vê a Auditoria nem o proprietário.
- `analyst`: usa as funções operacionais, sem gestão de utilizadores.
- `auditor`: perfil operacional de consulta, sem gestão de utilizadores.

As restrições existem na interface, nas Edge Functions e nas políticas RLS. Nunca reduzir esta proteção a esconder menus.

## 7. Validação antes de publicar

Executar:

```powershell
pnpm build
pnpm test
git diff --check
```

Para alterações no Supabase:

- Consultar a documentação e changelog atuais.
- Criar e guardar uma migração no repositório.
- Aplicar a migração ao projeto correto.
- Executar os Security Advisors.
- Fazer uma consulta de verificação das políticas/dados alterados.

Para alterações visuais, testar no mínimo:

- 1920×1080 a 100%, 125% e 150%.
- 1920×1200 a 100%, 125% e 150%.
- iPhone 16 Pro.
- Modos claro e escuro.
- Ausência de scroll horizontal no dashboard e na importação; tabelas podem ter scroll interno quando necessário.

## 8. Publicação e versionamento

Usar versão semântica em `package.json`:

- Patch (`0.9.1`): correção sem nova funcionalidade.
- Minor (`0.10.0`): funcionalidade compatível nova.
- Major (`1.0.0`): primeira versão estável ou alteração incompatível relevante.

Sequência normal:

1. Compilar e testar.
2. Rever `git status` e `git diff`.
3. Criar commit descritivo.
4. Fazer push para o GitHub.
5. Publicar no Cloudflare.
6. Validar a versão online no browser autenticado.
7. Confirmar que `git status --short` fica limpo.

A integração GitHub → Cloudflare usa `pnpm build` como comando de build e
`npx wrangler deploy` como comando de implantação. O `pnpm-workspace.yaml`
deve manter `packages: ["."]` para ser compatível com o pnpm usado no Workers Builds.

## 9. PWA

A aplicação inclui manifest, service worker e botão de instalação na barra superior.

- PC: usar o botão de instalação ou a opção **Instalar aplicação** do browser.
- iPhone: abrir no Safari, tocar em **Partilhar** e escolher **Adicionar ao ecrã principal**.
- A aplicação instalada continua a necessitar de internet para dados e autenticação do Supabase; o modo offline atual cobre apenas a estrutura visual básica.

## 10. Estado funcional resumido

- Importação direta de extratos Real Time.
- As importações centrais têm estado explícito (`processing`, `completed`, `failed`). Só uma finalização validada pode marcar um lote como concluído.
- Uma importação interrompida pode ser retomada com o mesmo ficheiro: os movimentos já persistidos são ignorados pela impressão digital e apenas os restantes são inseridos.
- A tabela de histórico distingue linhas lidas, inseridas e duplicadas; sobreposições entre extratos são esperadas e não criam movimentos repetidos.
- Deduplicação central de movimentos sobrepostos.
- Reconciliação automática por IDTR.
- Reconciliação manual com justificação e auditoria.
- Dashboard diário, histórico e exportação Excel/PDF filtrada.
- Gestão central de utilizadores.
- Auditoria central no Supabase.
- PWA instalável.
- A entrada em cada ferramenta deve abrir por defeito o respetivo dashboard de Resultados, e não o ecrã de importação.
- STC reservado para desenvolvimento futuro com ficheiros e regras próprios.

## 11. Bloqueio atual: formato real dos extratos

**Não alterar nem publicar a lógica de importação/reconciliação antes de receber e
validar uma exportação comprovadamente original do sistema.** Os ficheiros usados
até agora podem ter sido preparados manualmente e não são uma fonte normativa do
formato de entrada.

O utilizador está a aguardar novos ficheiros e continuará o trabalho noutro
computador. Quando os receber, deve confirmar a proveniência antes de os usar:

- exportação direta do sistema, sem abrir e voltar a guardar no Excel;
- sem colunas, fórmulas, macros, descrições ou identificadores acrescentados;
- o nome do ficheiro nunca deve determinar datas, período ou regras;
- cabeçalhos, datas e período devem ser descobertos exclusivamente pelo conteúdo.

### 11.1 Pressupostos errados encontrados no importador V1

O importador V1 dependia de posições fixas do formato preparado:

- `row[9]` como valor assinado, correspondente a uma coluna sem cabeçalho com
  fórmula semelhante a `=-MRVLR`;
- `row[21]` como informação complementar/IDTR, correspondente ao cabeçalho
  técnico `GBMRINFC` nos ficheiros preparados;
- `MRDTSIS` é usado em partes do fluxo como data principal, embora o trabalho
  contabilístico deva ter como base o período/data contabilística de lançamento.

O importador V2 localiza colunas por cabeçalhos normalizados, nunca por posições,
e não exige colunas auxiliares. O valor nativo é
`MRVLR`; uma inversão de sinal, se realmente necessária, deve ser calculada pela
aplicação. Somar `MRVLR` ou `-MRVLR` produz o mesmo teste de fecho a zero, mas os
dois conceitos não devem ser confundidos com o efeito contabilístico no saldo.

### 11.2 Datas e validação contabilística implementadas

- A data/período contabilístico de lançamento deve ser o eixo principal de
  períodos, saldos, dashboards, reconciliação e idade das pendências.
- A data de sistema deve ser preservada separadamente para rastreabilidade, não
  usada como substituto silencioso da data contabilística.
- O período real de cada ficheiro deve ser obtido pelos mínimos e máximos das
  datas contabilísticas válidas encontradas nas linhas.
- A relação entre `MRVLR` e `MRSALD` deve ser validada por movimentos consecutivos
  da mesma conta, tolerando apenas limites de conta/período e linhas técnicas
  comprovadas.
- Se o ficheiro não satisfizer as invariantes contabilísticas, a importação deve
  falhar de forma explícita em vez de produzir resultados parciais silenciosos.

### 11.3 IDTR e reconciliação secundária validados

Os ficheiros originais confirmaram o IDTR nativo na informação complementar e a
referência `/26` em Observações nos movimentos sem IDTR. A aplicação preserva
essa proveniência, não converte `/26` em IDTR e não fabrica identificadores.

Regras determinísticas aplicadas:

1. IDTR: mesmo identificador, pelo menos dois movimentos e soma contabilística
   exatamente igual a zero. Ter apenas o mesmo IDTR não basta.
2. Sobre o saldo residual: mesmo número de operação, descrição normalizada,
   mesmo valor absoluto e sinais opostos. Emparelhar movimentos individualmente;
   não fechar um lote inteiro apenas porque a soma agregada deu zero.
3. Guardar o método (`idtr`, `operation_description` ou `manual`) e uma chave de
   reconciliação própria. Nunca escrever uma chave técnica como se fosse um IDTR
   proveniente do sistema.
4. Preservar sempre os valores e descrições originais, mantendo normalizações em
   campos derivados e auditáveis.

### 11.4 Evidência anterior, apenas exploratória

Nos três ficheiros preparados de 8 a 28 de julho foram analisados 2.522.257
movimentos. O fecho por IDTR/soma zero cobriu 2.365.126 linhas. No saldo residual,
operação + descrição + valores opostos encontrou 26.688 linhas; ao ignorar o
prefixo manual aparente `ANL-`, encontrou 49.622. Estes números demonstram que há
uma segunda forma plausível de reconciliação, mas **não devem ser usados como
verdade funcional** enquanto os originais não forem validados.

Os ficheiros chamados `Extracto 01 a 03 Julho 2026.xlsx` e
`Extracto 06 a 08 Julho 2026.xlsx` também ficaram sob suspeita e a análise foi
interrompida. Tinham 21 colunas, sem a coluna auxiliar invertida, mas a última
coluna, “Informação Complementar do movimento”, já continha `IDTR=...`. É preciso
determinar se essa coluna é nativa ou resultado de preparação manual.

### 11.5 Originais confirmados e análise de 6 de agosto de 2026

O utilizador confirmou posteriormente que os dois ficheiros na pasta externa
`EXTRATOS` são exportações não trabalhadas. A análise integral confirmou o
formato descritivo de 21 colunas, zero fórmulas, IDTR nativo na informação
complementar, referências alternativas `/26` em `Observações` e `ANL-` nativo.

A continuidade contabilística foi validada em todas as 1 077 723 transições
comparáveis, sem falhas: saldo anterior + valor original do movimento = saldo
após o movimento. A coluna auxiliar invertida dos ficheiros preparados não faz
parte do formato original.

As conclusões, o dicionário de aliases, as métricas e o método variável observado
nos ficheiros BK estão documentados em
`docs/ANALISE_EXTRATOS_ORIGINAIS.md`.

O bloqueio dos ficheiros originais e da aprovação das regras foi resolvido pelo
utilizador. As regras implementadas estão centralizadas em
`src/v2/reconciliationRules.ts`, visíveis nos menus Pressupostos e Instruções e
versionadas em cada grupo de reconciliação.

## 12. Estado da aplicação após 7 de agosto de 2026

A linha ativa é a versão `2.1.8`. O importador usa exclusivamente o formato
original confirmado, encontra colunas por cabeçalhos normalizados e preserva os
valores nativos. O Worker da Cloudflare conduz a finalização no servidor por
blocos determinísticos; fechar ou atualizar o browser depois da ingestão já não
interrompe a reconciliação.

### 12.1 Importações centrais

Foram concluídos, por período contabilístico, os oito extratos de 1 de julho a
5 de agosto de 2026. A série contém 4.427.932 movimentos: 4.226.096
reconciliados e 201.836 em aberto. O último extrato, de 31 de julho a 5 de
agosto, contém 768.925 movimentos, dos quais 673.915 ficaram reconciliados e
95.010 em aberto; não teve rejeições, duplicados nem anomalias de saldo.

Na auditoria após esse fecho surgiu um IDTR já reconciliado que voltou a aparecer
num extrato posterior. O par anterior (+20.880 / -20.880) continuava correto e o
novo movimento (-20.880) ficou em aberto. Não se dissolve um grupo anterior
que soma zero só porque o identificador reapareceu; o novo conjunto só fecha se
as parcelas disponíveis voltarem a somar zero. Não existem chaves IDTR com dois
grupos de reconciliação na série atual.

### 12.2 Garantias do processo

- O histórico só apresenta `Concluída` depois de ingestão, reconciliação,
  métricas e saldos terminarem.
- Cada importação tem um identificador de workflow determinístico. Uma repetição
  retoma a mesma execução e não cria duas reconciliações concorrentes.
- A passagem entre execuções guarda apenas dados serializáveis; nunca devolve o
  objeto interno de uma instância Cloudflare.
- Os buckets de reconciliação são sequenciais. O ensaio em paralelo provocava
  `lock_timeout` nas tabelas de candidatos e era mais lento apesar da aparência
  de paralelismo.
- O progresso provisório é guardado em `rt_v2_imports.live_stats`, permitindo a
  recuperação do mesmo ecrã noutro separador ou após refresh.
- A partir da 2.1.3, as contagens por tipo de movimento também ficam em
  `live_stats`; os cartões continuam preenchidos depois de refresh ou troca de
  browser. A reconciliação provisória por IDTR atualiza esses cartões sem uma
  segunda passagem pelo ficheiro.
- A conclusão produz exatamente um registo `v2_import_completed` no log central.
- As importações novas usam 128 buckets IDTR e 64 secundários. Ao concluir, um
  trigger elimina apenas candidatos técnicos temporários, reduzindo o custo de
  I/O das execuções seguintes.
- Pendências, montantes, IDTR, métodos e anomalias ficam agregados nas métricas
  diárias. Os widgets, gráficos e saldo final deixam de percorrer milhões de
  movimentos em cada importação; os valores da cache foram conferidos contra a
  série integral e coincidem exatamente.

### 12.3 Funcionalidade já ligada

- resultados compactos por movimentos, antiguidade e prazo de reconciliação;
- saldo bruto, impacto da fronteira inicial e saldo ajustado, com representação
  divergente positiva/negativa;
- detalhe clicável das anomalias de sequência contabilística;
- gráfico com calendário corrido, fins de semana compactados, lacunas visíveis e
  seleção diária, semanal, mensal ou anual;
- histórico ordenado por período contabilístico;
- Movimentos aberto por defeito nos pendentes, com totais centrais, ordenação,
  datas, seleção de colunas, carregamento progressivo e exportação filtrada para
  Excel ou PDF horizontal;
- atalhos cumulativos de antiguidade: próprio dia, pelo menos 1, 2 ou 3 dias e
  todos os pendentes;
- menus Pressupostos e Instruções alimentados pela mesma versão das regras;
- gestão de utilizadores e separação entre administrador de cliente e
  proprietário com acesso ao log central;
- PWA para Windows/iPhone, verificação de versão após 15 minutos de inatividade,
  tema claro/escuro e navegação móvel fixa.
- No iPhone, a navegação usa um botão fixo no canto superior esquerdo e abre um
  painel vertical deslocável, mantendo os submenus visíveis e fechando após a
  seleção. As exportações XLSX guardam datas como datas e montantes/saldos como
  números com formatação contabilística.
- Em 7 de agosto de 2026, os dados operacionais V1 foram eliminados e a respetiva
  tabela de movimentos ficou vazia. A V2 foi preservada integralmente. Na gestão
  de acessos ficou apenas a conta protegida do proprietário da plataforma.

### 12.4 Operação e recuperação

Durante a leitura local do XLSX, manter o separador aberto: é o browser que lê e
envia os lotes. Assim que o ecrã indicar “Processamento em curso no servidor”, a
ingestão terminou e o workflow é durável. O botão de atualizar consulta novamente
Supabase sem mudar de menu. Nunca apagar uma importação em `reconciling` apenas
por a percentagem demorar; verificar primeiro `heartbeat_at`, o workflow e os
logs Postgres.

No computador novo, procurar primeiro `C:\Projetos\reconciliacao-emis` e validar
que contém `.git`. Se não existir, perguntar ao utilizador onde criar a pasta
local no disco C:, clonar o remoto oficial e só depois instalar dependências.
Nunca trabalhar no clone do OneDrive nem copiar extratos para o repositório.

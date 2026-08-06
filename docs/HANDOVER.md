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

## 9. PWA

A aplicação inclui manifest, service worker e botão de instalação na barra superior.

- PC: usar o botão de instalação ou a opção **Instalar aplicação** do browser.
- iPhone: abrir no Safari, tocar em **Partilhar** e escolher **Adicionar ao ecrã principal**.
- A aplicação instalada continua a necessitar de internet para dados e autenticação do Supabase; o modo offline atual cobre apenas a estrutura visual básica.

## 10. Estado funcional resumido

- Importação direta de extratos Real Time.
- Deduplicação central de movimentos sobrepostos.
- Reconciliação automática por IDTR.
- Reconciliação manual com justificação e auditoria.
- Dashboard diário, histórico e exportação Excel/PDF filtrada.
- Gestão central de utilizadores.
- Auditoria central no Supabase.
- PWA instalável.
- A entrada em cada ferramenta deve abrir por defeito o respetivo dashboard de Resultados, e não o ecrã de importação.
- STC reservado para desenvolvimento futuro com ficheiros e regras próprios.

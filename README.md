# Reconciliação EMIS

Aplicação web para importar ficheiros Excel da reconciliação EMIS Real Time, reconciliar automaticamente grupos pelo IDTR e manter histórico auditável das decisões manuais.

## Desenvolvimento local

1. Copiar `.env.example` para `.env` e preencher a chave publicável do Supabase.
2. Executar `pnpm install`.
3. Executar `pnpm dev`.

## Regras iniciais

- O IDTR canónico é composto pelos primeiros 19 caracteres no formato `IDTR=` + 14 caracteres.
- Todos os movimentos do mesmo IDTR são agrupados.
- Um grupo é reconciliado automaticamente quando a soma, em cêntimos, é exatamente zero.
- Grupos não equilibrados permanecem pendentes e podem ser reconciliados manualmente com justificação e auditoria.
- Novos ficheiros são integrados como lotes; movimentos anteriores são preservados e as regras são reaplicadas.

## Segurança

- O administrador inicial é atribuído ao utilizador autenticado com o email `dabranches@gmail.com`.
- A chave `service_role` nunca pertence ao frontend.
- Ficheiros Excel são privados e excluídos do Git.
- Todas as tabelas expostas usam Row Level Security.

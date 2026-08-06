# Instruções obrigatórias para agentes

Antes de alterar este projeto, ler integralmente `docs/HANDOVER.md` e cumprir o protocolo de arranque.

## Regra de localização

1. Procurar primeiro o repositório local em `C:\Projetos\reconciliacao-emis`.
2. Se não existir, não assumir outra localização: perguntar ao utilizador em que pasta local do disco `C:` pretende trabalhar.
3. A localização recomendada é sempre `C:\Projetos\reconciliacao-emis`.
4. Nunca desenvolver diretamente dentro do OneDrive. O OneDrive pode guardar ficheiros de apoio, mas o código de trabalho deve estar no clone local.
5. O GitHub é a fonte central do código. Antes de começar, confirmar remoto, ramo, estado e sincronização.

## Continuidade

- Preservar alterações existentes do utilizador.
- Não publicar nem migrar sem compilar e testar.
- Manter versão semântica no `package.json`.
- No final de cada conjunto concluído: commit, push para o GitHub, deploy quando autorizado e atualização do handover se a arquitetura ou os acessos mudarem.
- Manter uma sessão local disponível em `http://127.0.0.1:4174/` quando o utilizador estiver a acompanhar visualmente.


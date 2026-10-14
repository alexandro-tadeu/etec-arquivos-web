# ETEC Web v3 — registro da troca controlada (14/10/2026)

**Decisão: corte em produção BLOQUEADO por condições técnicas objetivas. A branch `main` continua v2.0.**

## Evidências deste ciclo
- ZIP da candidata disponível ao usuário: `ETEC_WEB_V3_CANDIDATA_PUBLICACAO_33_TESTES.zip`.
- SHA-256 do ZIP: `68fd4ca958faa91e643451b680f75181f24283207de6241fb4c3fd6cb0679168`.
- Execução local `npm test` com Node 22: **33 aprovados, 0 falhas**, mas com mocks de PostgreSQL e Edge. Não valida o equipamento escolar nem persistência Neon real.
- Commit anterior da `main` (v2 preservada): `c820a6870c15317a831211a9a28d5e2d63b8d882`.
- A branch `v3-desenvolvimento` NÃO corresponde integralmente ao ZIP: faltam nela `v3/transfer-relay.js` e `public/edge-storage.js`, entre outras mudanças. **Não fazer merge direto.**
- Neon conectado, mas `list_projects` retornou nenhum projeto; testes de migração não realizados.
- Render não conectado neste ambiente; serviço, variáveis e deploy não verificados.

## Pré-condições de liberação (cada item exige evidência)
1. Sincronizar fielmente o ZIP da candidata numa branch específica de corte, conferindo hash ou diff dos arquivos-fonte.
2. Habilitar acesso ao projeto correto do Neon; executar migrações aditivas `001_operational_audit.sql` e `002_academic_foundation.sql` em branch de teste e comprovar tabelas.
3. Acessar o serviço Render; criar cenário de teste separado da produção e configurar `DATABASE_URL`, `V3_STUDENT_CODE_HMAC_KEY`, `ETEC_V3_API_ENABLED=true` e `NODE_ENV=production`.
4. Testar em Microsoft Edge com seleção de pasta: uma entrega real e seu protocolo, isolamento entre alunos e turmas, prova de interrupção sem comprovante e revisão de logs.
5. Fazer backup do banco, registrar SHA da v2 para rollback e, somente depois do sucesso, migrar produção e atualizar o serviço.

## Rollback
Restabelecer no Render o commit da `main` v2 acima, sem apagar novas tabelas do Neon nem o diretório físico `ENTREGAS`. Sessões podem ser perdidas após troca; pedir novo login.

## Escopo
Sem MFA administrativo e sem homologação institucional formal, conforme decisão do usuário; **com testes técnicos obrigatórios** e sem armazenamento de binários no Neon/Render.

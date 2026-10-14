# ETEC Web v3 — ponto de corte para produção

**Situação: aguardando integração com Render/Neon e testes reais; NÃO trocar a main ainda.**

A candidata local `ETEC_WEB_V3_CANDIDATA_PUBLICACAO_33_TESTES.zip` foi recompilada e obteve 33/33 testes Node, sendo os testes de PostgreSQL e Edge simulados. O pacote da prévia anterior, `ETEC_WEB_V3_TRANSFERENCIA_REAL_PREVIA_TESTADA.zip`, ainda bloqueia a v3 quando `NODE_ENV=production`.

A versão candidata contém: rotas de transferência por fragmentos, verificação SHA-256 e gravação em `ENTREGAS`, identidade individual do aluno, atividades, protocolos e comprovantes. Permite ativação apenas com `ETEC_V3_API_ENABLED=true` e variáveis `DATABASE_URL` e `V3_STUDENT_CODE_HMAC_KEY` válidas. A versão 2.0 permanece inalterada.

## Etapas obrigatórias antes de trocar a main

1. Disponibilizar código da candidata no repositório e revisar diferenças com a branch atual de desenvolvimento.
2. Testar migrações `001_operational_audit.sql` e `002_academic_foundation.sql` no PostgreSQL Neon; executar antes de ativar rotas v3.
3. Configurar Render via canal privado, sem incluir segredos no GitHub, e usar inicialmente serviço de teste isolado.
4. Com Microsoft Edge real e professor presente, testar o envio de arquivo, releitura SHA-256, registro do protocolo, privacidade de outra matrícula, prazo vencido e interrupções.
5. Fazer backup e planejar rollback; só depois aprovar merge/serviço de produção.

**Risco prioritário**: códigos e senhas individuais dependem de Neon e chave HMAC estável; fragmentos em trânsito dependem de conexão ativa com a máquina do professor e não sobrevivem a reinicialização do Render. Não há autorização para apagar a v2 ou dados antigos.

MFA administrativo e homologação institucional formal foram excluídos do escopo pelo usuário. Os testes técnicos permanecem.

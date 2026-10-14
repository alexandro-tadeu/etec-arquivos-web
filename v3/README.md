# ETEC Web v3.0 — escopo simplificado

## Decisão de produto
A versão 3.0 mantém a interface simples da versão 2.0 e acrescenta turmas persistentes, matrículas individualizadas, atividades, entregas versionadas e comprovantes.

**Fora do escopo por decisão do usuário:** MFA/TOTP administrativo, bootstrap de administradores e homologação institucional formal. O administrador continua autenticando por usuário e senha na implementação legada até eventual migração específica.

**Continuam obrigatórios:** testes técnicos, autorização por professor e por aluno, proteção de credenciais, integridade das entregas, persistência Neon, controle de falhas, proteção CSRF, auditoria operacional e confirmação de escrita física via Edge.

## Arquitetura
- Edge do professor: pasta física de materiais e entregas; os arquivos permanecem no computador.
- Node/Render: somente intermediação de transferências e metadados transitórios.
- PostgreSQL/Neon: usuários e metadados persistentes, versões e protocolos; **não armazenar binários**.
- Interface professor/aluno: visual da v2, com área simples de Turmas, Alunos, Atividades e Entregas.

## Módulos e implantação
- `v3/migrations/001_security_foundation.sql`: auditoria operacional básica; **não contém MFA**.
- `v3/migrations/002_academic_foundation.sql`: salas, matrículas, atividades e entregas.
- `v3/academic-store.js`, `v3/api.js`, `v3/submission-store.js`: persistência e API acadêmicas em desenvolvimento.
- `public/atividades.html`, `public/atividades.js`: interface simplificada.
- O envio real dos bytes pelo navegador do aluno até o Edge deve ser associado à transferência autorizada; apenas uma declaração `edgeWriteVerified` não prova gravação.
- Não ativar em produção antes de verificar testes integrados de transferência e publicação com Neon/Edge. Isso é validação **técnica**, não homologação institucional.

## Cuidados
Não executar migrações no Neon de produção nesta fase; não fazer merge com `main` nem deploy automático. A proteção de sessão administrativa baseada apenas em senha permanece e deve usar senhas fortes e controle de tentativas. Os mecanismos criptográficos experimentais de TOTP, anteriormente implementados, foram retirados deste escopo.

## Testes
Executar `npm test` e testar manualmente a sequência: professor entra → cria turma → cadastra aluno → publica atividade → aluno entra com identidade individual → envia arquivos → Edge grava/relê → Neon confirma → aluno vê protocolo. Testes simulados não substituem validação com banco e navegador reais.

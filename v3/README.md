# ETEC Web v3.0 — desenvolvimento isolado

**Estado: fundação técnica inicial; não homologado; não publicado.** A `main` e o Render da versão 2.0 continuam sem alterações.

## Componentes introduzidos

- `v3/security.js`: geração de códigos aleatórios, HMAC com chave externa, política de validade/tentativas, geração/verificação TOTP, cifragem AES-256-GCM com identificação vinculada e códigos de recuperação.
- `v3/migrations/001_security_foundation.sql`: **rascunho de migração não destrutiva**, cobrindo cadastros de administradores, bootstrap, TOTP, sessões, revisões, escalonamentos, correções, trilha de auditoria e notificações.
- `tests/v3-security.test.js`: testes unitários iniciais, incluindo vetor TOTP RFC 6238.

## Importante: ainda falta implementar

1. Fluxo transacional de emissão/revogação/consumo do bootstrap com aprovações institucionais verificadas.
2. Mecanismo de provisionamento seguro e independente para o técnico; sem atalhos de autenticação.
3. Migração das sessões administrativas e bloqueio de todas as rotas legadas sem MFA.
4. Endpoints, interfaces e procedimentos de recuperação de TOTP e códigos de recuperação.
5. Cadastro persistente de salas, alunos e atividades; matrícula, versões de entrega e comprovantes.
6. Integração segura do compartilhamento local (Edge) com confirmação do armazenamento físico antes do protocolo.
7. Escalonamento programado, notificações, revisões, retificações e casos externos.
8. Testes de integração com PostgreSQL real, segurança e homologação com evidências.
9. Definição formal dos parâmetros institucionais, retenção e limites técnicos antes de produção.

## Executar os testes

Na raiz do projeto, com Node.js 20+:

```bash
node --test tests/v3-security.test.js
npm test
```

O segundo comando também executa os testes da versão 2.0; a expectativa de sucesso precisa ser **verificada** num ambiente de execução, não apenas inferida do código.

## Banco de dados

**Não executar a migração no Neon de produção.** Validar em uma instância de teste com cópia anonimizada do esquema e checklist de rollback. Mesmo após aplicar a migração, não há rotas administrativas v3 conectadas; criar tabelas não equivale a implementar a aplicação.

## Regras de segurança pendentes de validação

- Chaves criptográficas independentes (HMAC e TOTP), provisionadas por gestor de segredos. Nunca inserir segredos reais no GitHub, logs ou URLs.
- Preservar `ADMIN_USER` e `ADMIN_PASSWORD` de produção **apenas enquanto a v2 permanecer ativa**, sem utilizá-los como bypass de MFA quando a v3 for ativada.
- Não efetuar merge ou deploy até que o novo processo de autenticação esteja completo, testado e aprovado.
- A revogação e o escalonamento não reativam códigos nem concedem permissões.
- O desenho de retenção e autorizações deve respeitar a política institucional formal.

## Publicação

Preparar PR a partir da branch `v3-desenvolvimento`; revisar diffs, executar testes, completar endpoints e UI, homologar e somente depois aprovar deploy com plano de retorno.

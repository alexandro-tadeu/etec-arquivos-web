# ETEC Arquivos da Aula — versão 2.0 (vários professores)

**Leia primeiro `GUIA-DE-ATUALIZACAO.md`**. Ele explica passo a passo como atualizar seu repositório GitHub e seu serviço Render existente, e como adicionar o banco PostgreSQL necessário para manter os professores cadastrados.

## Novidades

- Administrador cadastra professores, ativa/desativa contas e redefine senhas.
- Professores entram com login individual, selecionam pastas físicas e criam salas separadas.
- Alunos entram apenas com código e senha da turma; navegam, baixam e enviam arquivos.
- Administrador: `/admin` → `/gestao`. Professores: `/admin` → `/professor`. Alunos: `/`.
- Permissões aplicadas **também no servidor**, não apenas na interface.
- Contas persistem em PostgreSQL quando a variável `DATABASE_URL` estiver configurada.

**Não use arquivos administrativos ou dados pessoais reais antes da validação institucional da hospedagem e do fluxo de dados.**

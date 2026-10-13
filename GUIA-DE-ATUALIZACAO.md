# ETEC • Arquivos da Aula — versão 2.0 multiusuário

## O que mudou

Agora existem três perfis:

- **Administrador principal**: entra com `ADMIN_USER` e `ADMIN_PASSWORD` configurados no Render; pode **cadastrar, listar, desativar, reativar e redefinir senhas** de professores. Também pode criar uma sala como professor.
- **Professor cadastrado**: entra com usuário e senha individual; pode escolher sua pasta física, gerar **sua própria sala**, compartilhar o código e a senha da turma. Não vê nem administra professores nem salas de outros docentes.
- **Aluno**: entra somente com o código e a senha da sala; pode navegar, baixar e enviar arquivos na pasta autorizada pelo professor.

O professor precisa deixar a aba da sala aberta para que o navegador tenha acesso aos arquivos locais. Ao fechar a aba ou quando a hospedagem reinicia, a sala deixa de funcionar. Cadastros de professores, por sua vez, ficam no PostgreSQL.

## 1. Fazer cópia de segurança da versão atual

Antes de atualizar, baixe o repositório `alexandro-tadeu/etec-arquivos-web` como ZIP no GitHub (**Code → Download ZIP**) para ter como voltar à versão anterior. A atualização encerra salas que estiverem ativas. Combine uma janela fora do horário de aula.

## 2. Atualizar os arquivos no GitHub

1. Descompacte `ETEC_WEB_MULTI_PROFESSORES_v2_0.zip` no seu computador pessoal.
2. Acesse https://github.com/alexandro-tadeu/etec-arquivos-web.
3. Clique em **Add file → Upload files** na raiz do repositório.
4. Envie **os arquivos extraídos**, não o ZIP. Preserve as pastas `public` e `tests` e substitua arquivos iguais. Arquivos novos essenciais: `user-store.js`, `public/gestao.html`, `public/gestao.js`.
5. Confirme o commit. Se o GitHub não aceitar atualizar pastas pelo upload, edite ou substitua cada arquivo, preservando a estrutura.
6. O Render pode começar automaticamente um novo deploy. O site ficará parcialmente sem a função de cadastro até o banco ser configurado.

**Não coloque valores de senha, `DATABASE_URL`, `.env` ou dados de professores no GitHub.**

## 3. Conectar banco de dados PostgreSQL durável

Para cadastrar professores pela interface e **mantê-los após deploy/reinício**, a versão 2.0 exige a variável `DATABASE_URL` apontando para um PostgreSQL persistente.

### Opção sugerida para testes de longa duração: Neon Postgres

1. Entre em https://console.neon.tech e crie uma conta/projeto (consulte as condições do plano antes de escolher).
2. Crie um projeto como `etec-professores` e um banco PostgreSQL.
3. No painel, clique em **Connect** e copie a **Connection string** do PostgreSQL, com usuário, senha, host, banco e TLS (`sslmode=require`).
4. No Render, abra **etec-arquivos-web → Environment → Edit**.
5. Adicione:

   | KEY | VALUE |
   | --- | --- |
   | `DATABASE_URL` | String de conexão PostgreSQL copiada do Neon (mantenha privada) |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD` | Sua senha administrativa atual (mínimo 12 caracteres) |
   | `NODE_ENV` | `production` |

6. Clique em **Save, rebuild, and deploy**. Confirme `Live` no Render.
7. Não crie manualmente tabela SQL: a versão 2.0 cria a tabela `etec_teachers` na primeira consulta ao cadastro.

**Alternativa:** PostgreSQL pago do próprio Render, conectado da mesma forma por `DATABASE_URL` (interno ao Render, quando disponível). O PostgreSQL *Free* do Render, segundo a documentação atual, **expira após 30 dias**; não o use como única base de cadastros duradouros.

**Atenção**: o Render Free perde arquivos gravados localmente após reiniciar. Por isso, não use um banco SQLite ou JSON local no Render para guardar professores. Sem `DATABASE_URL`, o administrador ainda pode abrir uma sala, mas a inclusão de professores mostra um erro orientando a configurar o banco.

## 4. Conferir o Build do Render

- Serviço existente: `etec-arquivos-web`.
- Language: **Node**; branch: `main`.
- Root Directory: vazio quando `server.js` está na raiz.
- Build Command: `npm install`.
- Start Command: `npm start`.
- Não crie outro Web Service: mantenha o mesmo endereço atual.

## 5. Acesso do administrador — cadastrar professores

1. Entre em **https://etec-arquivos-web.onrender.com/admin**.
2. Informe usuário `admin` e a senha de `ADMIN_PASSWORD` no Render.
3. O sistema direciona o administrador à tela **/gestao**.
4. Preencha nome do professor, unidade ETEC, usuário de acesso (por exemplo, `prof.maria`) e senha inicial com **pelo menos 12 caracteres**.
5. Clique **Cadastrar professor**. Confira a lista de docentes.
6. Entregue individualmente ao professor seu usuário, sua senha e o endereço do aplicativo. Não use a mesma senha para vários professores.
7. Para interromper o acesso de alguém, clique **Desativar**; para permitir novo acesso, **Reativar**. Para substituir a senha, clique **Redefinir senha** (campo oculto). Alterações de senha e de situação encerram as salas desse docente.
8. O administrador também pode clicar em **Abrir minha sala de professor** e compartilhar sua própria pasta.

O professor **não precisa** e **não deve** ter acesso ao GitHub, Render, Neon, nem à senha de administrador.

## 6. Acesso do professor — criar sala separada

1. Acesse **https://etec-arquivos-web.onrender.com/admin**.
2. Entre com as credenciais individuais recebidas do administrador.
3. O aplicativo direciona o docente para **/professor**.
4. Clique **Selecionar pasta e iniciar sala**; escolha com o mouse uma pasta específica da aula e autorize o acesso do Edge/Chrome.
5. O aplicativo gera **código de sala + senha da turma** únicos para aquele compartilhamento.
6. Utilize **Copiar convite completo** e envie apenas o convite aos alunos da turma.
7. **Mantenha esta página aberta**, com o computador ligado e conexão HTTPS ativa.
8. Ao terminar, clique **Encerrar compartilhamento** e depois **Sair da conta**.

As salas de professores diferentes têm códigos e senhas próprios. Nenhum docente pode responder a solicitações encaminhadas à sala de outro, ainda que conheça o identificador técnico da transferência.

## 7. Acesso do aluno

1. Abra **https://etec-arquivos-web.onrender.com/**.
2. Digite o **código de sala** e a **senha da turma** informados pelo seu professor.
3. Entre em pastas e subpastas, baixe os arquivos e envie uma atividade para a pasta atual.
4. O upload salva na pasta física autorizada no computador do professor; se o nome já existir, recebe nome diferente. O limite por arquivo permanece em **40 MB** nesta versão.

**Não divulgue os códigos de sala publicamente.** Todos os estudantes com código e senha podem navegar, baixar e enviar arquivos para aquela pasta. Não compartilhe relatórios, registros pessoais ou arquivos administrativos.

## 8. Como solucionar erros

| Problema | Causa provável / providência |
| --- | --- |
| `Configure DATABASE_URL` | Ainda falta criar/conectar o PostgreSQL no Render. |
| `Falha no servidor... DATABASE_URL` | URL errada, banco indisponível ou SSL obrigatório não configurado. Veja **Logs** do Render (não envie a URL nem a senha). |
| `Usuário ou senha incorretos` | Conta desativada, senha errada ou credenciais do professor não cadastradas. |
| Professor não vê **Gerenciar professores** | Correto: somente administrador principal gerencia cadastros. |
| A sala parou após a publicação | Atualização ou reinício do Render encerra salas em memória. Abra uma nova sala. |
| O aluno não encontra arquivos | Verifique se a aba do docente está aberta, pasta autorizada e sala ativa. |
| Navegador não seleciona pastas | Use Edge/Chrome recente, via endereço HTTPS, e conceda autorização de pasta ao site. |
| Serviço lento após ficar parado | O Render Free hiberna após inatividade e precisa despertar novamente. |

## 9. Limitações e segurança

- A sala é **temporária**; os arquivos permanecem no computador do professor, mas **atravessam o serviço HTTPS intermediário em trânsito** para download/upload. Não é armazenamento totalmente local.
- A API de acesso a pastas exige autorização do navegador em cada contexto relevante; não é a permissão administrativa do Windows.
- As contas de professores são guardadas no PostgreSQL, com senhas derivadas por `scrypt` e salt individual; **as senhas em texto claro não são gravadas no banco**. Apenas o administrador escolhe as senhas iniciais/reset.
- Sessões e salas temporárias são armazenadas na memória do processo; após uma atualização ou desligamento do Render, professores e alunos precisam entrar/iniciar novamente. Isso não apaga professores no PostgreSQL.
- É um protótipo educacional. Antes de uso com arquivos de alunos reais, valide com a TI/gestão da ETEC o uso de hospedagem e serviços externos, a política de privacidade e a rede disponível.
- Faça testes com pastas sem dados pessoais. Não publique credenciais do Render, Neon ou professores.

## 10. Testes do desenvolvedor

Em ambiente local Node.js 20+, para testes sem banco real, rode:

```bash
npm test
```

O teste usa arquivo JSON temporário **apenas no ambiente de testes**. No Render o cadastro de professores exige `DATABASE_URL` e utiliza PostgreSQL.

---

**Três páginas:**

- **Alunos:** https://etec-arquivos-web.onrender.com/
- **Login de professores e administrador:** https://etec-arquivos-web.onrender.com/admin
- **Gestão de professores (após login admin):** https://etec-arquivos-web.onrender.com/gestao

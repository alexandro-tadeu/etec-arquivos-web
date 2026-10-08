# ETEC — Arquivos da Aula | VERSÃO COM ADMINISTRADOR (1.1)

## O que mudou

O site foi dividido em **dois acessos**:

- **Área pública do aluno**: `https://etec-arquivos-web.onrender.com/`. Exibe somente os campos de código e senha da sala. Os alunos continuam navegando nas subpastas, baixando materiais e enviando atividades.
- **Login privado do administrador**: `https://etec-arquivos-web.onrender.com/admin`. Exige usuário e senha de administração do **aplicativo** (não do Windows). Após o login, abre `/professor`, onde você escolhe a pasta física e inicia a sala.

A página `/professor` e a API de criação de salas são **bloqueadas pelo servidor** quando a pessoa não está autenticada. Não se trata apenas de esconder botões com CSS. A senha não é escrita nos arquivos HTML/JavaScript nem no repositório: fica nas **Environment Variables do Render**.

## 1. ATUALIZAR SEU PROJETO EXISTENTE NO GITHUB

Este pacote **substitui a versão anterior**, mantendo seu Web Service atual; **não precisa criar um novo serviço no Render**.

1. Extraia este ZIP no computador pessoal.
2. Abra o repositório `alexandro-tadeu/etec-arquivos-web` no GitHub.
3. Atualize estes arquivos preservando as pastas e nomes:

   ```text
   server.js                 (substituir)
   package.json              (substituir)
   render.yaml               (substituir, caso use Blueprint)
   public/index.html         (substituir)
   public/app.js             (substituir)
   public/style.css          (substituir)
   public/admin.html         (novo)
   public/admin.js           (novo)
   public/professor.html     (novo)
   ```

4. Confirme **Commit changes** na branch `main`. Se o GitHub não aceitar sobreposição pelo menu Upload files, abra cada arquivo existente e escolha **Edit** para substituir seu conteúdo; crie os três arquivos novos em `public/`.
5. Aguarde o Deploy automático no Render. Se não iniciar, escolha **Manual Deploy > Deploy latest commit** no Web Service existente.

## 2. CONFIGURAR LOGIN ADMINISTRATIVO NO RENDER — OBRIGATÓRIO

**Faça este passo antes de tentar usar o novo aplicativo.**

1. No Render, abra o seu Web Service `etec-arquivos-web`.
2. No menu lateral, clique em **Environment**.
3. Em **Add Environment Variable**, insira:

   | Key | Value |
   | --- | --- |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD` | Uma senha longa e exclusiva, definida por você, com **pelo menos 12 caracteres** |
   | `NODE_ENV` | `production` |

4. Salve a configuração e escolha a opção que **salva e publica/reimplanta** as alterações (na interface do Render, o texto pode variar).
5. **Não inclua a senha real no GitHub, em capturas de tela ou em mensagens aos alunos.** Não use a senha da sua conta Windows, do Teams, do GitHub ou do Render.

Sem `ADMIN_PASSWORD` válido, o login retorna uma mensagem indicando que falta configuração; o serviço não permite criar uma sala desprotegida.

## 3. Acesso do administrador (professor)

1. Abra `https://etec-arquivos-web.onrender.com/admin` no Microsoft Edge do computador da ETEC.
2. Digite **Usuário: `admin`** e a senha que **você** cadastrou no Render.
3. Após entrar, a página `/professor` mostrará o botão **Selecionar pasta e iniciar sala**.
4. Selecione a pasta física do Windows (por exemplo, uma pasta específica da turma); autorize a leitura e escrita quando solicitado pelo Edge.
5. Copie o **convite completo** (endereço público, código e senha da sala) e envie aos alunos.
6. **Mantenha a página do professor aberta e o computador ligado durante a aula**.
7. Para encerrar, use **Encerrar compartilhamento**. Para sair da conta, use **Sair da administração** (isso encerra a sala ativa também).

A senha administrativa e a senha de sala são **diferentes**. **A senha administrativa nunca é compartilhada com alunos.**

## 4. Acesso dos alunos

1. Abra `https://etec-arquivos-web.onrender.com/` (sem `/admin`).
2. Digite o **código da sala e a senha da sala** que o professor forneceu.
3. Clique em **Acessar arquivos**.
4. Navegue pelas subpastas, baixe arquivos e envie atividades para a subpasta selecionada.

A área pública **não exibe o botão de seleção da pasta** e não pode criar salas; mesmo que alguém tente fazer chamadas diretas à API, será exigido o login administrativo.

## 5. Requisitos e limitações

- **Nada é instalado nos computadores da ETEC**: exige somente Microsoft Edge/Chrome atualizado e HTTPS.
- A seleção da pasta usa a File System Access API e requer autorização normal do navegador, não credenciais de administrador do Windows.
- O professor precisa manter a página aberta; ao fechar a página, a sala deixa de responder.
- Os arquivos continuam na pasta física autorizada. O serviço no Render **encaminha arquivos durante as transferências**, mas não os guarda permanentemente. Ainda assim, os arquivos **passam pela hospedagem** e o uso deve respeitar a política de TI da escola.
- Limite: 40 MB por arquivo; pastas com mais de 400 itens não são listadas por este protótipo.
- Não substitui arquivos com o mesmo nome. Bloqueia uploads com algumas extensões executáveis de risco.
- A autenticação do administrador expira após 8 horas; a sala expira após 5 horas. Reinicializações da instância gratuita do Render encerram as sessões e salas temporárias.
- Para usar a mesma senha de administrador em outro computador, basta abrir `/admin`, mas **cada pasta deve ser selecionada no computador que realmente a possui**.
- Por segurança, **não compartilhe uma unidade inteira, pastas de documentos administrativos ou informações pessoais dos alunos**.

## 6. Testes após publicar

1. Abra a página pública `/` em janela anônima: deve aparecer **somente a entrada do aluno**.
2. Ainda sem login, tente abrir `/professor`: deve **redirecionar para `/admin`**.
3. Entre por `/admin` e inicie uma sala com uma pasta **de teste**, contendo somente arquivos fictícios.
4. Em outra janela anônima, entre como aluno com o código e a senha da sala. Teste navegação, download e upload de `TESTE_ALUNO.txt`.
5. Verifique se o upload apareceu na pasta do professor. Depois clique **Sair da administração** e verifique se o código deixa de permitir acesso.

Testes automatizados do servidor:

```sh
npm test
```

O teste visual opcional em `tests/browser_e2e.py` requer Chromium e Playwright no computador de desenvolvimento; não é necessário executá-lo na ETEC. O funcionamento real do Edge com a pasta autorizada deve ser confirmado após a atualização publicada.

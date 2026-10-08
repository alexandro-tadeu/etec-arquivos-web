# ETEC — Compartilhamento Web (protótipo experimental)

## 1. O que este projeto faz

O professor abre **um endereço HTTPS no Microsoft Edge/Chrome**, escolhe uma pasta FÍSICA do Windows pelo seletor de pastas e autoriza o acesso à pasta. O sistema gera um **código de sala e uma senha**. Os alunos abrem o mesmo endereço, inserem o código e a senha e conseguem:

- Navegar nas subpastas existentes e listar arquivos.
- Baixar arquivos da pasta do professor.
- Enviar atividades para a pasta atual; arquivos repetidos ganham outro nome.

**Nada precisa ser instalado ou executado no Windows da ETEC além do próprio navegador**. O projeto **não usa servidor HTTP no computador do professor**, não abre a porta 8080 nem precisa de Cloudflare Tunnel. **Não substitui a autorização normal do navegador para ler/gravar na pasta escolhida.**

O serviço hospedado encaminha pedidos e blocos de arquivos. Ele não mantém uma cópia permanente deles, mas **os dados transitam pela hospedagem**. Utilize apenas materiais que a instituição autorize transmitir por esse serviço. O serviço web externo é necessário e precisa ser permitido pela rede escolar.

## 2. Pré-requisitos

- Navegador do professor: **Microsoft Edge atualizado** (ou Chrome), com suporte a `showDirectoryPicker`, em site **HTTPS**.
- Acesso à Internet via HTTPS ao domínio da hospedagem, tanto do professor quanto dos alunos.
- Uma hospedagem que execute **Node.js 20 ou posterior**. Para este protótipo, o exemplo abaixo utiliza a plataforma Render. A publicação é feita apenas uma vez, no seu computador pessoal, se preferir.
- Credenciais de uma conta GitHub e Render **apenas para publicar**; aluno e professor não precisam dessas contas para usar o aplicativo.

### Atenção: limitação técnica indispensável

O navegador não pode acessar uma pasta física do Windows sem a autorização explícita do usuário. Além disso, o navegador do professor **precisa continuar aberto e conectado** para responder às solicitações dos alunos. Se a ETEC proibir também a API de seleção de pastas ou a hospedagem, não há garantia de funcionamento sem aprovação da TI.

## 3. Publicar uma vez (via navegador, sem instalar Node no PC da ETEC)

### Passo A: GitHub

1. Acesse https://github.com/ pelo navegador e entre em sua conta.
2. Crie um repositório novo chamado `etec-arquivos-web`. De preferência, **privado**; se o provedor de hospedagem exigir acesso ao repositório, autorize somente o projeto.
3. No repositório, clique em **Add file > Upload files** e envie os arquivos do projeto, preservando esta estrutura:

   ```text
   etec-arquivos-web/
   ├── package.json
   ├── server.js
   ├── render.yaml
   ├── LEIA-ME-PRIMEIRO.md
   └── public/
       ├── index.html
       ├── app.js
       └── style.css
   ```

   **Atenção**: o diretório `public/` precisa permanecer como pasta no repositório. Você pode arrastar a pasta completa no navegador ou criar os arquivos nesse caminho. Os arquivos de `tests/` são opcionais para publicação.
4. Confirme o envio (**Commit changes**).

### Passo B: Render

1. Acesse https://dashboard.render.com/ e entre na sua conta.
2. Clique **New > Web Service**.
3. Conecte seu repositório `etec-arquivos-web` do GitHub.
4. Configure:

   | Campo | Valor |
   | --- | --- |
   | Language/Runtime | Node |
   | Build Command | `echo ok` |
   | Start Command | `npm start` |
   | Instance Type | Free, se disponível para sua conta |

5. Clique em **Deploy Web Service** e aguarde o status de publicação.
6. O Render fornecerá um endereço HTTPS semelhante a `https://etec-arquivos-web.onrender.com`. O endereço é apenas um exemplo: use o URL real exibido no seu painel.
7. Abra esse endereço no Edge. Guarde-o para utilizar nas ETECs.

**Importante**: a hospedagem gratuita pode suspender a instância em inatividade e possui limites. A sala é temporária, não há persistência após reinício e não existe garantia de funcionamento ininterrupto. Não trate o protótipo como solução institucional de produção.

## 4. Usar na aula: professor

1. No computador da ETEC, abra **o endereço HTTPS publicado** no Edge.
2. Clique **Sou professor** > **Selecionar pasta e iniciar sala**.
3. Escolha sua pasta física, por exemplo `E:\GERAL\etecPoa\_4BIMESTRE`. O Edge pode mostrar uma caixa de autorização para leitura/gravação na pasta; permita apenas se confiar no site e nos arquivos selecionados.
4. O site exibe **código de 8 caracteres** e **senha de 16 caracteres**.
5. Clique **Copiar convite completo** e envie esses dados à turma pelo Teams.
6. **Deixe a página aberta durante toda a aula.** Não atualize a aba, não desligue a máquina e evite a suspensão automática.
7. Para encerrar, clique **Encerrar compartilhamento**.

## 5. Usar na aula: alunos

1. Abrir o mesmo endereço HTTPS no navegador.
2. Clicar **Sou aluno** e preencher código e senha enviados pelo professor.
3. Clicar **Abrir** ao lado de uma pasta para navegar.
4. Clicar **Baixar** para fazer o download de um arquivo.
5. Para entregar uma atividade, abrir a pasta correta, selecionar um arquivo e clicar **Enviar arquivo**.
6. A entrega será gravada diretamente na pasta selecionada pelo professor, **desde que a aba do professor permaneça conectada e autorizada**.

## 6. Restrições de segurança e limites deste protótipo

- Tamanho máximo por transferência: **40 MB**. Para atividades maiores, é preciso adaptar o projeto.
- Alunos não conseguem criar novas pastas: podem enviar para **subpastas existentes**.
- Uploads com extensões executáveis de risco (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.scr`, `.vbs`, `.lnk`) são recusados.
- O serviço renomeia uploads repetidos em vez de sobrescrever arquivos existentes.
- A sala usa código + senha aleatória. **Quem receber as duas informações pode acessar a pasta compartilhada** enquanto a sala estiver ativa. Não divulgue publicamente.
- Somente a pasta autorizada é disponibilizada. Escolha uma pasta específica da aula, **não** uma unidade inteira nem uma pasta que contenha registros administrativos, dados pessoais ou informações sensíveis.
- O serviço intermediário pode acessar o conteúdo durante o transporte; por isso, use hospedagem autorizada pela instituição e **HTTPS**. Este protótipo não fornece criptografia ponta a ponta entre professor e aluno.
- Se o professor fechar a aba, perder conexão ou revogar a permissão no navegador, a sala deixa de funcionar.
- Um servidor compartilhado com múltiplas instâncias exigiria uma solução de estado distribuído. Use **uma instância** para o protótipo.
- O projeto não usa OneDrive nem requer que o OneDrive esteja instalado no computador.

## 7. Teste local (somente no seu computador pessoal, opcional)

Se você tiver Node.js 20+ no computador pessoal:

```sh
npm start
```

Abra `http://localhost:3000` no Edge. O endereço `localhost` é tratado como contexto seguro para teste da API de arquivos, mas **os alunos de outros computadores não poderão acessar esse endereço**. Para a turma, publique com HTTPS.

Executar os testes do intermediário:

```sh
npm test
```

## 8. Diagnóstico

| Situação | Interpretação provável |
| --- | --- |
| Botão "Selecionar pasta" não funciona | Site sem HTTPS, navegador incompatível ou política do Edge bloqueando a API |
| Aluno não consegue entrar | Código/senha incorretos, sala encerrada ou aba do professor sem conexão |
| Aluno consegue listar mas não consegue enviar | Permissão de gravação negada pelo Edge ou pasta sem permissão de escrita |
| A página não abre na escola | Domínio da hospedagem não autorizado pela rede da ETEC |
| Arquivo não chega à pasta | Professor desconectado, pasta sem acesso ou envio interrompido |
| Site demora para abrir | Serviço de hospedagem em modo de economia/retomada |

### O que foi verificado

Os testes automatizados do servidor intermediário cobrem criação/autenticação de sala, listagem, encaminhamento de upload/download, rejeição de caminhos inválidos, limite de tamanho e encerramento. **Não há validação real da API de pastas do Edge numa ETEC nem da hospedagem pública**. Essas verificações precisam ser feitas após a publicação.

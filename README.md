# HELPDESK API

Projeto de portfólio que simula um sistema de suporte técnico usado por empresas, com autenticação, perfis de acesso e acompanhamento de tickets. A interface em React está em.[https://github.com/PietroGo/helpdesk-frontend].

## Funcionalidades :

- Cadastro de empresa junto com o primeiro administrador
- Login com JWT e recuperação de senha por token temporário
- Dois perfis de acesso: administrador (cadastra usuários e altera o status) e usuário comum (abre tickets e comenta)
- Dados separados por empresa: cada uma acessa apenas os próprios tickets
- Tickets com prioridade, status (aberto, em andamento, resolvido, fechado) e comentários

## Rotas

| Método |         Rota          | Acesso   |            Descrição                 |
|--------|-----------------------|----------|--------------------------------------|
| POST   | /auth/register        | Pública  | Cria a empresa e o administrador     |
| POST   | /auth/login           | Pública  | Devolve o token JWT                  |
| POST   | /auth/forgot-password | Pública  | Gera o token de recuperação de senha |
| POST   | /auth/reset-password  | Pública  | Redefine a senha com o token         |
| POST   | /users                | Admin    | Cadastra um usuário na empresa       |
| GET    | /tickets              | Logado   | Lista os tickets da empresa          |
| POST   | /tickets              | Logado   | Abre um ticket                       |
| GET    | /tickets/:id          | Logado   | Detalhe do ticket com comentários    |
| PATCH  | /tickets/:id/status   | Admin    | Altera o status do ticket            |
| POST   | /tickets/:id/comments | Logado   | Adiciona um comentário               |

As rotas protegidas exigem o header `Authorization: Bearer <token>`.

## Como rodar

1. Clone o repositório e entre na pasta
2. `npm install`
3. Crie um banco PostgreSQL e copie `.env.example` para `.env`, preenchendo os valores
4. `npx prisma migrate dev`
5. `node index.js` (o servidor sobe em http://localhost:3000)

## Decisões técnicas

A empresa do usuário vem do token, não do corpo da requisição
- Por quê: se o cliente pudesse mandar o companyId, qualquer usuário poderia dizer que é de outra empresa e criar ou ler dados dela. O servidor só confia no que ele mesmo assinou.
- Custo: o token carrega essa informação, então ela só muda se o usuário fizer login de novo.
- Onde aparece: criação de ticket, listagem e cadastro de usuários.

JWT em vez de sessão guardada no servidor
- Por quê: o servidor não precisa consultar o banco a cada requisição pra saber quem é a pessoa. O token já traz usuário, perfil e empresa, e a assinatura impede falsificação.
- Custo: não dá pra invalidar um token antes de ele expirar. O logout só apaga o token no navegador, e por isso ele dura 1 hora.
- Melhoria possível: tokens de curta duração com renovação, ou uma lista de tokens revogados.

Cadastro com validação, checagem de duplicidade e transação
- Por quê: a versão antiga criava a empresa primeiro e o usuário depois. Com email repetido, sobrava uma empresa sem dono no banco. Agora o sistema valida e checa duplicidade antes de gravar, e usa transação, então empresa e usuário são criados juntos ou nenhum dos dois.
- Custo: a checagem prévia e a transação adicionam consultas ao banco.

PostgreSQL com Prisma
- Por quê PostgreSQL: os dados são relacionais (empresa tem usuários, usuário abre tickets, ticket tem comentários), e o banco garante as ligações por chave estrangeira. Os valores de status e - prioridade são enums, então o banco recusa um status inventado.
- Por quê Prisma: o schema vira a documentação do modelo, as migrations ficam versionadas e as consultas são verificadas antes de rodar.
- Custo: o Prisma esconde o SQL, então vale saber o que ele gera por baixo. Na versão 7 também exigiu configurar o driver adapter.
require('dotenv').config();
// Importa as dependências necessárias
const jwt = require('jsonwebtoken');
const express = require("express");
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

//confere se o texto tem cara de email: algo@algo.algo, sem espaços
function isValidEmail(email){
    //typeof evita erro caso o cliente mande um número ou objeto em vez de texto
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

}

//Tira tudo que não é número: "11.222.333/0001-81" vira "111222333000181"
function normalizeCnpj(cnpj){
    // \D significa "qualquer caractere que não seja dígito"
    return String(cnpj || '').replace(/\D/g, '');
}
// Regra mínima de senha: 8 caracteres ou mais
function isValidPassword(password){
    return typeof password === 'string' && password.length >=8;
}
app.get('/ping', (req, res) => {
    res.send('pong');
});

app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password, companyName, cnpj } = req.body;

        //  Validação: barra dados ruins antes de encostar no banco
        if (!name || !companyName) {
            return res.status(400).json({ error: 'Nome e nome da empresa são obrigatórios' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
        }
        const cleanCnpj = normalizeCnpj(cnpj);
        if (cleanCnpj.length !== 14) {
            return res.status(400).json({ error: 'CNPJ deve ter 14 dígitos' });
        }

        //  Duplicidade: checa os dois campos únicos ANTES de criar qualquer coisa
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'Já existe um usuário com esse email' });
        }
        const existingCompany = await prisma.company.findUnique({ where: { cnpj: cleanCnpj } });
        if (existingCompany) {
            return res.status(409).json({ error: 'Já existe uma empresa com esse CNPJ' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Transação: empresa e usuário são criados juntos ou nenhum dos dois.
        // Se a criação do usuário falhar, o Prisma desfaz a da empresa
        const user = await prisma.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: { name: companyName, cnpj: cleanCnpj }
            });
            // Dentro da transação usamos "tx" no lugar de "prisma"
            return tx.user.create({
                data: { name, email, passwordHash, role: 'ADMIN', companyId: company.id }
            });
        });

        res.status(201).json({ message: 'Usuário e empresa criados', userId: user.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Sem esses campos o Prisma daria erro ao procurar com valor undefined
        if (!email || !password) {
            return res.status(400).json({ error: 'Informe email e senha' });
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // A mesma mensagem nos dois casos (email inexistente ou senha errada)
        // para não revelar quais emails estão cadastrados
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        // bcrypt.compare confere a senha digitada contra o hash salvo
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        // O payload carrega o que as outras rotas precisam: quem é, o papel e a empresa
        const token = jwt.sign(
            { userId: user.id, role: user.role, companyId: user.companyId },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({ token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

function authenticateToken(req, res, next) { // Middleware para autenticar o token JWT
    const authHeader = req.headers.authorization; //verifica se o cabeçalho de autorização está presente na requisição

    if (!authHeader) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    const token = authHeader && authHeader.split(' ')[1]; // extrai o token do cabeçalho de autorização (espera-se que seja do tipo "Bearer <token>")

    try{ 
        const payload = jwt.verify(token, process.env.JWT_SECRET);//se o token foi adulterado ou expirou, essa linha lança um erro autromaticamente
        req.user = payload; // anexa o payload do token ao objeto de requisição para que possa ser usado em rotas subsequentes
        next(); // função para passar o controle para a próxima função de middleware ou rota
    } catch (error) {
        console.error(error);
       return res.status(403).json({ error: 'Token inválido' });
    }

    
}
function requireAdmin(req, res, next){ // Middleware para verificar se o usuário é um administrador
    if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Acesso permitido apenas para adiministradores' });
    }
    next();
}

app.post('/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        // Sem email não há o que procurar (e o Prisma daria erro com valor undefined)
        if (!email) {
            return res.status(400).json({ error: 'Informe o email' });
        }

        // A mesma resposta é devolvida nos dois casos, para ninguém descobrir quais emails existem
        const genericResponse = { message: 'Se o email existir, enviamos um link de recuperação' };

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.json(genericResponse); // antes era 404: isso entregava que o email não existe
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

        await prisma.user.update({
            where: { email },
            data: { resetToken, resetTokenExpiry }
        });

        // Em produção, aqui iria o envio de email. Por enquanto, simulamos no terminal
        console.log(`Link de redefinição de senha: http://localhost:5173/reset-password?token=${resetToken}`);

        res.json(genericResponse);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar solicitação' });
    }
});

app.post('/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!isValidPassword(newPassword)) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
        }

        const user = await prisma.user.findFirst({ 
            where: { 
                resetToken: token,
                resetTokenExpiry: { gt: new Date() } // Verifica se o token ainda é válido
             } });

        if (!user) {
            return res.status(404).json({ error: 'Token inválido ou expirado' });
        }

        if (user.resetTokenExpiry < new Date()) {
            return res.status(400).json({ error: 'Token expirado' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash,
                 resetToken: null, resetTokenExpiry: null }
        });

        res.json({ message: 'Senha redefinida com sucesso' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
});

app.get('/tickets', authenticateToken, async (req, res) => {
        // req.user já está disponível aqui, pois o middleware authenticateToken foi chamado antes desta rota
    const tickets = await prisma.ticket.findMany({
        where: {
            companyId: req.user.companyId
            
        },
        include: { comments: true } // Inclui os comentários relacionados a cada ticket
    });
    res.json(tickets);
});

app.post('/tickets', authenticateToken, async (req, res) => {
    console.log('req.user:', req.user); // Adicione este log para depuração
    try {
        const { title, description, priority } = req.body;
        const ticket = await prisma.ticket.create({
            data: {
                title,
                description,
                priority: priority || 'MEDIA', // Valor padrão caso não seja fornecido
                companyId: req.user.companyId, // Assumindo que o payload do token contém companyId
                createdById: req.user.userId // Assumindo que o payload do token contém userId
            }
        });
        res.status(201).json(ticket);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar ticket' });
    }
});

app.patch('/tickets/:id/status', authenticateToken, requireAdmin, async (req, res) => { // Rota para atualizar o status do ticket
    try {
        const { id } = req.params;
        const { status } = req.body;

        const ticket = await prisma.ticket.update({
            where: { id },
            data: { status }
        });

        res.json(ticket);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar o status do ticket' });
    }
});
// Rota para criar um novo usuário dentro da mesma empresa
app.post('/users', authenticateToken, requireAdmin, async (req, res) => { // Rota para criar um novo usuário dentro da mesma empresa
    try {

        // Pega o corpo da requisição só que o cliente pode escolher
        const { name, email, password, role } = req.body;

        // Valida se os campos obrigatórios foram fornecidos
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
        }

         if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
        }

        // Se o admin não informa role, o novo usuário vira USER
        // Só aceitamos os dois valores que existem no enum do Prisma, que são USER e ADMIN
        const newRole = role || 'USER'; // Se não for fornecido, o padrão será 'USER'
        if (newRole !== 'USER' && newRole !== 'ADMIN') {
            return res.status(400).json({ error: 'Função inválida. Deve ser USER ou ADMIN' });
        }
    

    // Procura se já existe alguém com esse email
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        return res.status(409).json({ error: 'E-mail já está em uso' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            name,
            email,
            passwordHash,
            role: newRole,
            // A empresa vem do token do admin que está logado
            companyId: req.user.companyId // Assumindo que o payload do token contém companyId
        },

        // Seleciona apenas os campos que queremos retornar
        select: { id: true, name: true, email: true, role: true , companyId: true } 
    });


    // 201 = created
    res.status(201).json(user);
}   catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
}
});


app.post('/tickets/:id/comments', authenticateToken, async (req, res) => { // Rota para adicionar comentários a um ticket criado
    try {
        const { id } = req.params;
        const { message } = req.body;

        const comment = await prisma.comment.create({
            data: {
                message,
                ticketId: id,
                userId: req.user.userId
            }
        });

        res.status(201).json(comment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao adicionar comentário' });
    }
});

app.get ('/tickets/:id/', authenticateToken, async (req, res) => {  // Rota para buscar um ticket específico pelo ID, incluindo comentários e informações do usuário que criou o ticket
    try {
        const { id } = req.params;
        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                comments: true,
                createdBy: {
                    select: { name: true,  email: true }
                }
             }
        });
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket não encontrado' });
        }
        if (ticket.companyId !== req.user.companyId) {
            return res.status(403).json({ error: 'Acesso negado a este ticket' });
        }
        res.json(ticket);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar ticket' });
    }
});
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});

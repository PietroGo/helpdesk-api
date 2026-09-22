require('dotenv').config();
// Importa as dependências necessárias
const jwt = require('jsonwebtoken');
const express = require("express");
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(express.json());

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password, companyName, cnpj } = req.body;
        const company = await prisma.company.create({
            data: { name: companyName, cnpj }
        });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash,
                role: 'ADMIN',
                companyId: company.id
            }
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
        const user = await prisma.user.findUnique({
            where: { email }
        });
        console.log('Usuário encontrado:', user);
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);

        console.log('Senha corresponde:', isMatch);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const token = jwt.sign({ userId: user.id, role: user.role, companyId: user.companyId }, process.env.JWT_SECRET, { expiresIn: '1h' });
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

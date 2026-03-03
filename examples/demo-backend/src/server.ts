import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const server = Fastify({ logger: true });
const prisma = new PrismaClient();

// Environment validation
const envSchema = z.object({
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
});

const env = envSchema.parse(process.env);

// Auth middleware
server.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/api/auth') || request.url === '/health') {
    return;
  }
  
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }
  
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    request.user = { id: decoded.userId };
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
  }
});

// Health check
server.get('/health', async () => {
  return { ok: true, timestamp: new Date().toISOString() };
});

// Auth routes
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
});

server.post('/api/auth/register', async (request, reply) => {
  const { email, password, name } = registerSchema.parse(request.body);
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
      select: { id: true, email: true, name: true },
    });
    
    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET);
    
    reply.code(201).send({ user, token });
  } catch (error: any) {
    if (error.code === 'P2002') {
      reply.code(409).send({ error: 'Email already exists' });
    } else {
      reply.code(500).send({ error: 'Registration failed' });
    }
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

server.post('/api/auth/login', async (request, reply) => {
  const { email, password } = loginSchema.parse(request.body);
  
  const user = await prisma.user.findUnique({
    where: { email },
  });
  
  if (!user || !await bcrypt.compare(password, user.password)) {
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }
  
  const token = jwt.sign({ userId: user.id }, env.JWT_SECRET);
  
  reply.send({
    user: { id: user.id, email: user.email, name: user.name },
    token,
  });
});

// Task routes
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

server.get('/api/tasks', async (request) => {
  const tasks = await prisma.task.findMany({
    where: { userId: request.user.id },
    orderBy: { createdAt: 'desc' },
  });
  
  return { tasks };
});

server.post('/api/tasks', async (request, reply) => {
  const { title, description } = createTaskSchema.parse(request.body);
  
  const task = await prisma.task.create({
    data: {
      title,
      description,
      userId: request.user.id,
    },
  });
  
  reply.code(201).send({ task });
});

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
});

server.put('/api/tasks/:id', async (request, reply) => {
  const taskId = request.params.id as string;
  const updates = updateTaskSchema.parse(request.body);
  
  try {
    const task = await prisma.task.update({
      where: { 
        id: taskId,
        userId: request.user.id,
      },
      data: updates,
    });
    
    reply.send({ task });
  } catch (error: any) {
    if (error.code === 'P2025') {
      reply.code(404).send({ error: 'Task not found' });
    } else {
      reply.code(500).send({ error: 'Update failed' });
    }
  }
});

server.delete('/api/tasks/:id', async (request, reply) => {
  const taskId = request.params.id as string;
  
  try {
    await prisma.task.delete({
      where: {
        id: taskId,
        userId: request.user.id,
      },
    });
    
    reply.code(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      reply.code(404).send({ error: 'Task not found' });
    } else {
      reply.code(500).send({ error: 'Delete failed' });
    }
  }
});

// Start server
const start = async () => {
  try {
    await server.listen({ port: parseInt(env.PORT), host: '0.0.0.0' });
    console.log(`Server running on port ${env.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

// Type augmentation
declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string };
  }
}
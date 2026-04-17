import { PrismaClient } from '@prisma/client';

// Singleton Prisma client to avoid multiple instances in development
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

export default prisma;

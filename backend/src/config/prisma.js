const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV !== 'production'
    ? [{ emit: 'event', level: 'query' }]
    : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => logger.debug(`Query: ${e.query} (${e.duration}ms)`));
}

module.exports = { prisma };

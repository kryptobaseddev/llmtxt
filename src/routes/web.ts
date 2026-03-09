// Web viewer routes
import { FastifyInstance } from 'fastify';

export async function webRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => ({
    message: 'LLMtxt Service',
    version: '1.0.0',
  }));
  
  // TODO: Implement document viewer endpoints
}

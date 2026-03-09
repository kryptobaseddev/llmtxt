// API routes for document management
import { FastifyInstance } from 'fastify';

export async function apiRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok' }));
  
  // TODO: Implement document CRUD endpoints
}

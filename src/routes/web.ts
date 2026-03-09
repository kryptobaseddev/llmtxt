// Simple web routes - just serve static files
import { FastifyInstance } from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(__dirname, '..', '..', 'public');

export async function webRoutes(fastify: FastifyInstance) {
  // No additional routes needed - static plugin handles everything
}

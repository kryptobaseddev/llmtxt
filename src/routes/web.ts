// Simple web routes - handles static files and slug redirects
import { FastifyInstance } from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(__dirname, '..', '..', 'public');

export async function webRoutes(fastify: FastifyInstance) {
  // Slug routes redirect to view.html with slug parameter
  fastify.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    
    // Skip API routes and static files
    if (slug.startsWith('api') || slug.includes('.') || slug === 'llms.txt') {
      return reply.callNotFound();
    }
    
    return reply.redirect(`/view.html?slug=${encodeURIComponent(slug)}`);
  });
}

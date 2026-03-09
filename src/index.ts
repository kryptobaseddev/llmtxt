// Main entry point
import Fastify from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRoutes } from './routes/api.js';
import { webRoutes, publicDir } from './routes/web.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = Fastify({
  logger: true,
});

async function main() {
  try {
    // Register CORS plugin
    await app.register(cors, {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Register compression plugin
    await app.register(compress);

    // Register static file serving FIRST (before API routes)
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
    });

    // Register web routes (slug redirects)
    await app.register(webRoutes);

    // Register API routes LAST so they don't catch static files
    await app.register(apiRoutes, { prefix: '/api' });
    await app.register(apiRoutes, { prefix: '/' });

    // Register error handler
    app.setErrorHandler((error: unknown, request, reply) => {
      app.log.error(error);
      
      const isDev = process.env.NODE_ENV === 'development';
      
      if (error instanceof Error && 'validation' in error && error.validation) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: isDev ? error.message : 'Invalid request data',
        });
      }

      const err = error instanceof Error ? error : new Error(String(error));
      const statusCode = (err as { statusCode?: number }).statusCode;

      return reply.status(statusCode || 500).send({
        error: err.name || 'Internal Server Error',
        message: isDev ? err.message : 'Something went wrong',
      });
    });

    // Register 404 handler
    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
      });
    });

    // Start server
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/*`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

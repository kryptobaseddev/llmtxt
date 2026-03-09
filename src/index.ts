// Main entry point
import Fastify from 'fastify';
import compress from '@fastify/compress';
import { apiRoutes } from './routes/api.js';
import { webRoutes } from './routes/web.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = Fastify({
  logger: true,
});

async function main() {
  await app.register(compress);
  
  await app.register(apiRoutes, { prefix: '/api' });
  await app.register(webRoutes);
  
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

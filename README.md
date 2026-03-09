# LLMtxt

Lightweight text document service optimized for LLM agents.

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Generate and run migrations
npm run db:generate
npm run db:migrate

# Start development server
npm run dev
```

## Project Structure

```
src/
├── db/           # Database schema and migrations
├── routes/       # API and web routes
├── utils/        # Utilities (compression, cache)
├── schemas/      # Zod validation schemas
└── index.ts      # Main entry point
```

## Scripts

- `npm run dev` - Development with hot reload
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run db:generate` - Generate migrations
- `npm run db:migrate` - Run migrations
- `npm run db:push` - Push schema changes (dev)
- `npm run db:studio` - Open Drizzle Studio

## API

- `POST /api/documents` - Create a new document
- `GET /api/documents/:id` - Get document by ID
- `GET /api/documents/:id/raw` - Get raw document content
- `GET /d/:shortId` - Redirect to document viewer
- `GET /:shortId` - View document with metadata

## License

MIT

/**
 * Admin API routes — read-only observability endpoints.
 *
 * All routes require admin authentication (requireAdmin preHandler).
 * These routes expose service health and observability tool URLs to
 * the frontend admin panel.
 *
 * Routes:
 *   GET /admin/services   — Railway service health grid
 *   GET /admin/config     — Public URLs for observability tools
 *   GET /admin/me         — Confirm admin identity (auth check)
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/admin.js';

/** Railway GraphQL endpoint */
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unknown';
  publicUrl: string | null;
  lastChecked: string;
}

/**
 * Fetch Railway service statuses via Railway's GraphQL API.
 * Requires RAILWAY_TOKEN and RAILWAY_PROJECT_ID env vars.
 * Falls back to a stub list when not configured.
 */
async function fetchRailwayServices(): Promise<ServiceHealth[]> {
  const token = process.env.RAILWAY_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;

  if (!token || !projectId) {
    // Return stub list so the panel renders without Railway config.
    return STUB_SERVICES.map((name) => ({
      name,
      status: 'unknown' as const,
      publicUrl: null,
      lastChecked: new Date().toISOString(),
    }));
  }

  const query = `
    query GetProjectServices($projectId: String!) {
      project(id: $projectId) {
        services {
          edges {
            node {
              id
              name
              deployments(first: 1) {
                edges {
                  node {
                    status
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(RAILWAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: { projectId } }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Railway API ${res.status}`);
    }

    const data = (await res.json()) as {
      data?: {
        project?: {
          services?: {
            edges?: Array<{
              node: {
                id: string;
                name: string;
                deployments?: {
                  edges?: Array<{
                    node: { status: string; url: string | null };
                  }>;
                };
              };
            }>;
          };
        };
      };
    };

    const edges = data?.data?.project?.services?.edges ?? [];
    return edges.map(({ node }) => {
      const deployment = node.deployments?.edges?.[0]?.node;
      const railwayStatus = deployment?.status ?? 'UNKNOWN';
      return {
        name: node.name,
        status: mapRailwayStatus(railwayStatus),
        publicUrl: deployment?.url ?? null,
        lastChecked: new Date().toISOString(),
      };
    });
  } catch {
    // Network/parse failure — degrade gracefully with stubs.
    return STUB_SERVICES.map((name) => ({
      name,
      status: 'unknown' as const,
      publicUrl: null,
      lastChecked: new Date().toISOString(),
    }));
  }
}

function mapRailwayStatus(railwayStatus: string): ServiceHealth['status'] {
  switch (railwayStatus.toUpperCase()) {
    case 'SUCCESS':
    case 'DEPLOYING':
      return 'healthy';
    case 'FAILED':
    case 'CRASHED':
    case 'REMOVED':
      return 'degraded';
    default:
      return 'unknown';
  }
}

/** Known Railway service names for the stub fallback. */
const STUB_SERVICES = [
  'llmtxt-api',
  'llmtxt-frontend',
  'llmtxt-docs',
  'grafana',
  'prometheus',
  'loki',
  'tempo',
  'otel-collector',
  'glitchtip',
  'postgres',
  'redis',
];

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/me
   *
   * Simple auth-check endpoint. Returns the current user identity.
   * The frontend uses this to verify admin access before rendering the panel.
   */
  app.get(
    '/admin/me',
    { preHandler: [requireAdmin] },
    async (request, _reply) => {
      return {
        id: request.user!.id,
        email: request.user!.email,
        name: request.user!.name,
        isAdmin: true,
      };
    }
  );

  /**
   * GET /admin/services
   *
   * Returns the health status of all Railway services.
   * Pulls live data from Railway's GraphQL API when RAILWAY_TOKEN is set.
   * Cached server-side for 30s to avoid hammering the Railway API.
   */
  let servicesCache: ServiceHealth[] | null = null;
  let servicesCacheExpiry = 0;

  app.get(
    '/admin/services',
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const now = Date.now();
      if (servicesCache && now < servicesCacheExpiry) {
        return reply.send({ services: servicesCache, cached: true });
      }

      const services = await fetchRailwayServices();
      servicesCache = services;
      servicesCacheExpiry = now + 30_000; // 30s TTL

      return reply.send({ services, cached: false });
    }
  );

  /**
   * GET /admin/config
   *
   * Returns public URLs for each observability tool.
   * Frontend uses these to build iframe src attributes and API query URLs.
   * All values come from environment variables — no secrets exposed.
   */
  app.get(
    '/admin/config',
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      return reply.send({
        grafana: process.env.GRAFANA_PUBLIC_URL ?? null,
        prometheus: process.env.PROMETHEUS_PUBLIC_URL ?? null,
        glitchtip: process.env.GLITCHTIP_PUBLIC_URL ?? null,
        // Loki and Tempo share Grafana's explore UI — same base URL.
        loki: process.env.GRAFANA_PUBLIC_URL ?? null,
        tempo: process.env.GRAFANA_PUBLIC_URL ?? null,
      });
    }
  );
}

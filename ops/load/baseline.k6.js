import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import encoding from 'k6/encoding';

/**
 * k6 Load Test Baseline — LLMtxt API
 *
 * Scenarios:
 * - (a) 100 concurrent GET /api/v1/documents/:slug/sections
 * - (b) 50 concurrent PUT signed writes with Ed25519
 * - (c) Mixed read/write at 5:1 ratio
 *
 * Duration: 5-min with ramp-up
 */

// Configuration
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp-up to 20 VUs
    { duration: '1m30s', target: 50 }, // Ramp to 50 VUs
    { duration: '2m', target: 100 },   // Ramp to 100 VUs (peak)
    { duration: '1m', target: 50 },    // Ramp-down to 50 VUs
    { duration: '30s', target: 0 },    // Ramp-down to 0
  ],
  thresholds: {
    // p95 latency must stay under 2000ms for reads
    'http_req_duration{scenarioName:read}': ['p(95)<2000'],
    // p95 latency must stay under 5000ms for writes
    'http_req_duration{scenarioName:write}': ['p(95)<5000'],
    // Error rate must stay below 1%
    'http_req_failed': ['rate<0.01'],
  },
  ext: {
    loadimpact: {
      projectID: 3456789,
      name: 'LLMtxt API Baseline',
    },
  },
};

// Custom metrics
const readLatency = new Trend('read_latency_ms', true);
const writeLatency = new Trend('write_latency_ms', true);
const readRate = new Rate('read_success_rate');
const writeRate = new Rate('write_success_rate');
const totalRequests = new Counter('total_requests');

const BASE_URL = __ENV.BASE_URL || 'https://api.llmtxt.my';
const TEST_SLUG_PREFIX = 't709-test-' + new Date().getTime();

/**
 * Generate a unique test slug for this run
 */
function getTestSlug(index) {
  return `${TEST_SLUG_PREFIX}-${index}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a simple Ed25519 signature for testing
 * In production, this would use proper key material
 */
function generateMockSignature(data) {
  // Mock signature — in real tests, replace with actual signing key
  return 'mock-signature-' + encoding.b64encode(data).substring(0, 32);
}

/**
 * Scenario A: 100 concurrent GET /api/v1/documents/:slug/sections
 */
export function scenarioReadOnly() {
  const slug = 'benchmark-doc-' + Math.floor(__VU / 10);

  group('Read Operations', () => {
    const res = http.get(`${BASE_URL}/api/v1/documents/${slug}/sections`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      tags: { scenarioName: 'read' },
    });

    const success = check(res, {
      'read status is 200 or 404': (r) => r.status === 200 || r.status === 404,
      'read response time < 1000ms': (r) => r.timings.duration < 1000,
      'read response has content-type': (r) => r.headers['content-type'] !== undefined,
    });

    readRate.add(success);
    readLatency.add(res.timings.duration);
    totalRequests.add(1);
  });

  sleep(Math.random() * 2);
}

/**
 * Scenario B: 50 concurrent PUT signed writes
 *
 * This creates test documents with a stable prefix so they can be cleaned up.
 * Uses mock signatures (real implementation would use Ed25519 keys).
 */
export function scenarioSignedWrite() {
  const slug = getTestSlug(__VU);
  const testContent = {
    body: `# Test Document\n\nContent from VU ${__VU} at ${new Date().toISOString()}\n\n` +
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10),
    schema: 'llmtxt/v1',
    metadata: {
      createdAt: new Date().toISOString(),
      testRun: TEST_SLUG_PREFIX,
    },
  };

  group('Write Operations', () => {
    // Prepare request
    const payload = JSON.stringify(testContent);
    const signature = generateMockSignature(payload);

    const res = http.put(
      `${BASE_URL}/api/v1/documents/${slug}`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Algorithm': 'Ed25519',
        },
        tags: { scenarioName: 'write' },
      }
    );

    const success = check(res, {
      'write status is 2xx': (r) => r.status >= 200 && r.status < 300,
      'write response time < 3000ms': (r) => r.timings.duration < 3000,
      'write response has location or id': (r) =>
        r.headers['location'] !== undefined ||
        (r.body && r.body.includes(slug)),
    });

    writeRate.add(success);
    writeLatency.add(res.timings.duration);
    totalRequests.add(1);
  });

  sleep(Math.random() * 3);
}

/**
 * Scenario C: Mixed read/write at 5:1 ratio
 */
export function scenarioMixed() {
  const readWeight = 5;
  const writeWeight = 1;
  const total = readWeight + writeWeight;
  const rand = Math.random() * total;

  if (rand < readWeight) {
    scenarioReadOnly();
  } else {
    scenarioSignedWrite();
  }
}

/**
 * Cleanup: attempt to remove test documents
 * Runs after all VUs have completed
 */
export function teardown(data) {
  console.log(`\n=== Load Test Cleanup ===`);
  console.log(`Test slug prefix: ${TEST_SLUG_PREFIX}`);
  console.log(`Cleanup would remove all documents matching: ${TEST_SLUG_PREFIX}-*`);
  console.log(`(Actual cleanup should be handled by test infrastructure)\n`);
}

/**
 * Default export: run the mixed scenario by default
 */
export default function () {
  scenarioMixed();
}

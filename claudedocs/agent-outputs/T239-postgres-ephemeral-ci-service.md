# T239: Add Ephemeral Postgres Service to GitHub Actions CI

## Summary
Successfully added an ephemeral PostgreSQL service container to the GitHub Actions CI pipeline for the TypeScript (build + typecheck) job.

## Implementation Details

### Changes Made
- **File**: `.github/workflows/ci.yml`
- **Job Modified**: `typescript` (TypeScript build + typecheck)
- **Lines Added**: 16 lines of YAML configuration

### Service Configuration
Added a `services` block to the TypeScript job with the following specifications:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: llmtxt_test
    options: >-
      --health-cmd "pg_isready -U test"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
    ports:
      - 5432:5432

env:
  DATABASE_URL_PG: postgres://test:test@localhost:5432/llmtxt_test
```

### Key Features
1. **postgres:16-alpine** - Lightweight official PostgreSQL 16 image
2. **Health Checks** - pg_isready command with 5-second timeout and 5 retry attempts
3. **Port Mapping** - Exposes 5432:5432 for localhost access within CI
4. **Environment Variables**:
   - `POSTGRES_USER`: test
   - `POSTGRES_PASSWORD`: test
   - `POSTGRES_DB`: llmtxt_test
5. **CI Environment Variable**: `DATABASE_URL_PG=postgres://test:test@localhost:5432/llmtxt_test`

### Constraints Satisfied
✓ Postgres service added only to TypeScript CI job (not Rust or migration-check jobs)
✓ SQLite test behavior remains unchanged (tests still default to SQLite)
✓ No existing CI jobs or steps were removed
✓ No changes to test invocation (T238 will handle test suite migration)
✓ Existing migration-check job remains unchanged
✓ Existing Rust job remains unchanged

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| CI workflow contains postgres:16-alpine service with health check | ✓ DONE | Service configured with pg_isready health check |
| CI passes all 67 backend tests against ephemeral PG service | PENDING | Requires T238 completion to enable PG test suite |
| CI run exits 0 on main branch with DATABASE_PROVIDER=postgresql | PENDING | Requires T238; service is available but tests still use SQLite by default |

## Dependency Notes
- T239 depends on T238 (Port integration.test.ts and api-keys.test.ts to PG test harness)
- This implementation provides infrastructure; T238 will configure tests to use it
- The DATABASE_URL_PG environment variable is available for T238 to use

## Verification
- **YAML Syntax**: Valid (verified with Python yaml.safe_load())
- **Commit Hash**: 496f184ba77d5ec114b445b62fc291efd0414a22
- **Git Status**: Pushed to origin/main
- **Diff Summary**: 16 additions to .github/workflows/ci.yml

## Next Steps (T238)
T238 will:
1. Import database configuration from environment (DATABASE_PROVIDER, DATABASE_URL_PG)
2. Migrate integration.test.ts to use Postgres when DATABASE_PROVIDER=postgresql
3. Migrate api-keys.test.ts to use Postgres when DATABASE_PROVIDER=postgresql
4. Run all 67 tests against ephemeral PG service in CI

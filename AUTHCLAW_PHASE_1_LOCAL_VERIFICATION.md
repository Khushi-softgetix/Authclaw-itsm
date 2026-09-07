# AuthClaw Phase 1 Local Verification Report

**Document Version:** 1.0.0  
**Project:** AuthClaw Existing Architecture Local Verification  
**Verification Date:** September 3, 2026  
**Phase:** Phase 1 — Run and Verify Existing AuthClaw Only  
**Status:** Incomplete / Blocked (Host Environment Prerequisites Missing — No Docker Engine Installed)

---

## 1. Environment

| Component | Required Version | Installed Version | Status | Action Required |
| --- | --- | --- | --- | --- |
| **Git** | 2.x+ | Not in PATH | **MISSING** | Install Git (`winget install --id Git.Git -e`) |
| **Node.js** | 20+ | Not Installed | **MISSING** | Install Node.js (`winget install --id OpenJS.NodeJS -e`) |
| **npm** | 10+ | Not Installed | **MISSING** | Included with Node.js |
| **Python** | 3.14.3 / 3.12+ | Not Installed | **MISSING** | Install Python (`winget install --id Python.Python.3.12 -e`) |
| **pip** | 24+ | Not Installed | **MISSING** | Included with Python |
| **Go** | 1.26.5 / 1.22+ | Not Installed | **MISSING** | Install Go (`winget install --id GoLang.Go -e`) |
| **Docker Engine** | 24+ | Not Installed | **MISSING** | Install Docker Desktop for Windows |
| **Docker Compose** | v2.20+ | Not Installed | **MISSING** | Included with Docker Desktop |

---

## 2. Services

| Service | Port | Start Command | Intended Container / Process | Status |
| --- | ---: | --- | --- | --- |
| **Frontend** | `3001` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d --build console` | `authclaw-full-console` (Next.js 16) | **BLOCKED** |
| **Backend** | `8000` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d --build backend` | `authclaw-full-backend` (FastAPI) | **BLOCKED** |
| **Database** | `5432` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d postgres` | `authclaw-full-postgres` (PostgreSQL 17) | **BLOCKED** |
| **AI Gateway** | `8080` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d gateway` | `authclaw-full-gateway` (Go Gateway) | **BLOCKED** |
| **Agent Runtime** | `8001` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d agent` | `authclaw-full-agent` (LangGraph) | **BLOCKED** |
| **Audit Infrastructure** | `9092`, `8123`, `9108` | `docker compose --env-file .env.full -f docker-compose.full.yml up -d kafka clickhouse audit_consumer` | `authclaw-full-kafka`, `authclaw-full-clickhouse`, `authclaw-full-audit-consumer` | **BLOCKED** |

---

## 3. Dependency Installation

### Canonical Containerized Method (Recommended)
The AuthClaw monorepo is fully containerized. When Docker Desktop is installed, dependencies are automatically compiled inside dedicated Linux container build stages:

```powershell
docker compose --env-file .env.full -f docker-compose.full.yml up -d --build --wait
```

### Manual Host Dependency Installation Commands (If running outside Docker)

1. **Frontend (Console)**:
   ```powershell
   Set-Location console
   npm install
   ```

2. **Backend (FastAPI Control Plane)**:
   ```powershell
   Set-Location backend
   python -m pip install -r requirements.txt
   ```

3. **AI Agent Runtime**:
   ```powershell
   Set-Location services/agent
   python -m pip install -r requirements.txt
   ```

4. **Audit Consumer**:
   ```powershell
   Set-Location audit_consumer
   python -m pip install -r requirements.txt
   ```

5. **AI Gateway**:
   ```powershell
   Set-Location gateway
   go mod download
   ```

---

## 4. Environment Setup

The local environment configuration file `.env.full` has been created from `.env.full.example`.

### Required Environment Variable Names (No Secrets Exposed)

* **Database Connection Credentials**: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `DATABASE_URL`, `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD`, `BACKEND_MIGRATOR_USER`, `BACKEND_MIGRATOR_PASSWORD`, `AGENT_MIGRATOR_USER`, `AGENT_MIGRATOR_PASSWORD`, `AGENT_RUNTIME_USER`, `AGENT_RUNTIME_PASSWORD`
* **Service Ports & URLs**: `BACKEND_PORT`, `GATEWAY_PORT`, `CONSOLE_PORT`, `AGENT_PORT`, `PRESIDIO_PORT`, `KAFKA_PORT`, `CLICKHOUSE_HTTP_PORT`, `CLICKHOUSE_NATIVE_PORT`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_SITE_URL`, `PUBLIC_GATEWAY_URL`
* **Infrastructure Services**: `REDIS_URL`, `PRESIDIO_URL`, `CLICKHOUSE_URL`, `KAFKA_BROKERS`, `OPA_URL`
* **Security & Cryptography Secrets**: `JWT_SECRET`, `AGENT_JWT_SECRET`, `SESSION_SECRET`, `API_KEY_HASH_SECRET`, `ENVELOPE_KEY`, `AGENT_ENCRYPTION_KEY`, `AGENT_REDACTION_SALT`, `REDACTION_HASH_SALT`, `AUTHCLAW_INTERNAL_SERVICE_SECRET`
* **External AI Provider Keys (REQUIRED FROM USER for Live Provider Egress Tests)**: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

---

## 5. Database Setup

* **Database Engine**: PostgreSQL 17 (`postgres:17` image).
* **Migration Mechanism**: Executed automatically during stack startup via `database-bootstrap` → `backend-migrations` (`alembic upgrade head`) → `agent-migrations` (`python -m database.migrations`) → `database-grants` → `database-security-check` ([`docker-compose.full.yml`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/docker-compose.full.yml#L128-L201)).
* **Required Extensions**: `uuid-ossp`, `pgcrypto`.
* **Row Level Security (RLS)**: Enforced natively on all tenant tables using PostgreSQL policy rules filtering by `app.current_tenant_id` context ([`backend/alembic/versions/002_add_rls_policies.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions/002_add_rls_policies.py)).
* **Seed Mechanism**: Admin user and demo tenant are seeded via `python scripts/seed_authclaw_lite.py` ([`docker-compose.full.yml`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/docker-compose.full.yml#L202-L216)).

---

## 6. Authentication Test

**Status:** **BLOCKED**

**Explanation:**  
The authentication flow (`/v1/auth/login`, session token generation `acl_session_...`, cookie setting, and database session context binding via `authn.bind_session_context`) requires running FastAPI backend and PostgreSQL containers. Because Docker Desktop is not installed on the host system, live HTTP authentication requests could not be executed. Source code verification in Phase 0 confirmed the complete implementation in [`backend/app/core/auth.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py).

---

## 7. RBAC / Permissions Test

**Status:** **BLOCKED**

**Explanation:**  
Route permission enforcement (`require_roles(["admin", "owner"])`, `require_scopes(["read", "write"])`, `require_platform_admin()`) requires an active FastAPI process. Implementation verified in [`backend/app/core/auth.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L233-L280).

---

## 8. Multi-Tenancy Test

**Status:** **BLOCKED**

**Explanation:**  
Multi-tenancy isolation tests rely on running PostgreSQL 17 with `app.current_tenant_id` session settings and active RLS policies. Implementation verified in [`backend/alembic/versions/002_add_rls_policies.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions/002_add_rls_policies.py).

---

## 9. AI Gateway Test

**Status:** **BLOCKED**

**Explanation:**  
The Go AI Gateway (`http://localhost:8080/v1/...`) requires running Go gateway, Redis, Microsoft Presidio, Open Policy Agent (OPA), and PostgreSQL containers, as well as valid provider API keys (`GEMINI_API_KEY` / `OPENAI_API_KEY`). Infrastructure code verified in [`gateway/proxy.go`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/gateway/proxy.go).

---

## 10. Agent Runtime + HITL Test

**Status:** **BLOCKED**

**Explanation:**  
The LangGraph agent runtime (`http://localhost:8001`) and Human-in-the-Loop approval engine require running Python agent and PostgreSQL containers. Code verified in [`services/agent/graph.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent/graph.py) and [`services/agent/approval_store.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent/approval_store.py).

---

## 11. Audit Test

**Status:** **BLOCKED**

**Explanation:**  
The audit ingestion pipeline requires running Redpanda/Kafka (`kafka:29092`) and ClickHouse (`clickhouse:8123`) containers. Cryptographic SHA-256 hash-chaining consumer logic verified in [`audit_consumer/consumer.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/audit_consumer/consumer.py).

---

## 12. Problems Found

### Problem 1: Missing Local `.env.full` Configuration File
* **Symptom**: Docker Compose execution fails if `.env.full` does not exist when passed via `--env-file .env.full`.
* **Root Cause**: Repository checked in template file `.env.full.example` but requires local copy.
* **Fix Applied**: Executed `Copy-Item .env.full.example .env.full`.
* **File Changed**: Created `.env.full` ([`.env.full`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/.env.full)).
* **Verification Result**: Verified `.env.full` file exists in the repository root.

### Problem 2: Missing Host Container Engine (Docker Desktop)
* **Symptom**: Commands `docker` and `docker compose` returned `CommandNotFoundException`.
* **Root Cause**: The host Windows machine does not have Docker Desktop installed.
* **Fix / Recommendation**: Documented explicit installation steps for Docker Desktop for Windows.
* **Verification Result**: Diagnostic diagnostic completed; user instructions provided.

---

## 13. Final Verification Matrix

| Capability | Status | Supporting Code / Architectural Evidence |
| --- | --- | --- |
| **Frontend** | **BLOCKED** | Next.js 16 operator console in [`console/src/app`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app). |
| **Backend** | **BLOCKED** | FastAPI control plane in [`backend/main.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/main.py). |
| **Database** | **BLOCKED** | PostgreSQL 17 schema & 42 Alembic migrations in [`backend/alembic/versions`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions). |
| **Authentication** | **BLOCKED** | Session & API key authn with DB context binding in [`backend/app/core/auth.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py). |
| **RBAC** | **BLOCKED** | Tenant role checks (`require_roles`) and platform admin checks in [`backend/app/core/auth.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L248). |
| **Multi-Tenancy** | **BLOCKED** | Native PostgreSQL Row Level Security (RLS) in [`backend/alembic/versions/002_add_rls_policies.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions/002_add_rls_policies.py). |
| **AI Gateway** | **BLOCKED** | Go Chi reverse proxy with Presidio PII redaction and OPA policies in [`gateway/proxy.go`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/gateway/proxy.go). |
| **Agent Runtime** | **BLOCKED** | LangGraph agent execution graph in [`services/agent/graph.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent/graph.py). |
| **HITL Approvals** | **BLOCKED** | Pending approval store & MFA verification in [`services/agent/approval_store.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent/approval_store.py). |
| **Audit System** | **BLOCKED** | Kafka to ClickHouse tamper-evident hash-chained consumer in [`audit_consumer/consumer.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/audit_consumer/consumer.py). |

---

## 14. FINAL COMMANDS FOR USER

Follow these exact steps to run and verify AuthClaw locally once Docker Desktop is installed.

### Step 1: Install Docker Desktop (If not already installed)
1. Download and install **Docker Desktop for Windows** from [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/).
2. Enable WSL2 backend during installation and restart your computer.
3. Start Docker Desktop and ensure the container engine status shows **Running**.

---

### Step 2: Start the Canonical AuthClaw Full Stack

```text
Terminal 1
Directory: C:\Users\ADMIN\Downloads\AuthClaw_Align-master\AuthClaw_Align-master
Purpose: Start all 10 microservices & containers in background mode
```

```powershell
docker compose --env-file .env.full -f docker-compose.full.yml up -d --build --wait
```

---

### Step 3: Verify Running Services (Smoke Test)

```text
Terminal 1
Directory: C:\Users\ADMIN\Downloads\AuthClaw_Align-master\AuthClaw_Align-master
Purpose: Execute automated end-to-end smoke test suite
```

```powershell
python scripts/smoke_test.py
```

---

### Step 4: Open Interfaces in Browser

* **AuthClaw Operator Console**: [http://localhost:3001](http://localhost:3001)
  * **Login Credentials (Seeded Demo Admin)**:
    * **Email**: `admin@authclaw.demo` (or perform new signup)
    * **Password**: `AuthClawDemo!234`
* **FastAPI Backend OpenAPI Specs**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Go AI Gateway Health Endpoint**: [http://localhost:8080/health](http://localhost:8080/health)

---

### Step 5: Stop Services

```text
Terminal 1
Directory: C:\Users\ADMIN\Downloads\AuthClaw_Align-master\AuthClaw_Align-master
Purpose: Gracefully stop all containers without wiping database volumes
```

```powershell
docker compose --env-file .env.full -f docker-compose.full.yml down
```

*(Note: Add `-v` only if you intentionally want to delete local database records).*

---

### Step 6: Troubleshooting Logs

If any container fails to start, check its logs using:

```powershell
# View backend logs
docker logs authclaw-full-backend

# View gateway logs
docker logs authclaw-full-gateway

# View database migration logs
docker logs authclaw-full-backend-migrations
```

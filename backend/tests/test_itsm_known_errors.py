"""Backend test suite for PRB-004 Phase 1: Known Error Search & Incident-Problem Linking.

Covers:
1. SERVICE_AGENT can search Known Errors via GET /v1/itsm/problems/known-errors (200 OK)
2. Search filters: keyword (title, description, workaround, root-cause) and service_id
3. Pagination: offset and limit
4. Fail-closed safeguards: excludes known_error=False, empty/whitespace workaround,
   and inactive/unassessed lifecycle statuses (NEW, CLOSED)
5. Tenant isolation: cross-tenant KEDB records never leak (empty results across boundaries)
6. Authorization: Requester and users without ITSM access receive 403 Forbidden
7. Strict role boundaries: Service Agent receives 403 Forbidden on PATCH /v1/itsm/problems/{id}/investigation
8. Link Incident to existing Problem via POST /v1/itsm/incidents/{id}/link-problem (200 OK)
9. Link idempotency: repeating link returns already_linked=True without duplicate activity
10. Unlink Incident via POST /v1/itsm/incidents/{id}/unlink-problem (200 OK)
11. Unlink idempotency: unlinking non-linked incident succeeds safely
12. Validation & security: 404 for invalid IDs, cross-tenant link denied, invalid ticket type denied
13. Authorization: Requester receives 403 Forbidden on link/unlink endpoints
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMKnownErrorsTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Primary Tenant (Tenant A)
        cls.tenant_id = uuid4()
        cls.agent_user_id = uuid4()
        cls.agent_key = f"agent-ke-{uuid4().hex[:12]}"

        cls.pcm_user_id = uuid4()
        cls.pcm_key = f"pcm-ke-{uuid4().hex[:12]}"

        cls.im_user_id = uuid4()
        cls.im_key = f"im-ke-{uuid4().hex[:12]}"

        cls.req_user_id = uuid4()
        cls.req_key = f"req-ke-{uuid4().hex[:12]}"

        cls.no_itsm_user_id = uuid4()
        cls.no_itsm_key = f"no-itsm-{uuid4().hex[:12]}"

        # Secondary Tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.agent_b_user_id = uuid4()
        cls.agent_b_key = f"tb-agent-{uuid4().hex[:12]}"

        # Services
        cls.service_vpn_id = uuid4()
        cls.service_db_id = uuid4()
        cls.service_b_id = uuid4()

        # Problem IDs in Tenant A
        cls.prb_active_1_id = uuid4()
        cls.prb_active_2_id = uuid4()
        cls.prb_no_ke_id = uuid4()
        cls.prb_empty_wa_id = uuid4()
        cls.prb_closed_id = uuid4()
        cls.prb_new_id = uuid4()
        cls.prb_draft_wa_id = uuid4()
        cls.prb_expired_wa_id = uuid4()
        cls.prb_overdue_review_id = uuid4()
        cls.prb_symptoms_id = uuid4()

        # Problem ID in Tenant B
        cls.prb_b_id = uuid4()

        # Incidents in Tenant A
        cls.inc_1_id = uuid4()
        cls.inc_2_id = uuid4()

        # Incident in Tenant B
        cls.inc_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-ke-a-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-ke-b-{uuid4().hex[:8]}"},
            )

            # 2. Users in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # PCM
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.pcm_user_id, "tenant_id": cls.tenant_id, "email": f"pcm-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.pcm_key), "created_by": cls.pcm_user_id},
            )

            # IM
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.im_user_id, "tenant_id": cls.tenant_id, "email": f"im-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'INCIDENT_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.im_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'im-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.im_key), "created_by": cls.im_user_id},
            )

            # Requester
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.req_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.req_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.req_key), "created_by": cls.req_user_id},
            )

            # User without ITSM access
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.no_itsm_user_id, "tenant_id": cls.tenant_id, "email": f"noitsm-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', false, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.no_itsm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # User in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_b_user_id, "tenant_id": cls.tenant_b_id, "email": f"agentb-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.agent_b_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.agent_b_key), "created_by": cls.agent_b_user_id},
            )

            # 3. Services in Tenant A and B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Corporate WireGuard VPN', 'corp-vpn', 'TIER_1', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_vpn_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Redis Session Cluster', 'redis-session', 'TIER_2', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_db_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Service', 'tb-srv', 'TIER_1', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_b_id, "tenant_id": cls.tenant_b_id},
            )

            # 4. Problems in Tenant A
            # PRB 1: Active Known Error in IN_PROGRESS state (APPROVED)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100001', 'PROBLEM', 'WireGuard tunnel MTU fragmentation degradation', 'Packets > 1420 bytes get dropped intermittently on gateway', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_active_1_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, permanent_solution, workaround_status, workaround_approved_at, workaround_approved_by_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Kernel UDP socket fragmentation bottleneck', 'Set client MTU to 1380 bytes in interface configuration', 'Upgrade WireGuard kernel driver to v1.0.4', 'APPROVED', now(), :approver_id, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_active_1_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 2: Active Known Error in RESOLVED state (APPROVED)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100002', 'PROBLEM', 'Redis eviction failure under spike load', 'OOM exceptions when concurrent logins exceed 1000/s', 'MEDIUM', 'HIGH', 'P2', 'RESOLVED', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_active_2_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_db_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, permanent_solution, workaround_status, workaround_approved_at, workaround_approved_by_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Volatile-LRU policy evicts valid auth tokens early', 'Switch Redis maxmemory-policy to allkeys-lru temporarily', 'Scale Redis master instance to 16GB memory', 'APPROVED', now(), :approver_id, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_active_2_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 3: Problem with known_error=False (must NOT be returned)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100003', 'PROBLEM', 'Draft investigation without confirmed root cause', 'Under investigation', 'LOW', 'LOW', 'P4', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_no_ke_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_db_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, 'Hypothesis unproven', 'Unapproved draft workaround', 'DRAFT', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_no_ke_id},
            )

            # PRB 4: Problem with empty workaround (must NOT be returned)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100004', 'PROBLEM', 'Known error but missing workaround', 'No temporary mitigation yet', 'MEDIUM', 'MEDIUM', 'P3', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_empty_wa_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Known hardware failure', '   ', 'DRAFT', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_empty_wa_id},
            )

            # PRB 5: Closed problem (concluded lifecycle, must NOT be returned)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100005', 'PROBLEM', 'Closed legacy problem', 'Defect was permanently patched', 'LOW', 'LOW', 'P4', 'CLOSED', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_closed_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, workaround_approved_at, workaround_approved_by_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Old defect', 'Old superseded workaround', 'APPROVED', now(), :approver_id, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_closed_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 6: NEW problem (unassessed, must NOT be returned)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100006', 'PROBLEM', 'Unassessed problem in NEW state', 'Intake state only', 'LOW', 'LOW', 'P4', 'NEW', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_new_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_db_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, workaround_approved_at, workaround_approved_by_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Premature root cause', 'Premature workaround', 'APPROVED', now(), :approver_id, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_new_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 7: Draft workaround in IN_PROGRESS state (must NOT be returned by search)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100007', 'PROBLEM', 'Draft workaround under review', 'Candidate mitigation not yet signed off', 'MEDIUM', 'MEDIUM', 'P3', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_draft_wa_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Draft root cause', 'Candidate script reboot-services.sh', 'DRAFT', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_draft_wa_id},
            )

            # PRB 8: Expired workaround (must NOT be returned by search)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100008', 'PROBLEM', 'Expired temporary workaround', 'Workaround expired yesterday', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_expired_wa_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, workaround_approved_at, workaround_approved_by_id, workaround_expires_at, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Expired root cause', 'Temporary workaround that expired', 'APPROVED', now(), :approver_id, now() - interval '2 days', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_expired_wa_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 9: Overdue review workaround (must NOT be returned by search)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100009', 'PROBLEM', 'Overdue review workaround', 'Quarterly review was due last week', 'MEDIUM', 'MEDIUM', 'P2', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_overdue_review_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_db_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, workaround_approved_at, workaround_approved_by_id, review_due_at, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Stale root cause', 'Stale workaround needing review', 'APPROVED', now(), :approver_id, now() - interval '3 hours', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_overdue_review_id, "approver_id": cls.pcm_user_id},
            )

            # PRB 10: Workaround with symptoms populated (DRAFT initially)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-100010', 'PROBLEM', 'DNS caching resolver timeouts', 'Intermittent name resolution failures', 'MEDIUM', 'HIGH', 'P2', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_symptoms_id, "tenant_id": cls.tenant_id, "srv_id": cls.service_vpn_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, symptoms, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Upstream DNS recursor UDP buffer overflow', 'Flush local nscd cache and switch to fallback resolver', 'Lookup latency exceeds 2000ms with SERVFAIL errors in syslog', 'DRAFT', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.prb_symptoms_id},
            )

            # Problem in Tenant B (APPROVED)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-200001', 'PROBLEM', 'Tenant B Confidential Problem', 'Tenant B issues', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.prb_b_id, "tenant_id": cls.tenant_b_id, "srv_id": cls.service_b_id, "req_id": cls.agent_b_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, workaround_status, workaround_approved_at, workaround_approved_by_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Tenant B Root Cause', 'Tenant B Secret Workaround', 'APPROVED', now(), :approver_id, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "ticket_id": cls.prb_b_id, "approver_id": cls.agent_b_user_id},
            )

            # 5. Incidents in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, assignee_id, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-100010', 'INCIDENT', 'VPN drops during video calls', 'Intermittent disconnects on tunnel', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :assignee_id, :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.inc_1_id, "tenant_id": cls.tenant_id, "assignee_id": cls.agent_user_id, "srv_id": cls.service_vpn_id, "req_id": cls.req_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, assignee_id, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-100011', 'INCIDENT', 'Redis auth timeout on dashboard', 'Dashboard loading slowly', 'MEDIUM', 'HIGH', 'P2', 'NEW', :assignee_id, :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.inc_2_id, "tenant_id": cls.tenant_id, "assignee_id": cls.agent_user_id, "srv_id": cls.service_db_id, "req_id": cls.req_user_id},
            )

            # Incident in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, assignee_id, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-200010', 'INCIDENT', 'Tenant B Incident', 'Issue in Tenant B', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :assignee_id, :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.inc_b_id, "tenant_id": cls.tenant_b_id, "assignee_id": cls.agent_b_user_id, "srv_id": cls.service_b_id, "req_id": cls.agent_b_user_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.migrator_engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_ticket_activities WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_problem_details WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_tickets WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            try:
                sp = conn.begin_nested()
                conn.execute(text("DELETE FROM public.tenants WHERE id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                sp.commit()
            except Exception:
                sp.rollback()

    # =========================================================================
    # PART 1: KNOWN ERROR SEARCH TESTS
    # =========================================================================

    def test_01_service_agent_can_search_known_errors(self):
        """Service Agent can search KEDB and retrieve active known errors with safe fields."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertIsInstance(items, list)
        # Should return PRB-100001 and PRB-100002
        self.assertEqual(len(items), 2)
        prb_numbers = [item["ticket_number"] for item in items]
        self.assertIn("PRB-100001", prb_numbers)
        self.assertIn("PRB-100002", prb_numbers)

        item = next(i for i in items if i["ticket_number"] == "PRB-100001")
        self.assertEqual(item["service_name"], "Corporate WireGuard VPN")
        self.assertEqual(item["workaround_summary"], "Set client MTU to 1380 bytes in interface configuration")
        self.assertEqual(item["root_cause_summary"], "Kernel UDP socket fragmentation bottleneck")
        self.assertEqual(item["permanent_solution"], "Upgrade WireGuard kernel driver to v1.0.4")
        self.assertEqual(item["status"], "IN_PROGRESS")

    def test_02_search_keyword_filter(self):
        """Keyword search matches title, description, workaround, or root-cause."""
        # Search by workaround keyword
        res = self.client.get(
            "/v1/itsm/problems/known-errors?search=MTU",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ticket_number"], "PRB-100001")

        # Search by root-cause keyword
        res2 = self.client.get(
            "/v1/itsm/problems/known-errors?search=LRU",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res2.status_code, 200)
        items2 = res2.json()
        self.assertEqual(len(items2), 1)
        self.assertEqual(items2[0]["ticket_number"], "PRB-100002")

    def test_03_search_service_filter(self):
        """Filter known errors by service_id."""
        res = self.client.get(
            f"/v1/itsm/problems/known-errors?service_id={self.service_vpn_id}",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ticket_number"], "PRB-100001")

    def test_04_search_pagination(self):
        """Pagination limit and offset works correctly."""
        res_limit1 = self.client.get(
            "/v1/itsm/problems/known-errors?limit=1&offset=0",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_limit1.status_code, 200)
        self.assertEqual(len(res_limit1.json()), 1)

        res_offset1 = self.client.get(
            "/v1/itsm/problems/known-errors?limit=1&offset=1",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_offset1.status_code, 200)
        self.assertEqual(len(res_offset1.json()), 1)
        self.assertNotEqual(res_limit1.json()[0]["id"], res_offset1.json()[0]["id"])

    def test_05_search_excludes_known_error_false(self):
        """Problem with known_error=False is never returned as Known Error."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100003",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 0)

    def test_06_search_excludes_empty_or_whitespace_workaround(self):
        """Problem with empty or whitespace workaround is excluded (fail-closed)."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100004",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 0)

    def test_07_search_excludes_closed_and_new_tickets(self):
        """Fail-closed: CLOSED (superseded/concluded) and NEW (unassessed) tickets are excluded."""
        res_closed = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100005",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_closed.status_code, 200)
        self.assertEqual(len(res_closed.json()), 0)

        res_new = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100006",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_new.status_code, 200)
        self.assertEqual(len(res_new.json()), 0)

    def test_08_search_tenant_isolation(self):
        """Tenant isolation: Tenant A agent cannot see Tenant B known errors."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        prb_numbers = [item["ticket_number"] for item in res.json()]
        self.assertNotIn("PRB-200001", prb_numbers)

        # Tenant B agent only sees Tenant B
        res_b = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.agent_b_key}"},
        )
        self.assertEqual(res_b.status_code, 200)
        items_b = res_b.json()
        self.assertEqual(len(items_b), 1)
        self.assertEqual(items_b[0]["ticket_number"], "PRB-200001")

    def test_09_search_forbidden_for_requester_and_no_itsm(self):
        """Requester and users with disabled ITSM access cannot search known errors."""
        res_req = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.req_key}"},
        )
        self.assertEqual(res_req.status_code, 403)

        res_no = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.no_itsm_key}"},
        )
        self.assertEqual(res_no.status_code, 403)

    def test_10_service_agent_cannot_access_pcm_investigation_endpoint(self):
        """Security boundary preserved: Service Agent cannot modify problem investigation."""
        res = self.client.patch(
            f"/v1/itsm/problems/{self.prb_active_1_id}/investigation",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"workaround_summary": "Attempted unauthorized edit"},
        )
        self.assertEqual(res.status_code, 403)

    # =========================================================================
    # PART 2: INCIDENT-TO-PROBLEM LINKING TESTS
    # =========================================================================

    def test_11_link_incident_to_problem_success(self):
        """Service Agent can link an assigned Incident to an existing Problem ticket."""
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(self.prb_active_1_id)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["incident_id"], str(self.inc_1_id))
        self.assertEqual(data["linked_problem_id"], str(self.prb_active_1_id))
        self.assertEqual(data["linked_problem_ticket_number"], "PRB-100001")
        self.assertFalse(data["already_linked"])

        # Verify incident ticket updated in database
        with self.migrator_engine.begin() as conn:
            row = conn.execute(
                text("SELECT linked_problem_id FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.inc_1_id},
            ).first()
            self.assertEqual(row.linked_problem_id, self.prb_active_1_id)

            # Verify activities created on both incident and problem
            inc_act = conn.execute(
                text("SELECT * FROM public.itsm_ticket_activities WHERE ticket_id = :id AND metadata->>'action' = 'link_problem'"),
                {"id": self.inc_1_id},
            ).first()
            self.assertIsNotNone(inc_act)
            self.assertIn("PRB-100001", inc_act.content)

            prb_act = conn.execute(
                text("SELECT * FROM public.itsm_ticket_activities WHERE ticket_id = :id AND metadata->>'action' = 'incident_linked'"),
                {"id": self.prb_active_1_id},
            ).first()
            self.assertIsNotNone(prb_act)
            self.assertIn("INC-100010", prb_act.content)

    def test_12_link_incident_idempotency(self):
        """Linking an incident to the same problem returns already_linked=True idempotently."""
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(self.prb_active_1_id)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["already_linked"])
        self.assertIn("already linked", data["message"])

    def test_13_unlink_incident_from_problem_success(self):
        """Service Agent can unlink an Incident from its linked Problem ticket."""
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/unlink-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsNone(data["linked_problem_id"])
        self.assertFalse(data["already_linked"])
        self.assertIn("unlinked", data["message"])

        with self.migrator_engine.begin() as conn:
            row = conn.execute(
                text("SELECT linked_problem_id FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.inc_1_id},
            ).first()
            self.assertIsNone(row.linked_problem_id)

    def test_14_unlink_incident_idempotency(self):
        """Unlinking an incident that is not linked succeeds idempotently."""
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/unlink-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsNone(data["linked_problem_id"])
        self.assertIn("not linked to any problem", data["message"])

    def test_15_link_problem_invalid_ids(self):
        """Non-existent incident or problem returns 404 Not Found."""
        random_id = uuid4()
        res1 = self.client.post(
            f"/v1/itsm/incidents/{random_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(self.prb_active_1_id)},
        )
        self.assertEqual(res1.status_code, 404)

        res2 = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(random_id)},
        )
        self.assertEqual(res2.status_code, 404)

    def test_16_link_problem_cross_tenant_denied(self):
        """Linking a problem from another tenant returns 404 (tenant boundary enforced)."""
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(self.prb_b_id)},
        )
        self.assertEqual(res.status_code, 404)

    def test_17_link_problem_invalid_ticket_type(self):
        """Attempting to link an incident to another ticket that is NOT a problem returns 404."""
        # inc_2 is an INCIDENT, not a PROBLEM
        res = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"problem_id": str(self.inc_2_id)},
        )
        self.assertEqual(res.status_code, 404)

    def test_18_link_problem_unauthorized_role_denied(self):
        """Requester and unauthenticated users receive 403/401 on link/unlink."""
        res_link_req = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={"problem_id": str(self.prb_active_1_id)},
        )
        self.assertEqual(res_link_req.status_code, 403)

        res_unlink_req = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/unlink-problem",
            headers={"Authorization": f"Bearer {self.req_key}"},
        )
        self.assertEqual(res_unlink_req.status_code, 403)

        res_anon = self.client.post(
            f"/v1/itsm/incidents/{self.inc_1_id}/link-problem",
            json={"problem_id": str(self.prb_active_1_id)},
        )
        self.assertEqual(res_anon.status_code, 401)

    # =========================================================================
    # PART 3: PHASE 1A KNOWN ERROR GOVERNANCE TESTS
    # =========================================================================

    def test_19_publish_workaround_success(self):
        """Problem Manager can publish a draft workaround with review/expiry dates."""
        expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        review = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

        res = self.client.post(
            f"/v1/itsm/problems/{self.prb_draft_wa_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={
                "workaround_expires_at": expires,
                "review_due_at": review,
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["workaround_status"], "APPROVED")
        self.assertEqual(data["workaround_approved_by_id"], str(self.pcm_user_id))
        self.assertIsNotNone(data["workaround_approved_at"])
        self.assertIsNotNone(data["workaround_expires_at"])
        self.assertIsNotNone(data["review_due_at"])

        # Verify activity event recorded in database
        with self.migrator_engine.connect() as conn:
            activity = conn.execute(
                text(
                    "SELECT activity_type, metadata FROM public.itsm_ticket_activities "
                    "WHERE ticket_id = :ticket_id AND activity_type = 'WORKAROUND_PUBLISHED' "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"ticket_id": self.prb_draft_wa_id},
            ).mappings().first()
            self.assertIsNotNone(activity)
            self.assertEqual(activity["activity_type"], "WORKAROUND_PUBLISHED")
            self.assertEqual(activity["metadata"]["workaround_status"], "APPROVED")

            # Verify audit log recorded
            audit = conn.execute(
                text(
                    "SELECT action, actor_id FROM public.audit_log_metadata "
                    "WHERE tenant_id = :tenant_id AND action = 'itsm.problem.workaround_published' "
                    "ORDER BY tenant_sequence DESC LIMIT 1"
                ),
                {"tenant_id": self.tenant_id},
            ).mappings().first()
            self.assertIsNotNone(audit)
            self.assertEqual(audit["action"], "itsm.problem.workaround_published")

    def test_20_publish_workaround_missing_content_fails(self):
        """Publishing a workaround without workaround content fails with 400 Bad Request."""
        res = self.client.post(
            f"/v1/itsm/problems/{self.prb_empty_wa_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("workaround_summary is required", res.json()["detail"].lower())

    def test_21_publish_workaround_unauthorized_role_denied(self):
        """Service Agent, Requester, and anonymous users cannot publish workarounds."""
        # Service Agent -> 403
        res_agent = self.client.post(
            f"/v1/itsm/problems/{self.prb_draft_wa_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={},
        )
        self.assertEqual(res_agent.status_code, 403)

        # Requester -> 403
        res_req = self.client.post(
            f"/v1/itsm/problems/{self.prb_draft_wa_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={},
        )
        self.assertEqual(res_req.status_code, 403)

        # Anonymous -> 401
        res_anon = self.client.post(
            f"/v1/itsm/problems/{self.prb_draft_wa_id}/publish-workaround",
            json={},
        )
        self.assertEqual(res_anon.status_code, 401)

    def test_22_publish_workaround_tenant_isolation(self):
        """Problem Manager cannot publish workarounds for problems belonging to another tenant."""
        res = self.client.post(
            f"/v1/itsm/problems/{self.prb_b_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={},
        )
        self.assertEqual(res.status_code, 404)

    def test_23_retire_workaround_success_preserves_problem_status(self):
        """Problem Manager can retire a workaround, which must NOT close the problem."""
        res = self.client.post(
            f"/v1/itsm/problems/{self.prb_active_1_id}/retire-workaround",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"reason": "Superseded by permanent patch"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["workaround_status"], "RETIRED")

        # Verify problem ticket status is STILL IN_PROGRESS (NOT closed)
        with self.migrator_engine.connect() as conn:
            ticket = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.prb_active_1_id},
            ).mappings().first()
            self.assertEqual(ticket["status"], "IN_PROGRESS")

            # Verify activity event recorded
            activity = conn.execute(
                text(
                    "SELECT activity_type, metadata FROM public.itsm_ticket_activities "
                    "WHERE ticket_id = :ticket_id AND activity_type = 'WORKAROUND_RETIRED' "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"ticket_id": self.prb_active_1_id},
            ).mappings().first()
            self.assertIsNotNone(activity)
            self.assertEqual(activity["activity_type"], "WORKAROUND_RETIRED")
            self.assertEqual(activity["metadata"]["workaround_status"], "RETIRED")
            self.assertEqual(activity["metadata"]["reason"], "Superseded by permanent patch")

            # Verify audit log recorded
            audit = conn.execute(
                text(
                    "SELECT action, actor_id FROM public.audit_log_metadata "
                    "WHERE tenant_id = :tenant_id AND action = 'itsm.problem.workaround_retired' "
                    "ORDER BY tenant_sequence DESC LIMIT 1"
                ),
                {"tenant_id": self.tenant_id},
            ).mappings().first()
            self.assertIsNotNone(audit)
            self.assertEqual(audit["action"], "itsm.problem.workaround_retired")

    def test_24_search_excludes_draft_and_retired_workarounds(self):
        """Search excludes retired workarounds (PRB 1 retired above) and draft records."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        returned_numbers = [item["ticket_number"] for item in items]
        # PRB-100001 is now RETIRED, must NOT be returned
        self.assertNotIn("PRB-100001", returned_numbers)
        # PRB-100007 was seeded as DRAFT, published in test_19, but let's check unapproved ones are excluded
        # PRB-100004 (empty/draft) must not be returned
        self.assertNotIn("PRB-100004", returned_numbers)

    def test_25_search_excludes_expired_workarounds(self):
        """Search excludes workarounds whose workaround_expires_at is in the past."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100008",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 0)

    def test_26_search_excludes_overdue_review_workarounds(self):
        """Search excludes workarounds whose review_due_at is overdue."""
        res = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-100009",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 0)

    def test_27_search_includes_symptoms_filter_and_publishing(self):
        """Symptoms keyword search works for approved workarounds and exposes symptoms field."""
        # Before publishing, PRB-100010 is DRAFT -> search returns 0
        res_before = self.client.get(
            "/v1/itsm/problems/known-errors?search=SERVFAIL",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_before.status_code, 200)
        self.assertEqual(len(res_before.json()), 0)

        # Problem Manager publishes PRB-100010
        res_pub = self.client.post(
            f"/v1/itsm/problems/{self.prb_symptoms_id}/publish-workaround",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={},
        )
        self.assertEqual(res_pub.status_code, 200)
        self.assertEqual(res_pub.json()["workaround_status"], "APPROVED")

        # After publishing -> search for symptoms keyword returns 1 item with symptoms populated
        res_after = self.client.get(
            "/v1/itsm/problems/known-errors?search=SERVFAIL",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_after.status_code, 200)
        items = res_after.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ticket_number"], "PRB-100010")
        self.assertIn("SERVFAIL", items[0]["symptoms"])

    def test_28_migration_backfill_and_schema_defaults(self):
        """Verify database defaults workaround_status to DRAFT and enforces check constraint."""
        test_ticket_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-999999', 'PROBLEM', 'Constraint test problem', 'Test', 'LOW', 'LOW', 'P4', 'IN_PROGRESS', :req_id, now(), now())"
                ),
                {"id": test_ticket_id, "tenant_id": self.tenant_id, "req_id": self.pcm_user_id},
            )
            # Insert problem detail row omitting workaround_status -> should default to DRAFT
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, workaround_summary, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, 'Temporary text', now(), now())"
                ),
                {"tenant_id": self.tenant_id, "ticket_id": test_ticket_id},
            )
            row = conn.execute(
                text("SELECT workaround_status FROM public.itsm_problem_details WHERE ticket_id = :ticket_id"),
                {"ticket_id": test_ticket_id},
            ).mappings().first()
            self.assertEqual(row["workaround_status"], "DRAFT")

            # Verify check constraint prevents invalid status
            from sqlalchemy.exc import IntegrityError
            with self.assertRaises(IntegrityError):
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, workaround_status, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, 'INVALID_STATUS', now(), now())"
                    ),
                    {"tenant_id": self.tenant_id, "ticket_id": test_ticket_id},
                )

    def test_29_e2e_known_error_full_lifecycle_workflow(self):
        """End-to-end integration: Problem Manager creates/updates Known Error ->
        publishes approved workaround -> Service Agent searches from incident triage ->
        links incident to problem -> Problem Manager retires workaround -> Service Agent
        search excludes retired workaround -> incident unlinks cleanly.
        Verifies non-closure invariant throughout.
        """
        prb_id = uuid4()
        inc_id = uuid4()
        pcm_headers = {
            "Authorization": f"Bearer {self.pcm_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }
        agent_headers = {
            "Authorization": f"Bearer {self.agent_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }

        with self.migrator_engine.begin() as conn:
            # 1. Insert Problem in OPEN status with DRAFT details
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-E2E-001', 'PROBLEM', 'Kubernetes ingress gateway 502 Bad Gateway timeouts', 'Intermittent upstream connection drops during pod rescheduling', 'HIGH', 'HIGH', 'P2', 'OPEN', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": prb_id, "tenant_id": self.tenant_id, "srv_id": self.service_vpn_id, "req_id": self.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, symptoms, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, 'Pre-investigation hypothesis', 'Increase gateway keepalive timeout to 65s', 'HTTP 502 Bad Gateway with connection reset by peer', 'DRAFT', now(), now())"
                ),
                {"tenant_id": self.tenant_id, "ticket_id": prb_id},
            )
            # 2. Insert Incident in IN_PROGRESS status assigned to agent
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, assignee_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-E2E-001', 'INCIDENT', 'Production payment gateway throwing 502 errors', 'Customer checkout failing intermittently', 'HIGH', 'HIGH', 'P2', 'IN_PROGRESS', :srv_id, 'PORTAL', :req_id, :agent_id, now(), now())"
                ),
                {"id": inc_id, "tenant_id": self.tenant_id, "srv_id": self.service_vpn_id, "req_id": self.req_user_id, "agent_id": self.agent_user_id},
            )

        # 3. Before publish: Service Agent searches KEDB -> Draft workaround is NOT returned
        res_pre = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-E2E-001",
            headers=agent_headers,
        )
        self.assertEqual(res_pre.status_code, 200)
        self.assertEqual(len(res_pre.json()), 0)

        # 4. Problem Manager updates investigation details
        res_patch = self.client.patch(
            f"/v1/itsm/problems/{prb_id}/investigation",
            headers=pcm_headers,
            json={
                "root_cause_summary": "Envoy idle timeout shorter than backend keepalive timeout",
                "workaround_summary": "Increase ingress gateway keepalive_timeout to 65s and set max_requests to 1000",
                "symptoms": "HTTP 502 Bad Gateway with upstream connection termination error",
                "permanent_solution": "Deploy coordinated keepalive configuration via Helm release v2.4.1",
            },
        )
        self.assertEqual(res_patch.status_code, 200)
        patch_data = res_patch.json()
        self.assertEqual(patch_data["problem_details"]["workaround_status"], "DRAFT")

        # 5. Problem Manager publishes and approves workaround
        expiry = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        review = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
        res_pub = self.client.post(
            f"/v1/itsm/problems/{prb_id}/publish-workaround",
            headers=pcm_headers,
            json={
                "workaround_expires_at": expiry,
                "review_due_at": review,
                "symptoms": "HTTP 502 Bad Gateway with upstream connection termination error",
                "notes": "Approved by Problem Management for incident triage use",
            },
        )
        self.assertEqual(res_pub.status_code, 200)
        pub_data = res_pub.json()
        self.assertEqual(pub_data["workaround_status"], "APPROVED")
        self.assertTrue(pub_data["known_error"])
        self.assertIsNotNone(pub_data["workaround_approved_at"])
        self.assertEqual(pub_data["workaround_approved_by_id"], str(self.pcm_user_id))

        # 6. Service Agent searches KEDB -> Now found with safe fields
        res_search = self.client.get(
            "/v1/itsm/problems/known-errors?search=keepalive_timeout",
            headers=agent_headers,
        )
        self.assertEqual(res_search.status_code, 200)
        items = res_search.json()
        matching = [item for item in items if item["ticket_number"] == "PRB-E2E-001"]
        self.assertEqual(len(matching), 1)
        ke_item = matching[0]
        self.assertEqual(ke_item["workaround_status"], "APPROVED")
        self.assertIn("keepalive_timeout to 65s", ke_item["workaround_summary"])
        self.assertIn("502 Bad Gateway", ke_item["symptoms"])
        self.assertEqual(ke_item["permanent_solution"], "Deploy coordinated keepalive configuration via Helm release v2.4.1")

        # 7. Service Agent links incident to problem
        res_link = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/link-problem",
            headers=agent_headers,
            json={"problem_id": str(prb_id)},
        )
        self.assertEqual(res_link.status_code, 200)
        link_data = res_link.json()
        self.assertEqual(link_data["linked_problem_id"], str(prb_id))
        self.assertFalse(link_data["already_linked"])

        # Invariant check: Incident status must still be IN_PROGRESS, Problem status still OPEN
        with self.migrator_engine.begin() as conn:
            inc_status = conn.execute(
                text("SELECT status, linked_problem_id FROM public.itsm_tickets WHERE id = :id"),
                {"id": inc_id},
            ).mappings().first()
            self.assertEqual(inc_status["status"], "IN_PROGRESS")
            self.assertEqual(str(inc_status["linked_problem_id"]), str(prb_id))

            prb_status = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": prb_id},
            ).mappings().first()
            self.assertEqual(prb_status["status"], "OPEN")

        # 8. Problem Manager retires the workaround
        res_retire = self.client.post(
            f"/v1/itsm/problems/{prb_id}/retire-workaround",
            headers=pcm_headers,
            json={"reason": "Permanent fix deployed in production Helm release v2.4.1"},
        )
        self.assertEqual(res_retire.status_code, 200)
        retire_data = res_retire.json()
        self.assertEqual(retire_data["workaround_status"], "RETIRED")

        # Invariant check: Retiring workaround must NOT close or alter Problem ticket status
        with self.migrator_engine.begin() as conn:
            prb_status_after = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": prb_id},
            ).mappings().first()
            self.assertEqual(prb_status_after["status"], "OPEN")

        # 9. Service Agent search immediately omits retired workaround
        res_search_retired = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-E2E-001",
            headers=agent_headers,
        )
        self.assertEqual(res_search_retired.status_code, 200)
        self.assertEqual(len(res_search_retired.json()), 0)

        # 10. Service Agent unlinks incident from problem
        res_unlink = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/unlink-problem",
            headers=agent_headers,
        )
        self.assertEqual(res_unlink.status_code, 200)
        unlink_data = res_unlink.json()
        self.assertIsNone(unlink_data["linked_problem_id"])

        with self.migrator_engine.begin() as conn:
            inc_status_unlinked = conn.execute(
                text("SELECT status, linked_problem_id FROM public.itsm_tickets WHERE id = :id"),
                {"id": inc_id},
            ).mappings().first()
            self.assertEqual(inc_status_unlinked["status"], "IN_PROGRESS")
            self.assertIsNone(inc_status_unlinked["linked_problem_id"])

    def test_30_e2e_governance_failure_cases(self):
        """Verify governance boundary failure cases:
        - Cannot publish problem without workaround_summary
        - Non-existent problem returns 404
        - Cross-tenant problem publish returns 404
        - Requester cannot publish, retire, link, or search (403)
        - Service Agent cannot publish or retire (403)
        - Unlinking already-unlinked incident is idempotent (200)
        """
        prb_empty_id = uuid4()
        pcm_headers = {
            "Authorization": f"Bearer {self.pcm_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }
        req_headers = {
            "Authorization": f"Bearer {self.req_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }
        agent_headers = {
            "Authorization": f"Bearer {self.agent_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-E2E-FAIL', 'PROBLEM', 'Empty workaround failure case', 'Testing error validation', 'LOW', 'LOW', 'P4', 'OPEN', :srv_id, :req_id, now(), now())"
                ),
                {"id": prb_empty_id, "tenant_id": self.tenant_id, "srv_id": self.service_vpn_id, "req_id": self.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, workaround_summary, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, '', now(), now())"
                ),
                {"tenant_id": self.tenant_id, "ticket_id": prb_empty_id},
            )

        # 1. Empty workaround publish fails with 400
        res_fail_empty = self.client.post(
            f"/v1/itsm/problems/{prb_empty_id}/publish-workaround",
            headers=pcm_headers,
            json={"notes": "Attempting to publish empty"},
        )
        self.assertEqual(res_fail_empty.status_code, 400)
        self.assertIn("cannot be empty", res_fail_empty.json()["detail"])

        # 2. Non-existent problem publish fails with 404
        fake_id = uuid4()
        res_fail_404 = self.client.post(
            f"/v1/itsm/problems/{fake_id}/publish-workaround",
            headers=pcm_headers,
        )
        self.assertEqual(res_fail_404.status_code, 404)

        # 3. Cross-tenant problem publish fails with 404
        res_fail_cross = self.client.post(
            f"/v1/itsm/problems/{self.prb_b_id}/publish-workaround",
            headers=pcm_headers,
        )
        self.assertEqual(res_fail_cross.status_code, 404)

        # 4. Requester gets 403 on publish, retire, search, and link
        res_req_pub = self.client.post(f"/v1/itsm/problems/{prb_empty_id}/publish-workaround", headers=req_headers)
        self.assertEqual(res_req_pub.status_code, 403)
        res_req_ret = self.client.post(f"/v1/itsm/problems/{prb_empty_id}/retire-workaround", headers=req_headers)
        self.assertEqual(res_req_ret.status_code, 403)
        res_req_search = self.client.get("/v1/itsm/problems/known-errors", headers=req_headers)
        self.assertEqual(res_req_search.status_code, 403)

        # 5. Service Agent gets 403 on publish and retire
        res_sa_pub = self.client.post(f"/v1/itsm/problems/{prb_empty_id}/publish-workaround", headers=agent_headers)
        self.assertEqual(res_sa_pub.status_code, 403)
        res_sa_ret = self.client.post(f"/v1/itsm/problems/{prb_empty_id}/retire-workaround", headers=agent_headers)
        self.assertEqual(res_sa_ret.status_code, 403)

    def test_31_update_investigation_on_new_problem_and_progression(self):
        """PRB-004 Regression:
        - When a problem is created from an incident, its lifecycle status is NEW.
        - Problem Manager can save investigation details while keeping status NEW or advancing to OPEN/IN_PROGRESS.
        - Saving investigation with status NEW must succeed (200 OK) without 400 Bad Request.
        - Fields (symptoms, workaround, root cause) save and reload correctly.
        - Once advanced to OPEN/IN_PROGRESS and published, it is discoverable in known errors search.
        """
        prb_id = uuid4()
        pcm_headers = {
            "Authorization": f"Bearer {self.pcm_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }
        agent_headers = {
            "Authorization": f"Bearer {self.agent_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-NEW-001', 'PROBLEM', 'Recurring connection pool exhaustion', 'Multiple incidents reported db connection timeouts', 'HIGH', 'HIGH', 'P2', 'NEW', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": prb_id, "tenant_id": self.tenant_id, "srv_id": self.service_vpn_id, "req_id": self.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, 'DRAFT', now(), now())"
                ),
                {"tenant_id": self.tenant_id, "ticket_id": prb_id},
            )

        # 1. Save investigation with status='NEW' (previously returned 400 Bad Request)
        res_save_new = self.client.patch(
            f"/v1/itsm/problems/{prb_id}/investigation",
            headers=pcm_headers,
            json={
                "status": "NEW",
                "root_cause_summary": "HikariCP pool leak under high concurrency",
                "workaround_summary": "Increase max-pool-size to 50 and restart worker pods",
                "symptoms": "ConnectionTimeoutException: Connection is not available, request timed out after 30000ms",
                "known_error": True,
            },
        )
        self.assertEqual(res_save_new.status_code, 200, res_save_new.text)
        saved_data = res_save_new.json()
        self.assertEqual(saved_data["status"], "NEW")
        self.assertEqual(saved_data["problem_details"]["root_cause_summary"], "HikariCP pool leak under high concurrency")
        self.assertEqual(saved_data["problem_details"]["workaround_summary"], "Increase max-pool-size to 50 and restart worker pods")
        self.assertEqual(saved_data["problem_details"]["symptoms"], "ConnectionTimeoutException: Connection is not available, request timed out after 30000ms")

        # 2. Verify reload via GET /v1/itsm/problems/{id}
        res_get = self.client.get(
            f"/v1/itsm/problems/{prb_id}",
            headers=pcm_headers,
        )
        self.assertEqual(res_get.status_code, 200)
        get_data = res_get.json()
        self.assertEqual(get_data["status"], "NEW")
        self.assertEqual(get_data["problem_details"]["root_cause_summary"], "HikariCP pool leak under high concurrency")

        # 3. Known error search does not return NEW ticket even if known_error=True (fail-closed unassessed)
        res_search_new = self.client.get(
            "/v1/itsm/problems/known-errors?search=PRB-NEW-001",
            headers=agent_headers,
        )
        self.assertEqual(res_search_new.status_code, 200)
        self.assertEqual(len(res_search_new.json()), 0)

        # 4. Advance status to IN_PROGRESS
        res_advance = self.client.patch(
            f"/v1/itsm/problems/{prb_id}/investigation",
            headers=pcm_headers,
            json={
                "status": "IN_PROGRESS",
            },
        )
        self.assertEqual(res_advance.status_code, 200)
        self.assertEqual(res_advance.json()["status"], "IN_PROGRESS")
        self.assertEqual(res_advance.json()["problem_details"]["workaround_summary"], "Increase max-pool-size to 50 and restart worker pods")

        # 5. Publish workaround
        res_pub = self.client.post(
            f"/v1/itsm/problems/{prb_id}/publish-workaround",
            headers=pcm_headers,
            json={
                "notes": "Pool size increase approved for triage mitigation",
            },
        )
        self.assertEqual(res_pub.status_code, 200)

        # 6. Service Agent can now find it in known error search
        res_search_active = self.client.get(
            "/v1/itsm/problems/known-errors?search=HikariCP",
            headers=agent_headers,
        )
        self.assertEqual(res_search_active.status_code, 200)
        self.assertEqual(len(res_search_active.json()), 1)
        self.assertEqual(res_search_active.json()[0]["ticket_number"], "PRB-NEW-001")

    def test_32_disallow_silent_reopen_and_publish_on_closed_problem(self):
        """PRB-004 Regression:
        - Saving investigation on a CLOSED problem must NOT silently reopen it to OPEN/IN_PROGRESS/NEW.
        - Attempting to change status of a CLOSED problem via update_investigation raises 400.
        - Attempting to publish a workaround on a CLOSED problem raises 400.
        """
        prb_closed_id = uuid4()
        pcm_headers = {
            "Authorization": f"Bearer {self.pcm_key}",
            "X-Tenant-ID": str(self.tenant_id),
        }

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-CLOSED-001', 'PROBLEM', 'Closed legacy problem ticket', 'Legacy issue already closed', 'LOW', 'LOW', 'P4', 'CLOSED', :srv_id, 'PORTAL', :req_id, now(), now())"
                ),
                {"id": prb_closed_id, "tenant_id": self.tenant_id, "srv_id": self.service_vpn_id, "req_id": self.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, workaround_summary, workaround_status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, false, 'Legacy workaround', 'DRAFT', now(), now())"
                ),
                {"tenant_id": self.tenant_id, "ticket_id": prb_closed_id},
            )

        # 1. Attempting to reopen CLOSED problem to OPEN via investigation update fails
        res_reopen_open = self.client.patch(
            f"/v1/itsm/problems/{prb_closed_id}/investigation",
            headers=pcm_headers,
            json={"status": "OPEN"},
        )
        self.assertEqual(res_reopen_open.status_code, 400)
        self.assertIn("Cannot reopen a CLOSED problem", res_reopen_open.json()["detail"])

        # 2. Attempting to reopen CLOSED problem to IN_PROGRESS fails
        res_reopen_prog = self.client.patch(
            f"/v1/itsm/problems/{prb_closed_id}/investigation",
            headers=pcm_headers,
            json={"status": "IN_PROGRESS"},
        )
        self.assertEqual(res_reopen_prog.status_code, 400)
        self.assertIn("Cannot reopen a CLOSED problem", res_reopen_prog.json()["detail"])

        # 3. Attempting to reopen CLOSED problem to NEW fails
        res_reopen_new = self.client.patch(
            f"/v1/itsm/problems/{prb_closed_id}/investigation",
            headers=pcm_headers,
            json={"status": "NEW"},
        )
        self.assertEqual(res_reopen_new.status_code, 400)
        self.assertIn("Cannot reopen a CLOSED problem", res_reopen_new.json()["detail"])

        # 4. Attempting to publish workaround on a CLOSED problem fails
        res_pub_closed = self.client.post(
            f"/v1/itsm/problems/{prb_closed_id}/publish-workaround",
            headers=pcm_headers,
            json={"notes": "Attempting to publish on closed"},
        )
        self.assertEqual(res_pub_closed.status_code, 400)
        self.assertIn("Cannot publish workaround for a CLOSED problem", res_pub_closed.json()["detail"])

        # 5. Database status remains strictly CLOSED
        with self.migrator_engine.begin() as conn:
            row = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": prb_closed_id},
            ).mappings().first()
            self.assertEqual(row["status"], "CLOSED")


if __name__ == "__main__":
    unittest.main()

# Outage & Alerts: Audit, Verification, and Remediation

**Audit date:** 2026-10-14
**Repository:** `C:\Users\dell\Desktop\khushi-ITSM-main`
**Branch inspected:** `correct-auditor` at `2189496`
**Evidence status:** Source inspection and frontend checks completed. Backend/PostgreSQL execution is blocked in the current tool environment because Python, Docker, and Go are unavailable.

## A. Executive conclusion

Outage & Alerts is implemented as one tenant-scoped communication domain, separate from Incident and Major Incident. An explicitly authorized Incident Manager can create a standalone draft, select affected services and audiences, preview resolved recipients, publish immutable messages, publish updates, and publish recovery. Requesters and operational recipients read projections of the same Alert; they do not receive duplicated role-specific Alert records.

The implementation has strong foundations: explicit action grants, service-based recipient resolution, current-eligibility checks, immutable publication snapshots, idempotent publication, atomic recovery, database RLS, notification records, and transactional audit evidence. The old Major Incident `command_communications` data is not used as the Alert source of truth.

This audit confirmed and remediated six concrete defects:

- Requester notification links were blocked by the protected ITSM layout.
- Incident Manager delivery-health results were not filtered to the manager's service grants.
- Manager `allowed_actions` advertised actions that were invalid for the Alert lifecycle.
- Auditor and Platform Administrator sessions could render the business outage banner.
- The database allowed an Alert to point at another Alert's publication in the same tenant.
- A mixed-role selected team was summarized with one member's projection fields.

Frontend contract, lint, and production-build evidence passes. The feature is suitable for local development and team QA after migration `061` is applied in a disposable PostgreSQL environment. It is **not yet evidenced for a controlled pilot or production rollout** because the backend/PostgreSQL integration suite and migration upgrade/downgrade were not executable in this environment.

## B. Product sources and release interpretation

| Source | Requirement or intent | Audit interpretation |
|---|---|---|
| `imp_doc/we need to build project/AuthClaw ITSM Product Specification.docx`, common foundations and audit sections | Tenant isolation, least privilege, durable evidence, and safe role-specific experiences | Current-release security baseline |
| Product Specification, Incident and Major Incident sections | Major Incident retains command coordination; stakeholder communication is a governed capability | Alert remains independent; Major Incident linkage is optional |
| Product Specification, CMDB/service relationship sections | Services have consumers, owners, and support groups | These relationships are authoritative inputs to recipient resolution |
| Product Specification, notification requirements | Notify the correct audience without leakage and preserve delivery trace | Current in-app and portal delivery must be truthful and tenant-safe |
| Product Specification, durable workflow/NFR sections | Idempotent, retry-safe, auditable operations | Publication uses a stable idempotency key and transaction boundary |
| `AI_Native_ITSM_Product_Project_Plan.xlsx`, `02_Feature_Backlog`, MIM-003 | Audience templates, cadence, approval, channel expansion, and delivery visibility are planned V1 capabilities | Missing future items are not automatically MVP defects |
| Project Plan, `04_Roles_Permissions` | Requester, Service Agent, Incident Manager, Auditor, and other business roles have distinct responsibilities | Field visibility and actions must be projected, not inherited through a hierarchy |
| Project Plan, `06_Data_Model` | Notification and communication records retain actor, audience, state, and evidence | Current Alert, Publication, Recipient, Notification, and audit records implement this foundation |
| Project Plan, `09_Security_GRC` and `10_NFR_SLO` | Server-side authorization, isolation, auditability, accessibility, and concurrency controls | UI hiding is supplementary; backend and database controls are authoritative |

The source documents establish product intent but do not prove implementation. Approval workflows, scheduled publication/expiry, audience templates, external channels, and a public status page remain planned or decision-dependent; they are not represented here as working functionality.

## C. Requirement-to-implementation matrix

| Requirement | Implementation evidence | Test evidence | Status |
|---|---|---|---|
| One canonical Alert | `ITSMOutageAlert` plus related service, CI, audience, link, publication, and recipient models in `backend/app/db/models.py` | Security integration suite defines canonical lifecycle scenarios | Implemented; DB execution unverified here |
| Standalone creation | `OutageAlertService.create_draft`; related links are optional | Standalone draft/publish scenarios in security integration tests | Implemented; backend execution unverified here |
| Explicit business authority | `ITSMOutageAlertGrant`; action checks in `itsm_outage_alert_service.py`; management role in policy | Policy tests deny Auditor/Platform Admin management | Implemented; policy tests not executable here |
| Tenant isolation | Tenant predicates, composite tenant constraints/triggers, RLS migrations | Cross-tenant child and access tests | Implemented; PostgreSQL RLS unverified here |
| Service-scoped audience | `resolve_recipients` uses consumers, support teams, owners, linked records, selected teams, and current user state | Eligible, ineligible, company-wide, overlapping, and stale-recipient tests | Implemented; backend execution unverified here |
| Preview equals publication resolution | Both call `OutageAlertService.resolve_recipients`; preview token binds the resolved set | Preview/nonmutation and publication consistency tests | Implemented; backend execution unverified here |
| Role-safe content | `project_alert`, `projection_fields`, per-recipient `content_snapshot` | Requester, Service Agent, process, Auditor, and Platform Admin tests; frontend contracts | Implemented; frontend contracts pass |
| Immutable publications | Publication and recipient snapshot triggers in migrations; no update/delete API | Database immutability tests | Implemented; PostgreSQL trigger execution unverified here |
| Atomic recovery | `publish(..., "RECOVERY")` creates a publication and changes state in one transaction | Recovery atomicity/idempotency test | Implemented; backend execution unverified here |
| Audit evidence | Business change and audit/outbox writes share the transaction; audit failure propagates | Audit rollback test | Implemented; backend execution unverified here |
| Honest delivery | Current supported paths are `IN_APP` and `PORTAL`; stored states do not claim external provider delivery | Delivery snapshot/status tests | Implemented baseline; external providers deferred |
| Requester notification-to-detail | Bell/banner link to `/itsm/outage-alerts/{id}`; layout now permits the route | Frontend contract passes | Fixed and verified statically |

## D. Role, action, and field matrix

| Role | Discovery and read | Mutations | Information boundary |
|---|---|---|---|
| Requester | Shared alert list, bell/banner, and detail only when the user was a publication recipient and remains currently eligible | May acknowledge when the snapshot allows it | Customer-safe published content, services, impact, recommended action, status, timestamps, and immutable public history; no internal notes, support guidance, linked operational details, recipients, or delivery evidence |
| Service Agent | Same recipient rule, additionally requiring current role/team/service eligibility | May acknowledge; may open a linked Incident only for `SOLVE`, a qualifying intent, and independent Incident authorization | Public fields plus approved support guidance, severity/intent, and independently authorized linked Incident context |
| Incident Manager | Protected management workspace and records allowed by explicit `OUTAGE_ALERT:*` grants and service scope | Draft, edit, preview, publish, update, recover, cancel draft, and audited Draft/Active link operations according to state and grant | Full canonical operational record, audience, history, and scoped delivery results |
| Problem & Change Manager | Only when selected and related to an authorized linked Problem/Change | Acknowledge only when allowed; no broadcasting | Public fields plus the authorized process relationship; no unrelated Incident or internal manager content |
| Service Owner/Catalog Manager | Only when selected and currently an active owner of an affected service | Acknowledge only when allowed; no broadcasting | Service-impact/process projection; no audit or unrestricted internal content |
| Auditor | Dedicated evidence list and evidence projection inside the tenant | Read-only; no create, edit, publish, recover, cancel, or acknowledge | Published versions, actors, timestamps, audiences, relationships, delivery aggregates, correlation/integrity evidence; no internal notes, support guidance, or recipient identities |
| Platform Administrator | Technical delivery-health workspace | No business Alert mutation or broadcast permission | Delivery/integration diagnostics only; no automatic business-content access and no business outage banner |

### Multi-role result

The current identity model does **not** support simultaneous ITSM business roles. `ITSMUserAccess` has one `itsm_role` and a unique `(tenant_id, user_id)` row. Therefore Requester + Service Agent, Incident Manager + Auditor, and similar unions cannot be represented or truthfully tested. This is an architectural/product limitation, not a defect that can be safely patched by treating the “highest” role as authoritative. A future multi-role design needs an explicit session/effective-role contract and backend authorization semantics.

For the current Outage & Alerts contract, action authority remains the explicit, service-scoped `OUTAGE_ALERT:*` grant; the single ITSM role selects the recipient/read projection. This safely keeps Platform Administration separate from business broadcasting, but it is not a general multi-role solution. Any future multi-role design still requires an approved effective-role/session contract, field-policy combination rules, separation-of-duties rules, and migration of existing identities.

## E. Audience and delivery trace

1. The Incident Manager selects affected services and business audience rules; individual selection is an optional narrowing rule, not an authorization bypass.
2. The server validates the manager's explicit action grant and service scope.
3. `resolve_recipients` intersects tenant, active identity, business role, affected-service relationship, team/owner/linked-record relationship, and selected audience.
4. Preview calls that same resolver and groups results by both audience and projection type. It returns safe counts, fields, actions, inclusion reasons, exclusions, and a token representing the current draft/resolution.
5. Publication locks/reloads the Alert, validates state and permissions again, resolves recipients again, and rejects a stale preview token.
6. A publication snapshot, one recipient snapshot per unique user, in-app Notification rows, delivery trace, and required audit evidence are committed together.
7. Recipient notification content comes from that recipient's projection, not the full Alert object.
8. List/detail access requires both a historical recipient snapshot and current eligibility. Historical snapshots remain audit evidence but do not grant stale read access.
9. Updates and recovery create new immutable publication versions. Recovery also sets the canonical Alert to `RECOVERED` in the same action, removing it from `/active`.

Implemented channels are in-app Notification and persistent portal/workspace presentation. Email, SMS, Teams, Slack, push-provider delivery, automatic retry workers, and provider-level “delivered” claims are not verified or claimed.

## F. Frontend/backend connectivity map

| User action | Frontend | API | Backend/service | Persisted result and evidence |
|---|---|---|---|---|
| Open workspace | `incident-manager/outage-alerts/page.tsx` | `GET /v1/itsm/outage-alerts` | `list_visible` | Tenant/scoped summaries; no mutation |
| Create/save draft | `.../create/page.tsx` | `POST /v1/itsm/outage-alerts` | `create_draft` | Alert + service/CI/audience/link rows + audit |
| Edit draft | same composer with `?edit=` | `PUT /v1/itsm/outage-alerts/{id}` | `update_draft` | Draft-only update + audit |
| Search references | scalable selectors in composer | `GET /reference-options` | permission-scoped reference query | No mutation; unauthorized records are omitted |
| Preview recipients | manager detail | `POST /{id}/preview` | `preview` -> `resolve_recipients` -> projection policy | No mutation; preview token returned |
| Publish | manager detail | `POST /{id}/publish` | `publish(..., INITIAL)` | Immutable publication, recipients, notifications, audit, current pointer |
| Publish update | manager detail | `POST /{id}/updates` | `publish(..., UPDATE)` | New immutable version and fresh recipient snapshot |
| Publish recovery | manager detail | `POST /{id}/recovery` | `publish(..., RECOVERY)` | Recovery version + `RECOVERED` state atomically |
| Link/unlink operational record | manager detail | `POST /{id}/links`, `DELETE /{id}/links/{type}/{record}` | `link_record`, `unlink_record` | Current Draft/Active relationship + required audit; prior publication snapshots remain unchanged |
| Recipient view | shared list/detail and banner | `GET /active`, `GET /{id}` | `list_visible`, `detail`, current recipient eligibility, projection | Read-only safe projection |
| Acknowledge | recipient detail | `POST /{id}/acknowledge` | `acknowledge` | Recipient acknowledgement + bell read state + audit |
| Auditor evidence | Auditor outage evidence page | `GET /auditor-evidence`, `GET /{id}` | Auditor authorization and evidence projection | Read-only evidence |
| Delivery health | platform/admin view and authorized manager use | `GET /delivery-health` | `list_delivery_health` | Technical/scoped aggregate read |

All console calls pass through the existing BFF allow-list in `console/src/lib/bff-routes.ts`; the backend routes are registered under the existing ITSM API in `backend/main.py`.

## G. Findings register and remediation record

| ID | Severity | Finding and root cause | Remediation | Verification |
|---|---|---|---|---|
| OA-001 | High | Requester bell/banner links targeted the shared Alert detail, but the protected ITSM layout did not allow Requesters to enter that route. Users could be notified and then blocked from the message. | Added shared list/detail paths to the Requester allow-list in `console/src/app/(console)/itsm/layout.tsx`. | Frontend contract passes; runtime browser session not rerun in this environment |
| OA-002 | High | Incident Manager delivery health checked the role but did not restrict Alert and recipient aggregates to `OUTAGE_ALERT:READ` service scope. | Filtered list and aggregate queries through the manager's service-scoped readable Alert IDs. Platform Admin technical scope remains tenant-wide. | New backend integration test added; execution blocked by missing Python/PostgreSQL |
| OA-003 | Medium | Manager detail advertised every granted action regardless of Alert state, allowing invalid controls to be rendered. | `_manager_actions` now intersects permission grants with Draft/Active/terminal lifecycle actions. | Policy test added; frontend contracts pass; Python test execution blocked |
| OA-004 | Medium | The shell fetched/rendered the business banner for every ITSM role, including Auditor and Platform Admin. | Banner now requires an eligible business role; Auditor/Platform Admin are excluded. It refreshes `/active` every 45 seconds. | Contract and targeted ESLint pass |
| OA-005 | High | The current-publication trigger checked tenant ownership but not that the publication belonged to the same Alert. An invalid same-tenant pointer could corrupt “current version” semantics. | Migration `061_bind_alert_current_publication.py` validates existing data and enforces tenant + Alert identity. Startup/gateway revision gates now include `061`. | Migration-chain assertions added; actual PostgreSQL upgrade/downgrade and trigger test blocked |
| OA-006 | Medium | Selected-team preview grouped only by audience. If a team contained different roles, one member's field projection was shown for the entire group. | Preview now groups by `(audience_type, projection_type)` and returns the projection type to the UI. | Backend integration test added; frontend contract passes |
| OA-007 | Informational / decision | One user cannot hold multiple ITSM roles because of the single-role unique schema. | No unsafe privilege-union behavior was invented. | Confirmed by model/schema inspection; product/architecture decision required |
| OA-008 | Medium | Links could be configured only while editing a Draft, leaving an Active Alert unable to reflect a later Incident, Major Incident, Problem, or Change relationship. | Added explicit, idempotent Draft/Active link and unlink actions. They require scoped `OUTAGE_ALERT:LINK`, validate the target against tenant and affected-service scope, lock the Alert, and commit the relationship with required audit evidence. Existing publication and recipient snapshots are never rewritten; a future update is separately previewed/published. The final Incident cannot be removed from an Active `SOLVE` Alert. | Policy/frontend contracts added; PostgreSQL integration covers authorization, scope, audit, immutable snapshots, idempotent unlink, and audit-failure rollback but still requires execution |
| OA-009 | Medium | Preview showed audience counts and general reasons, but an Incident Manager could not verify individual recipients or publication delivery outcomes at scale. | Added a manager-only recipient-evidence API and responsive dialog with 25-row pages, search, audience/projection focus, delivery and acknowledgement filters, safe inclusion reasons, and per-version immutable recipient snapshots. | Frontend contract and production build pass; PostgreSQL integration test added but not executable here |
| OA-010 | Informational / deferred | Approval, scheduling, expiry, subscriptions, templates, external delivery channels, and expanded public status surfaces appear in broader V1/planned requirements, but no complete Alert-specific lifecycle, authorization, worker, or delivery contract exists. | No unsupported workflow was invented. Keep the first release on immediate in-app/portal publication and explicit recovery until each capability has an approved contract and reliable provider/worker implementation. | Source-of-truth and implementation inspection; not an implementation defect in the current MVP |

## H. UX review

The composer now follows the Incident Manager's decision sequence instead of exposing raw tables:

| Area | Status and recommendation |
|---|---|
| Title, type, severity, public summary, impact, recommended action | Primary, required communication fields. Keep in the first section. |
| Affected services | Primary scope control. Keep required for preview/publication and use searchable, paginated reference selection for scale. |
| Intent | Primary semantic choice. Keep beside audience, but never use it to override RBAC. |
| Users of services, Service Agents, Service Owners | Primary business audiences resolved from service relationships; do not expose bulk user checklists. |
| Service Agent handling | Conditional; show only when Service Agents are selected. `SOLVE` requires existing Incident work, never silent Incident creation. |
| Public message/support guidance/next update | Public message is required for publication; support guidance and next update are conditional/optional. |
| CIs, teams, process managers, specific people, related records, internal notes | Advanced/optional drawers with searchable references. Backend eligibility remains authoritative. |
| Draft feedback | Inline `aria-live` status and a visible sticky Save Draft action distinguish “saved” from “published.” |
| Recipient preview | Required before publication; displays counts, projection, safe reasons, fields, actions, and exclusions from the authoritative resolver. |

The composer still needs hands-on accessibility testing with keyboard and screen reader, plus mobile browser verification after the current combined working tree is started.

## I. Verification performed

### Passed

- `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/itsm-outage-alerts-contract.test.mts` — **19/19 passed**.
- Targeted ESLint for the changed Alert banner, shell, layout, and manager detail — **passed**.
- `npm.cmd run build` — **passed** after the final changes; Next.js production build generated 116 pages.
- `git diff --check` — **passed**; only Git line-ending warnings were emitted.

### Broader checks with unrelated failures

- Full console unit suite — **101 passed, 1 failed**. The failure is the pre-existing `itsm-admin-users` password-input assertion, outside Outage & Alerts.
- `npm.cmd run test:claims` — failed on an unrelated existing `ci-import-modal.tsx` “immutable” claim.

### Blocked / not verified

- Backend policy and integration tests, including tenant isolation, RLS, audit rollback, concurrency, idempotency, immutable triggers, recovery, and new scope/projection cases.
- Alembic migration graph execution, migration `061` upgrade/downgrade, and database preflight against PostgreSQL.
- Go gateway tests.
- Live browser journeys for every role and notification delivery after these latest fixes.

The current tool environment has no usable `python`, `py`, `docker`, or `go` executable. Test files being present is not counted as a pass.

## J. Release-readiness assessment

**Verdict: ready for local development and team QA only after migration/test setup; not yet ready for controlled pilot or production.**

The design is substantially aligned with the intended secure communication model, and the confirmed frontend/authorization-shaping defects have focused fixes. The release gate is evidence, not another redesign:

1. Run the `outage-alert-security` CI job against disposable PostgreSQL. It applies through `061`, downgrades to `060`, reapplies `061`, and runs the pointer-integrity, RLS, authorization, audit rollback, lifecycle, and immutable-evidence integration tests.
2. Run `backend/tests/test_itsm_outage_alert_policy.py`, `backend/tests/test_itsm_outage_alert_security_integration.py`, and migration/startup checks with PostgreSQL and fail the release on any regression.
3. Run role-based browser journeys for Incident Manager, eligible/ineligible Requester, scoped Service Agent, Auditor, and Platform Admin; verify bell/banner/detail consistency and field redaction.
4. Resolve the multi-role identity contract before advertising multi-role support.
5. Obtain product/security approval before adding multi-role permission combination or any approval, scheduling, expiry, subscription, template, external-channel, or expanded public-status behavior.

## K. Assumptions that implementation must not make

- Do not treat role names as a privilege hierarchy.
- Do not treat a historical recipient snapshot as permanent current access.
- Do not trust a client-submitted recipient list, tenant, role, delivery state, or visibility flag.
- Do not make an Incident mandatory or create one silently.
- Do not make Incident resolution recover an Alert.
- Do not split the canonical Alert into one record per role.
- Do not use `command_communications` or generic Notification rows as the Alert source of truth.
- Do not claim external-channel delivery from a queued or in-app record.
- Do not grant Platform Administrators business broadcasting rights automatically.
- Do not implement approval, retention, reactivation, scheduled publication/expiry, or multi-role privilege union without an approved contract.

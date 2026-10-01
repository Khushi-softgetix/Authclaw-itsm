export type BffMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type BffBody = "none" | "json" | "optional-json";

const ALLOWED: Record<BffMethod, RegExp> = {
  GET: /^(users(?:\/invites|\/me\/security)?|usage-limits|tenants\/current|red-team|provider-credentials|notifications|gateways|evidence(?:\/[^/]+)?|findings(?:\/summary\/dashboard|\/[^/]+)?|ephemeral-workers\/(?:tokens|connectors)|compliance-scores(?:\/history|\/[^/]+)?|api-keys|approvals|access-requests|itsm\/approvals|itsm\/attachments\/[^/]+\/download|itsm\/incidents(?:\/summary|\/operations\/(?:dashboard|queue|participants|reference-data|saved-views)|(?:\/[^/]+)?(?:\/(?:activities|attachments|major-incident(?:\/page-preview)?))?)|itsm\/service-catalog(?:\/[^/]+)?|itsm\/knowledge(?:\/[^/]+(?:\/versions)?)?|itsm\/requests(?:\/[^/]+)?(?:\/(?:activities|attachments))?|itsm\/services(?:\/[^/]+)?|itsm\/problems(?:\/(?:stats|[^/]+(?:\/(?:activities|changes))?))?|itsm\/changes(?:\/(?:stats|[^/]+(?:\/(?:activities|problem))?))?|itsm\/admin\/(?:users(?:\/[^/]+)?|teams(?:\/[^/]+)?|services(?:\/[^/]+)?|configuration-items(?:\/[^/]+)?|service-catalog(?:\/[^/]+)?|business-calendars(?:\/[^/]+)?|sla-policies(?:\/[^/]+)?|settings))$/,
  POST: /^(users|users\/invite|users\/me\/mfa\/(?:setup|disable)|tenants|red-team|provider-credentials|provider-credentials\/[^/]+\/rotate|policies\/(?:validate|simulate|rollback)|policies\/[^/]+\/activate|notifications\/(?:read-all|[^/]+\/read)|gateways|ephemeral-workers\/tokens(?:\/[^/]+\/revoke)?|api-keys|api-keys\/[^/]+\/rotate|data-subject-requests(?:\/[^/]+\/(?:verify|approve|export|delete))?|workflows\/[^/]+\/(?:approve|reject|remediate)|approvals\/[^/]+\/(?:approve|reject)|itsm\/approvals\/[^/]+\/(?:approve|reject)|itsm\/incidents|itsm\/incidents\/operations\/saved-views|itsm\/incidents\/[^/]+\/(?:status|assign|activities|attachments|major-incident(?:\/page)?|report-recurring-problem|report-problem)|itsm\/requests|itsm\/requests\/[^/]+\/(?:status|assign|activities|attachments)|itsm\/problems\/[^/]+\/(?:resolve|close|link-change|unlink-change|create-change)|itsm\/changes\/[^/]+\/(?:transition|lifecycle)|itsm\/knowledge(?:\/[^/]+\/(?:publish|archive|retire|draft|helpful))?|itsm\/admin\/(?:users\/(?:invite|create)|users\/[^/]+\/(?:access|deactivate)|teams(?:\/[^/]+\/members)?|services|configuration-items(?:\/import\/(?:dry-run|commit))?|service-catalog|business-calendars|sla-policies))$/,
  PUT: /^(gateways\/[^/]+|itsm\/admin\/users\/[^/]+\/access)$/,
  PATCH: /^(tenants\/current\/status|findings\/[^/]+\/status|access-requests\/[^/]+\/status|itsm\/incidents\/[^/]+(?:\/major-incident)?|itsm\/problems\/[^/]+(?:\/investigation)?|itsm\/changes\/[^/]+(?:\/assessment)?|itsm\/knowledge\/[^/]+|itsm\/admin\/(?:teams\/[^/]+|services\/[^/]+|configuration-items\/[^/]+|service-catalog\/[^/]+|business-calendars\/[^/]+|sla-policies\/[^/]+))$/,

  DELETE: /^(users\/(?:invites\/[^/]+|(?!me$|invite$|invites$)[^/]+)|provider-credentials\/[^/]+|gateways\/[^/]+|api-keys\/[^/]+|itsm\/incidents\/operations\/saved-views\/[^/]+|itsm\/admin\/(?:teams\/[^/]+\/members\/[^/]+|users\/[^/]+))$/,
};
const AUDITOR_ALLOWED: Partial<Record<BffMethod, RegExp>> = {
  GET: /^itsm\/audit\/(?:overview|exports|events(?:\/[^/]+)?|traces)$/,
  POST: /^itsm\/audit\/export$/,
};


const NO_BODY_POST = /^(users\/me\/mfa\/setup|notifications\/(?:read-all|[^/]+\/read)|policies\/[^/]+\/activate|ephemeral-workers\/tokens\/[^/]+\/revoke|workflows\/[^/]+\/(?:reject|remediate)|approvals\/[^/]+\/reject|itsm\/knowledge\/[^/]+\/(?:publish|archive|retire|draft)|itsm\/admin\/users\/[^/]+\/deactivate)$/;
const OPTIONAL_BODY_POST = /^(?:(?:workflows|approvals)\/[^/]+\/approve|itsm\/approvals\/[^/]+\/(?:approve|reject)|itsm\/problems\/[^/]+\/close)$/;
const CREATED = /^(users|tenants|provider-credentials|red-team|gateways|ephemeral-workers\/tokens|api-keys(?:\/[^/]+\/rotate)?|itsm\/incidents|itsm\/incidents\/operations\/saved-views|itsm\/incidents\/[^/]+\/(?:activities|attachments)|itsm\/requests|itsm\/requests\/[^/]+\/(?:activities|attachments)|itsm\/problems\/[^/]+\/create-change|itsm\/knowledge|itsm\/admin\/(?:users\/(?:invite|create)|teams(?:\/[^/]+\/members)?|services|configuration-items|service-catalog|business-calendars|sla-policies))$/;

export function resolveBffRoute(method: BffMethod, path: string) {
  if (!ALLOWED[method].test(path) && !AUDITOR_ALLOWED[method]?.test(path)) return null;

  let backendPath = `/v1/${path}`;
  if (path === "approvals" || path.startsWith("approvals/")) {
    backendPath = `/v1/workflows/${path}`;
  } else if (path === "access-requests" || path.startsWith("access-requests/")) {
    backendPath = `/api/public/v1/${path}`;
  } else if (method === "POST" && path === "red-team") {
    backendPath = "/v1/red-team/runs";
  } else if (path === "compliance-scores/history") {
    backendPath = "/v1/compliance-scores/history/trend";
  }

  const body: BffBody = method !== "POST"
    ? (method === "PUT" || method === "PATCH" ? "json" : "none")
    : OPTIONAL_BODY_POST.test(path)
      ? "optional-json"
      : NO_BODY_POST.test(path)
        ? "none"
        : "json";
  const status = method === "DELETE" ? 204 : path === "users/invite" ? 202 : CREATED.test(path) && method === "POST" ? 201 : undefined;
  return { backendPath, body, status };
}

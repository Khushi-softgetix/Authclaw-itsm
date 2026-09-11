// Test BFF forwarding for itsm/admin/users/create and itsm/admin/users/invite

const BACKEND_URL = process.env.API_URL || process.env.BACKEND_URL || "http://127.0.0.1:8000";
const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

async function main() {
  console.log("1. Authenticating Admin via Backend...");
  const adminRes = await fetch(`${BACKEND_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@authclaw-lite.demo", password: "AuthClawDemo!234", tenant_name: "AuthClaw Lite Demo" })
  });
  const admin = await adminRes.json();
  const token = admin.session_token;
  console.log("Admin token obtained.");

  console.log("2. Sending manual create request through Console BFF proxy...");
  const bffCreateRes = await fetch(`${CONSOLE_URL}/api/itsm/admin/users/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `authclaw_session=${token}`
    },
    body: JSON.stringify({
      email: `emp.bff.${Date.now()}@authclaw-lite.demo`,
      itsm_role: "SERVICE_AGENT",
      password: "BffPassword!1234",
      confirm_password: "BffPassword!1234",
      email_credentials: false
    })
  });
  console.log(`BFF Create status: ${bffCreateRes.status}`);
  const bffCreateData = await bffCreateRes.json();
  console.log(`BFF Create body:`, bffCreateData);

  if (bffCreateRes.status !== 201) {
    throw new Error(`Expected 201 from BFF, got ${bffCreateRes.status}`);
  }

  console.log("3. Sending invite request through Console BFF proxy...");
  const bffInviteRes = await fetch(`${CONSOLE_URL}/api/itsm/admin/users/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `authclaw_session=${token}`
    },
    body: JSON.stringify({
      email: `emp.bff.inv.${Date.now()}@authclaw-lite.demo`,
      itsm_role: "AUDITOR",
      send_email: true
    })
  });
  console.log(`BFF Invite status: ${bffInviteRes.status}`);
  const bffInviteData = await bffInviteRes.json();
  console.log(`BFF Invite body:`, bffInviteData);

  if (bffInviteRes.status !== 201) {
    throw new Error(`Expected 201 from BFF invite, got ${bffInviteRes.status}`);
  }

  console.log("✅ All BFF Proxy tests passed!");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});

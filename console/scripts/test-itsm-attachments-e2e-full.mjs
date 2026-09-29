// End-to-end verification script for ITSM Attachments flow through Next.js BFF

const BASE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

async function run() {
  console.log("=== Testing ITSM Attachments End-to-End via BFF ===");
  console.log(`Target Console URL: ${BASE_URL}`);

  // 1. Authenticate via BFF
  console.log("\n1. Authenticating via BFF /api/auth/login...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      email: "admin@authclaw-lite.demo",
      password: "AuthClawDemo!234",
    }),
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Login failed with status ${loginRes.status}: ${errText}`);
  }

  const setCookie = loginRes.headers.get("set-cookie") || "";
  const cookieMatch = setCookie.match(/authclaw_session=([^;]+)/);
  if (!cookieMatch) {
    throw new Error("Missing authclaw_session cookie in login response");
  }
  const sessionToken = cookieMatch[1];
  const cookieHeader = `authclaw_session=${sessionToken}`;
  console.log("   ✓ Successfully authenticated with session cookie.");

  // 2. Verify Requester Incident Creation Page /itsm/incidents/new is accessible
  console.log("\n2. Accessing /itsm/incidents/new...");
  const pageRes = await fetch(`${BASE_URL}/itsm/incidents/new`, {
    headers: { Cookie: cookieHeader },
  });
  console.log(`   GET /itsm/incidents/new status: ${pageRes.status}`);
  if (pageRes.status !== 200) {
    throw new Error(`/itsm/incidents/new returned status ${pageRes.status}`);
  }
  console.log("   ✓ /itsm/incidents/new loaded successfully (200 OK).");

  // 3. Create Incident via BFF /api/itsm/incidents
  console.log("\n3. Creating incident via BFF /api/itsm/incidents...");
  const createRes = await fetch(`${BASE_URL}/api/itsm/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      title: "Printer and VPN Connection Failure",
      description: "Unable to reach network printer and office VPN gateway after system update.",
      impact: "MEDIUM",
      urgency: "HIGH",
      category: "HARDWARE",
      source_channel: "PORTAL",
    }),
  });

  if (createRes.status !== 201) {
    const errText = await createRes.text();
    throw new Error(`Failed to create incident (${createRes.status}): ${errText}`);
  }
  const incident = await createRes.json();
  console.log(`   ✓ Created incident: ${incident.ticket_number} (ID: ${incident.id})`);

  // 4. Upload PNG attachment via BFF /api/itsm/incidents/[id]/attachments
  console.log("\n4. Uploading PNG attachment (screenshot.png)...");
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
  ]);

  const formDataPng = new FormData();
  formDataPng.append("file", new Blob([pngBytes], { type: "image/png" }), "network_screenshot.png");

  const uploadPngRes = await fetch(`${BASE_URL}/api/itsm/incidents/${incident.id}/attachments`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
    },
    body: formDataPng,
  });

  console.log(`   Upload PNG status: ${uploadPngRes.status}`);
  if (uploadPngRes.status !== 201) {
    const errText = await uploadPngRes.text();
    throw new Error(`Failed to upload PNG (${uploadPngRes.status}): ${errText}`);
  }
  const pngAttachment = await uploadPngRes.json();
  console.log(`   ✓ PNG attachment uploaded: ID ${pngAttachment.id}, name: ${pngAttachment.file_name}, size: ${pngAttachment.file_size_bytes}B`);

  // 5. Upload PDF attachment via BFF /api/itsm/incidents/[id]/attachments
  console.log("\n5. Uploading PDF document (diagnostics.pdf)...");
  const pdfBytes = Buffer.from("%PDF-1.4\n%Diagnostic error dump for printer interface\n%%EOF");

  const formDataPdf = new FormData();
  formDataPdf.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "diagnostics.pdf");

  const uploadPdfRes = await fetch(`${BASE_URL}/api/itsm/incidents/${incident.id}/attachments`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
    },
    body: formDataPdf,
  });

  console.log(`   Upload PDF status: ${uploadPdfRes.status}`);
  if (uploadPdfRes.status !== 201) {
    const errText = await uploadPdfRes.text();
    throw new Error(`Failed to upload PDF (${uploadPdfRes.status}): ${errText}`);
  }
  const pdfAttachment = await uploadPdfRes.json();
  console.log(`   ✓ PDF attachment uploaded: ID ${pdfAttachment.id}, name: ${pdfAttachment.file_name}, size: ${pdfAttachment.file_size_bytes}B`);

  // 6. List attachments via BFF
  console.log("\n6. Listing attachments for incident via BFF...");
  const listRes = await fetch(`${BASE_URL}/api/itsm/incidents/${incident.id}/attachments`, {
    headers: { Cookie: cookieHeader },
  });
  console.log(`   List attachments status: ${listRes.status}`);
  if (!listRes.ok) {
    throw new Error(`Failed to list attachments (${listRes.status})`);
  }
  const attachments = await listRes.json();
  console.log(`   ✓ Found ${attachments.length} attachments linked to ticket.`);
  if (attachments.length !== 2) {
    throw new Error(`Expected 2 attachments, found ${attachments.length}`);
  }

  // 7. Download PDF attachment via BFF
  console.log("\n7. Downloading PDF attachment via BFF /api/itsm/attachments/[id]/download...");
  const downloadPdfRes = await fetch(`${BASE_URL}/api/itsm/attachments/${pdfAttachment.id}/download`, {
    headers: { Cookie: cookieHeader },
  });
  console.log(`   Download PDF status: ${downloadPdfRes.status}`);
  if (!downloadPdfRes.ok) {
    throw new Error(`Failed to download PDF (${downloadPdfRes.status})`);
  }
  const downloadedPdfBuffer = Buffer.from(await downloadPdfRes.arrayBuffer());
  if (downloadedPdfBuffer.toString() !== pdfBytes.toString()) {
    throw new Error("Downloaded PDF bytes do not match uploaded bytes");
  }
  console.log("   ✓ PDF downloaded successfully and verified matching uploaded content.");

  // 8. Preview PNG attachment via BFF (with preview=true query param)
  console.log("\n8. Previewing PNG image via BFF /api/itsm/attachments/[id]/download?preview=true...");
  const previewPngRes = await fetch(`${BASE_URL}/api/itsm/attachments/${pngAttachment.id}/download?preview=true`, {
    headers: { Cookie: cookieHeader },
  });
  console.log(`   Preview PNG status: ${previewPngRes.status}`);
  const disposition = previewPngRes.headers.get("content-disposition") || "";
  console.log(`   Content-Disposition: ${disposition}`);
  if (!disposition.includes("inline")) {
    throw new Error(`Expected Content-Disposition to include 'inline', got '${disposition}'`);
  }
  const downloadedPngBuffer = Buffer.from(await previewPngRes.arrayBuffer());
  if (!downloadedPngBuffer.equals(pngBytes)) {
    throw new Error("Preview PNG bytes do not match uploaded bytes");
  }
  console.log("   ✓ PNG preview streamed successfully with inline Content-Disposition.");

  // 9. Service Agent Incident Detail page load
  console.log("\n9. Accessing Service Agent incident detail page...");
  const detailRes = await fetch(`${BASE_URL}/itsm/incidents/${incident.id}`, {
    headers: { Cookie: cookieHeader },
  });
  console.log(`   GET /itsm/incidents/${incident.id} status: ${detailRes.status}`);
  if (detailRes.status !== 200) {
    throw new Error(`Detail page returned status ${detailRes.status}`);
  }
  console.log("   ✓ Incident detail page loaded successfully (200 OK).");

  console.log("\n=== ALL ITSM ATTACHMENT FLOWS VERIFIED SUCCESSFULLY! ===");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

// Test E2E Step 9: Knowledge Governance for Problem & Change Manager
import http from 'node:http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000';

console.log('--- Step 9: Testing Knowledge Governance & Full Article Lifecycle ---');

async function request(url, options = {}) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body, json });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function login(email, password) {
  const res = await request(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email} with status ${res.status}: ${res.body}`);
  }
  const cookies = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(cookies)
    ? cookies.map((c) => c.split(';')[0]).join('; ')
    : cookies ? cookies.split(';')[0] : '';
  return cookieHeader;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  try {
    // 1. Login as Problem and Change Manager
    console.log('\n1. Logging in as Problem and Change Manager...');
    const pcmCookie = await login('processchange@authclaw-lite.demo', 'AuthClawDemo!234');
    assert(!!pcmCookie, 'Obtained session cookie for Process Change Manager');

    // 2. Verify Session Role
    console.log('\n2. Verifying Session Role...');
    const sessionRes = await request(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: pcmCookie },
    });
    assert(sessionRes.status === 200, 'Session endpoint returned 200');
    assert(sessionRes.json?.itsmRole === 'PROCESS_CHANGE_MANAGER', 'User role is PROCESS_CHANGE_MANAGER');

    // 3. Query Knowledge Articles via BFF
    console.log('\n3. Querying Knowledge Articles Queue...');
    const listRes = await request(`${BASE_URL}/api/itsm/knowledge?status=ALL`, {
      headers: { Cookie: pcmCookie },
    });
    assert(listRes.status === 200, 'GET /api/itsm/knowledge returned 200');
    assert(Array.isArray(listRes.json), 'Knowledge list returned an array');
    console.log(`   Found ${listRes.json?.length || 0} existing articles`);

    // 4. Create a new Knowledge Article as PCM
    console.log('\n4. Creating a New Knowledge Article as PCM...');
    const articlePayload = {
      title: 'Disaster Recovery Runbook: Database Multi-Region Failover',
      category: 'Troubleshooting',
      summary: 'Standard operating procedure for orchestrating multi-region failovers during primary cluster disruption.',
      content_markdown: '# Multi-Region Failover Runbook\n\n## Overview\nThis runbook details database promotion steps.\n\n## Steps\n1. Confirm primary outage in telemetry dashboard.\n2. Promote secondary replica to primary.\n3. Validate application connection pooling.',
      keywords: ['disaster-recovery', 'failover', 'database', 'postgres'],
    };

    const createRes = await request(`${BASE_URL}/api/itsm/knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pcmCookie,
      },
      body: articlePayload,
    });
    assert(createRes.status === 201, `POST /api/itsm/knowledge returned 201 Created (got ${createRes.status})`);
    const createdArticle = createRes.json;
    assert(!!createdArticle?.id, 'Created article has an ID');
    assert(createdArticle?.status === 'DRAFT', `Initial status is DRAFT (got ${createdArticle?.status})`);
    assert(createdArticle?.version_number === 1, `Initial version is 1 (got ${createdArticle?.version_number})`);
    assert(createdArticle?.current_published_version === null, 'current_published_version is null');
    assert(createdArticle?.title === articlePayload.title, 'Title matches payload');
    assert(createdArticle?.category === 'Troubleshooting', 'Category is Troubleshooting');

    const articleId = createdArticle?.id;

    // 5. Fetch Article Details & Version History
    console.log('\n5. Fetching Article Detail & Governance Metadata...');
    const detailRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}`, {
      headers: { Cookie: pcmCookie },
    });
    assert(detailRes.status === 200, 'GET /api/itsm/knowledge/{id} returned 200');
    assert(detailRes.json?.id === articleId, 'Detail ID matches');
    assert(detailRes.json?.content_markdown.includes('Confirm primary outage'), 'Content markdown returned correctly');
    assert(Array.isArray(detailRes.json?.versions), 'Versions array is present');
    assert(detailRes.json?.versions.length === 1, `Versions count is 1 (got ${detailRes.json?.versions.length})`);
    assert(detailRes.json?.versions[0].version_number === 1, 'Version 1 recorded in history');

    // 6. Fetch Versions directly via /versions endpoint
    console.log('\n6. Fetching Versions via dedicated endpoint...');
    const versionsRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/versions`, {
      headers: { Cookie: pcmCookie },
    });
    assert(versionsRes.status === 200, 'GET /api/itsm/knowledge/{id}/versions returned 200');
    assert(Array.isArray(versionsRes.json) && versionsRes.json.length >= 1, 'Versions endpoint returned versions array');

    // 7. Edit Article to produce Version 2 (Revision History)
    console.log('\n7. Updating Article (producing Version 2)...');
    const updatePayload = {
      title: 'Disaster Recovery Runbook: Multi-Region Failover (Updated)',
      summary: 'Updated standard operating procedure including DNS TTL checks.',
      change_summary: 'Added Step 4 for Route53 DNS switchover and TTL cache flush verification.',
      content_markdown: '# Multi-Region Failover Runbook (v2)\n\n## Overview\nThis runbook details database promotion steps.\n\n## Steps\n1. Confirm primary outage in telemetry dashboard.\n2. Promote secondary replica to primary.\n3. Validate application connection pooling.\n4. Verify DNS TTL switchover propagated across edge nodes.',
      keywords: ['disaster-recovery', 'failover', 'database', 'postgres', 'dns'],
    };

    const editRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pcmCookie,
      },
      body: updatePayload,
    });
    console.log('   content_markdown value is:', JSON.stringify(editRes.json?.content_markdown));
    assert(editRes.status === 200, `PATCH /api/itsm/knowledge/{id} returned 200 (got ${editRes.status})`);
    assert(editRes.json?.version_number === 2, `New version number is 2 (got ${editRes.json?.version_number})`);
    assert(editRes.json?.title === updatePayload.title, 'Updated title matches');
    assert(editRes.json?.content_markdown?.includes('DNS TTL switchover'), 'Content markdown updated');
    assert(editRes.json?.versions?.length === 2, `Article now has 2 versions (got ${editRes.json?.versions?.length})`);

    // 8. Publish Article
    console.log('\n8. Publishing Article...');
    const publishRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/publish`, {
      method: 'POST',
      headers: { Cookie: pcmCookie },
    });
    assert(publishRes.status === 200, `POST /api/itsm/knowledge/{id}/publish returned 200 (got ${publishRes.status})`);
    assert(publishRes.json?.status === 'PUBLISHED', `Status updated to PUBLISHED (got ${publishRes.json?.status})`);
    assert(publishRes.json?.current_published_version === 2, `current_published_version set to 2 (got ${publishRes.json?.current_published_version})`);
    assert(!!publishRes.json?.published_at, 'published_at timestamp recorded');

    // 9. Verify Requester Visibility
    console.log('\n9. Testing Requester View (Consumer)...');
    const requesterCookie = await login('requester@authclaw-lite.demo', 'AuthClawDemo!234');
    assert(!!requesterCookie, 'Obtained session cookie for Requester');

    const reqListRes = await request(`${BASE_URL}/api/itsm/knowledge`, {
      headers: { Cookie: requesterCookie },
    });
    assert(reqListRes.status === 200, 'Requester GET /api/itsm/knowledge returned 200');
    const foundPublished = reqListRes.json?.find((a) => a.id === articleId);
    assert(!!foundPublished, 'Requester can see published article in knowledge catalog');

    // 10. Archive / Retire Article
    console.log('\n10. Archiving Article as PCM...');
    const archiveRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/archive`, {
      method: 'POST',
      headers: { Cookie: pcmCookie },
    });
    assert(archiveRes.status === 200, `POST /api/itsm/knowledge/{id}/archive returned 200 (got ${archiveRes.status})`);
    assert(archiveRes.json?.status === 'ARCHIVED', `Status updated to ARCHIVED (got ${archiveRes.json?.status})`);

    // 11. Verify Requester no longer sees Archived article in consumer catalog
    console.log('\n11. Verifying Archived article hidden from Requester...');
    const reqListAfterArchive = await request(`${BASE_URL}/api/itsm/knowledge`, {
      headers: { Cookie: requesterCookie },
    });
    const foundArchivedByReq = reqListAfterArchive.json?.find((a) => a.id === articleId);
    assert(!foundArchivedByReq, 'Archived article is hidden from Requester default search');

    // 12. Return Article to Draft
    console.log('\n12. Returning Article to Draft as PCM...');
    const draftRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/draft`, {
      method: 'POST',
      headers: { Cookie: pcmCookie },
    });
    assert(draftRes.status === 200, `POST /api/itsm/knowledge/{id}/draft returned 200 (got ${draftRes.status})`);
    assert(draftRes.json?.status === 'DRAFT', `Status updated to DRAFT (got ${draftRes.json?.status})`);

    // 13. Security / Access Control Enforcement
    console.log('\n13. Testing Security Enforcement against Non-PCM roles...');
    // Requester attempting to create article
    const secCreateRes = await request(`${BASE_URL}/api/itsm/knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: requesterCookie,
      },
      body: { title: 'Unauthorized', category: 'Security', content_markdown: 'Hacked' },
    });
    assert(secCreateRes.status === 403, `Requester create rejected with 403 Forbidden (got ${secCreateRes.status})`);

    // Requester attempting to publish
    const secPublishRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/publish`, {
      method: 'POST',
      headers: { Cookie: requesterCookie },
    });
    assert(secPublishRes.status === 403, `Requester publish rejected with 403 Forbidden (got ${secPublishRes.status})`);

    // Requester attempting to archive
    const secArchiveRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}/archive`, {
      method: 'POST',
      headers: { Cookie: requesterCookie },
    });
    assert(secArchiveRes.status === 403, `Requester archive rejected with 403 Forbidden (got ${secArchiveRes.status})`);

    // Requester attempting to edit
    const secEditRes = await request(`${BASE_URL}/api/itsm/knowledge/${encodeURIComponent(articleId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: requesterCookie,
      },
      body: { title: 'Unauthorized edit' },
    });
    assert(secEditRes.status === 403, `Requester edit rejected with 403 Forbidden (got ${secEditRes.status})`);

    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();

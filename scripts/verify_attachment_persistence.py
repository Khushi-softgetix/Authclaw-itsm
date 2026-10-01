import os
import sys
import time
import requests
import psycopg

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
DB_URL = os.environ.get("DB_URL", "postgresql://authclaw:authclaw@postgres:5432/authclaw")

def get_auth_token(email="itsm-agent@test.com", password="AuthClawDemo!234"):
    resp = requests.post(f"{BASE_URL}/v1/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        raise Exception(f"Login failed: {resp.status_code} {resp.text}")
    data = resp.json()
    return data.get("access_token") or data.get("session_token")

def test_attachment_persistence_e2e():
    print("=== STARTING ITSM ATTACHMENT STORAGE PERSISTENCE VERIFICATION ===")

    token = get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Verify existing restored attachment Screenshot (2).png
    screenshot_id = "d70469c1-fbb2-4ff5-bde2-0268a261aa9b"
    print(f"\n[Test 1] Verifying restored attachment {screenshot_id} (Screenshot (2).png)...")
    res_sc_dl = requests.get(f"{BASE_URL}/v1/itsm/attachments/{screenshot_id}/download", headers=headers)
    assert res_sc_dl.status_code == 200, f"Screenshot download failed: {res_sc_dl.status_code}"
    assert len(res_sc_dl.content) == 258246, f"Screenshot length mismatch: {len(res_sc_dl.content)}"
    print(f"  -> PASS: Screenshot (2).png download HTTP 200, size: {len(res_sc_dl.content)} bytes.")

    res_sc_pv = requests.get(f"{BASE_URL}/v1/itsm/attachments/{screenshot_id}/download?preview=true", headers=headers)
    assert res_sc_pv.status_code == 200, f"Screenshot preview failed: {res_sc_pv.status_code}"
    assert "inline" in res_sc_pv.headers.get("content-disposition", ""), "Disposition must be inline"
    print(f"  -> PASS: Screenshot (2).png preview HTTP 200 with inline disposition.")

    # 2. Upload a new test attachment
    print("\n[Test 2] Uploading new attachment to ticket INC-000011...")
    ticket_id = "aec0de0c-711b-4ec5-ae71-c30386f26320"
    unique_content = f"AuthClaw persistent volume verification at timestamp {time.time()}".encode("utf-8")
    files = {"file": ("persistence_check.txt", unique_content, "text/plain")}

    up_resp = requests.post(f"{BASE_URL}/v1/itsm/incidents/{ticket_id}/attachments", files=files, headers=headers)
    assert up_resp.status_code == 201, f"Upload failed: {up_resp.status_code} {up_resp.text}"
    att_data = up_resp.json()
    new_att_id = att_data["id"]
    tenant_id = att_data["tenant_id"]
    print(f"  -> PASS: Uploaded attachment ID: {new_att_id}")
    print(f"     Checksum SHA256: {att_data['checksum_sha256']}")

    # 3. Verify corresponding row in itsm_attachments database table
    print("\n[Test 3] Verifying database record in public.itsm_attachments...")
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, tenant_id, file_name, file_size_bytes, storage_path, storage_backend, checksum_sha256 "
                "FROM public.itsm_attachments WHERE id = %s",
                (new_att_id,)
            )
            row = cur.fetchone()
            assert row is not None, f"Database row not found for attachment {new_att_id}!"
            db_id, db_tid, db_name, db_size, db_path, db_backend, db_sha = row
            assert str(db_id) == str(new_att_id)
            assert str(db_tid) == str(tenant_id)
            assert db_name == "persistence_check.txt"
            assert db_size == len(unique_content)
            assert db_backend == "LOCAL"
            new_storage_path = db_path
            print(f"  -> PASS: Database record verified (DB ID: {db_id}, backend: {db_backend}, storage_path: {new_storage_path}).")

    # 4. Verify file exists in /app/data/uploads
    print("\n[Test 4] Verifying physical file on /app/data/uploads filesystem...")
    expected_full_path = os.path.join("/app/data/uploads", new_storage_path)
    assert os.path.exists(expected_full_path), f"File not found on disk at {expected_full_path}"
    with open(expected_full_path, "rb") as f:
        disk_content = f.read()
    assert disk_content == unique_content, "Disk content does not match uploaded content!"
    print(f"  -> PASS: File exists at {expected_full_path} with matching content.")

    # 5. Verify download and preview
    print("\n[Test 5] Verifying download and preview endpoints...")
    dl_resp = requests.get(f"{BASE_URL}/v1/itsm/attachments/{new_att_id}/download", headers=headers)
    assert dl_resp.status_code == 200, f"Download failed: {dl_resp.status_code}"
    assert dl_resp.content == unique_content, "Downloaded content mismatch"
    assert "attachment" in dl_resp.headers.get("content-disposition", "")
    print(f"  -> PASS: Download returns HTTP 200 with disposition=attachment.")

    pv_resp = requests.get(f"{BASE_URL}/v1/itsm/attachments/{new_att_id}/download?preview=true", headers=headers)
    assert pv_resp.status_code == 200, f"Preview failed: {pv_resp.status_code}"
    assert pv_resp.content == unique_content, "Previewed content mismatch"
    assert "inline" in pv_resp.headers.get("content-disposition", "")
    print(f"  -> PASS: Preview returns HTTP 200 with disposition=inline.")

    print("\n[OK] PHASE 1 TESTS PASSED! File and DB record are ready for container recreation test.")
    return new_att_id, new_storage_path, unique_content

if __name__ == "__main__":
    test_attachment_persistence_e2e()

import os
import sys
import requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

def get_token(email, password):
    resp = requests.post(f"{BACKEND_URL}/v1/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        raise Exception(f"Failed to authenticate {email}: {resp.status_code} {resp.text}")
    data = resp.json()
    return data.get("session_token") or data.get("access_token")

def main():
    print(f"Connecting to Backend at {BACKEND_URL}...")
    
    # 1. Login as requester and agent
    requester_email = "requester123@gmail.com"
    requester_pwd = "Requester@123"
    agent_email = "itsm-agent@test.com"
    agent_pwd = "AuthClawDemo!234"
    
    requester_token = get_token(requester_email, requester_pwd)
    agent_token = get_token(agent_email, agent_pwd)
    
    req_headers = {"Authorization": f"Bearer {requester_token}"}
    agent_headers = {"Authorization": f"Bearer {agent_token}"}
    
    # 2. Requester creates an incident
    inc_payload = {
        "title": "VPN connection drops every 10 minutes",
        "description": "The VPN fails to stay connected while working from home.",
        "category": "NETWORK",
        "urgency": "MEDIUM",
        "impact": "MEDIUM"
    }
    create_resp = requests.post(f"{BACKEND_URL}/v1/itsm/incidents", json=inc_payload, headers=req_headers)
    assert create_resp.status_code == 201, f"Create incident failed: {create_resp.status_code} {create_resp.text}"
    incident = create_resp.json()
    incident_id = incident["id"]
    ticket_number = incident.get("ticket_number", incident_id)
    print(f"[OK] Created incident {ticket_number} (ID: {incident_id}) with status: {incident['status']}")
    
    # 3. Agent moves NEW -> IN_PROGRESS -> RESOLVED
    agent_work = requests.post(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=agent_headers)
    assert agent_work.status_code == 200, f"Agent in-progress transition failed: {agent_work.status_code} {agent_work.text}"
    print(f"[OK] Agent moved incident to IN_PROGRESS")

    resolve_payload = {
        "status": "RESOLVED",
        "resolution_code": "SOLVED_PERMANENTLY",
        "resolution_summary": "Reset VPN tunnel profile on firewall."
    }
    res_resp = requests.post(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/status", json=resolve_payload, headers=agent_headers)
    assert res_resp.status_code == 200, f"Agent resolve failed: {res_resp.status_code} {res_resp.text}"
    resolved_inc = res_resp.json()
    assert resolved_inc["status"] == "RESOLVED"
    print(f"[OK] Agent resolved incident {ticket_number}. Status is now {resolved_inc['status']}")
    
    # 4. Requester attempts invalid transition: RESOLVED -> CLOSED (Should be 403 Forbidden)
    invalid_trans = requests.post(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/status", json={"status": "CLOSED"}, headers=req_headers)
    assert invalid_trans.status_code in [400, 403], f"Expected 400/403 for requester closing ticket, got {invalid_trans.status_code}"
    print(f"[OK] Requester cannot move ticket to CLOSED directly (HTTP {invalid_trans.status_code})")
    
    # 5. Requester attempts reopen with EMPTY reason (Should be 400 Bad Request)
    empty_reason = requests.post(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS", "status_reason": "   "}, headers=req_headers)
    assert empty_reason.status_code == 400, f"Expected 400 for empty reopen reason, got {empty_reason.status_code}"
    print(f"[OK] Empty reopen reason rejected with 400: {empty_reason.json()['detail']}")
    
    # 6. Another requester attempts to reopen this ticket (Should be 403 Forbidden)
    # Check if we can test with manager or another user if available, or verify caller check
    # 7. Authorized requester reopens the ticket with a valid reason
    reopen_payload = {
        "status": "IN_PROGRESS",
        "status_reason": "VPN still disconnects after 5 minutes of usage."
    }
    reopen_resp = requests.post(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/status", json=reopen_payload, headers=req_headers)
    assert reopen_resp.status_code == 200, f"Reopen failed: {reopen_resp.status_code} {reopen_resp.text}"
    reopened_inc = reopen_resp.json()
    assert reopened_inc["status"] == "IN_PROGRESS", f"Expected IN_PROGRESS, got {reopened_inc['status']}"
    assert reopened_inc.get("resolved_at") is None, "resolved_at should be cleared upon reopen"
    print(f"[OK] Successfully reopened incident {ticket_number}. Status is now: {reopened_inc['status']}")
    
    # 8. Check ticket activities/timeline
    act_resp = requests.get(f"{BACKEND_URL}/v1/itsm/incidents/{incident_id}/activities", headers=req_headers)
    assert act_resp.status_code == 200, f"Failed to get activities: {act_resp.status_code}"
    activities = act_resp.json()
    print("\n--- Incident Activity History ---")
    for a in activities:
        print(f"[{a.get('activity_type')}] {a.get('content')} | diff: {a.get('old_value')} -> {a.get('new_value')}")
    
    reopen_activity = next((a for a in activities if "reopened" in a.get("content", "").lower() or (a.get("old_value") and a["old_value"].get("status") == "RESOLVED" and a.get("new_value") and a["new_value"].get("status") == "IN_PROGRESS")), None)
    assert reopen_activity is not None, f"Reopen activity not found in activities list: {activities}"
    assert "reopened" in reopen_activity["content"].lower() or "vpn still disconnects" in reopen_activity["content"].lower(), f"Content missing reopen context: {reopen_activity['content']}"
    print(f"\n[OK] Specific Reopen Activity verified: {reopen_activity['content']}")
    
    print("\nALL REOPEN TICKET BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    main()

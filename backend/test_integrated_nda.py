import requests
import uuid

API_URL = "http://localhost:8000"

def test_integrated_nda_flow():
    # 1. Login as admin to create a client
    print("--- Phase 1: Login as admin ---")
    login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": "admin@laccis.com",
        "password": "admin123"
    })
    if login_res.status_code != 200:
        print(f"Failed to login as admin: {login_res.text}")
        return
    
    admin_token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    client_email = f"integrated-test-{uuid.uuid4().hex[:6]}@example.com"
    client_name = "Integrated NDA Client"
    
    create_res = requests.post(f"{API_URL}/api/clients/create", headers=headers, json={
        "name": client_name,
        "email": client_email
    })
    
    if create_res.status_code != 200:
        print(f"Failed to create client: {create_res.text}")
        return
    
    client_password = create_res.json()["credentials"]["password"]
    print(f"Created client {client_email} with password {client_password}")

    # 2. Login as the new client - check nda_accepted is False and NDA is shared
    print("\n--- Phase 2: Login as new client ---")
    client_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    
    client_data = client_login_res.json()
    client_token = client_data["token"]
    nda_status = client_data["user"]["nda_accepted"]
    user_id = client_data["user"]["id"]
    print(f"Login success. nda_accepted in user object: {nda_status}")
    
    # 3. Verify NDA is in shared contracts
    print("\n--- Phase 3: Verify NDA in 'From Legal' ---")
    client_headers = {"Authorization": f"Bearer {client_token}"}
    contracts_res = requests.get(f"{API_URL}/api/contracts/from-legal", headers=client_headers)
    contracts = contracts_res.json().get("contracts", [])
    
    nda_contract = next((c for c in contracts if "NDA" in c.get("filename", "").upper() or c.get("document_type") == "NDA"), None)
    
    if not nda_contract:
        print("Error: Standard NDA contract not found in 'From Legal' tab")
        return
    
    print(f"Found NDA contract: {nda_contract['filename']} (ID: {nda_contract['id']})")

    # 4. Accept the NDA contract
    print("\n--- Phase 4: Accept NDA contract ---")
    accept_res = requests.post(f"{API_URL}/api/contracts/accept/{nda_contract['id']}", headers=client_headers)
    print(f"Accept contract response: {accept_res.status_code} - {accept_res.json().get('message')}")

    # 5. Verify user status is now accepted
    print("\n--- Phase 5: Verify nda_accepted is now True ---")
    verify_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    new_nda_status = verify_login_res.json()["user"]["nda_accepted"]
    print(f"Login success. nda_accepted: {new_nda_status}")
    
    if new_nda_status is not True:
        print("Error: nda_accepted should be True after accepting the shared contract")
        return

    print("\n✅ Integrated NDA flow verification successful!")

if __name__ == "__main__":
    test_integrated_nda_flow()

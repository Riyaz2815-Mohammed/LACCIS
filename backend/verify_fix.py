import requests
import uuid
import sys

API_URL = "http://localhost:8000"

def verify_nda_flow():
    print("--- 1. Login as Admin ---")
    login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": "admin@laccis.com",
        "password": "admin123"
    })
    
    if login_res.status_code != 200:
        print(f"FAILED: Admin login failed. Status: {login_res.status_code}")
        print(login_res.text)
        return False
    
    admin_token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    print("SUCCESS: Admin logged in.")

    print("\n--- 2. Create New Client ---")
    client_email = f"nda-verify-{uuid.uuid4().hex[:6]}@example.com"
    client_name = "NDA Verify User"
    
    create_res = requests.post(f"{API_URL}/api/clients/create", headers=headers, json={
        "name": client_name,
        "email": client_email
    })
    
    if create_res.status_code != 200:
        print(f"FAILED: Client creation failed. Status: {create_res.status_code}")
        print(create_res.text)
        return False
    
    client_password = create_res.json()["credentials"]["password"]
    print(f"SUCCESS: Created client {client_email} / {client_password}")

    print("\n--- 3. Login as Client (Trigger Auto-Share) ---")
    client_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    
    if client_login_res.status_code != 200:
        print(f"FAILED: Client login failed. Status: {client_login_res.status_code}")
        print(client_login_res.text)
        return False
    
    client_data = client_login_res.json()
    client_token = client_data["token"]
    client_headers = {"Authorization": f"Bearer {client_token}"}
    
    # Check if nda_accepted is False
    if client_data["user"]["nda_accepted"]:
        print("FAILED: Client already has NDA accepted?!")
        return False
    
    print(f"SUCCESS: Client logged in. nda_accepted: {client_data['user']['nda_accepted']}")

    print("\n--- 4. Verify NDA in Shared Contracts ---")
    contracts_res = requests.get(f"{API_URL}/api/contracts/from-legal", headers=client_headers)
    contracts = contracts_res.json().get("contracts", [])
    
    nda_contract = next((c for c in contracts if "NDA" in c.get("filename", "").upper() or c.get("document_type") == "NDA"), None)
    
    if not nda_contract:
        print("FAILED: NDA not found in 'From Legal'.")
        # Check if any templates exist at all in system
        return False
    
    print(f"SUCCESS: Found NDA: {nda_contract['filename']} (ID: {nda_contract['id']}, Status: {nda_contract['status']})")

    print("\n--- 5. Accept NDA ---")
    accept_res = requests.post(f"{API_URL}/api/contracts/accept/{nda_contract['id']}", headers=client_headers)
    if accept_res.status_code != 200:
        print(f"FAILED: Could not accept NDA. Status: {accept_res.status_code}")
        print(accept_res.text)
        return False
    
    print("SUCCESS: NDA accepted.")

    print("\n--- 6. Verify User Profile Updated ---")
    re_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    
    new_status = re_login_res.json()["user"]["nda_accepted"]
    if not new_status:
        print("FAILED: nda_accepted is still False after acceptance.")
        return False
    
    print(f"SUCCESS: User profile updated. nda_accepted: {new_status}")
    print("\n✅ ALL TESTS PASSED!")
    return True

if __name__ == "__main__":
    verify_nda_flow()

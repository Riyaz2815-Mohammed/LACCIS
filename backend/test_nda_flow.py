import requests
import uuid
import secrets

API_URL = "http://localhost:8000"

def test_nda_flow():
    # 1. Create a new client
    print("--- Phase 1: Create a new client ---")
    admin_auth = {"Authorization": "Bearer " + "YOUR_ADMIN_TOKEN_HERE"} # Need to get this dynamically or via seed
    
    # For testing, let's assume we can login with the seeded admin
    login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": "admin@laccis.com",
        "password": "admin123"
    })
    if login_res.status_code != 200:
        print(f"Failed to login as admin: {login_res.text}")
        return
    
    admin_token = login_res.json()["token"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    client_email = f"test-client-{uuid.uuid4().hex[:6]}@example.com"
    client_name = "Test NDA Client"
    
    create_res = requests.post(f"{API_URL}/api/clients/create", headers=headers, json={
        "name": client_name,
        "email": client_email
    })
    
    if create_res.status_code != 200:
        print(f"Failed to create client: {create_res.text}")
        return
    
    client_password = create_res.json()["credentials"]["password"]
    print(f"Created client {client_email} with password {client_password}")

    # 2. Login as the new client - check nda_accepted is False
    print("\n--- Phase 2: Login as new client ---")
    client_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    
    client_data = client_login_res.json()
    client_token = client_data["token"]
    nda_status = client_data["user"]["nda_accepted"]
    print(f"Login success. nda_accepted: {nda_status}")
    if nda_status is not False:
        print("Error: nda_accepted should be False for new client")
        return

    # 3. Accept NDA
    print("\n--- Phase 3: Accept NDA ---")
    client_headers = {"Authorization": f"Bearer {client_token}"}
    accept_res = requests.post(f"{API_URL}/api/auth/accept-nda", headers=client_headers)
    print(f"Accept NDA response: {accept_res.status_code} - {accept_res.json().get('message')}")

    # 4. Login again - check nda_accepted is True
    print("\n--- Phase 4: Verify nda_accepted is now True ---")
    verify_login_res = requests.post(f"{API_URL}/api/auth/login", json={
        "email": client_email,
        "password": client_password
    })
    new_nda_status = verify_login_res.json()["user"]["nda_accepted"]
    print(f"Login success. nda_accepted: {new_nda_status}")
    if new_nda_status is not True:
        print("Error: nda_accepted should be True after accepting")
        return

    print("\n✅ Mandatory NDA flow verification successful!")

if __name__ == "__main__":
    test_nda_flow()

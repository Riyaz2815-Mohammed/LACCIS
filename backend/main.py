from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import Optional
import secrets
import requests
from datetime import datetime, timedelta
import jwt
import os
import json
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

# ==========================================================
# Load Environment Variables
# ==========================================================
load_dotenv()

DB_USER = os.getenv("user")
DB_PASSWORD = os.getenv("password")
DB_HOST = os.getenv("host")
DB_PORT = os.getenv("port")
DB_NAME = os.getenv("dbname")

EMAILJS_SERVICE_ID = os.getenv("EMAILJS_SERVICE_ID")
EMAILJS_TEMPLATE_ID = os.getenv("EMAILJS_TEMPLATE_ID")
EMAILJS_PUBLIC_KEY = os.getenv("EMAILJS_PUBLIC_KEY")
EMAILJS_PRIVATE_KEY = os.getenv("EMAILJS_PRIVATE_KEY")

# ==========================================================
# FastAPI App
# ==========================================================
app = FastAPI(title="LACCIS API", description="Legal Clause Classification Intelligence System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================================
# Security
# ==========================================================
security = HTTPBearer()
SECRET_KEY = os.getenv("JWT_SECRET")
ALGORITHM = "HS256"

# ==========================================================
# PostgreSQL Connection Helper
# ==========================================================
def get_db_connection():
    try:
        conn = psycopg2.connect(
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME
        )
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return None

# Test DB connection on startup
@app.on_event("startup")
def startup_db_test():
    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        cursor.execute("SELECT NOW();")
        print("✅ Database connected at:", cursor.fetchone())
        cursor.close()
        conn.close()
    else:
        print("⚠️ Database not connected")

# ==========================================================
# File Storage (temporary – DB can replace later)
# ==========================================================
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

USERS_FILE = DATA_DIR / "users.json"
CLIENTS_FILE = DATA_DIR / "clients.json"
LEGAL_TEAM_FILE = DATA_DIR / "legal_team.json"
DOCUMENTS_FILE = DATA_DIR / "documents.json"
UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# ==========================================================
# Utility Functions
# ==========================================================
def load_json(file_path):
    if file_path.exists():
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_json(file_path, data):
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def create_token(user_id, email, role):
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        return jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

# ==========================================================
# Models
# ==========================================================
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ClientCreate(BaseModel):
    name: str
    email: EmailStr

class LegalTeamMemberCreate(BaseModel):
    name: str
    email: EmailStr

class DocumentShare(BaseModel):
    document_id: str
    share_with: str

# ==========================================================
# Default Admin
# ==========================================================
def init_default_users():
    users = load_json(USERS_FILE)
    if not users:
        users.append({
            "id": "admin-1",
            "name": "Legal Team Admin",
            "email": "admin@laccis.com",
            "password": "admin123",
            "role": "admin",
            "created_at": datetime.now().isoformat()
        })
        save_json(USERS_FILE, users)

init_default_users()

# ==========================================================
# Routes
# ==========================================================
@app.get("/")
def root():
    return {"message": "LACCIS API running with PostgreSQL connected"}

@app.post("/api/auth/login")
def login(request: LoginRequest):
    users = load_json(USERS_FILE)
    user = next((u for u in users if u["email"] == request.email), None)

    if not user or user["password"] != request.password:
        raise HTTPException(401, "Invalid credentials")

    token = create_token(user["id"], user["email"], user["role"])

    return {"token": token, "user": user}

@app.post("/api/clients/create")
def create_client(client: ClientCreate, current_user: dict = Depends(verify_token)):
    if current_user["role"] != "admin":
        raise HTTPException(403, "Admins only")

    password = f"LACCIS-{secrets.token_hex(3).upper()}"

    users = load_json(USERS_FILE)
    clients = load_json(CLIENTS_FILE)

    if any(u["email"] == client.email for u in users):
        raise HTTPException(400, "Email exists")

    client_id = f"client-{len(clients)+1}"

    users.append({
        "id": client_id,
        "name": client.name,
        "email": client.email,
        "password": password,
        "role": "client",
        "created_at": datetime.now().isoformat()
    })

    clients.append({
        "id": client_id,
        "name": client.name,
        "email": client.email,
        "created_at": datetime.now().isoformat()
    })

    save_json(USERS_FILE, users)
    save_json(CLIENTS_FILE, clients)

    return {
        "message": "Client created",
        "email": client.email,
        "password": password
    }

@app.get("/api/clients/list")
def list_clients(current_user: dict = Depends(verify_token)):
    if current_user["role"] != "admin":
        raise HTTPException(403, "Admins only")

    return {"clients": load_json(CLIENTS_FILE)}

@app.get("/api/db/test")
def test_database():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(500, "Database not connected")

    cur = conn.cursor()
    cur.execute("SELECT NOW();")
    time = cur.fetchone()

    cur.close()
    conn.close()

    return {"database_time": time}

# ==========================================================
# Run Server
# ==========================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

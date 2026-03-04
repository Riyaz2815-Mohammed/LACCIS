from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, status, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import secrets
import uuid
import requests
import sys
from datetime import datetime, timedelta
import jwt
import os
import json
import asyncio
import io
from pathlib import Path
from dotenv import load_dotenv
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
import psycopg2
from psycopg2 import pool

app = FastAPI(title="LACCIS API", description="Legal Clause Classification Intelligence System")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()
SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"

# Data storage
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)


# Load environment variables                
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
load_dotenv(env_path)
EMAILJS_SERVICE_ID = os.getenv("EMAILJS_SERVICE_ID")
EMAILJS_TEMPLATE_ID = os.getenv("EMAILJS_TEMPLATE_ID")
EMAILJS_PUBLIC_KEY = os.getenv("EMAILJS_PUBLIC_KEY")
EMAILJS_PRIVATE_KEY = os.getenv("EMAILJS_PRIVATE_KEY")

# AWS Configuration
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY", "").strip(' "')
AWS_SECRET_KEY = os.getenv("AWS_SECRET_KEY", "").strip(' "')
AWS_REGION = os.getenv("REGION", "").strip(' "')
BUCKET_NAME = os.getenv("BUCKET_NAME", "").strip(' "')

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL")

# Initialize PostgreSQL Connection Pool
db_pool = None
if DATABASE_URL:
    try:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            1, 20, DATABASE_URL
        )
        print("[DATABASE] PostgreSQL Connection Pool initialized")
    except Exception as e:
        print(f"[ERROR] Database pool initialization failed: {e}")
else:
    print("[DATABASE] DATABASE_URL missing")

# Initialize S3 Client with timeouts to prevent infinite hang
s3_client = boto3.client(
    's3',
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=AWS_REGION,
    config=Config(
        connect_timeout=10,   # 10 sec to establish connection
        read_timeout=30,      # 30 sec to read response
        retries={'max_attempts': 2}
    )
)

# Debug: Print if credentials are loaded
print(f"[AWS/EMAIL] EMAILJS_SERVICE_ID loaded: {bool(EMAILJS_SERVICE_ID)}")
print(f"[AWS/EMAIL] EMAILJS_TEMPLATE_ID loaded: {bool(EMAILJS_TEMPLATE_ID)}")
print(f"[AWS/EMAIL] EMAILJS_PUBLIC_KEY loaded: {bool(EMAILJS_PUBLIC_KEY)}")
print(f"[AWS/EMAIL] AWS_ACCESS_KEY loaded: {bool(AWS_ACCESS_KEY)} | value starts with: {AWS_ACCESS_KEY[:4] if AWS_ACCESS_KEY else 'MISSING'}")
print(f"[AWS/EMAIL] AWS_REGION: {AWS_REGION}")
print(f"[AWS/EMAIL] BUCKET_NAME: {BUCKET_NAME}")

# Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ClientCreate(BaseModel):
    name: str
    email: EmailStr

class LegalTeamMemberCreate(BaseModel):
    name: str
    email: EmailStr

class User(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str  # 'admin' or 'client'

class DocumentUpload(BaseModel):
    document_type: str  # 'NDA', 'MSA', 'SOW', 'Redlined', 'Others'
    shared_with: Optional[str] = None  # client_id or 'admin'
    
class DocumentShare(BaseModel):
    document_id: str
    share_with: str  # client_id or 'admin'

class MessageSend(BaseModel):
    recipient_id: str  # client_id or 'admin'
    content: str

class Message(BaseModel):
    id: str
    sender_id: str
    recipient_id: str
    content: str
    timestamp: str

# Helper functions
def record_activity(user_id: str, client_id: str, action: str, details: str = ""):
    if db_pool:
        conn = None
        try:
            conn = db_pool.getconn()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO activity_log (id, user_id, client_id, action, details, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (f"act-{uuid.uuid4().hex[:8]}", user_id, client_id, action, details, datetime.now())
                )
            conn.commit()
        except Exception as e:
            print(f"[ERROR] record_activity error: {e}")
            if conn: conn.rollback()
        finally:
            if conn: db_pool.putconn(conn)


def create_token(user_id: str, email: str, role: str):
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        print(f"[AUTH] Token verified: {payload.get('email')} | role: {payload.get('role')}")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def send_email(to_email: str, subject: str, body: str):
    """
    Send email via EmailJS REST API
    
    Args:
        to_email: Recipient email address
        subject: Email subject
        body: Email body (HTML format)
    
    Returns:
        dict: {'success': bool, 'message': str}
    """
    try:
        # Check if EmailJS credentials are configured
        if not all([EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY]):
            error_msg = f"EmailJS credentials not configured. SERVICE_ID: {bool(EMAILJS_SERVICE_ID)}, TEMPLATE_ID: {bool(EMAILJS_TEMPLATE_ID)}, PUBLIC_KEY: {bool(EMAILJS_PUBLIC_KEY)}"
            print(f"✗ {error_msg}")
            return {
                'success': False,
                'message': error_msg
            }
        
        # EmailJS API endpoint
        url = "https://api.emailjs.com/api/v1.0/email/send"
        
        # Prepare email data
        email_data = {
            "service_id": EMAILJS_SERVICE_ID,
            "template_id": EMAILJS_TEMPLATE_ID,
            "user_id": EMAILJS_PUBLIC_KEY,
            "accessToken": EMAILJS_PRIVATE_KEY,  # Required for Strict Mode
            "template_params": {
                "to_email": to_email,
                "subject": subject,
                "html_content": body
            }
        }
        
        print(f"📤 Sending email to {to_email} via EmailJS...")
        print(f"   Service: {EMAILJS_SERVICE_ID}")
        print(f"   Template: {EMAILJS_TEMPLATE_ID}")
        
        # Send via EmailJS
        response = requests.post(url, json=email_data, timeout=10)
        
        print(f"   Response Status: {response.status_code}")
        print(f"   Response Body: {response.text}")
        
        if response.status_code == 200:
            print(f"✓ Email sent successfully to {to_email}")
            return {
                'success': True,
                'message': f'Email sent successfully to {to_email}'
            }
        else:
            error_msg = f"EmailJS error: {response.status_code} - {response.text}"
            print(f"✗ {error_msg}")
            return {
                'success': False,
                'message': error_msg
            }
    
    except requests.exceptions.Timeout:
        error_msg = "EmailJS request timeout - check your internet connection"
        print(f"✗ {error_msg}")
        return {'success': False, 'message': error_msg}
    
    except requests.exceptions.RequestException as e:
        error_msg = f"EmailJS request error: {str(e)}"
        print(f"✗ {error_msg}")
        return {'success': False, 'message': error_msg}
    
    except Exception as e:
        error_msg = f"Email error: {str(e)}"
        print(f"✗ {error_msg}")
        return {'success': False, 'message': error_msg}

# Routes

@app.get("/")
def root():
    return {"message": "LACCIS API is running", "version": "1.0.0"}

@app.post("/api/auth/login")
def login(request: LoginRequest):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, name, role, password_hash, nda_accepted FROM users WHERE email = %s", (request.email,))
            user_row = cur.fetchone()
            
        if not user_row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        user_id, email, name, role, password_hash, nda_accepted = user_row
        
        # Direct password comparison
        if password_hash == request.password:
            token = create_token(user_id, email, role)
            record_activity(user_id, user_id, "Logged in")
            
            # If client and NDA not accepted, auto-share if not already shared
            if role == 'client' and not nda_accepted:
                with conn.cursor() as cur:
                    # Check if already shared
                    cur.execute("SELECT 1 FROM shared_contracts WHERE client_id = %s AND (filename ILIKE '%NDA%' OR document_type = 'template')", (user_id,))
                    if not cur.fetchone():
                        # Find the latest NDA template
                        cur.execute("SELECT id, filename, s3_key, file_path, size FROM documents WHERE document_type = 'template' AND (filename ILIKE '%NDA%' OR template_type = 'NDA') ORDER BY uploaded_at DESC LIMIT 1")
                        template = cur.fetchone()
                        if template:
                            tmpl_id, tmpl_filename, tmpl_s3_key, tmpl_file_path, tmpl_size = template
                            sc_id = f"sc-{uuid.uuid4().hex[:8]}"
                            cur.execute(
                                """
                                INSERT INTO shared_contracts (id, filename, document_type, client_id, shared_by, shared_by_email, message, size, status, shared_at, s3_key, file_path)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                (sc_id, tmpl_filename, 'NDA', user_id, 'admin-1', 'admin@laccis.com', 'Standard NDA for your review', tmpl_size, 'pending_review', datetime.now(), tmpl_s3_key, tmpl_file_path)
                            )
                            conn.commit()
                            record_activity('admin-1', user_id, "Auto-shared NDA", tmpl_filename)

            return {
                "token": token,
                "user": {
                    "id": user_id,
                    "name": name,
                    "email": email,
                    "role": role,
                    "nda_accepted": nda_accepted
                }
            }
        raise HTTPException(status_code=401, detail="Invalid credentials")
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Login error: {e}")
        raise HTTPException(status_code=500, detail="Database error during login")
    finally:
        if conn: db_pool.putconn(conn)



@app.post("/api/clients/create")
def create_client(client: ClientCreate, current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Only admins and legal team members can create clients")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")

    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            # Check existence
            cur.execute("SELECT 1 FROM users WHERE email = %s", (client.email,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")

            client_id = f"client-{uuid.uuid4().hex[:8]}"
            random_suffix = secrets.token_hex(3).upper()
            password = f"LACCIS-{random_suffix}"
            created_at = datetime.now()
            
            cur.execute(
                """
                INSERT INTO users (id, name, email, password_hash, role, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (client_id, client.name, client.email, password, "client", created_at)
            )
        conn.commit()
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] create_client database error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        if conn: db_pool.putconn(conn)

    # Load and customize email template
    try:
        template_path = Path("email_template.html")
        if template_path.exists():
            with open(template_path, 'r', encoding='utf-8') as f:
                email_body = f.read()
            email_body = email_body.replace('{CLIENT_NAME}', client.name)
            email_body = email_body.replace('{CLIENT_EMAIL}', client.email)
            email_body = email_body.replace('{CLIENT_PASSWORD}', password)
        else:
            email_body = f"<html><body><h2>Welcome {client.name}</h2><p>Password: {password}</p></body></html>"
    except Exception as e:
        print(f"Error loading template: {e}")
        email_body = f"<html><body><h2>Welcome {client.name}</h2><p>Password: {password}</p></body></html>"
    
    email_res = send_email(client.email, "Your LACCIS Login Credentials", email_body)
    
    return {
        "message": "Client created successfully",
        "client": {"id": client_id, "name": client.name, "email": client.email, "created_at": created_at.isoformat()},
        "email_sent": email_res.get('success', False),
        "email_message": email_res.get('message', ""),
        "credentials": {
            "email": client.email,
            "password": password
        }
    }




@app.post("/api/legal/create")
def create_legal_team_member(member: LegalTeamMemberCreate, current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Only admins and legal team members can create legal team members")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")

    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE email = %s", (member.email,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")

            member_id = f"legal-{uuid.uuid4().hex[:8]}"
            password = secrets.token_urlsafe(12)
            created_at = datetime.now()
            
            cur.execute(
                """
                INSERT INTO users (id, name, email, password_hash, role, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (member_id, member.name, member.email, password, "legal_team", created_at)
            )
        conn.commit()
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] create_legal_team_member database error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        if conn: db_pool.putconn(conn)

    # Send email with credentials
    email_body = f"<html><body><h2>Welcome {member.name}</h2><p>Password: {password}</p></body></html>"
    email_res = send_email(member.email, "LACCIS Legal Team Account", email_body)
    
    return {
        "message": "Legal team member created successfully",
        "member": {"id": member_id, "name": member.name, "email": member.email, "created_at": created_at.isoformat()},
        "email_sent": email_res.get('success', False),
        "credentials": {
            "email": member.email,
            "password": password
        }
    }



@app.get("/api/legal/list")
def list_legal_team(current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ["admin", "client", "legal_team"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            if current_user["role"] == "admin":
                cur.execute("SELECT id, name, email, created_at FROM users WHERE role = 'legal_team'")
                rows = cur.fetchall()
                members = [{"id": r[0], "name": r[1], "email": r[2], "created_at": r[3].isoformat() if r[3] else None} for r in rows]
            else:
                cur.execute("SELECT id, name, email FROM users WHERE role IN ('legal_team', 'admin')")
                rows = cur.fetchall()
                members = [{"id": r[0], "name": r[1], "email": r[2]} for r in rows]
            return {"members": members}
    except Exception as e:
        print(f"[ERROR] list_legal_team error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)


@app.delete("/api/legal/delete/{member_id}")
def delete_legal_team_member(member_id: str, current_user: dict = Depends(verify_token)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s AND role = 'legal_team'", (member_id,))
        conn.commit()
        return {"message": "Legal team member deleted successfully"}
    except Exception as e:
        print(f"[ERROR] delete_legal_team_member error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)


@app.get("/api/clients/list")
def list_clients(current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, email, created_at FROM users WHERE role = 'client'")
            rows = cur.fetchall()
            clients = [{"id": r[0], "name": r[1], "email": r[2], "created_at": r[3].isoformat() if r[3] else None} for r in rows]
            return {"clients": clients}
    except Exception as e:
        print(f"[ERROR] list_clients error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)



@app.delete("/api/clients/delete/{client_id}")
def delete_client(client_id: str, current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            # 1. Get all documents for this client to delete from S3
            cur.execute("SELECT s3_key, file_path FROM documents WHERE user_id = %s", (client_id,))
            docs = cur.fetchall()
            
            # 2. Cleanup S3 and local files
            for s3_key, file_path in docs:
                if s3_key:
                    try:
                        s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
                    except Exception as e:
                        print(f"[ERROR] S3 cleanup error: {e}")
                if file_path:
                    try:
                        fp = Path(file_path)
                        if fp.exists(): fp.unlink()
                    except Exception as e:
                        print(f"[ERROR] Local file cleanup error: {e}")

            # 3. DB cleanup - Cascade should handle it if set, but we do it explicitly to handle clauses
            cur.execute("DELETE FROM clauses WHERE document_id IN (SELECT id FROM documents WHERE user_id = %s)", (client_id,))
            cur.execute("DELETE FROM documents WHERE user_id = %s", (client_id,))
            cur.execute("DELETE FROM users WHERE id = %s", (client_id,))
        conn.commit()
        return {"message": "Client and associated documents deleted successfully"}
    except Exception as e:
        print(f"[ERROR] delete_client database error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)



def trigger_extraction(file_name: str, document_type: str = "Unknown", source: str = "unknown"):
    """Background task: perform extraction and classification locally.

    Args:
        file_name     : saved filename under data/uploads/
        document_type : e.g. "NDA", "MSA", "SOW" — stored in every clause record
        source        : "client" or "legal" — who uploaded the document
    """
    try:
        # Ensure extracter directory is in sys.path
        backend_dir = Path(__file__).parent
        project_root = backend_dir.parent
        extracter_dir = project_root / "extracter"

        if str(extracter_dir) not in sys.path:
            sys.path.append(str(extracter_dir))

        # Import extraction logic (lazy import to resolve at runtime)
        from extract import extract_text_from_file
        from clause_engine import parse_text_file, process_document

        # Local path for the file (it's already saved in UPLOADS_DIR)
        local_path = UPLOADS_DIR / file_name
        if not local_path.exists():
            print(f"[ERROR] [Background] File not found for extraction at {local_path}")
            return

        print(f"[INFO] [Background] Starting extraction for {file_name} (doc={document_type}, src={source})...")

        # 1. Extract text (PDF, DOCX, TXT)
        extracted_text = extract_text_from_file(str(local_path))

        # 2. Parse text blocks using temp files on disk to preserve RAM
        import tempfile
        import os
        
        # Write to a temporary file locally so clause_engine can perfectly parse it with \n newlines
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', delete=False, suffix='.txt') as temp_out:
            temp_out.write(extracted_text)
            temp_file_path = temp_out.name
            
        try:
            extracted_blocks = parse_text_file(temp_file_path)
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)

        # 3. Classify — pass document type and source so every clause record is fully tagged
        results = process_document(extracted_blocks, document=document_type, source=source)

        # (JSON storage was removed per user request, DB storage only)
        
        # 4. Insert into clauses table and run vector pipeline
        conn = None
        try:
            if db_pool:
                conn = db_pool.getconn()
                with conn.cursor() as cur:
                    # Find corresponding document_id by s3_key matching file_name
                    cur.execute("SELECT id FROM documents WHERE s3_key = %s LIMIT 1", (file_name,))
                    doc_res = cur.fetchone()
                    document_id = doc_res[0] if doc_res else None
                    
                    # Group clauses by type before insertion
                    merged_clauses = {}
                    for clause in results:
                        ctype = clause.get("clause", "Unknown")
                        ccontent = clause.get("content", "").strip()
                        cpage = clause.get("page_number", 1)
                        
                        if ctype not in merged_clauses:
                            merged_clauses[ctype] = {
                                "clause_id": clause.get("clause_id") or f"CLZ-{uuid.uuid4().hex[:8].upper()}",
                                "clause": ctype,
                                "content_id": clause.get("content_id") or f"CNT-{uuid.uuid4().hex[:8].upper()}",
                                "content": ccontent,
                                "page_number": cpage
                            }
                        else:
                            # Append to existing clause of the same type
                            merged_clauses[ctype]["content"] += "\n\n" + ccontent
                            
                    # Update results to reflect the merged clauses for the vector pipeline
                    results = list(merged_clauses.values())
                    
                    for clause in results:
                        cur.execute(
                            """
                            INSERT INTO clauses (clause_id, clause, content_id, content, page_number, document, source, document_id)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (content_id) DO NOTHING
                            """,
                            (
                                clause["clause_id"],
                                clause["clause"],
                                clause["content_id"],
                                clause["content"],
                                clause["page_number"],
                                document_type,
                                source,
                                document_id
                            )
                        )
                conn.commit()
                print(f"[SUCCESS] [Background] Saved {len(results)} clauses to database")
                
        except Exception as db_err:
            print(f"[ERROR] [Background] Failed to save clauses format: {db_err}")
            if conn: conn.rollback()
            import traceback
            traceback.print_exc()
        finally:
            if conn: 
                db_pool.putconn(conn)
                conn = None # Prevent reuse below
                
        # ------ NEW INTEGRATION: Vector Pipeline ------
        # Run independent of the DB transaction. If this crashes, the clauses are still safely saved!
        try:
            if source == "legal":
                # For standard templates, refresh the ChromaDB so it includes the new clauses
                from vector_pipeline.embeddings.embed_store import run_embed_pipeline
                print(f"[INFO] [Background] Document '{file_name}' is a standard template. Updating ChromaDB...")
                run_embed_pipeline()
                print(f"[SUCCESS] [Background] ChromaDB updated with new standard template clauses.")
            
            elif source == "client" and document_id:
                # For client documents, process each clause against the ChromaDB standard templates
                from vector_pipeline.pipeline.full_pipeline import run_pipeline
                print(f"[INFO] [Background] Document '{file_name}' is a client document. Running vector review pipeline...")
                
                final_reviews = []
                for clause in results:
                    client_text = clause.get("content", "")
                    clause_type = clause.get("clause", "Unknown")
                    
                    # Only analyze clauses with meaningful text
                    if len(client_text.strip()) > 10:
                        
                        # Skip SBERT pipeline for structural blocks that have no standard equivalent
                        if clause_type in ("Header", "Other"):
                            final_reviews.append({
                                "content_id": clause.get("content_id"),
                                "clause_id": clause.get("clause_id"),
                                "clause_type": clause_type,
                                "content": client_text,
                                "page_number": clause.get("page_number", 1),
                                "risk": "low",
                                "similarity_score": None,
                                "matched_clause": None,
                                "llm_reasoning": None,
                                "status": "pending"
                            })
                            continue
                        
                        # Run pipeline: retrieves top K similar standard clauses, scores them, tags risk, runs LLM if high risk
                        pipeline_results = run_pipeline(
                            query_text=client_text, 
                            clause_type=clause_type,
                            document_type=document_type
                        )
                        
                        # Grab the best match from the pipeline (sorted by similarity desc)
                        best_match = pipeline_results[0] if pipeline_results else None
                        
                        # Map backend pipeline results perfectly to exactly what ClauseReview.jsx expects
                        if best_match:
                            review_entry = {
                                "content_id": clause.get("content_id"),
                                "clause_id": clause.get("clause_id"),
                                "clause_type": clause_type,
                                "content": client_text,
                                "page_number": clause.get("page_number", 1),
                                "risk": best_match.get("final_risk", "High"),
                                "similarity_score": best_match.get("sbert_similarity"),
                                "matched_clause": {
                                    "content": best_match.get("template_content"),
                                    "document_type": best_match.get("template_metadata", {}).get("document_type", "Template")
                                },
                                "llm_reasoning": best_match.get("llm_reasoning"),
                                "status": "pending"
                            }
                        else:
                            review_entry = {
                                "content_id": clause.get("content_id"),
                                "clause_id": clause.get("clause_id"),
                                "clause_type": clause_type,
                                "content": client_text,
                                "page_number": clause.get("page_number", 1),
                                "risk": "High",
                                "similarity_score": 0.0,
                                "matched_clause": None,
                                "status": "pending"
                            }
                        final_reviews.append(review_entry)
                    else:
                        # Skip tiny lines/headers
                        final_reviews.append({
                            "content_id": clause.get("content_id"),
                            "clause_id": clause.get("clause_id"),
                            "clause_type": clause_type,
                            "content": client_text,
                            "page_number": clause.get("page_number", 1),
                            "risk": "Low",
                            "similarity_score": None,
                            "matched_clause": None,
                            "status": "pending"
                        })

                # Save the complete review JSON for the legal team's dashboard
                reviews_dir = DATA_DIR / "reviews"
                reviews_dir.mkdir(parents=True, exist_ok=True)
                review_path = reviews_dir / f"{document_id}.json"
                
                with open(review_path, "w", encoding="utf-8") as f:
                    json.dump(final_reviews, f, indent=4)
                    
                # [NEW] Save to PostgreSQL document_reviews table
                try:
                    if db_pool:
                        temp_conn = db_pool.getconn()
                        try:
                            with temp_conn.cursor() as cur:
                                cur.execute(
                                    """
                                    INSERT INTO document_reviews (document_id, review_data)
                                    VALUES (%s, %s)
                                    ON CONFLICT (document_id) DO UPDATE 
                                    SET review_data = EXCLUDED.review_data, created_at = NOW()
                                    """,
                                    (document_id, json.dumps(final_reviews))
                                )
                            temp_conn.commit()
                        finally:
                            db_pool.putconn(temp_conn)
                except Exception as db_err:
                    print(f"[ERROR] [Background] Failed to save review to DB: {db_err}")
                
                print(f"[SUCCESS] [Background] Vector review pipeline complete. Saved to {review_path} and DB.")
                
        except Exception as vector_err:
            print(f"[ERROR] [Background] Vector pipeline failed: {vector_err}")
            import traceback
            traceback.print_exc()
        # ----------------------------------------------

        # Update document status to 'completed' in PostgreSQL
        if document_id and db_pool:
            update_conn = None
            try:
                update_conn = db_pool.getconn()
                with update_conn.cursor() as cur:
                    cur.execute("UPDATE documents SET status = 'completed' WHERE id = %s", (document_id,))
                update_conn.commit()
                print(f"[SUCCESS] [Background] Document status marked as 'completed' for {document_id}")
            except Exception as e:
                print(f"[ERROR] [Background] Failed to update document status: {e}")
                if update_conn: update_conn.rollback()
            finally:
                if update_conn: db_pool.putconn(update_conn)

        print(f"[SUCCESS] [Background] Classification complete for {file_name}: {len(results)} clauses processed.")
    except Exception as e:
        import traceback
        print(f"[ERROR] [Background] Extraction failed for {file_name}: {str(e)}")
        print(traceback.format_exc())

@app.post("/api/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type: str = "Others",
    shared_with: Optional[str] = None,
    current_user: dict = Depends(verify_token)
):
    # All document types are allowed without restriction
    print(f"📄 User {current_user['user_id']} uploading {document_type}")
    
    # Save file
    file_name = f"{current_user['user_id']}_{file.filename}"
    file_path = UPLOADS_DIR / file_name
    
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # Upload to S3 (run in thread pool to avoid blocking the async event loop)
    try:
        if not AWS_ACCESS_KEY or not AWS_SECRET_KEY or not BUCKET_NAME:
            raise ValueError(f"Missing AWS config — KEY:{bool(AWS_ACCESS_KEY)} SECRET:{bool(AWS_SECRET_KEY)} BUCKET:{bool(BUCKET_NAME)}")
        print(f"[AWS] Uploading {file_name} to S3 bucket: {BUCKET_NAME} (region: {AWS_REGION})...")
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=file_name,
                    Body=content
                )
            ),
            timeout=30  # give up after 30 seconds
        )
        print(f"[SUCCESS] Successfully uploaded to S3")
        s3_url = f"https://{BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{file_name}"
    except asyncio.TimeoutError:
        print(f"[ERROR] S3 Upload timed out after 30s — check bucket region/permissions")
        s3_url = None
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']
        print(f"[ERROR] S3 Upload Error [{error_code}]: {error_msg}")
        s3_url = None
    except Exception as e:
        print(f"[ERROR] S3 Upload Unexpected Error: {type(e).__name__}: {e}")
        s3_url = None
    # Get users to share with automatically if uploaded by client
    final_shared_with = list(shared_with) if shared_with else []
    
    if current_user["role"] == "client" and db_pool:
        temp_conn = None
        try:
            temp_conn = db_pool.getconn()
            with temp_conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE role IN ('admin', 'legal_team')")
                admin_ids = [row[0] for row in cur.fetchall()]
                for admin_id in admin_ids:
                    if admin_id not in final_shared_with:
                        final_shared_with.append(admin_id)
        except Exception as e:
            print(f"[ERROR] Failed to fetch admins for auto-share: {e}")
        finally:
            if temp_conn: db_pool.putconn(temp_conn)

    # Determine status based on document type
    status = "pending" if document_type.startswith("NDA") else "uploaded"
    doc_uuid = f"doc-{uuid.uuid4().hex[:8]}"
    
    new_doc = {
        "id": doc_uuid,
        "filename": file.filename,
        "document_type": document_type,
        "user_id": current_user["user_id"],
        "user_email": current_user["email"],
        "user_role": current_user["role"],
        "size": len(content),
        "status": status,
        "shared_with": final_shared_with,
        "uploaded_at": datetime.now(),
        "file_path": str(file_path),
        "s3_url": s3_url,
        "s3_key": file_name
    }
    
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (id, filename, document_type, user_id, user_email, user_role, size, status, shared_with, uploaded_at, file_path, s3_url, s3_key)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (new_doc["id"], new_doc["filename"], new_doc["document_type"], new_doc["user_id"], new_doc["user_email"], new_doc["user_role"], new_doc["size"], new_doc["status"], json.dumps(new_doc["shared_with"]), new_doc["uploaded_at"], new_doc["file_path"], new_doc["s3_url"], new_doc["s3_key"])
            )
        conn.commit()
    except Exception as e:
        print(f"[ERROR] Database document upload error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail="Failed to save metadata")
    finally:
        if conn: db_pool.putconn(conn)

    # Record activity
    record_activity(
        user_id=current_user["user_id"],
        client_id=current_user["user_id"] if current_user["role"] == "client" else (shared_with or "admin"),
        action="Uploaded document",
        details=f"Document: {file.filename} ({document_type})"
    )
    
    # Trigger automated extraction in background (Skip for Redlined)
    source = "client" if current_user["role"] == "client" else "legal"
    if s3_url:
        is_redlined = "Redlined" in document_type or "(Redlined)" in document_type
        if is_redlined:
            print(f"📄 [SKIP] Extraction skipped for redlined document: {file_name}")
        else:
            background_tasks.add_task(trigger_extraction, file_name, document_type, source)
    
    return {
        "message": "Document uploaded and queued for extraction",
        "document": new_doc
    }


@app.get("/api/documents/analysis/{document_id}")
def get_document_analysis(document_id: str, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT id, filename, document_type, user_id, user_email, user_role, size, status, shared_with, uploaded_at, file_path, s3_url, s3_key FROM documents WHERE id = %s", (document_id,))
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
                
            doc = {
                "id": row[0], "filename": row[1], "document_type": row[2], "user_id": row[3],
                "user_email": row[4], "user_role": row[5], "size": row[6], "status": row[7],
                "shared_with": row[8], "uploaded_at": row[9].isoformat() if row[9] else None,
                "file_path": row[10], "s3_url": row[11], "s3_key": row[12]
            }
            # Query clauses from database
            cur.execute(
                "SELECT clause_id, clause, content_id, content, page_number FROM clauses WHERE document_id = %s ORDER BY page_number ASC",
                (document_id,)
            )
            clause_rows = cur.fetchall()
            
            if not clause_rows:
                return {"document": doc, "clauses": [], "status": "processing"}
                
            clauses_data = [
                {
                    "clause_id": r[0],
                    "clause": r[1],
                    "content_id": r[2],
                    "content": r[3],
                    "page_number": r[4]
                }
                for r in clause_rows
            ]
            
            return {"document": doc, "clauses": clauses_data, "status": "complete"}
                
    except HTTPException:
        # Re-raise HTTP exceptions directly
        raise
    except Exception as e:
        print(f"[ERROR] Database analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)


@app.get("/api/documents/download/{document_id}")
def download_document(document_id: str, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT s3_key FROM documents WHERE id = %s", (document_id,))
            res = cur.fetchone()
            if not res:
                raise HTTPException(status_code=404, detail="Document not found")
            s3_key = res[0]
    except Exception as e:
        print(f"[ERROR] Database download fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)
        
    if not s3_key:
        raise HTTPException(status_code=400, detail="File not on S3")
        
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': s3_key},
            ExpiresIn=3600
        )
        return {"download_url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"S3 Error: {str(e)}")


@app.post("/api/documents/share")
def share_document(share_request: DocumentShare, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            # Fetch document
            cur.execute("SELECT id, filename, user_id, shared_with FROM documents WHERE id = %s", (share_request.document_id,))
            doc_row = cur.fetchone()
            if not doc_row:
                raise HTTPException(status_code=404, detail="Document not found")
            
            doc_id, filename, doc_user_id, shared_with_db = doc_row
            
            # Update shared_with list
            shared_with = shared_with_db if isinstance(shared_with_db, list) else []
            if share_request.share_with not in shared_with:
                shared_with.append(share_request.share_with)
                cur.execute("UPDATE documents SET shared_with = %s WHERE id = %s", (shared_with, share_request.document_id))
                conn.commit()
            
            # Notify recipient
            cur.execute("SELECT email FROM users WHERE id = %s", (share_request.share_with,))
            user_res = cur.fetchone()
            if user_res:
                recipient_email = user_res[0]
                email_body = f"<html><body><h2>Document Shared</h2><p>{filename} shared by {current_user['email']}</p></body></html>"
                send_email(recipient_email, "Document Shared - LACCIS", email_body)

            return {"message": "Document shared successfully", "document": {"id": doc_id, "filename": filename, "user_id": doc_user_id, "shared_with": shared_with}}
    except Exception as e:
        print(f"[ERROR] Database share error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)


@app.post("/api/documents/approve/{document_id}")
def approve_document(document_id: str, current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool: raise HTTPException(status_code=500, detail="Database not connected")
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT user_id, filename, document_type FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc: raise HTTPException(status_code=404, detail="Document not found")
            
            doc_user_id, filename, document_type = doc
            
            cur.execute("UPDATE documents SET status = 'approved', approved_at = %s, approved_by = %s WHERE id = %s", (datetime.now(), current_user["user_id"], document_id))
            
            record_activity(current_user["user_id"], doc_user_id, "Approved document", f"Document: {filename}")
            
            cur.execute("SELECT email FROM users WHERE id = %s", (doc_user_id,))
            user_res = cur.fetchone()
            if user_res:
                send_email(user_res[0], f"{document_type} Approved", f"<html><body><p>{filename} approved!</p></body></html>")
        conn.commit()
        return {"message": "Document approved"}
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Database approve error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)

@app.post("/api/documents/reject/{document_id}")
def reject_document(document_id: str, current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT user_id, filename, document_type FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            user_id, filename, document_type = doc
            
            cur.execute(
                "UPDATE documents SET status = 'rejected', rejected_at = %s, rejected_by = %s WHERE id = %s",
                (datetime.now(), current_user["user_id"], document_id)
            )
            
            # Record activity
            record_activity(current_user["user_id"], user_id, "Rejected document", f"Document: {filename}")
            
            cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
            email_row = cur.fetchone()
            if email_row:
                send_email(email_row[0], f"{document_type} Update", f"<html><body><p>{filename} rejected.</p></body></html>")
        
        conn.commit()
        return {"message": "Document rejected"}
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Reject error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)


@app.get("/api/documents/list")
def list_documents(current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            if current_user["role"] in ("admin", "legal_team"):
                cur.execute("SELECT id, user_id, filename, document_type, status, uploaded_at, s3_key, size, shared_with FROM documents ORDER BY uploaded_at DESC")
            else:
                cur.execute("SELECT id, user_id, filename, document_type, status, uploaded_at, s3_key, size, shared_with FROM documents WHERE user_id = %s OR shared_with @> %s::jsonb ORDER BY uploaded_at DESC", (current_user["user_id"], json.dumps([current_user["user_id"]])))
            rows = cur.fetchall()
            return {"documents": [{"id": r[0], "user_id": r[1], "filename": r[2], "document_type": r[3], "status": r[4], "uploaded_at": r[5].isoformat() if r[5] else None, "s3_key": r[6], "size": r[7], "shared_with": r[8]} for r in rows]}
    except Exception as e:
        print(f"[ERROR] list_documents error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    finally: db_pool.putconn(conn)



@app.get("/api/documents/stats")
def document_stats(current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ("admin", "legal_team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM documents")
            row = cur.fetchone()
            return {"total_documents": row[0], "total_size": row[1]}
    except Exception as e:
        print(f"[ERROR] Stats error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    finally:
        if conn: db_pool.putconn(conn)


@app.post("/api/messages/send")
def send_message(msg: MessageSend, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    conn = None
    try:
        conn = db_pool.getconn()
        msg_id = f"msg-{uuid.uuid4().hex[:8]}"
        with conn.cursor() as cur:
            cur.execute("INSERT INTO messages (id, sender_id, recipient_id, content, timestamp) VALUES (%s, %s, %s, %s, %s)", 
                        (msg_id, current_user["user_id"], msg.recipient_id, msg.content, datetime.now()))
        conn.commit()
        print(f"✓ [CHAT] Message sent: From {current_user['user_id']} To {msg.recipient_id}")
        return {"message": "Message sent", "data": {"id": msg_id, "sender_id": current_user["user_id"], "recipient_id": msg.recipient_id, "content": msg.content, "timestamp": datetime.now().isoformat()}}
    except Exception as e:
        print(f"[ERROR] Database message send error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)


@app.get("/api/messages/list/{other_user_id}")
def list_messages(other_user_id: str, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    conn = None
    try:
        conn = db_pool.getconn()
        user_id = current_user.get("user_id")
        with conn.cursor() as cur:
            cur.execute("SELECT id, sender_id, recipient_id, content, timestamp FROM messages WHERE (sender_id = %s AND recipient_id = %s) OR (sender_id = %s AND recipient_id = %s) ORDER BY timestamp ASC",
                        (user_id, other_user_id, other_user_id, user_id))
            rows = cur.fetchall()
            return {"messages": [{"id": r[0], "sender_id": r[1], "recipient_id": r[2], "content": r[3], "timestamp": r[4].isoformat()} for r in rows]}
    except Exception as e:
        print(f"[ERROR] Database message list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn: db_pool.putconn(conn)



@app.on_event("startup")
def startup_event():
    # Deferring model loading to avoid blocking startup on limited CPU/Network
    # load_model()
    print("[INFO] Application startup complete - Model will be loaded on first use")
@app.post("/api/contracts/share-with-client")
async def share_contract_with_client(file: UploadFile = File(...), client_id: str = Form(""), message: Optional[str] = Form(None), current_user: dict = Depends(verify_token)):
    print(f"[SHARE] Role: {current_user.get('role')} | User: {current_user.get('email')} | ClientID: {client_id}")
    if current_user["role"] not in ["admin", "legal_team"]:
        print(f"✗ [SHARE] 403: Role {current_user['role']} not authorized")
        raise HTTPException(status_code=403)
    content = await file.read()
    file_name = f"shared_{uuid.uuid4().hex[:6]}_{file.filename}"
    file_path = UPLOADS_DIR / file_name
    with open(file_path, "wb") as f: f.write(content)
    s3_key = None
    try:
        s3_client.put_object(Bucket=BUCKET_NAME, Key=file_name, Body=content)
        s3_key = file_name
    except Exception as e: print(f"S3 error: {e}")
    contract_id = f"sc-{uuid.uuid4().hex[:8]}"
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO shared_contracts (id, filename, shared_by, shared_by_email, client_id, message, status, shared_at, s3_key, file_path) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (contract_id, file.filename, current_user["user_id"], current_user.get("email", ""), client_id, message, 'pending_review', datetime.now(), s3_key, str(file_path)))
            conn.commit()
            record_activity(current_user["user_id"], client_id, "Shared contract", file.filename)
            return {"message": "Shared", "id": contract_id}
    finally: db_pool.putconn(conn)

@app.get("/api/contracts/from-legal")
def get_contracts_from_legal(current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, filename, document_type, shared_by, shared_by_email, message, size, status, shared_at, s3_key FROM shared_contracts WHERE client_id = %s ORDER BY shared_at DESC", (current_user["user_id"],))
            rows = cur.fetchall()
            return {"contracts": [{"id": r[0], "filename": r[1], "document_type": r[2], "shared_by": r[3], "shared_by_email": r[4], "message": r[5], "size": r[6] or 0, "status": r[7], "shared_at": r[8].isoformat() if r[8] else None, "s3_key": r[9]} for r in rows]}
    finally: db_pool.putconn(conn)

@app.post("/api/contracts/accept/{contract_id}")
def accept_shared_contract(contract_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE shared_contracts SET status = 'accepted', accepted_at = %s WHERE id = %s AND client_id = %s RETURNING filename", (datetime.now(), contract_id, current_user["user_id"]))
            row = cur.fetchone()
            if row:
                filename = row[0]
                # If it's an NDA, update user profile
                if "NDA" in filename.upper():
                    cur.execute("UPDATE users SET nda_accepted = TRUE, nda_accepted_at = %s WHERE id = %s", (datetime.now(), current_user["user_id"]))
                
                conn.commit()
                record_activity(current_user["user_id"], current_user["user_id"], "Accepted contract", filename)
                return {"message": "Accepted"}
            raise HTTPException(status_code=404)
    finally: db_pool.putconn(conn)

@app.post("/api/contracts/reject/{contract_id}")
def reject_shared_contract(contract_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE shared_contracts SET status = 'rejected' WHERE id = %s AND client_id = %s RETURNING filename", (contract_id, current_user["user_id"]))
            row = cur.fetchone()
            if row:
                conn.commit()
                record_activity(current_user["user_id"], current_user["user_id"], "Rejected contract", row[0])
                return {"message": "Rejected"}
            raise HTTPException(status_code=404)
    finally: db_pool.putconn(conn)



@app.get("/api/activity/list")
def list_activities(client_id: Optional[str] = None, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            if current_user["role"] == "client":
                cur.execute("SELECT id, user_id, client_id, action, details, timestamp FROM activity_log WHERE client_id = %s ORDER BY timestamp DESC LIMIT 100", (current_user["user_id"],))
            elif client_id:
                cur.execute("SELECT id, user_id, client_id, action, details, timestamp FROM activity_log WHERE client_id = %s ORDER BY timestamp DESC LIMIT 100", (client_id,))
            else:
                cur.execute("SELECT id, user_id, client_id, action, details, timestamp FROM activity_log ORDER BY timestamp DESC LIMIT 100")
            rows = cur.fetchall()
            return {"activities": [{"id": r[0], "user_id": r[1], "client_id": r[2], "action": r[3], "details": r[4], "timestamp": r[5].isoformat()} for r in rows]}
    finally: db_pool.putconn(conn)



@app.get("/api/contracts/download/{contract_id}")
def download_shared_contract(contract_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s3_key, client_id, file_path, filename FROM shared_contracts WHERE id = %s", (contract_id,))
            res = cur.fetchone()
            if not res: raise HTTPException(status_code=404)
            if current_user["role"] == "client" and res[1] != current_user["user_id"]: raise HTTPException(status_code=403)
            s3_key = res[0]
            if s3_key:
                try:
                    url = s3_client.generate_presigned_url('get_object', Params={'Bucket': BUCKET_NAME, 'Key': s3_key}, ExpiresIn=3600)
                    return {"download_url": url}
                except: pass
            fp = Path(res[2] or "")
            if fp.exists(): return FileResponse(path=str(fp), filename=res[3])
            raise HTTPException(status_code=404)
    finally: db_pool.putconn(conn)


@app.post("/api/templates/upload")
async def upload_template(background_tasks: BackgroundTasks, file: UploadFile = File(...), template_type: str = Form(...), current_user: dict = Depends(verify_token)):
    if current_user["role"] not in ["admin", "legal_team"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    content = await file.read()
    file_name = f"template_{uuid.uuid4().hex[:8]}_{file.filename}"
    file_path = UPLOADS_DIR / file_name
    
    # Save locally first
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Upload to S3
    s3_url = None
    try:
        s3_client.put_object(Bucket=BUCKET_NAME, Key=file_name, Body=content)
        s3_url = f"https://{BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{file_name}"
        print(f"[S3] Template {file_name} uploaded successfully")
    except Exception as e:
        print(f"[ERROR] [S3] Template upload failed: {e}")
    
    tmpl_id = f"tmpl-{uuid.uuid4().hex[:8]}"
    conn = None
    try:
        if not db_pool:
            raise HTTPException(status_code=500, detail="Database not connected")
        
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            # Metadata consistent with documents table
            cur.execute(
                """
                INSERT INTO documents (id, filename, document_type, template_type, user_id, user_email, user_role, size, status, shared_with, uploaded_at, s3_key, s3_url, file_path)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tmpl_id, file.filename, 'template', template_type, 
                    current_user["user_id"], current_user.get("email", ""), current_user.get("role", "admin"),
                    len(content), 'uploaded', json.dumps([]), datetime.now(),
                    file_name, s3_url, str(file_path)
                )
            )
            conn.commit()
            
            # Record activity
            record_activity(current_user["user_id"], "admin", "Uploaded standard template", f"Type: {template_type}")
            
            # Trigger extraction in background
            background_tasks.add_task(trigger_extraction, file_name, template_type, "legal")
            
            return {"message": "Template uploaded and processing", "id": tmpl_id}
    except Exception as e:
        print(f"[ERROR] Database template upload error: {e}")
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        if conn: db_pool.putconn(conn)


@app.get("/api/templates/analysis/{template_id}")
def get_template_analysis(template_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT clause_id, clause, content_id, content, page_number FROM clauses WHERE document_id = %s ORDER BY page_number ASC",
                (template_id,)
            )
            clause_rows = cur.fetchall()
            
            if not clause_rows:
                return {"clauses": [], "status": "processing"}
                
            clauses_data = [
                {
                    "clause_id": r[0],
                    "clause": r[1],
                    "content_id": r[2],
                    "content": r[3],
                    "page_number": r[4]
                }
                for r in clause_rows
            ]
            
            return {"clauses": clauses_data, "status": "complete"}
    finally: db_pool.putconn(conn)


@app.get("/api/templates/download/{template_id}")
def download_template(template_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s3_key, file_path, filename FROM documents WHERE id = %s", (template_id,))
            res = cur.fetchone()
            if not res: raise HTTPException(status_code=404)
            if res[0]:
                try:
                    url = s3_client.generate_presigned_url('get_object', Params={'Bucket': BUCKET_NAME, 'Key': res[0]}, ExpiresIn=3600)
                    return {"download_url": url}
                except: pass
            fp = Path(res[1] or "")
            if fp.exists(): return FileResponse(path=str(fp), filename=res[2])
            raise HTTPException(status_code=404)
    finally: db_pool.putconn(conn)



@app.get("/api/templates/list")
def list_templates(current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, filename, template_type, uploaded_at FROM documents WHERE document_type = 'template'")
            rows = cur.fetchall()
            return {"templates": [{"id": r[0], "filename": r[1], "template_type": r[2], "uploaded_at": r[3].isoformat()} for r in rows]}
    finally: db_pool.putconn(conn)





# ──────────────────────────────────────────────────────────────────────────────
# Review Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/documents/review/{document_id}")
def get_document_review(document_id: str, current_user: dict = Depends(verify_token)):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, user_id, s3_key FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc: raise HTTPException(status_code=404)
            if current_user["role"] == "client" and doc[1] != current_user["user_id"]: raise HTTPException(status_code=403)
            
            # 1. DB check for risk analysis
            cur.execute("SELECT review_data FROM document_reviews WHERE document_id = %s", (document_id,))
            db_review = cur.fetchone()
            
            clauses = None
            if db_review:
                clauses = db_review[0]
            else:
                # 2. Risk file check (Fallback)
                reviews_dir = DATA_DIR / "reviews"
                review_path = reviews_dir / f"{document_id}.json"
                if review_path.exists():
                    with open(review_path, "r", encoding="utf-8") as f:
                        clauses = json.load(f)
                        
            if clauses is not None:
                # Fetch live statuses, edits, and comments from DB
                cur.execute("SELECT content_id, approval_status, edited_content, comment FROM clauses WHERE document_id = %s", (document_id,))
                status_map = {}
                for row in cur.fetchall():
                    status_map[row[0]] = {
                        "status": row[1],
                        "edited_content": row[2],
                        "comment": row[3]
                    }
                
                # Apply live overrides to the JSON payload
                for clause in clauses:
                    cid = clause.get("content_id")
                    if cid and cid in status_map:
                        db_vals = status_map[cid]
                        clause["status"] = db_vals["status"] or "pending" 
                        clause["edited_content"] = db_vals["edited_content"]
                        clause["comment"] = db_vals["comment"]
                        
                return {"clauses": clauses, "status": "complete"}
            
            # Fallback analysis
            if doc[2]:
                base = Path(doc[2]).stem
                fallback = Path(__file__).parent.parent / "extracter" / "extracted_texts" / f"{base}.json"
                if fallback.exists():
                    with open(fallback, "r", encoding="utf-8") as f:
                        return {"clauses": json.load(f), "status": "processing"}
            return {"clauses": [], "status": "processing"}
    finally: db_pool.putconn(conn)



class ClauseActionRequest(BaseModel):
    content_id: str
    action: str   # "accept" | "reject"


@app.post("/api/documents/review/{document_id}/action")
def clause_action(document_id: str, req: ClauseActionRequest, current_user: dict = Depends(verify_token)):
    if req.action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'accept' or 'reject'")
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            # Simple access check
            if current_user["role"] == "client" and doc[0] != current_user["user_id"]:
                raise HTTPException(status_code=403, detail="Forbidden")


        # Update PostgreSQL directly instead of the temporary JSON
        updated = False
        try:
            with conn.cursor() as cur:
                new_status = "accepted" if req.action == "accept" else "rejected"
                cur.execute(
                    "UPDATE clauses SET approval_status = %s WHERE content_id = %s RETURNING id",
                    (new_status, req.content_id)
                )
                if cur.fetchone():
                    updated = True
            conn.commit()
        except Exception as e:
            print(f"[ERROR] DB update failed for clause action: {e}")
            conn.rollback()
            raise HTTPException(status_code=500, detail="Database error during approval")
            
        if not updated:
            raise HTTPException(status_code=404, detail="Clause not found in database")

        return {"message": f"Clause {req.action}ed", "content_id": req.content_id}
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Clause action error: {e}")
        raise HTTPException(status_code=500, detail="Processing error")
    finally:
        if conn: db_pool.putconn(conn)



class ClauseEditRequest(BaseModel):
    content_id: str
    edited_content: str

@app.post("/api/documents/review/{document_id}/edit")
def update_clause_content(document_id: str, req: ClauseEditRequest, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            if current_user["role"] == "client" and doc[0] != current_user["user_id"]:
                raise HTTPException(status_code=403, detail="Forbidden")

        updated = False
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE clauses SET edited_content = %s WHERE content_id = %s RETURNING id",
                    (req.edited_content, req.content_id)
                )
                if cur.fetchone():
                    updated = True
            conn.commit()
        except Exception as e:
            print(f"[ERROR] DB update failed for clause edit: {e}")
            conn.rollback()
            raise HTTPException(status_code=500, detail="Database error during edit")
            
        if not updated:
            raise HTTPException(status_code=404, detail="Clause not found in database")

        return {"message": "Clause edited successfully", "content_id": req.content_id}
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Clause edit error: {e}")
        raise HTTPException(status_code=500, detail="Processing error")
    finally:
        if conn: db_pool.putconn(conn)


class ClauseCommentRequest(BaseModel):
    content_id: str
    comment: str

@app.post("/api/documents/review/{document_id}/comment")
def update_clause_comment(document_id: str, req: ClauseCommentRequest, current_user: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    conn = None
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM documents WHERE id = %s", (document_id,))
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            if current_user["role"] == "client" and doc[0] != current_user["user_id"]:
                raise HTTPException(status_code=403, detail="Forbidden")

        updated = False
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE clauses SET comment = %s WHERE content_id = %s RETURNING id",
                    (req.comment, req.content_id)
                )
                if cur.fetchone():
                    updated = True
            conn.commit()
        except Exception as e:
            print(f"[ERROR] DB update failed for clause comment: {e}")
            conn.rollback()
            raise HTTPException(status_code=500, detail="Database error during comment")
            
        if not updated:
            raise HTTPException(status_code=404, detail="Clause not found in database")

        return {"message": "Clause comment added successfully", "content_id": req.content_id}
    except HTTPException: raise
    except Exception as e:
        print(f"[ERROR] Clause comment error: {e}")
        raise HTTPException(status_code=500, detail="Processing error")
    finally:
        if conn: db_pool.putconn(conn)


class AskLLMRequest(BaseModel):
    content_id: str
    question: str


@app.post("/api/documents/review/{document_id}/ask-llm")
def ask_llm_about_clause(
    document_id: str,
    req: AskLLMRequest,
    current_user: dict = Depends(verify_token)
):
    """Ask the LLM a question about a specific clause in the review."""
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database not connected")

    conn = None
    clauses = []
    try:
        conn = db_pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT review_data FROM document_reviews WHERE document_id = %s", (document_id,))
            db_review = cur.fetchone()
            if db_review:
                clauses = db_review[0]
            else:
                # Fallback to local file if DB isn't populated for this document yet
                reviews_dir = DATA_DIR / "reviews"
                review_path = reviews_dir / f"{document_id}.json"
                if review_path.exists():
                    with open(review_path, "r", encoding="utf-8") as f:
                        clauses = json.load(f)
                else:
                    raise HTTPException(status_code=404, detail="Review not available yet for this document")
    finally:
        if conn: db_pool.putconn(conn)

    # Find the specific clause the user clicked on
    clause = next((c for c in clauses if c.get("content_id") == req.content_id), None)
    if not clause:
        raise HTTPException(status_code=404, detail="Clause not found in review payload")

    try:
        from vector_pipeline.llm.reasoning import compare_clauses

        client_text   = clause.get("content", "")
        standard_text = (clause.get("matched_clause") or {}).get("content", "")
        clause_type   = clause.get("clause_type", "Unknown")
        risk          = clause.get("risk", "Unknown")

        answer = compare_clauses(client_text, standard_text, clause_type, risk)
        return {"answer": answer, "content_id": req.content_id}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

class ChatRequest(BaseModel):
    message: str


@app.post("/api/documents/chat/{document_id}")
def document_chat(
    document_id: str,
    req: ChatRequest,
    current_user: dict = Depends(verify_token)
):
    """Global Chatbot Agent for the entire document."""
    try:
        from vector_pipeline.llm.document_agent import chat_with_document
        
        # In a real app, bind the session ID to the user ID & document ID
        session_id = f"session_{current_user['user_id']}_{document_id}"
        
        response = chat_with_document(
            document_id=document_id,
            user_message=req.message,
            session_id=session_id
        )
        return {"response": response}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat Agent error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

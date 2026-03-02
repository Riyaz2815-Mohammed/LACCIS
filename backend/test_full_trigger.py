import os
import sys
from pathlib import Path
import psycopg2
import boto3
from dotenv import load_dotenv

os.environ["PYTHONIOENCODING"]="utf-8"

# Add project root and backend to sys.path
backend_dir = Path(os.getcwd())
if str(backend_dir) not in sys.path:
    sys.path.append(str(backend_dir))

from main import trigger_extraction

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_KEY")
AWS_REGION = os.getenv("REGION")
BUCKET_NAME = os.getenv("BUCKET_NAME")

def test_full_trigger():
    if not DATABASE_URL:
        print("DATABASE_URL not found")
        return

    # Get latest doc
    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        # Get latest from documents table that is not redlined
        cur.execute("SELECT id, filename, document_type, s3_key, file_path FROM documents WHERE document_type NOT ILIKE '%redlined%' ORDER BY uploaded_at DESC LIMIT 1;")
        doc = cur.fetchone()
        if not doc:
            print("No latest document found to test.")
            return
            
        doc_id, filename, document_type, s3_key, local_path = doc
        print(f"Testing document: {s3_key} ({document_type})")
        
        # Download from S3 if it doesn't exist locally
        target_path = Path("data/uploads") / s3_key
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if not target_path.exists():
            print(f"Downloading {s3_key} from S3...")
            s3_client = boto3.client('s3', aws_access_key_id=AWS_ACCESS_KEY, aws_secret_access_key=AWS_SECRET_KEY, region_name=AWS_REGION)
            s3_client.download_file(BUCKET_NAME, s3_key, str(target_path))
            print("Downloaded.")
        
        # Run trigger_extraction
        print("Running trigger_extraction...")
        trigger_extraction(s3_key, document_type, "legal")
        
    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == "__main__":
    test_full_trigger()

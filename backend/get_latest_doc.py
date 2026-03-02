import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def get_latest_doc():
    if not DATABASE_URL:
        print("DATABASE_URL not found in .env")
        return

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        cur.execute("SELECT s3_key, document_type, source FROM documents ORDER BY uploaded_at DESC LIMIT 1;")
        doc = cur.fetchone()
        if doc:
            print(f"Latest document: {doc}")
        else:
            print("No documents found.")
            
    except Exception as e:
        print(f"Error checking database: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == "__main__":
    get_latest_doc()


import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def check_all_clauses():
    if not DATABASE_URL:
        print("DATABASE_URL not found in .env")
        return

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        print("Checking total clause count...")
        cur.execute("SELECT COUNT(*) FROM clauses;")
        print(f"Total clauses: {cur.fetchone()[0]}")
        
        print("\nChecking last 5 clauses...")
        cur.execute("SELECT clause, document, source, document_id FROM clauses ORDER BY created_at DESC LIMIT 5;")
        rows = cur.fetchall()
        for r in rows:
            print(f"Clause: {r}")
            
    except Exception as e:
        print(f"Error checking database: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    check_all_clauses()

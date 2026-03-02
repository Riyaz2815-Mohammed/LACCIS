import sys
import os
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

# Add project root and extracter to sys.path
project_root = Path(os.getcwd()).parent
if str(project_root) not in sys.path:
    sys.path.append(str(project_root))

from extracter.clause_engine import process_document

def test_db_insert():
    print("Testing DB insert with merged clauses...")
    
    # Mock extracted blocks
    blocks = [
        {"page_number": 1, "raw_text": "Confidentiality. The parties agree to keep it secret."},
        {"page_number": 1, "raw_text": "They also agree not to disclose it."},
        {"page_number": 2, "raw_text": "Payment. 10 dollars."},
    ]
    
    results = process_document(blocks, document="NDA", source="legal")
    print(f"Process document returned {len(results)} merged clauses.")
    for r in results:
        print(f"Clause: {r['clause']}, Content len: {len(r['content'])}")
        
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        for clause in results:
            cur.execute(
                """
                INSERT INTO clauses (clause_id, clause, content_id, content, page_number, document, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    clause["clause_id"],
                    clause["clause"],
                    clause["content_id"],
                    clause["content"],
                    clause["page_number"],
                    "NDA",
                    "legal"
                )
            )
        conn.commit()
        print("✅ DB Insert successful")
        
        # Cleanup
        for clause in results:
            cur.execute("DELETE FROM clauses WHERE clause_id = %s", (clause["clause_id"],))
        conn.commit()
        print("Cleaned up.")
    except Exception as e:
        print(f"❌ DB Insert failed: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    test_db_insert()

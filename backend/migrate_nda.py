import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, '.env')
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")

def migrate():
    if not DATABASE_URL:
        print("DATABASE_URL not found!")
        return

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        print("Adding nda_accepted and nda_accepted_at to users table...")
        cur.execute("""
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS nda_accepted BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS nda_accepted_at TIMESTAMPTZ;
        """)
        
        conn.commit()
        print("Migration successful!")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()

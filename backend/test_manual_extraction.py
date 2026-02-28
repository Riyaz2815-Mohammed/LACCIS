
import sys
import os
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(os.getcwd())
if str(backend_dir) not in sys.path:
    sys.path.append(str(backend_dir))

from main import trigger_extraction

def test_manual_extraction():
    
    uploads_dir = Path("data/uploads")
    # Using the test template uploaded previously
    files = list(uploads_dir.glob("template*test_template.txt"))
    if not files:
        # Fallback to PDF files since I successfully uploaded MSAs/NDAs
        files = list(uploads_dir.glob("*.pdf"))
    
    if not files:
        print("No valid filed found in uploads dir.")
        return
    
    file_path = files[0]
    file_name = file_path.name
    print(f"Testing extraction and db storage for {file_name}")
    
    try:
        # this will run synchronously
        trigger_extraction(file_name, "NDA", "legal")
        print("Extraction completed. Check db now via check_all_clauses.py")
    except Exception as e:
        print(f"FAILED manually: {e}")

if __name__ == "__main__":
    test_manual_extraction()

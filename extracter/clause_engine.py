import re
import uuid
import spacy
import os
from typing import List, Dict, Optional, Any

# Attempt to load the spaCy model
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("SpaCy model 'en_core_web_sm' not found. Please run: python -m spacy download en_core_web_sm")
    nlp = None


def extract_structural_id(text: str) -> Optional[str]:
    """
    Extracts structural clause numbering (e.g., "1.", "2.1", "Section 3", "(a)")
    from the start of the text. Used as a label – NOT used as the unique clause_id.
    """
    patterns = [
        r"^(Section\s+\d+(\.\d+)*)",     # Section 1, Section 1.2
        r"^(Article\s+\d+(\.\d+)*)",     # Article 1
        r"^(\d+(\.\d+)+)",               # 1.1, 1.1.1 (multi-part)
        r"^(\d+\.)",                     # 1. (simple)
        r"^([0-9]+\s+[A-Z][a-z]+)",      # 1 Indemnity (no period)
        r"^([IVXLCDM]+\.)",              # Roman numerals I., IV.
    ]

    for pattern in patterns:
        match = re.match(pattern, text.strip(), re.IGNORECASE)
        if match:
            return match.group(1)

    return None


HEADER_LOGIC = {
    "Definitions": [r"definitions", r"defined terms"],
    "Purpose": [r"purpose", r"background", r"recitals"],
    "Purpose of the Agreement": [r"purpose of the agreement", r"objective"],
    "Scope of Services": [r"scope of services", r"service scope"],
    "Scope of Referral Services": [r"scope of referral services"],
    "Structure of Agreement (MSA–SOW Linkage)": [r"structure of agreement", r"msa–sow linkage", r"linkage between msa and sow"],
    "Appointment of Referrer": [r"appointment of referrer", r"designation of referrer"],
    "Referrer’s Responsibilities": [r"referrer.*responsibilit", r"responsibilities of referrer"],
    "Solution Provider’s Responsibilities": [r"solution provider.*responsibilit", r"responsibilities of solution provider"],
    "Roles and Responsibilities": [r"roles and responsibilit", r"obligations of the parties"],
    "Deliverables": [r"deliverables", r"work product deliverables"],
    "Project Timeline and Milestones": [r"project timeline", r"milestones", r"schedule"],
    "Assumptions and Dependencies": [r"assumptions and dependencies"],
    "Acceptance Criteria": [r"acceptance criteria", r"testing and acceptance"],
    "Service Levels (SLA)": [r"service level", r"sla", r"uptime", r"availability"],
    "Change Management Process": [r"change management", r"change request", r"change control"],
    "Fees and Payment Terms": [r"fees and payment", r"payment terms", r"compensation"],
    "Referral Fee": [r"referral fee", r"referral commission"],
    "Commission Structure": [r"commission structure", r"payment of commission"],
    "Payment Schedule": [r"payment schedule", r"milestone payments"],
    "Invoicing Terms": [r"invoicing", r"invoice terms"],
    "Taxes and Tax Responsibility": [r"taxes", r"tax responsibility", r"withholding"],
    "Expenses": [r"expenses", r"reimbursement of expenses"],
    "No Expense Reimbursement": [r"no expense reimbursement"],
    "Confidentiality": [r"confidentiality", r"non-disclosure"],
    "Definition of Confidential Information": [r"definition of confidential information"],
    "Exclusions from Confidential Information": [r"exclusions from confidential information", r"exceptions to confidentiality"],
    "Permitted Use of Confidential Information": [r"permitted use of confidential information"],
    "Non-Disclosure and Non-Use Obligations": [r"non-disclosure and non-use", r"confidentiality obligations"],
    "Return or Destruction of Confidential Information": [r"return or destruction"],
    "Confidentiality and IP Protection": [r"confidentiality and ip protection"],
    "Intellectual Property Rights": [r"intellectual property rights", r"ip rights", r"proprietary rights"],
    "Ownership of Deliverables": [r"ownership of deliverables", r"title to deliverables"],
    "No License Granted": [r"no license granted", r"no transfer of rights"],
    "Data Protection and Security": [r"data protection", r"data security", r"gdpr", r"privacy"],
    "Compliance with Laws": [r"compliance with laws", r"regulatory compliance"],
    "Independent Contractor Relationship": [r"independent contractor", r"relationship of the parties"],
    "Non-Solicitation": [r"non-solicitation", r"non solicitation"],
    "Non-Circumvention": [r"non-circumvention", r"non circumvention"],
    "Exclusivity / Non-Exclusivity": [r"exclusivity", r"non-exclusivity"],
    "Representations and Warranties": [r"representations and warranties"],
    "Warranty of Services": [r"warranty of services", r"service warranty"],
    "Indemnification": [r"indemnification", r"indemnity"],
    "Insurance": [r"insurance", r"liability insurance"],
    "Limitation of Liability": [r"limitation of liability", r"liability limit"],
    "Risk Allocation": [r"risk allocation", r"allocation of risk"],
    "Remedies for Breach": [r"remedies for breach", r"liquidated damages"],
    "Injunctive Relief": [r"injunctive relief", r"equitable relief"],
    "Channel Conflict Resolution": [r"channel conflict"],
    "Force Majeure": [r"force majeure", r"act of god"],
    "Term": [r"term", r"duration of agreement"],
    "Termination": [r"termination"],
    "Termination for Convenience": [r"termination for convenience", r"voluntary termination"],
    "Termination for Cause": [r"termination for cause", r"default termination"],
    "Effect of Termination": [r"effect of termination", r"consequences of termination"],
    "Transition Assistance": [r"transition assistance", r"exit services"],
    "Survival": [r"survival"],
    "Assignment": [r"assignment", r"transfer of agreement"],
    "Subcontracting": [r"subcontracting"],
    "Amendments": [r"amendments", r"modifications"],
    "Notices": [r"notices", r"communications"],
    "Severability": [r"severability"],
    "Waiver": [r"waiver", r"no waiver"],
    "Entire Agreement": [r"entire agreement", r"integration", r"merger"],
    "General": [r"general", r"miscellaneous"],
    "Governing Law": [r"governing law", r"applicable law"],
    "Jurisdiction and Dispute Resolution": [r"jurisdiction", r"dispute resolution", r"arbitration", r"mediation"],
}

def classify_clause(text: str) -> str:
    """
    Classifies the clause text into a standardized type using rules, headers, and keywords.
    Supports ~70 specific clause types.
    """
    text_clean = text.strip()
    text_lower = text_clean.lower()
    
    # Priority 1: Check if the text starts with a specific section header (prefix matching)
    # Check first 70 chars for headers
    prefix = text_lower[:70]
    for category, patterns in HEADER_LOGIC.items():
        for pat in patterns:
            if re.search(pat, prefix):
                return category

    # Priority 2: Keyword Scoring
    if not nlp:
        doc = None
    else:
        doc = nlp(text_lower)

    rules = {
        "Indemnification": ["indemnify", "indemnification", "hold harmless"],
        "Limitation of Liability": ["limitation of liability", "cap on liability", "consequential damages"],
        "Confidentiality": ["confidential", "non-disclosure", "proprietary information"],
        "Termination": ["terminate", "termination", "cancellation"],
        "Payment Terms": ["payment", "invoice", "fees"],
        "Service Levels (SLA)": ["service level", "sla", "uptime"],
        "Governing Law": ["governing law", "jurisdiction", "laws of"],
        "Intellectual Property Rights": ["intellectual property", "ip rights", "copyright", "trademark"],
        "Deliverables": ["deliverables", "work product"],
        "Data Protection and Security": ["data protection", "gdpr", "privacy"],
        "Force Majeure": ["force majeure", "act of god"],
        "Assignment": ["assignment", "assignability"],
        "Notices": ["notices", "written notice"],
        "Severability": ["severability", "invalidity"],
        "Entire Agreement": ["entire agreement", "supersedes"],
    }

    scores = {category: 0 for category in rules}
    tokens = [token.lemma_ for token in doc] if doc else text_lower.split()
    token_text = " ".join(tokens)

    for category, keywords in rules.items():
        for keyword in keywords:
            if keyword in token_text or keyword in text_lower:
                scores[category] += 1

    best_match = max(scores, key=scores.get)
    if scores[best_match] > 0:
        return best_match

    return "Other"


def parse_text_file(file_path: str) -> List[Dict[str, Any]]:
    """
    Parses a text file with 'PAGE X' delimiters and clause numbering.
    Returns a list of blocks like {"page_number": 1, "raw_text": "..."}
    """
    extracted_blocks = []

    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        return []

    current_page = 1
    current_text_lines = []
    current_block_start_page = 1

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    for line in lines:
        line_stripped = line.strip()

        # Check for Page Header
        page_match = re.match(r"^PAGE\s+(\d+)", line_stripped, re.IGNORECASE)
        if page_match:
            current_page = int(page_match.group(1))
            continue

        # Skip separator lines
        if re.match(r"^-+$", line_stripped):
            continue

        if not line_stripped:
            continue

        # Check if line starts a new clause
        has_id = extract_structural_id(line_stripped) is not None
        
        is_unnumbered_heading = False
        if not has_id and len(line_stripped) < 80:
            lower_line = line_stripped.lower()
            if line_stripped.isupper() and any(c.isalpha() for c in line_stripped):
                is_unnumbered_heading = True
            else:
                for cats, pats in HEADER_LOGIC.items():
                    if any(re.match(p, lower_line) for p in pats):
                        is_unnumbered_heading = True
                        break

        is_new_clause = has_id or is_unnumbered_heading

        if is_new_clause:
            # Save previous block if exists
            if current_text_lines:
                full_text = " ".join(current_text_lines)
                extracted_blocks.append({
                    "page_number": current_block_start_page,
                    "raw_text": full_text
                })

            # Start new block
            current_text_lines = [line_stripped]
            current_block_start_page = current_page
        else:
            # If no block started (e.g., preamble), start one
            if not current_text_lines:
                current_block_start_page = current_page

            # Append to current
            current_text_lines.append(line_stripped)

    # Flush last block
    if current_text_lines:
        full_text = " ".join(current_text_lines)
        extracted_blocks.append({
            "page_number": current_block_start_page,
            "raw_text": full_text
        })

    return extracted_blocks


def process_document(
    extracted_blocks: List[Dict[str, Any]],
    document: str = "Unknown",
    source: str = "unknown"
) -> List[Dict[str, Any]]:
    """
    Process extracted text blocks and return structured data.
    Aggregates all blocks belonging to the same clause category into a single entry per document.
    """
    clause_groups = {}

    for block in extracted_blocks:
        raw_text = block.get("raw_text", "").strip()
        if not raw_text:
            continue
            
        page_num = block.get("page_number")
        clause_type = classify_clause(raw_text)

        if clause_type not in clause_groups:
            clause_groups[clause_type] = {
                "clause_id":   f"CLZ-{uuid.uuid4().hex[:8].upper()}",
                "clause":      clause_type,
                "content_id":  f"CNT-{uuid.uuid4().hex[:8].upper()}",
                "content":     [raw_text],
                "page_number": page_num, # Store earliest page
                "document":    document,
                "source":      source,
            }
        else:
            # Append text to existing clause group
            clause_groups[clause_type]["content"].append(raw_text)
            
            # Keep the earliest page number reference
            current_page = clause_groups[clause_type]["page_number"]
            if page_num is not None:
                if current_page is None or page_num < current_page:
                    clause_groups[clause_type]["page_number"] = page_num

    # Flatten the lists back into single text strings
    structured_records = []
    for ct, data in clause_groups.items():
        data["content"] = "\n\n".join(data["content"])
        structured_records.append(data)

    return structured_records

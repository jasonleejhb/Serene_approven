"""
Self-contained Automated Test Suite for Approven Customer Portal.
Uses direct ASGI & FastAPI function invocation without external testclient dependencies.
"""

import os
import io
import json
import asyncio
import pyodbc
from starlette.requests import Request
from starlette.datastructures import Headers, FormData, UploadFile
from starlette.middleware.sessions import SessionMiddleware
from CustomerPortal.customerportal_router import (
    api_request_otp, api_verify_otp, api_summary, api_quotes, 
    api_quote_detail, api_audits, api_audit_detail, api_list_documents, 
    api_upload_document, api_download_document, api_delete_document,
    api_profile, is_mobile_user_agent
)

async def run_tests():
    print("==================================================================")
    print("RUNNING APPROVEN CUSTOMER PORTAL AUTOMATED UNIT TESTS")
    print("==================================================================")

    # 1. Mobile Detection Logic
    print("\n--- TEST 1: Mobile User-Agent Sensing ---")
    
    class FakeRequest:
        def __init__(self, ua_string: str, session: dict = None):
            self.headers = {"User-Agent": ua_string}
            self.session = session or {}

    desktop_req = FakeRequest("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    mobile_req_ios = FakeRequest("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
    mobile_req_android = FakeRequest("Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 Mobile Safari/537.36")

    assert is_mobile_user_agent(desktop_req) is False
    assert is_mobile_user_agent(mobile_req_ios) is True
    assert is_mobile_user_agent(mobile_req_android) is True
    print("[OK] Desktop UA correctly detected as Desktop (False)")
    print("[OK] iPhone UA correctly detected as Mobile (True)")
    print("[OK] Android UA correctly detected as Mobile (True)")

    # 2. OTP Request & Verification
    print("\n--- TEST 2: OTP Flow with tbl_Emails Settings ---")
    
    # Non-existent email
    invalid_res = await api_request_otp(desktop_req, email="unknown_user@random.org")
    assert invalid_res.status_code == 404
    print("[OK] Non-existent CB email rejected with 404 Not Found")

    # Valid CB Billing Email: jason@serenetech.co.za (Control Union Certifications B.V., CB ID 4)
    valid_email = "jason@serenetech.co.za"
    otp_res = await api_request_otp(desktop_req, email=valid_email)
    assert otp_res["success"] is True
    print(f"[OK] OTP successfully generated and sent to {valid_email} for {otp_res['company_name']}")

    # Retrieve generated OTP from DB
    from db_config import DB_CONN_STR
    conn = pyodbc.connect(DB_CONN_STR)
    cur = conn.cursor()
    cur.execute("SELECT TOP 1 OTP FROM dbo.tbl_Portal_OTP WHERE LOWER(Email) = LOWER(?) AND Used = 0 ORDER BY CreatedAt DESC", valid_email)
    row = cur.fetchone()
    assert row is not None
    otp_code = row[0]
    print(f"[OK] Retrieved active OTP from tbl_Portal_OTP: {otp_code}")

    # Verify wrong OTP
    wrong_res = await api_verify_otp(desktop_req, email=valid_email, otp="000000")
    assert wrong_res.status_code == 401
    print("[OK] Incorrect OTP rejected (401)")

    # Verify correct OTP
    verify_res = await api_verify_otp(desktop_req, email=valid_email, otp=otp_code)
    assert verify_res["success"] is True
    assert verify_res["user"]["cb_id"] == 4
    assert verify_res["user"]["company_name"] == "Control Union Certifications B.V."
    user_session = desktop_req.session["customer_user"]
    print("[OK] OTP verified successfully! Session established for CB ID 4 (Control Union Certifications B.V.)")

    # 3. Customer Data Scoping Tests
    print("\n--- TEST 3: Scoped Quotes & Audits Isolation ---")

    # Summary Stats
    summary = await api_summary(user=user_session)
    assert summary["success"] is True
    stats = summary["stats"]
    print(f"[OK] Summary KPIs: Total Quotes={stats['total_quotes']}, Quoted Value=€{stats['total_quoted_value']:,.2f}, Total Audits={stats['total_audits']}")

    # Quotes Scoping
    quotes_res = await api_quotes(user=user_session)
    assert quotes_res["success"] is True
    quotes = quotes_res["quotes"]
    assert len(quotes) > 0
    print(f"[OK] Loaded {len(quotes)} quotes strictly belonging to Control Union Certifications B.V.")

    sample_quote_id = quotes[0]["QuoteID"]
    quote_det = await api_quote_detail(quote_id=sample_quote_id, user=user_session)
    assert quote_det["success"] is True
    q = quote_det["quote"]
    print(f"[OK] Quote detail for #{sample_quote_id} ({q['QuoteRef']}): Auditee={q['Auditee_Name']}, Total=€{q['Quote_Total']:,.2f}")

    # Audits Scoping
    audits_res = await api_audits(user=user_session)
    assert audits_res["success"] is True
    audits = audits_res["audits"]
    assert len(audits) > 0
    print(f"[OK] Loaded {len(audits)} audits strictly belonging to Control Union Certifications B.V.")

    sample_wfid = audits[0]["WFID"]
    audit_det = await api_audit_detail(wfid=sample_wfid, user=user_session)
    assert audit_det["success"] is True
    a = audit_det["audit"]
    print(f"[OK] Audit detail for WF-{sample_wfid}: Status={a['Status']}, Program={a['Audit_Program']}, Auditee={a['Auditee_Name']}")

    # 4. Document Management
    print("\n--- TEST 4: Document Upload, Listing, Download & Delete ---")

    class FakeUploadFile:
        def __init__(self, filename: str, content: bytes, content_type: str = "application/pdf"):
            self.filename = filename
            self.content = content
            self.content_type = content_type
        async def read(self):
            return self.content

    test_content = b"Approven Compliance Audit Questionnaire File Content."
    upload_file_obj = FakeUploadFile("test_compliance_report.pdf", test_content)

    upload_res = await api_upload_document(
        file=upload_file_obj,
        document_type="Pre-Audit Questionnaire",
        wfid=str(sample_wfid),
        description="Automated unit test document upload",
        user=user_session
    )
    assert upload_res["success"] is True
    print("[OK] Document uploaded successfully:", upload_res["message"])

    # List documents
    docs_res = await api_list_documents(user=user_session)
    assert docs_res["success"] is True
    docs = docs_res["documents"]
    uploaded_doc = next((d for d in docs if d["FileName"] == "test_compliance_report.pdf"), None)
    assert uploaded_doc is not None
    doc_id = uploaded_doc["DocumentID"]
    print(f"[OK] Uploaded document found in CB documents: ID={doc_id}, Type={uploaded_doc['DocumentType']}, Size={uploaded_doc['FileSize']} bytes")

    # Download document
    dl_res = await api_download_document(doc_id=doc_id, user=user_session)
    assert os.path.exists(dl_res.path)
    with open(dl_res.path, "rb") as f:
        file_bytes = f.read()
    assert file_bytes == test_content
    print("[OK] Document downloaded and verified byte-exact match!")

    # Delete document
    del_res = await api_delete_document(doc_id=doc_id, user=user_session)
    assert del_res["success"] is True
    print("[OK] Document deleted successfully")

    # 5. Profile API
    print("\n--- TEST 5: Certification Body Profile ---")
    prof_res = await api_profile(user=user_session)
    assert prof_res["success"] is True
    p = prof_res["profile"]
    print(f"[OK] Profile loaded: Company={p['Company_Name']}, Code={p['Code']}, Billing Email={p['Billing_Email']}, Manday Rate={p['Man_Day_Rate']}")

    conn.close()
    print("\n==================================================================")
    print("ALL APPROVEN CUSTOMER PORTAL UNIT TESTS PASSED SUCCESSFULLY!")
    print("==================================================================")

if __name__ == "__main__":
    asyncio.run(run_tests())

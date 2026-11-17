import os

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_IS_LIVE = os.path.basename(_BASE_DIR).lower() == "live"

DB_NAME = os.environ.get("APPROVEN_DB_NAME") or ("Approven_Live" if _IS_LIVE else "Approven_Dev")
DB_CONN_STR = (
    r"DRIVER={ODBC Driver 18 for SQL Server};"
    r"SERVER=.\SQLEXPRESS;"
    f"DATABASE={DB_NAME};"
    r"Trusted_Connection=yes;"
    r"TrustServerCertificate=yes;"
)

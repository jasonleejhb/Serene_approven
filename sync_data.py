import os
import json
import time
from datetime import datetime
import pyodbc

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ACCESS_DB_PATH = os.path.join(BASE_DIR, "ApprovenLinkedLiveTables.accdb")
METADATA_FILE = os.path.join(BASE_DIR, "sync_metadata.json")

# SQL Server & Access Connection Strings
ACCESS_CONN_STR = (
    rf"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
    rf"DBQ={ACCESS_DB_PATH};"
    rf"ReadOnly=1;"
)
from db_config import DB_CONN_STR as SQL_CONN_STR, DB_NAME

def get_last_sync_info():
    """Retrieves the timestamp and metadata of the most recent sync."""
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "last_sync": None,
        "last_sync_display": "Never",
        "total_tables": 0,
        "total_rows": 0,
        "duration_seconds": 0.0,
        "status": "Never Synced"
    }

def save_sync_info(metadata: dict):
    """Saves sync metadata to JSON file."""
    try:
        with open(METADATA_FILE, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save sync metadata: {e}")

def sync_access_to_sql(logger_fn=print):
    """
    Clears all tables in SQL Server database 'Approven' and copies all
    data from 'ApprovenLinkedLiveTables.accdb' (read-only access).
    """
    t_start = time.time()
    logger_fn("=" * 65)
    logger_fn("  APPROVEN DATA SYNC: ACCESS (LIVE LINKED) -> SQL SERVER")
    logger_fn("=" * 65)
    logger_fn(f"Source: {ACCESS_DB_PATH} (ReadOnly)")
    logger_fn(f"Target: SQL Server {DB_NAME}")
    logger_fn("-" * 65)

    if not os.path.exists(ACCESS_DB_PATH):
        raise FileNotFoundError(f"Access database not found at {ACCESS_DB_PATH}")

    # Establish connections
    acc_conn = pyodbc.connect(ACCESS_CONN_STR)
    acc_cursor = acc_conn.cursor()

    sql_conn = pyodbc.connect(SQL_CONN_STR, autocommit=False)
    sql_cursor = sql_conn.cursor()
    sql_cursor.fast_executemany = True

    try:
        # Retrieve all objects available in Access
        acc_tables = {t.table_name for t in acc_cursor.tables()}

        # Retrieve all base tables from SQL Server
        sql_cursor.execute("""
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE='BASE TABLE' 
            ORDER BY TABLE_NAME
        """)
        sql_tables = [row[0] for row in sql_cursor.fetchall()]

        # Identify Identity columns for each table
        sql_cursor.execute("""
            SELECT t.name AS TableName, c.name AS ColumnName
            FROM sys.tables t
            JOIN sys.columns c ON t.object_id = c.object_id
            WHERE c.is_identity = 1
        """)
        identity_map = {row[0]: row[1] for row in sql_cursor.fetchall()}

        total_rows = 0

        for tbl in sql_tables:
            # Skip tables that don't exist in Access (e.g. portal / email tables)
            if tbl not in acc_tables:
                continue

            t0 = time.time()

            # Get column list in correct ordinal position, intersected with Access columns
            sql_cursor.execute(f"""
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME='{tbl}' 
                ORDER BY ORDINAL_POSITION
            """)
            sql_cols = [row[0] for row in sql_cursor.fetchall()]
            acc_cols = {c.column_name.lower() for c in acc_cursor.columns(table=tbl)}
            cols = [c for c in sql_cols if c.lower() in acc_cols]
            if not cols:
                continue
            col_list_str = ", ".join([f"[{c}]" for c in cols])
            placeholders = ", ".join(["?" for _ in cols])

            # Read all rows from Access (Strictly Read-Only)
            acc_cursor.execute(f"SELECT {col_list_str} FROM [{tbl}]")
            rows = acc_cursor.fetchall()
            row_count = len(rows)

            # Clear existing data in SQL Server
            sql_cursor.execute(f"DELETE FROM [dbo].[{tbl}]")

            has_identity = tbl in identity_map
            if row_count > 0:
                data = [tuple(r) for r in rows]
                if has_identity:
                    sql_cursor.execute(f"SET IDENTITY_INSERT [dbo].[{tbl}] ON")

                sql_cursor.executemany(
                    f"INSERT INTO [dbo].[{tbl}] ({col_list_str}) VALUES ({placeholders})", 
                    data
                )

                if has_identity:
                    sql_cursor.execute(f"SET IDENTITY_INSERT [dbo].[{tbl}] OFF")

            elapsed = time.time() - t0
            total_rows += row_count
            logger_fn(f" -> Synced [{tbl:<32}] {row_count:>6} rows ({elapsed:.2f}s)")

        # Commit full transaction
        sql_conn.commit()

        duration = time.time() - t_start
        now = datetime.now()
        timestamp_str = now.strftime("%d/%m/%Y %H:%M:%S")
        iso_str = now.isoformat()

        metadata = {
            "last_sync": iso_str,
            "last_sync_display": timestamp_str,
            "total_tables": len(sql_tables),
            "total_rows": total_rows,
            "duration_seconds": round(duration, 2),
            "status": "Success",
            "message": f"Successfully synchronized {len(sql_tables)} tables ({total_rows} rows) in {duration:.2f}s."
        }
        save_sync_info(metadata)

        logger_fn("-" * 65)
        logger_fn(f"SUCCESS: Synchronized {len(sql_tables)} tables ({total_rows} total rows)")
        logger_fn(f"Completed in: {duration:.2f} seconds at {timestamp_str}")
        logger_fn("=" * 65)

        return metadata

    except Exception as exc:
        sql_conn.rollback()
        err_msg = str(exc)
        logger_fn(f"ERROR during sync: {err_msg}")
        now = datetime.now()
        metadata = {
            "last_sync": None,
            "last_sync_display": "Failed",
            "last_error": err_msg,
            "failed_at": now.strftime("%d/%m/%Y %H:%M:%S"),
            "status": "Failed"
        }
        save_sync_info(metadata)
        raise exc
    finally:
        acc_cursor.close()
        acc_conn.close()
        sql_cursor.close()
        sql_conn.close()

if __name__ == "__main__":
    try:
        sync_access_to_sql()
    except Exception as e:
        print(f"\n[FATAL ERROR] Data synchronization failed: {e}")
        exit(1)

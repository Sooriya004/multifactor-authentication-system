"""
Database Migration Script: Simplify Schema

This script migrates the database from the old schema to the new simplified schema:
1. Merges auth_methods into credentials (adds enabled/priority columns)
2. Merges all registration request tables into a single registration_requests table
3. Drops old/redundant tables

Run this script ONCE after updating the models.py file.

Usage:
    cd backend
    python -m app.migrate_db
"""

import sqlite3
from datetime import datetime

DB_PATH = "mfa_sys.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    print("Starting database migration...")

    # ═══════════════════════════════════════════════════════════════════════════════
    # Step 1: Add new columns to credentials table if they don't exist
    # ═══════════════════════════════════════════════════════════════════════════════
    print("\n[1/5] Adding new columns to credentials table...")

    # Check existing columns
    cur.execute("PRAGMA table_info(credentials)")
    existing_cols = {row["name"] for row in cur.fetchall()}

    if "enabled" not in existing_cols:
        cur.execute("ALTER TABLE credentials ADD COLUMN enabled BOOLEAN DEFAULT 0")
        print("  - Added 'enabled' column")

    if "priority" not in existing_cols:
        cur.execute("ALTER TABLE credentials ADD COLUMN priority INTEGER DEFAULT 0")
        print("  - Added 'priority' column")

    # Remove 'data' column by recreating table (SQLite doesn't support DROP COLUMN easily)
    # We'll leave it for now - it's not harmful, just unused

    # Remove 'registered' column - it's now a computed property
    # Again, we'll leave it - queries just won't use it

    conn.commit()

    # ═══════════════════════════════════════════════════════════════════════════════
    # Step 2: Migrate auth_methods data into credentials
    # ═══════════════════════════════════════════════════════════════════════════════
    print("\n[2/5] Migrating auth_methods into credentials...")

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_methods'")
    if cur.fetchone():
        cur.execute("SELECT * FROM auth_methods")
        auth_methods = cur.fetchall()

        for am in auth_methods:
            membership_id = am["membership_id"]
            am_type = am["type"]
            enabled = am["enabled"]
            priority = am["priority"]

            # Update the corresponding credential
            cur.execute("""
                UPDATE credentials
                SET enabled = ?, priority = ?
                WHERE membership_id = ? AND type = ?
            """, (enabled, priority, membership_id, am_type))

            if cur.rowcount == 0:
                # Credential doesn't exist, create it
                cur.execute("""
                    INSERT INTO credentials (id, membership_id, type, enabled, priority, registered)
                    VALUES (?, ?, ?, ?, ?, 0)
                """, (am["id"], membership_id, am_type, enabled, priority))

        print(f"  - Migrated {len(auth_methods)} auth_methods records")
        conn.commit()
    else:
        print("  - auth_methods table not found, skipping")

    # ═══════════════════════════════════════════════════════════════════════════════
    # Step 3: Create unified registration_requests table and migrate data
    # ═══════════════════════════════════════════════════════════════════════════════
    print("\n[3/5] Creating unified registration_requests table...")

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='registration_requests'")
    if not cur.fetchone():
        cur.execute("""
            CREATE TABLE registration_requests (
                id VARCHAR NOT NULL PRIMARY KEY,
                membership_id VARCHAR NOT NULL,
                house_id VARCHAR NOT NULL,
                requested_by_user_id VARCHAR NOT NULL,
                credential_type VARCHAR(11) NOT NULL,
                status VARCHAR(9) NOT NULL DEFAULT 'pending',
                extra_data VARCHAR(500),
                requested_at DATETIME NOT NULL,
                completed_at DATETIME,
                FOREIGN KEY(membership_id) REFERENCES house_memberships(id) ON DELETE CASCADE,
                FOREIGN KEY(house_id) REFERENCES houses(id) ON DELETE CASCADE,
                FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        print("  - Created registration_requests table")

    # Migrate fingerprint_registration_requests
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='fingerprint_registration_requests'")
    if cur.fetchone():
        cur.execute("SELECT * FROM fingerprint_registration_requests")
        fp_requests = cur.fetchall()
        for req in fp_requests:
            cur.execute("""
                INSERT OR IGNORE INTO registration_requests
                (id, membership_id, house_id, requested_by_user_id, credential_type, status, extra_data, requested_at, completed_at)
                VALUES (?, ?, ?, ?, 'fingerprint', ?, ?, ?, ?)
            """, (
                req["id"], req["membership_id"], req["house_id"], req["requested_by_user_id"],
                req["status"], str(req["fingerprint_id"]), req["requested_at"], req["completed_at"]
            ))
        print(f"  - Migrated {len(fp_requests)} fingerprint registration requests")
        conn.commit()

    # Migrate rfid_registration_requests
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='rfid_registration_requests'")
    if cur.fetchone():
        cur.execute("SELECT * FROM rfid_registration_requests")
        rfid_requests = cur.fetchall()
        for req in rfid_requests:
            cur.execute("""
                INSERT OR IGNORE INTO registration_requests
                (id, membership_id, house_id, requested_by_user_id, credential_type, status, extra_data, requested_at, completed_at)
                VALUES (?, ?, ?, ?, 'rfid', ?, ?, ?, ?)
            """, (
                req["id"], req["membership_id"], req["house_id"], req["requested_by_user_id"],
                req["status"], req["tag_uid"], req["requested_at"], req["completed_at"]
            ))
        print(f"  - Migrated {len(rfid_requests)} RFID registration requests")
        conn.commit()

    # Migrate credential_registration_requests
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='credential_registration_requests'")
    if cur.fetchone():
        cur.execute("SELECT * FROM credential_registration_requests")
        cred_requests = cur.fetchall()
        for req in cred_requests:
            cur.execute("""
                INSERT OR IGNORE INTO registration_requests
                (id, membership_id, house_id, requested_by_user_id, credential_type, status, extra_data, requested_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """, (
                req["id"], req["membership_id"], req["house_id"], req["requested_by_user_id"],
                req["credential_type"], req["status"], req["requested_at"], req["completed_at"]
            ))
        print(f"  - Migrated {len(cred_requests)} credential registration requests")
        conn.commit()

    # ═══════════════════════════════════════════════════════════════════════════════
    # Step 4: Drop old/redundant tables
    # ═══════════════════════════════════════════════════════════════════════════════
    print("\n[4/5] Dropping old tables...")

    tables_to_drop = [
        "auth_methods",
        "fingerprint_registration_requests",
        "rfid_registration_requests",
        "credential_registration_requests",
        "unlock_sessions",
    ]

    for table in tables_to_drop:
        cur.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
        if cur.fetchone():
            cur.execute(f"DROP TABLE {table}")
            print(f"  - Dropped {table}")
        else:
            print(f"  - {table} not found, skipping")

    conn.commit()

    # ═══════════════════════════════════════════════════════════════════════════════
    # Step 5: Clean up stale data
    # ═══════════════════════════════════════════════════════════════════════════════
    print("\n[5/5] Cleaning up stale data...")

    # Delete expired OTP codes
    cur.execute("DELETE FROM otp_codes WHERE expires_at < ?", (datetime.utcnow().isoformat(),))
    deleted_otps = cur.rowcount
    print(f"  - Deleted {deleted_otps} expired OTP codes")

    # Delete completed/failed registration requests older than 7 days
    cutoff = datetime.utcnow().isoformat()
    cur.execute("""
        DELETE FROM registration_requests
        WHERE status IN ('completed', 'failed')
        AND completed_at < datetime(?, '-7 days')
    """, (cutoff,))
    deleted_reqs = cur.rowcount
    print(f"  - Deleted {deleted_reqs} old registration requests")

    conn.commit()
    conn.close()

    print("\n" + "=" * 60)
    print("Migration completed successfully!")
    print("=" * 60)
    print("\nNew simplified schema:")
    print("  - credentials: Now includes enabled/priority (merged from auth_methods)")
    print("  - registration_requests: Unified table for all registration types")
    print("\nDropped tables:")
    print("  - auth_methods (merged into credentials)")
    print("  - fingerprint_registration_requests (merged into registration_requests)")
    print("  - rfid_registration_requests (merged into registration_requests)")
    print("  - credential_registration_requests (merged into registration_requests)")
    print("  - unlock_sessions (removed - using in-memory sessions)")


if __name__ == "__main__":
    migrate()

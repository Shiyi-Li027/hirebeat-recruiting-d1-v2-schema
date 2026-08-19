#!/usr/bin/env python3
"""Submit one synthetic Google-source event to the staging Ingress Worker."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_INGRESS_URL = (
    "https://hirebeat-submission-ingress-v1.shiyilidorothy.workers.dev"
)
DRIVE_FILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,}$")


def token_value() -> str:
    value = os.environ.get("INGRESS_INTERNAL_AUTH_TOKEN", "").strip()
    if value:
        return value
    return getpass.getpass("Ingress internal auth token (input hidden): ").strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--google-drive-file-id", required=True)
    parser.add_argument("--ingress-url", default=DEFAULT_INGRESS_URL)
    parser.add_argument(
        "--source-record-id",
        default="staging-google-synthetic-001",
        help="Reuse this value to test technical-redelivery idempotency.",
    )
    parser.add_argument(
        "--redelivery-mechanism",
        default="initial_delivery",
        choices=(
            "initial_delivery",
            "network_retry",
            "webhook_redelivery",
            "queue_retry",
            "poller_replay",
            "worker_restart_recovery",
            "unknown_technical_redelivery",
        ),
    )
    args = parser.parse_args()

    file_id = args.google_drive_file_id.strip()
    if not DRIVE_FILE_ID_PATTERN.fullmatch(file_id):
        parser.error("--google-drive-file-id does not look like a Google Drive file ID")

    token = token_value()
    if not token:
        print("ERROR: an Ingress authentication token is required", file=sys.stderr)
        return 2

    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    payload = {
        "sourceRecordId": args.source_record_id,
        "sourceEventKey": f"google-form:{args.source_record_id}",
        "sourceSubmittedAt": "2026-08-18T18:00:00.000Z",
        "deliveredAt": now,
        "technicalRedeliveryMechanism": args.redelivery_mechanism,
        "technicalRedeliveryCauseCode": (
            None
            if args.redelivery_mechanism == "initial_delivery"
            else "staging_acceptance_redelivery"
        ),
        "fields": {
            "Company ID": 1,
            "Company Name": "AGS Logistics",
            "Company Work Mode ID": 1,
            "Company Work Mode": "On-site",
            "Position ID": 1,
            "Position Name": "Operations Data Analyst (On-site)",
            "Candidate Name": "Alex Morgan",
            "Email Address": "alex.morgan.synthetic@example.com",
            "Phone Number": "+1 202 555 0147",
            "Start Working Date": "2026-09-01",
            "End Working Date": None,
            "Work Duration": "12 months",
            "Google Drive File ID": file_id,
            "Synthetic Acceptance Fixture": True,
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        args.ingress_url.rstrip("/") + "/internal/v1/sources/google-form",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "hirebeat-staging-acceptance/1.0",
        },
    )

    try:
        with urlopen(request, timeout=90) as response:
            response_body = response.read().decode("utf-8")
            print(json.dumps(json.loads(response_body), indent=2, sort_keys=True))
            print(f"HTTP status: {response.status}")
    except HTTPError as error:
        safe_body = error.read().decode("utf-8", errors="replace")
        print(f"ERROR: ingress_http_{error.code}: {safe_body}", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"ERROR: ingress_network_error: {error.reason}", file=sys.stderr)
        return 1
    finally:
        token = ""

    print(f"Stable source record ID: {args.source_record_id}")
    print("No authentication token or Resume content was written to disk.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

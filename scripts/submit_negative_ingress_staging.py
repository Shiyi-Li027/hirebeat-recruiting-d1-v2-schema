#!/usr/bin/env python3
"""Exercise non-mutating Staging Ingress authentication and envelope failures."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


DEFAULT_INGRESS_URL = (
    "https://hirebeat-submission-ingress-v1.shiyilidorothy.workers.dev"
)


def token_value() -> str:
    value = os.environ.get("INGRESS_INTERNAL_AUTH_TOKEN", "").strip()
    if value:
        return value
    return getpass.getpass("Ingress internal auth token (input hidden): ").strip()


def post(url: str, token: str, payload: object) -> tuple[int, dict[str, Any]]:
    request = Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "hirebeat-staging-negative-acceptance/1.0",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = json.loads(error.read().decode("utf-8", errors="replace"))
        return error.code, body


def safe_result(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "http_status": status,
        "error": body.get("error"),
        "request_id": body.get("requestId"),
        "writes_enabled": body.get("writesEnabled"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ingress-url", default=DEFAULT_INGRESS_URL)
    parser.add_argument(
        "--source-record-id", default="staging-google-malformed-envelope-001"
    )
    args = parser.parse_args()
    token = token_value()
    if not token:
        print("ERROR: an Ingress authentication token is required", file=sys.stderr)
        return 2

    endpoint = args.ingress_url.rstrip("/") + "/internal/v1/sources/google-form"
    invalid_status, invalid_body = post(endpoint, "invalid-staging-token", {})
    malformed_status, malformed_body = post(
        endpoint,
        token,
        {
            "sourceRecordId": args.source_record_id,
            "sourceEventKey": f"google-form:{args.source_record_id}",
            "fields": "deliberately-not-an-object",
        },
    )
    token = ""
    result = {
        "invalid_authentication": safe_result(invalid_status, invalid_body),
        "authenticated_malformed_envelope": safe_result(
            malformed_status, malformed_body
        ),
        "expected_database_writes": 0,
        "authentication_token_written_to_disk": False,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    if invalid_status != 401 or invalid_body.get("error") != "invalid_internal_authentication":
        raise SystemExit("invalid_authentication_boundary_failed")
    if malformed_status != 422 or malformed_body.get("error") != "source_fields_missing":
        raise SystemExit("malformed_envelope_boundary_failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

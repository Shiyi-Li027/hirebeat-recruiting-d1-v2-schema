#!/usr/bin/env python3
"""Canonical UTC storage and America/New_York human-display helpers."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any
from zoneinfo import ZoneInfo


STORAGE_TIMEZONE = "UTC"
BUSINESS_TIMEZONE = "America/New_York"
BUSINESS_ZONE = ZoneInfo(BUSINESS_TIMEZONE)
RFC3339_INSTANT = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


def parse_instant(value: str) -> dt.datetime:
    if not RFC3339_INSTANT.fullmatch(value):
        raise ValueError("timestamp_not_rfc3339_instant")
    parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    if parsed.tzinfo is None:
        raise ValueError("timestamp_timezone_required")
    return parsed.astimezone(dt.timezone.utc)


def eastern_display(value: str) -> str:
    local = parse_instant(value).astimezone(BUSINESS_ZONE)
    return f"{local.isoformat(timespec='milliseconds')}[{BUSINESS_TIMEZONE}]"


def add_human_time_columns(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep canonical UTC values and append Eastern columns for human CSVs."""
    converted: list[dict[str, Any]] = []
    for row in rows:
        output: dict[str, Any] = {}
        for key, value in row.items():
            output[key] = value
            if isinstance(value, str) and RFC3339_INSTANT.fullmatch(value):
                try:
                    output[f"{key}_eastern"] = eastern_display(value)
                except ValueError:
                    # Diagnostic export must preserve an invalid source value for review.
                    output[f"{key}_eastern"] = "INVALID_RFC3339_INSTANT"
        converted.append(output)
    return converted

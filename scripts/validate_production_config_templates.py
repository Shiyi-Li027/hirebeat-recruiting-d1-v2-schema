#!/usr/bin/env python3
"""Validate the tracked production Wrangler configuration templates."""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent

CONFIGS = {
    "root": ROOT / "wrangler.production.example.toml",
    "ingress": (
        ROOT
        / "workers"
        / "submission-ingress"
        / "wrangler.production.example.toml"
    ),
    "orchestrator": (
        ROOT
        / "workers"
        / "etl-orchestrator"
        / "wrangler.production.example.toml"
    ),
    "operations": (
        ROOT
        / "workers"
        / "operations-api"
        / "wrangler.production.example.toml"
    ),
}

EXPECTED_NAMES = {
    "root": "hirebeat-recruiting-d1-v2-schema-prod",
    "ingress": "hirebeat-submission-ingress-prod-v1",
    "orchestrator": "hirebeat-etl-orchestrator-prod-v1",
    "operations": "hirebeat-operations-api-prod-v1",
}

PRODUCTION_DATABASE_NAME = "hirebeat_recruiting_d1_v2_prod"
DATABASE_ID_PLACEHOLDER = "REPLACE_WITH_PRODUCTION_D1_DATABASE_ID"
PRODUCTION_BUCKET_NAME = "hirebeat-hr-raw-resumes-pdf-r2-prod-v1"
R2_BINDING = "hirebeat_hr_raw_resumes_pdf_r2_v1"

FORBIDDEN_TEXT = (
    'DEPLOYMENT_STAGE = "staging"',
    "ENABLE_STAGING_FAULT_INJECTION",
    "hirebeat_recruiting_d1_v2\"",
    "6c4275ca-faf3-4cba-867c-8ce807c30fc6",
    "-stg-",
)

errors: list[str] = []


def report(message: str) -> None:
    errors.append(message)


def require_equal(
    label: str,
    actual: Any,
    expected: Any,
) -> None:
    if actual != expected:
        report(
            f"{label}: expected {expected!r}, found {actual!r}"
        )


def require_single_table(
    config_name: str,
    data: dict[str, Any],
    table_name: str,
) -> dict[str, Any]:
    rows = data.get(table_name)

    if not isinstance(rows, list) or len(rows) != 1:
        report(
            f"{config_name}: expected exactly one "
            f"[[{table_name}]] table"
        )
        return {}

    row = rows[0]
    if not isinstance(row, dict):
        report(f"{config_name}: invalid [[{table_name}]] table")
        return {}

    return row


loaded: dict[str, dict[str, Any]] = {}

for config_name, config_path in CONFIGS.items():
    if not config_path.is_file():
        report(f"Missing production template: {config_path}")
        continue

    text = config_path.read_text(encoding="utf-8")

    for forbidden in FORBIDDEN_TEXT:
        if forbidden in text:
            report(
                f"{config_path}: forbidden staging or unsafe value "
                f"{forbidden!r}"
            )

    try:
        loaded[config_name] = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        report(f"{config_path}: invalid TOML: {exc}")

for config_name, data in loaded.items():
    require_equal(
        f"{config_name}.name",
        data.get("name"),
        EXPECTED_NAMES[config_name],
    )

    database = require_single_table(
        config_name,
        data,
        "d1_databases",
    )
    require_equal(
        f"{config_name}.d1.binding",
        database.get("binding"),
        "DB",
    )
    require_equal(
        f"{config_name}.d1.database_name",
        database.get("database_name"),
        PRODUCTION_DATABASE_NAME,
    )
    require_equal(
        f"{config_name}.d1.database_id",
        database.get("database_id"),
        DATABASE_ID_PLACEHOLDER,
    )
    require_equal(
        f"{config_name}.d1.migrations_table",
        database.get("migrations_table"),
        "d1_migrations",
    )

for config_name in ("ingress", "orchestrator", "operations"):
    data = loaded.get(config_name)
    if data is None:
        continue

    require_equal(
        f"{config_name}.workers_dev",
        data.get("workers_dev"),
        config_name == "operations",
    )

    variables = data.get("vars")
    if not isinstance(variables, dict):
        report(f"{config_name}: missing [vars] table")
        continue

    require_equal(
        f"{config_name}.DEPLOYMENT_STAGE",
        variables.get("DEPLOYMENT_STAGE"),
        "production",
    )

    if "ENABLE_STAGING_FAULT_INJECTION" in variables:
        report(
            f"{config_name}: staging fault injection must be absent"
        )

for config_name in ("root", "ingress"):
    data = loaded.get(config_name)
    if data is None:
        continue

    bucket = require_single_table(
        config_name,
        data,
        "r2_buckets",
    )
    require_equal(
        f"{config_name}.r2.binding",
        bucket.get("binding"),
        R2_BINDING,
    )
    require_equal(
        f"{config_name}.r2.bucket_name",
        bucket.get("bucket_name"),
        PRODUCTION_BUCKET_NAME,
    )

ingress = loaded.get("ingress")
if ingress is not None:
    require_equal(
        "ingress.preview_urls",
        ingress.get("preview_urls"),
        False,
    )

    variables = ingress.get("vars", {})
    require_equal(
        "ingress.SUBMISSION_UUID_NAMESPACE",
        variables.get("SUBMISSION_UUID_NAMESPACE"),
        "REPLACE_WITH_PRODUCTION_SUBMISSION_UUID_NAMESPACE",
    )
    require_equal(
        "ingress.PARSER_SERVICE_URL",
        variables.get("PARSER_SERVICE_URL"),
        "REPLACE_WITH_PRIVATE_PRODUCTION_PARSER_SERVICE_URL",
    )

    queues = ingress.get("queues", {})
    producers = queues.get("producers", [])
    consumers = queues.get("consumers", [])

    if len(producers) != 1:
        report("ingress: expected exactly one Queue producer")
    elif producers[0].get("queue") != (
        "hirebeat-submission-intake-prod-v1"
    ):
        report("ingress: incorrect production Queue producer")

    expected_consumer_queues = {
        "hirebeat-submission-intake-prod-v1",
        "hirebeat-submission-intake-dlq-prod-v1",
    }
    actual_consumer_queues = {
        row.get("queue") for row in consumers
    }
    require_equal(
        "ingress.Queue consumers",
        actual_consumer_queues,
        expected_consumer_queues,
    )

orchestrator = loaded.get("orchestrator")
if orchestrator is not None:
    variables = orchestrator.get("vars", {})
    require_equal(
        "orchestrator.ML_SERVICE_URL",
        variables.get("ML_SERVICE_URL"),
        "REPLACE_WITH_PRIVATE_PRODUCTION_ML_SERVICE_URL",
    )

    queues = orchestrator.get("queues", {})
    producers = queues.get("producers", [])
    if len(producers) != 1:
        report("orchestrator: expected exactly one Queue producer")
    elif producers[0].get("queue") != (
        "hirebeat-submission-intake-prod-v1"
    ):
        report("orchestrator: incorrect production Queue producer")

    workflows = orchestrator.get("workflows", [])
    workflow_names = {
        row.get("name") for row in workflows
    }
    require_equal(
        "orchestrator.workflows",
        workflow_names,
        {
            "hirebeat-workflow-a-prod-v1",
            "hirebeat-workflow-b-prod-v1",
        },
    )

operations = loaded.get("operations")
if operations is not None:
    require_equal(
        "operations.preview_urls",
        operations.get("preview_urls"),
        False,
    )

    variables = operations.get("vars", {})
    require_equal(
        "operations.ACCESS_TEAM_DOMAIN",
        variables.get("ACCESS_TEAM_DOMAIN"),
        "REPLACE_WITH_PRODUCTION_ACCESS_TEAM_DOMAIN",
    )
    require_equal(
        "operations.ACCESS_AUD",
        variables.get("ACCESS_AUD"),
        "REPLACE_WITH_PRODUCTION_ACCESS_AUD",
    )

if errors:
    print("Production configuration template validation: FAIL")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("Production configuration template validation: PASS")
print(f"Validated templates: {len(CONFIGS)}")
print("Production D1 isolation: PASS")
print("Production R2 isolation: PASS")
print("Production Queue/Workflow isolation: PASS")
print("workers.dev exposure policy: PASS")
print("Staging fault injection absent: PASS")

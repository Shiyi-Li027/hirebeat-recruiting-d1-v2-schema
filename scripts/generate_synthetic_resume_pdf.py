#!/usr/bin/env python3
"""Generate a synthetic English Resume PDF for staging acceptance only."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


DEFAULT_OUTPUTS = {
    "primary": Path(
        "test-exports/staging/synthetic-inputs/hirebeat-synthetic-resume.pdf"
    ),
    "resubmission": Path(
        "test-exports/staging/synthetic-inputs/"
        "hirebeat-synthetic-resubmission-resume.pdf"
    ),
    "jd_waiting": Path(
        "test-exports/staging/synthetic-inputs/"
        "hirebeat-synthetic-jd-waiting-resume.pdf"
    ),
}

RESUME_LINES = (
    "ALEX MORGAN",
    "Synthetic Staging Applicant",
    "alex.morgan.synthetic@example.com | +1 202 555 0147",
    "",
    "SUMMARY",
    "Data analyst with experience in Python, SQL, operational reporting,",
    "dashboard development, data quality validation, and statistical analysis.",
    "",
    "SKILLS",
    "Python, SQL, Excel, Tableau, Power BI, data visualization, ETL, Git",
    "",
    "EXPERIENCE",
    "Synthetic Analytics Lab | Data Analyst | 2024 - Present",
    "Built repeatable reporting workflows and validated operational datasets.",
    "Created SQL analyses and dashboards for logistics performance metrics.",
    "Documented data definitions, quality checks, and incident resolutions.",
    "",
    "EDUCATION",
    "Example State University | Bachelor of Science in Data Analytics | 2024",
    "",
    "PROJECTS",
    "Developed a synthetic shipment-delay analysis using Python and SQL.",
    "This PDF contains no real person, employer, credential, or contact data.",
)

RESUBMISSION_RESUME_LINES = (
    "RILEY CHEN",
    "Synthetic Resubmission Acceptance Applicant",
    "riley.chen.synthetic@example.com | +1 202 555 0198",
    "",
    "SUMMARY",
    "Data platform specialist with experience in Python, SQL, batch pipelines,",
    "warehouse modeling, quality monitoring, and operational dashboards.",
    "",
    "SKILLS",
    "Python, SQL, dbt, data warehouses, ETL, dashboards, Git, testing",
    "",
    "EXPERIENCE",
    "Synthetic Data Systems | Data Engineer | 2024 - Present",
    "Built scheduled ingestion pipelines and dimensional reporting models.",
    "Implemented automated data checks and documented production incidents.",
    "Maintained analytics datasets used by internal operations teams.",
    "",
    "EDUCATION",
    "Example Technical College | Bachelor of Science in Information Systems | 2024",
    "",
    "PROJECTS",
    "Created a synthetic warehouse monitoring project using Python and SQL.",
    "This PDF contains no real person, employer, credential, or contact data.",
)

JD_WAITING_RESUME_LINES = (
    "JORDAN LEE",
    "Synthetic Position JD Recovery Applicant",
    "jordan.lee.synthetic@example.com | +1 202 555 0176",
    "",
    "SUMMARY",
    "Data quality analyst with experience in SQL, Python, validation rules,",
    "pipeline monitoring, incident triage, and operational dashboards.",
    "",
    "SKILLS",
    "Python, SQL, data quality, ETL, monitoring, dashboards, Git, testing",
    "",
    "EXPERIENCE",
    "Synthetic Reliability Lab | Data Quality Analyst | 2024 - Present",
    "Built automated validation checks for recurring ingestion pipelines.",
    "Investigated data incidents and documented remediation outcomes.",
    "Created monitoring dashboards for freshness and completeness metrics.",
    "",
    "PROJECTS",
    "Created a synthetic data-quality monitoring project using Python and SQL.",
    "This PDF contains no real person, employer, credential, or contact data.",
)

FIXTURES = {
    "primary": RESUME_LINES,
    "resubmission": RESUBMISSION_RESUME_LINES,
    "jd_waiting": JD_WAITING_RESUME_LINES,
}


def pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(lines: tuple[str, ...]) -> bytes:
    commands = ["BT", "/F1 10 Tf", "48 760 Td", "14 TL"]
    for index, line in enumerate(lines):
        if index:
            commands.append("T*")
        commands.append(f"({pdf_escape(line)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii")

    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n"
        + stream
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    )

    document = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(document))
        document.extend(f"{number} 0 obj\n".encode("ascii"))
        document.extend(body)
        document.extend(b"\nendobj\n")

    xref_offset = len(document)
    document.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    document.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    document.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(document)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", choices=tuple(FIXTURES), default="primary")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    output = args.output or DEFAULT_OUTPUTS[args.fixture]
    payload = build_pdf(FIXTURES[args.fixture])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    print(
        {
            "fixture": args.fixture,
            "path": str(output.resolve()),
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "contains_real_person_data": False,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate a synthetic English Resume PDF for staging acceptance only."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


DEFAULT_OUTPUT = Path(
    "test-exports/staging/synthetic-inputs/hirebeat-synthetic-resume.pdf"
)

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


def pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf() -> bytes:
    commands = ["BT", "/F1 10 Tf", "48 760 Td", "14 TL"]
    for index, line in enumerate(RESUME_LINES):
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
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = build_pdf()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(
        {
            "path": str(args.output.resolve()),
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "contains_real_person_data": False,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

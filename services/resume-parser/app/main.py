"""Authenticated PDF-to-text service used by Submission Ingress."""

from __future__ import annotations

import hmac
import os
from typing import Annotated

import fitz
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel


SERVICE_NAME = "hirebeat-resume-parser"
SERVICE_VERSION = "1.0.0"
DEFAULT_MAX_PDF_BYTES = 10 * 1024 * 1024


class ParseResponse(BaseModel):
    text: str
    parser_name: str
    parser_version: str
    page_count: int


def _maximum_pdf_bytes() -> int:
    raw_value = os.getenv("MAX_PDF_BYTES", str(DEFAULT_MAX_PDF_BYTES))
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise RuntimeError("MAX_PDF_BYTES must be an integer") from exc
    if parsed <= 0:
        raise RuntimeError("MAX_PDF_BYTES must be positive")
    return parsed


def _authorize(authorization: str | None) -> None:
    expected = os.getenv("PARSER_SERVICE_AUTH_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="parser_auth_not_configured")
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid_parser_authentication")


app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "ok"}


@app.get("/ready")
def ready(authorization: str | None = Header(default=None)) -> dict[str, str | int]:
    """Authenticated readiness check including validated runtime limits."""
    _authorize(authorization)
    return {
        "status": "ready",
        "parser_name": "PyMuPDF",
        "parser_version": fitz.VersionBind,
        "maximum_pdf_bytes": _maximum_pdf_bytes(),
    }


@app.post("/parse-pdf", response_model=ParseResponse)
async def parse_pdf(
    file: Annotated[UploadFile, File(...)],
    authorization: Annotated[str | None, Header()] = None,
) -> ParseResponse:
    _authorize(authorization)
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="unsupported_pdf_content_type")

    content = await file.read(_maximum_pdf_bytes() + 1)
    if len(content) > _maximum_pdf_bytes():
        raise HTTPException(status_code=413, detail="pdf_too_large")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="invalid_pdf_signature")

    try:
        document = fitz.open(stream=content, filetype="pdf")
        try:
            # sort=True improves multi-column reading order. Page boundaries are
            # separated by one newline; no whitespace compaction or trimming is
            # applied to the returned text.
            pages = [page.get_text("text", sort=True) for page in document]
            text = "\n".join(pages)
            page_count = document.page_count
        finally:
            document.close()
    except (fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="pdf_parse_failed") from exc

    if not text.strip():
        raise HTTPException(status_code=422, detail="pdf_contains_no_text")
    return ParseResponse(
        text=text,
        parser_name="PyMuPDF",
        parser_version=fitz.VersionBind,
        page_count=page_count,
    )

from __future__ import annotations

import io
import os

import fitz
from fastapi.testclient import TestClient

from app.main import app


TOKEN = "test-parser-token-that-is-at-least-32-characters"


def _pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "EDUCATION")
    page.insert_text((72, 92), "New York University")
    output = document.tobytes()
    document.close()
    return output


def test_parser_requires_authentication(monkeypatch) -> None:
    monkeypatch.setenv("PARSER_SERVICE_AUTH_TOKEN", TOKEN)
    response = TestClient(app).post(
        "/parse-pdf",
        files={"file": ("resume.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")},
    )
    assert response.status_code == 401


def test_parser_returns_text_and_version(monkeypatch) -> None:
    monkeypatch.setenv("PARSER_SERVICE_AUTH_TOKEN", TOKEN)
    response = TestClient(app).post(
        "/parse-pdf",
        headers={"Authorization": f"Bearer {TOKEN}"},
        files={"file": ("resume.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")},
    )
    assert response.status_code == 200
    body = response.json()
    assert "EDUCATION" in body["text"]
    assert body["parser_name"] == "PyMuPDF"
    assert body["parser_version"]
    assert body["page_count"] == 1

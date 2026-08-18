# HireBeat Resume Parser

Internal authenticated FastAPI service that converts the exact PDF bytes stored
by Submission Ingress into UTF-8 Resume text. It uses PyMuPDF, preserves line
breaks, returns parser identity/version, and never writes D1 or R2.

Required secret: `PARSER_SERVICE_AUTH_TOKEN` (minimum 32 characters).

Optional variable: `MAX_PDF_BYTES` (default `10485760`).

Run locally:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export PARSER_SERVICE_AUTH_TOKEN='replace-with-a-long-random-secret'
uvicorn app.main:app --reload --port 8080
pytest
```

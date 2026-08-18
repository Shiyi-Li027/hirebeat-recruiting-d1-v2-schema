"""Authenticated all-MiniLM-L6-v2 cosine-similarity service."""

from __future__ import annotations

import hashlib
import hmac
import os
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer


SERVICE_NAME = "hirebeat-ml-inference"
SERVICE_VERSION = "1.0.0"
MODEL_NAME = "all-MiniLM-L6-v2"
MODEL_PROVIDER = "sentence_transformers"
PINNED_MODEL_REVISION = "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"


class SimilarityRequest(BaseModel):
    resume_text: str = Field(min_length=1)
    position_jd: str = Field(min_length=1)


class SimilarityResponse(BaseModel):
    match_score: float
    similarity_metric: str
    model_name: str
    model_provider: str
    model_revision: str | None
    resume_text_sha256: str
    position_jd_sha256: str


def _authorize(authorization: str | None) -> None:
    expected = os.getenv("ML_SERVICE_AUTH_TOKEN", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="ml_auth_not_configured")
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid_ml_authentication")


@lru_cache(maxsize=1)
def _model() -> SentenceTransformer:
    revision = os.getenv("MODEL_REVISION", PINNED_MODEL_REVISION)
    if revision != PINNED_MODEL_REVISION:
        raise RuntimeError("unsupported_model_revision")
    return SentenceTransformer(
        f"sentence-transformers/{MODEL_NAME}",
        revision=revision,
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "ok"}


@app.get("/ready")
def ready(authorization: str | None = Header(default=None)) -> dict[str, str]:
    _authorize(authorization)
    _model()
    return {
        "status": "ready",
        "model_name": MODEL_NAME,
        "model_revision": PINNED_MODEL_REVISION,
    }


@app.post("/v1/similarity", response_model=SimilarityResponse)
def similarity(
    request: SimilarityRequest,
    authorization: str | None = Header(default=None),
) -> SimilarityResponse:
    _authorize(authorization)
    embeddings = _model().encode(
        [request.resume_text, request.position_jd],
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    score = float(np.dot(embeddings[0], embeddings[1]))
    return SimilarityResponse(
        match_score=max(-1.0, min(1.0, score)),
        similarity_metric="cosine_similarity",
        model_name=MODEL_NAME,
        model_provider=MODEL_PROVIDER,
        model_revision=PINNED_MODEL_REVISION,
        resume_text_sha256=_sha256(request.resume_text),
        position_jd_sha256=_sha256(request.position_jd),
    )

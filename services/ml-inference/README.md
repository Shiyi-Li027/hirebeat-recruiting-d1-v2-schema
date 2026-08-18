# HireBeat ML Inference

Internal authenticated FastAPI service for the currently frozen v1 model:
`all-MiniLM-L6-v2` with normalized embeddings and cosine similarity.

The service deliberately preserves the current Colab behavior of sending the
complete Resume text and complete Position JD. Long-text chunking is recorded
as a future optimization and is not silently introduced here.

Required secret: `ML_SERVICE_AUTH_TOKEN` (minimum 32 characters).

Recommended immutable deployment variable: `MODEL_REVISION`.

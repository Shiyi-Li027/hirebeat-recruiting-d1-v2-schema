# HireBeat ML Inference

Internal authenticated FastAPI service for the currently frozen v1 model:
`all-MiniLM-L6-v2` with normalized embeddings and cosine similarity.

The service deliberately preserves the current Colab behavior of sending the
complete Resume text and complete Position JD. Long-text chunking is recorded
as a future optimization and is not silently introduced here.

Required secret: `ML_SERVICE_AUTH_TOKEN` (minimum 32 characters).

The reviewed model revision is pinned to
`c9745ed1d9f207416be6d2e6f8de32d1f16199bf`. The Docker build downloads that
exact revision into the image and runtime network downloads are disabled. The
service rejects a different `MODEL_REVISION` instead of silently changing ML
behavior.

The pinned revision changes model delivery only. The frozen v1 behavior still
sends the complete Resume text and complete Position JD to the model and uses
normalized embeddings with cosine similarity.

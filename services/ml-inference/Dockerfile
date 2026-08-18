FROM python:3.12-slim

ARG MODEL_REVISION=c9745ed1d9f207416be6d2e6f8de32d1f16199bf

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    SENTENCE_TRANSFORMERS_HOME=/home/appuser/.cache/sentence-transformers \
    MODEL_REVISION=${MODEL_REVISION}

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /home/appuser/.cache/sentence-transformers \
    && chown -R appuser:appuser /home/appuser
COPY app ./app
USER appuser

# Resolve and cache the exact reviewed Hugging Face revision while the image is
# built. Runtime instances can then start without downloading model artifacts.
RUN python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', revision=os.environ['MODEL_REVISION'])"

ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

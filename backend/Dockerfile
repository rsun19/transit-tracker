FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

COPY backend/pyproject.toml /app/backend/pyproject.toml
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -e .

COPY backend /app/backend

WORKDIR /app/backend/mbta-server

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "mbta.asgi:application", "--host", "0.0.0.0", "--port", "8000"]

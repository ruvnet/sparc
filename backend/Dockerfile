# Base image for both dev and prod
FROM python:3.9-slim as python-base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    POETRY_VERSION=1.4.2 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1 \
    PYSETUP_PATH="/opt/pysetup" \
    VENV_PATH="/opt/pysetup/.venv"

ENV PATH="$POETRY_HOME/bin:$VENV_PATH/bin:$PATH"

# Builder stage
FROM python-base as builder
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        curl \
        build-essential

# Install poetry
RUN curl -sSL https://install.python-poetry.org | python3 -

# Copy project dependency files
WORKDIR $PYSETUP_PATH
COPY poetry.lock pyproject.toml ./

# Install runtime deps
RUN poetry install --no-dev

# Development image
FROM python-base as development
ENV FASTAPI_ENV=development

WORKDIR $PYSETUP_PATH

# Copy dependencies from builder
COPY --from=builder $POETRY_HOME $POETRY_HOME
COPY --from=builder $PYSETUP_PATH $PYSETUP_PATH

# Copy application code
COPY . .

EXPOSE 8000

CMD ["poetry", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Production image
FROM python:3.9-slim as production
ENV FASTAPI_ENV=production

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /opt/pysetup/.venv /app/.venv
COPY . .

ENV PATH="/app/.venv/bin:$PATH"

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

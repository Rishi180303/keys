FROM python:3.12-slim AS base
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY keys ./keys
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" KEYS_RAW=/work/raw KEYS_DATA=/work/data KEYS_MODELS=/work/models PYTHONUNBUFFERED=1 GIT_PYTHON_REFRESH=quiet
RUN mkdir -p /work/raw /work/data /work/models
ENTRYPOINT ["python", "scripts/job.py"]

FROM base AS train
CMD ["train"]

FROM public.ecr.aws/lambda/python:3.12 AS serve
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
# install the locked dependencies straight into the lambda python; --inexact keeps the runtime's own packages
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/var/lang
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project --inexact
COPY keys ${LAMBDA_TASK_ROOT}/keys
CMD ["keys.serve.handler"]

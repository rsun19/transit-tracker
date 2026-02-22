## Installing:

Run `uv sync`

## Starting a virtual environment:

In the backend directory, run:

- Windows: `.venv\Scripts\activate`
- Linux/Mac: `source .venv/bin/activate`

## Run command:

1. `cd mbta-server`
2. `python -m uvicorn mbta.asgi:application --reload --host 127.0.0.1 --port 8000`

## Linting:

To check: `ruff check`
To format: `ruff format` 
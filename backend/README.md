## Installing:

Run `make install-all` from the root or `uv sync` in this directory.

## Starting a virtual environment:

In the backend directory, run:

- Windows: `.venv\Scripts\activate`
- Linux/Mac: `source .venv/bin/activate`

## Run command:

`make run-uvicorn` from the root

OR

1. `cd mbta-server`
2. `python -m uvicorn mbta.asgi:application --reload --host 127.0.0.1 --port 8000`

## Linting:

To check: `ruff check`
To format: `ruff format`
To fix: `ruff check --fix` 
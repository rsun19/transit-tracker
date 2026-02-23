#### Note: Please run make commands in a `Git Bash` terminal if on Windows.

## Installing:

1. Add your MBTA API key in `.env.local` as `MBTA_KEY`.
2. (Optional but recommended) Add a Redis URL in `.env.local` as `REDIS_URL` (defaults to `redis://localhost:6379/0`).
3. Run `make install-all` from the root or `uv sync` in this directory.

## Starting a virtual environment:

In the backend directory, run:

- Windows: `.venv\Scripts\activate`
- Linux/Mac: `source .venv/bin/activate`


## Run command:

`make run-backend` from the root

OR

1. `cd mbta-server`
2. In one terminal, run the background MBTA alerts worker:
	`python manage.py mbta_alerts_worker`
3. In another terminal, run the ASGI server:
	`python -m uvicorn mbta.asgi:application --reload --host 127.0.0.1 --port 8000`

## Linting:

To check: `ruff check`
To format: `ruff format`
To fix: `ruff check --fix` 

## Static transit data import (Redis)

Use the management command below to ingest CSV/JSON files from `backend/static` into
versioned Redis keys, then atomically flip the `current_version` pointer only after
successful import:

1. `cd mbta-server`
2. `python manage.py import_static_transit_data --data-version v2026Q1`

Useful options:

- `--static-dir <path>` to import from another folder.
- `--namespace <prefix>` to customize Redis key prefix (default: `mbta:static:transit`).
- `--delete-previous` to remove keys from the prior version after swap.
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
## Overview

This is a monorepo that contains transit tracking information for multiple public transit agencies across the USA. We use readily available API endpoints to track real-time transit data.

## Contributing

Feel free to contribute to this project. Please provide an overview of your contribution with unit tests and testing instructions in your pull request.

#### Note: Please run make commands in a `Git Bash` terminal if on Windows.

## Setting up

1. Add your MBTA developer key in `.env.local`
2. Run `make install-all`

## To run:

Run `make run-backend`

## To test:

Run `make test`

## Docker Compose (backend + worker + frontend + redis)

1. Set your MBTA key in your shell environment (optional; defaults to `dummy-key`):
	- Git Bash: `export MBTA_KEY="your_mbta_key"`
2. Start all services from repo root:
	- `docker compose up --build`
3. Endpoints:
	- Frontend: `http://localhost:3000`
	- Backend: `http://localhost:8000`
	- Redis: `localhost:6379`

To stop and remove containers:

- `docker compose down`

## Docker Development (hot reload)

Use the development override file to enable hot reload for backend and frontend:

- `docker compose -f docker-compose.yml -f docker-compose.development.yaml up --build`

This mode bind-mounts local source code into containers and runs:

- Backend with `uvicorn --reload`
- Frontend with `next dev`

To stop:

- `docker compose -f docker-compose.yml -f docker-compose.development.yaml down`
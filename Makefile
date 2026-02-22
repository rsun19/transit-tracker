PYTHON ?= python
VENV_DIR = backend/.venv
VENV_PY = backend/.venv/bin/python
VENV_PIP = backend/.venv/bin/pip

.PHONY: help venv install-deps install-all run-backend test lint format

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  help           Show this help"
	@echo "  venv           Create virtualenv at backend/.venv"
	@echo "  install-deps   Install dependencies (uses 'uv sync' if available)"
	@echo "  install-all    Run install-deps"
	@echo "  run-backend    Run the ASGI app via uvicorn"
	@echo "  test           Run Django tests (backend/mbta-server)"

install-deps:
	@echo "Installing dependencies"
	@if command -v uv >/dev/null 2>&1; then \
		echo "Using 'uv sync' to install dependencies and create venv if needed"; \
		(cd backend && uv sync); \
	else \
		if [ ! -d "$(VENV_DIR)" ]; then \
			echo "Creating virtualenv at $(VENV_DIR)"; \
			$(PYTHON) -m venv $(VENV_DIR); \
		fi; \
		if ! $(VENV_PY) -m pip --version >/dev/null 2>&1; then \
			echo "Bootstrapping pip in venv"; \
			$(VENV_PY) -m ensurepip || true; \
			$(VENV_PY) -m pip install --upgrade pip || true; \
		fi; \
		echo "Installing via pip (editable install from backend if pyproject.toml exists)"; \
		$(VENV_PY) -m pip install --upgrade pip setuptools build; \
		if [ -f backend/pyproject.toml ]; then \
			$(VENV_PIP) install -e backend; \
		fi; \
	fi

install-all: install-deps

run-backend:
	@if [ ! -d "$(VENV_DIR)" ]; then \
		echo "Virtualenv does not exist. Run 'make install-all' first."; \
		exit 1; \
	fi
	@echo "Starting uvicorn (mbta.asgi:application)"
	cd backend/mbta-server && \
		if [ -f "../../$(VENV_DIR)/Scripts/python.exe" ]; then \
			../../$(VENV_DIR)/Scripts/python.exe -m uvicorn mbta.asgi:application --reload --host 127.0.0.1 --port 8000; \
		else \
			../../$(VENV_PY) -m uvicorn mbta.asgi:application --reload --host 127.0.0.1 --port 8000; \
		fi

test:
	@echo "Running Django tests (backend/mbta-server)"
	cd backend/mbta-server && \
		if [ -f "../../$(VENV_DIR)/Scripts/python.exe" ]; then \
			../../$(VENV_DIR)/Scripts/python.exe manage.py test; \
		else \
			../../$(VENV_PY) manage.py test; \
		fi
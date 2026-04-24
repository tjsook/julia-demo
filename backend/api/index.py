"""ASGI entrypoint shim for exposing the FastAPI backend under the `/api` prefix."""

from app.main import create_app

app = create_app(root_path="/api")

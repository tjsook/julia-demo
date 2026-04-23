"""Vercel entrypoint for the FastAPI backend under the `/api` prefix."""

from app.main import create_app

app = create_app(root_path="/api")

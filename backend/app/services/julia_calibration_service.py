"""Load and cache Julia ROI calibration config."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.schemas.julia_roi_models import JuliaCalibrationModel

_DEFAULT_TTL_SECONDS = 30.0
_DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "julia" / "calibration.json"


@dataclass(frozen=True)
class JuliaCalibrationError(Exception):
    """Expected calibration-loading failures surfaced as stable API errors."""

    code: str
    detail: str


class JuliaCalibrationService:
    """Fetch calibration JSON with a short in-process TTL cache."""

    def __init__(
        self,
        *,
        path: Path | None = None,
        ttl_seconds: float = _DEFAULT_TTL_SECONDS,
    ) -> None:
        self._path = path or _DEFAULT_PATH
        self._ttl_seconds = ttl_seconds
        self._cache: JuliaCalibrationModel | None = None
        self._expires_at = 0.0

    def get_calibration(self) -> JuliaCalibrationModel:
        """Return parsed calibration, reloading from disk when TTL expires."""
        now = time.monotonic()
        if self._cache is not None and now < self._expires_at:
            return self._cache

        calibration = self._load_from_disk()
        self._cache = calibration
        self._expires_at = now + self._ttl_seconds
        return calibration

    def _load_from_disk(self) -> JuliaCalibrationModel:
        if not self._path.exists():
            raise JuliaCalibrationError(
                "calibration_missing",
                f"Julia calibration file not found at {self._path}.",
            )

        try:
            raw = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            raise JuliaCalibrationError(
                "calibration_unreadable",
                f"Julia calibration file is unreadable: {exc}",
            ) from exc

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise JuliaCalibrationError(
                "calibration_invalid_json",
                f"Julia calibration JSON is invalid: {exc}",
            ) from exc

        try:
            return JuliaCalibrationModel.model_validate(payload)
        except Exception as exc:
            raise JuliaCalibrationError(
                "calibration_invalid_schema",
                f"Julia calibration schema validation failed: {exc}",
            ) from exc


@lru_cache(maxsize=1)
def get_calibration_service() -> JuliaCalibrationService:
    """Return a singleton calibration service."""
    return JuliaCalibrationService()


def get_calibration() -> JuliaCalibrationModel:
    """Convenience accessor for the current calibration snapshot."""
    return get_calibration_service().get_calibration()

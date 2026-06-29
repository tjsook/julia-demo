"""Pydantic models for Julia ROI calibration, extraction, and responses."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONSTANT_SYMBOLS: tuple[str, ...] = (
    "D",
    "R",
    "Up",
    "Di",
    "Hb",
    "Dr",
    "Lc",
    "Oa",
    "G",
    "Fg",
    "Pr",
)

INPUT_SYMBOLS: tuple[str, ...] = ("T", "S", "P", "Ld", "Du")

EquationId = Literal["E1", "E2", "E3", "E3a", "E3b", "E3c", "E4", "E5"]
InputSymbol = Literal["T", "S", "P", "Ld", "Du"]
InputSource = Literal["rep", "derived", "default"]


class JuliaCalibrationConstant(BaseModel):
    """One tunable ROI constant loaded from calibration.json."""

    value: float
    label: str
    unit: str
    calibrated: bool = False


class JuliaDerivationRule(BaseModel):
    """Resolution rule for one extracted ROI input."""

    kind: Literal["flat", "linear"]
    value: float | None = None
    multiplier: float | None = None
    divisor: float | None = None
    min: float | None = None
    max: float | None = None
    round: Literal["ceil", "floor", "round"] | None = None
    source: str

    @model_validator(mode="after")
    def _validate_rule(self) -> JuliaDerivationRule:
        if self.kind == "flat" and self.value is None:
            raise ValueError('Flat derivation rules must include a "value".')
        if self.kind == "linear" and self.multiplier is None:
            raise ValueError('Linear derivation rules must include a "multiplier".')
        return self


class JuliaPainPointConfig(BaseModel):
    """Calibration config for one ROI pain point."""

    id: str
    label: str
    threshold: float
    equation_id: EquationId
    trigger_phrases: list[str]


class JuliaIntentClassifierConfig(BaseModel):
    """Deterministic intent classifier knobs loaded from calibration.json."""

    length_threshold: int = Field(ge=1)
    metric_count_threshold: int = Field(ge=1)
    metric_vocabulary: list[str]
    roi_verb_patterns: list[str]
    doc_terminal_triggers: list[str]


class JuliaExtractionConfig(BaseModel):
    """LLM extraction thresholds."""

    numeric_confidence_threshold: float = Field(ge=0.0, le=1.0)


class JuliaCalibrationModel(BaseModel):
    """Top-level calibration payload loaded from JSON."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str
    honesty_markers_enabled: bool = True
    constants: dict[str, JuliaCalibrationConstant]
    derivation_rules: dict[InputSymbol, JuliaDerivationRule]
    pain_points: list[JuliaPainPointConfig]
    intent_classifier: JuliaIntentClassifierConfig
    extraction: JuliaExtractionConfig

    @model_validator(mode="after")
    def _validate_required_symbols(self) -> JuliaCalibrationModel:
        missing_constants = [symbol for symbol in CONSTANT_SYMBOLS if symbol not in self.constants]
        if missing_constants:
            raise ValueError(f"Calibration constants missing required symbols: {missing_constants}.")

        missing_rules = [symbol for symbol in INPUT_SYMBOLS[1:] if symbol not in self.derivation_rules]
        if missing_rules:
            raise ValueError(f"Derivation rules missing required symbols: {missing_rules}.")

        if not self.pain_points:
            raise ValueError("Calibration must define at least one pain point.")
        return self


class JuliaExtractedValue(BaseModel):
    """One model-extracted numeric input candidate."""

    value: float
    confidence: float = Field(ge=0.0, le=1.0)


class JuliaExtractionVariables(BaseModel):
    """Numerical variables extracted from one transcript."""

    T: JuliaExtractedValue | None = None
    S: JuliaExtractedValue | None = None
    P: JuliaExtractedValue | None = None
    Ld: JuliaExtractedValue | None = None
    Du: JuliaExtractedValue | None = None


class JuliaPainPointMatch(BaseModel):
    """Pain point predicted from transcript content."""

    id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str


class JuliaROIExtractionLLMResponse(BaseModel):
    """Raw LLM structured-output shape before threshold filtering."""

    company_name: str | None = None
    pain_points: list[JuliaPainPointMatch] = Field(default_factory=list)
    variables: JuliaExtractionVariables = Field(default_factory=JuliaExtractionVariables)


class JuliaROIExtractionResult(BaseModel):
    """Post-filter extraction payload used by the ROI engine."""

    company_name: str | None = None
    matched_pain_points: list[JuliaPainPointMatch] = Field(default_factory=list)
    variables: JuliaExtractionVariables = Field(default_factory=JuliaExtractionVariables)


class JuliaResolvedInput(BaseModel):
    """Final value and provenance for an ROI input variable."""

    value: float
    source: InputSource
    confidence: float | None = None
    rule: str | None = None


class JuliaEquationResult(BaseModel):
    """A single evaluated ROI equation ready for frontend display."""

    id: EquationId
    label: str
    formula: str
    inputs_used: dict[str, float]
    result: float
    unit: Literal["usd_per_year"] = "usd_per_year"
    calibration_status: Literal["placeholder", "calibrated"]


class JuliaROISummary(BaseModel):
    """Headline totals from evaluated ROI equations."""

    gross_annual_value: float
    hemut_cost_per_year: float
    net_annual_value: float
    roi_multiple: float


class JuliaROIAnalysisPayload(BaseModel):
    """Main ROI payload for intent='roi_analysis'."""

    company_name: str | None = None
    matched_pain_points: list[JuliaPainPointMatch] = Field(default_factory=list)
    inputs: dict[InputSymbol, JuliaResolvedInput]
    equations: list[JuliaEquationResult] = Field(default_factory=list)
    summary: JuliaROISummary
    honesty_markers: list[str] = Field(default_factory=list)


class JuliaROIPendingInput(BaseModel):
    """Prompt shown when required ROI fields are missing."""

    missing: list[Literal["fleet_size"]]
    detail: str


class JuliaROIEngineResult(BaseModel):
    """Union of successful ROI analysis or pending-input response."""

    payload: JuliaROIAnalysisPayload | None = None
    pending: JuliaROIPendingInput | None = None

    @model_validator(mode="after")
    def _validate_union(self) -> JuliaROIEngineResult:
        if (self.payload is None) == (self.pending is None):
            raise ValueError("Exactly one of payload or pending must be set.")
        return self

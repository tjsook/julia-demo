"""Julia ROI equation engine and response assembly."""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.schemas.julia_roi_models import (
    EquationId,
    JuliaCalibrationModel,
    JuliaEquationResult,
    JuliaExtractionVariables,
    JuliaPainPointMatch,
    JuliaResolvedInput,
    JuliaROIAnalysisPayload,
    JuliaROIEngineResult,
    JuliaROIExtractionResult,
    JuliaROIPendingInput,
    JuliaROISummary,
)

_FLEET_SIZE_REQUIRED_DETAIL = "Fleet size is required. Ask the prospect how many trucks they run."


@dataclass(frozen=True)
class _EquationDef:
    label: str
    formula: str
    constants: tuple[str, ...]


_EQUATION_DEFS: dict[EquationId, _EquationDef] = {
    "E1": _EquationDef(
        label="Matching algorithms (Helm)",
        formula="Ld × D × S × R × Up",
        constants=("D", "R", "Up"),
    ),
    "E2": _EquationDef(
        label="Detention recovery",
        formula="Ld × D × Di × Hb × Dr × Du",
        constants=("D", "Di", "Hb", "Dr"),
    ),
    "E3": _EquationDef(
        label="Office labor automation",
        formula="P × Lc × Oa",
        constants=("Lc", "Oa"),
    ),
    "E3a": _EquationDef(
        label="Voice / phone work savings",
        formula="P × Lc × 0.15",
        constants=("Lc",),
    ),
    "E3b": _EquationDef(
        label="Order entry / re-keying savings",
        formula="P × Lc × 0.10",
        constants=("Lc",),
    ),
    "E3c": _EquationDef(
        label="Invoicing / billing savings",
        formula="P × Lc × 0.05",
        constants=("Lc",),
    ),
    "E4": _EquationDef(
        label="Fuel card savings",
        formula="T × G × Fg",
        constants=("G", "Fg"),
    ),
    "E5": _EquationDef(
        label="1% freight performance uplift",
        formula="(Ld × D × R) × 0.01",
        constants=("D", "R"),
    ),
}


class JuliaROIEngine:
    """Resolve inputs, evaluate selected equations, and build ROI payloads."""

    def evaluate_roi(
        self,
        *,
        transcript: str,
        extraction: JuliaROIExtractionResult,
        calibration: JuliaCalibrationModel,
    ) -> JuliaROIEngineResult:
        sanitized_variables, range_rejections = self._sanitize_extracted_variables(extraction.variables)

        if sanitized_variables.T is None:
            return JuliaROIEngineResult(
                pending=JuliaROIPendingInput(
                    missing=["fleet_size"],
                    detail=_FLEET_SIZE_REQUIRED_DETAIL,
                )
            )

        inputs = self._resolve_inputs(sanitized_variables, calibration)
        fleet_size = inputs.get("T")
        if fleet_size is None:
            return JuliaROIEngineResult(
                pending=JuliaROIPendingInput(
                    missing=["fleet_size"],
                    detail=_FLEET_SIZE_REQUIRED_DETAIL,
                )
            )

        verified_pain_points, evidence_markers = self._verify_pain_point_evidence(
            transcript=transcript,
            pain_point_matches=extraction.matched_pain_points,
            calibration=calibration,
        )
        thresholded_pain_points, threshold_markers = self._threshold_filter_pain_points(
            pain_point_matches=verified_pain_points,
            calibration=calibration,
        )
        equations_to_run, matched_pain_points = self._selected_equations(
            thresholded_pain_points,
            calibration,
        )
        equation_results = [
            self._evaluate_equation(equation_id, inputs, calibration)
            for equation_id in equations_to_run
        ]

        gross_annual_value = sum(result.result for result in equation_results)
        hemut_cost_per_year = inputs["T"].value * calibration.constants["Pr"].value * 12
        net_annual_value = gross_annual_value
        roi_multiple = 0.0 if hemut_cost_per_year == 0 else gross_annual_value / hemut_cost_per_year

        summary = JuliaROISummary(
            gross_annual_value=round(gross_annual_value, 2),
            hemut_cost_per_year=round(hemut_cost_per_year, 2),
            net_annual_value=round(net_annual_value, 2),
            roi_multiple=round(roi_multiple, 2),
        )

        honesty_markers = self._honesty_markers(
            inputs=inputs,
            equation_results=equation_results,
            calibration=calibration,
            range_rejections=range_rejections,
            pain_point_drop_markers=[*evidence_markers, *threshold_markers],
        )

        return JuliaROIEngineResult(
            payload=JuliaROIAnalysisPayload(
                company_name=extraction.company_name,
                matched_pain_points=matched_pain_points,
                inputs=inputs,
                equations=equation_results,
                summary=summary,
                honesty_markers=honesty_markers,
            )
        )

    def _sanitize_extracted_variables(
        self,
        variables: JuliaExtractionVariables,
    ) -> tuple[JuliaExtractionVariables, dict[str, str]]:
        range_rejections: dict[str, str] = {}

        t_value = variables.T
        if t_value is not None and (t_value.value < 1 or not float(t_value.value).is_integer()):
            range_rejections["T"] = (
                f"T extracted as {_format_number(t_value.value)} but must be an integer >= 1."
            )
            t_value = None

        s_value = variables.S
        if s_value is not None and s_value.value is not None and (s_value.value < 0 or s_value.value > 1):
            range_rejections["S"] = (
                f"S extracted as {_format_number(s_value.value)} but must be between 0 and 1. "
                "Ignored numeric value and used qualitative/default fallback."
            )
            s_value = s_value.model_copy(update={"value": None})

        p_value = variables.P
        if p_value is not None and (
            p_value.value < 1 or p_value.value > 10000 or not float(p_value.value).is_integer()
        ):
            range_rejections["P"] = (
                f"P extracted as {_format_number(p_value.value)} but must be an integer between 1 and 10,000. "
                "Treated as not provided; derived from T."
            )
            p_value = None

        ld_value = variables.Ld
        if ld_value is not None:
            if ld_value.value <= 0:
                range_rejections["Ld"] = (
                    f"Ld extracted as {_format_number(ld_value.value)} but must be greater than 0. "
                    "Treated as not provided; derived from T."
                )
                ld_value = None
            elif t_value is not None:
                ld_ceiling = t_value.value * 5
                if ld_value.value > ld_ceiling:
                    range_rejections["Ld"] = (
                        f"Ld extracted as {_format_number(ld_value.value)} but exceeds sanity ceiling of T × 5 "
                        f"({_format_number(ld_ceiling)} for {_format_number(t_value.value)} trucks). "
                        "Treated as not provided; derived from T."
                    )
                    ld_value = None

        du_value = variables.Du
        if du_value is not None and du_value.value is not None and (du_value.value < 0 or du_value.value > 1):
            range_rejections["Du"] = (
                f"Du extracted as {_format_number(du_value.value)} but must be between 0 and 1. "
                "Ignored numeric value and used qualitative/default fallback."
            )
            du_value = du_value.model_copy(update={"value": None})

        return (
            JuliaExtractionVariables(
                T=t_value,
                S=s_value,
                P=p_value,
                Ld=ld_value,
                Du=du_value,
            ),
            range_rejections,
        )

    def _resolve_inputs(
        self,
        variables: JuliaExtractionVariables,
        calibration: JuliaCalibrationModel,
    ) -> dict[str, JuliaResolvedInput | None]:
        t_value = variables.T
        resolved: dict[str, JuliaResolvedInput | None] = {
            "T": None,
            "S": None,
            "P": None,
            "Ld": None,
            "Du": None,
        }

        if t_value is not None:
            resolved["T"] = JuliaResolvedInput(
                value=t_value.value,
                source="rep",
                confidence=t_value.confidence,
            )

        resolved["S"] = self._resolve_qualitative_input(
            symbol="S",
            candidate=variables.S,
            fleet_size=resolved["T"].value if resolved["T"] else None,
            calibration=calibration,
        )
        resolved["P"] = self._resolve_optional_input(
            symbol="P",
            candidate=variables.P,
            fleet_size=resolved["T"].value if resolved["T"] else None,
            calibration=calibration,
        )
        resolved["Ld"] = self._resolve_optional_input(
            symbol="Ld",
            candidate=variables.Ld,
            fleet_size=resolved["T"].value if resolved["T"] else None,
            calibration=calibration,
        )
        resolved["Du"] = self._resolve_qualitative_input(
            symbol="Du",
            candidate=variables.Du,
            fleet_size=resolved["T"].value if resolved["T"] else None,
            calibration=calibration,
        )
        return resolved

    def _verify_pain_point_evidence(
        self,
        *,
        transcript: str,
        pain_point_matches: list[JuliaPainPointMatch],
        calibration: JuliaCalibrationModel,
    ) -> tuple[list[JuliaPainPointMatch], list[str]]:
        config = calibration.evidence_verification
        if not config.enabled:
            return pain_point_matches, []

        normalized_transcript = self._normalize_text(transcript, calibration=calibration)
        min_length = config.min_length_chars
        surviving: list[JuliaPainPointMatch] = []
        dropped_markers: list[str] = []

        for match in pain_point_matches:
            normalized_evidence = self._normalize_text(match.evidence, calibration=calibration)
            if len(normalized_evidence) < min_length:
                dropped_markers.append(
                    f"Dropped '{match.id}' - evidence too short ({len(normalized_evidence)} chars)."
                )
                continue
            if normalized_evidence not in normalized_transcript:
                dropped_markers.append(
                    f"Dropped '{match.id}' - LLM-supplied evidence not present in transcript."
                )
                continue
            surviving.append(match)

        return surviving, dropped_markers

    def _threshold_filter_pain_points(
        self,
        *,
        pain_point_matches: list[JuliaPainPointMatch],
        calibration: JuliaCalibrationModel,
    ) -> tuple[list[JuliaPainPointMatch], list[str]]:
        thresholds = {pain.id: pain.threshold for pain in calibration.pain_points}
        surviving: list[JuliaPainPointMatch] = []
        dropped_markers: list[str] = []

        for match in pain_point_matches:
            threshold = thresholds.get(match.id)
            if threshold is None:
                continue
            if match.confidence < threshold:
                dropped_markers.append(
                    f"Dropped '{match.id}' - confidence {match.confidence:.2f} below threshold {threshold:.2f}."
                )
                continue
            surviving.append(match)

        return surviving, dropped_markers

    def _resolve_qualitative_input(
        self,
        *,
        symbol: str,
        candidate,
        fleet_size: float | None,
        calibration: JuliaCalibrationModel,
    ) -> JuliaResolvedInput:
        if candidate is not None:
            if candidate.value is not None:
                return JuliaResolvedInput(
                    value=float(candidate.value),
                    source="rep",
                    confidence=candidate.confidence,
                )
            if candidate.qualitative_tag:
                buckets = (
                    calibration.qualitative_buckets.S.model_dump()
                    if symbol == "S"
                    else calibration.qualitative_buckets.Du.model_dump()
                )
                if candidate.qualitative_tag in buckets:
                    return JuliaResolvedInput(
                        value=float(buckets[candidate.qualitative_tag]),
                        source="rep_qualitative",
                        confidence=candidate.confidence,
                        qualitative_tag=candidate.qualitative_tag,
                    )

        return self._resolve_optional_input(
            symbol=symbol,
            candidate=None,
            fleet_size=fleet_size,
            calibration=calibration,
        )

    def _resolve_optional_input(
        self,
        *,
        symbol: str,
        candidate,
        fleet_size: float | None,
        calibration: JuliaCalibrationModel,
    ) -> JuliaResolvedInput:
        if candidate is not None:
            return JuliaResolvedInput(
                value=candidate.value,
                source="rep",
                confidence=candidate.confidence,
            )

        rule = calibration.derivation_rules[symbol]
        if rule.kind == "linear":
            if fleet_size is None:
                raise ValueError(
                    f'Cannot derive "{symbol}" without fleet size (T). This should be handled by roi_pending_input.'
                )
            if rule.divisor is not None:
                if rule.divisor == 0:
                    raise ValueError(f'Calibration divisor for "{symbol}" cannot be zero.')
                value = fleet_size / float(rule.divisor)
                rule_text = f"T/{rule.divisor:g}"
            else:
                value = fleet_size * float(rule.multiplier)
                rule_text = f"T*{rule.multiplier:g}"
            value = self._apply_rounding(value, rule.round)
            if rule.min is not None:
                value = max(value, float(rule.min))
            if rule.max is not None:
                value = min(value, float(rule.max))
            return JuliaResolvedInput(
                value=value,
                source="derived",
                rule=f"{rule.round or 'none'}({rule_text})",
            )

        if rule.value is None:
            raise ValueError(f'Flat calibration rule for "{symbol}" is missing a value.')
        return JuliaResolvedInput(value=float(rule.value), source="default")

    def _apply_rounding(self, value: float, mode: str | None) -> float:
        if mode is None:
            return value
        if mode == "ceil":
            return float(math.ceil(value))
        if mode == "floor":
            return float(math.floor(value))
        if mode == "round":
            return float(round(value))
        raise ValueError(f"Unsupported rounding mode: {mode}.")

    def _selected_equations(
        self,
        matched_pain_points: list[JuliaPainPointMatch],
        calibration: JuliaCalibrationModel,
    ) -> tuple[list[EquationId], list[JuliaPainPointMatch]]:
        pain_point_map = {pain_point.id: pain_point for pain_point in calibration.pain_points}
        selected: list[JuliaPainPointMatch] = [
            pain_point for pain_point in matched_pain_points if pain_point.id in pain_point_map
        ]

        selected_equations: list[EquationId] = []
        seen: set[str] = set()
        for pain_point in selected:
            equation_id = pain_point_map[pain_point.id].equation_id
            if equation_id not in seen:
                seen.add(equation_id)
                selected_equations.append(equation_id)

        if "E3" in selected_equations:
            selected_equations = [
                equation_id
                for equation_id in selected_equations
                if equation_id not in {"E3a", "E3b", "E3c"}
            ]

        ordered = [
            equation_id
            for equation_id in ("E1", "E2", "E3", "E3a", "E3b", "E3c", "E4", "E5")
            if equation_id in selected_equations
        ]
        return ordered, selected

    def _evaluate_equation(
        self,
        equation_id: EquationId,
        inputs: dict[str, JuliaResolvedInput | None],
        calibration: JuliaCalibrationModel,
    ) -> JuliaEquationResult:
        eq_def = _EQUATION_DEFS[equation_id]

        t = _required_input(inputs, "T")
        s = _required_input(inputs, "S")
        p = _required_input(inputs, "P")
        ld = _required_input(inputs, "Ld")
        du = _required_input(inputs, "Du")

        constants = calibration.constants

        if equation_id == "E1":
            inputs_used = {
                "Ld": ld,
                "D": constants["D"].value,
                "S": s,
                "R": constants["R"].value,
                "Up": constants["Up"].value,
            }
            result = ld * constants["D"].value * s * constants["R"].value * constants["Up"].value
        elif equation_id == "E2":
            inputs_used = {
                "Ld": ld,
                "D": constants["D"].value,
                "Di": constants["Di"].value,
                "Hb": constants["Hb"].value,
                "Dr": constants["Dr"].value,
                "Du": du,
            }
            result = (
                ld
                * constants["D"].value
                * constants["Di"].value
                * constants["Hb"].value
                * constants["Dr"].value
                * du
            )
        elif equation_id == "E3":
            inputs_used = {"P": p, "Lc": constants["Lc"].value, "Oa": constants["Oa"].value}
            result = p * constants["Lc"].value * constants["Oa"].value
        elif equation_id == "E3a":
            inputs_used = {"P": p, "Lc": constants["Lc"].value}
            result = p * constants["Lc"].value * 0.15
        elif equation_id == "E3b":
            inputs_used = {"P": p, "Lc": constants["Lc"].value}
            result = p * constants["Lc"].value * 0.10
        elif equation_id == "E3c":
            inputs_used = {"P": p, "Lc": constants["Lc"].value}
            result = p * constants["Lc"].value * 0.05
        elif equation_id == "E4":
            inputs_used = {"T": t, "G": constants["G"].value, "Fg": constants["Fg"].value}
            result = t * constants["G"].value * constants["Fg"].value
        elif equation_id == "E5":
            inputs_used = {"Ld": ld, "D": constants["D"].value, "R": constants["R"].value}
            annual_freight = ld * constants["D"].value * constants["R"].value
            result = annual_freight * 0.01
        else:
            raise ValueError(f"Unsupported equation id: {equation_id}")

        status = "calibrated"
        if any(not calibration.constants[symbol].calibrated for symbol in eq_def.constants):
            status = "placeholder"

        return JuliaEquationResult(
            id=equation_id,
            label=eq_def.label,
            formula=eq_def.formula,
            inputs_used={key: round(float(value), 4) for key, value in inputs_used.items()},
            result=round(float(result), 2),
            calibration_status=status,
        )

    def _honesty_markers(
        self,
        *,
        inputs: dict[str, JuliaResolvedInput | None],
        equation_results: list[JuliaEquationResult],
        calibration: JuliaCalibrationModel,
        range_rejections: dict[str, str],
        pain_point_drop_markers: list[str],
    ) -> list[str]:
        markers: list[str] = [*pain_point_drop_markers]

        s = _required_input_obj(inputs, "S")
        if "S" in range_rejections:
            markers.append(range_rejections["S"])
        if s.source == "rep_qualitative" and s.qualitative_tag:
            markers.append(
                f"S inferred from rep phrasing -> '{s.qualitative_tag}' ({s.value:.2f}). "
                "Override if more precise data is known."
            )
        elif s.source == "default":
            if "S" not in range_rejections:
                markers.append("S (% spot) defaulted to 10% — rep did not specify.")

        du = _required_input_obj(inputs, "Du")
        if "Du" in range_rejections:
            markers.append(range_rejections["Du"])
        if du.source == "rep_qualitative" and du.qualitative_tag:
            markers.append(
                f"Du inferred from rep phrasing -> '{du.qualitative_tag}' ({du.value:.2f}). "
                "Override if more precise data is known."
            )
        elif du.source == "default":
            if "Du" not in range_rejections:
                markers.append("Du (% detention uncaptured) defaulted to 50% — rep did not specify.")

        p = _required_input_obj(inputs, "P")
        if p.source == "derived":
            if "P" in range_rejections:
                markers.append(range_rejections["P"])
            else:
                trucks = _required_input(inputs, "T")
                markers.append(f"P (office people) derived from T (ceil({trucks:g}/7) = {p.value:g}).")

        ld = _required_input_obj(inputs, "Ld")
        if ld.source == "derived":
            if "Ld" in range_rejections:
                markers.append(range_rejections["Ld"])
            else:
                ld_multiplier = calibration.derivation_rules["Ld"].multiplier
                if ld_multiplier is None:
                    raise ValueError('Derivation rule for "Ld" is missing required "multiplier".')
                markers.append(
                    f"Ld (loads/day) derived from T ({_required_input(inputs, 'T'):g} × {ld_multiplier:g} = {ld.value:g})."
                )

        markers.extend(self._implied_ratio_markers(inputs=inputs, calibration=calibration))

        used_constants: set[str] = {"Pr"}
        for equation in equation_results:
            used_constants.update(_EQUATION_DEFS[equation.id].constants)

        placeholders = [symbol for symbol in used_constants if not calibration.constants[symbol].calibrated]
        if placeholders:
            ordered = [symbol for symbol in ("D", "R", "Up", "Di", "Hb", "Dr", "Lc", "Oa", "G", "Fg", "Pr") if symbol in placeholders]
            if len(ordered) == 1:
                markers.append(
                    f"Constant {ordered[0]} is a placeholder value pending calibration with real fleet data."
                )
            else:
                markers.append(
                    f"Constants {', '.join(ordered)} are placeholder values pending calibration with real fleet data."
                )

        return markers if calibration.honesty_markers_enabled else []

    def _normalize_text(self, text: str, *, calibration: JuliaCalibrationModel) -> str:
        normalized = text
        normalize_config = calibration.evidence_verification.normalize

        if normalize_config.lowercase:
            normalized = normalized.lower()

        if normalize_config.strip_punctuation:
            punctuation_table = str.maketrans({char: " " for char in ".,!?;:'\"()[]-/\\"})
            normalized = normalized.translate(punctuation_table)

        if normalize_config.collapse_whitespace:
            normalized = " ".join(normalized.split())

        return normalized.strip()

    def _implied_ratio_markers(
        self,
        *,
        inputs: dict[str, JuliaResolvedInput | None],
        calibration: JuliaCalibrationModel,
    ) -> list[str]:
        trucks = _required_input(inputs, "T")
        loads_per_day = _required_input(inputs, "Ld")
        operating_days = calibration.constants["D"].value
        revenue_per_load = calibration.constants["R"].value

        implied_loads_per_truck_per_year = loads_per_day * operating_days / trucks
        implied_revenue_per_truck_per_year = loads_per_day * operating_days * revenue_per_load / trucks

        markers: list[str] = []

        loads_band = calibration.sanity_bands.loads_per_truck_per_year
        if implied_loads_per_truck_per_year > loads_band.soft_ceiling:
            markers.append(
                f"Implied activity: {round(implied_loads_per_truck_per_year):,} loads/truck/year. "
                f"Industry typical is {round(loads_band.industry_low):,}–{round(loads_band.industry_high):,}. "
                "Confirm fleet activity with prospect before presenting."
            )

        revenue_band = calibration.sanity_bands.revenue_per_truck_per_year_usd
        if implied_revenue_per_truck_per_year > revenue_band.soft_ceiling:
            markers.append(
                f"Implied revenue: ${round(implied_revenue_per_truck_per_year):,}/truck/year. "
                f"Industry typical is ${revenue_band.industry_low / 1000:.0f}K–${revenue_band.industry_high / 1000:.0f}K. "
                "Confirm with prospect."
            )

        return markers


def _required_input(inputs: dict[str, JuliaResolvedInput | None], symbol: str) -> float:
    entry = _required_input_obj(inputs, symbol)
    return float(entry.value)


def _required_input_obj(inputs: dict[str, JuliaResolvedInput | None], symbol: str) -> JuliaResolvedInput:
    entry = inputs.get(symbol)
    if entry is None:
        raise ValueError(f'Missing required input "{symbol}" during ROI evaluation.')
    return entry


def _format_number(value: float) -> str:
    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.2f}"

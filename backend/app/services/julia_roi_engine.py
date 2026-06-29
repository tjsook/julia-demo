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
        extraction: JuliaROIExtractionResult,
        calibration: JuliaCalibrationModel,
    ) -> JuliaROIEngineResult:
        if extraction.variables.T is None:
            return JuliaROIEngineResult(
                pending=JuliaROIPendingInput(
                    missing=["fleet_size"],
                    detail=_FLEET_SIZE_REQUIRED_DETAIL,
                )
            )

        inputs = self._resolve_inputs(extraction.variables, calibration)
        fleet_size = inputs.get("T")
        if fleet_size is None:
            return JuliaROIEngineResult(
                pending=JuliaROIPendingInput(
                    missing=["fleet_size"],
                    detail=_FLEET_SIZE_REQUIRED_DETAIL,
                )
            )

        equations_to_run, matched_pain_points = self._selected_equations(
            extraction.matched_pain_points,
            calibration,
        )
        equation_results = [
            self._evaluate_equation(equation_id, inputs, calibration)
            for equation_id in equations_to_run
        ]

        gross_annual_value = sum(result.result for result in equation_results)
        hemut_cost_per_year = inputs["T"].value * calibration.constants["Pr"].value * 12
        net_annual_value = gross_annual_value - hemut_cost_per_year
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

        resolved["S"] = self._resolve_optional_input(
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
        resolved["Du"] = self._resolve_optional_input(
            symbol="Du",
            candidate=variables.Du,
            fleet_size=resolved["T"].value if resolved["T"] else None,
            calibration=calibration,
        )
        return resolved

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
    ) -> list[str]:
        markers: list[str] = []

        s = _required_input_obj(inputs, "S")
        if s.source == "default":
            markers.append("S (% spot) defaulted to 50% — rep did not specify.")

        du = _required_input_obj(inputs, "Du")
        if du.source == "default":
            markers.append("Du (% detention uncaptured) defaulted to 50% — rep did not specify.")

        p = _required_input_obj(inputs, "P")
        if p.source == "derived":
            trucks = _required_input(inputs, "T")
            markers.append(f"P (office people) derived from T (ceil({trucks:g}/7) = {p.value:g}).")

        ld = _required_input_obj(inputs, "Ld")
        if ld.source == "derived":
            markers.append(f"Ld (loads/day) derived from T ({_required_input(inputs, 'T'):g} × 1.3 = {ld.value:g}).")

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


def _required_input(inputs: dict[str, JuliaResolvedInput | None], symbol: str) -> float:
    entry = _required_input_obj(inputs, symbol)
    return float(entry.value)


def _required_input_obj(inputs: dict[str, JuliaResolvedInput | None], symbol: str) -> JuliaResolvedInput:
    entry = inputs.get(symbol)
    if entry is None:
        raise ValueError(f'Missing required input "{symbol}" during ROI evaluation.')
    return entry

"""Deterministic (rule-based) scoring of source columns against standard fields."""

from __future__ import annotations

import importlib.util
import os
import re
from dataclasses import dataclass
from typing import Any

_this_dir = os.path.dirname(os.path.abspath(__file__))


def _load_mod(name: str, path: str):
    import sys as _sys
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    _sys.modules[name] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_aliases_mod = _load_mod("hn_aliases", os.path.join(_this_dir, "aliases.py"))
_schema_mod = _load_mod("hn_schema_det", os.path.join(_this_dir, "schema_mapper.py"))

EXPECTED_DTYPE = _aliases_mod.EXPECTED_DTYPE
FIELD_ALIASES = _aliases_mod.FIELD_ALIASES
FIELD_ALIASES_LIST = _aliases_mod.FIELD_ALIASES_LIST
FIELD_TO_SEMANTIC_TAGS = _aliases_mod.FIELD_TO_SEMANTIC_TAGS
SEMANTIC_TAG_TO_FIELDS = _aliases_mod.SEMANTIC_TAG_TO_FIELDS
_norm = _aliases_mod._norm
infer_value_type = _aliases_mod.infer_value_type
semantic_hints = _aliases_mod.semantic_hints
STANDARD_FIELDS = _schema_mod.STANDARD_FIELDS


@dataclass
class ScoredMatch:
    std_field: str
    score: float
    components: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        meta = _STD_FIELD_META.get(self.std_field, {})
        return {
            "std_field": self.std_field,
            "score": round(self.score, 4),
            "components": {k: round(v, 4) for k, v in self.components.items()},
            "description": meta.get("description", ""),
            "type": meta.get("type", ""),
            "expected_dtype": EXPECTED_DTYPE.get(self.std_field, "text"),
            "aliases": FIELD_ALIASES_LIST.get(self.std_field, []),
            "semantic_tags": FIELD_TO_SEMANTIC_TAGS.get(self.std_field, []),
            "why": _summarise_score(self.components),
        }


_STD_NAMES_NORM: dict[str, str] = {
    _norm(f["name"]): f["name"] for f in STANDARD_FIELDS
}
_STD_FIELD_META: dict[str, dict[str, Any]] = {
    f["name"]: f for f in STANDARD_FIELDS
}


def _tokenize(s: str) -> set[str]:
    """Split into lowercase alpha-numeric tokens."""
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _summarise_score(components: dict[str, float]) -> str:
    reasons: list[str] = []
    if components.get("exact", 0) >= 1.0:
        reasons.append("exact header name match")
    elif components.get("alias", 0) >= 0.85:
        reasons.append("strong alias match")
    elif components.get("fuzzy", 0) >= 0.45:
        reasons.append("meaningful token overlap")

    if components.get("semantic", 0) > 0:
        reasons.append("sample values support the field semantics")

    if components.get("type", 0) > 0:
        reasons.append("sample value type matches")
    elif components.get("type", 0) < 0:
        reasons.append("sample value type conflicts")

    return "; ".join(reasons) if reasons else "weak deterministic evidence"


def score_deterministic(
    source_name: str,
    samples: list[str],
    top_n: int = 5,
) -> list[ScoredMatch]:
    """Score *source_name* against every standard field; return top *top_n*."""
    src_norm = _norm(source_name)
    src_tokens = _tokenize(source_name)
    val_type = infer_value_type(samples)
    sem_tags = semantic_hints(samples)

    sem_boost_fields: set[str] = set()
    for tag in sem_tags:
        for f in SEMANTIC_TAG_TO_FIELDS.get(tag, []):
            sem_boost_fields.add(f)

    results: list[ScoredMatch] = []

    for field_def in STANDARD_FIELDS:
        fname = field_def["name"]
        fname_norm = _norm(fname)
        fname_tokens = _tokenize(fname)

        components: dict[str, float] = {}

        # 1. Exact name match
        if src_norm == fname_norm:
            components["exact"] = 1.0
        else:
            components["exact"] = 0.0

        # 2. Alias match
        aliases = FIELD_ALIASES.get(fname, set())
        if src_norm in aliases:
            components["alias"] = 0.9
        else:
            components["alias"] = 0.0

        # 3. Fuzzy (token Jaccard)
        jacc = _jaccard(src_tokens, fname_tokens)
        components["fuzzy"] = min(jacc * 0.8, 0.8)

        # 4. Type compatibility bonus
        expected = EXPECTED_DTYPE.get(fname, "text")
        if expected == val_type and val_type != "text":
            components["type"] = 0.1
        elif expected == val_type:
            components["type"] = 0.0
        else:
            components["type"] = -0.05

        # 5. Semantic hint bonus
        if fname in sem_boost_fields:
            components["semantic"] = 0.1
        else:
            components["semantic"] = 0.0

        score = max(
            components["exact"],
            components["alias"],
            components["fuzzy"],
        ) + components["type"] + components["semantic"]

        results.append(ScoredMatch(std_field=fname, score=score, components=components))

    results.sort(key=lambda m: m.score, reverse=True)
    return results[:top_n]

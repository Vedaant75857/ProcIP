"""Token-based scoring for SQL join-key candidates."""

from __future__ import annotations

import re
from typing import Any


def tokenize_column_name(name: str) -> list[str]:
    """Split a column name into normalized lowercase tokens (underscores, camelCase)."""
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", name or "")
    s = re.sub(r"[_\-\s]+", "_", s).lower()
    return [t for t in s.split("_") if t]


def token_jaccard(tokens_a: list[str], tokens_b: list[str]) -> float:
    """Jaccard similarity between two token sets."""
    if not tokens_a and not tokens_b:
        return 0.0
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    return inter / union if union else 0.0


def score_candidates(
    candidates: list[dict[str, Any]],
    fact_cols: list[str],
    dim_cols: list[str],
) -> list[dict[str, Any]]:
    """
    Rank SQL candidates: 0.6 * match_rate_distinct + 0.3 * name_sim + 0.1 * (1 - card_diff).

    `fact_cols` / `dim_cols` are reserved for parity with the Node port (filtering extensions).
    """
    _ = fact_cols, dim_cols
    scored: list[dict[str, Any]] = []
    for c in candidates:
        mr = float(c.get("match_rate_distinct") or 0)
        cd = float(c.get("cardinality_diff_abs") or 0)
        main_col = c.get("main_column") or ""
        dim_col = c.get("dimension_column") or ""
        ns = token_jaccard(
            tokenize_column_name(str(main_col)),
            tokenize_column_name(str(dim_col)),
        )
        composite = 0.6 * mr + 0.3 * ns + 0.1 * max(0.0, 1.0 - cd)
        row = dict(c)
        row["name_similarity"] = ns
        row["composite_score"] = composite
        scored.append(row)
    scored.sort(key=lambda r: -r["composite_score"])
    return scored

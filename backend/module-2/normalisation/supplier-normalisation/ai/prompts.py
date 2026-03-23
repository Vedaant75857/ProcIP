"""Prompts for supplier name normalisation."""

SYSTEM_PROMPT_FIX_SUPPLIER_NAMES = "Output JSON only."

INSTRUCTIONS_FIX_SUPPLIER_NAMES = """Standardize these Company/Supplier names.
- Remove legal suffixes (Inc, Ltd, LLC, GmbH, Corp, S.A., etc.).
- Remove websites (.com, .net) and clean typos.
- Keep it short but recognizable (e.g., 'Amazon.com Inc' -> 'Amazon').
- Standardize casing to Title Case.
- Merge obvious duplicates (e.g., 'MICROSOFT CORP' and 'Microsoft Corporation' -> 'Microsoft').

Input: {batch}
Return JSON ONLY: {{ "Original": "Standardized" }}"""


SYSTEM_PROMPT_FIX_PLANTS = "JSON only"

INSTRUCTIONS_FIX_PLANTS = """Clean these Plant/Site names:
- Remove internal codes, numbers-only prefixes, and noise.
- Standardize to readable, clean location names.
- Keep city/site identifiers but remove system codes.
- Example: 'PLT-001 Chicago Warehouse' -> 'Chicago Warehouse'

Input: {batch}
Return JSON ONLY: {{ "Original": "Cleaned" }}"""

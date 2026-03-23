"""Prompts for country normalisation."""

SYSTEM_PROMPT_FIX_COUNTRY = "Output JSON only."

INSTRUCTIONS_FIX_COUNTRY = """Standardize these country names to their **Full English Name** (Title Case).
- Expand abbreviations: 'US', 'USA' -> 'United States'.
- 'DE', 'Germ' -> 'Germany'.
- 'UK', 'GB' -> 'United Kingdom'.
- 'Aus' -> 'Australia'.
- Handle misspellings and partial names.
- Use ISO standard country names.

Input: {batch}
Return JSON ONLY: {{ "Original": "Standardized" }}"""


SYSTEM_PROMPT_FIX_REGIONS = "JSON only"

INSTRUCTIONS_FIX_REGIONS = """Map these values to standard regions: 'NA' (North America), 'EMEA' (Europe, Middle East, Africa), 'APAC' (Asia Pacific), 'LATAM' (Latin America).
- Use country knowledge to assign regions.
- Handle abbreviations, partial names, and codes.
- 'US', 'USA', 'United States', 'Canada', 'Mexico' -> 'NA'
- European/Middle Eastern/African countries -> 'EMEA'
- Asian/Pacific countries -> 'APAC'
- South/Central American countries -> 'LATAM'

Input: {batch}
Return JSON ONLY: {{ "Original": "Region" }}"""

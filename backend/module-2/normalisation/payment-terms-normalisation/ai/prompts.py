"""Prompts for payment terms normalisation."""

SYSTEM_PROMPT_FIX_TERMS = "Output JSON only. Follow the exact format specified."

INSTRUCTIONS_FIX_TERMS = """Standardize these Payment Terms into THREE separate values:
1. "days"     - The net payment days as a string number ("30", "45", "0").
                Leave BLANK "" if you cannot determine days.
2. "discount" - Human-readable discount description. Leave "" if none.
3. "doubt"    - "Yes" if the value does NOT look like a payment term at all
                (e.g. a date like "2024-12-06", random text, descriptions).
                Otherwise "".

Input: {unique_values}

REFERENCE EXAMPLES (learn the patterns, don't hardcode):
SAP/ERP Shorthand Codes:
  "N30"            -> days:"30",  discount:"",                                     doubt:""
  "D30"            -> days:"30",  discount:"",                                     doubt:""
  "PerUnitN30"     -> days:"30",  discount:"",                                     doubt:""
  "1%30N45"        -> days:"45",  discount:"1% discount if paid within 30 days",   doubt:""
  "2%15THN30"      -> days:"30",  discount:"2% discount if paid by 15th of month", doubt:""
  "2%10TH"         -> days:"",    discount:"2% discount if paid by 10th of month", doubt:""
  "N15THCURR"      -> days:"",    discount:"Due by 15th of current month",         doubt:""
  "DUE1STNEXT"     -> days:"",    discount:"Due 1st of next month",                doubt:""
Standard Text:
  "Net 30" -> days:"30", "2/10 Net 30" -> days:"30", discount:"2% within 10 days"
Discount-Only (no separate net period, days = discount period):
  "2% on 20" -> days:"20", discount:"2% discount if paid within 20 days"
  "1% on 10" -> days:"10", discount:"1% discount if paid within 10 days"
Immediate: "COD"/"Cash"/"Immediate" -> days:"0"
Plain Numbers: "20" -> days:"20"
Missing: "nan"/"" -> days:"", discount:"", doubt:""
Not a payment term: "2024-12-06" -> doubt:"Yes"

Parse the PATTERN, not exact matches. Return JSON ONLY:
{{ "Original String": {{"days":"30","discount":"","doubt":""}}, ... }}"""

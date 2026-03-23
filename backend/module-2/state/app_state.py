"""Module 2 application state -- session-based, no DataFrames."""

import os

from shared.db import get_session_db

app_state = {
    "session_id": None,
    "file_name": None,
    "openai_api_key": os.getenv("PORTKEY_API_KEY", ""),
    "ai_provider": os.getenv("AI_PROVIDER", "portkey"),
    "ai_model": os.getenv("PORTKEY_MODEL", "@personal-openai/gpt-5.4"),
    "disabled_sheets": [],
    "progress": {
        "active": False,
        "current": 0,
        "total": 0,
        "message": "",
        "percent": 0,
    },
}


def get_state():
    return app_state


def get_conn():
    """Get the SQLite connection for the current session."""
    sid = app_state.get("session_id")
    if not sid:
        raise ValueError("No active session")
    return get_session_db(sid)


def update_progress(current, total, message, eta_seconds=None):
    percent = int((current / total) * 100) if total > 0 else 0
    app_state["progress"] = {
        "active": True,
        "current": current,
        "total": total,
        "message": message,
        "percent": percent,
        "eta_seconds": eta_seconds,
    }


def clear_progress():
    app_state["progress"] = {
        "active": False,
        "current": 0,
        "total": 0,
        "message": "",
        "percent": 0,
        "eta_seconds": None,
    }

"""Timestamp serialization shared by the API layer.

SQLite's CURRENT_TIMESTAMP is UTC but naive, while the UI renders Asia/Shanghai
(docs/DESIGN.md §9). Shipping a bare "2026-10-03T03:07:18" makes a browser read it as
local time and show the wrong hour, so every exposed timestamp goes through here.
"""

from datetime import datetime, timezone
from typing import Any, Optional


def iso_utc(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        stamped = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return stamped.isoformat()
    return str(value)

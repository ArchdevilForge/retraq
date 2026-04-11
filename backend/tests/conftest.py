from pathlib import Path
import sys

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def sqlite_database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'trading.db'}"

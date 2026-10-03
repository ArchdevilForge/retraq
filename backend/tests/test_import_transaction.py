"""A failed import must never destroy the data it was replacing (rank-1 data loss)."""
import os

import pytest
from fastapi.testclient import TestClient

from models import Dataset, Trade, TradeFill

SAMPLE_LANGGE = os.path.join(
    os.path.dirname(__file__), "..", "..", "samples", "bit-langge-delivery-example.xlsx"
)

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
GARBAGE = b"this is definitely not a spreadsheet\x00\x01\x02"


def _require_sample():
    if not os.path.isfile(SAMPLE_LANGGE):
        pytest.skip(f"sample workbook missing: {SAMPLE_LANGGE}")


def _import_sample(client: TestClient, label: str, template: str = "auto"):
    with open(SAMPLE_LANGGE, "rb") as f:
        return client.post(
            "/api/trades/import",
            params={"template": template, "replace": True, "label": label},
            files={"file": ("bit-langge-delivery-example.xlsx", f, XLSX_MIME)},
        )


def _post_garbage(client: TestClient, label: str):
    return client.post(
        "/api/trades/import",
        params={"template": "auto", "replace": True, "label": label},
        files={"file": ("broken.xlsx", GARBAGE, XLSX_MIME)},
    )


def _counts(client: TestClient, db_session, dataset_id: int) -> tuple[int, int, int]:
    """(API-visible trade total, stored trade rows, stored fill rows)."""
    headers = {"X-Dataset-Id": str(dataset_id)}
    trades = client.get("/api/trades", headers=headers, params={"limit": 1})
    assert trades.status_code == 200
    return (
        trades.json()["total"],
        db_session.query(Trade).filter(Trade.dataset_id == dataset_id).count(),
        db_session.query(TradeFill).filter(TradeFill.dataset_id == dataset_id).count(),
    )


def test_failed_replace_keeps_existing_trades(client: TestClient, db_session):
    _require_sample()
    label = "import-guard"

    first = _import_sample(client, label)
    assert first.status_code == 200, first.text
    dataset_id = first.json()["dataset_id"]
    before = _counts(client, db_session, dataset_id)
    assert before[0] > 0 and before[1] > 0 and before[2] > 0

    broken = _post_garbage(client, label)
    assert 400 <= broken.status_code < 500, broken.text

    assert _counts(client, db_session, dataset_id) == before


def test_failed_parse_after_replace_delete_rolls_back(client: TestClient, db_session):
    """This path reaches the replace-delete before failing, so only the
    single-transaction guarantee can save the rows."""
    _require_sample()
    label = "import-guard-wrong-template"

    first = _import_sample(client, label)
    assert first.status_code == 200, first.text
    dataset_id = first.json()["dataset_id"]
    before = _counts(client, db_session, dataset_id)
    assert before[0] > 0 and before[2] > 0

    wrong = _import_sample(client, label, template="binance_futures")
    assert wrong.status_code == 400, wrong.text

    assert _counts(client, db_session, dataset_id) == before


def test_failed_first_import_leaves_no_phantom_dataset(client: TestClient, db_session):
    _require_sample()
    label = "phantom-never-created"

    wrong = _import_sample(client, label, template="binance_futures")
    assert wrong.status_code == 400, wrong.text

    listed = [d["name"] for d in client.get("/api/datasets").json()["data"]]
    assert label not in listed
    assert db_session.query(Dataset).filter(Dataset.name == label).first() is None


def test_garbage_first_import_leaves_no_phantom_dataset(client: TestClient, db_session):
    label = "phantom-garbage"

    broken = _post_garbage(client, label)
    assert 400 <= broken.status_code < 500, broken.text

    listed = [d["name"] for d in client.get("/api/datasets").json()["data"]]
    assert label not in listed
    assert db_session.query(Dataset).filter(Dataset.name == label).first() is None


def test_oversized_upload_is_rejected_before_parsing(client: TestClient):
    """The body is read into memory, so the size cap has to come before pandas sees it."""
    from main import MAX_UPLOAD_BYTES

    blob = b"0" * (MAX_UPLOAD_BYTES + 1)
    res = client.post(
        "/api/trades/import",
        params={"template": "langge", "replace": True, "label": "too-big"},
        files={"file": ("huge.csv", blob, "text/csv")},
    )
    assert res.status_code == 413
    assert "文件过大" in res.json()["detail"]

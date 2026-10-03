"""Shared API test fixtures."""
import os
import tempfile

# main.py runs ensure_database() at import time; point it at a throwaway file so a
# test run never migrates or purges the developer's real backend/trading.db.
_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="retraq-tests-"), "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"
# main.py warms ccxt markets in a background thread at import; there is no network here.
os.environ["KLINE_WARM_MARKETS"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402
from models import Dataset  # noqa: E402,F401 — register metadata


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def dataset(db_session):
    ds = Dataset(name="test-ds")
    db_session.add(ds)
    db_session.commit()
    db_session.refresh(ds)
    return ds


@pytest.fixture()
def dataset_headers(dataset):
    return {"X-Dataset-Id": str(dataset.id)}

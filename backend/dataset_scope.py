from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from models import Dataset

DATASET_HEADER = "X-Dataset-Id"


def get_dataset_id(request: Request, db: Session) -> int:
    raw = request.headers.get(DATASET_HEADER)
    if raw is None or raw == "":
        raise HTTPException(400, f"Missing header {DATASET_HEADER}")
    try:
        did = int(raw)
    except ValueError:
        raise HTTPException(400, f"Invalid {DATASET_HEADER}")
    if not db.query(Dataset).filter(Dataset.id == did).first():
        raise HTTPException(400, "Dataset not found")
    return did
import os


def _cors_origins():
    """Comma-separated list of allowed origins, or * for dev (allow all)."""
    raw = (os.getenv("CORS_ORIGINS") or "").strip()
    if not raw:
        return "*"
    return [o.strip() for o in raw.split(",") if o.strip()]


class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me")
    CORS_ORIGINS = _cors_origins()

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "CareerAI"
    ENV: str = "development"
    DEBUG: bool = True

    DATABASE_URL: str = "postgresql+asyncpg://careerai:careerai@localhost:5432/careerai"
    SYNC_DATABASE_URL: str = "postgresql+psycopg2://careerai:careerai@localhost:5432/careerai"
    REDIS_URL: str = "redis://localhost:6379/0"

    JWT_SECRET_KEY: str = "change-me-in-prod"
    # Fernet key for secrets stored in the DB (AI API keys). Derived from JWT_SECRET_KEY if empty.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    SETTINGS_ENCRYPTION_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    LLM_PROVIDER: str = "anthropic"  # "anthropic" | "groq"
    ANTHROPIC_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    LLM_MODEL: str = "claude-sonnet-5"
    LLM_MODEL_FAST: str = "claude-haiku-4-5-20251001"
    EMBEDDING_PROVIDER: str = "voyage"
    VOYAGE_API_KEY: str = ""

    STORAGE_BACKEND: str = "local"  # local | s3
    LOCAL_STORAGE_DIR: str = "./storage"
    S3_BUCKET: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "us-east-1"

    MAX_UPLOAD_MB: int = 10
    ALLOWED_RESUME_EXTENSIONS: tuple[str, ...] = (".pdf", ".docx")

    # Seeded on startup if both are set; this account gets access to the admin panel.
    ADMIN_EMAIL: str = ""
    ADMIN_PASSWORD: str = ""
    ADMIN_NAME: str = "Admin"

    # Public (no-login) tools.
    PUBLIC_RATE_LIMIT: str = "10/hour"
    PUBLIC_DEDUPE_MINUTES: int = 30
    # Salt for hashing visitor IPs; falls back to JWT_SECRET_KEY when empty.
    IP_HASH_SALT: str = ""

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    RATE_LIMIT_DEFAULT: str = "60/minute"


@lru_cache
def get_settings() -> Settings:
    return Settings()

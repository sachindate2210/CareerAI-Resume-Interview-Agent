from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import create_engine

from alembic import context

# Import Base and every model so `Base.metadata` is fully populated for autogenerate.
from app.core.database import Base
from app.core.config import get_settings
import app.models  # noqa: F401 - populates Base.metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

settings = get_settings()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL and not an Engine, though an Engine
    is acceptable here as well. By skipping the Engine creation we don't even need a
    DBAPI to be available.
    """
    url = settings.SYNC_DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a synchronous engine (alembic does not
    drive migrations through the app's async engine).
    """
    connectable = create_engine(settings.SYNC_DATABASE_URL, pool_pre_ping=True)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

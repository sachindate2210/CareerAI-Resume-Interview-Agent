"""Import every model so `Base.metadata` is fully populated for Alembic autogenerate."""

from app.models.ai_log import AIGenerationLog, AIGenerationStatus
from app.models.app_setting import AppSetting
from app.models.public_tool import PublicRequestStatus, PublicTool, PublicToolRequest
from app.models.role import Role
from app.models.resume import Resume, ResumeStatus, ResumeVersion, ResumeVersionSource
from app.models.user import RefreshToken, User

__all__ = [
    "AIGenerationLog",
    "AIGenerationStatus",
    "AppSetting",
    "PublicRequestStatus",
    "PublicTool",
    "PublicToolRequest",
    "RefreshToken",
    "Resume",
    "Role",
    "ResumeStatus",
    "ResumeVersion",
    "ResumeVersionSource",
    "User",
]

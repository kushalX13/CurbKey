"""add retry_count to notification_outbox

Revision ID: 3c4d5e6f7a8b
Revises: 1b8aa32f17bc
Create Date: 2026-01-30

"""
from alembic import op
import sqlalchemy as sa


revision = "3c4d5e6f7a8b"
down_revision = "1b8aa32f17bc"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "notification_outbox",
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("notification_outbox", "retry_count")

"""add car_number to tickets

Revision ID: 4d5e6f7a8b9c
Revises: 3c4d5e6f7a8b
Create Date: 2026-01-30

"""
from alembic import op
import sqlalchemy as sa


revision = "4d5e6f7a8b9c"
down_revision = "3c4d5e6f7a8b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tickets",
        sa.Column("car_number", sa.String(40), nullable=True),
    )


def downgrade():
    op.drop_column("tickets", "car_number")

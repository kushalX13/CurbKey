"""add vehicle_description to tickets

Revision ID: 6f7a8b9c0d0e
Revises: 5e6f7a8b9c0d
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa


revision = "6f7a8b9c0d0e"
down_revision = "5e6f7a8b9c0d"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("vehicle_description", sa.String(80), nullable=True))


def downgrade():
    op.drop_column("tickets", "vehicle_description")

"""delivered_by on requests and tips table

Revision ID: 7a8b9c0d0e1f
Revises: 6f7a8b9c0d0e
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa


revision = "7a8b9c0d0e1f"
down_revision = "6f7a8b9c0d0e"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("requests", sa.Column("delivered_by_user_id", sa.Integer(), nullable=True))
    op.add_column("requests", sa.Column("delivered_at", sa.DateTime(), nullable=True))
    op.create_foreign_key("fk_requests_delivered_by_user_id", "requests", "users", ["delivered_by_user_id"], ["id"])

    op.create_table(
        "tips",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["requests.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tips_request_id", "tips", ["request_id"], unique=False)


def downgrade():
    op.drop_index("ix_tips_request_id", table_name="tips")
    op.drop_table("tips")
    op.drop_constraint("fk_requests_delivered_by_user_id", "requests", type_="foreignkey")
    op.drop_column("requests", "delivered_at")
    op.drop_column("requests", "delivered_by_user_id")

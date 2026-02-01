"""venue slug and ticket claim fields

Revision ID: 5e6f7a8b9c0d
Revises: 4d5e6f7a8b9c
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa


revision = "5e6f7a8b9c0d"
down_revision = "4d5e6f7a8b9c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("venues", sa.Column("slug", sa.String(80), nullable=True))
    op.create_index(op.f("ix_venues_slug"), "venues", ["slug"], unique=True)
    conn = op.get_bind()
    for row in conn.execute(sa.text("SELECT id FROM venues")).fetchall():
        vid = row[0]
        conn.execute(sa.text("UPDATE venues SET slug = :s WHERE id = :id"), {"s": f"venue-{vid}", "id": vid})

    op.add_column("tickets", sa.Column("claim_code", sa.String(12), nullable=True))
    op.add_column("tickets", sa.Column("claim_code_expires_at", sa.DateTime(), nullable=True))
    op.add_column("tickets", sa.Column("claimed_phone", sa.String(40), nullable=True))
    op.add_column("tickets", sa.Column("claimed_at", sa.DateTime(), nullable=True))
    op.create_index(op.f("ix_tickets_claim_code"), "tickets", ["claim_code"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_tickets_claim_code"), table_name="tickets")
    op.drop_column("tickets", "claimed_at")
    op.drop_column("tickets", "claimed_phone")
    op.drop_column("tickets", "claim_code_expires_at")
    op.drop_column("tickets", "claim_code")
    op.drop_index(op.f("ix_venues_slug"), table_name="venues")
    op.drop_column("venues", "slug")

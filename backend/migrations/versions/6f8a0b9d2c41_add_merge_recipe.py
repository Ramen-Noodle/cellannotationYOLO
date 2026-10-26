"""add merge recipes

Revision ID: 6f8a0b9d2c41
Revises: a17c92be04f1
Create Date: 2026-10-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '6f8a0b9d2c41'
down_revision = 'a17c92be04f1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'merge_recipe',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('user_id', sa.String(length=36),
                  sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('recipe', sa.JSON(), nullable=False),
        sa.Column('source_classes', sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table('merge_recipe')

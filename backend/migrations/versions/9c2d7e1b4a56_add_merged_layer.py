"""add persisted merged annotation layers

Revision ID: 9c2d7e1b4a56
Revises: 6f8a0b9d2c41
Create Date: 2026-10-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '9c2d7e1b4a56'
down_revision = '6f8a0b9d2c41'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'merged_layer',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('user_id', sa.String(length=36),
                  sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('image_id', sa.String(length=36),
                  sa.ForeignKey('image_record.id', ondelete='CASCADE'), nullable=False),
        sa.Column('annotations', sa.JSON(), nullable=False),
        sa.UniqueConstraint('image_id', name='uq_merged_layer_image'),
    )


def downgrade():
    op.drop_table('merged_layer')

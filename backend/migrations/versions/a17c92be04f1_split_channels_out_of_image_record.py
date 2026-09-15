"""split channels out of image record

An ImageRecord no longer owns a physical file or annotations directly - it
just groups one or more Channels, each of which owns its own original/
normalized image files, p_low/p_high, and annotations. Every existing
ImageRecord gets exactly one Channel (marked is_base) carrying over its old
file fields, and every existing Annotation is repointed from its image to
that image's new base channel.

Revision ID: a17c92be04f1
Revises: d39896477d5e
Create Date: 2026-09-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import uuid

# revision identifiers, used by Alembic.
revision = 'a17c92be04f1'
down_revision = 'd39896477d5e'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # --- additive schema ---
    op.create_table(
        'channel',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('image_id', sa.String(length=36), sa.ForeignKey('image_record.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=255)),
        sa.Column('order_index', sa.Integer()),
        sa.Column('is_base', sa.Boolean()),
        sa.Column('original_extension', sa.String(length=16)),
        sa.Column('original_path', sa.String(length=512)),
        sa.Column('normalized_path', sa.String(length=512)),
        sa.Column('p_low', sa.Integer()),
        sa.Column('p_high', sa.Integer()),
        sa.Column('created_at', sa.DateTime()),
    )

    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.add_column(sa.Column('channel_id', sa.String(length=36), nullable=True))

    # --- data backfill ---
    metadata = sa.MetaData()
    image_record = sa.Table('image_record', metadata, autoload_with=bind)
    channel = sa.Table('channel', metadata, autoload_with=bind)
    annotation = sa.Table('annotation', metadata, autoload_with=bind)

    images = bind.execute(sa.select(
        image_record.c.id, image_record.c.user_id, image_record.c.original_filename,
        image_record.c.original_extension, image_record.c.original_path,
        image_record.c.normalized_path, image_record.c.p_low, image_record.c.p_high,
        image_record.c.created_at,
    )).fetchall()

    for img in images:
        channel_id = str(uuid.uuid4())
        bind.execute(channel.insert().values(
            id=channel_id,
            image_id=img.id,
            name=img.original_filename,
            order_index=0,
            is_base=True,
            original_extension=img.original_extension,
            original_path=img.original_path,
            normalized_path=img.normalized_path,
            p_low=img.p_low,
            p_high=img.p_high,
            created_at=img.created_at,
        ))
        bind.execute(annotation.update().where(annotation.c.image_id == img.id).values(
            channel_id=channel_id
        ))

    # --- contract schema ---
    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.alter_column('channel_id', nullable=False)
        batch_op.create_foreign_key(
            'fk_annotation_channel', 'channel', ['channel_id'], ['id'], ondelete='CASCADE'
        )
        batch_op.drop_constraint('uq_annotation_image_detection_setting', type_='unique')
        batch_op.create_unique_constraint(
            'uq_annotation_channel_detection_setting', ['channel_id', 'detection_setting_id']
        )
        batch_op.drop_column('image_id')

    with op.batch_alter_table('image_record', schema=None) as batch_op:
        batch_op.drop_column('original_filename')
        batch_op.drop_column('original_extension')
        batch_op.drop_column('original_path')
        batch_op.drop_column('normalized_path')
        batch_op.drop_column('p_low')
        batch_op.drop_column('p_high')

    # ### end Alembic commands ###


def downgrade():
    # Data-lossy: an image with more than one channel can't be represented in
    # the old one-file-per-image shape. This restores the old column shape
    # and repopulates it from each image's base channel only - any additional
    # channels (and their annotations) are left orphaned on the dropped
    # `channel` table's data, which is discarded. Restore
    # instance/biolab.db.bak.* instead if you actually need those back.
    bind = op.get_bind()

    with op.batch_alter_table('image_record', schema=None) as batch_op:
        batch_op.add_column(sa.Column('original_filename', sa.String(length=255)))
        batch_op.add_column(sa.Column('original_extension', sa.String(length=16)))
        batch_op.add_column(sa.Column('original_path', sa.String(length=512)))
        batch_op.add_column(sa.Column('normalized_path', sa.String(length=512)))
        batch_op.add_column(sa.Column('p_low', sa.Integer()))
        batch_op.add_column(sa.Column('p_high', sa.Integer()))

    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.add_column(sa.Column('image_id', sa.String(length=36)))

    metadata = sa.MetaData()
    image_record = sa.Table('image_record', metadata, autoload_with=bind)
    channel = sa.Table('channel', metadata, autoload_with=bind)
    annotation = sa.Table('annotation', metadata, autoload_with=bind)

    base_channels = bind.execute(sa.select(channel).where(channel.c.is_base == True)).fetchall()
    for ch in base_channels:
        bind.execute(image_record.update().where(image_record.c.id == ch.image_id).values(
            original_filename=ch.name,
            original_extension=ch.original_extension,
            original_path=ch.original_path,
            normalized_path=ch.normalized_path,
            p_low=ch.p_low,
            p_high=ch.p_high,
        ))
        bind.execute(annotation.update().where(annotation.c.channel_id == ch.id).values(
            image_id=ch.image_id
        ))

    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.drop_constraint('uq_annotation_channel_detection_setting', type_='unique')
        batch_op.create_unique_constraint(
            'uq_annotation_image_detection_setting', ['image_id', 'detection_setting_id']
        )
        batch_op.drop_constraint('fk_annotation_channel', type_='foreignkey')
        batch_op.drop_column('channel_id')

    op.drop_table('channel')

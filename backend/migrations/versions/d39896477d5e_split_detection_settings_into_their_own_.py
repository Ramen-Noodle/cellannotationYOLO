"""split detection settings into their own table

Revision ID: d39896477d5e
Revises: 
Create Date: 2026-07-08 16:06:25.105526

"""
from alembic import op
import sqlalchemy as sa
from collections import defaultdict
from datetime import datetime
import uuid

# revision identifiers, used by Alembic.
revision = 'd39896477d5e'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # --- additive schema ---
    op.create_table(
        'detection_setting',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('weights_id', sa.String(length=36), sa.ForeignKey('weights.id'), nullable=False),
        sa.Column('params', sa.JSON(), nullable=False),
    )

    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.add_column(sa.Column('detection_setting_id', sa.String(length=36), nullable=True))

    # --- data backfill ---
    metadata = sa.MetaData()
    annotation = sa.Table('annotation', metadata, autoload_with=bind)
    detection_setting = sa.Table('detection_setting', metadata, autoload_with=bind)

    rows = bind.execute(sa.select(
        annotation.c.id, annotation.c.image_id, annotation.c.user_id,
        annotation.c.weights_id, annotation.c.threshold,
        annotation.c.cell_diameter, annotation.c.sublabel,
        annotation.c.annotations_detected, annotation.c.annotations_drawn,
        annotation.c.created_at,
    )).fetchall()

    # One DetectionSetting per distinct (user, weights, threshold, diameter, sublabel).
    # selected_classes was never captured historically, so it backfills as None.
    setting_groups = defaultdict(list)
    for row in rows:
        key = (row.user_id, row.weights_id, row.threshold, row.cell_diameter, row.sublabel)
        setting_groups[key].append(row)

    for (user_id, weights_id, threshold, cell_diameter, sublabel), group_rows in setting_groups.items():
        setting_id = str(uuid.uuid4())
        bind.execute(detection_setting.insert().values(
            id=setting_id,
            user_id=user_id,
            weights_id=weights_id,
            params={
                "threshold": threshold,
                "cell_diameter": cell_diameter,
                "sublabel": sublabel,
                "selected_classes": None,
            },
        ))

        # The old schema never enforced one-annotation-per-image-per-setting,
        # so collapse any pre-existing duplicates for the same image before
        # the new unique constraint goes on — merge their boxes rather than
        # silently dropping data.
        by_image = defaultdict(list)
        for row in group_rows:
            by_image[row.image_id].append(row)

        for image_id, image_rows in by_image.items():
            keeper = max(image_rows, key=lambda r: r.created_at or datetime.min)

            if len(image_rows) > 1:
                merged_detected, merged_drawn = [], []
                for r in image_rows:
                    merged_detected.extend(r.annotations_detected or [])
                    merged_drawn.extend(r.annotations_drawn or [])

                dupe_ids = [r.id for r in image_rows if r.id != keeper.id]
                print(
                    f"[migration] merged {len(dupe_ids)} duplicate annotation row(s) "
                    f"for image {image_id} into {keeper.id}: {dupe_ids}"
                )

                bind.execute(annotation.update().where(annotation.c.id == keeper.id).values(
                    detection_setting_id=setting_id,
                    annotations_detected=merged_detected,
                    annotations_drawn=merged_drawn,
                    count_detected=len(merged_detected),
                    count_drawn=len(merged_drawn),
                ))
                bind.execute(annotation.delete().where(annotation.c.id.in_(dupe_ids)))
            else:
                bind.execute(annotation.update().where(annotation.c.id == keeper.id).values(
                    detection_setting_id=setting_id
                ))

    # --- contract schema ---
    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.alter_column('detection_setting_id', nullable=False)
        batch_op.create_foreign_key(
            'fk_annotation_detection_setting', 'detection_setting', ['detection_setting_id'], ['id']
        )
        batch_op.create_unique_constraint(
            'uq_annotation_image_detection_setting', ['image_id', 'detection_setting_id']
        )
        batch_op.drop_column('weights_id')
        batch_op.drop_column('threshold')
        batch_op.drop_column('cell_diameter')
        batch_op.drop_column('sublabel')

    # ### end Alembic commands ###


def downgrade():
    # Data-lossy: rows merged during upgrade() and the original per-row
    # threshold/cell_diameter/sublabel/weights_id values can't be
    # reconstructed once dropped. This restores the old column shape
    # (nullable, unpopulated) so the app can run against it, but does not
    # repopulate values. Restore instance/biolab.db.bak.* instead if you
    # actually need to roll back.
    with op.batch_alter_table('annotation', schema=None) as batch_op:
        batch_op.add_column(sa.Column('weights_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('threshold', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('cell_diameter', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('sublabel', sa.String(length=128), nullable=True))
        batch_op.drop_constraint('uq_annotation_image_detection_setting', type_='unique')
        batch_op.drop_constraint('fk_annotation_detection_setting', type_='foreignkey')
        batch_op.drop_column('detection_setting_id')

    op.drop_table('detection_setting')

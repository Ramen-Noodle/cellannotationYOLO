"""Remove recipes incompatible with the two-phase format.

Deleted recipe records cannot be recovered by downgrade.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8407d21a6cf'
down_revision = '9c2d7e1b4a56'
branch_labels = None
depends_on = None


def upgrade():
    recipes = sa.table('merge_recipe', sa.column('id', sa.String), sa.column('recipe', sa.JSON))
    connection = op.get_bind()
    for row in connection.execute(sa.select(recipes.c.id, recipes.c.recipe)).all():
        if not isinstance(row.recipe, dict) or row.recipe.get('version') != 3:
            connection.execute(recipes.delete().where(recipes.c.id == row.id))


def downgrade():
    pass

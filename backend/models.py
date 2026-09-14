from database import db
import datetime
import os
import uuid

class User(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    username = db.Column(db.String, unique=True, nullable=True)

    images = db.relationship('ImageRecord', cascade='all, delete-orphan', backref='user')
    annotations = db.relationship('Annotation', cascade='all, delete-orphan', backref='user')
    label_sets = db.relationship('LabelSet', cascade='all, delete-orphan', backref='user')
    weights = db.relationship('Weights', cascade='all, delete-orphan', backref='user')
    detection_settings = db.relationship('DetectionSetting', cascade='all, delete-orphan', backref='user')
    # Add this inside class User(db.Model):
    image_sets = db.relationship('ImageSet', cascade='all, delete-orphan', backref='user')

    def setup_filesystem(self):
        '''Creates the persistent directory structure for a new user.'''
        base_path = os.path.join('data', self.id)
        
        # Define your specific subfolder tree
        folders = [
            'images/original',
            'images/normalized',
            'images/cropped',
            'annotations',
            'models',
            'imagesets',
            'runs'
        ]
        
        for folder in folders:
            os.makedirs(os.path.join(base_path, folder), exist_ok=True)

        default_models = [
            {
                'weights_name': 'MADM',
                'filepath': 'snapshots/MADM_best_latest.pt',
                'labels': [
                    {'name': 'neuron', 'color': '#60A5FA'}, 
                    {'name': 'glia', 'color': '#F59E0B'}
                ]
            },
            {
                'weights_name': 'SGN',
                'filepath': 'snapshots/SGN_best.pt',
                'labels': [
                    {'name': 'SGN', 'color': '#CA00BC'}
                ]
            },
            {
                'weights_name': 'StarDist',
                'filepath': 'snapshots/StarDist',
                'labels': [
                    {'name': 'Nucleus', 'color': '#41BF37'}
                ]
            },
            {
                'weights_name': 'CD3',
                'filepath': 'snapshots/CD3_best.pt',
                'labels': [
                    {'name': 'CD3', 'color': '#EAB308'}
                ]
            }
        ]

        for entry in default_models:
            lsid = str(uuid.uuid4())
            new_label_set = LabelSet(
                id=lsid,
                user_id=self.id,
                labels=entry['labels']
            )
            new_weights = Weights(
                id=str(uuid.uuid4()),
                user_id=self.id,
                name=entry['weights_name'],
                file_path=entry['filepath'],
                is_default=True,
                label_set_id=lsid
            )
            db.session.add(new_label_set)
            db.session.add(new_weights)

        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f'Error initializing default models: {e}')
        
        return base_path

    # Helper to get specific paths later
    def get_path(self, sub_type):
        return os.path.join(self.id, sub_type)



class ImageRecord(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    original_filename = db.Column(db.String(255))
    original_extension = db.Column(db.String(16))
    
    # Paths to the physical files
    original_path = db.Column(db.String(512)) # Original image
    normalized_path = db.Column(db.String(512)) # Normalized PNG
    # cropped_path = db.Column(db.String(512))
    
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    width = db.Column(db.Integer)
    height = db.Column(db.Integer)
    # crop_width = db.Column(db.Integer)
    # crop_height = db.Column(db.Integer)

    p_low = db.Column(db.Integer)
    p_high = db.Column(db.Integer)

    annotations = db.relationship('Annotation', cascade='all, delete-orphan', backref='image_record')



class DetectionSetting(db.Model):
    __tablename__ = 'detection_setting'

    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    weights_id = db.Column(db.String(36), db.ForeignKey('weights.id'), nullable=False)

    # Model-specific config (threshold, cell_diameter, sublabel, selected_classes, ...).
    # Kept as a dict rather than columns so different model types can carry different fields.
    params = db.Column(db.JSON, nullable=False)

    annotations = db.relationship('Annotation', backref='detection_setting')



class Annotation(db.Model):
    __table_args__ = (
        db.UniqueConstraint('image_id', 'detection_setting_id', name='uq_annotation_image_detection_setting'),
    )

    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)

    file_path = db.Column(db.String(512))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    image_id = db.Column(db.String(36), db.ForeignKey('image_record.id', ondelete='CASCADE'))
    detection_setting_id = db.Column(db.String(36), db.ForeignKey('detection_setting.id'), nullable=False)

    annotations_detected = db.Column(db.JSON, nullable=False, default=list)
    annotations_drawn = db.Column(db.JSON, nullable=False, default=list)
    count_detected = db.Column(db.Integer, default=0)
    count_drawn = db.Column(db.Integer, default=0)



class LabelSet(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    labels = db.Column(db.JSON, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'labels': self.labels
        }



class Weights(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=True)
    name = db.Column(db.String(100))
    file_path = db.Column(db.String(512))
    is_default = db.Column(db.Boolean, default=False)

    label_set_id = db.Column(db.String(36), db.ForeignKey('label_set.id'), nullable=False)

    label_set = db.relationship('LabelSet', backref='weight_parent',)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'label_set': self.label_set.to_dict() if self.label_set else None
        }



# Association table for the Many-to-Many relationship
imageset_image_link = db.Table(
    'imageset_image_link',
    db.Column('image_set_id', db.String(36), db.ForeignKey('image_set.id', ondelete='CASCADE'), primary_key=True),
    db.Column('image_record_id', db.String(36), db.ForeignKey('image_record.id', ondelete='CASCADE'), primary_key=True)
)

class ImageSet(db.Model):
    __tablename__ = 'image_set'
    
    id = db.Column(db.String(36), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(512), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    # Many-to-Many relationship back to ImageRecord
    images = db.relationship(
        'ImageRecord', 
        secondary=imageset_image_link, 
        lazy='subquery',
        backref=db.backref('image_sets', lazy='dynamic')
    )

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat(),
            'image_count': len(self.images),
            'images': [
                {
                    'id': img.id,
                    'url': f"/static/{img.normalized_path}",
                    'name': f'{img.original_filename}{img.original_extension}',
                    'dimensions': [img.width, img.height],
                    'p_low': img.p_low,
                    'p_high': img.p_high
                }
                for img in self.images
            ]
        }


from sqlalchemy import event

@event.listens_for(ImageSet, 'after_insert')
def create_imageset_directory(mapper, connection, target):
    """Automatically builds the physical folder when an ImageSet is created."""
    # target matches the current ImageSet instance
    folder_path = os.path.join('data', target.user_id, 'imagesets', target.id)
    os.makedirs(folder_path, exist_ok=True)
    print(f"Created filesystem directory for ImageSet: {folder_path}")


@event.listens_for(ImageSet, 'after_delete')
def delete_imageset_directory(mapper, connection, target):
    """Cleans up the physical folder when an ImageSet is deleted."""
    folder_path = os.path.join('data', target.user_id, 'imagesets', target.id)
    if os.path.exists(folder_path):
        import shutil
        shutil.rmtree(folder_path)
        print(f"Removed filesystem directory for ImageSet: {folder_path}")
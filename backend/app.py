import sys
from werkzeug.utils import secure_filename  # ADD THIS AT TOP OF FILE
from flask import Flask, request, jsonify, send_from_directory, send_file, g
import os
os.environ.setdefault('XLA_FLAGS', '--xla_gpu_cuda_data_dir=/home/cdlee3/miniconda3/envs/cellv2')
from PIL import Image
import uuid
from flask_cors import CORS
import subprocess
import shutil
import h5py
from PIL import Image, ImageOps
import numpy as np
import zipfile
import io
import tempfile
import gc  # Garbage collector
import time  # For delays
from flask import session
from datetime import timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import datetime
import atexit
from tensorflow.python.summary.summary_iterator import summary_iterator
import glob
import tensorflow as tf
from ultralytics import YOLO
from scripts.normalization import normalize_image
from scripts.stardist_detect import stardist_detect_to_yolo
from scripts import sahi_worker
BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # Gets directory where app.py is
os.chdir(BASE_DIR)
from PIL import Image
import tifffile
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import or_
from sqlalchemy.orm.attributes import flag_modified
# Disable decompression bomb protection for large TIFF files
Image.MAX_IMAGE_PIXELS = None

data_folder = os.path.join(os.getcwd(), 'data')
app = Flask(__name__, static_folder=data_folder, static_url_path='/static')
CORS(app, supports_credentials=True, expose_headers=['Content-Disposition'])  # This will allow all domains to access your API

app.secret_key = 'test'  # Replace with a real secret key

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///biolab.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)  # Session expires after 24 hours

from database import db
from models import User, ImageRecord, ImageSet, Annotation, LabelSet, Weights, DetectionSetting
from flask_migrate import Migrate

db.init_app(app)
migrate = Migrate(app, db)

@app.before_request
def ensure_user_session():
    if request.method == 'OPTIONS':
        return
    
    g.user = None
    user_id = session.get('user_id')
    if user_id:
        g.user = db.session.get(User, user_id)


def preprocess_image(orig_w, orig_h, detection_type, cell_diameter):
    """
    Computes the detection-space dimensions and cell-diameter scaling factor
    purely from already-known image dimensions (DB values) — no file IO here.
    The actual resize happens inside the SAHI worker process, right before
    detection, so the parent Flask process never has to open the file.
    """
    target_diameter = 20.0 if detection_type == 'CD3' else 34.0
    scaling_factor = target_diameter / float(cell_diameter)

    if scaling_factor != 1.0:
        det_w = max(1, int(round(orig_w * scaling_factor)))
        det_h = max(1, int(round(orig_h * scaling_factor)))
    else:
        det_w = orig_w
        det_h = orig_h

    return {
        "det_w": det_w,
        "det_h": det_h,
        "scaling_factor": scaling_factor
    }

import subprocess
import tempfile

def run_stardist_subprocess(image_path, model_path, image_width, image_height,
                             nucleus_diam_min=7, nucleus_diam_max=17, prob_thresh=None):
    """
    Runs StarDist detection in an isolated subprocess so TensorFlow never
    shares a process with torch/ultralytics (cuDNN version conflict).
    """
    with tempfile.NamedTemporaryFile(mode='r', suffix='.txt', delete=False) as tmp:
        output_path = tmp.name

    worker_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts', 'stardist_worker.py')

    cmd = [
        sys.executable,  # same python interpreter/env currently running
        worker_script,
        '--image_path', image_path,
        '--model_path', model_path,
        '--image_width', str(image_width),
        '--image_height', str(image_height),
        '--nucleus_diam_min', str(nucleus_diam_min),
        '--nucleus_diam_max', str(nucleus_diam_max),
        '--output_path', output_path,
    ]
    if prob_thresh is not None:
        cmd += ['--prob_thresh', str(prob_thresh)]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        os.unlink(output_path) if os.path.exists(output_path) else None
        raise RuntimeError(f"StarDist subprocess failed: {result.stderr}")

    with open(output_path, 'r') as f:
        yolo_output = f.read()
    os.unlink(output_path)

    return yolo_output

def resolve_detection_setting(user_id, weights_id, params, detection_setting_id=None):
    """
    Finds or creates the DetectionSetting record for a row, given its
    detection_setting_id (which may be a real id, a stale id, or a frontend
    temp id) plus the settings to use for this run.

    Returns (setting, params_changed). params_changed is True when a row with
    a real existing id was resolved but its stored params differed from the
    incoming ones - i.e. the row's configuration was edited since it last ran.
    """
    setting = None
    if detection_setting_id:
        setting = DetectionSetting.query.filter_by(id=detection_setting_id, user_id=user_id).first()

    if setting:
        # Row already has a real settings record - update it if the values changed.
        params_changed = setting.weights_id != weights_id or setting.params != params
        if params_changed:
            setting.weights_id = weights_id
            setting.params = params
            flag_modified(setting, "params")
        return setting, params_changed

    # No record for this id - look for an existing duplicate before creating one.
    candidates = DetectionSetting.query.filter_by(user_id=user_id, weights_id=weights_id).all()
    setting = next((d for d in candidates if d.params == params), None)

    if not setting:
        setting = DetectionSetting(
            id=str(uuid.uuid4()), user_id=user_id, weights_id=weights_id, params=params
        )
        db.session.add(setting)
        db.session.flush()

    return setting, False


def resolve_annotation_record(user_id, image_id, weights_id, params, detection_setting_id):
    """
    Finds or creates the Annotation record that a detect call should write
    its results to, given a row's detection_setting_id plus the settings to
    use for this run.
    """
    try:
        setting, _ = resolve_detection_setting(user_id, weights_id, params, detection_setting_id)

        annotation = Annotation.query.filter_by(
            user_id=user_id, image_id=image_id, detection_setting_id=setting.id
        ).first()

        if not annotation:
            annotation = Annotation(
                id=str(uuid.uuid4()), user_id=user_id, image_id=image_id, detection_setting_id=setting.id
            )
            db.session.add(annotation)
            db.session.flush()

        return annotation
    except Exception:
        db.session.rollback()
        raise


def execute_detection(image_record, model_record, threshold, cell_diameter, sublabel, selected_classes=None,
                       min_cell_diameter=None, max_cell_diameter=None):
    """
    Shared pipeline that handles preprocessing, model routing (StarDist vs. SAHI),
    and coordinate space translation from YOLO to UI-pixels.
    """
    # 1. Filter class indices
    allowed_class_indices = None
    if selected_classes is not None:
        allowed_class_indices = set()
        for idx, label_obj in enumerate(model_record.label_set.labels):
            if label_obj.get('name') in selected_classes:
                allowed_class_indices.add(idx)

    model_path = model_record.file_path
    detection_type = model_record.name

    # 2. Check model type and route execution
    if "stardist" in detection_type.lower():
        base_image_path = os.path.join('data', image_record.original_path)
        abs_image_path = os.path.abspath(base_image_path)
        abs_model_path = os.path.abspath(model_path)
        print("Executing StarDist Detect (subprocess)")
        yolo_output = run_stardist_subprocess(
            image_path=abs_image_path,
            model_path=abs_model_path,
            image_width=image_record.width,
            image_height=image_record.height,
            nucleus_diam_min=min_cell_diameter if min_cell_diameter is not None else 7,
            nucleus_diam_max=max_cell_diameter if max_cell_diameter is not None else 17,
            prob_thresh=threshold,
        )
        print(f'[DEBUG] yolo_output repr (first 300 chars): {repr(yolo_output[:300])}')
    else:
        # Default SAHI / Standard Object Detection Path
        base_image_path = os.path.join('data', image_record.normalized_path)
        abs_image_path = os.path.abspath(base_image_path)
        prep_data = preprocess_image(
            orig_w=image_record.width,
            orig_h=image_record.height,
            detection_type=detection_type,
            cell_diameter=cell_diameter,
        )

        # Runs in the persistent SAHI worker process (see scripts/sahi_worker.py) so
        # a stuck or crashed detection can be killed/retried without taking down the
        # Flask server, without paying a model-reload cost on every call.
        yolo_output = sahi_worker.run_job(
            image_path=abs_image_path,
            det_w=prep_data['det_w'],
            det_h=prep_data['det_h'],
            scaling_factor=prep_data['scaling_factor'],
            model_path=model_path,
            threshold=threshold,
        )

    # 3. Parse Output Strings & Convert Coordinates back to front-end canvas space
    yolo_lines = []
    converted_annotations = []
    img_w = image_record.width
    img_h = image_record.height

    # Guard against completely empty or None outputs
    if not yolo_output:
        return "", []

    for line in yolo_output.split('\n'):
        if not line.strip():
            continue
        parts = line.strip().split(' ')
        
        # Ensure line has enough parameters to prevent unpack crashes
        if len(parts) < 5:
            continue
            
        cls = int(parts[0])
        
        if allowed_class_indices is not None and cls not in allowed_class_indices:
            continue

        cx = float(parts[1])
        cy = float(parts[2])
        w = float(parts[3])
        h = float(parts[4])
        conf = float(parts[5]) if len(parts) > 5 else None

        # Build standard YOLO file string format
        yolo_lines.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

        # Map relative ratios back to pixel space bounds for the front-end canvas
        pixel_w = w * img_w
        pixel_h = h * img_h
        pixel_x = (cx * img_w) - (pixel_w / 2)
        pixel_y = (cy * img_h) - (pixel_h / 2)

        converted_annotations.append({
            "x": pixel_x,
            "y": pixel_y,
            "w": pixel_w,
            "h": pixel_h,
            "class": cls,
            "confidence": conf,
            "is_detected": True,
            "sublabel": sublabel
        })

    return "\n".join(yolo_lines), converted_annotations

def sanitize_box(x1, y1, x2, y2):
    """Ensure x1 <= x2 and y1 <= y2"""
    new_x1 = min(x1, x2)
    new_y1 = min(y1, y2)
    new_x2 = max(x1, x2)
    new_y2 = max(y1, y2)
    return new_x1, new_y1, new_x2, new_y2

def get_scalar_value(v):
    if hasattr(v, 'simple_value') and v.simple_value != 0.0:
        return v.simple_value
    elif hasattr(v, 'tensor'):
        try:
            t = tf.make_ndarray(v.tensor)
            return float(t)
        except Exception as e:
            print(f"[Error extracting tensor value for {v.tag}]: {e}")
            return None
    return None


@app.route('/cleanup', methods=['POST'])
def cleanup_files():
    try:
        user_id = session.get('user_id')
        if user_id:
            user_dir = os.path.join('users', user_id)
            if os.path.exists(user_dir):
                shutil.rmtree(user_dir)
                print(f"Cleaned up directory for user: {user_id}")
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"Cleanup error: {str(e)}")
        return jsonify({'status': 'error'}), 500



# Add these additional directories to clear
CLEANUP_DIRS = ['output', 'input', 'images']

# Create directories if they don't exist
def clear_folder(folder):
    for filename in os.listdir(folder):
        file_path = os.path.join(folder, filename)
        if os.path.isfile(file_path):
            os.remove(file_path)
        elif os.path.isdir(file_path):
            clear_folder(file_path)



def clear_uploaded_images():
    """Delete all files in the current user's upload folder"""
    user_id = session.get('user_id', 'default')  # Handle unauthenticated edge case
    user_upload_dir = os.path.join('users', user_id, 'uploads')
    for filename in os.listdir(user_upload_dir):
        file_path = os.path.join(user_upload_dir, filename)
        if os.path.isfile(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")
                

# *----------* User Endpoints *----------* #

@app.route("/api/hello")
def hello():
    return jsonify({"message": "Hello from Flask API"})

@app.route('/me', methods=['GET'])
def get_current_user():
    # If it's a completely new browser, establish the session cookie format
    if 'user_id' not in session:
        session.permanent = True
        session['user_id'] = str(uuid.uuid4())
    
    user_id = session['user_id']
    user = db.session.get(User, user_id)
    
    # If no user found, create new user
    if not user:
        try:
            user = User(id=user_id)
            db.session.add(user)
            user.setup_filesystem()
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": f"Failed to initialize session: {e}"}), 500

    return jsonify({
        "logged_in": user.username is not None,
        "user": {
            "id": user.id,
            "username": user.username
        }
    }), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    
    if not username:
        return jsonify({"error": "Username is required"}), 400
        
    # Check if the username already exists in the system
    username_exists = User.query.filter_by(username=username).first()
    if username_exists:
        return jsonify({"error": "Username is already taken"}), 400
        
    # Get the temporary user record created by @app.before_request
    current_user_id = session.get('user_id')
    current_user = db.session.get(User, current_user_id)
    
    try:
        if current_user:
            if current_user.username:
                return jsonify({"message": "Already logged in"}), 200
            # Turn the temporary session into a permanent user account
            current_user.username = username
            db.session.commit()
            session['user_id'] = current_user_id
            session['username'] = username
            session['logged_in'] = True
            return jsonify({"message": "Registration successful! Session claimed."}), 201
        else:
            return jsonify({"error": "No active session found to register"}), 500
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    
    if not username:
        return jsonify({"error": "Username is required"}), 400
        
    # Look for the existing user
    existing_user = User.query.filter_by(username=username).first()
    if not existing_user:
        return jsonify({"error": "User not found"}), 404
        
    # Get the temporary session ID that was just generated for this visit
    current_user_id = session.get('user_id')
    
    # If they are somehow already logged in as this user, just return success
    if existing_user.id == current_user_id:
        return jsonify({"message": "Already logged in"}), 200
        
    # Discard and clean up the unneeded temporary session
    current_user = db.session.get(User, current_user_id)
    
    # Safety check: Only delete it if it's truly an unowned temporary session
    if current_user and current_user.username is None:
        # Delete temporary folder
        temp_user_path = os.path.join('data', current_user.get_path(''))
        print(temp_user_path)
        if os.path.exists(temp_user_path):
            try:
                shutil.rmtree(temp_user_path)
            except Exception as e:
                print(f"Error deleting temp folder {current_user_id}: {e}")
                
        # Delete temporary database row
        db.session.delete(current_user)
        db.session.commit()
        
    # Log user in by switching the session ID to their real account ID
    session['user_id'] = existing_user.id
    session['username'] = existing_user.username
    session['logged_in'] = True
    
    return jsonify({"message": "Login successful. Switched to existing session."}), 200


# *----------* Data Upload Endpoints *----------* #

@app.route('/upload', methods=['POST'])
def upload_file():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    try:
        image_dir = g.user.get_path('images')

        # 1. Save Original
        full_filename = file.filename
        original_name = os.path.splitext(full_filename)[0]
        ext = os.path.splitext(full_filename)[1].lower()
        unique_id = str(uuid.uuid4())

        original_filename = f"{unique_id}_orig{ext}"
        original_path = os.path.join(image_dir, 'original', original_filename)
        original_save_path = os.path.join('data', original_path)
        file.save(original_save_path)

        # 2. Get Dimensions (Using PIL)
        with Image.open(original_save_path) as img:
            w, h = img.size

        # 3. Generate Normalized Preview
        normalized_filename = f"{unique_id}_norm.png"
        normalized_path = os.path.join(image_dir, 'normalized', normalized_filename)
        
        # Normalize image for training/display
        normalized_save_path = os.path.join('data', normalized_path)
        p_low, p_high = normalize_image(original_save_path, normalized_save_path)

        # 4. Create the Database Record
        new_image_record = ImageRecord(
            id=unique_id,
            user_id=g.user.id,
            original_filename=original_name,
            original_extension=ext,
            original_path=original_path,
            normalized_path=normalized_path,
            width=w,
            height=h,
            p_low=int(p_low) if p_low is not None else None,
            p_high=int(p_high) if p_high is not None else None
        )
        
        db.session.add(new_image_record)
        db.session.commit()

        # 5. Respond to React
        return jsonify({
            'image_id': unique_id,
            'converted_url': f'/static/{normalized_path}',
            'dimensions': [w, h],
            'p_low': p_low,
            'p_high': p_high
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

import random

@app.route('/upload-custom-model', methods=['POST'])
def upload_custom_model():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    try:
        model_file = request.files.get('model')
        model_name = request.form.get('name')
        model_type = request.form.get('type')
        
        if not model_file or not model_name:
            return jsonify({'error': 'Missing model file or name'}), 400
        
        model_dir = g.user.get_path('models')
        unique_id = str(uuid.uuid4())
        file_ext = os.path.splitext(model_file.filename)[1]
        model_filename = f'{unique_id}{file_ext}'
        full_path = os.path.join('data', model_dir, model_filename)
        model_file.save(full_path)

        target_label_set_id = None

        if model_type == 'MADM':
            target_model = Weights.query.filter_by(is_default=True, name='MADM').first()
            if target_model:
                target_label_set_id = target_model.label_set_id
            else:
                return jsonify({'error': f"MADM class labels not found"}), 500
        elif model_type == 'SGN':
            target_model = Weights.query.filter_by(is_default=True, name='SGN').first()
            if target_model:
                target_label_set_id = target_model.label_set_id
            else:
                return jsonify({'error': f"SGN class labels not found"}), 500
        else:
            try:
                # Get class names from custom model
                temp_model = YOLO(full_path)
                class_names = list(temp_model.names.values())
                formatted_labels = []
                for name in class_names:
                    random_color = f"#{random.randint(0, 0xFFFFFF):06x}"
                    formatted_labels.append({
                        "name": name,
                        "color": random_color
                    })
                # Create new label set for the model
                new_ls_id = str(uuid.uuid4())
                new_ls = LabelSet(
                    id=new_ls_id,
                    user_id=g.user.id,
                    labels=formatted_labels
                )
                db.session.add(new_ls)
                target_label_set_id = new_ls_id
            except Exception as e:
                return jsonify({'error': f"Could not parse YOLO classes: {str(e)}"}), 400
        new_weights = Weights(
            id=unique_id,
            user_id=g.user.id,
            name=model_name,
            file_path=full_path,
            label_set_id=target_label_set_id
        )

        db.session.add(new_weights)
        db.session.commit()

        # label_set = db.session.get(LabelSet, target_label_set_id)

        return jsonify({
            'message': 'Model uploaded successfully',
            'weights': new_weights.to_dict()
        })

    except Exception as e:
        db.session.rollback()
        os.remove(full_path)
        print(f"Error uploading model: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/save-annotations', methods=['POST'])
def save_annotations():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    try:
        data = request.get_json()
        image_id = data['image_id']
        annotation_groups = data['annotations']
        annotation_dir = g.user.get_path('annotations')

        id_map = {}

        for group in annotation_groups:
            client_id = group.get('detection_setting_id')
            weights_id = group['weights_id']
            annotations_detected = group.get('annotations_detected', [])
            annotations_drawn = group.get('annotations_drawn', [])

            if not annotations_detected and not annotations_drawn:
                continue

            params = {
                "threshold": group.get('threshold'),
                "cell_diameter": group.get('cell_diameter'),
                "min_cell_diameter": group.get('min_cell_diameter'),
                "max_cell_diameter": group.get('max_cell_diameter'),
                "sublabel": group.get('sublabel'),
                "selected_classes": group.get('selected_classes'),
            }

            # Frontend rows are keyed by detection_setting_id, so the id_map
            # (used to reconcile client temp ids) maps onto the resolved
            # DetectionSetting id rather than the Annotation id.
            target = resolve_annotation_record(g.user.id, image_id, weights_id, params, client_id)

            target.annotations_detected = list(annotations_detected)
            target.count_detected = len(annotations_detected)
            target.annotations_drawn = list(annotations_drawn)
            target.count_drawn = len(annotations_drawn)
            flag_modified(target, "annotations_detected")
            flag_modified(target, "annotations_drawn")

            if not target.file_path:
                target.file_path = os.path.join('data', annotation_dir, f'{target.id}.txt')
            full_path = target.file_path

            if client_id and client_id != target.detection_setting_id:
                id_map[client_id] = target.detection_setting_id

            db.session.commit()

            yolo_lines = []
            for ann in list(annotations_detected) + list(annotations_drawn):
                confidence = ann.get('confidence')
                if confidence is None:
                    confidence = 100
                line = "{0} {1:.6f} {2:.6f} {3:.6f} {4:.6f} {5:.6f}".format(
                    ann['class'],
                    ann['x'],
                    ann['y'],
                    ann['w'],
                    ann['h'],
                    confidence
                )
                yolo_lines.append(line)

            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, 'w') as f:
                f.write("\n".join(yolo_lines))

        return jsonify({'message': 'Success', 'id_map': id_map}), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error saving annotations: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/save-color', methods=['POST'])
def save_color():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    data = request.get_json()
    if not data or 'model_id' not in data or 'index' not in data or 'color' not in data:
        return jsonify({"error": "Missing required fields"}), 400

    model_id = data['model_id']
    class_index = int(data['index'])
    new_color = data['color']

    try:
        # Find the model that belongs to this user
        model = Weights.query.filter_by(id=model_id, user_id=g.user.id).first()
        if not model or not model.label_set:
            return jsonify({"error": "Model or label set not found"}), 404

        # Access and mutate the JSON array property
        labels_copy = list(model.label_set.labels)
        
        if class_index < 0 or class_index >= len(labels_copy):
            return jsonify({"error": "Class index out of bounds"}), 400

        labels_copy[class_index]['color'] = new_color
        model.label_set.labels = labels_copy

        flag_modified(model.label_set, "labels")

        db.session.commit()
        return jsonify({"success": True, "message": "Color updated successfully"}), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error updating label color: {e}")
        return jsonify({"error": "Internal server error"}), 500



# *----------* Data Download Endpoints *----------* #
    
def _parse_annotation_file(file_path):
    """Reads a flat annotation .txt file into (class_idx, coords[4], confidence) rows."""
    if not (file_path and os.path.exists(file_path)):
        return []

    with open(file_path, 'r') as f:
        content = f.read().strip()
    if not content:
        return []

    rows = []
    for line in content.split('\n'):
        if not line.strip():
            continue
        parts = line.strip().split(' ')
        class_idx = int(parts[0])
        coords = parts[1:5]
        confidence = parts[5] if len(parts) > 5 else '100.000000'
        rows.append((class_idx, coords, confidence))
    return rows


def merge_annotations(image_id, user_id, include_confidence=False):
    """Merges all Annotation records for a single image into one set of class-name YOLO label lines."""
    annotation_records = db.session.query(Annotation).filter_by(
        image_id=image_id,
        user_id=user_id
    ).all()

    if not annotation_records:
        return None

    merged_lines = []
    for record in annotation_records:
        rows = _parse_annotation_file(record.file_path)
        if not rows:
            continue

        model = db.session.get(Weights, record.detection_setting.weights_id) if record.detection_setting else None
        labels = model.label_set.labels if model and model.label_set else []
        sublabel = record.detection_setting.params.get('sublabel') if record.detection_setting else None

        for class_idx, coords, confidence in rows:
            class_name = labels[class_idx]['name'] if class_idx < len(labels) else f'class{class_idx}'
            label = f"{class_name}_{sublabel}" if sublabel else class_name

            line_parts = [label] + coords
            if include_confidence:
                line_parts.append(confidence)
            merged_lines.append(' '.join(line_parts))

    return merged_lines


def split_annotations_by_setting(image_id, user_id, include_confidence=False):
    """
    Builds one class-number YOLO file per detection setting run on this image.
    Raw class indices only mean something within a single model's label set, so
    (unlike merge_annotations) these can't be combined across detection settings.
    Returns a list of (filename_suffix, lines) tuples.
    """
    annotation_records = db.session.query(Annotation).filter_by(
        image_id=image_id,
        user_id=user_id
    ).all()

    files = []
    for record in annotation_records:
        rows = _parse_annotation_file(record.file_path)
        if not rows:
            continue

        model = db.session.get(Weights, record.detection_setting.weights_id) if record.detection_setting else None
        model_name = model.name if model else 'model'
        sublabel = record.detection_setting.params.get('sublabel') if record.detection_setting else None
        suffix = f"{model_name}_{sublabel}" if sublabel else model_name

        lines = []
        for class_idx, coords, confidence in rows:
            line_parts = [str(class_idx)] + coords
            if include_confidence:
                line_parts.append(confidence)
            lines.append(' '.join(line_parts))

        files.append((suffix, lines))

    return files


@app.route('/export-annotations', methods=['POST'])
def export_annotations():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    try:
        data = request.json or {}
        image_id = data.get('image_id')
        image_set_id = data.get('image_set_id')
        label_format = data.get('label_format', 'name')  # 'name' | 'number'
        include_confidence = bool(data.get('include_confidence', False))

        if not image_id and not image_set_id:
            return jsonify({"error": "Missing image_id or image_set_id"}), 400

        if label_format not in ('name', 'number'):
            return jsonify({"error": "Invalid label_format"}), 400

        if image_set_id:
            image_set = ImageSet.query.filter_by(id=image_set_id, user_id=g.user.id).first()
            if not image_set:
                return jsonify({"error": "Image set not found"}), 404
            if not image_set.images:
                return jsonify({"error": "Image set has no images"}), 404

            zip_buffer = io.BytesIO()
            exported_any = False
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                for image_record in image_set.images:
                    base_name = image_record.original_filename if image_record.original_filename else image_record.id

                    if label_format == 'number':
                        for suffix, lines in split_annotations_by_setting(image_record.id, g.user.id, include_confidence):
                            if not lines:
                                continue
                            zf.writestr(f'{base_name}_{suffix}.txt', "\n".join(lines))
                            exported_any = True
                    else:
                        merged_lines = merge_annotations(image_record.id, g.user.id, include_confidence)
                        if not merged_lines:
                            continue
                        zf.writestr(f'{base_name}.txt', "\n".join(merged_lines))
                        exported_any = True

            if not exported_any:
                return jsonify({'error': 'No annotations found for any image in this set'}), 404

            zip_buffer.seek(0)
            return send_file(
                zip_buffer,
                mimetype='application/zip',
                as_attachment=True,
                download_name=f'{image_set.name}.zip'
            )

        image_record = db.session.get(ImageRecord, image_id)
        base_name = image_record.original_filename if image_record and image_record.original_filename else image_id

        if label_format == 'number':
            files = [(suffix, lines) for suffix, lines in split_annotations_by_setting(image_id, g.user.id, include_confidence) if lines]
            if not files:
                return jsonify({'error': 'No annotations found for this image'}), 404

            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                for suffix, lines in files:
                    zf.writestr(f'{base_name}_{suffix}.txt', "\n".join(lines))
            zip_buffer.seek(0)

            return send_file(
                zip_buffer,
                mimetype='application/zip',
                as_attachment=True,
                download_name=f'{base_name}.zip'
            )

        merged_lines = merge_annotations(image_id, g.user.id, include_confidence)
        if merged_lines is None:
            return jsonify({'error': 'No annotations found for this image'}), 404
        if not merged_lines:
            return jsonify({'error': 'Annotation files were missing from server storage'}), 404

        merged_buffer = io.BytesIO("\n".join(merged_lines).encode('utf-8'))

        return send_file(
            merged_buffer,
            mimetype='text/plain',
            as_attachment=True,
            download_name=f'{base_name}.txt'
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upload-cropped', methods=['POST'])
def upload_cropped_file():
    temp_crop_path = None
    try:
        # Get crop coordinates and original filename
        image_id = request.form['image_id']
        x = int(float(request.form['x']))
        y = int(float(request.form['y']))
        width = int(float(request.form['width']))
        height = int(float(request.form['height']))

        image_record = db.session.get(ImageRecord, image_id)
        if not image_record:
            return jsonify({'error': 'Image record not found'}), 404

        original_path = os.path.join('data', image_record.original_path)
        temp_crop_path = os.path.join(os.path.dirname(original_path), f"temp_{image_id}.tiff")

        # Load original image, crop, and overwrite
        img = tifffile.imread(original_path)
        padded_img = np.zeros_like(img)
        padded_img[y:y+height, x:x+width] = img[y:y+height, x:x+width]
        tifffile.imwrite(temp_crop_path, padded_img)

        # Create and normalize png conversion of cropped image
        output_path = os.path.join('data', image_record.normalized_path)
        p_low = image_record.p_low
        p_high = image_record.p_high
        normalize_image(temp_crop_path, output_path, p_low=p_low, p_high=p_high)

        existing_annotations = Annotation.query.filter_by(image_id=image_id).all()

        for annotation in existing_annotations:
            filtered = [
                ann for ann in annotation.annotations
                if (x <= ann['x'] <= x + width and
                    y <= ann['y'] <= y + height)
            ]

            annotation.annotations = filtered
            annotation.count = len(filtered)
            flag_modified(annotation, "annotations")

            # Overwrite physical annotation file
            yolo_lines = []
            for ann in filtered:
                yolo_lines.append("{0} {1:.6f} {2:.6f} {3:.6f} {4:.6f}".format(
                    ann['class'], ann['x'], ann['y'], ann['w'], ann['h']
                ))
            with open(annotation.file_path, 'w') as f:
                f.write("\n".join(yolo_lines))
        
        db.session.commit()

        return jsonify({
            'converted_url': f'/static/{image_record.normalized_path}',
            'original_name': image_record.original_filename
        })

    except Exception as e:
        db.session.rollback()
        print(f"Error in upload-cropped: {str(e)}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500
    
    finally:
        if temp_crop_path and os.path.exists(temp_crop_path):
            os.remove(temp_crop_path)



# *----------* Data Retrieval Endpoints *----------* #

@app.route('/user-images', methods=['GET'])
def get_user_images():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    images = ImageRecord.query.filter_by(user_id=g.user.id).all()

    image_list = [
        {
            'id': img.id,
            'url': f"/static/{img.normalized_path}",
            'name': f'{img.original_filename}{img.original_extension}',
            'dimensions': [img.width, img.height],
            'p_low': img.p_low,
            'p_high': img.p_high
        } 
        for img in images
    ]

    return jsonify(image_list)

@app.route('/user-weights', methods=['GET'])
def get_user_weights():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    weights = Weights.query.filter(
        or_(Weights.user_id == g.user.id, Weights.user_id == None)
    ).all()

    return jsonify([wts.to_dict() for wts in weights])


@app.route('/user-image-sets', methods=['GET'])
def get_user_image_sets():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    image_sets = ImageSet.query.filter_by(user_id=g.user.id).all()
    
    results = []
    for img_set in image_sets:
        set_data = img_set.to_dict()
        # Prepend the API base URL to all inner image URLs
        for img in set_data['images']:
            img['url'] = f"{request.host_url.rstrip('/')}{img['url']}"
        results.append(set_data)
        
    return jsonify(results), 200


@app.route('/load-annotations', methods=['POST'])
def load_annotations():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    data = request.get_json()
    if not data or 'image_id' not in data:
        return jsonify({"error": "Missing image_id in request body"}), 400

    image_id = data['image_id']
    annotations = Annotation.query.filter_by(
        user_id=g.user.id, 
        image_id=image_id
    ).all()

    results = []
    for ann in annotations:
        setting = ann.detection_setting
        annotation_weights = Weights.query.filter_by(
            id=setting.weights_id,
            user_id=g.user.id
        ).first()
        params = setting.params or {}
        results.append({
            "id": ann.id,
            "detection_setting_id": setting.id,
            "weights_id": setting.weights_id,
            "threshold": params.get("threshold"),
            "cell_diameter": params.get("cell_diameter"),
            "min_cell_diameter": params.get("min_cell_diameter"),
            "max_cell_diameter": params.get("max_cell_diameter"),
            "sublabel": params.get("sublabel"),
            "annotations_detected": ann.annotations_detected,  # SQLAlchemy parses JSON columns automatically
            "annotations_drawn": ann.annotations_drawn,
            "count_detected": ann.count_detected,
            "count_drawn": ann.count_drawn,
            "labels": annotation_weights.label_set.to_dict()
        })

    return jsonify({"annotations": results}), 200



# *----------* Data Removal Endpoints *----------* #

@app.route('/delete-image', methods=['DELETE'])
def delete_image():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    data = request.get_json()
    if not data or 'image_id' not in data:
        return jsonify({"error": "Missing image_id in request body"}), 400
    
    image_id = data['image_id']
    
    try:
        # Fetch  image and verify ownership
        image = ImageRecord.query.filter_by(id=image_id, user_id=g.user.id).first()
        if not image:
            return jsonify({"error": "Image not found or unauthorized"}), 404
        
        # Set paths for cleanup
        original_path = os.path.join('data', image.original_path)
        norm_path = os.path.join('data', image.normalized_path)
        annotation_paths = [ann.file_path for ann in image.annotations if ann.file_path]
        
        # Update database
        db.session.delete(image)
        db.session.commit()

        # Execute cleanup
        if os.path.exists(original_path):
            os.remove(original_path)

        if os.path.exists(norm_path):
            os.remove(norm_path)
        
        for ann_path in annotation_paths:
            if os.path.exists(ann_path):
                os.remove(ann_path)
        
        return jsonify({
            "success": True, 
            "message": "Image record successfully deleted"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        print(f"CRITICAL: Failed to execute deletion routine for image {image_id}: {e}")
        return jsonify({"error": "Internal server error occurred during deletion structural sweep"}), 500


@app.route('/delete-annotation', methods=['DELETE'])
def delete_annotations():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_id' not in data or 'detection_setting_id' not in data:
        return jsonify({"error": "Missing image_id or detection_setting_id in request body"}), 400

    image_id = data['image_id']
    detection_setting_id = data['detection_setting_id']

    try:
        # Exactly one annotation should match this (image, detection_setting) pair
        # per the uq_annotation_image_detection_setting constraint on Annotation.
        annotation = Annotation.query.filter_by(
            user_id=g.user.id,
            image_id=image_id,
            detection_setting_id=detection_setting_id
        ).first()

        if not annotation:
            return jsonify({"error": "No matching annotation found"}), 404

        annotation_path = annotation.file_path

        db.session.delete(annotation)
        db.session.commit()

        if annotation_path and os.path.exists(annotation_path):
            os.remove(annotation_path)

        return jsonify({
            "success": True,
            "message": "Annotation successfully deleted"
        }), 200

    except Exception as e:
        db.session.rollback()
        print(f"CRITICAL: Failed to delete annotation for image {image_id}: {e}")
        return jsonify({"error": "Internal server error occurred during annotation deletion"}), 500


@app.route('/clear-annotations', methods=['DELETE'])
def clear_annotations():
    if not g.user:
        return jsonify({"error": "No active session"}), 401
    
    data = request.get_json()
    if not data or 'image_id' not in data or 'annotation_ids' not in data:
        return jsonify({"error": "Missing image_id or annotation_ids in request body"}), 400


    image_id = data['image_id']
    clear_all = data['annotation_ids']

    if not isinstance(annotation_ids, list):
        return jsonify({"error": "annotation_ids must be a list"}), 400
    
    try:
        # Filter the target annotations belonging *only* to this image and matching the requested IDs
        target_annotations = Annotation.query.join(ImageRecord).filter(
            Annotation.id.in_(annotation_ids),
            Annotation.image_id == image_id,
            ImageRecord.user_id == g.user.id
        ).all()
        
        if not target_annotations:
            return jsonify({"error": "No matching annotations found for this image"}), 404

        # Track file paths before removing from the DB
        annotation_paths = [ann.file_path for ann in target_annotations]
        
        # Update database
        for ann in target_annotations:
            db.session.delete(ann)
        db.session.commit()

        # Execute disk cleanup
        deleted_count = 0
        for ann_path in annotation_paths:
            # Resolving path context relative to 'data' directory if your system requires it
            # e.g., actual_path = os.path.join('data', ann_path) if not saved as absolute
            if os.path.exists(ann_path):
                os.remove(ann_path)
                deleted_count += 1
        
        return jsonify({
            "success": True, 
            "message": f"Successfully deleted {len(target_annotations)} database records and {deleted_count} files"
        }), 200
        
    except Exception as e:
        db.session.rollback()
        print(f"CRITICAL: Failed to execute clear routine for annotations on image {image_id}: {e}")
        return jsonify({"error": "Internal server error occurred during annotation sweep"}), 500



# *----------* Image Set Endpoints *----------* #

@app.route('/create-image-set', methods=['POST'])
def create_image_set():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({"error": "Missing 'name' in request body"}), 400

    try:
        new_set = ImageSet(
            id=str(uuid.uuid4()),
            user_id=g.user.id,
            name=data['name'],
            description=data.get('description')  # Optional field
        )
        db.session.add(new_set)
        db.session.commit()

        # Note: The directory 'data/<user_id>/imagesets/<id>' is automatically 
        # created here via the SQLAlchemy 'after_insert' event hook.

        return jsonify(new_set.to_dict()), 201

    except Exception as e:
        db.session.rollback()
        print(f"Error creating image set: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route('/delete-image-set', methods=['POST'])
def delete_image_set():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_set_id' not in data:
        return jsonify({"error": "Missing 'image_set_id' in request body"}), 400

    try:
        image_set = ImageSet.query.filter_by(id=data['image_set_id'], user_id=g.user.id).first()
        if not image_set:
            return jsonify({"error": "Image set not found or unauthorized"}), 404

        db.session.delete(image_set)
        db.session.commit()

        # Note: The physical folder is automatically deleted via the 'after_delete' hook.

        return jsonify({"message": "Image set deleted successfully"}), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error deleting image set: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route('/add-image-to-set', methods=['POST'])
def add_image_to_set():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_set_id' not in data or 'image_id' not in data:
        return jsonify({"error": "Missing 'image_set_id' or 'image_id' in request body"}), 400

    try:
        # Step 1: Query both items ensuring ownership boundaries are respected
        image_set = ImageSet.query.filter_by(id=data['image_set_id'], user_id=g.user.id).first()
        image_record = ImageRecord.query.filter_by(id=data['image_id'], user_id=g.user.id).first()

        if not image_set or not image_record:
            return jsonify({"error": "Image set or Image record not found or unauthorized"}), 404

        # Step 2: Avoid duplicates before attempting insertion
        if image_record in image_set.images:
            return jsonify({"message": "Image already exists in this set"}), 200

        # Step 3: Append to the secondary relationship link table
        image_set.images.append(image_record)
        db.session.commit()

        return jsonify({
            "message": "Image added to set successfully",
            "image_set_id": image_set.id,
            "image_count": len(image_set.images)
        }), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error adding image to set: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route('/remove-image-from-set', methods=['POST'])
def remove_image_from_set():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_set_id' not in data or 'image_id' not in data:
        return jsonify({"error": "Missing 'image_set_id' or 'image_id' in request body"}), 400

    try:
        image_set = ImageSet.query.filter_by(id=data['image_set_id'], user_id=g.user.id).first()
        image_record = ImageRecord.query.filter_by(id=data['image_id'], user_id=g.user.id).first()

        if not image_set or not image_record:
            return jsonify({"error": "Image set or Image record not found or unauthorized"}), 404

        # Step 2: Verify the relation exists before removal
        if image_record not in image_set.images:
            return jsonify({"error": "Image is not a member of this set"}), 400

        # Step 3: Sever relation link
        image_set.images.remove(image_record)
        db.session.commit()

        return jsonify({
            "message": "Image removed from set successfully",
            "image_set_id": image_set.id,
            "image_count": len(image_set.images)
        }), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error removing image from set: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500

        

# *----------* Model Endpoints *----------* #

@app.route('/detect', methods=['POST'])
def detect():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_id' not in data or 'model_id' not in data:
        return jsonify({"error": "Missing image_id or model_id in request body"}), 400

    image_id = data['image_id']
    model_id = data['model_id']
    detection_setting_id = data.get('detection_setting_id')
    threshold = float(data.get('threshold', 0.5))
    cell_diameter = float(data.get('cell_diameter', 34))
    min_cell_diameter = float(data.get('min_cell_diameter', 7))
    max_cell_diameter = float(data.get('max_cell_diameter', 17))
    sublabel = data.get('sublabel', '')
    selected_classes = data.get('selected_classes', None)

    try:
        image_record = ImageRecord.query.filter_by(id=image_id, user_id=g.user.id).first()
        model_record = Weights.query.filter_by(id=model_id, user_id=g.user.id).first()

        if not image_record or not model_record:
            return jsonify({"error": "Data records not found or unauthorized"}), 404

        yolo_string, converted_annotations = execute_detection(
            image_record, model_record, threshold, cell_diameter, sublabel, selected_classes,
            min_cell_diameter=min_cell_diameter, max_cell_diameter=max_cell_diameter
        )

        params = {
            "threshold": threshold,
            "cell_diameter": cell_diameter,
            "min_cell_diameter": min_cell_diameter,
            "max_cell_diameter": max_cell_diameter,
            "sublabel": sublabel,
            "selected_classes": selected_classes,
        }
        target_record = resolve_annotation_record(g.user.id, image_id, model_id, params, detection_setting_id)

        if not target_record.file_path:
            annotation_dir = g.user.get_path('annotations')
            target_record.file_path = os.path.join('data', annotation_dir, f'{target_record.id}.txt')

        # Save the layout flat-file
        os.makedirs(os.path.dirname(target_record.file_path), exist_ok=True)
        with open(target_record.file_path, 'w') as f:
            f.write(yolo_string)

        target_record.annotations_detected = converted_annotations
        target_record.count_detected = len(converted_annotations)
        flag_modified(target_record, "annotations_detected")
        db.session.commit()

        return jsonify({
            "annotations": converted_annotations,
            "detection_setting_id": target_record.detection_setting_id,
            "labels": model_record.label_set.to_dict()
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@app.route('/batch-detect', methods=['POST'])
def batch_detect():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_set_id' not in data or 'detection_settings' not in data:
        return jsonify({"error": "Missing image_set_id or detection_settings in request body"}), 400

    image_set_id = data['image_set_id']
    requested_rows = data['detection_settings']
    # When True (default), re-running a row overwrites any existing results for it.
    # When False, an image/row pair that already has results is left untouched -
    # UNLESS that row's config changed since it last ran (see force_rerun below),
    # since silently keeping results computed under stale settings would be worse
    # than the redundant work overwrite=False is meant to save.
    overwrite = data.get('overwrite', True)

    if not isinstance(requested_rows, list) or len(requested_rows) == 0:
        return jsonify({"error": "detection_settings must be a non-empty list"}), 400

    try:
        image_set = ImageSet.query.filter_by(id=image_set_id, user_id=g.user.id).first()
        if not image_set:
            return jsonify({"error": "Image set not found or unauthorized"}), 404

        # Resolve every requested row's DetectionSetting up front so the full
        # "active" set (for cleanup) and each row's force_rerun flag are known
        # before any image is touched.
        resolved_rows = []
        for row in requested_rows:
            model_id = row.get('model_id')
            model_record = Weights.query.filter_by(id=model_id, user_id=g.user.id).first()
            if not model_record:
                db.session.rollback()
                return jsonify({"error": f"Model {model_id} not found or unauthorized"}), 404

            threshold = float(row.get('threshold', 0.5))
            cell_diameter = float(row.get('cell_diameter', 34))
            min_cell_diameter = float(row.get('min_cell_diameter', 7))
            max_cell_diameter = float(row.get('max_cell_diameter', 17))
            sublabel = row.get('sublabel', '')
            selected_classes = row.get('selected_classes', None)

            params = {
                "threshold": threshold,
                "cell_diameter": cell_diameter,
                "min_cell_diameter": min_cell_diameter,
                "max_cell_diameter": max_cell_diameter,
                "sublabel": sublabel,
                "selected_classes": selected_classes,
            }

            setting, params_changed = resolve_detection_setting(
                g.user.id, model_id, params, row.get('id')
            )

            resolved_rows.append({
                "request_row_id": row.get('id'),
                "setting": setting,
                "model_record": model_record,
                "threshold": threshold,
                "cell_diameter": cell_diameter,
                "min_cell_diameter": min_cell_diameter,
                "max_cell_diameter": max_cell_diameter,
                "sublabel": sublabel,
                "selected_classes": selected_classes,
                "force_rerun": params_changed,
            })

        db.session.commit()
        active_setting_ids = {r["setting"].id for r in resolved_rows}

        image_results = []
        for image_record in image_set.images:
            row_results = []
            deleted_setting_ids = []
            try:
                for r in resolved_rows:
                    setting = r["setting"]
                    existing = Annotation.query.filter_by(
                        user_id=g.user.id, image_id=image_record.id, detection_setting_id=setting.id
                    ).first()

                    if existing and existing.file_path and not overwrite and not r["force_rerun"]:
                        row_results.append({
                            "detection_setting_id": setting.id,
                            "skipped": True,
                            "count_detected": existing.count_detected
                        })
                        continue

                    yolo_string, converted_annotations = execute_detection(
                        image_record, r["model_record"], r["threshold"], r["cell_diameter"], r["sublabel"],
                        r["selected_classes"], min_cell_diameter=r["min_cell_diameter"],
                        max_cell_diameter=r["max_cell_diameter"]
                    )

                    target_record = existing
                    if not target_record:
                        target_record = Annotation(
                            id=str(uuid.uuid4()), user_id=g.user.id, image_id=image_record.id,
                            detection_setting_id=setting.id
                        )
                        db.session.add(target_record)
                        db.session.flush()

                    if not target_record.file_path:
                        annotation_dir = g.user.get_path('annotations')
                        target_record.file_path = os.path.join('data', annotation_dir, f'{target_record.id}.txt')

                    os.makedirs(os.path.dirname(target_record.file_path), exist_ok=True)
                    with open(target_record.file_path, 'w') as f:
                        f.write(yolo_string)

                    target_record.annotations_detected = converted_annotations
                    target_record.count_detected = len(converted_annotations)
                    flag_modified(target_record, "annotations_detected")

                    row_results.append({
                        "detection_setting_id": setting.id,
                        "skipped": False,
                        "count_detected": len(converted_annotations)
                    })

                # Cleanup: when overwrite is set, this image should only carry
                # annotations for rows in this batch run - delete anything left
                # over from other rows. When overwrite is False, leave other
                # rows' results alone.
                if overwrite:
                    stale = Annotation.query.filter(
                        Annotation.user_id == g.user.id,
                        Annotation.image_id == image_record.id,
                        ~Annotation.detection_setting_id.in_(active_setting_ids)
                    ).all()
                    for ann in stale:
                        if ann.file_path and os.path.exists(ann.file_path):
                            os.remove(ann.file_path)
                        deleted_setting_ids.append(ann.detection_setting_id)
                        db.session.delete(ann)

                db.session.commit()
                image_results.append({
                    "image_id": image_record.id,
                    "success": True,
                    "rows": row_results,
                    "deleted_setting_ids": deleted_setting_ids
                })

            except Exception as e:
                db.session.rollback()
                image_results.append({
                    "image_id": image_record.id,
                    "success": False,
                    "error": str(e)
                })

        return jsonify({
            "status": "complete",
            "image_set_id": image_set_id,
            "resolved_settings": [
                {"request_row_id": r["request_row_id"], "detection_setting_id": r["setting"].id}
                for r in resolved_rows
            ],
            "total": len(image_results),
            "succeeded": sum(1 for r in image_results if r["success"]),
            "failed": sum(1 for r in image_results if not r["success"]),
            "results": image_results
        })

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# *----------* Fine Tune Endpoints *----------* #

import yaml

@app.route('/train-model', methods=['POST'])
def train_model():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'image_set_id' not in data or 'weights_id' not in data:
        return jsonify({"error": "Missing image_set_id or weights_id in request body"}), 400

    image_set_id = data['image_set_id']
    weights_id = data['weights_id']
    epochs = int(data.get('epochs', 20))
    label = data.get('label') or 'finetuned'

    run_dir = None
    try:
        image_set = ImageSet.query.filter_by(id=image_set_id, user_id=g.user.id).first()
        weights_record = Weights.query.filter_by(id=weights_id, user_id=g.user.id).first()

        if not image_set or not weights_record:
            return jsonify({"error": "ImageSet or Weights not found or unauthorized"}), 404

        image_ids = [img.id for img in image_set.images]

        # Every annotation for this image set that was produced under a
        # DetectionSetting tied to the target model - drawn + detected boxes
        # merged together per image.
        annotations = (
            Annotation.query
            .join(DetectionSetting, Annotation.detection_setting_id == DetectionSetting.id)
            .filter(
                DetectionSetting.weights_id == weights_id,
                Annotation.user_id == g.user.id,
                Annotation.image_id.in_(image_ids)
            )
            .all()
        )

        annotations_by_image = {}
        for ann in annotations:
            annotations_by_image.setdefault(ann.image_id, []).append(ann)

        image_records = [img for img in image_set.images if img.id in annotations_by_image]
        if not image_records:
            return jsonify({"error": "No annotations found for this model in this image set"}), 400

        # 1. Build the YOLO dataset layout in a scratch directory for this run
        run_id = str(uuid.uuid4())
        run_dir = os.path.join('data', g.user.id, 'training_runs', run_id)
        img_dir = os.path.join(run_dir, 'images')
        lbl_dir = os.path.join(run_dir, 'labels')
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(lbl_dir, exist_ok=True)

        for image_record in image_records:
            src_image_path = os.path.join('data', image_record.normalized_path)
            dst_image_path = os.path.join(img_dir, f"{image_record.id}.png")
            relative_src = os.path.relpath(src_image_path, start=img_dir)
            os.symlink(relative_src, dst_image_path)

            img_w = image_record.width
            img_h = image_record.height

            combined_yolo_lines = []
            for ann in annotations_by_image[image_record.id]:
                for box in ann.annotations_drawn + ann.annotations_detected:
                    # Stored boxes are in pixel space with (x, y) as the
                    # top-left corner - convert to normalized YOLO
                    # (class, center_x, center_y, width, height).
                    x_center = (box['x'] + box['w'] / 2) / img_w
                    y_center = (box['y'] + box['h'] / 2) / img_h
                    w_norm = box['w'] / img_w
                    h_norm = box['h'] / img_h
                    combined_yolo_lines.append("{0} {1:.6f} {2:.6f} {3:.6f} {4:.6f}".format(
                        box['class'], x_center, y_center, w_norm, h_norm
                    ))

            with open(os.path.join(lbl_dir, f"{image_record.id}.txt"), 'w') as f:
                f.write("\n".join(combined_yolo_lines))

        class_names = [label['name'] for label in weights_record.label_set.labels]
        yaml_path = os.path.join(run_dir, 'dataset.yaml')
        with open(yaml_path, 'w') as f:
            yaml.dump({
                'path': os.path.abspath(run_dir),
                'train': 'images',
                'val': 'images',
                'nc': len(class_names),
                'names': class_names
            }, f, default_flow_style=False)

        # 2. Fine-tune starting from the selected model's current weights
        snapshot_dir = os.path.join('data', g.user.id, 'snapshots')
        train_cmd = [
            sys.executable, 'scripts/run_train.py',
            '--data', yaml_path,
            '--weights', weights_record.file_path,
            '--epochs', str(epochs),
            '--project', snapshot_dir,
            '--name', run_id,
        ]
        subprocess.run(train_cmd, check=True)

        best_path = os.path.join(snapshot_dir, run_id, 'weights', 'best.pt')
        if not os.path.exists(best_path):
            return jsonify({"error": "best.pt not found after training"}), 500

        # 3. Register the fine-tuned checkpoint as a model named
        # "<base name>_<label>". If a model with that name already exists for
        # this user, overwrite it in place instead of creating a duplicate -
        # but never a default model's weights.
        new_name = f"{weights_record.name}_{label}"
        target_weights = Weights.query.filter_by(user_id=g.user.id, name=new_name).first()

        if target_weights and target_weights.is_default:
            return jsonify({"error": f"'{new_name}' is a default model and can't be overwritten. Choose a different label."}), 400

        new_weights_id = target_weights.id if target_weights else str(uuid.uuid4())
        model_dir = g.user.get_path('models')
        final_path = os.path.join('data', model_dir, f'{new_weights_id}.pt')
        os.makedirs(os.path.dirname(final_path), exist_ok=True)
        shutil.copy2(best_path, final_path)

        if target_weights:
            target_weights.file_path = final_path
            target_weights.label_set_id = weights_record.label_set_id
            new_weights = target_weights
        else:
            new_weights = Weights(
                id=new_weights_id,
                user_id=g.user.id,
                name=new_name,
                file_path=final_path,
                label_set_id=weights_record.label_set_id
            )
            db.session.add(new_weights)
        db.session.commit()

        # 4. Optional 5-fold cross-validation for a quality readout
        kfold_text = ""
        if len(image_records) >= 5:
            kfold_dir = os.path.join(snapshot_dir, run_id, 'kfold')
            os.makedirs(kfold_dir, exist_ok=True)
            kfold_cmd = [
                sys.executable, 'scripts/kfold_train.py',
                '--image_dir', img_dir,
                '--label_dir', lbl_dir,
                '--weights', best_path,
                '--epochs', str(epochs),
                '--output_dir', kfold_dir,
                '--nc', str(len(class_names)),
                '--names'
            ] + class_names
            subprocess.run(kfold_cmd, check=True)

            kfold_result_path = os.path.join(kfold_dir, 'kfold_results.txt')
            if os.path.exists(kfold_result_path):
                with open(kfold_result_path, 'r') as f:
                    kfold_text = f.read()

        return jsonify({
            "message": "Model fine-tuned successfully",
            "weights": new_weights.to_dict(),
            "total_images": len(image_records),
            "kfold_results": kfold_text
        }), 200

    except subprocess.CalledProcessError as e:
        return jsonify({"error": f"Training subprocess failed: {str(e)}"}), 500
    except Exception as e:
        db.session.rollback()
        print(f"Error training model: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500
    finally:
        # The dataset built in run_dir is scratch space - only best.pt (already
        # copied out to the model's own file) needs to survive the request.
        if run_dir and os.path.exists(run_dir):
            shutil.rmtree(run_dir, ignore_errors=True)


@app.route('/delete-model', methods=['DELETE'])
def delete_model():
    if not g.user:
        return jsonify({"error": "No active session"}), 401

    data = request.get_json()
    if not data or 'weights_id' not in data:
        return jsonify({"error": "Missing weights_id in request body"}), 400

    weights_id = data['weights_id']
    force = bool(data.get('force', False))

    try:
        weights_record = Weights.query.filter_by(id=weights_id, user_id=g.user.id).first()
        if not weights_record:
            return jsonify({"error": "Model not found or unauthorized"}), 404

        if weights_record.is_default:
            return jsonify({"error": "Default models can't be deleted"}), 400

        detection_settings = DetectionSetting.query.filter_by(weights_id=weights_id, user_id=g.user.id).all()

        # Without `force`, just report what's in the way so the caller can
        # confirm with the user before we cascade the delete.
        if detection_settings and not force:
            annotation_count = sum(len(ds.annotations) for ds in detection_settings)
            return jsonify({
                "error": "in_use",
                "message": "This model is used by existing detection rows.",
                "detection_setting_count": len(detection_settings),
                "annotation_count": annotation_count
            }), 409

        for ds in detection_settings:
            for ann in list(ds.annotations):
                if ann.file_path and os.path.exists(ann.file_path):
                    os.remove(ann.file_path)
                db.session.delete(ann)
            db.session.delete(ds)

        file_path = weights_record.file_path
        db.session.delete(weights_record)
        db.session.commit()

        if file_path and os.path.exists(file_path):
            os.remove(file_path)

        return jsonify({"success": True, "message": "Model deleted"}), 200

    except Exception as e:
        db.session.rollback()
        print(f"Error deleting model {weights_id}: {e}")
        return jsonify({"error": "Internal server error occurred during model deletion"}), 500


# *----------* OLD Endpoints *----------* #

@app.route('/preview-tiff', methods=['POST']) #TODO: Remove
def preview_tiff():
    tmp_in_path = None
    tmp_out_path = None
    try:
        file = request.files.get('file')
        if not file:
            return jsonify({'error': 'No file provided'}), 400

        with tempfile.NamedTemporaryFile(suffix='.tiff', delete=False) as tmp_in:
            file.save(tmp_in.name)
            tmp_in_path = tmp_in.name

        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_out:
            tmp_out_path = tmp_out.name

        normalize_image(tmp_in_path, tmp_out_path)

        with open(tmp_out_path, 'rb') as f:
            buf = io.BytesIO(f.read())

        return send_file(buf, mimetype='image/png')

    except Exception as e:
        return jsonify({'error': str(e)}), 500

    finally:
        if tmp_in_path and os.path.exists(tmp_in_path):
            os.remove(tmp_in_path)
        if tmp_out_path and os.path.exists(tmp_out_path):
            os.remove(tmp_out_path)


from scripts.detect_tiles import detect_tiles_in_batch


@app.route('/converted/<filename>') #TODO: Remove
def serve_converted(filename):
    user_id = session['user_id']
    converted_dir = os.path.join('users', user_id, 'converted')
    return send_from_directory(converted_dir, filename)

@app.route('/tile/<filename>/<int:tx>/<int:ty>/<int:tile_size>') #TODO: Update
def serve_tile(filename, tx, ty, tile_size):
    user_id = session['user_id']
    filename = secure_filename(filename)
    path = os.path.join('users', user_id, 'converted', filename)
    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404
    x = tx * tile_size
    y = ty * tile_size
    with Image.open(path) as img:
        w, h = img.size
        if x >= w or y >= h:
            return jsonify({'error': 'Tile out of bounds'}), 400
        tile = img.crop((x, y, min(x + tile_size, w), min(y + tile_size, h)))
    buf = io.BytesIO()
    tile.save(buf, 'PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')


@app.route('/snapshots/<path:filename>') #TODO: Remove
def serve_snapshot(filename):
    user_id = session['user_id']
    snapshot_dir = os.path.join('users', user_id, 'snapshots')
    return send_from_directory(snapshot_dir, filename)

@app.route('/api/preview/<filename>') #TODO: Remove
def serve_thumbnail(filename):
    user_id = session['user_id']
    
    directory = os.path.join('users', str(user_id), 'thumbnails')
    
    print(f"Looking for thumbnail in: {directory}/{filename}") # Debug print
    
    return send_from_directory(directory, filename)

@app.route('/api/images/<filename>') #TODO: Remove
def serve_original_image(filename):
    user_id = session.get('user_id')
    directory = os.path.join('users', user_id, 'saved_data')
    return send_from_directory(directory, filename)

@app.route('/api/annotations/<filename>') #TODO: Remove
def serve_annotation_file(filename):
    user_id = session.get('user_id')
    directory = os.path.join('users', user_id, 'saved_annotations')
    return send_from_directory(directory, filename)


from flask import jsonify, session
from tensorflow.python.summary.summary_iterator import summary_iterator
import os
import glob

@app.route('/events-data', methods=['GET']) #TODO: Update
def events_data():
    user_id = session.get('user_id')
    base_path = os.path.join('users', user_id, 'snapshots')
    run_directories = glob.glob(os.path.join(base_path, 'run_*'))
    if not run_directories:
        return jsonify({'error': f'No runs found for current session'}), 404
    run_directories.sort()
    log_dir = run_directories[-1]

    if not os.path.exists(log_dir):
        return jsonify({'error': f'Log dir not found: {log_dir}'}), 404

    # Find all event files directly in train/
    event_files = glob.glob(os.path.join(log_dir, 'events.out.tfevents.*'))
    # Only pick files older than 5 seconds (to avoid reading during flush)
    now = time.time()
    event_files = [f for f in event_files if now - os.path.getmtime(f) > 5]
    if not event_files:
        return jsonify({'error': 'No event files found in train/'}), 404

    # Pick the newest one
    event_files.sort(key=os.path.getmtime, reverse=True)
    latest = event_files[0]
    print(f"[events-data] ✅ Reading from: {latest}")

    scalars = {}
    for e in summary_iterator(latest):
        if not e.summary:
            continue
        for v in e.summary.value:
            val = get_scalar_value(v)
            if val is not None:
                print(f"✅ Tag: {v.tag}, value: {val}")
                scalars.setdefault(v.tag, []).append({
                    'step': e.step,
                    'wall_time': e.wall_time,
                    'value': val
                })


    if not scalars:
        return jsonify({'error': 'No scalar values found'}), 404

    return jsonify(scalars)




def delete_expired_sessions(): #TODO: Update
    now = datetime.datetime.utcnow()  # Use UTC time
    users_dir = 'users'
    for user_id in os.listdir(users_dir):
        user_path = os.path.join(users_dir, user_id)
        if os.path.isdir(user_path):
            try:
                mod_time = datetime.datetime.utcfromtimestamp(os.path.getmtime(user_path))
                if (now - mod_time).total_seconds() > 86400:
                    shutil.rmtree(user_path)
                    print(f"Cleaned expired session: {user_id}")
            except Exception as e:
                print(f"Error cleaning {user_id}: {str(e)}")
# Initialize scheduler
scheduler = BackgroundScheduler()
scheduler.add_job(func=delete_expired_sessions, trigger="interval", hours=24)
scheduler.start()

# Shut down the scheduler when exiting the app
atexit.register(lambda: scheduler.shutdown())
atexit.register(sahi_worker.shutdown)


if __name__ == '__main__':
    print('starting application')
    # Schema is managed by Flask-Migrate now. Run `flask db upgrade` before
    # starting the app to create/update tables instead of db.create_all().
    app.run(host='0.0.0.0', port=5002, debug=True, threaded=True)
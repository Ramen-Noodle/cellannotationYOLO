import os
import numpy as np
from PIL import Image
from stardist.models import StarDist2D
from skimage.measure import regionprops
from csbdeep.utils import normalize

_model_cache: dict = {}

def get_model(model_path: str) -> StarDist2D:
    if model_path not in _model_cache:
        basedir = os.path.dirname(model_path)
        name = os.path.basename(model_path)
        model = StarDist2D(None, name=name, basedir=basedir)

        # Warmup
        dummy = np.zeros((256, 256), dtype=np.float32)
        model.predict_instances(dummy, n_tiles=(1, 1))

        _model_cache[model_path] = model
    return _model_cache[model_path]


def run_detection(
    image_source,
    model_path: str,
    prob_thresh: float = 0.479071463157368,
    nms_thresh: float = 0.3,
    n_tiles: tuple = (4, 4),  # Bumped up from (2, 2) for 45MP images
    norm_low: float = 1,
    norm_high: float = 99.8,
) -> np.ndarray:
    """
    Runs StarDist prediction and returns the raw labels array.
    """
    if isinstance(image_source, Image.Image):
        img = image_source.convert('L') if image_source.mode != 'L' else image_source
        sd_img = np.array(img)
    else:
        img = Image.open(image_source).convert('L')
        sd_img = np.array(img)

    sd_img = normalize(sd_img, norm_low, norm_high)

    model = get_model(model_path)
    print(f'[DEBUG] sd_img shape: {sd_img.shape}, dtype: {sd_img.dtype}, n_tiles: {n_tiles}')
    labels, details = model.predict_instances(
        sd_img,
        axes='YX',
        n_tiles=n_tiles,
        prob_thresh=prob_thresh,
        nms_thresh=nms_thresh,
    )
    print(f'[DEBUG] predict_instances returned: {labels.max()} instances')
    return labels


def predictions_to_yolo(
    labels, 
    image_width: int, 
    image_height: int, 
    min_diam: float = 0, 
    max_diam: float = float('inf')
) -> str:
    """
    Converts StarDist labels to YOLO format, filtering by diameter inline 
    to completely avoid heavy array-masking bottlenecks.
    """
    lines = []
    # regionprops calculates properties efficiently in one pass
    for prop in regionprops(labels):
        # Filter inline here instead of rewriting the entire image array
        if not (min_diam <= prop.equivalent_diameter <= max_diam):
            continue
            
        min_r, min_c, max_r, max_c = prop.bbox
        x_center = ((min_c + max_c) / 2) / image_width
        y_center = ((min_r + max_r) / 2) / image_height
        width    = (max_c - min_c) / image_width
        height   = (max_r - min_r) / image_height
        lines.append(
            f"0 {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f} 1.0000"
        )
    return "\n".join(lines)


def stardist_detect_to_yolo(
    image_source,
    model_path: str,
    image_width: int,
    image_height: int,
    prob_thresh: float = 0.479071463157368,
    nms_thresh: float = 0.3,
    n_tiles: tuple = (4, 4),  # Recommended (4, 4) or (8, 8) for 10000x4500
    nucleus_diam_min: float = 7,
    nucleus_diam_max: float = 17,
    norm_low: float = 1,
    norm_high: float = 99.8,
) -> str:
    """
    Convenience wrapper — runs detection and returns a YOLO annotation string.
    """
    labels = run_detection(image_source, model_path, prob_thresh, nms_thresh, n_tiles, norm_low, norm_high)
    print(f'[DEBUG] raw labels: {labels.max()} instances')
    
    # Combined step: Converts and filters at the exact same time
    result = predictions_to_yolo(labels, image_width, image_height, nucleus_diam_min, nucleus_diam_max)
    print(f'[DEBUG] yolo_output lines: {len(result.splitlines()) if result else 0}')
    return result
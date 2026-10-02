"""Detector-independent serialization of canonical UI pixel boxes.

Database JSON is authoritative: legacy annotation text files have mixed units.
"""
import math


def channel_label(channel):
    """Readable channel identity without guessing a fluorophore from its position."""
    return f'C{channel.order_index + 1}'


def normalized_box(box, width, height):
    width, height = float(width), float(height)
    values = [float(box[key]) for key in ('x', 'y', 'w', 'h')]
    if not all(math.isfinite(v) for v in [width, height] + values):
        raise ValueError('Image dimensions and box coordinates must be finite')
    if width <= 0 or height <= 0 or values[2] <= 0 or values[3] <= 0:
        raise ValueError('Image and box dimensions must be positive')
    x, y, w, h = values
    # Clip boxes drawn across the image boundary to the actual image extent.
    left, top = max(0., x), max(0., y)
    right, bottom = min(width, x + w), min(height, y + h)
    if right <= left or bottom <= top:
        raise ValueError('Annotation lies outside the image')
    return [(left + right) / (2 * width), (top + bottom) / (2 * height),
            (right - left) / width, (bottom - top) / height]


def confidence_value(value):
    """Legacy 100 sentinels and absent scores are unknown, never probabilities."""
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) and 0 <= value <= 1 else None


def annotation_rows(record, width, height):
    for field, source in (('annotations_detected', 'detected'), ('annotations_drawn', 'manual')):
        for box in getattr(record, field, None) or []:
            yield {'class_id': int(box['class']),
                   'box': normalized_box(box, width, height),
                   'confidence': confidence_value(box.get('confidence')),
                   'source': source}


def yolo_line(row, label=None, include_confidence=False):
    parts = [str(row['class_id'] if label is None else label)]
    parts.extend(f'{v:.6f}' for v in row['box'])
    if include_confidence:
        score = row['confidence']
        parts.append('null' if score is None else f'{score:.6f}')
    return ' '.join(parts)


def serialize_annotations(record, width, height):
    return '\n'.join(yolo_line(row, include_confidence=True)
                     for row in annotation_rows(record, width, height))

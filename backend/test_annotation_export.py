"""Run: python -m unittest discover -s backend -p 'test_annotation_export.py'.

Route functions are loaded without ML imports or starting workers. Database and
request boundaries are mocked; serialization and archive generation run normally.
"""
import ast
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import MagicMock
import zipfile

from annotation_export import annotation_rows, normalized_box, serialize_annotations, yolo_line, channel_label


def load_functions(names, namespace):
    tree = ast.parse(Path(__file__).with_name('app.py').read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'app.py', 'exec'), namespace)
    return namespace


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.box = dict(x=100, y=200, w=40, h=80, **{'class': 0}, confidence=0.75)
        self.record = NS(id='run1', detection_setting_id='setting1', annotations_detected=[self.box], annotations_drawn=[],
                         file_path='nonexistent-legacy-file.txt',
                         detection_setting=NS(id='setting1', weights_id='model1', params={}))
        self.channel = NS(id='channel1', name='green', order_index=0)
        self.image = NS(id='image1', width=1000, height=500, channels=[self.channel], base_channel=self.channel)
        self.model = NS(id='model1', name='MADM', label_set=NS(labels=[{'name': 'neuron'}]))
        self.db = MagicMock()
        self.db.session.get.return_value = self.model
        self.Annotation = MagicMock()
        self.Annotation.query.filter_by.return_value.all.return_value = [self.record]
        self.ns = load_functions({'_image_export', 'export_annotations', 'save_annotations', 'execute_detection', 'upload_cropped_file'}, {
            'annotation_rows': annotation_rows, 'yolo_line': yolo_line,
            'channel_label': channel_label,
            'serialize_annotations': serialize_annotations, 'json': json,
            'Annotation': self.Annotation, 'Weights': object, 'db': self.db,
            'io': io, 'zipfile': zipfile, 'os': os,
        })

    def test_pixel_center_conversion(self):
        self.assertEqual(normalized_box(self.box, 1000, 500), [.12, .48, .04, .16])

    def test_border_clip(self):
        self.assertEqual(normalized_box(dict(x=-10, y=0, w=20, h=10), 100, 100), [.05, .05, .1, .1])

    def test_invalid_geometry(self):
        for changes in ({'w': 0}, {'x': float('nan')}, {'x': 2000}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                normalized_box(self.box | changes, 1000, 500)

    def test_unknown_confidence_is_not_fabricated(self):
        for value in (None, 100, float('nan')):
            self.record.annotations_detected = [self.box | {'confidence': value}]
            self.assertTrue(serialize_annotations(self.record, 1000, 500).endswith(' null'))

    def test_export_ignores_stale_files(self):
        files = self.ns['_image_export'](self.image, 'user', 'number', True)
        self.assertEqual(files['image1_C1_run1.txt'], 'C1 0 0.120000 0.480000 0.040000 0.160000 0.750000')
        meta = json.loads(files['image1.metadata.json'])
        self.assertEqual(meta['runs'][0]['class_mapping'], [{'name': 'neuron'}])

    def test_combined_export_preserves_channel_identity(self):
        self.image.channels.append(NS(id='channel2', name='red', order_index=1))
        files = self.ns['_image_export'](self.image, 'user', 'name', False)
        meta = json.loads(files['image1.metadata.json'])
        self.assertEqual([r['channel_id'] for r in meta['runs']], ['channel1', 'channel2'])
        self.assertEqual([r['line_numbers'] for r in meta['runs']], [[1], [2]])
        self.assertEqual(len(files['image1.txt'].splitlines()), 2)
        self.assertEqual([line.split()[:2] for line in files['image1.txt'].splitlines()],
                         [['C1', 'neuron'], ['C2', 'neuron']])
        self.assertEqual(meta['columns'][0], 'channel')

    def test_stardist_legacy_score_is_unknown(self):
        self.model.name = 'StarDist'
        self.box['confidence'] = 1.0
        files = self.ns['_image_export'](self.image, 'user', 'number', True)
        self.assertTrue(files['image1_C1_run1.txt'].endswith(' null'))

    def test_channel_column_in_both_formats_with_three_channels(self):
        self.image.channels += [NS(id='channel2', name='same', order_index=1),
                                NS(id='channel3', name='same', order_index=2)]
        for label_format in ('name', 'number'):
            for confidence in (False, True):
                files = self.ns['_image_export'](self.image, 'user', label_format, confidence)
                rows = [line.split() for path, text in files.items() if path.endswith('.txt')
                        for line in text.splitlines()]
                self.assertEqual([r[0] for r in rows], ['C1', 'C2', 'C3'])
                self.assertTrue(all(len(r) == (7 if confidence else 6) for r in rows))
                self.assertTrue(all(r[1] == ('neuron' if label_format == 'name' else '0') for r in rows))

    def test_manual_and_empty_records(self):
        self.record.annotations_detected = []
        self.record.annotations_drawn = [self.box | {'confidence': None}]
        rows = list(annotation_rows(self.record, 1000, 500))
        self.assertEqual(rows[0]['source'], 'manual')
        self.record.annotations_drawn = []
        files = self.ns['_image_export'](self.image, 'user', 'number', False)
        self.assertEqual(files['image1_C1_run1.txt'], '')
        self.assertEqual(json.loads(files['image1.metadata.json'])['runs'][0]['annotations'], [])

    def test_export_archive_and_ownership(self):
        images = MagicMock()
        images.query.filter_by.return_value.first.return_value = self.image
        self.ns.update(g=NS(user=NS(id='user')), request=NS(json={'image_id': 'image1'}),
                       ImageRecord=images, jsonify=lambda x: x, secure_filename=lambda s: s,
                       send_file=lambda stream, **kwargs: (stream.getvalue(), kwargs))
        data, info = self.ns['export_annotations']()
        images.query.filter_by.assert_called_once_with(id='image1', user_id='user')
        self.assertEqual(info['mimetype'], 'application/zip')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertIn('image1.metadata.json', archive.namelist())
        images.query.filter_by.return_value.first.return_value = None
        self.assertEqual(self.ns['export_annotations']()[1], 404)

    def test_save_last_deletion_clears_file_and_database(self):
        channel_model = MagicMock()
        self.channel.image_record = self.image
        channel_model.query.join.return_value.filter.return_value.first.return_value = self.channel
        with tempfile.TemporaryDirectory() as tmp:
            self.record.file_path = os.path.join(tmp, 'annotations.txt')
            Path(self.record.file_path).write_text('old detection')
            self.ns.update(
                g=NS(user=NS(id='user', get_path=lambda _: tmp)),
                request=NS(get_json=lambda: {'annotations': [{
                    'weights_id': 'model1', 'channel_id': 'channel1', 'annotations_detected': [],
                    'annotations_drawn': [], 'detection_setting_id': 'setting1'}]}),
                resolve_annotation_record=lambda *args: self.record,
                flag_modified=lambda *args: None, Channel=channel_model,
                ImageRecord=MagicMock(), jsonify=lambda x: x)
            result, status = self.ns['save_annotations']()
            self.assertEqual(status, 200, result)
            self.assertEqual(self.record.annotations_detected, [])
            self.assertEqual(self.record.count_detected, 0)
            self.assertEqual(Path(self.record.file_path).read_text(), '')

    def test_detection_save_export_round_trip(self):
        self.channel.image_record = self.image
        worker = MagicMock()
        worker.run_job.return_value = '0 0.120000 0.480000 0.040000 0.160000 0.750000'
        self.channel.normalized_path = 'unused.png'
        self.model.file_path = 'unused.pt'
        self.ns.update(sahi_worker=worker, preprocess_image=lambda **kw: {
            'det_w': 2000, 'det_h': 1000, 'scaling_factor': 2})
        text, boxes = self.ns['execute_detection'](self.channel, self.model, .5, 17, '')
        self.assertTrue(text.endswith('0.750000'))
        self.record.annotations_detected = boxes
        self.assertEqual(serialize_annotations(self.record, 1000, 500), text)
        self.assertEqual(self.ns['_image_export'](self.image, 'user', 'number', True)['image1_C1_run1.txt'], 'C1 ' + text)

    def test_multiple_settings_do_not_collide(self):
        second = NS(**(vars(self.record) | {'id': 'run2'}))
        self.Annotation.query.filter_by.return_value.all.return_value = [self.record, second]
        files = self.ns['_image_export'](self.image, 'user', 'number', False)
        self.assertIn('image1_C1_run1.txt', files)
        self.assertIn('image1_C1_run2.txt', files)

    def test_crop_preserves_full_image_coordinates_and_confidence(self):
        self.channel.original_path = 'unused.tiff'
        self.channel.normalized_path = 'unused.png'
        self.channel.p_low, self.channel.p_high = 1, 99
        self.record.annotations_detected.append(self.box | {'x': 800})
        self.db.session.get.return_value = self.image
        with tempfile.TemporaryDirectory() as tmp:
            self.record.file_path = os.path.join(tmp, 'boxes.txt')
            self.ns.update(request=NS(form={'image_id': 'image1', 'x': '0', 'y': '0',
                                           'width': '500', 'height': '500'}),
                           ImageRecord=object, np=MagicMock(), tifffile=MagicMock(),
                           normalize_image=MagicMock(), flag_modified=lambda *args: None,
                           jsonify=lambda value: value)
            result = self.ns['upload_cropped_file']()
            self.assertIn('channels', result)
            self.assertEqual(len(self.record.annotations_detected), 1)
            self.assertEqual(Path(self.record.file_path).read_text(),
                             '0 0.120000 0.480000 0.040000 0.160000 0.750000')


if __name__ == '__main__':
    unittest.main()

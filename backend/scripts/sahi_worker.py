# scripts/sahi_worker.py
"""
Manages a single long-lived SAHI worker process.
"""
import multiprocessing
import queue
import threading
import time
import uuid

SAHI_TIMEOUT_SECONDS = 1800  # Safety-net timeout only — not a cap on legitimate large-file run time.

_ctx = multiprocessing.get_context('spawn')  # fork is not CUDA-safe

_process = None
_job_queue = None
_result_queue = None
_lock = threading.Lock()


def _worker_loop(job_queue, result_queue):
    from PIL import Image
    from scripts.sahi_detect import detect_to_yolo

    while True:
        job_id, job = job_queue.get()
        if job is None:
            break

        try:
            image_path = job['image_path']
            if job['scaling_factor'] != 1.0:
                img = Image.open(image_path)
                image_source = img.resize((job['det_w'], job['det_h']), Image.Resampling.LANCZOS)
            else:
                image_source = image_path

            yolo_string = detect_to_yolo(
                image_path=image_source,
                model_path=job['model_path'],
                image_width=job['det_w'],
                image_height=job['det_h'],
                threshold=job['threshold'],
                slice_size=job['slice_size'],
                overlap=job['overlap'],
                device=job['device'],
            )
            result_queue.put((job_id, {"ok": True, "yolo": yolo_string}))
        except Exception as e:
            result_queue.put((job_id, {"ok": False, "error": str(e)}))


def _ensure_worker_alive():
    global _process, _job_queue, _result_queue
    if _process is not None and _process.is_alive():
        return
    _job_queue = _ctx.Queue()
    _result_queue = _ctx.Queue()
    _process = _ctx.Process(target=_worker_loop, args=(_job_queue, _result_queue), daemon=True)
    _process.start()


def _kill_worker():
    global _process
    if _process is None:
        return
    if _process.is_alive():
        _process.terminate()
        _process.join(5)
        if _process.is_alive():
            _process.kill()
            _process.join()
    _process = None


def run_job(image_path, det_w, det_h, scaling_factor, model_path, threshold,
            slice_size=640, overlap=0.2, device="cuda:0", timeout=SAHI_TIMEOUT_SECONDS):
    with _lock:
        _ensure_worker_alive()

        job_id = str(uuid.uuid4())
        _job_queue.put((job_id, {
            'image_path': image_path,
            'det_w': det_w,
            'det_h': det_h,
            'scaling_factor': scaling_factor,
            'model_path': model_path,
            'threshold': threshold,
            'slice_size': slice_size,
            'overlap': overlap,
            'device': device,
        }))

        start = time.time()
        while time.time() - start < timeout:
            try:
                response_id, response = _result_queue.get(timeout=1)
                if response_id != job_id:
                    continue  # stale response from a previous job; keep waiting for ours
                if response["ok"]:
                    return response["yolo"]
                raise RuntimeError(response["error"])
            except queue.Empty:
                if not _process.is_alive():
                    _kill_worker()
                    raise RuntimeError(
                        "SAHI worker process crashed unexpectedly during detection — "
                        "please retry or report this image."
                    )

        _kill_worker()
        raise RuntimeError(
            f"SAHI detection timed out after {timeout // 60} minutes — "
            "the process may be stuck; please retry or report this image."
        )


def shutdown():
    global _process
    if _process is not None and _process.is_alive():
        try:
            _job_queue.put(None)
            _process.join(5)
        except Exception:
            pass
    _kill_worker()

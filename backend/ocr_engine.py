"""
OCR引擎封装 — 基于PaddleOCR + 多页并行 + 速度优化
"""
import os

# === ONNX 线程控制 ===
# 并行OCR时，限制每个worker的线程数，避免多worker争抢CPU核导致上下文切换开销
# 必须在 import paddleocr 之前设置
_cpu_count = os.cpu_count() or 4
_workers = int(os.environ.get("OCR_WORKERS", "3"))
_threads_per_worker = max(1, _cpu_count // (_workers + 1))  # +1 给主线程留余量
os.environ.setdefault("OMP_NUM_THREADS", str(_threads_per_worker))
os.environ.setdefault("MKL_NUM_THREADS", str(_threads_per_worker))
os.environ.setdefault("OPENBLAS_NUM_THREADS", str(_threads_per_worker))

import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from paddleocr import PaddleOCR
from config import (
    OCR_LANG, OCR_WORKERS,
    OCR_DET_LIMIT, OCR_REC_BATCH, OCR_DET_THRESH,
    OCR_DET_BOX_THRESH, OCR_PRE_SCALE_PX,
)
from image_preprocessor import enhance_for_ocr, binarize_for_preview

# 全局单例 + 线程锁（PaddleOCR predict 非线程安全）
_ocr_instance = None
_ocr_lock = threading.Lock()


def _pre_scale_image(image_path: str, max_pixels: int = None) -> str | None:
    """
    如果图片尺寸超过 max_pixels 任一维度，等比缩放到该尺寸以内。
    返回缩放后的临时图片路径；不需要缩放则返回 None。
    """
    if max_pixels is None:
        max_pixels = OCR_PRE_SCALE_PX
    try:
        from PIL import Image
        img = Image.open(image_path)
        w, h = img.size
        if w <= max_pixels and h <= max_pixels:
            return None  # 无需缩放

        ratio = max_pixels / max(w, h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)

        # 保存到同目录临时文件
        scaled_path = image_path.rsplit(".", 1)[0] + "_scaled.png"
        img.save(scaled_path, "PNG")
        return scaled_path
    except Exception:
        return None


def get_ocr() -> PaddleOCR:
    """获取PaddleOCR实例（单例，速度优化配置）"""
    global _ocr_instance
    if _ocr_instance is None:
        print(
            f"正在初始化 PaddleOCR "
            f"(PP-OCRv4, det_limit={OCR_DET_LIMIT}, "
            f"rec_batch={OCR_REC_BATCH}, "
            f"{OCR_WORKERS} workers × ~{_threads_per_worker} threads)..."
        )
        _ocr_instance = PaddleOCR(
            lang=OCR_LANG,
            ocr_version="PP-OCRv4",
            # 速度优化参数
            text_det_limit_side_len=OCR_DET_LIMIT,
            text_det_thresh=OCR_DET_THRESH,
            text_det_box_thresh=OCR_DET_BOX_THRESH,
            text_recognition_batch_size=OCR_REC_BATCH,
        )
        print("PaddleOCR 初始化完成！")
    return _ocr_instance


def ocr_image(image_path: str) -> list[dict]:
    """
    对单张图片执行OCR识别

    Args:
        image_path: 图片文件路径

    Returns:
        文字块列表 [{text, confidence, x, y, width, height, center_x, center_y}, ...]
    """
    # 大图预缩放
    scaled = _pre_scale_image(image_path)
    target = scaled or image_path

    # 扫描件增强：灰度 + CLAHE + 锐化，提升 OCR 准确度
    enhanced = enhance_for_ocr(target)
    if enhanced != target:
        target = enhanced

    try:
        ocr = get_ocr()
        with _ocr_lock:
            result = ocr.predict(target, use_doc_unwarping=True)

        if not result:
            return []

        data = result[0].json["res"]
        texts = data.get("rec_texts", [])
        scores = data.get("rec_scores", [])
        polys = data.get("dt_polys", [])

        text_blocks = []
        for i, (text, score, poly) in enumerate(zip(texts, scores, polys)):
            if not text or not text.strip():
                continue

            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]

            min_x = min(xs)
            min_y = min(ys)
            max_x = max(xs)
            max_y = max(ys)

            text_blocks.append({
                "text": text.strip(),
                "confidence": round(score, 3),
                "x": min_x,
                "y": min_y,
                "width": max_x - min_x,
                "height": max_y - min_y,
                "center_x": (min_x + max_x) / 2,
                "center_y": (min_y + max_y) / 2,
            })

        # 如果进行了预缩放，将坐标映射回原图尺寸
        if scaled:
            try:
                from PIL import Image
                orig_w, orig_h = Image.open(image_path).size
                sc_w, sc_h = Image.open(scaled).size
                scale_x = orig_w / sc_w
                scale_y = orig_h / sc_h
                for block in text_blocks:
                    block["x"] = round(block["x"] * scale_x, 1)
                    block["y"] = round(block["y"] * scale_y, 1)
                    block["width"] = round(block["width"] * scale_x, 1)
                    block["height"] = round(block["height"] * scale_y, 1)
                    block["center_x"] = round(block["center_x"] * scale_x, 1)
                    block["center_y"] = round(block["center_y"] * scale_y, 1)
            except Exception:
                pass  # 坐标还原失败不阻塞OCR流程

        return text_blocks
    finally:
        # 清理临时文件
        for tmp in [scaled, enhanced]:
            if tmp and tmp != image_path and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


def ocr_images_pipelined(page_generator) -> tuple[list[list[dict]], list[str]]:
    """
    流水线模式：边渲染边OCR，渲染和识别并行。

    Args:
        page_generator: yield (page_num, image_path) 的生成器

    Returns:
        (ocr_results, image_paths) — OCR结果和图片路径（均按页码顺序）
    """
    results = {}
    image_paths = {}
    with ThreadPoolExecutor(max_workers=OCR_WORKERS) as executor:
        pending = {}  # future → page_num
        gen_done = False
        gen = iter(page_generator)

        while not gen_done or pending:
            if not gen_done:
                try:
                    page_num, img_path = next(gen)
                    image_paths[page_num] = img_path
                    future = executor.submit(ocr_image, img_path)
                    pending[future] = page_num
                except StopIteration:
                    gen_done = True

            done = [f for f in pending if f.done()]
            for future in done:
                page_num = pending.pop(future)
                try:
                    results[page_num] = future.result()
                except Exception as e:
                    import traceback
                    print(f"OCR page {page_num + 1} failed: {e}")
                    traceback.print_exc()
                    results[page_num] = []

    sorted_pages = sorted(results.keys())
    return [results[i] for i in sorted_pages], [image_paths[i] for i in sorted_pages]


def ocr_images(image_paths: list[str]) -> list[list[dict]]:
    """
    对多张图片并行执行OCR识别

    Args:
        image_paths: 图片路径列表

    Returns:
        每页的OCR结果列表（保持页码顺序）
    """
    if not image_paths:
        return []

    if len(image_paths) == 1:
        return [ocr_image(image_paths[0])]

    # 多页并行
    workers = min(OCR_WORKERS, len(image_paths))
    results = [None] * len(image_paths)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(ocr_image, path): idx
            for idx, path in enumerate(image_paths)
        }
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                print(f"OCR page {idx + 1} failed: {e}")
                results[idx] = []

    return results

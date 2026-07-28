"""
PDF处理器 — 将PDF转换为图片
"""
import os
import fitz  # PyMuPDF
from config import CACHE_DIR, PDF_DPI


def pdf_to_images(pdf_path: str) -> list[str]:
    """
    将PDF文件每一页渲染为PNG图片（一次性返回全部）

    Args:
        pdf_path: PDF文件路径

    Returns:
        图片路径列表
    """
    return [path for _, path in _render_pages(pdf_path)]


def _render_pages(pdf_path: str):
    """
    逐页渲染PDF为PNG的生成器。
    每渲染完一页就 yield (page_num, image_path)，
    调用方可以边渲染边提交OCR，实现流水线并行。

    Yields:
        (page_num, image_path)
    """
    doc = fitz.open(pdf_path)
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    mat = fitz.Matrix(PDF_DPI / 72, PDF_DPI / 72)

    try:
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(matrix=mat)
            img_filename = f"{base_name}_page{page_num + 1}.png"
            img_path = os.path.join(CACHE_DIR, img_filename)
            pix.save(img_path)
            yield (page_num, img_path)
    finally:
        doc.close()

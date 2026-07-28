"""
图片预处理器 — 拍照图片 → 扫描件风格
自动纠偏 + CLAHE 增强 + 自适应二值化
"""
import os
import cv2
import numpy as np


def _deskew(gray: np.ndarray) -> np.ndarray:
    """
    检测文字行倾斜角度并旋转纠正。
    用霍夫线变换找所有近水平线段，取角度中位数旋转。
    """
    # 二值化 + 边缘检测
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    edges = cv2.Canny(binary, 50, 150, apertureSize=3)

    # 霍夫线检测
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=100)
    if lines is None:
        return gray  # 无足够直线，不旋转

    # 收集接近水平的线的角度（表格线通常是水平或接近水平的）
    angles = []
    for line in lines:
        rho, theta = line[0]
        angle = np.rad2deg(theta)
        # 只取接近水平的线 (0°~45° 或 135°~180°)
        if angle < 45:
            angles.append(angle)
        elif angle > 135:
            angles.append(angle - 180)

    if len(angles) < 3:
        return gray  # 样本太少，不旋转

    # 取中位数角度（抗噪声）
    median_angle = np.median(angles)
    if abs(median_angle) < 0.3:
        return gray  # 几乎不倾斜，跳过

    # 旋转
    h, w = gray.shape
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated = cv2.warpAffine(gray, M, (w, h),
                             borderMode=cv2.BORDER_CONSTANT,
                             borderValue=255)
    return rotated


def enhance_for_ocr(image_path: str) -> str:
    """
    对图片做 OCR 增强：纠偏 → CLAHE → 锐化。
    """
    enhanced_path = image_path.rsplit(".", 1)[0] + "_enhanced.png"

    try:
        img = cv2.imread(image_path)
        if img is None:
            return image_path

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # 1. 自动纠偏
        gray = _deskew(gray)

        # 2. CLAHE 局部对比度增强
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # 3. 轻微锐化
        kernel = np.array([[-0.5, -0.5, -0.5],
                           [-0.5,  5.0, -0.5],
                           [-0.5, -0.5, -0.5]])
        sharpened = cv2.filter2D(enhanced, -1, kernel)
        sharpened = np.clip(sharpened, 0, 255).astype(np.uint8)

        cv2.imwrite(enhanced_path, sharpened)
        return enhanced_path

    except Exception:
        return image_path


def binarize_for_preview(image_path: str) -> str:
    """
    生成纯黑白扫描件预览图：纠偏 → 自适应二值化。
    """
    preview_path = image_path.rsplit(".", 1)[0] + "_scan.png"

    try:
        img = cv2.imread(image_path)
        if img is None:
            return image_path

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = _deskew(gray)

        binary = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            blockSize=21,
            C=10
        )

        cv2.imwrite(preview_path, binary)
        return preview_path

    except Exception:
        return image_path


def enhance_for_preview(image_path: str) -> str:
    """
    生成扫描件风格预览图：自动色阶 → 提亮 → 锐化
    效果类似扫描仪输出：亮白背景 + 深色清晰文字，保留灰度层次。

    用 PIL 读取以兼容中文路径。
    """
    try:
        from PIL import Image, ImageFilter, ImageEnhance

        img = Image.open(image_path).convert("L")
        arr = np.array(img, dtype=float)

        # 1. 自动色阶：裁掉 1%/99% 两端，拉伸到全范围
        low = np.percentile(arr, 1)
        high = np.percentile(arr, 99)
        if high - low < 15:
            high = low + 50
        arr = np.clip((arr - low) / (high - low) * 255, 0, 255).astype(np.uint8)

        # 2. 亮度 + 对比度微调
        arr = ImageEnhance.Brightness(Image.fromarray(arr)).enhance(1.1)
        arr = ImageEnhance.Contrast(arr).enhance(1.2)

        # 3. 锐化
        arr = arr.filter(ImageFilter.UnsharpMask(radius=1.5, percent=100, threshold=3))

        preview_path = image_path.rsplit(".", 1)[0] + "_scanPreview.png"
        arr.save(preview_path)
        return preview_path

    except Exception:
        return binarize_for_preview(image_path)

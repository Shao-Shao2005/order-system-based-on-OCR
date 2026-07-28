"""
Flask REST API — 送货单OCR识别与Excel导出系统（后端）
纯API服务，通过CORS支持前端跨域访问
"""
import os
import uuid
import json
import hashlib
from datetime import datetime

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from config import (
    UPLOAD_DIR, CACHE_DIR, OUTPUT_DIR,
    ALLOWED_EXTENSIONS, MAX_FILE_SIZE
)
from pdf_processor import _render_pages
from ocr_engine import ocr_image, ocr_images_pipelined
from table_parser import parse_table
from excel_exporter import export_excel_multi_sheet, export_excel
from image_preprocessor import binarize_for_preview, enhance_for_ocr, enhance_for_preview

app = Flask(__name__)
CORS(app)  # 允许所有来源跨域
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE

# 简易任务存储（单用户，内存字典）
tasks = {}

# OCR结果缓存（文件MD5 → 结果）
_cache = {}


def allowed_file(filename: str) -> bool:
    """检查文件扩展名是否合法"""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_extension(filename: str) -> str:
    """获取小写扩展名"""
    return filename.rsplit(".", 1)[1].lower() if "." in filename else ""


# ============================================================
# API 路由
# ============================================================

@app.route("/api/preprocess", methods=["POST"])
def api_preprocess():
    """
    上传图片后立即预处理：灰度 + CLAHE + 锐化，返回增强后的图片。
    前端在导入文件时调用，让用户立刻看到扫描件效果。
    """
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "请选择文件"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": f"不支持的文件格式"}), 400

    ext = get_file_extension(file.filename)
    task_id = uuid.uuid4().hex[:12]
    saved_path = os.path.join(UPLOAD_DIR, f"{task_id}.{ext}")
    file.save(saved_path)

    # 图片增强 → 扫描件预览用二值化（纯黑白），OCR 用 CLAHE 增强（ocr_image 中处理）
    scan_path = binarize_for_preview(saved_path)
    return send_file(scan_path, mimetype="image/png")


@app.route("/api/import-pdf", methods=["POST"])
def api_import_pdf():
    """
    导入PDF文件：渲染所有页面为图片，返回页面列表（不执行OCR）。
    前端拿到页面列表后在项目卡片中展示，用户可手动选择单个页面进行OCR。
    """
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "请选择文件"}), 400

    ext = get_file_extension(file.filename)
    if ext != "pdf":
        return jsonify({"error": "仅支持PDF文件，图片文件请直接上传"}), 400

    # 保存PDF
    task_id = uuid.uuid4().hex[:12]
    saved_filename = f"{task_id}.pdf"
    saved_path = os.path.join(UPLOAD_DIR, saved_filename)
    file.save(saved_path)

    try:
        # 渲染所有页面为PNG（不使用流水线OCR，只渲染）
        image_paths = []
        for page_num, img_path in _render_pages(saved_path, prefix=task_id):
            image_paths.append(img_path)

        if not image_paths:
            return jsonify({"error": "PDF渲染失败，请检查文件是否有效"}), 400

        # 存储任务数据（不含OCR结果）
        tasks[task_id] = {
            "image_paths": image_paths,
            "page_count": len(image_paths),
            "original_filename": file.filename,
            "pdf_path": saved_path,
            "page_ocr": {},          # page_index → OCR结果，后续按需填充
            "created_at": datetime.now().isoformat(),
        }

        pages = [
            {
                "page_index": i,
                "image_url": f"/api/image/{task_id}/{i}",
                "scan_url": f"/api/scan/{task_id}/{i}",
            }
            for i in range(len(image_paths))
        ]

        return jsonify({
            "task_id": task_id,
            "filename": file.filename,
            "page_count": len(image_paths),
            "pages": pages,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"PDF导入失败: {str(e)}"}), 500


@app.route("/api/ocr-page", methods=["POST"])
def api_ocr_page():
    """
    对已导入PDF的单个页面执行OCR识别和表格解析。
    请求体: {task_id, page_index}
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "请提供JSON数据"}), 400

    task_id = data.get("task_id", "")
    page_index = data.get("page_index", 0)

    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在或已过期，请重新导入PDF"}), 404

    image_paths = task["image_paths"]
    if page_index < 0 or page_index >= len(image_paths):
        return jsonify({"error": f"页码无效，有效范围: 0~{len(image_paths) - 1}"}), 400

    image_path = image_paths[page_index]

    # 检查是否已有缓存的OCR结果
    if page_index in task.get("page_ocr", {}):
        cached = task["page_ocr"][page_index]
        return jsonify(cached)

    try:
        # 单页OCR
        blocks = ocr_image(image_path)
        if not blocks:
            return jsonify({
                "error": f"第{page_index + 1}页未识别到文字",
                "page_index": page_index,
            }), 400

        # 表格解析
        result = parse_table(blocks, filename=task.get("original_filename", ""))

        # 如果日期分组为空，尝试用头部日期
        date_groups = result.get("date_groups", {})
        dates = result.get("dates", [])
        header_info = result.get("header_info", {})
        rows = result.get("rows", [])

        if not date_groups and rows:
            header_date = header_info.get("date", "").strip() if header_info else ""
            if header_date:
                date_groups = {header_date: rows}
                dates = [header_date]
            else:
                date_groups = {"全部": rows}
                dates = ["全部"]

        response_data = {
            "task_id": task_id,
            "page_index": page_index,
            "rows": rows,
            "date_groups": date_groups,
            "dates": dates,
            "header_info": header_info,
            "warnings": result.get("warnings", []),
            "preview_images": [f"/api/image/{task_id}/{page_index}"],
        }

        # 缓存结果
        task.setdefault("page_ocr", {})[page_index] = response_data

        return jsonify(response_data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"OCR处理失败: {str(e)}"}), 500


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """
    上传文件，执行OCR识别和表格解析
    返回JSON: {task_id, rows, date_groups, dates, ...}
    """
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "请选择文件"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": f"不支持的文件格式，允许: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    # 保存上传文件
    ext = get_file_extension(file.filename)
    task_id = uuid.uuid4().hex[:12]
    saved_filename = f"{task_id}.{ext}"
    saved_path = os.path.join(UPLOAD_DIR, saved_filename)
    file.save(saved_path)

    # 文件级缓存：相同文件直接返回
    file_hash = hashlib.md5(open(saved_path, "rb").read()).hexdigest()
    if file_hash in _cache:
        cached = _cache[file_hash]
        cached["task_id"] = task_id
        tasks[task_id] = cached.get("task_data", {})
        return jsonify(cached["response"])

    try:
        # 处理流程
        if ext == "pdf":
            # 流水线：边渲染PDF页面边提交OCR（渲染与识别并行）
            all_blocks, image_paths = ocr_images_pipelined(_render_pages(saved_path))
            if not all_blocks:
                return jsonify({"error": "PDF转换失败，请检查文件是否有效"}), 400
        else:
            image_paths = [saved_path]
            blocks = ocr_image(saved_path)
            all_blocks = [blocks]

        # 合并多页结果
        all_rows = []
        all_date_groups = {}
        all_dates = []
        all_raw = []
        all_header_info = {}
        warnings = []
        preview_images = []

        for page_idx, blocks in enumerate(all_blocks):
            if not blocks:
                warnings.append(f"第{page_idx + 1}页未识别到文字")
                continue

            result = parse_table(blocks, filename=file.filename)

            # 取第一页的头部信息
            if not all_header_info and result.get("header_info"):
                all_header_info = result["header_info"]

            if result.get("date_groups"):
                for date_str, date_rows in result["date_groups"].items():
                    if date_str not in all_date_groups:
                        all_date_groups[date_str] = []
                    # 标记每行来源页
                    for row in date_rows:
                        row["_page"] = page_idx
                    all_date_groups[date_str].extend(date_rows)

            page_rows = result.get("rows", [])
            # 标记每行来源页
            for row in page_rows:
                row["_page"] = page_idx
            all_rows.extend(page_rows)
            all_raw.append(result.get("raw_rows", []))
            preview_images.append(f"/api/image/{task_id}/{page_idx}")

            if result.get("dates"):
                for d in result["dates"]:
                    if d not in all_dates:
                        all_dates.append(d)

        if not all_rows:
            return jsonify({
                "error": "未能识别到表格数据，请检查图片清晰度"
            }), 400

        # 存储任务数据
        tasks[task_id] = {
            "image_paths": image_paths,
            "all_rows": all_rows,
            "date_groups": all_date_groups,
            "dates": all_dates,
            "all_raw": all_raw,
            "header_info": all_header_info,
            "warnings": warnings,
            "original_filename": file.filename,
            "created_at": datetime.now().isoformat(),
        }

        response_data = {
            "task_id": task_id,
            "rows": all_rows,
            "date_groups": all_date_groups,
            "dates": all_dates,
            "header_info": all_header_info,
            "warnings": warnings,
            "preview_images": preview_images,
            "page_count": len(preview_images),
        }
        # 缓存结果
        _cache[file_hash] = {
            "response": response_data,
            "task_data": tasks.get(task_id, {}),
        }
        return jsonify(response_data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"处理失败: {str(e)}"}), 500


@app.route("/api/image/<task_id>/<int:page_idx>")
def api_image(task_id: str, page_idx: int):
    """提供OCR处理的图片用于前端预览"""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在或已过期"}), 404

    image_paths = task["image_paths"]
    if page_idx < 0 or page_idx >= len(image_paths):
        return jsonify({"error": "页码无效"}), 404

    return send_file(image_paths[page_idx], mimetype="image/png")


@app.route("/api/scan/<task_id>/<int:page_idx>")
def api_scan(task_id: str, page_idx: int):
    """提供扫描件风格预览（二值化黑白图片）"""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在或已过期"}), 404

    image_paths = task["image_paths"]
    if page_idx < 0 or page_idx >= len(image_paths):
        return jsonify({"error": "页码无效"}), 404

    scan_path = binarize_for_preview(image_paths[page_idx])
    return send_file(scan_path, mimetype="image/png")


@app.route("/api/task/<task_id>")
def api_get_task(task_id: str):
    """获取任务数据"""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在或已过期"}), 404

    return jsonify({
        "rows": task["all_rows"],
        "date_groups": task.get("date_groups", {}),
        "dates": task.get("dates", []),
        "header_info": task.get("header_info", {}),
        "preview_images": [
            f"/api/image/{task_id}/{i}"
            for i in range(len(task["image_paths"]))
        ],
        "warnings": task.get("warnings", []),
        "filename": task["original_filename"],
    })


@app.route("/api/export", methods=["POST"])
def api_export():
    """
    接收前端修正后的数据，导出Excel文件
    请求体: {task_id, date_groups: {日期: [rows]}, rows: [...]}
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "请提供数据"}), 400

    task_id = data.get("task_id", "")
    date_groups = data.get("date_groups", {})
    rows = data.get("rows", [])
    header_info = data.get("header_info", {})

    if not rows and not date_groups:
        return jsonify({"error": "数据为空，无法导出"}), 400

    # 生成文件名
    task = tasks.get(task_id)
    if task:
        base_name = os.path.splitext(task["original_filename"])[0]
    else:
        base_name = "送货单"

    excel_filename = f"{base_name}_导出_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    # 如果有日期分组且多于1个日期，使用多Sheet导出
    if date_groups and len(date_groups) >= 1:
        filepath = export_excel_multi_sheet(date_groups, excel_filename, header_info=header_info)
    else:
        filepath = export_excel(rows, excel_filename, header_info=header_info)

    return send_file(
        filepath,
        as_attachment=True,
        download_name=excel_filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.route("/api/task/<task_id>", methods=["DELETE"])
def api_delete_task(task_id: str):
    """清理任务数据"""
    task = tasks.pop(task_id, None)
    if task:
        for path in task.get("image_paths", []):
            try:
                os.remove(path)
            except OSError:
                pass
        # 清理保存的PDF文件
        pdf_path = task.get("pdf_path", "")
        if pdf_path and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except OSError:
                pass
    return jsonify({"ok": True})


@app.route("/api/enhance", methods=["POST"])
def api_enhance():
    """上传图片 → 灰度增强（纠偏 + CLAHE对比度增强 + 锐化），返回增强后的PNG"""
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "请选择文件"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "不支持的文件格式"}), 400

    ext = get_file_extension(file.filename)
    task_id = uuid.uuid4().hex[:12]
    saved_path = os.path.join(UPLOAD_DIR, f"{task_id}.{ext}")
    file.save(saved_path)

    enhanced_path = enhance_for_preview(saved_path)
    return send_file(enhanced_path, mimetype="image/png")


@app.route("/api/cache", methods=["DELETE"])
def api_clear_cache():
    """清除所有缓存：内存缓存 + 磁盘缓存目录 + 上传目录 + 任务数据"""
    # 清空内存缓存
    _cache.clear()
    tasks.clear()

    # 清空磁盘缓存目录
    cleared_dirs = []
    for _dir in [CACHE_DIR, UPLOAD_DIR]:
        count = 0
        if os.path.exists(_dir):
            for filename in os.listdir(_dir):
                filepath = os.path.join(_dir, filename)
                try:
                    if os.path.isfile(filepath):
                        os.remove(filepath)
                        count += 1
                except OSError:
                    pass
        cleared_dirs.append({"dir": _dir, "cleared": count})

    return jsonify({
        "ok": True,
        "message": "缓存已清除",
        "cleared": cleared_dirs,
    })


@app.route("/api/health")
def api_health():
    """健康检查"""
    return jsonify({"status": "ok", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    print("=" * 50)
    print("送货单OCR识别系统 - API服务启动中...")
    print(f"上传目录: {UPLOAD_DIR}")
    print(f"输出目录: {OUTPUT_DIR}")
    print("API 地址: http://localhost:5000/api/")
    print("=" * 50)
    import sys
    debug_mode = "--debug" in sys.argv
    app.run(debug=debug_mode, host="0.0.0.0", port=5000)

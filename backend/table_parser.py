"""
表格解析器 — 间隙聚类分行 + X坐标分列 + 内容特征校验
"""
import re
from itertools import groupby
from config import (
    Y_TOLERANCE, X_TOLERANCE,
    EXCEL_HEADERS, ALWAYS_EMPTY_HEADERS,
    FIELD_PATTERNS, DATE_PATTERNS, DATE_RANGE_PATTERN,
    HEADER_KEYWORDS,
)


# ============================================================
# Y 轴：间隙聚类分行
# ============================================================

def _group_into_rows(text_blocks: list[dict]) -> list[list[dict]]:
    """
    基于 Y 坐标间隙聚类分行。
    自动发现数据中的自然行间距，不依赖固定阈值。

    原理：
      同行内的块 Y 浮动小（2-5px），不同行之间间距大（20-30px）。
      用所有 Y 值的间隙分布自动找到"大间隙"作为行边界。
    """
    if not text_blocks:
        return []

    # 收集所有唯一的 center_y，排序
    y_values = sorted(set(b["center_y"] for b in text_blocks))

    if len(y_values) <= 1:
        return [sorted(text_blocks, key=lambda b: b["x"])]

    # 计算相邻 Y 之间的间隙
    gaps = [y_values[i + 1] - y_values[i] for i in range(len(y_values) - 1)]

    # 中位数间隙（代表行内浮动），行间间隙远大于此
    sorted_gaps = sorted(gaps)
    median_gap = sorted_gaps[len(sorted_gaps) // 2]

    # 阈值：中位数的 2 倍，且不低于 Y_TOLERANCE
    threshold = max(median_gap * 2.0, Y_TOLERANCE)

    # 按阈值将 Y 值聚类
    clusters = []
    current_cluster = [y_values[0]]

    for i, y in enumerate(y_values[1:], 1):
        if gaps[i - 1] > threshold:
            clusters.append(current_cluster)
            current_cluster = [y]
        else:
            current_cluster.append(y)
    clusters.append(current_cluster)

    # 将每个块分配到最近的 Y 聚类
    rows = []
    for cluster in clusters:
        cluster_center = sum(cluster) / len(cluster)
        row_blocks = [
            b for b in text_blocks
            if abs(b["center_y"] - cluster_center) <= threshold
        ]
        if row_blocks:
            rows.append(sorted(row_blocks, key=lambda b: b["x"]))

    return rows


def _clean_number(text: str) -> str:
    """从文本中提取纯数字，丢弃所有非数字字符（保留小数点）。
    如: 15v → 15, 20√ → 20, 100元 → 100, 15.5kg → 15.5, 约200 → 200
    """
    text = text.strip()
    if not text:
        return ""
    m = re.search(r"(\d+\.?\d*)", text)
    return m.group(1) if m else text


# ============================================================
# 单据头部信息提取
# ============================================================

def _extract_header_info(text_blocks: list[dict]) -> dict:
    """
    从OCR文字块中提取单据头部信息：公司名称、收货单位、送货日期

    公司名称识别策略：
      1. 关键词前缀匹配（送货单位/供货单位等）
      2. 兜底：顶部居中区域的大字块（面积 × 居中权重）

    Returns:
        {"company": "", "consignee": "铁科嘉苑饭店", "date": ""}
    """
    result = {"company": "", "consignee": "铁科嘉苑饭店", "date": ""}

    if not text_blocks:
        return result

    # 计算页面水平中心（用于判断文字是否居中）
    all_x_centers = [b["center_x"] for b in text_blocks]
    page_center_x = sum(all_x_centers) / len(all_x_centers) if all_x_centers else 0
    page_width = max(b["x"] + b["width"] for b in text_blocks) if text_blocks else 1

    top_blocks = sorted(text_blocks, key=lambda b: b["center_y"])[:15]

    # 公司名称关键词（更全面）
    _company_keywords = [
        "公司", "有限", "集团", "中心", "商行", "商行", "经营部",
        "配送", "批发", "贸易", "实业", "食品"
    ]
    # 已知的 "XXX单位" 模式
    _unit_patterns = [
        r"(?:送货单位|供货单位|发货单位|配送单位|供应单位|供应商)[：:]\s*(.+)",
        r"(?:单位名称|公司名称|企业名称)[：:]\s*(.+)",
    ]

    for block in text_blocks:
        text = block["text"].strip()

        # 1. 明确的 "XXX单位：名称" 模式
        for pat in _unit_patterns:
            m = re.search(pat, text)
            if m:
                result["company"] = m.group(1).strip()
                break

        # 2. 收货单位
        m = re.search(r"(?:收货单位|收货方|收货人|收货)[：:]\s*(.+)", text)
        if m:
            result["consignee"] = m.group(1).strip()

        # 3. 日期
        m = re.search(r"(\d{1,2})月(\d{1,2})日", text)
        if m and not result["date"]:
            result["date"] = f"{int(m.group(1))}月{int(m.group(2))}日"
            continue
        m = re.search(r"(\d{1,2})\.(\d{1,2})(?!\d)", text)
        if m and not result["date"]:
            result["date"] = f"{int(m.group(1))}月{int(m.group(2))}日"

    # 4. 兜底：顶部居中大字
    if not result["company"]:
        candidates = []
        for block in top_blocks:
            text = block["text"].strip()

            # 排除规则
            is_header = any(
                any(kw in text for kw in kws)
                for kws in HEADER_KEYWORDS.values()
            )
            if is_header:
                continue
            if re.match(r"^[\d\.\-\s]+$", text):
                continue
            if re.match(r"^\d{1,2}月\d{1,2}日$", text):
                continue
            if len(text) < 2:
                continue
            if re.search(r"\d+\.\d+\s*[-~～到至]\s*\d+\.\d+", text):
                continue

            # 评分：面积 × 居中权重 × 含公司关键词加分
            area = block.get("width", 0) * block.get("height", 0)
            dist_from_center = abs(block["center_x"] - page_center_x)
            # 居中权重：越靠近水平中心分越高 (0~1)
            center_score = max(0, 1.0 - dist_from_center / (page_width * 0.4))
            # 公司关键词加分
            keyword_bonus = 2.0 if any(kw in text for kw in _company_keywords) else 1.0

            score = area * center_score * keyword_bonus
            candidates.append((score, text, area))

        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            result["company"] = candidates[0][1]

    return result


# ============================================================
# X 轴：从表头行学习列位置
# ============================================================

def _learn_column_positions(header_blocks: list[dict]) -> dict[str, float]:
    """
    从表头行的文字块中，学习每列的 X 中心位置。

    表头行的每个文字块对应一列，按 X 排序后与 HEADER_KEYWORDS
    做关键词匹配，得到 {字段名: X中心坐标} 映射。

    Returns:
        { "序号": 55.0, "名称": 160.0, ... }
    """
    if not header_blocks:
        return {}

    # 按 X 排序表头块
    sorted_blocks = sorted(header_blocks, key=lambda b: b["x"])

    col_positions = {}
    used_fields = set()

    for block in sorted_blocks:
        text = block["text"].strip().replace(" ", "")
        # 收集该块匹配的所有字段（处理表头块合并的情况，如"单位购定价"）
        matched_fields = []
        for field, keywords in HEADER_KEYWORDS.items():
            if field in used_fields:
                continue
            for kw in keywords:
                if kw in text:
                    matched_fields.append(field)
                    used_fields.add(field)
                    break

        if len(matched_fields) == 1:
            col_positions[matched_fields[0]] = block["center_x"]
        elif len(matched_fields) > 1:
            # 表头文字被合并到一个块中，按比例拆分 X 位置
            bw = block["x"]
            bw_width = block["width"]
            for i, field in enumerate(matched_fields):
                frac = (i + 0.5) / len(matched_fields)
                col_positions[field] = bw + bw_width * frac

    # 缺失列位置推断：根据已知列间距动态推算
    _col_order = [
        "序号", "名称", "单位", "购定价（含税）",
        "税率", "网上询价", "数量", "合计", "备注"
    ]
    # 计算已知相邻列的平均间距
    known_gaps = []
    for i in range(1, len(_col_order)):
        prev, cur = _col_order[i-1], _col_order[i]
        if prev in col_positions and cur in col_positions:
            known_gaps.append(col_positions[cur] - col_positions[prev])
    avg_gap = sum(known_gaps) / len(known_gaps) if known_gaps else 60

    for i, field in enumerate(_col_order):
        if field in col_positions:
            continue
        left_x = right_x = left_steps = right_steps = None
        for j in range(i - 1, -1, -1):
            if _col_order[j] in col_positions:
                left_x = col_positions[_col_order[j]]
                left_steps = i - j
                break
        for j in range(i + 1, len(_col_order)):
            if _col_order[j] in col_positions:
                right_x = col_positions[_col_order[j]]
                right_steps = j - i
                break
        if left_x is not None and right_x is not None:
            col_positions[field] = left_x + (right_x - left_x) * left_steps / (left_steps + right_steps)
        elif left_x is not None:
            col_positions[field] = left_x + avg_gap * left_steps
        elif right_x is not None:
            col_positions[field] = right_x - avg_gap * right_steps

    return col_positions


def _assign_blocks_to_columns(
    row_blocks: list[dict],
    col_positions: dict[str, float]
) -> dict[str, str]:
    """
    将一行的文字块按 X 坐标分配到各列。

    对每个块，找最近的列 X 中心，如果在容差范围内则归入该列。
    没有列位置信息时，按 X 从左到右依次分配。

    Returns:
        { "序号": "1", "名称": "三黄鸡", ... }
    """
    # result 格式: {"名称": {"value": "三黄鸡", "confidence": 0.95}, ...}
    result = {header: {"value": "", "confidence": 1.0, "x": None, "y": None, "width": None, "height": None} for header in EXCEL_HEADERS}

    if not row_blocks:
        return result

    if not col_positions:
        return _extract_row_by_content_fallback(row_blocks)

    # 对每个块，按 X 位置分配 + 记录置信度
    for block in row_blocks:
        bx = block["center_x"]
        text = block["text"].strip().replace(" ", "")
        conf = block.get("confidence", 1.0)
        if not text:
            continue

        # 找 X 最近的列
        best_field = None
        best_dist = float("inf")
        for field, cx in col_positions.items():
            dist = abs(bx - cx)
            if dist < best_dist:
                best_dist = dist
                best_field = field

        if best_field and best_dist < 150:
            # 小数数字误入"单位"列 → 纠正到"购定价（含税）"
            if best_field == "单位" and re.match(r"^\d+\.\d+$", text):
                price_cell = result.get("购定价（含税）")
                if price_cell and not price_cell["value"]:
                    best_field = "购定价（含税）"

            cell = result.get(best_field)
            if cell and not cell["value"]:
                if best_field in ("数量", "合计", "备注"):
                    text = _clean_number(text)
                    # 备注列：只有含数字的手写内容才填入，否则留空
                    if best_field == "备注" and not text:
                        continue
                cell["value"] = text
                cell["confidence"] = conf
                cell["x"] = block.get("x")
                cell["y"] = block.get("y")
                cell["width"] = block.get("width")
                cell["height"] = block.get("height")

    # 未填充的列，用内容特征补充
    for block in row_blocks:
        text = block["text"].strip().replace(" ", "")
        conf = block.get("confidence", 1.0)
        if not text:
            continue

        already_assigned = any(
            cell["value"] == text for cell in result.values()
        )
        if already_assigned:
            continue

        field = _classify_cell(text)
        if field:
            cell = result.get(field)
            if cell and not cell["value"]:
                # 数量/合计列只保留纯数字
                if field in ("数量", "合计", "备注"):
                    text = _clean_number(text)
                    # 备注列：只有含数字的手写内容才填入，否则留空
                    if field == "备注" and not text:
                        continue
                cell["value"] = text
                cell["confidence"] = conf
                cell["x"] = block.get("x")
                cell["y"] = block.get("y")
                cell["width"] = block.get("width")
                cell["height"] = block.get("height")

    return result


# ============================================================
# 内容特征分类（作为 X 坐标的补充/兜底）
# ============================================================

def _classify_cell(text: str) -> str | None:
    """根据内容特征判断字段类型"""
    text = text.strip()
    if not text:
        return None

    best_field = None
    best_priority = -1

    for field, config in FIELD_PATTERNS.items():
        if field in ALWAYS_EMPTY_HEADERS:
            continue
        pattern = config["pattern"]
        priority = config["priority"]
        blacklist = config.get("blacklist", [])

        if any(kw in text for kw in blacklist):
            continue
        if re.fullmatch(pattern, text):
            if priority > best_priority:
                best_priority = priority
                best_field = field

    return best_field


def _extract_row_by_content_fallback(row_blocks: list[dict]) -> dict:
    """纯内容特征兜底（没有列位置信息时使用）"""
    result = {header: {"value": "", "confidence": 1.0, "x": None, "y": None, "width": None, "height": None} for header in EXCEL_HEADERS}
    texts = [b["text"] for b in row_blocks]

    numbers = []
    for idx, block in enumerate(row_blocks):
        text = block["text"].strip().replace(" ", "")
        conf = block.get("confidence", 1.0)
        if not text:
            continue
        field = _classify_cell(text)
        if field in ("数量", "合计"):
            numbers.append((idx, _clean_number(text), conf))
        elif field:
            # 备注等字段也需清理数字，但只有含数字才填入
            if field in ("数量", "合计", "备注"):
                text = _clean_number(text)
                if field == "备注" and not text:
                    continue
            if not result[field]["value"]:
                result[field] = {"value": text, "confidence": conf, "x": block.get("x"), "y": block.get("y"), "width": block.get("width"), "height": block.get("height")}

    # 数字区分
    def _blk(idx):
        b = row_blocks[idx]
        return {"x": b.get("x"), "y": b.get("y"), "width": b.get("width"), "height": b.get("height")}

    if len(numbers) == 1:
        result["合计"] = {"value": numbers[0][1], "confidence": numbers[0][2], **_blk(numbers[0][0])}
    elif len(numbers) >= 2:
        try:
            nums_sorted = sorted(numbers, key=lambda x: float(x[1]) if x[1].replace(".", "").isdigit() else 0)
            result["数量"] = {"value": nums_sorted[0][1], "confidence": nums_sorted[0][2], **_blk(nums_sorted[0][0])}
            result["合计"] = {"value": nums_sorted[-1][1], "confidence": nums_sorted[-1][2], **_blk(nums_sorted[-1][0])}
        except ValueError:
            pass

    # 数量/备注规则
    remark_cell = result.get("备注", {})
    remark_text = remark_cell.get("value", "") if isinstance(remark_cell, dict) else str(remark_cell)
    num_match = re.search(r"(\d+\.?\d*)", remark_text) if remark_text else None
    if num_match:
        result["数量"] = {"value": num_match.group(1), "confidence": remark_cell.get("confidence", 1.0), "x": remark_cell.get("x"), "y": remark_cell.get("y"), "width": remark_cell.get("width"), "height": remark_cell.get("height")}

    return result


# ============================================================
# 辅助判断函数
# ============================================================

def _is_header_row(row_texts: list[str]) -> bool:
    """判断是否为表头行"""
    combined = "".join(row_texts)
    match_count = sum(
        1 for keywords in HEADER_KEYWORDS.values()
        if any(kw in combined for kw in keywords)
    )
    return match_count >= 2


def _is_data_row(row_texts: list[str]) -> bool:
    """判断是否为数据行"""
    combined = "".join(row_texts)
    if not combined.strip():
        return False
    if _is_header_row(row_texts):
        return False
    if re.search(r"(合计|总计|总金额|小计|本页合计|送货单|送货|收货单)", combined):
        return False
    return True


def _detect_date(text: str) -> str | None:
    """检测日期，返回 "M月D日" """
    for pattern, formatter in DATE_PATTERNS:
        match = re.search(pattern, text)
        if match:
            return formatter(match)
    return None


def _extract_date_range_from_text(text: str) -> list[str] | None:
    """提取日期范围，如 "7.1-7.16" → ["7月1日", ..., "7月16日"]"""
    match = re.search(DATE_RANGE_PATTERN, text)
    if not match:
        return None

    start_month, start_day = int(match.group(1)), int(match.group(2))
    end_month, end_day = int(match.group(3)), int(match.group(4))

    from datetime import date, timedelta
    try:
        start = date(2024, start_month, start_day)
        end = date(2024, end_month, end_day)
    except ValueError:
        return None

    if end < start:
        return None

    dates = []
    current = start
    while current <= end:
        dates.append(f"{current.month}月{current.day}日")
        current += timedelta(days=1)
    return dates


def _is_date_separator_row(row_texts: list[str]) -> str | None:
    """判断是否为日期分隔行"""
    combined = "".join(row_texts).strip()
    if not combined or len(combined) > 10:
        return None
    return _detect_date(combined)


# ============================================================
# 主解析函数
# ============================================================

def parse_table(text_blocks: list[dict], filename: str = "") -> dict:
    """
    解析表格：间隙聚类分行 → X坐标定位分列 → 内容校验

    Returns:
        { date_groups, rows, dates, raw_rows, header_col_map }
    """
    # === 1. 间隙聚类分行 ===
    rows = _group_into_rows(text_blocks)

    # 提取每行文字
    row_texts = [[b["text"] for b in row] for row in rows]

    # === 2. 找表头行 + 学习列 X 位置 ===
    header_col_map = {}
    col_positions = {}

    for idx, blocks in enumerate(rows):
        texts = row_texts[idx]
        if _is_header_row(texts):
            header_col_map = _match_header(texts)
            col_positions = _learn_column_positions(blocks)
            break

    # === 3. 日期处理 ===
    all_text = "".join(["".join(texts) for texts in row_texts])
    date_range = _extract_date_range_from_text(all_text)
    if not date_range and filename:
        date_range = _extract_date_range_from_text(filename)

    date_separators = {}
    for idx, texts in enumerate(row_texts):
        date = _is_date_separator_row(texts)
        if date:
            date_separators[idx] = date

    # === 4. 逐行解析 ===
    data_rows = []
    current_date = None

    for idx, blocks in enumerate(rows):
        texts = row_texts[idx]

        # 日期分隔行
        if idx in date_separators:
            current_date = date_separators[idx]
            continue

        # 跳过非数据行
        if not _is_data_row(texts):
            continue

        # X坐标定位分列 (返回 {value, confidence} 格式)
        row_data = _assign_blocks_to_columns(blocks, col_positions)

        # 辅助: 获取字段值
        def _v(field):
            cell = row_data.get(field, {})
            return cell.get("value", "") if isinstance(cell, dict) else str(cell or "")

        # 仅当 名称+数量+合计 全空才跳过（放宽门控）
        if not _v("名称") and not _v("数量") and not _v("合计"):
            continue

        # === 数量/备注规则 ===
        remark_val = _v("备注")
        remark_num = re.search(r"(\d+\.?\d*)", remark_val) if remark_val else None
        if remark_num:
            remark_conf = row_data.get("备注", {}).get("confidence", 1.0) if isinstance(row_data.get("备注"), dict) else 1.0
            row_data["数量"] = {"value": remark_num.group(1), "confidence": remark_conf, "x": row_data.get("备注", {}).get("x"), "y": row_data.get("备注", {}).get("y"), "width": row_data.get("备注", {}).get("width"), "height": row_data.get("备注", {}).get("height")}

        # === 数字字段后处理 ===
        # 如果X坐标分列没分出数量/合计，用数字后处理补充
        if not _v("数量") and not _v("合计"):
            numbers_in_row = []
            for block in blocks:
                text = block["text"].strip().replace(" ", "")
                text = _clean_number(text)
                conf = block.get("confidence", 1.0)
                if re.fullmatch(r"^\d+\.?\d*$", text):
                    numbers_in_row.append((block, text, conf))

            if len(numbers_in_row) == 1:
                blk = numbers_in_row[0][0]
                row_data["合计"] = {"value": numbers_in_row[0][1], "confidence": numbers_in_row[0][2], "x": blk.get("x"), "y": blk.get("y"), "width": blk.get("width"), "height": blk.get("height")}
            elif len(numbers_in_row) >= 2:
                nums_sorted = sorted(numbers_in_row, key=lambda x: float(x[1]) if x[1].replace(".", "").isdigit() else 0)
                blk0 = nums_sorted[0][0]
                blk1 = nums_sorted[-1][0]
                row_data["数量"] = {"value": nums_sorted[0][1], "confidence": nums_sorted[0][2], "x": blk0.get("x"), "y": blk0.get("y"), "width": blk0.get("width"), "height": blk0.get("height")}
                row_data["合计"] = {"value": nums_sorted[-1][1], "confidence": nums_sorted[-1][2], "x": blk1.get("x"), "y": blk1.get("y"), "width": blk1.get("width"), "height": blk1.get("height")}

        # 行内日期检测
        for text in texts:
            d = _detect_date(text)
            if d:
                current_date = d
                break

        # 序号暂不填（后面统一编号）
        data_rows.append({
            **row_data,
            "_date": current_date,
        })

    # === 5. 按日期分组 ===
    date_groups = {}
    unassigned = []

    for row in data_rows:
        d = row.pop("_date", None)
        if d:
            date_groups.setdefault(d, []).append(row)
        else:
            unassigned.append(row)

    # 无日期但有日期范围 → 均匀分配
    if not date_groups and date_range and unassigned:
        per_date = max(1, len(unassigned) // len(date_range))
        for i, date_str in enumerate(date_range):
            start_idx = i * per_date
            batch = unassigned[start_idx:] if i == len(date_range) - 1 else unassigned[start_idx:start_idx + per_date]
            if batch:
                date_groups[date_str] = batch
        unassigned = []

    if not date_groups and unassigned:
        # 尝试用表头日期作为默认日期
        header_info = _extract_header_info(text_blocks)
        header_date = header_info.get("date", "").strip() if header_info else ""
        if header_date:
            date_groups[header_date] = unassigned
        else:
            date_groups["全部"] = unassigned

    # 按日期组重新编号
    for rows_in_group in date_groups.values():
        for i, row in enumerate(rows_in_group):
            row["序号"] = {"value": str(i + 1), "confidence": 1.0, "x": None, "y": None, "width": None, "height": None}

    # 日期排序
    def _date_sort_key(d):
        m = re.match(r"(\d+)月(\d+)日", d)
        return int(m.group(1)) * 100 + int(m.group(2)) if m else 0

    dates = sorted(date_groups.keys(), key=_date_sort_key)

    # 平铺兼容
    all_rows_flat = []
    for d in dates:
        all_rows_flat.extend(date_groups[d])

    # === 6. 最终清洗：数量/合计/备注强制只保留纯数字 ===
    _numeric_fields = {"数量", "合计", "备注"}
    for rows_in_group in date_groups.values():
        for row in rows_in_group:
            for field in _numeric_fields:
                cell = row.get(field)
                if isinstance(cell, dict):
                    cell["value"] = _clean_number(str(cell.get("value", "")))
                elif isinstance(cell, str):
                    row[field] = _clean_number(cell)

    return {
        "date_groups": date_groups,
        "rows": all_rows_flat,
        "dates": dates,
        "raw_rows": row_texts,
        "header_col_map": header_col_map,
        "header_info": _extract_header_info(text_blocks),
    }


def _match_header(row_texts: list[str]) -> dict[str, int]:
    """匹配表头行，返回 {字段名: 列索引}（辅助）"""
    col_map = {}
    for col_idx, text in enumerate(row_texts):
        text_clean = text.strip().replace(" ", "")
        for field, keywords in HEADER_KEYWORDS.items():
            if field in col_map:
                continue
            for kw in keywords:
                if kw in text_clean:
                    col_map[field] = col_idx
                    break
    return col_map

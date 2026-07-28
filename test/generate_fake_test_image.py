"""生成合成测试图片 — 用于替换真实送货单扫描件，包含完全虚构的数据"""
import os
from PIL import Image, ImageDraw, ImageFont

img = Image.new('RGB', (1000, 600), 'white')
draw = ImageDraw.Draw(img)

try:
    font_large = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
    font_medium = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
    font_small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 14)
except Exception:
    font_large = font_medium = font_small = ImageFont.load_default()

# Row 1: Company Name (centered)
company = "XX食品配送中心（测试用虚构数据）"
draw.text((500, 20), company, fill='black', font=font_large, anchor='ma')

# Row 2: Consignee (left) + Date (right)
draw.text((30, 65), "收货单位：测试饭店", fill='black', font=font_small)
draw.text((970, 65), "送货日期：2024年1月15日", fill='black', font=font_small, anchor='ra')

# Table Header
headers = ["序号", "名称", "单位", "购定价(含税)", "税率", "网上询价", "数量", "合计", "备注"]
col_widths = [50, 180, 50, 120, 50, 80, 60, 80, 100]
x_positions = [30]
for w in col_widths[:-1]:
    x_positions.append(x_positions[-1] + w)

y = 100
draw.rectangle([25, y, 975, y + 30], fill='#E8E8E8', outline='black')
for i, (h, x) in enumerate(zip(headers, x_positions)):
    draw.text((x + col_widths[i] // 2, y + 15), h, fill='black', font=font_small, anchor='mm')

line_x = 25
for w in col_widths:
    line_x += w
    draw.line([(line_x, y), (line_x, y + 30)], fill='black', width=1)

# FAKE Data Rows
fake_data = [
    ["1", "测试商品A", "斤", "", "", "", "15", "225.0", ""],
    ["2", "测试商品B", "斤", "", "", "", "10", "139.4", "7.6"],
    ["3", "测试商品C", "箱", "", "", "", "23", "460.0", ""],
    ["4", "测试商品D", "只", "", "", "", "12", "282.3", "12"],
    ["5", "测试商品E", "斤", "", "", "", "6", "", "7.6"],
]

row_height = 25
for ri, row in enumerate(fake_data):
    ry = y + 30 + ri * row_height
    draw.line([(25, ry), (975, ry)], fill='black', width=1)
    for ci, (val, x) in enumerate(zip(row, x_positions)):
        draw.text((x + col_widths[ci] // 2, ry + row_height // 2), val, fill='black', font=font_small, anchor='mm')
    lx = 25
    for w in col_widths:
        lx += w
        draw.line([(lx, ry), (lx, ry + row_height)], fill='black', width=1)

last_y = y + 30 + len(fake_data) * row_height
draw.line([(25, last_y), (975, last_y)], fill='black', width=1)
draw.line([(25, y), (25, last_y)], fill='black', width=1)
draw.line([(975, y), (975, last_y)], fill='black', width=1)

save_path = os.path.join(os.path.dirname(__file__), "test.png")
img.save(save_path, "PNG")
print(f"Saved: {save_path}  ({img.size[0]}x{img.size[1]})")

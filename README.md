# 📋 送货单OCR识别与Excel导出系统

基于 PaddleOCR 的智能送货单处理工具 — 上传 PDF/图片，自动识别表格数据，修正后导出标准 Excel。

## ✨ 功能特性

- **多格式导入** — 支持 PDF、PNG、JPG、BMP、TIFF 等格式
- **智能OCR识别** — 基于 PaddleOCR PP-OCRv4，中文识别精度高
- **自适应表格解析** — 间隙聚类分行 + X坐标分列，不依赖固定模板
- **图像增强** — 自动纠偏、CLAHE 对比度增强、自适应二值化
- **双模式界面** — 📋 表单模式（预览+OCR编辑）+ 📊 表格模式（多Sheet总览）
- **图片裁剪** — 内置裁剪工具，可精确选取表格区域
- **多Sheet导出** — 按日期自动分组，导出带格式的 Excel 文件
- **一键安装启动** — `setup.bat` + `start.bat`，无需技术背景

## 🏗️ 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 后端框架 | Flask | REST API 服务 |
| OCR 引擎 | PaddleOCR (PP-OCRv4, ONNX Runtime) | 文字识别 + 坐标提取 |
| PDF 处理 | PyMuPDF (fitz) | PDF → 图片渲染 |
| 图像处理 | OpenCV + Pillow | 纠偏、增强、二值化 |
| Excel 导出 | openpyxl | 多 Sheet 格式化导出 |
| 前端 | 原生 HTML/CSS/JS | 无需构建工具，零依赖 |

## 📁 项目结构

```
├── backend/                  # 后端
│   ├── app.py                # Flask API (7 个接口)
│   ├── ocr_engine.py         # PaddleOCR 封装 + 多线程并行
│   ├── pdf_processor.py      # PDF 渲染
│   ├── table_parser.py       # 自适应表格解析（核心算法）
│   ├── excel_exporter.py     # Excel 生成导出
│   ├── image_preprocessor.py # 图像增强管线
│   └── config.py             # 集中配置
├── frontend/                 # 前端
│   ├── index.html            # 双模式界面
│   └── static/
│       ├── app.js            # 前端逻辑
│       └── style.css         # Design System
├── docs/                     # 设计文档
├── test/                     # 测试代码
├── setup.bat                 # 一键安装脚本
└── start.bat                 # 一键启动脚本
```

## 🚀 快速开始

### 环境要求
- Windows 10/11
- Python 3.10+

### 安装

```bash
# 1. 解压项目到任意目录
# 2. 双击运行 setup.bat（创建 venv + 安装依赖，约 5-10 分钟）
```

或手动安装：

```bash
python -m venv venv
venv\Scripts\activate
pip install -r backend\requirements.txt
```

### 启动

```bash
# 双击 start.bat
# 或手动启动：

# 终端1 — 后端 API（端口 5000）
venv\Scripts\activate
cd backend && python app.py

# 终端2 — 前端静态服务（端口 8080）
cd frontend && python -m http.server 8080

# 浏览器访问 http://localhost:8080/index.html
```

### 使用流程

1. **创建项目** → 点击侧栏 `+` 创建项目
2. **导入文件** → 拖拽或点击导入 PDF/图片到项目卡片
3. **分析文件** → 选中文件，点击「🔍 分析文件」
4. **核对修正** → 在右侧表格中编辑修正识别结果
5. **存入数据** → 点击「💾 存入」保存到项目
6. **导出 Excel** → 切换到表格模式，点击「📥 导出Excel」

## 🔧 核心算法

### 表格解析流程

```
OCR 文字块 → 间隙聚类分行 → 关键词识别表头 → 学习 X 列位置 → X 最近邻分配 → 内容特征兜底
```

- **间隙聚类**：自适应中位数阈值，不依赖固定行高
- **列位置学习**：从表头行自动推算每列 X 中心，缺失列通过间距插值补齐
- **兜底机制**：当 X 坐标分配失败时，通过正则匹配内容特征判断字段类型

### Excel 导出格式

每个 Sheet 严格按照以下格式：

```
行1: 公司名称（居中加粗 16pt）
行3: 收货单位（左对齐）          送货日期（右对齐）
行5: 序号 | 名称 | 单位 | 购定价 | 税率 | 网上询价 | 数量 | 合计 | 备注
行6+: 数据行
```

## 📝 注意事项

- 首次运行 PaddleOCR 会自动下载模型文件（~100MB），请耐心等待
- 端口 5000（后端）和 8080（前端）不能与其他程序冲突
- PDF 建议使用 200+ DPI 扫描件以获得最佳识别效果
- 如需 GPU 加速，修改 `config.py` 中 `OCR_DEVICE = "gpu"`

## 📄 License

MIT

import os
import time

from paddleocr import PaddleOCR

# 初始化 OCR（ONNX 引擎，首次运行自动下载模型）
print("正在初始化 PaddleOCR...")
ocr = PaddleOCR(
    lang="ch",
    use_textline_orientation=True,
    device="cpu",
    engine="onnxruntime"
)
print("初始化完成！\n")

# 测试图片路径
img_path = os.path.join(os.path.dirname(__file__), "test.png")
if not os.path.exists(img_path):
    print(f"错误：找不到图片 {img_path}")
    exit(1)

print(f"正在识别: {img_path}\n")
start = time.time()

result = ocr.predict(img_path)
elapsed = time.time() - start

if not result:
    print("未识别到任何文字。")
    exit(0)

# 取第一页结果
data = result[0].json["res"]
texts = data.get("rec_texts", [])
scores = data.get("rec_scores", [])

print(f"{'='*50}")
print(f"识别结果（共 {len(texts)} 处文字，耗时 {elapsed:.2f}s）")
print(f"{'='*50}\n")

for i, (text, score) in enumerate(zip(texts, scores), 1):
    print(f"[{i:2d}] {text}")
    print(f"     置信度: {score:.3f}")
    print()

print(f"{'='*50}")
print("测试完成！")

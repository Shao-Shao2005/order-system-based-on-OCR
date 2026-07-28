/**
 * 送货单OCR识别系统 - 前端交互逻辑
 */

// ===== 上传页面逻辑 =====
document.addEventListener("DOMContentLoaded", () => {
    // 上传页面元素
    const dropArea = document.getElementById("drop-area");
    const fileInput = document.getElementById("file-input");
    const selectBtn = document.getElementById("select-btn");
    const uploadBtn = document.getElementById("upload-btn");
    const fileInfo = document.getElementById("file-info");
    const fileName = document.getElementById("file-name");
    const fileSize = document.getElementById("file-size");
    const clearFileBtn = document.getElementById("clear-file");
    const progressArea = document.getElementById("progress-area");
    const progressMsg = document.getElementById("progress-msg");
    const resultArea = document.getElementById("result-area");
    const resultMsg = document.getElementById("result-msg");
    const previewLink = document.getElementById("preview-link");
    const errorArea = document.getElementById("error-area");
    const errorMsg = document.getElementById("error-msg");

    let selectedFile = null;

    // ---- 文件选择 ----
    selectBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            handleFile(fileInput.files[0]);
        }
    });

    // ---- 拖拽上传 ----
    dropArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropArea.classList.add("drag-over");
    });

    dropArea.addEventListener("dragleave", () => {
        dropArea.classList.remove("drag-over");
    });

    dropArea.addEventListener("drop", (e) => {
        e.preventDefault();
        dropArea.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    function handleFile(file) {
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatSize(file.size);
        fileInfo.classList.remove("d-none");
        uploadBtn.classList.remove("d-none");
        // 隐藏之前的结果
        resultArea.classList.add("d-none");
        errorArea.classList.add("d-none");
    }

    clearFileBtn.addEventListener("click", () => {
        selectedFile = null;
        fileInput.value = "";
        fileInfo.classList.add("d-none");
        uploadBtn.classList.add("d-none");
    });

    // ---- 上传并识别 ----
    uploadBtn.addEventListener("click", () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append("file", selectedFile);

        // 显示进度
        uploadBtn.disabled = true;
        progressArea.classList.remove("d-none");
        resultArea.classList.add("d-none");
        errorArea.classList.add("d-none");

        progressMsg.textContent = "正在上传文件...";

        fetch("/upload", {
            method: "POST",
            body: formData,
        })
            .then((res) => res.json())
            .then((data) => {
                progressArea.classList.add("d-none");
                uploadBtn.disabled = false;

                if (data.error) {
                    showError(data.error);
                    return;
                }

                // 成功
                const rowCount = data.rows ? data.rows.length : 0;
                resultMsg.textContent =
                    `共识别到 ${rowCount} 条数据（${data.page_count} 页）`;
                if (data.warnings && data.warnings.length > 0) {
                    resultMsg.textContent += ` | ⚠️ ${data.warnings.join("；")}`;
                }
                resultArea.classList.remove("d-none");
                previewLink.href = `/preview/${data.task_id}`;
            })
            .catch((err) => {
                progressArea.classList.add("d-none");
                uploadBtn.disabled = false;
                showError("网络错误: " + err.message);
            });
    });

    function showError(msg) {
        errorMsg.textContent = msg;
        errorArea.classList.remove("d-none");
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }
});

// ===== 预览页面逻辑 =====
if (window.TASK_ID) {
    document.addEventListener("DOMContentLoaded", () => {
        initPreviewPage();
    });
}

function initPreviewPage() {
    const taskId = window.TASK_ID;
    const tableBody = document.getElementById("table-body");
    const previewImg = document.getElementById("preview-img");
    const pageNav = document.getElementById("page-nav");
    const rowCountBadge = document.getElementById("row-count");
    const exportBtn = document.getElementById("export-btn");
    const addRowBtn = document.getElementById("add-row-btn");

    // 头部信息元素
    const headerCompany = document.getElementById("header-company");
    const headerConsignee = document.getElementById("header-consignee");
    const headerDate = document.getElementById("header-date");

    let allRows = [];
    let headerInfo = { company: "", consignee: "铁科嘉苑饭店", date: "" };
    let previewImages = [];
    let currentPage = 0;

    // 加载数据
    fetch(`/api/task/${taskId}`)
        .then((res) => res.json())
        .then((data) => {
            if (data.error) {
                alert(data.error);
                return;
            }
            allRows = data.rows;
            previewImages = data.preview_images;
            headerInfo = data.header_info || {};
            if (!headerInfo.consignee) {
                headerInfo.consignee = "铁科嘉苑饭店";
            }
            renderHeaderInfo();
            renderTable();
            showPage(0);
            renderPageNav();
        })
        .catch((err) => {
            alert("加载数据失败: " + err.message);
        });

    function renderHeaderInfo() {
        headerCompany.value = headerInfo.company || "";
        headerConsignee.value = headerInfo.consignee || "";
        headerDate.value = headerInfo.date || "";
    }

    // 头部信息编辑事件
    headerCompany.addEventListener("input", () => {
        headerInfo.company = headerCompany.value;
    });
    headerConsignee.addEventListener("input", () => {
        headerInfo.consignee = headerConsignee.value;
    });
    headerDate.addEventListener("input", () => {
        headerInfo.date = headerDate.value;
    });

    function renderTable() {
        tableBody.innerHTML = "";
        allRows.forEach((row, idx) => {
            renderRow(row, idx);
        });
        rowCountBadge.textContent = `${allRows.length} 条`;
    }

    function renderRow(row, idx) {
        const tr = document.createElement("tr");
        tr.dataset.index = idx;

        const headers = [
            "序号", "名称", "单位", "购定价（含税）",
            "税率", "网上询价", "数量", "合计", "备注"
        ];

        headers.forEach((header) => {
            const td = document.createElement("td");
            const input = document.createElement("input");
            input.type = "text";
            input.value = row[header] || "";
            input.dataset.field = header;
            input.addEventListener("input", () => {
                allRows[idx][header] = input.value;
                // 序号自动更新
                if (header === "序号") {
                    // 不做联动，保持用户输入
                }
            });
            // 序号列不可编辑（自动维护）
            if (header === "序号") {
                input.readOnly = true;
                input.style.background = "#f8f9fa";
                input.style.color = "#6c757d";
            }
            td.appendChild(input);
            tr.appendChild(td);
        });

        // 操作列
        const actionTd = document.createElement("td");
        actionTd.className = "text-center";
        const delBtn = document.createElement("button");
        delBtn.className = "delete-row-btn";
        delBtn.innerHTML = "✕";
        delBtn.title = "删除此行";
        delBtn.addEventListener("click", () => {
            if (confirm(`确定删除第 ${idx + 1} 行（${allRows[idx]["名称"]}）？`)) {
                allRows.splice(idx, 1);
                renumberRows();
                renderTable();
            }
        });
        actionTd.appendChild(delBtn);
        tr.appendChild(actionTd);
        tableBody.appendChild(tr);
    }

    function renumberRows() {
        allRows.forEach((row, i) => {
            row["序号"] = String(i + 1);
        });
    }

    // 添加行
    addRowBtn.addEventListener("click", () => {
        const newRow = {
            "序号": String(allRows.length + 1),
            "名称": "", "单位": "", "购定价（含税）": "",
            "税率": "", "网上询价": "", "数量": "", "合计": "", "备注": ""
        };
        allRows.push(newRow);
        renderTable();
    });

    // 图片翻页
    function showPage(idx) {
        if (idx < 0 || idx >= previewImages.length) return;
        currentPage = idx;
        previewImg.src = previewImages[idx];
        updatePageNav();
    }

    function renderPageNav() {
        if (previewImages.length <= 1) {
            pageNav.innerHTML = "";
            return;
        }
        pageNav.innerHTML = "";
        for (let i = 0; i < previewImages.length; i++) {
            const btn = document.createElement("button");
            btn.className = `btn btn-sm btn-outline-secondary`;
            if (i === currentPage) btn.classList.add("active");
            btn.textContent = `第${i + 1}页`;
            btn.addEventListener("click", () => showPage(i));
            pageNav.appendChild(btn);
        }
    }

    function updatePageNav() {
        const buttons = pageNav.querySelectorAll("button");
        buttons.forEach((btn, i) => {
            btn.classList.toggle("active", i === currentPage);
        });
    }

    // 导出Excel
    exportBtn.addEventListener("click", () => {
        if (allRows.length === 0) {
            alert("没有数据可导出");
            return;
        }

        exportBtn.disabled = true;
        exportBtn.textContent = "正在导出...";

        fetch("/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task_id: taskId,
                rows: allRows,
                header_info: headerInfo,
            }),
        })
            .then((res) => {
                if (!res.ok) throw new Error("导出失败");
                return res.blob();
            })
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "送货单_导出.xlsx";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // 显示成功提示
                const toast = new bootstrap.Toast(
                    document.getElementById("export-toast")
                );
                toast.show();
            })
            .catch((err) => {
                alert("导出失败: " + err.message);
            })
            .finally(() => {
                exportBtn.disabled = false;
                exportBtn.textContent = "📥 导出Excel";
            });
    });
}

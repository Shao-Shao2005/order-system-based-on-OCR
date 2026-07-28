/**
 * 送货单OCR识别系统 - 前端逻辑 v2
 * 项目卡片 + 双模式（表单/表格）+ 拖拽导入
 */
const API = window.API_BASE || "http://localhost:5000";
const H = ["序号","名称","单位","购定价（含税）","税率","网上询价","数量","合计","备注"];
const NUMERIC_COLS = new Set(["数量","合计","备注"]);

function extractNumber(s) {
    const m = String(s || "").match(/(\d+\.?\d*)/);
    return m ? m[1] : "";
}

// ===== DOM 引用 =====
const el = (s) => document.querySelector(s);

// 模式切换
const btnFormMode = el("#btn-form-mode");
const btnTableMode = el("#btn-table-mode");
const formMode     = el("#form-mode");
const tableMode    = el("#table-mode");

// 项目侧栏
const projectSidebar = el("#project-sidebar");
const btnToggleSide  = el("#btn-toggle-sidebar");
const btnCreateProj  = el("#btn-create-project");
const projectList    = el("#project-list");
const sidebarResizer = el("#sidebar-resizer");

// 预览
const previewBody    = el("#preview-body");
const previewToolbar = el("#preview-toolbar");
const previewViewport= el("#preview-viewport");
const placeholder    = el("#preview-placeholder");
const previewPdf     = el("#preview-pdf");
const previewImgWrap = el("#preview-img-wrap");
const previewImg     = el("#preview-img");
const zoomSlider     = el("#zoom-slider");
const zoomLabel      = el("#zoom-label");
const btnZoomOut     = el("#btn-zoom-out");
const btnZoomIn      = el("#btn-zoom-in");
const btnZoomFit     = el("#btn-zoom-fit");
const btnPagePrev    = el("#btn-page-prev");
const btnPageNext    = el("#btn-page-next");
const btnToggleScan  = el("#btn-toggle-scan");
const pageInfo       = el("#page-info");

// 右面板
const btnAnalyze  = el("#btn-analyze");
const btnAddRow   = el("#btn-add-row");
const btnSave     = el("#btn-save");
const btnExportF  = el("#btn-export-form");
const tableBody   = el("#table-body");
const resultInfo  = el("#result-info");
const infoCompany = el("#info-company");
const infoConsignee = el("#info-consignee");
const infoDate    = el("#info-date");
const loading     = el("#loading-overlay");

// 表格模式
const tableProjectSelect = el("#table-project-select");
const tableProjectLabel  = el("#table-project-label");
const excelTbody   = el("#excel-tbody");
const sheetTabs    = el("#sheet-tabs");
const btnAddSheet  = el("#btn-add-sheet");
const btnTableAddRow = el("#btn-table-add-row");
const btnTableExport = el("#btn-table-export");

// 全局文件选择器
const globalFileInput = el("#global-file-input");
const progressFill    = el("#progress-fill");
const loadingTitle    = el("#loading-title");
const loadingSubtitle = el("#loading-subtitle");

// ===== 进度条工具函数 =====
function showProgress(title, subtitle) {
    loadingTitle.textContent = title || "正在处理...";
    loadingSubtitle.textContent = subtitle || "";
    progressFill.className = "";
    progressFill.style.width = "0%";
    loading.style.display = "flex";
}
function setProgress(pct, subtitle) {
    progressFill.className = "";
    progressFill.style.width = Math.min(100, Math.max(0, pct)) + "%";
    if (subtitle) loadingSubtitle.textContent = subtitle;
}
function setProgressIndeterminate(subtitle) {
    progressFill.className = "indeterminate";
    loadingSubtitle.textContent = subtitle || "";
}
function hideProgress() {
    loading.style.display = "none";
}

// ===== 状态 =====
let projects = [];            // [{id, name, files:[{name, blobUrl, dataUrl, ocrData:null}]}]
let activeProjectId = null;  // 当前选中的项目
let activeFileIdx = null;    // 当前项目中的活动文件索引（用于预览+OCR）
let previewMode = "none";    // none | pdf | img | ocr
let zoomPct = 100;
let ocrPages = [], curPage = 0, totalPages = 0;
let currentOcrRows = [];     // 当前OCR识别出的行数据
let dateGroups = {};          // API 返回的 date_groups
let currentHeaderInfo = { company:"", consignee:"铁科嘉苑饭店", date:"" };
let currentPreviewUrls = [];
let taskId = null;
let fileBlobUrl = null, fileDataUrl = null;
let sidebarCollapsed = false;
let showScanPreview = true;  // OCR后默认显示扫描件
let currentScanUrl = null;   // pdf-page 扫描件URL
let currentImageUrl = null;  // pdf-page 原图URL

// 裁剪状态
let cropMode = false;
let cropRect = { x: 0, y: 0, w: 0.6, h: 0.6 };
let cropDrag = null;
let cropStartX = 0, cropStartY = 0, cropStartRect = null;

// 表格模式状态
let tableModeProjectId = null;   // 表格模式当前查看的项目
let tableModeSheetIdx = 0;       // 表格模式当前激活的Sheet索引

// ===== 缩放 & 翻页 =====
function applyZoom(pct, cx, cy) {
    var oldZoom = zoomPct;
    pct = Math.max(25, Math.min(400, Math.round(pct)));
    if (pct === oldZoom) return;
    var vp = previewViewport;
    var ratio = pct / oldZoom;
    zoomPct = pct;
    // 像素宽度：基于图片自然尺寸，避免 CSS 百分比循环依赖
    var baseW = previewImg.naturalWidth || vp.clientWidth;
    previewImg.style.width = Math.round(baseW * pct / 100) + "px";
    previewImg.style.maxWidth = "none";
    zoomSlider.value = pct;
    zoomLabel.textContent = pct + "%";
    if (cx != null && cy != null) {
        vp.scrollLeft = (vp.scrollLeft + cx) * ratio - cx;
        vp.scrollTop  = (vp.scrollTop  + cy) * ratio - cy;
    }
    // 钳制滚动位置到合法范围
    requestAnimationFrame(function() {
        vp.scrollLeft = Math.max(0, Math.min(vp.scrollWidth - vp.clientWidth, vp.scrollLeft));
        vp.scrollTop  = Math.max(0, Math.min(vp.scrollHeight - vp.clientHeight, vp.scrollTop));
    });
}
function zoomIn()  { applyZoom(zoomPct + 20); }
function zoomOut() { applyZoom(zoomPct - 20); }
function zoomFit() { applyZoom(100); previewViewport.scrollTop = 0; previewViewport.scrollLeft = 0; }
function goPage(idx) {
    if (idx < 0 || idx >= totalPages) return;
    curPage = idx;
    var url = currentPreviewUrls[idx];
    if (showScanPreview && taskId) {
        url = "/api/scan/" + taskId + "/" + idx;
    }
    previewImg.src = API + url;
    pageInfo.textContent = (idx + 1) + "/" + totalPages;
    applyZoom(zoomPct);
    previewViewport.scrollTop = 0;
    btnToggleScan.textContent = showScanPreview ? "📷" : "🖼";
}

// ===== 文件预览 =====
function showPreview(blobUrl, fileType) {
    if (fileBlobUrl && fileBlobUrl !== blobUrl && fileBlobUrl.startsWith("blob:")) URL.revokeObjectURL(fileBlobUrl);
    fileBlobUrl = blobUrl;
    placeholder.style.display = "none";
    ocrPages = []; totalPages = 0; curPage = 0;

    if (fileType === "application/pdf" || fileType === "pdf") {
        previewMode = "pdf";
        previewPdf.style.display = "block";
        previewImgWrap.style.display = "none";
        previewPdf.src = blobUrl;
        previewToolbar.style.display = "none";
        btnCrop.style.display = "none";
        document.querySelectorAll(".crop-only").forEach(function(el){ el.style.display = "none"; });
    } else {
        previewMode = "img";
        previewPdf.style.display = "none";
        previewImgWrap.style.display = "";
        previewImg.src = blobUrl;
        previewToolbar.style.display = "flex";
        btnToggleScan.style.display = "none";
        el(".tb-sep").style.display = "none";
        btnPagePrev.style.display = btnPageNext.style.display = pageInfo.style.display = "none";
        if (!cropMode) {
            btnCrop.style.display = "";
            document.querySelectorAll(".crop-only").forEach(function(el){ el.style.display = ""; });
        }
        applyZoom(100);
    }
    if (fileType === "application/pdf") {
        btnToggleScan.style.display = "none";
    }
}

function showOcrPreview(imageUrls) {
    if (!imageUrls || !imageUrls.length) return;
    fileBlobUrl = null;
    placeholder.style.display = "none";
    previewPdf.style.display = "none";
    previewMode = "ocr";
    currentPreviewUrls = imageUrls;
    totalPages = imageUrls.length;
    curPage = 0;
    showScanPreview = true;
    btnToggleScan.style.display = "";
    btnToggleScan.textContent = "📷";
    previewImgWrap.style.display = "";
    previewToolbar.style.display = "flex";
    if (!cropMode) {
        btnCrop.style.display = "";
        document.querySelectorAll(".crop-only").forEach(function(el){ el.style.display = ""; });
    }
    if (totalPages > 1) {
        btnPagePrev.style.display = btnPageNext.style.display = pageInfo.style.display = "";
        el(".tb-sep").style.display = "";
        pageInfo.textContent = "1/" + totalPages;
    } else {
        btnPagePrev.style.display = btnPageNext.style.display = pageInfo.style.display = "none";
        el(".tb-sep").style.display = "none";
    }
    goPage(0);
}

// ===== 项目卡片渲染 =====
function renderProjectCards() {
    projectList.innerHTML = "";
    projects.forEach(proj => {
        var card = document.createElement("div");
        card.className = "project-card" + (proj.id === activeProjectId ? " selected" : "");
        card.dataset.pid = proj.id;

        // 项目名
        var nameInput = document.createElement("input");
        nameInput.className = "card-name";
        nameInput.value = proj.name;
        nameInput.placeholder = "项目名称";
        nameInput.addEventListener("input", function() {
            proj.name = this.value;
            updateTableModeProjectSelect();
        });
        nameInput.addEventListener("click", function(e) { e.stopPropagation(); });
        card.appendChild(nameInput);

        // 文件列表
        var filesDiv = document.createElement("div");
        filesDiv.className = "card-files";
        (proj.files || []).forEach(function(f, fi) {
            var fdiv = document.createElement("div");
            fdiv.className = "card-file" + (proj.id === activeProjectId && fi === activeFileIdx ? " active" : "");
            var icon = f.type === "pdf-page" ? "📑" : (f.type === "pdf" ? "📄" : "🖼");
            var statusDot = "";
            if (f.type === "pdf-page") {
                statusDot = f.ocrData
                    ? '<span class="page-status-dot done" title="已分析"></span>'
                    : '<span class="page-status-dot" title="未分析"></span>';
            }
            fdiv.innerHTML = '<span class="file-icon">' + icon + '</span>' +
                '<span class="file-name">' + f.name + '</span>' +
                statusDot +
                (f.enhancedBlobUrl ? '<span class="file-scan-done" title="已扫描处理">✅</span>' : '') +
                (f.type !== "pdf" && f.type !== "pdf-page" ? '<span class="file-scan" title="扫描处理（增亮+锐化）">🔍</span>' : '') +
                '<span class="file-del">✕</span>';

            // 点击选中文件
            fdiv.addEventListener("click", function(e) {
                e.stopPropagation();
                selectFile(proj.id, fi);
            });
            // 删除文件
            fdiv.querySelector(".file-del").addEventListener("click", function(e) {
                e.stopPropagation();
                deleteFile(proj.id, fi);
            });
            // 扫描处理按钮
            var scanBtn = fdiv.querySelector(".file-scan");
            if (scanBtn) {
                scanBtn.addEventListener("click", function(e) {
                    e.stopPropagation();
                    if (!f.fileObj) return;
                    var btn = this;
                    btn.textContent = "⏳";
                    btn.style.pointerEvents = "none";
                    var fd = new FormData();
                    fd.append("file", f.fileObj);
                    fetch(API + "/api/enhance", { method: "POST", body: fd })
                        .then(function(r) {
                            if (!r.ok) throw new Error("失败 " + r.status);
                            return r.blob();
                        })
                        .then(function(blob) {
                            if (f.enhancedBlobUrl) URL.revokeObjectURL(f.enhancedBlobUrl);
                            f.enhancedBlobUrl = URL.createObjectURL(blob);
                            // 如果当前正在预览这个文件，刷新为增强版
                            if (activeProjectId === proj.id && activeFileIdx === fi) {
                                showPreview(f.enhancedBlobUrl, "image");
                            }
                            renderProjectCards();
                        })
                        .catch(function(err) {
                            btn.textContent = "❌";
                            btn.style.pointerEvents = "";
                            alert("扫描处理失败: " + err.message);
                        });
                });
            }
            filesDiv.appendChild(fdiv);
        });
        card.appendChild(filesDiv);

        // 拖拽导入区
        var dropZone = document.createElement("div");
        dropZone.className = "card-drop-zone";
        dropZone.textContent = "拖拽文件到此处\n或点击导入";
        dropZone.addEventListener("click", function(e) {
            e.stopPropagation();
            openFilePicker(proj.id);
        });
        dropZone.addEventListener("dragover", function(e) {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", function() {
            dropZone.classList.remove("drag-over");
        });
        dropZone.addEventListener("drop", function(e) {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove("drag-over");
            if (e.dataTransfer.files.length) {
                addFiles(proj.id, e.dataTransfer.files);
            }
        });
        card.appendChild(dropZone);

        // 底部按钮
        var actions = document.createElement("div");
        actions.className = "card-actions";
        actions.innerHTML = '<button class="btn-import">📂 导入文件</button>' +
            '<button class="btn-del-project">🗑 删除</button>';
        actions.querySelector(".btn-import").addEventListener("click", function(e) {
            e.stopPropagation();
            openFilePicker(proj.id);
        });
        actions.querySelector(".btn-del-project").addEventListener("click", function(e) {
            e.stopPropagation();
            deleteProject(proj.id);
        });
        card.appendChild(actions);

        // 点击卡片空白处选中项目
        card.addEventListener("click", function() {
            selectProject(proj.id);
        });

        projectList.appendChild(card);
    });
}

// ===== 项目管理 =====
function createProject() {
    var proj = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: "项目" + (projects.length + 1),
        files: []
    };
    projects.push(proj);
    renderProjectCards();
    updateTableModeProjectSelect();
    selectProject(proj.id);
}

function deleteProject(pid) {
    projects = projects.filter(function(p) { return p.id !== pid; });
    if (activeProjectId === pid) {
        activeProjectId = null;
        activeFileIdx = null;
        resetPreview();
        resetForm();
    }
    if (tableModeProjectId === pid) {
        tableModeProjectId = null;
        tableModeSheetIdx = 0;
        renderTableMode();
    }
    renderProjectCards();
    updateTableModeProjectSelect();
}

function selectProject(pid) {
    activeProjectId = pid;
    activeFileIdx = null;
    currentOcrRows = [];
    dateGroups = {};
    resetPreview();
    resetForm();
    renderProjectCards();
}

// ===== 文件管理 =====
function openFilePicker(pid) {
    selectProject(pid);
    globalFileInput.dataset.targetPid = pid;
    globalFileInput.click();
}

globalFileInput.addEventListener("change", function() {
    var pid = globalFileInput.dataset.targetPid;
    if (pid && globalFileInput.files.length) {
        addFiles(pid, globalFileInput.files);
        globalFileInput.value = "";
    }
});

function addFiles(pid, fileList) {
    var proj = projects.find(function(p) { return p.id === pid; });
    if (!proj) return;
    Array.from(fileList).forEach(function(file) {
        var ftype = file.type === "application/pdf" ? "pdf" : "image";

        if (ftype === "pdf") {
            // PDF: 先导入渲染所有页面，不执行OCR（异步+进度条）
            showProgress("正在导入 " + file.name, "上传中...");
            var fd = new FormData();
            fd.append("file", file);
            fetch(API + "/api/import-pdf", { method: "POST", body: fd })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) { hideProgress(); alert(data.error); return; }
                    // 开始轮询渲染进度
                    pollImportProgress(data.task_id, file.name, pid, proj);
                })
                .catch(function(err) {
                    hideProgress();
                    alert("PDF导入失败: " + err.message);
                });

        // 轮询PDF渲染进度
        function pollImportProgress(taskId, fileName, pid, proj) {
            var totalPages = 0;
            function poll() {
                fetch(API + "/api/import-progress/" + taskId)
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.status === "error") {
                            hideProgress(); alert("渲染失败: " + data.error);
                            return;
                        }
                        if (data.status === "rendering") {
                            totalPages = data.total;
                            var pct = Math.round(data.rendered / data.total * 100);
                            setProgress(pct, "正在渲染第 " + data.rendered + "/" + data.total + " 页...");
                            setTimeout(poll, 300);
                        } else if (data.status === "done") {
                            setProgress(100, "渲染完成，共 " + data.total + " 页");
                            // 短暂显示100%后关闭
                            setTimeout(function() {
                                hideProgress();
                                data.pages.forEach(function(page) {
                                    proj.files.push({
                                        name: "第" + (page.page_index + 1) + "页",
                                        type: "pdf-page",
                                        blobUrl: null,
                                        serverPreviewUrl: page.image_url,
                                        scanUrl: page.scan_url,
                                        ocrData: null,
                                        taskId: taskId,
                                        pageIndex: page.page_index,
                                        fileObj: null,
                                        enhancedBlobUrl: null,
                                        pdfFileName: fileName
                                    });
                                });
                                renderProjectCards();
                                selectProject(pid);
                                updateTableModeProjectSelect();
                            }, 500);
                        }
                    })
                    .catch(function() { hideProgress(); alert("进度查询失败"); });
            }
            poll();
        }
        } else {
            // 图片: 直接添加（保持原有行为）
            var blobUrl = URL.createObjectURL(file);
            proj.files.push({
                name: file.name,
                type: ftype,
                blobUrl: blobUrl,
                ocrData: null,
                fileObj: file
            });
            renderProjectCards();
            selectProject(pid);
            updateTableModeProjectSelect();
        }
    });
}

function deleteFile(pid, fi) {
    var proj = projects.find(function(p) { return p.id === pid; });
    if (!proj) return;
    var f = proj.files[fi];
    if (f && f.blobUrl) URL.revokeObjectURL(f.blobUrl);
    if (f && f.enhancedBlobUrl) URL.revokeObjectURL(f.enhancedBlobUrl);
    proj.files.splice(fi, 1);
    if (activeProjectId === pid && activeFileIdx === fi) {
        activeFileIdx = null;
        resetPreview();
        resetForm();
    } else if (activeProjectId === pid && activeFileIdx > fi) {
        activeFileIdx--;
    }
    renderProjectCards();
    updateTableModeProjectSelect();
}

function selectFile(pid, fi) {
    activeProjectId = pid;
    activeFileIdx = fi;
    var proj = projects.find(function(p) { return p.id === pid; });
    var f = proj && proj.files[fi];
    if (!f) return;

    currentOcrRows = [];
    dateGroups = {};
    resetForm();
    renderProjectCards();
    btnAnalyze.disabled = false;  // 只要选中了文件就启用

    // PDF页面：用服务端渲染的图片预览
    if (f.type === "pdf-page") {
        currentImageUrl = API + f.serverPreviewUrl;
        currentScanUrl = API + (f.scanUrl || f.serverPreviewUrl);
        showPreview(currentImageUrl, "image");
        // 启用扫描件切换
        btnToggleScan.style.display = "";
        showScanPreview = true;
        btnToggleScan.textContent = "📷";
        return;
    }

    // PDF 直接预览
    if (f.type === "pdf") {
        showPreview(f.blobUrl, "pdf");
        return;
    }

    // 图片：优先用缓存的增强版，否则直接显示原图
    if (f.enhancedBlobUrl) {
        showPreview(f.enhancedBlobUrl, "image");
    } else {
        showPreview(f.blobUrl, "image");
    }
}

function resetPreview() {
    if (cropMode) exitCropMode();
    previewMode = "none";
    placeholder.style.display = "";
    previewPdf.style.display = "none";
    previewImgWrap.style.display = "none";
    previewToolbar.style.display = "none";
    btnAnalyze.disabled = true;
    fileBlobUrl = null;
    fileDataUrl = null;
}

// ===== OCR 分析 =====
btnAnalyze.addEventListener("click", function() {
    if (activeFileIdx === null || !activeProjectId) return;
    var proj = projects.find(function(p) { return p.id === activeProjectId; });
    if (!proj) return;
    var f = proj.files[activeFileIdx];
    if (!f) return;

    showProgress("正在进行OCR识别...", f.name);
    btnAnalyze.disabled = true;

    // pdf-page: 单页OCR
    if (f.type === "pdf-page") {
        setProgressIndeterminate("正在进行OCR识别...");
        fetch(API + "/api/ocr-page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: f.taskId, page_index: f.pageIndex })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            hideProgress();
            btnAnalyze.disabled = false;
            if (data.error) { alert(data.error); return; }

            currentOcrRows = data.rows || [];
            dateGroups = data.date_groups || {};
            currentHeaderInfo = data.header_info || {};
            if (!currentHeaderInfo.consignee) currentHeaderInfo.consignee = "铁科嘉苑饭店";
            currentPreviewUrls = data.preview_images || [];
            taskId = f.taskId;
            // 用OCR检测到的日期更新页面名称
            if (data.header_info && data.header_info.date) {
                f.name = data.header_info.date;
            } else if (data.dates && data.dates.length > 0) {
                f.name = data.dates[0];
            }
            // 标记已分析
            f.ocrData = { rows: data.rows, headerInfo: data.header_info };
            renderForm();
            renderProjectCards();
            if (currentPreviewUrls.length > 0) showOcrPreview(currentPreviewUrls);
        })
        .catch(function(err) {
            hideProgress();
            btnAnalyze.disabled = false;
            alert("分析失败: " + err.message);
        });
        return;
    }

    // 图片: 直接上传OCR（原有逻辑）
    if (!f.fileObj) { hideProgress(); btnAnalyze.disabled = false; return; }
    setProgressIndeterminate("正在进行OCR识别...");
    var fd = new FormData();
    fd.append("file", f.fileObj);

    fetch(API + "/api/upload", { method:"POST", body:fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            hideProgress();
            btnAnalyze.disabled = false;
            if (data.error) { alert(data.error); return; }

            currentOcrRows = data.rows || [];
            dateGroups = data.date_groups || {};
            currentHeaderInfo = data.header_info || {};
            if (!currentHeaderInfo.consignee) currentHeaderInfo.consignee = "铁科嘉苑饭店";
            currentPreviewUrls = data.preview_images || [];
            taskId = data.task_id;
            renderForm();
            if (currentPreviewUrls.length > 0) showOcrPreview(currentPreviewUrls);
        })
        .catch(function(err) {
            hideProgress();
            btnAnalyze.disabled = false;
            alert("分析失败: " + err.message);
        });
});

// ===== 表单渲染 =====
function renderForm() {
    infoCompany.value = currentHeaderInfo.company || "";
    infoConsignee.value = currentHeaderInfo.consignee || "铁科嘉苑饭店";
    infoDate.value = currentHeaderInfo.date || "";

    tableBody.innerHTML = "";
    if (!currentOcrRows.length) {
        tableBody.innerHTML = '<tr><td colspan="9" class="empty-msg">无数据</td></tr>';
        resultInfo.textContent = "0条";
        return;
    }

    currentOcrRows.forEach(function(row, idx) {
        var tr = document.createElement("tr");
        H.forEach(function(h) {
            var td = document.createElement("td");
            var cell = row[h];
            var val = (cell && typeof cell === "object") ? (cell.value || "") : (cell || "");
            var conf = (cell && typeof cell === "object") ? (cell.confidence ?? 1.0) : 1.0;
            var displayVal = NUMERIC_COLS.has(h) ? extractNumber(val) : val;
            var cls = (!displayVal || conf < 0.7) ? "cell-conf-error" : (conf < 0.9 ? "cell-conf-warn" : "");
            td.className = cls;

            var input = document.createElement("input");
            input.type = "text"; input.name = h;
            input.value = displayVal;
            input.dataset.header = h;
            input.dataset.idx = idx;
            if (h === "序号") input.readOnly = true;
            input.addEventListener("input", function() {
                var r = currentOcrRows[parseInt(this.dataset.idx)];
                if (!r) return;
                var v = this.value;
                if (NUMERIC_COLS.has(h)) v = extractNumber(v);
                var c = r[h];
                if (c && typeof c === "object") c.value = v;
                else r[h] = v;
                if (h === "备注" && extractNumber(v)) {
                    var qty = r["数量"];
                    if (qty && typeof qty === "object") qty.value = extractNumber(v);
                    else r["数量"] = extractNumber(v);
                }
                updateColor(td, input, r[h]);
            });
            td.appendChild(input);
            tr.appendChild(td);
        });
        // 操作按钮：插入 + 删除
        var td = document.createElement("td");
        td.style.whiteSpace = "nowrap";
        var btnIns = document.createElement("button");
        btnIns.className = "btn-ins"; btnIns.textContent = "＋";
        btnIns.title = "在下方插入行";
        btnIns.addEventListener("click", function() {
            var nr = {};
            H.forEach(function(hh) {
                nr[hh] = { value: hh === "序号" ? "" : "", confidence: 1.0 };
            });
            currentOcrRows.splice(idx + 1, 0, nr);
            renumOcrRows();
            renderForm();
        });
        var btnDel = document.createElement("button");
        btnDel.className = "btn-del"; btnDel.textContent = "✕";
        btnDel.title = "删除此行";
        btnDel.addEventListener("click", function() {
            currentOcrRows.splice(idx, 1);
            renumOcrRows();
            renderForm();
        });
        td.appendChild(btnIns);
        td.appendChild(btnDel);
        tr.appendChild(td);
        tableBody.appendChild(tr);
    });
    renumOcrRows();
    resultInfo.textContent = currentOcrRows.length + "条";
}

function resetForm() {
    infoCompany.value = "";
    infoConsignee.value = "";
    infoDate.value = "";
    tableBody.innerHTML = '<tr><td colspan="9" class="empty-msg">请在左侧选择文件并点击"分析文件"</td></tr>';
    resultInfo.textContent = "";
    currentOcrRows = [];
    dateGroups = {};
}

function renumOcrRows() {
    currentOcrRows.forEach(function(r, i) {
        if (r["序号"] && typeof r["序号"] === "object") r["序号"].value = String(i+1);
        else r["序号"] = String(i+1);
    });
}

function updateColor(td, input, cell) {
    var v = (cell && typeof cell === "object") ? (cell.value || "") : (cell || "");
    var c = (cell && typeof cell === "object") ? (cell.confidence ?? 1.0) : 1.0;
    td.className = (!v || c < 0.7) ? "cell-conf-error" : (c < 0.9 ? "cell-conf-warn" : "");
}

// ===== 头部信息编辑 =====
infoCompany.addEventListener("input", function() { currentHeaderInfo.company = this.value; });
infoConsignee.addEventListener("input", function() { currentHeaderInfo.consignee = this.value; });
infoDate.addEventListener("input", function() { currentHeaderInfo.date = this.value; });

// ===== 添加行 =====
btnAddRow.addEventListener("click", function() {
    var nr = {};
    H.forEach(function(h) {
        nr[h] = { value: h === "序号" ? String(currentOcrRows.length + 1) : "", confidence: 1.0 };
    });
    currentOcrRows.push(nr);
    renderForm();
});

// ===== 存入（按日期自动拆分 Sheet） =====
btnSave.addEventListener("click", function() {
    if (!activeProjectId || activeFileIdx === null) { alert("请先选择一个文件"); return; }
    if (!currentOcrRows.length) { alert("无数据可存入"); return; }

    // 同步头部信息
    currentHeaderInfo.company = infoCompany.value;
    currentHeaderInfo.consignee = infoConsignee.value;
    currentHeaderInfo.date = infoDate.value;

    var proj = projects.find(function(p) { return p.id === activeProjectId; });
    var file = proj.files[activeFileIdx];

    // 按日期分组当前行
    var groups = {};           // {date: [rows]}
    var dateKeys = Object.keys(dateGroups);
    if (dateKeys.length > 0) {
        // 用 API 返回的 date_groups 确定每个日期有多少行，
        // 按顺序分配 currentOcrRows（因为用户可能编辑了行的内容）
        var offset = 0;
        dateKeys.forEach(function(dk) {
            var count = dateGroups[dk].length;
            groups[dk] = currentOcrRows.slice(offset, offset + count);
            offset += count;
        });
        // 如果用户新增了行，归到最后一个日期
        if (offset < currentOcrRows.length) {
            var lastDate = dateKeys[dateKeys.length - 1];
            groups[lastDate] = groups[lastDate].concat(currentOcrRows.slice(offset));
        }
    } else {
        // 没有日期分组，全部归到一个默认 sheet
        var defaultDate = (currentHeaderInfo.date || "").trim() || "全部";
        groups[defaultDate] = currentOcrRows;
    }

    // 逐个日期存入（每个日期一个 Sheet）
    var savedCount = 0;
    var skippedCount = 0;
    Object.keys(groups).forEach(function(dateStr) {
        if (!groups[dateStr].length) return;

        var sheetHeader = JSON.parse(JSON.stringify(currentHeaderInfo));
        sheetHeader.date = dateStr;
        var newData = {
            rows: JSON.parse(JSON.stringify(groups[dateStr])),
            headerInfo: sheetHeader
        };

        // 查找项目中是否已有相同日期的 Sheet
        var existingFile = null;
        proj.files.forEach(function(f) {
            if (f.ocrData && f.ocrData.headerInfo && f.ocrData.headerInfo.date) {
                if ((f.ocrData.headerInfo.date || "").trim() === dateStr.trim()) {
                    existingFile = f;
                }
            }
        });

        if (existingFile) {
            var oldJson = JSON.stringify({rows: existingFile.ocrData.rows, headerInfo: existingFile.ocrData.headerInfo});
            var newJson = JSON.stringify(newData);
            if (oldJson === newJson) {
                skippedCount++;
                return;
            }
            existingFile.ocrData = newData;
            savedCount++;
        } else if (String(dateStr).trim() === (currentHeaderInfo.date || "").trim() || Object.keys(groups).length === 1) {
            // 文件自身的日期，存入当前文件
            file.ocrData = newData;
            savedCount++;
        } else {
            // 其他日期，创建新的虚拟条目
            var existingOther = proj.files.find(function(f) {
                return f.ocrData && f.ocrData.headerInfo &&
                    (f.ocrData.headerInfo.date || "").trim() === dateStr.trim();
            });
            if (!existingOther) {
                // 创建一条虚拟文件记录（没有实际文件，只有 OCR 数据）
                proj.files.push({
                    name: "【" + dateStr + "】" + file.name,
                    type: file.type,
                    blobUrl: file.blobUrl,
                    ocrData: newData,
                    fileObj: null
                });
                savedCount++;
            }
        }
    });

    if (skippedCount > 0 && savedCount === 0) {
        alert("数据未做更改，已导入相关数据");
    } else {
        alert("已存入 " + savedCount + " 个日期 (" + Object.keys(groups).join("、") + ")");
    }

    // 刷新
    updateTableModeProjectSelect();
    renderProjectCards();
    if (tableModeProjectId === activeProjectId) {
        refreshTableMode();
    }
});

// ===== 表单模式导出 =====
btnExportF.addEventListener("click", function() {
    if (!activeProjectId) { alert("请先选择项目"); return; }
    exportProjectExcel(activeProjectId);
});

// ===== 导出Excel =====
function exportProjectExcel(pid) {
    var proj = projects.find(function(p) { return p.id === pid; });
    if (!proj) return;
    var sheets = [];
    proj.files.forEach(function(f) {
        if (f.ocrData && f.ocrData.rows && f.ocrData.rows.length) {
            sheets.push({
                name: f.ocrData.headerInfo.date || f.name.replace(/\.(pdf|png|jpg|jpeg)$/i, ""),
                rows: f.ocrData.rows,
                headerInfo: f.ocrData.headerInfo
            });
        }
    });
    if (!sheets.length) { alert("该项目没有已存入的OCR数据"); return; }

    // 构造date_groups格式发给后端
    var dateGroups = {};
    sheets.forEach(function(s) {
        dateGroups[s.name] = s.rows;
    });
    var flatRows = [];
    Object.values(dateGroups).forEach(function(rs) { flatRows.push.apply(flatRows, rs); });

    btnExportF.disabled = true; btnExportF.textContent = "导出中...";
    fetch(API + "/api/export", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
            task_id:"",
            date_groups: dateGroups,
            rows: flatRows,
            header_info: sheets[0].headerInfo || {}
        }),
    })
    .then(function(r) { if(!r.ok) throw new Error("失败"); return r.blob(); })
    .then(function(b) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = (proj.name || "送货单") + ".xlsx";
        a.click();
        alert("导出成功！");
    })
    .catch(function(e) { alert(e.message); })
    .finally(function() { btnExportF.disabled = false; btnExportF.textContent = "📥 导出"; });
}

// ===== 模式切换 =====
btnFormMode.addEventListener("click", function() {
    btnFormMode.classList.add("active");
    btnTableMode.classList.remove("active");
    formMode.classList.remove("hidden");
    formMode.style.display = "flex";
    tableMode.style.display = "none";
    tableMode.classList.remove("active");
});

btnTableMode.addEventListener("click", function() {
    btnTableMode.classList.add("active");
    btnFormMode.classList.remove("active");
    formMode.classList.add("hidden");
    formMode.style.display = "none";
    tableMode.style.display = "flex";
    tableMode.classList.add("active");
    refreshTableMode();
});

// ===== 表格模式渲染 =====
function updateTableModeProjectSelect() {
    tableProjectSelect.innerHTML = '<option value="">请选择项目...</option>';
    projects.forEach(function(p) {
        var hasData = p.files.some(function(f) { return f.ocrData && f.ocrData.rows && f.ocrData.rows.length; });
        var opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + (hasData ? " (" + p.files.filter(function(f) {
            return f.ocrData && f.ocrData.rows && f.ocrData.rows.length;
        }).length + "个Sheet)" : "");
        tableProjectSelect.appendChild(opt);
    });
}

tableProjectSelect.addEventListener("change", function() {
    tableModeProjectId = this.value || null;
    tableModeSheetIdx = 0;
    refreshTableMode();
});

function refreshTableMode() {
    updateTableModeProjectSelect();
    if (tableModeProjectId) tableProjectSelect.value = tableModeProjectId;
    renderTableMode();
}

function getTableModeSheets() {
    if (!tableModeProjectId) return [];
    var proj = projects.find(function(p) { return p.id === tableModeProjectId; });
    if (!proj) return [];
    return proj.files
        .map(function(f, i) { return { fileIdx:i, file:f, data:f.ocrData }; })
        .filter(function(s) { return s.data && s.data.rows && s.data.rows.length; });
}

function renderTableMode() {
    var sheets = getTableModeSheets();
    sheetTabs.innerHTML = "";
    sheets.forEach(function(s, si) {
        var tab = document.createElement("div");
        tab.className = "sheet-tab" + (si === tableModeSheetIdx ? " active" : "");
        var name = (s.data.headerInfo && s.data.headerInfo.date) || s.file.name.replace(/\.(pdf|png|jpg|jpeg)$/i, "");
        tab.innerHTML = name + '<span class="sheet-close">✕</span>';
        tab.addEventListener("click", function(e) {
            if (e.target.classList.contains("sheet-close")) {
                e.stopPropagation();
                s.file.ocrData = null;
                if (si === tableModeSheetIdx) tableModeSheetIdx = Math.max(0, si - 1);
                renderTableMode();
                updateTableModeProjectSelect();
                return;
            }
            tableModeSheetIdx = si;
            renderTableMode();
        });
        sheetTabs.appendChild(tab);
    });

    // 渲染当前Sheet的表格
    excelTbody.innerHTML = "";
    if (!sheets.length) {
        excelTbody.innerHTML = '<tr><td colspan="9" class="empty-msg">该项目暂无已存入的数据</td></tr>';
        tableProjectLabel.textContent = "";
    } else {
        if (tableModeSheetIdx >= sheets.length) tableModeSheetIdx = 0;
        var active = sheets[tableModeSheetIdx];
        if (!active) { tableModeSheetIdx = 0; active = sheets[0]; }
        if (active) {
            var proj = projects.find(function(p) { return p.id === tableModeProjectId; });
            tableProjectLabel.textContent = "📋 " + (proj ? proj.name : "") + " · " +
                (active.data.headerInfo && active.data.headerInfo.date || active.file.name);
            renderTableModeRows(active.data.rows);
        }
    }
}

function renderTableModeRows(rows) {
    rows.forEach(function(row, idx) {
        var tr = document.createElement("tr");
        H.forEach(function(h) {
            var td = document.createElement("td");
            var cell = row[h];
            var val = (cell && typeof cell === "object") ? (cell.value || "") : (cell || "");
            var conf = (cell && typeof cell === "object") ? (cell.confidence ?? 1.0) : 1.0;
            var displayVal = NUMERIC_COLS.has(h) ? extractNumber(val) : val;
            var cls = (!displayVal || conf < 0.7) ? "cell-conf-error" : (conf < 0.9 ? "cell-conf-warn" : "");
            td.className = cls;
            var input = document.createElement("input");
            input.type = "text"; input.name = h;
            input.value = displayVal;
            if (h === "序号") input.readOnly = true;
            input.addEventListener("input", function() {
                var r = rows[idx]; if (!r) return;
                var v = this.value;
                if (NUMERIC_COLS.has(h)) v = extractNumber(v);
                var c = r[h];
                if (c && typeof c === "object") c.value = v;
                else r[h] = v;
                if (h === "备注" && extractNumber(v)) {
                    var qty = r["数量"];
                    if (qty && typeof qty === "object") qty.value = extractNumber(v);
                    else r["数量"] = extractNumber(v);
                }
            });
            td.appendChild(input);
            tr.appendChild(td);
        });
        var td = document.createElement("td");
        td.style.whiteSpace = "nowrap";
        var btnIns = document.createElement("button");
        btnIns.className = "btn-ins"; btnIns.textContent = "＋";
        btnIns.title = "在下方插入行";
        btnIns.addEventListener("click", function() {
            var nr = {};
            H.forEach(function(hh) {
                nr[hh] = { value: hh === "序号" ? "" : "", confidence: 1.0 };
            });
            rows.splice(idx + 1, 0, nr);
            for (var k = 0; k < rows.length; k++) {
                if (rows[k]["序号"] && typeof rows[k]["序号"] === "object") rows[k]["序号"].value = String(k + 1);
                else rows[k]["序号"] = String(k + 1);
            }
            renderTableModeRows(rows);
        });
        var btnDel = document.createElement("button");
        btnDel.className = "btn-del"; btnDel.textContent = "✕";
        btnDel.title = "删除此行";
        btnDel.addEventListener("click", function() {
            rows.splice(idx, 1);
            renderTableModeRows(rows);
        });
        td.appendChild(btnIns);
        td.appendChild(btnDel);
        tr.appendChild(td);
        excelTbody.appendChild(tr);
    });
}

btnTableAddRow.addEventListener("click", function() {
    var sheets = getTableModeSheets();
    if (!sheets.length) return;
    var active = sheets[tableModeSheetIdx];
    if (!active) return;
    var nr = {};
    H.forEach(function(h) {
        nr[h] = { value: h === "序号" ? String(active.data.rows.length + 1) : "", confidence: 1.0 };
    });
    active.data.rows.push(nr);
    renderTableMode();
});

btnAddSheet.addEventListener("click", function() {
    if (!tableModeProjectId) { alert("请先选择项目"); return; }
    if (!currentOcrRows.length) { alert("请先在表单模式中分析并存入数据"); return; }
    // 切回表单模式让用户操作
    btnFormMode.click();
    alert("请在表单模式中分析文件后点击【存入】");
});

btnTableExport.addEventListener("click", function() {
    if (!tableModeProjectId) { alert("请先选择项目"); return; }
    exportProjectExcel(tableModeProjectId);
});

// ===== 缩放事件绑定 =====
btnZoomIn.addEventListener("click", zoomIn);
btnZoomOut.addEventListener("click", zoomOut);
btnZoomFit.addEventListener("click", zoomFit);
btnToggleScan.addEventListener("click", function() {
    showScanPreview = !showScanPreview;
    btnToggleScan.textContent = showScanPreview ? "📷" : "🖼";
    if (previewMode === "ocr") {
        goPage(curPage);
    } else if (previewMode === "img" && currentScanUrl) {
        // pdf-page 单页预览：直接切换图片源
        var imgUrl = showScanPreview ? currentScanUrl : currentImageUrl;
        previewImg.src = imgUrl;
    }
});
zoomSlider.addEventListener("input", function() { applyZoom(parseInt(zoomSlider.value)); });
btnPagePrev.addEventListener("click", function() { goPage(curPage - 1); });
btnPageNext.addEventListener("click", function() { goPage(curPage + 1); });

previewViewport.addEventListener("wheel", function(e) {
    if (previewMode === "img" || previewMode === "ocr") {
        e.preventDefault();
        var step = 20 * (zoomPct / 100);
        var rect = previewViewport.getBoundingClientRect();
        applyZoom(zoomPct + (e.deltaY > 0 ? -step : step), e.clientX - rect.left, e.clientY - rect.top);
    }
}, { passive: false });

// 拖拽平移
var dragging = false, dragPrevX = 0, dragPrevY = 0;
previewViewport.addEventListener("mousedown", function(e) {
    if (previewMode !== "img" && previewMode !== "ocr") return;
    dragging = true;
    dragPrevX = e.clientX; dragPrevY = e.clientY;
    previewViewport.style.cursor = "grabbing";
    e.preventDefault();
});
window.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    var dx = e.clientX - dragPrevX, dy = e.clientY - dragPrevY;
    dragPrevX = e.clientX; dragPrevY = e.clientY;
    previewViewport.scrollLeft -= dx;
    previewViewport.scrollTop  -= dy;
});
window.addEventListener("mouseup", function() {
    dragging = false;
    previewViewport.style.cursor = "";
});
previewViewport.addEventListener("mouseenter", function() {
    if ((previewMode === "img" || previewMode === "ocr") && !dragging) previewViewport.style.cursor = "grab";
});
previewViewport.addEventListener("mouseleave", function() {
    if (!dragging) previewViewport.style.cursor = "";
});

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && cropMode) { e.preventDefault(); exitCropMode(); return; }
    if (previewMode === "ocr" && totalPages > 1) {
        if (e.key === "ArrowLeft")  { e.preventDefault(); goPage(curPage - 1); }
        if (e.key === "ArrowRight") { e.preventDefault(); goPage(curPage + 1); }
    }
});

// ===== 侧栏收缩 =====
btnToggleSide.addEventListener("click", function() {
    sidebarCollapsed = !sidebarCollapsed;
    if (sidebarCollapsed) {
        projectSidebar.classList.add("collapsed");
        btnToggleSide.textContent = "▶";
    } else {
        projectSidebar.classList.remove("collapsed");
        btnToggleSide.textContent = "◀";
    }
});

// ===== 侧栏拖拽调整宽度 =====
var resizing = false;
sidebarResizer.addEventListener("mousedown", function(e) {
    resizing = true;
    e.preventDefault();
});
window.addEventListener("mousemove", function(e) {
    if (!resizing) return;
    var w = e.clientX;
    if (w > 120 && w < 500) projectSidebar.style.width = w + "px";
});
window.addEventListener("mouseup", function() { resizing = false; });

// ===== 创建项目按钮 =====
btnCreateProj.addEventListener("click", createProject);

// ===== 图片裁剪 =====
const cropOverlay = el("#crop-overlay");
const cropBox = el("#crop-box");
const cropToolbar = el("#crop-toolbar");
const btnCrop = el("#btn-crop");
const btnCropConfirm = el("#btn-crop-confirm");
const btnCropCancel = el("#btn-crop-cancel");

function getImgNatural() {
    // 返回图片在 viewport 中的显示区域信息
    var vp = previewViewport;
    var vpW = vp.clientWidth, vpH = vp.clientHeight;
    var img = previewImg;
    var natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW || !natH) return { left: 0, top: 0, w: vpW, h: vpH, scale: 1, natW: vpW, natH: vpH };

    // 图片在 viewport 内的渲染尺寸（受 zoom 和 CSS 影响）
    var dispW = img.clientWidth, dispH = img.clientHeight;
    if (!dispW || !dispH) { dispW = natW; dispH = natH; }
    var left = (vpW - dispW) / 2 + vp.scrollLeft;
    var top = (vpH - dispH) / 2 + vp.scrollTop;
    if (left < 0 && dispW > vpW) left = vp.scrollLeft;
    // 简化：用 scroll 偏移计算
    var scrollL = vp.scrollLeft, scrollT = vp.scrollTop;
    // 图片相对于 viewport 的偏移
    var imgLeft = -scrollL, imgTop = -scrollT;
    if (dispW < vpW) imgLeft = (vpW - dispW) / 2;
    if (dispH < vpH) imgTop = (vpH - dispH) / 2;

    return {
        left: imgLeft, top: imgTop,
        w: dispW, h: dispH,
        scale: dispW / natW,
        natW: natW, natH: natH
    };
}

function updateCropBox() {
    var info = getImgNatural();
    var vpW = previewViewport.clientWidth, vpH = previewViewport.clientHeight;
    var boxL = info.left + cropRect.x * info.w;
    var boxT = info.top + cropRect.y * info.h;
    var boxW = cropRect.w * info.w;
    var boxH = cropRect.h * info.h;
    // clamp
    boxL = Math.max(0, boxL);
    boxT = Math.max(0, boxT);
    if (boxL + boxW > vpW) boxW = vpW - boxL;
    if (boxT + boxH > vpH) boxH = vpH - boxT;
    boxW = Math.max(40, boxW);
    boxH = Math.max(40, boxH);

    cropBox.style.left = boxL + "px";
    cropBox.style.top = boxT + "px";
    cropBox.style.width = boxW + "px";
    cropBox.style.height = boxH + "px";
}

function enterCropMode() {
    if (previewMode !== "img" && previewMode !== "ocr") return;
    cropMode = true;
    cropRect = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
    cropOverlay.style.display = "";
    cropOverlay.classList.add("active");
    cropToolbar.style.display = "flex";
    btnCrop.style.display = "none";
    updateCropBox();
}

function exitCropMode() {
    cropMode = false;
    cropOverlay.style.display = "none";
    cropOverlay.classList.remove("active");
    cropToolbar.style.display = "none";
    btnCrop.style.display = (previewMode === "img" || previewMode === "ocr") ? "" : "none";
}

function applyCrop() {
    if (!activeProjectId || activeFileIdx === null) return;
    var proj = projects.find(function(p) { return p.id === activeProjectId; });
    if (!proj) return;
    var f = proj.files[activeFileIdx];
    if (!f) return;

    var img = previewImg;
    var natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW || !natH) return;

    // cropRect 是相对图片的比例，直接映射到自然尺寸
    var sx = Math.round(cropRect.x * natW);
    var sy = Math.round(cropRect.y * natH);
    var sw = Math.round(cropRect.w * natW);
    var sh = Math.round(cropRect.h * natH);
    // clamp
    sx = Math.max(0, Math.min(natW - 1, sx));
    sy = Math.max(0, Math.min(natH - 1, sy));
    sw = Math.max(1, Math.min(natW - sx, sw));
    sh = Math.max(1, Math.min(natH - sy, sh));

    var canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob(function(blob) {
        // 释放旧 blob
        if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
        if (f.enhancedBlobUrl) URL.revokeObjectURL(f.enhancedBlobUrl);
        f.enhancedBlobUrl = null;

        f.blobUrl = URL.createObjectURL(blob);
        f.fileObj = new File([blob], f.name, { type: blob.type || "image/png" });

        exitCropMode();
        showPreview(f.blobUrl, "image");
    }, "image/png");
}

// 裁剪框拖动事件
cropBox.addEventListener("mousedown", function(e) {
    if (!cropMode) return;
    if (e.target === cropBox) {
        cropDrag = "move";
    } else if (e.target.classList.contains("crop-handle")) {
        cropDrag = e.target.dataset.dir;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    cropStartX = e.clientX;
    cropStartY = e.clientY;
    cropStartRect = { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h };
});

window.addEventListener("mousemove", function(e) {
    if (!cropMode || !cropDrag) return;
    var info = getImgNatural();
    var dx = (e.clientX - cropStartX) / info.w;
    var dy = (e.clientY - cropStartY) / info.h;

    if (cropDrag === "move") {
        cropRect.x = Math.max(0, Math.min(1 - cropRect.w, cropStartRect.x + dx));
        cropRect.y = Math.max(0, Math.min(1 - cropRect.h, cropStartRect.y + dy));
    } else {
        if (cropDrag.indexOf("n") >= 0) {
            cropRect.y = Math.max(0, Math.min(cropStartRect.y + cropStartRect.h - 0.02, cropStartRect.y + dy));
            cropRect.h = cropStartRect.y + cropStartRect.h - cropRect.y;
        }
        if (cropDrag.indexOf("s") >= 0) {
            cropRect.h = Math.max(0.02, Math.min(1 - cropStartRect.y, cropStartRect.h + dy));
        }
        if (cropDrag.indexOf("w") >= 0) {
            cropRect.x = Math.max(0, Math.min(cropStartRect.x + cropStartRect.w - 0.02, cropStartRect.x + dx));
            cropRect.w = cropStartRect.x + cropStartRect.w - cropRect.x;
        }
        if (cropDrag.indexOf("e") >= 0) {
            cropRect.w = Math.max(0.02, Math.min(1 - cropStartRect.x, cropStartRect.w + dx));
        }
    }
    updateCropBox();
});

window.addEventListener("mouseup", function() {
    cropDrag = null;
    cropStartRect = null;
});

btnCrop.addEventListener("click", enterCropMode);
btnCropConfirm.addEventListener("click", applyCrop);
btnCropCancel.addEventListener("click", exitCropMode);

// viewport 滚动/缩放时更新裁剪框位置
var origApplyZoom = applyZoom;
applyZoom = function(pct, cx, cy) {
    origApplyZoom(pct, cx, cy);
    if (cropMode) updateCropBox();
};
previewViewport.addEventListener("scroll", function() {
    if (cropMode) updateCropBox();
});

// ===== 清除缓存 =====
function clearCache() {
    if (!confirm("确定要清除服务器所有缓存吗？\n\n这将清除：内存OCR缓存 + 磁盘缓存文件 + 上传文件")) return;
    fetch(API + "/api/cache", { method: "DELETE" })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            alert(data.message || "缓存已清除");
        })
        .catch(function(err) {
            alert("清除缓存失败: " + err.message);
        });
}

// ===== 初始化 =====
createProject();
updateTableModeProjectSelect();

document.getElementById("btn-clear-cache").addEventListener("click", clearCache);

sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "com/gsitm/pkg/co/zgspkgco0060/model/models",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/export/library",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/json/JSONModel",
    "sap/m/SearchField",
    "sap/ui/table/Column",
    "sap/m/Token",
    "sap/m/Label",
    "sap/m/Text",
    "com/gsitm/pkg/co/zgspkgco0060/formatter/formatter",
    "sap/m/MessageBox",
    "sap/ui/model/FilterType",
], function (
    Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet,
    JSONModel, SearchField, Column, Token, Label, Text, formatter, MessageBox, FilterType
) {
    "use strict";

    // ============================================================================
    // Constants & Module-scope
    // ============================================================================
    const EdmType = exportLibrary.EdmType;
    const Control = {
        ComboBox: { CB_CompanyCode: "CB_CompanyCode" },
        FilterBar: { FB_MainSearch: "FB_MainSearch" },
        Search: { MI_CompanyCode: "MI_CompanyCode" },
        Table: { T_Main: "T_Main" },
        Button: { B_Excel: "B_Excel", B_Print: "B_Print" }
    };
    const CUSTOM_PARAM_MAP = {
        NodeText: "LP_NODETEXT",
        GlAccount: "LP_GLACCOUNT",
        GlAccountText: "LP_GLACCOUNTTEXT"
    };
    // === 북마크(앱 내부) 유틸 ===
    const BM_KEY = "zgspkgco0060.bookmarks.v1";

    let oView;               // cached view
    let vVHGL;               // GL Value Help model

    return Controller.extend("com.gsitm.pkg.co.zgspkgco0060.controller.Main", {
        formatter: formatter,

        // ========================================================================
        // LIFECYCLE
        // ========================================================================
        /**
         * onInit: models, i18n, defaults, event delegates (that require control IDs),
         * and initial table binding setup.
         */
        onInit: function () {
            this._glDict = {};
            this._glKeys = new Set();
            this._glAllLoaded = false;
            this._glAllData = null;
            this._glSelKeys = new Set();
            this._glTextSelKeys = new Set();
            this._glSel = new Set();
            this._glIndex = {};
            this._colFilters = {};
            this._expandAllAfterBind = false;
            // onInit 등 컨트롤러 멤버 초기화 위치
            this._menuOpen = false;       // 메뉴 열림 여부
            this._glStage = null;         // 메뉴에서 임시로 담아둘 선택들(Set<string>)
            this._glKeys = this._glKeys || new Set(); // 기존 커밋된 선택
            this._glDict = this._glDict || {};

            // flags & restore info
            this._isClientView = false;     // JSON client mode?
            this._origBindingInfo = null;   // OData restore info
            this._bInitialExpandDone = false;
            this._hlBound = false;          // rowsUpdated listener bound?
            this._customParams = {};
            this._colSel = { GlAccount: [], GlAccountText: [] };
            // i18n
            this.i18n = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            // view & base models
            oView = this.getView();
            oView.setModel(new JSONModel(), "oResult");
            oView.setModel(Model.createDateRangeModel(), "DateRange");
            oView.setModel(Model.createSearchModel(), "Search");

            // GL Value Help model (async)
            oView.setModel(new JSONModel(), "oGLAccount");
            vVHGL = oView.getModel("oGLAccount");
            Model.readODataModel("ZSB_FISTATEMENTS_UI_O2", "GLAccount_VH", null, null, null)
                .then((res) => vVHGL.setProperty("/", res.results))
                .catch(console.error);

            const oJson = new sap.ui.model.json.JSONModel([]);
            this.getView().setModel(oJson, "GLALL");

            const oFB = this.byId(Control.FilterBar.FB_MainSearch);
            if (oFB) {
                this._fbDelegate = {
                    onAfterRendering: function (ev) {
                        const btn = ev.srcControl && ev.srcControl._oSearchButton;
                        if (btn) btn.setText(this.i18n.getText("goButton"));
                    }.bind(this)
                };
                oFB.addEventDelegate(this._fbDelegate);
            }

            this._initMonthYearInputs();

            const oSearch = this.getView().getModel("Search");
            if (!oSearch.getProperty("/CompanyCode")) {
                oSearch.setProperty("/CompanyCode", "4310");
            }
            if (oSearch.getProperty("/GL0") === undefined) {
                oSearch.setProperty("/GL0", false);
            }

            // Initial table bind
            const oTreeTable = this.byId(Control.Table.T_Main);
            this._bindTable(oTreeTable);

            // onInit 끝쪽

            this._maxExpandLevel = this._getVisibleMaxLevel();
            this._curExpandLevel = this._maxExpandLevel; // 전체 펼침 상태로 시작
            const oVH = this.getOwnerComponent().getModel("F_GLAccount_VH");
            oVH.read("/F_GLAccount_VH", {
                success: function (oData) {
                    console.log("F_GLAccount_VH 전체 데이터", oData.results);
                },
                error: function (oError) {
                    console.error("데이터 읽기 실패", oError);
                }
            });

            if (!oVH) {
                jQuery.sap.log.error("F_GLAccount_VH model not found on view");
            } else {
                this.getView().setModel(oVH, "F_GLAccount_VH"); // 보수적으로 뷰에도 보장
            }

        },
        onAfterRendering: function () {
            this._setPeriodHeaders();

            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;

            // 기본 테이블 설정
            oTable.setSelectionMode(sap.ui.table.SelectionMode.Single);
            oTable.setSelectionBehavior(sap.ui.table.SelectionBehavior.Row);
            oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
            oTable.setVisibleRowCount(25);
            if (!this._rowIndexHooksBound) {
                // 셀 클릭 시 해당 행을 선택으로 기억
                if (typeof oTable.attachCellClick === "function") {
                    oTable.attachCellClick((ev) => {
                        const idx = ev.getParameter("rowIndex");
                        if (idx >= 0) {
                            this._lastRowIndex = idx;
                            if (oTable.getSelectedIndex() !== idx) oTable.setSelectedIndex(idx);
                        }
                    });
                }
                // 행 선택 변경 시 인덱스 기억
                if (typeof oTable.attachRowSelectionChange === "function") {
                    oTable.attachRowSelectionChange((ev) => {
                        const idx = oTable.getSelectedIndex();
                        if (idx >= 0) this._lastRowIndex = idx;
                    });
                }
                this._rowIndexHooksBound = true;
            }
            if (typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));
            }

            if (!this._hlBound) {
                // 행 갱신(스크롤/리바운드 등) 때마다: 열 인덱스 맵 갱신 + 하이라이트 재적용
                oTable.attachRowsUpdated(() => {
                    this._refreshColumnIndexMap();
                    this._refreshRowHighlights();
                    this._applyGroupRowColors();
                });

                // 열 이동 시: 인덱스 맵 즉시 갱신
                if (typeof oTable.attachColumnMove === "function") {
                    oTable.attachColumnMove(this._refreshColumnIndexMap.bind(this));
                }

                this._hlBound = true;
            }
            // (선택) 열 드래그 이동 허용
            if (oTable.getEnableColumnReordering && !oTable.getEnableColumnReordering()) {
                oTable.setEnableColumnReordering(true);
            }
            // 초기 1회 계산/적용
            this._refreshColumnIndexMap();
            this._applyGroupRowColors();
        },

        /**
         * onExit: detach delegates/listeners and null out strong refs.
         */
        onExit: function () {
            try {
                const oFB = this.byId(Control.FilterBar.FB_MainSearch);
                if (oFB && this._fbDelegate) oFB.removeEventDelegate(this._fbDelegate);
            } catch (e) { /* noop */ }

            try {
                const oTable = this.byId(Control.Table.T_Main);
                if (oTable && this._hlBound) {
                    oTable.detachRowsUpdated(this._refreshRowHighlights.bind(this));
                }
            } catch (e) { /* noop */ }

            this._fbDelegate = null;
            oView = null;
            vVHGL = null;
        },
        // ========================================================================
        // TOP-LEVEL UI EVENTS (Search / Export / Print / Expand-All / Collapse-All)
        // ========================================================================
        onSearch: function () {
            this._setPeriodHeaders();
            this._customParams = {};
            this._colFilters = {};
            // If client mode, restore OData first
            if (this._isClientView) this._restoreODataBinding();

            // Required token values
            const sPriorYear = this._getTokenVal("MI_PriorYear");
            const sPriorStart = this._getTokenVal("MI_PriorStartMonth");
            const sPriorEnd = this._getTokenVal("MI_PriorEndMonth");
            const sCurrYear = this._getTokenVal("MI_CurrentYear");
            const sCurrStart = this._getTokenVal("MI_CurrentStartMonth");
            const sCurrEnd = this._getTokenVal("MI_CurrentEndMonth");

            if (!this._checkRequiredFields(sPriorYear, sCurrYear, sPriorStart, sPriorEnd, sCurrStart, sCurrEnd)) return;

            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;

            oTable.setBusy(true);
            oTable.unbindRows();
            this._bInitialExpandDone = false;
            this._bindTable(oTable);
        },
        onExport: function () {
            const oBExcel = this.getView().byId(Control.Button.B_Excel);
            if (oBExcel) oBExcel.setBusy(true);

            const oTreeTable = this.getView().byId(Control.Table.T_Main);
            const oRowBinding = oTreeTable && oTreeTable.getBinding('rows');
            if (!oRowBinding) { if (oBExcel) oBExcel.setBusy(false); return; }

            // 1) 엑셀로 보낼 데이터 수집(기존 그대로)
            const aExportData = [];
            const iRowCount = oRowBinding.getLength();
            const aNodes = (typeof oRowBinding.getNodes === "function") ? oRowBinding.getNodes() : [];

            for (let i = 0; i < iRowCount; i++) {
                const ctx = oRowBinding.getContextByIndex(i);
                if (!ctx) continue;

                const oRowData = Object.assign({}, ctx.getObject());
                oRowData.HierarchyLevel = aNodes[i] ? aNodes[i].level : 0;

                // 기간/비교기간 잔액 포맷
                oRowData.PeriodBalance =
                    this.formatter.currencyHideZeroForBsPl(
                        oRowData.PeriodBalance,
                        oRowData.CompanyCodeCurrency,
                        oRowData.NodeText
                    );

                oRowData.ComparisonBalance =
                    this.formatter.currencyHideZeroForBsPl(
                        oRowData.ComparisonBalance,
                        oRowData.CompanyCodeCurrency,
                        oRowData.NodeText
                    );

                // 절대/상대 차이 포맷
                oRowData.AbsoluteDifference =
                    this.formatter.absDiffFixed2AutoScale(
                        oRowData.AbsoluteDifference,
                        oRowData.CompanyCodeCurrency,
                        oRowData.NodeText,
                        oRowData.PeriodBalance,
                        oRowData.ComparisonBalance
                    );

                oRowData.RelativeDifference =
                    this.formatter.formatAbsDiff(
                        oRowData.RelativeDifference,
                        oRowData.NodeText
                    );
                aExportData.push(oRowData);
            }
            // 2) 기본 컬럼 정의 가져오기 (정적 → 동적)
            const aCols = this._getVisibleColumnConfigFromTable();

            // 3) 기간 라벨 덮어쓰기 (동일)
            const priorYear = this._getTokenVal("MI_PriorYear");
            const priorFrom = this._getTokenVal("MI_PriorStartMonth");
            const priorTo = this._getTokenVal("MI_PriorEndMonth");
            const currYear = this._getTokenVal("MI_CurrentYear");
            const currFrom = this._getTokenVal("MI_CurrentStartMonth");
            const currTo = this._getTokenVal("MI_CurrentEndMonth");

            const reportLabel = this._buildPeriodLabel(priorYear, priorFrom, priorTo);
            const compareLabel = this._buildPeriodLabel(currYear, currFrom, currTo);

            const colPB = aCols.find(c => c.property === "PeriodBalance");
            if (colPB) colPB.label = this.i18n.getText("PeriodBalance") + " " + reportLabel;

            const colCB = aCols.find(c => c.property === "ComparisonBalance");
            if (colCB) colCB.label = this.i18n.getText("ComparisonBalance") + " " + compareLabel;


            // 4) 스프레드시트 설정 및 생성
            const oSettings = {
                workbook: { columns: aCols, hierarchyLevel: 'HierarchyLevel' },
                dataSource: aExportData,
                fileName: (this.i18n.getText("title") || "Report") + "_" + (new Date()).toISOString() + '.xlsx',
                worker: true
            };

            const oSheet = new Spreadsheet(oSettings);
            oSheet.build().finally(() => {
                oSheet.destroy();
                if (oBExcel) oBExcel.setBusy(false);
            });
        },
        onPrint: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) {
                sap.m.MessageToast.show(this.i18n.getText("toast.runSearchFirst") || "먼저 조회를 실행하세요.");
                return;
            }
            await this._waitRowsSettled(oTable, 180);
            // 데이터/컬럼 메타
            const aRows = this._collectExportRows(oBinding);
            // const aCols = this._createColumnConfig();
            const aCols = this._getVisibleColumnConfigFromTable();
            const percents = this._getScreenColumnPercentsForCols(aCols);
            // 라벨
            const priorYear = this._getTokenVal("MI_PriorYear");
            const priorFrom = this._getTokenVal("MI_PriorStartMonth");
            const priorTo = this._getTokenVal("MI_PriorEndMonth");
            const currYear = this._getTokenVal("MI_CurrentYear");
            const currFrom = this._getTokenVal("MI_CurrentStartMonth");
            const currTo = this._getTokenVal("MI_CurrentEndMonth");
            const reportLabel = this._buildPeriodLabel(priorYear, priorFrom, priorTo);
            const compareLabel = this._buildPeriodLabel(currYear, currFrom, currTo);

            const sTitle = this.i18n.getText("title") || "Report";
            const html = this._buildPrintHTML({
                title: sTitle,
                subTitleLines: [
                    this.i18n.getText("PeriodBalance") + " " + reportLabel,
                    this.i18n.getText("ComparisonBalance") + " " + compareLabel
                ],
                cols: aCols,
                rows: aRows,
                colPercents: percents
            });
            const w = window.open("", "_blank");
            w.document.open();
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => { w.print(); /* w.close(); */ }, 200);
        },
        onExpandAllPress: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            oTable.setBusy(true);
            try { oTable.expandToLevel(20); } catch (e) { /*noop*/ }
            this._collapsedNodes = new Set();
            this._bInitialExpandDone = true;
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },

        onCollapseAllPress: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            oTable.setBusy(true);
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) { oTable.setBusy(false); return; }
            const len = oBinding.getLength();
            this._collapsedNodes = this._collapsedNodes || new Set();
            for (let i = 0; i < len; i++) {
                try {
                    const ctx = oBinding.getContextByIndex(i);
                    if (!ctx) continue;
                    oTable.collapse(i);
                    const obj = ctx.getObject();
                    if (obj && (obj.NodeID || obj.Node)) this._collapsedNodes.add(obj.NodeID || obj.Node);
                } catch (e) { /*noop*/ }
            }
            // 현재 상태가 "전부 접힘"임을 명시
            this._curExpandLevel = 1;
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },
        _collapseNodesById: async function (ids = []) {
            const set = new Set((ids || []).map(String));
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob || !set.size) return;

            // 몇 번에 걸쳐 화면에 보이는 대상이 있으면 접어준다
            for (let pass = 0; pass < 6; pass++) {
                await this._waitRowsSettled(oTable, 120);
                const len = ob.getLength();
                let did = false;
                for (let i = 0; i < len; i++) {
                    const obj = ob.getContextByIndex(i)?.getObject?.();
                    if (!obj) continue;
                    const id = (obj.Node != null) ? String(obj.Node) : (obj.NodeID != null) ? String(obj.NodeID) : null;
                    if (id && set.has(id)) {
                        const ds = String(obj.DrillState || "").toLowerCase();
                        if (ds !== "leaf") {
                            try { oTable.collapse(i); did = true; } catch (e) { }
                        }
                    }
                }
                if (!did) break;
            }
        },
        _loadGLAll: async function (force = false) {
            if (!force && this._glAllLoaded && this._glAllData) return this._glAllData;

            const primary = this.getView().getModel(); // 기준 OData V2
            const waitMeta = () => new Promise(res => {
                if (primary.getServiceMetadata()) return res();
                primary.attachMetadataLoaded(res);
            });
            await waitMeta();

            const meta = primary.getServiceMetadata();
            const hasSet = (name) => {
                try { return !!meta.dataServices.schema[0].entityContainer[0].entitySet.find(s => s.name === name); }
                catch { return false; }
            };

            const uniqSort = (arr) => {
                const seen = new Set(), out = [];
                for (const r of (arr || [])) {
                    if (!r.GLAccount) continue;
                    if (seen.has(r.GLAccount)) continue;
                    seen.add(r.GLAccount);
                    out.push({ GLAccount: r.GLAccount, GLAccountLongName: r.GLAccountLongName || r.GLAccountText || r.GLAccount });
                }
                out.sort((a, b) => (a.GLAccount > b.GLAccount ? 1 : -1));
                return out;
            };

            const readPaged = (path, urlParameters) => new Promise((resolve, reject) => {
                const acc = []; const step = (skiptoken) => {
                    const params = Object.assign({}, urlParameters);
                    if (skiptoken) params.$skiptoken = skiptoken;
                    primary.read(path, {
                        urlParameters: params,
                        success: d => {
                            const rows = d?.results || []; acc.push(...rows);
                            const next = d && d.__next ? decodeURIComponent((d.__next.match(/[?&]\$skiptoken=([^&]+)/) || [])[1] || "") : null;
                            if (next) step(next); else resolve(acc);
                        },
                        error: reject
                    });
                };
                step(null);
            });

            // ① 마스터 텍스트가 있으면 그걸로 (BS/PL 전계정)
            if (hasSet("I_GLAccountText")) {
                try {
                    const lang = (sap.ui.getCore().getConfiguration().getLanguage() || "EN").toUpperCase().slice(0, 2);
                    const rows = await readPaged("/I_GLAccountText", {
                        "$select": "GLAccount,GLAccountLongName",
                        "$filter": `ChartOfAccounts eq 'YCOA' and Language eq '${lang}'`,
                        "$orderby": "GLAccount",
                        "$top": "20000"
                    });
                    const list = uniqSort(rows);
                    if (list.length) { this._glAllData = list; this._glAllLoaded = true; return list; }
                } catch { }
            }

            // ② 보고서 엔티티에서 평면으로 추출 (트리 아님 → HierarchyLevel=1 같은 필터 없음)
            const baseFilters = this._getTableFilter(); // P_*
            const readFS = async (extraParams = {}) => new Promise((resolve, reject) => {
                primary.read("/FinancialStatements", {
                    filters: baseFilters.concat([new sap.ui.model.Filter("GlAccount", sap.ui.model.FilterOperator.NE, "")]),
                    urlParameters: Object.assign({
                        "$select": "GlAccount,GlAccountText",
                        "$top": "50000"
                    }, extraParams),
                    success: d => resolve(d?.results || []),
                    error: reject
                });
            });
            try {
                let rows = await readFS();
                let list = uniqSort(rows);
                // PL이 하나도 없으면(계정 첫자리 4/5/6/7/8 없음) 한 번 더 시도
                const hasPL = list.some(x => /^[45678]/.test(String(x.GLAccount)));
                if (!hasPL) {
                    try {
                        rows = await readFS({ "LP_NODETEXT": "PL" }); // 백이 무시해도 문제 없음
                        list = uniqSort(list.concat(rows));
                    } catch { }
                }
                if (list.length) { this._glAllData = list; this._glAllLoaded = true; return list; }
            } catch { }

            try {
                const oTable = this.byId("T_Main"); const ob = oTable?.getBinding("rows");
                if (oTable && ob) {
                    try { oTable.expandToLevel(99); } catch { }
                    await this._expandAllDeep(oTable, 40);
                    await this._waitRowsSettled(oTable, 220);
                    const ctxs = ob.getContexts(0, ob.getLength());
                    const harvested = uniqSort(ctxs.map(c => c?.getObject?.()).map(o => ({ GLAccount: o?.GlAccount, GLAccountLongName: o?.GlAccountText })));
                    if (harvested.length) { this._glAllData = harvested; this._glAllLoaded = true; return harvested; }
                }
            } catch { }

            this._glAllData = []; this._glAllLoaded = true;
            return [];
        },
        // 화면에서 직접 수집 (BS/PL 전부)
        _harvestGLFromTable: async function () {
            const oTable = this.byId("T_Main"); const ob = oTable?.getBinding("rows");
            if (!oTable || !ob) return [];
            try { oTable.expandToLevel(99); } catch { }
            await this._expandAllDeep(oTable, 40);
            await this._waitRowsSettled(oTable, 220);
            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            const seen = new Set(); const out = [];
            for (const c of ctxs) {
                const o = c?.getObject?.(); if (!o) continue;
                const k = o.GlAccount; const nm = o.GlAccountText;
                if (k && !seen.has(k)) { seen.add(k); out.push({ GLAccount: k, GLAccountLongName: nm || k }); }
            }
            out.sort((a, b) => (a.GLAccount > b.GLAccount ? 1 : -1));
            return out;
        },

        // 중복 제거 헬퍼 함수 추가
        _removeDuplicates: function (array, key) {
            const seen = new Set();
            return array.filter(item => {
                const value = item[key];
                if (seen.has(value)) {
                    return false;
                }
                seen.add(value);
                return true;
            });
        },

        _getGLAllMap: function () {
            const items = this.getView().getModel("GLALL")?.getProperty("/items") || [];
            const m = new Map();
            items.forEach(it => m.set(String(it.GLAccount), String(it.GLAccountLongName || it.GLAccount)));
            return m;
        },
        _makeGLAccountSorters: function () {
            const cmp = (a, b) => {
                const A = String(a || ""); const B = String(b || "");
                const fa = /^\d/.test(A) ? +A[0] : 99;
                const fb = /^\d/.test(B) ? +B[0] : 99;
                if (fa !== fb) return fa - fb;
                const na = parseInt(A.replace(/\D/g, ""), 10);
                const nb = parseInt(B.replace(/\D/g, ""), 10);
                if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
                return A.localeCompare(B);
            };
            return [new sap.ui.model.Sorter("GLAccount", false, null, cmp)];
        },
        _restoreGlAccountSelectionNow: function () {
            const oList = this.byId("L_GlAccount");
            const b = oList && oList.getBinding("items");
            if (!oList || !b) return;

            const keys = this._getGLSelectedKeys();
            if (!keys.size) return;

            (oList.getItems() || []).forEach(item => {
                const ctx = item.getBindingContext("GLALL");
                const gl = ctx && ctx.getProperty("GLAccount");
                if (gl && keys.has(String(gl))) {
                    oList.setSelectedItem(item, true /* suppress event */);
                }
            });
        },
        _syncGlTokensFromSel: function () {
            const oList = this.byId("L_GlAccount");
            const oMI = this.byId("MI_GlAccountSelected");
            if (!oList || !oMI) return;

            const map = this._getGLAllMap();
            const keys = [...this._glSelKeys];
            oMI.setTokens(keys.map(k => new sap.m.Token({
                key: k,
                text: `${map.get(k) || k} (${k})`
            })));
        },
        // ✅ 공통: 안전하게 컨테이너 닫기
        _safeClose: function (src) {
            // 버튼 → Toolbar → Popover/Dialog 순으로 parent를 타고 올라가 close() 찾기
            let p = src;
            while (p && !p.close && p.getParent) p = p.getParent();
            if (p && typeof p.close === "function") {
                try { p.close(); } catch (e) { }
            } else {
                // 혹시 못 찾았으면 아이디로도 시도
                this.byId("M_GlAccount")?.close?.();
                this.byId("M_GlAccountText")?.close?.();
            }
        },

        // // GL 계정 OK
        // onGlAccountMenuConfirm: function (e) {
        //     try {
        //         // 스테이징을 커밋하고 그때만 필터 적용
        //         this._setGLKeys(new Set(this._glStage || []), "gl-ok");
        //     } finally {
        //         this._menuOpen = false;
        //         this._glStage = null;
        //         this.byId("M_GlAccount")?.close();
        //     }
        // },

        // onColumnMenuConfirm: function (e) {
        //     try {
        //         this._setGLKeys(new Set(this._glStage || []), "gltext-ok");
        //     } finally {
        //         this._menuOpen = false;
        //         this._glStage = null;
        //         this.byId("M_GlAccountText")?.close();
        //     }
        // },
       onGlAccountMenuConfirm: function () {
  try {
    const keys = Array.from(this._glStage || new Set(this._getStageKeysFromModel()));
    this._setGLKeys(keys, "menu-ok");        // ★ 여기서만 필터 적용
  } finally {
    this.byId("M_GlAccount")?.close();
    this._menuOpen = false;
  }
},

onColumnMenuConfirm: function () {
  try {
    const keys = Array.from(this._glStage || new Set(this._getStageKeysFromModel()));
    this._setGLKeys(keys, "menu-ok");
  } finally {
    this.byId("M_GlAccountText")?.close();
    this._menuOpen = false;
  }
},

        onGlAccountMenuCancel: function () {
            // 버리기(필터 미적용)
            this._menuOpen = false;
            this._glStage = null;
            this.byId("M_GlAccount")?.close();
        },
        onColumnMenuCancel: function () {
            this._menuOpen = false;
            this._glStage = null;
            this.byId("M_GlAccountText")?.close();
        },

        // "Reset" 버튼도 OK 전까지는 미적용(스테이징만 클리어)
        onGlAccountMenuReset: function () {
            if (this._menuOpen) {
                this._glStage = new Set();
                this._previewTokensFromSet(this._glStage);
                this.byId("L_GlAccount")?.removeSelections(true);
                sap.m.MessageToast.show("선택이 초기화되었습니다. OK를 눌러 적용하세요.");
                return;
            }
            // (메뉴 밖이라면 즉시 커밋 초기화가 맞다면 아래 사용)
            this._setGLKeys(new Set(), "gl-reset-outside");
        },
        onGlAccountTextMenuReset: function () {
            if (this._menuOpen) {
                this._glStage = new Set();
                this._previewTokensFromSet(this._glStage);
                this.byId("L_GlAccountText")?.removeSelections(true);
                sap.m.MessageToast.show("선택이 초기화되었습니다. OK를 눌러 적용하세요.");
                return;
            }
            this._setGLKeys(new Set(), "gltext-reset-outside");
        },

        // ========================================================================
        // GL ACCOUNT TEXT FILTER FUNCTIONS (Updated)
        // ========================================================================

        // GlAccountText: 토큰 + 메모리 합쳐 키셋
        _getGLTextSelectedKeys: function () {
            const keys = new Set();
            (this._glTextSelKeys || new Set()).forEach(k => keys.add(String(k)));
            const mi = this.byId("MI_GlAccountTextSelected");
            (mi?.getTokens?.() || []).forEach(t => keys.add(String(t.getKey())));
            return keys;
        },

        // GlAccountText: 현재 리스트에 선택 복원
        _restoreGlAccountTextSelectionNow: function () {
            const oList = this.byId("L_GlAccountText");
            const b = oList && oList.getBinding("items");
            if (!oList || !b) return;

            const keys = this._getGLTextSelectedKeys();
            if (!keys.size) return;

            (oList.getItems() || []).forEach(item => {
                const ctx = item.getBindingContext("GLALL");
                const gl = ctx && ctx.getProperty("GLAccount");
                if (gl && keys.has(String(gl))) {
                    oList.setSelectedItem(item, true);
                }
            });
        },
        onGlAccountSelectionChange: function (ev) {
            if (!this._menuOpen) return;               // 메뉴 밖이면 무시(OK로만 커밋)
            const keys = new Set(
                (ev.getSource().getSelectedItems() || [])
                    .map(it => it.getBindingContext("GLALL")?.getProperty("GLAccount"))
                    .filter(Boolean).map(String)
            );
            this._glStage = keys;
            this._previewTokensFromSet(this._glStage);
        },

        onGlAccountTextSelectionChange: function (ev) {
            if (!this._menuOpen) return;
            const keys = new Set(
                (ev.getSource().getSelectedItems() || [])
                    .map(it => it.getBindingContext("GLALL")?.getProperty("GLAccount"))
                    .filter(Boolean).map(String)
            );
            this._glStage = keys;
            this._previewTokensFromSet(this._glStage);
        },




        _syncGlTextTokensFromSel: function () {
            const oList = this.byId("L_GlAccountText");
            const oMI = this.byId("MI_GlAccountTextSelected");
            if (!oList || !oMI) return;

            const map = this._getGLAllMap();
            const keys = [...this._glTextSelKeys];
            oMI.setTokens(keys.map(k => new sap.m.Token({
                key: k,
                text: `${map.get(k) || k} (${k})`
            })));
        },
        _updateGlAccountTokens: function () {
            const list = this.byId("L_GlAccount");
            const mi = this.byId("MI_GlAccountSelected");
            if (!list || !mi) return;

            const tokens = (list.getSelectedItems() || []).map(it => {
                const ctx = it.getBindingContext("GLALL");
                const k = ctx.getProperty("GLAccount");
                const n = ctx.getProperty("GLAccountLongName");
                return new sap.m.Token({ key: k, text: `${n} (${k})` });
            });
            mi.setTokens(tokens);
        },
        _updateGlAccountTextTokens: function () {
            const list = this.byId("L_GlAccountText");
            const mi = this.byId("MI_GlAccountTextSelected");
            if (!list || !mi) return;

            const tokens = (list.getSelectedItems() || []).map(it => {
                const ctx = it.getBindingContext("GLALL");
                const k = ctx.getProperty("GLAccount");
                const n = ctx.getProperty("GLAccountLongName");
                return new sap.m.Token({ key: k, text: `${n} (${k})` });
            });
            mi.setTokens(tokens);
        },
        onGlAccountTextTokenDelete: function (oEvent) {
            const sKey = oEvent.getParameter("key");

            // 리스트에서 해당 항목 찾아서 선택 해제
            const oList = this.byId("L_GlAccountText");
            if (oList) {
                const aListItems = oList.getItems();
                aListItems.forEach(item => {
                    const ctx = item.getBindingContext("GLALL");
                    if (ctx && ctx.getProperty("GLAccount") === sKey) {
                        oList.setSelectedItem(item, false);
                    }
                });
            }

            // 토큰 업데이트
            this._updateGlAccountTextTokens();

            console.log("GlAccountText token deleted:", sKey);
        },

        // 파이프라인 값을 실제 sap.ui.model.Filter[]로 변환
        _buildFilterForValueWithType: function (path, csv) {
            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
            if (!csv) return [];

            const arr = String(csv).split(",").map(s => s.trim()).filter(Boolean);
            if (!arr.length) return [];

            if (path === "GlAccount") {
                return [new Filter({ and: false, filters: arr.map(v => new Filter("GlAccount", OP.EQ, v)) })];
            }
            if (path === "GlAccountText") {
                return [new Filter({ and: false, filters: arr.map(v => new Filter("GlAccountText", OP.Contains, v)) })];
            }
            // 그 외 컬럼 타입은 필요시 추가
            return [];
        },

        _applyTableFilters: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            const aColFilters = Object.entries(this._colFilters || {})
                .map(([path, val]) => this._buildFilterForValueWithType(path, val))
                .flat();

            ob.filter(aBase.concat(aSearch, aColFilters), sap.ui.model.FilterType.Application);

            // 필터 후 색/하이라이트 재적용
            setTimeout(() => {
                this._applyGroupRowColors?.();
                this._refreshRowHighlights?.();
            }, 0);
        },
        onGlAccountMenuSearch: function (ev) {
            const q = (ev.getParameter("newValue") || "").trim();
            const b = this.byId("L_GlAccount")?.getBinding("items");
            if (!b) return;
            b.filter(q ? new sap.ui.model.Filter({
                and: false,
                filters: [
                    new sap.ui.model.Filter("GLAccount", sap.ui.model.FilterOperator.Contains, q),
                    new sap.ui.model.Filter("GLAccountLongName", sap.ui.model.FilterOperator.Contains, q),
                ]
            }) : []);
            // 필터 후 현재 스테이징에 맞춰 UI 선택 복원
            setTimeout(() => this._restoreSelectionsFromSet("L_GlAccount", this._glStage || new Set()), 0);
        },



        // ========================================================================
        // TABLE SEARCH UX (inline search + scoped navigation)
        // ========================================================================
        onTableSearch: async function (oEventOrString) {
            const q = (typeof oEventOrString === "string" ? oEventOrString : (oEventOrString.getParameter("query") || "")).trim();
            if (!q) {
                sap.m.MessageToast.show(this.i18n.getText("toast.enterQuery") || "검색어를 입력하세요.");
                this._searchState = { q: "", hits: [], pos: -1 };
                this._refreshRowHighlights();
                return;
            }

            this._searchState = this._searchState || { q: "", hits: [], pos: -1 };

            if (this._searchState.q !== q || !this._searchState.hits.length) {
                this._searchState.q = q;
                await this._ensureFullyExpandedAndCollectHits(q);
                this._searchState.pos = 0;
                if (!this._searchState.hits || !this._searchState.hits.length) {
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                    this._refreshRowHighlights();
                    return;
                }
            } else {
                const N = this._searchState.hits.length;
                if (!N) { sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다."); this._refreshRowHighlights(); return; }
                this._searchState.pos = (this._searchState.pos + 1) % N;
            }

            this._scrollToActiveHit();
            this._refreshRowHighlights();
            const n = (this._searchState.pos + 1), N = this._searchState.hits.length;
            if (N) sap.m.MessageToast.show(`${n} / ${N} ${this.i18n.getText("toast.matchProgressSuffix") || "매칭"}`);
        },
        onOpenGlTextFilterMenu: function (oEvent) {
            if (!this._glTextPop) {
                // Popover 내용: SearchField + List(oGLAccountVh)
                this._glTextPop = new sap.m.Popover({
                    title: this.i18n.getText("FilterGlAccountText") || "Filter: G/L 내역",
                    contentWidth: "28rem",
                    contentHeight: "36rem",
                    content: [
                        new sap.m.VBox({
                            width: "100%",
                            items: [
                                new sap.m.SearchField(this.createId("GLVH_Search"), {
                                    width: "100%",
                                    liveChange: this.onGLVHSearchChanged.bind(this),
                                    placeholder: "Search G/L (code or name)"
                                }),
                                new sap.m.List(this.createId("L_GLaccountFilterList"), {
                                    mode: sap.m.ListMode.MultiSelect,
                                    includeItemInSelection: true,
                                    growing: true,
                                    growingThreshold: 120,
                                    items: {
                                        path: "oGLAccountVh>/",
                                        template: new sap.m.StandardListItem({
                                            title: "{oGLAccountVh>GLAccountLongName}",
                                            description: "{oGLAccountVh>GLAccount}"
                                        })
                                    }
                                })
                            ]
                        })
                    ],
                    footer: new sap.m.Toolbar({
                        content: [
                            new sap.m.ToolbarSpacer(),
                            new sap.m.Button({ text: this.i18n.getText("Cancel") || "Cancel", press: () => this._glTextPop.close() }),
                            new sap.m.Button({
                                text: "OK",
                                type: "Emphasized",
                                press: this.onApplyGlTextFilter.bind(this)
                            })
                        ]
                    })
                });
                this.getView().addDependent(this._glTextPop);
            }

            // 메뉴에서 열린 위치 기준으로 Popover 오픈
            const src = oEvent.getSource();
            const domRef = src.getDomRef && src.getDomRef();
            this._glTextPop.openBy(domRef || src);
        },

        onGLVHSearchChanged: function (oEvent) {
            const sQuery = (oEvent.getParameter("newValue") || "").trim();
            const oList = this.byId("L_GLaccountFilterList");
            const oBinding = oList && oList.getBinding("items");
            if (!oBinding) return;

            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
            if (!sQuery) {
                oBinding.filter([]);
                return;
            }
            oBinding.filter([
                new Filter({
                    and: false,
                    filters: [
                        new Filter("GLAccount", OP.Contains, sQuery),
                        new Filter("GLAccountLongName", OP.Contains, sQuery)
                    ]
                })
            ]);
        },

        onApplyGlTextFilter: function () {
            const oList = this.byId("L_GLaccountFilterList");
            const sel = oList ? (oList.getSelectedItems() || []) : [];
            const names = sel
                .map(it => it.getBindingContext("oGLAccountVh").getProperty("GLAccountLongName"))
                .filter(Boolean);

            // 기존 파이프라인(_colFilters → _applyTableFilters) 활용
            this._colFilters = this._colFilters || {};
            if (names.length) {
                // GlAccountText 에 대해 Contains OR (콤마 구분 → 내부 로직에서 OR 변환)
                this._colFilters["GlAccountText"] = names.join(",");
            } else {
                delete this._colFilters["GlAccountText"];
            }

            this._applyTableFilters();
            this._glTextPop.close();
        },
        onResetGlTextFilter: function () {
            this._colFilters = this._colFilters || {};
            delete this._colFilters["GlAccountText"];
            this._applyTableFilters();

            // 리스트 선택 초기화
            const oList = this.byId("L_GlAccountText");
            if (oList) {
                oList.removeSelections(true);
            }

            sap.m.MessageToast.show("G/L 계정 필터가 초기화되었습니다.");
        },
        jumpToQuery: async function (sQuery, options) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) { sap.m.MessageToast.show(this.i18n.getText("toast.runSearchFirst") || "먼저 조회를 실행하세요."); return; }

            const qRaw = (sQuery || "").trim();
            if (!qRaw) { sap.m.MessageToast.show(this.i18n.getText("toast.enterQuery") || "검색어를 입력하세요."); return; }

            if (oTable.getSelectionMode() !== sap.ui.table.SelectionMode.Single) oTable.setSelectionMode(sap.ui.table.SelectionMode.Single);
            oTable.clearSelection();

            const focusCol = (options && options.focusCol) || 0;
            const range = this._getSelectedSubtreeRange();

            if (!this._searchState || this._searchState.q !== qRaw) {
                this._searchState = { q: qRaw, hits: [], pos: -1 };
                await this._ensureFullyExpandedAndCollectHits(qRaw);
                let hits = this._searchState.hits;
                if (!hits || !hits.length) { sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다."); return; }

                if (range) {
                    const [s, e] = range;
                    await this._waitBindingStableOnce(160);
                    hits = hits.filter(h => { const i = this._indexOfHitInBinding(h); return i >= s && i < e; });
                    if (!hits.length) { sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다."); return; }
                }

                this._searchState.hits = hits;
                this._searchState.pos = 0;

                await this._waitBindingStableOnce(180);
                let idx = this._indexOfHitInBinding(hits[0]);
                if (idx < 0) {
                    if (typeof this._expandPathAndRetry === "function") await this._expandPathAndRetry(hits[0]);
                    else { try { oTable.expandToLevel(99); } catch (e) { /*noop*/ } }
                    await this._waitBindingStableOnce(200);
                    idx = this._indexOfHitInBinding(hits[0]);
                }
                if (idx >= 0) {
                    this._scrollSelectHighlightReliable(hits[0], focusCol);
                    sap.m.MessageToast.show(this.i18n.getText("toast.matchCount", [hits.length]) || `매칭: ${hits.length}건`);
                } else {
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                }
                return;
            }

            const hits = this._searchState.hits || [];
            if (!hits.length) { sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다."); return; }

            this._searchState.pos = (this._searchState.pos + 1) % hits.length;
            const hit = hits[this._searchState.pos];

            await this._waitBindingStableOnce(160);
            let idx = this._indexOfHitInBinding(hit);
            if (idx < 0) {
                if (typeof this._expandPathAndRetry === "function") await this._expandPathAndRetry(hit);
                else { try { oTable.expandToLevel(99); } catch (e) { /*noop*/ } }
                await this._waitBindingStableOnce(200);
                idx = this._indexOfHitInBinding(hit);
            }

            if (idx >= 0) {
                this._scrollSelectHighlightReliable(hit, focusCol);
                const n = this._searchState.pos + 1, N = hits.length;
                sap.m.MessageToast.show(`${n} / ${N} ${this.i18n.getText("toast.matchProgressSuffix") || "매칭"}`);
            } else {
                sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
            }
        },

        // collapse/expand event hooks track user state
        onCollapse: function (oEvent) {
            const oContext = oEvent.getParameter("rowContext");
            if (!oContext) return;
            const sNodeId = oContext.getProperty("Node");
            this._collapsedNodes = this._collapsedNodes || new Set();
            this._collapsedNodes.add(sNodeId);
        },

        onExpand: function (oEvent) {
            const oContext = oEvent.getParameter("rowContext");
            if (!oContext) return;
            const sNodeId = oContext.getProperty("Node");
            this._collapsedNodes = this._collapsedNodes || new Set();
            this._collapsedNodes.delete(sNodeId);
        },


        // ========================================================================
        // VALUE HELP (GLAccount)
        // ========================================================================
        onVHGL: function () {
            if (this._oVHD && this._oVHD.isOpen && this._oVHD.isOpen()) return;

            const oMultiInput = this.byId("MI_GL");
            this._oMultiInput = oMultiInput;
            this._oBasicSearchField = new SearchField();

            this.loadFragment({ name: "com.gsitm.pkg.co.zgspkgco0060/fragment/GLAccount" })
                .then(function (oDialog) {
                    const oFilterBar = oDialog.getFilterBar();
                    this._oVHD = oDialog;
                    this.getView().addDependent(oDialog);
                    oFilterBar.setFilterBarExpanded(false);
                    oFilterBar.setBasicSearch(this._oBasicSearchField);
                    this._oBasicSearchField.attachSearch(function () { oFilterBar.search(); });

                    oDialog.getTableAsync().then(function (oTable) {
                        oTable.setModel(vVHGL);
                        if (oTable.bindRows) {
                            oTable.bindAggregation("rows", { path: "/", events: { dataReceived: function () { oDialog.update(); } } });
                            oTable.addColumn(new Column({ label: new Label({ text: "{i18n>GLAccount}" }), template: new Text({ wrapping: false, text: "{GLAccount}" }) }));
                            oTable.addColumn(new Column({ label: new Label({ text: "{i18n>GLAccountName}" }), template: new Text({ wrapping: false, text: "{GLAccountName}" }) }));
                        }
                    }.bind(this));

                    oDialog.setTokens(this._oMultiInput.getTokens());
                    oDialog.open();
                }.bind(this));
        },

        onValueHelpOkPress: function (oEvent) {
            const aTokens = oEvent.getParameter("tokens");
            this._oMultiInput.setTokens(aTokens);
            this._oVHD.close();
        },
        onValueHelpCancelPress: function () { this._oVHD.close(); },
        onValueHelpAfterClose: function () { this._oVHD.destroy(); },

        onVHFBGL: function (oEvent) {
            const sSearchQueGLry = this._oBasicSearchField.getValue();
            const aSelectionSet = oEvent.getParameter("selectionSet");
            const aFilters = aSelectionSet.reduce(function (aResult, oControl) {
                if (oControl.getValue()) aResult.push(new Filter({ path: oControl.getName(), operator: FilterOperator.Contains, value1: oControl.getValue() }));
                return aResult;
            }, []);
            aFilters.push(new Filter({
                filters: [
                    new Filter({ path: "GLAccount", operator: FilterOperator.Contains, value1: sSearchQueGLry }),
                    new Filter({ path: "GLAccountName", operator: FilterOperator.Contains, value1: sSearchQueGLry })
                ],
                and: false
            }));
            this._filterTable(new Filter({ filters: aFilters, and: true }));
        },

        onLiveChange: function (oEvent) {
            const vId = oEvent.getSource().getId();
            let oMultiInput = vId.endsWith("MI_MT") ? this.byId("MI_MT") : vId.endsWith("MI_GL") ? this.byId("MI_GL") : null;
            if (!oMultiInput) return;

            const vInputValue = oEvent.getParameter("value");
            const aItems = vInputValue.split(" ");
            oMultiInput.setValue("");
            for (let i = 0; i < aItems.length; i++) {
                const vItem = aItems[i].trim();
                if (vItem) {
                    oMultiInput.addToken(new Token({ key: vItem, text: vItem }).data("range", { "exclude": false, "operation": sap.ui.comp.valuehelpdialog.ValueHelpRangeOperation.EQ, "keyField": "GLAccount", "value1": vItem, "value2": "" }));
                }
            }
            setTimeout(function () { oMultiInput.setValue(""); }, 1);
        },

        // ========================================================================
        // CROSS-APP NAVIGATION (Balance / Line Items)
        // ========================================================================
        onPeriodBalancePress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) return;
            const { GlAccount: glAccount, CompanyCode: companyCode = "4310" } = oCtx.getObject() || {};
            if (!glAccount) { sap.m.MessageToast.show(this.i18n.getText("noGLAccount")); return; }

            // Prior period
            const year = this._getTokenVal("MI_PriorYear");
            const fromM = this._getTokenVal("MI_PriorStartMonth");
            const toM = this._getTokenVal("MI_PriorEndMonth");
            const expand = (a, b) => Array.from({ length: Math.abs(+b - +a) + 1 }, (_, i) => String(Math.min(+a, +b) + i).padStart(3, "0"));
            const periods = expand(fromM, toM);

            const sheet = new sap.m.ActionSheet({
                showCancelButton: true,
                buttons: [
                    new sap.m.Button({ text: this.i18n.getText("action.glBalance"), press: () => this._navigateToGLBalance(glAccount, companyCode, fromM, toM, year) }),
                    new sap.m.Button({ text: this.i18n.getText("action.jeItems"), press: () => this._navigateToJournalEntry(glAccount, companyCode, year, periods) })
                ]
            });
            this.getView().addDependent(sheet);
            sheet.openBy(oEvent.getSource());
        },

        onComparisonBalance: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) return;
            const { GlAccount: glAccount, CompanyCode: companyCode = "4310" } = oCtx.getObject() || {};
            if (!glAccount) { sap.m.MessageToast.show(this.i18n.getText("noGLAccount")); return; }

            // Current period
            const year = this._getTokenVal("MI_CurrentYear");
            const fromM = this._getTokenVal("MI_CurrentStartMonth");
            const toM = this._getTokenVal("MI_CurrentEndMonth");
            const expand = (a, b) => Array.from({ length: Math.abs(+b - +a) + 1 }, (_, i) => String(Math.min(+a, +b) + i).padStart(3, "0"));
            const periods = expand(fromM, toM);

            const sheet = new sap.m.ActionSheet({
                showCancelButton: true,
                buttons: [
                    new sap.m.Button({ text: "G/L 계정 잔액조회", press: () => this._navigateToGLBalance(glAccount, companyCode, fromM, toM, year) }),
                    new sap.m.Button({ text: "총계정원장에서 개별 항목 조회", press: () => this._navigateToJournalEntry(glAccount, companyCode, year, periods) })
                ]
            });
            this.getView().addDependent(sheet);
            sheet.openBy(oEvent.getSource());
        },

        onColumnFilter: function (oEvent) {
            const oColumn = oEvent.getParameter("column");
            const sValue = (oEvent.getParameter("value") || "").trim();
            const sPath = oColumn && oColumn.getFilterProperty && oColumn.getFilterProperty();
            if (!sPath) return;

            // 누적 컬럼필터 캐시 갱신
            this._colFilters = this._colFilters || {};
            if (sValue) {
                this._colFilters[sPath] = sValue;
            } else {
                delete this._colFilters[sPath];
            }

            // 실제 필터 적용은 공통 함수로
            this._applyTableFilters();
        },




        _buildFilterForValue: function (sPath, sRaw) {
            const Filter = sap.ui.model.Filter;
            const OP = sap.ui.model.FilterOperator;
            const s = (sRaw || "").trim();

            // 다중값 OR: 1000,2000,3000
            if (s.includes(",")) {
                const parts = s.split(",").map(v => v.trim()).filter(Boolean);
                if (parts.length) return [new Filter({ and: false, filters: parts.map(v => new Filter(sPath, OP.EQ, v)) })];
            }
            // 범위: 10..100
            const m = s.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
            if (m) return [new Filter(sPath, OP.BT, parseFloat(m[1]), parseFloat(m[2]))];

            // 비교: >10, <=0
            const cmp = s.match(/^(<=|>=|<|>)(-?\d+(?:\.\d+)?)$/);
            if (cmp) {
                const map = { ">": OP.GT, "<": OP.LT, ">=": OP.GE, "<=": OP.LE };
                return [new Filter(sPath, map[cmp[1]], parseFloat(cmp[2]))];
            }

            // 정확히: =ABC
            if (s.startsWith("=")) return [new Filter(sPath, OP.EQ, s.slice(1))];
            // 시작/끝: ^ABC / ABC$
            if (s.startsWith("^")) return [new Filter(sPath, OP.StartsWith, s.slice(1))];
            if (s.endsWith("$")) return [new Filter(sPath, OP.EndsWith, s.slice(0, -1))];

            // 기본: Contains
            return [new Filter(sPath, OP.Contains, s)];
        },

        // (옵션) 프로그램에서 전체 컬럼필터 초기화하고 싶을 때 호출
        _resetColumnFilters: function () {
            this._colFilters = {};
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);
            ob.filter(aBase.concat(aSearch), sap.ui.model.FilterType.Application);
        },
        // ========================================================================
        // TABLE BINDING & ODATA EVENTS
        // ========================================================================
        _bindTable: function (oTable) {
            if (!oTable) return;

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            oTable.bindRows({
                path: "/FinancialStatements",
                filters: aBase.concat(aSearch),  // ← 여기서만 합치면 됨
                parameters: {
                    countMode: "Inline",
                    operationMode: "Server",
                    threshold: 25,
                    treeAnnotationProperties: {
                        hierarchyLevelFor: "HierarchyLevel",
                        hierarchyNodeFor: "Node",
                        hierarchyParentNodeFor: "ParentNodeID",
                        hierarchyDrillStateFor: "DrillState"
                    },
                    rootLevel: 1
                },
                events: {
                    dataRequested: this._onTreeTableRequested.bind(this),
                    dataReceived: this._onTreeTableReceived.bind(this)
                }
            });
        },


        _onTreeTableRequested: function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;
            oTable.setBusy(true);
        },
        _onTreeTableReceived: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            oTable.setBusy(true);

            // 1) st.tree || st 로 안전하게 꺼내기
            const raw = this._restoreStateFromBookmark || null;
            const st = raw && (raw.tree || raw);   // <-- 핵심 수정


            // ($filter 지연 적용 시 재적용)
            if (this._deferApplyTableFilters) {
                this._deferApplyTableFilters = false;
                const aBase = this._getTableFilter();
                const aSearch = this._buildSearchFilters(this._lastTableQuery);
                const aCols = Object.entries(this._colFilters || {})
                    .map(([p, v]) => this._buildFilterForValueWithType(p, v))
                    .flat();
                oBinding.filter(aBase.concat(aSearch, aCols), sap.ui.model.FilterType.Application);
                await this._waitRowsSettled(oTable, 180);
            }
            // 필터가 적용된 "최종 데이터" 기준으로 트리 상태 복원
            if (!this._bInitialExpandDone) {
                this._bInitialExpandDone = true;

                if (st) {
                    // (1) expandLevel
                    if (Number.isInteger(st.expandLevel) && st.expandLevel > 0) {
                        try { oTable.expandToLevel(st.expandLevel); } catch (e) { }
                        await this._waitRowsSettled(oTable, 180);
                    }
                    // (2) expandedNodes
                    if (Array.isArray(st.expandedNodes) && st.expandedNodes.length) {
                        await this._expandNodesByIdWithParents(st.expandedNodes);
                        await this._waitRowsSettled(oTable, 120);
                    }
                    // (3) collapsedNodes
                    if (Array.isArray(st.collapsedNodes) && st.collapsedNodes.length) {
                        await this._collapseNodesById(st.collapsedNodes);
                        await this._waitRowsSettled(oTable, 120);
                    }
                    this._maxExpandLevel = this._getMaxLevelFromBinding();
                    this._curExpandLevel = this._getVisibleMaxLevel();
                } else {
                    // 북마크가 없을 때 기본 전체 펼침
                    try { oTable.expandToLevel(99); } catch (e) { }
                    await this._expandAllDeep(oTable, 30);
                    await this._waitRowsSettled(oTable, 200);
                    this._maxExpandLevel = this._getMaxLevelFromBinding();
                    this._curExpandLevel = this._maxExpandLevel;
                }
            }
            // 선택/스크롤 복원
            if (st) {
                if (st.selectedNodeId != null) this._selectRowByNodeId(st.selectedNodeId);
                if (Number.isFinite(st.firstVisibleRow)) {
                    oTable.setFirstVisibleRow(Math.max(0, st.firstVisibleRow | 0));
                }
            }

            // 일회성 상태 제거
            this._restoreStateFromBookmark = null;

            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },
        _pinPrimaryColumn: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;

            // 1) '내역' 컬럼 객체 찾기 (ID 우선, 없으면 바인딩경로로 탐색)
            let col =
                this.byId("COL_NodeText") ||
                (oTable.getColumns().find(c => {
                    const p =
                        (c.getFilterProperty && c.getFilterProperty()) ||
                        (c.getSortProperty && c.getSortProperty());
                    if (p) return p === "NodeText";
                    try {
                        const t = c.getTemplate && c.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value")));
                        return b && b.getPath && b.getPath() === "NodeText";
                    } catch (e) { return false; }
                }) || null);

            if (!col) return;

            // 2) 맨 앞으로 이동
            try {
                oTable.removeColumn(col);
                oTable.insertColumn(col, 0);
            } catch (e) { /* noop */ }

            // 3) 첫 컬럼 고정 (필요 시 숫자 늘리기)
            try {
                if ((oTable.getFixedColumnCount && oTable.getFixedColumnCount() < 1) ||
                    !oTable.getFixedColumnCount) {
                    oTable.setFixedColumnCount(1);
                }
            } catch (e) { /* noop */ }
        },

        _applyColumnLayout: function (layout = []) {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable || !Array.isArray(layout) || !layout.length) return;

            const inferProp = (col) => {
                let prop = (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!prop) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { }
                }
                if (!prop) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }
                return prop;
            };

            const allCols = oTable.getColumns ? oTable.getColumns() : [];
            const map = {};
            allCols.forEach(c => { const p = inferProp(c); if (p) map[p] = c; });

            // 1) 가시성/폭 먼저 세팅 (비가시 컬럼도 순서 반영을 위해 객체는 유지)
            layout.forEach((ent) => {
                const c = map[ent.prop];
                if (!c) return;
                if (typeof ent.visible === "boolean" && c.getVisible && c.setVisible) c.setVisible(!!ent.visible);
                if (ent.width && c.setWidth) { try { c.setWidth(ent.width); } catch (e) { } }
            });

            // 2) 순서 재배치: layout 순서대로 이동
            //    (UI5는 moveColumn이 없으면 remove→insert 조합 사용)
            let idx = 0;
            layout.forEach((ent) => {
                const c = map[ent.prop];
                if (!c) return;
                try {
                    oTable.removeColumn(c);
                    oTable.insertColumn(c, idx);
                    idx++;
                } catch (e) { }
            });

            // 3) layout에 없던 컬럼은 뒤로 밀어 배치 유지
            allCols.forEach((c) => {
                const p = inferProp(c);
                if (!p) return;
                if (!layout.some(ent => ent.prop === p)) {
                    try {
                        oTable.removeColumn(c);
                        oTable.insertColumn(c, idx++);
                    } catch (e) { }
                }
            });

            // 컬럼 인덱스 맵/집계색 재적용
            this._refreshColumnIndexMap?.();
            this._applyGroupRowColors?.();
        },

        _expandNodesByIdWithParents: async function (ids = []) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob || !ids.length) return;

            // 중복 제거
            const targets = Array.from(new Set(ids.map(String)));

            // 이미 처리한 노드 캐시
            const expandedSet = new Set();

            // 각 노드의 부모 경로를 서버에서 역산 → 차례대로 expand
            for (const id of targets) {
                try {
                    const pathIds = await this._serverBuildPath(id); // [root,...,id]
                    for (const nodeId of pathIds) {
                        const key = String(nodeId);
                        if (expandedSet.has(key)) continue;
                        // 바인딩에서 인덱스 찾기
                        let idx = -1;
                        const len = ob.getLength();
                        for (let i = 0; i < len; i++) {
                            const o = ob.getContextByIndex(i)?.getObject?.();
                            if (!o) continue;
                            const cur = (o.Node != null) ? String(o.Node) : (o.NodeID != null) ? String(o.NodeID) : null;
                            if (cur === key) { idx = i; break; }
                        }
                        if (idx >= 0) {
                            try { oTable.expand(idx); } catch (e) { }
                            await this._waitRowsSettled(oTable, 140);
                            expandedSet.add(key);
                        }
                    }
                } catch (e) {
                    // 개별 노드 실패는 전체 흐름 막지 않음
                }
            }
        },

        _selectRowByNodeId: function (nodeId) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob || nodeId == null) return;

            const want = String(nodeId);
            const len = ob.getLength();
            for (let i = 0; i < len; i++) {
                const o = ob.getContextByIndex(i)?.getObject?.();
                if (!o) continue;
                const cur = (o.Node != null) ? String(o.Node) : (o.NodeID != null) ? String(o.NodeID) : null;
                if (cur === want) {
                    try {
                        oTable.setSelectedIndex(i);
                        this._lastRowIndex = i;
                        const half = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
                        oTable.setFirstVisibleRow(Math.max(0, i - half));
                    } catch (e) { }
                    break;
                }
            }
        },

        _applyColumnWidths: function (widthMap = {}) {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable || !widthMap) return;

            const inferProp = (col) => {
                let prop =
                    (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!prop) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { }
                }
                if (!prop) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }
                return prop;
            };

            (oTable.getColumns?.() || []).forEach(c => {
                const p = inferProp(c);
                if (!p) return;
                const w = widthMap[p];
                if (w) { try { c.setWidth(w); } catch (e) { } }
            });
        },

        // ComboBox busy feedback (kept as-is)
        _onCBCompanyRequested: function () { const oCB = this.byId(Control.ComboBox.CB_CompanyCode); if (oCB) oCB.setBusy(true); },
        _onCBCompanyReceived: function () { const oCB = this.byId(Control.ComboBox.CB_CompanyCode); if (oCB) oCB.setBusy(false); },

        // ========================================================================
        // FILTERS & LABELS
        // ========================================================================
        _getTableFilter: function () {
            const oSearch = this.getView().getModel("Search").getData();
            // Prior
            const sPriorYear = this._getTokenVal("MI_PriorYear");
            const sPriorStart = this._getTokenVal("MI_PriorStartMonth");
            const sPriorEnd = this._getTokenVal("MI_PriorEndMonth");
            // Current
            const sCurrYear = this._getTokenVal("MI_CurrentYear");
            const sCurrStart = this._getTokenVal("MI_CurrentStartMonth");
            const sCurrEnd = this._getTokenVal("MI_CurrentEndMonth");

            const a = [];
            a.push(new Filter("P_SYEAR", FilterOperator.EQ, sPriorYear));
            a.push(new Filter("P_SMONTH", FilterOperator.EQ, sPriorStart));
            a.push(new Filter("P_SENDMONTH", FilterOperator.EQ, sPriorEnd));
            a.push(new Filter("P_CYEAR", FilterOperator.EQ, sCurrYear));
            a.push(new Filter("P_CMONTH", FilterOperator.EQ, sCurrStart));
            a.push(new Filter("P_CENDMONTH", FilterOperator.EQ, sCurrEnd));
            a.push(new Filter("P_COMPCD", FilterOperator.EQ, oSearch.CompanyCode.split(" ")[0]));

            if (oSearch.GL0 === true) a.push(new Filter("P_GL0", FilterOperator.EQ, true));
            return a;
        },


        _createColumnConfig: function () {
            const aCols = [];
            aCols.push({ label: this.i18n.getText("NodeText"), type: EdmType.String, property: 'NodeText', width: 30 });
            aCols.push({ label: this.i18n.getText("GlAccount"), type: EdmType.String, property: 'GlAccount', width: 12 });
            aCols.push({ label: this.i18n.getText("GlAccountText"), type: EdmType.String, property: 'GlAccountText', width: 30 });
            aCols.push({ label: this.i18n.getText("PeriodBalance"), type: EdmType.Currency, property: 'PeriodBalance', width: 20 });
            aCols.push({ label: this.i18n.getText("ComparisonBalance"), type: EdmType.Currency, property: 'ComparisonBalance', width: 20 });
            aCols.push({ label: this.i18n.getText("AbsoluteDifference"), type: EdmType.Currency, property: 'AbsoluteDifference', width: 20 });
            aCols.push({ label: this.i18n.getText("RelativeDifference"), type: EdmType.Currency, property: 'RelativeDifference', width: 20 });
            aCols.push({ label: this.i18n.getText("CompanyCodeCurrency"), type: EdmType.Currency, property: 'CompanyCodeCurrency', width: 10 });
            return aCols;
        },

        _setPeriodHeaders: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            const priorYear = this._getTokenVal("MI_PriorYear");
            const priorFrom = this._getTokenVal("MI_PriorStartMonth");
            const priorTo = this._getTokenVal("MI_PriorEndMonth");
            const currYear = this._getTokenVal("MI_CurrentYear");
            const currFrom = this._getTokenVal("MI_CurrentStartMonth");
            const currTo = this._getTokenVal("MI_CurrentEndMonth");

            const reportLabel = this._buildPeriodLabel(priorYear, priorFrom, priorTo);
            const compareLabel = this._buildPeriodLabel(currYear, currFrom, currTo);

            const colReport = this.byId("COL_PeriodBalance");
            const colCompare = this.byId("COL_ComparisonBalance");
            if (colReport && colReport.getLabel()) colReport.getLabel().setText(this.i18n.getText("PeriodBalance") + " " + reportLabel);
            if (colCompare && colCompare.getLabel()) colCompare.getLabel().setText(this.i18n.getText("ComparisonBalance") + " " + compareLabel);
        },

        // ========================================================================
        // PRINT/EXPORT HELPERS
        // ========================================================================
        _collectExportRows: function (oRowBinding) {
            const a = [];
            const nodes = (typeof oRowBinding.getNodes === "function") ? oRowBinding.getNodes() : null;
            const len = oRowBinding.getLength();
            for (let i = 0; i < len; i++) {
                const ctx = oRowBinding.getContextByIndex(i);
                if (!ctx) continue;
                const o = Object.assign({}, ctx.getObject());
                if (!("HierarchyLevel" in o)) o.HierarchyLevel = nodes && nodes[i] ? nodes[i].level : 0;
                a.push(o);
            }
            return a;
        },
        _buildPrintHTML: function ({ title, subTitleLines = [], cols, rows, colPercents = [] }) {
            const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

            // 헤더 셀
            const ths = cols.map(c =>
                `<th data-prop="${c.property}">${c.label || c.property}</th>`
            ).join("");

            // 화면 비율 그대로 사용: % 단위 colgroup (colPercents[i]가 없으면 균등 분배)
            const colgroup = cols.map((c, i) => {
                const p = (colPercents[i] != null) ? colPercents[i] : (100 / cols.length);
                return `<col style="width:${p}%">`;
            }).join("");

            // 하이라이트 적용 대상 컬럼
            const HL_COLS = new Set([
                "PeriodBalance",
                "ComparisonBalance",
                "AbsoluteDifference",
                "RelativeDifference",
                "CompanyCodeCurrency"
            ]);

            const isBSPL = (r) => (this._isBSorPLRow ? this._isBSorPLRow(r) : false);

            const anyNonZero = (r) => ["PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"]
                .some(f => {
                    const v = r && r[f];
                    const num = (typeof v === "number") ? v
                        : (typeof v === "string" ? Number(String(v).replace(/[^\d.-]/g, "")) : NaN);
                    return isFinite(num) && Math.abs(num) > 0;
                });

            // 상위(집계) 노드 + BS/PL 제외 + 금액 존재 시 하이라이트
            const rowShouldHL = (r) => (!r.GlAccount) && !isBSPL(r) && anyNonZero(r);

            const tds = (r, hlRow) => cols.map(c => {
                let v = r[c.property];
                if (v == null) v = "";

                const cellHL = (hlRow && HL_COLS.has(c.property));
                const hlStyle = cellHL
                    ? "background-color:#fff7bf !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;"
                    : "";

                // 통화
                if (c.property === "CompanyCodeCurrency") {
                    const txt = String(v).trim().toUpperCase();
                    return `<td data-prop="${c.property}" class="${cellHL ? '__hl' : ''}" style="text-align:left; ${hlStyle}">${this._escapeHTML(txt)}</td>`;
                }

                // GL 계정은 원문 그대로(숫자 포맷 금지)
                if (c.property === "GlAccount") {
                    return `<td data-prop="${c.property}" style="text-align:left;">${this._escapeHTML(String(v))}</td>`;
                }

                // NodeText 들여쓰기
                if (c.property === "NodeText") {
                    const pad = (r.HierarchyLevel || 0) * 16;
                    return `<td data-prop="${c.property}" style="text-align:left; padding-left:${pad}px;">${this._escapeHTML(String(v))}</td>`;
                }

                // 기간/비교기간 잔액(포매터)
                if (c.property === "PeriodBalance") {
                    const txt = this.formatter.currencyHideZeroForBsPl(r.PeriodBalance, r.CompanyCodeCurrency, r.NodeText);
                    return `<td data-prop="${c.property}" class="${cellHL ? '__hl' : ''}" style="text-align:right; ${hlStyle}">${this._escapeHTML(txt)}</td>`;
                }
                if (c.property === "ComparisonBalance") {
                    const txt = this.formatter.currencyHideZeroForBsPl(r.ComparisonBalance, r.CompanyCodeCurrency, r.NodeText);
                    return `<td data-prop="${c.property}" class="${cellHL ? '__hl' : ''}" style="text-align:right; ${hlStyle}">${this._escapeHTML(txt)}</td>`;
                }

                // 절대/상대 차이(포매터)
                if (c.property === "AbsoluteDifference") {
                    const txt = this.formatter.absDiffFixed2AutoScale(
                        r.AbsoluteDifference, r.CompanyCodeCurrency, r.NodeText, r.PeriodBalance, r.ComparisonBalance
                    );
                    return `<td data-prop="${c.property}" class="${cellHL ? '__hl' : ''}" style="text-align:right; ${hlStyle}">${this._escapeHTML(txt)}</td>`;
                }
                if (c.property === "RelativeDifference") {
                    const txt = this.formatter.formatAbsDiff(r.RelativeDifference, r.NodeText);
                    return `<td data-prop="${c.property}" class="${cellHL ? '__hl' : ''}" style="text-align:right; ${hlStyle}">${this._escapeHTML(txt)}</td>`;
                }

                // 그 외: 숫자이면 통일 포맷, 아니면 텍스트
                const looksNumeric =
                    (typeof v === "number" && isFinite(v)) ||
                    (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
                if (looksNumeric) {
                    return `<td data-prop="${c.property}" style="text-align:right;">${nf.format(Number(v))}</td>`;
                }
                return `<td data-prop="${c.property}" style="text-align:left;">${this._escapeHTML(String(v))}</td>`;
            }).join("");

            const trs = rows.map(r => `<tr>${tds(r, rowShouldHL(r))}</tr>`).join("");

            const sub = subTitleLines?.length
                ? `<div class="subtitle">${subTitleLines.map(this._escapeHTML).join(" · ")}</div>` : "";

            return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${this._escapeHTML(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin:0; padding:0;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif;
    color:#111;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .wrap { width:100%; }
  h1 { font-size:18px; margin:0 0 4px; }
  .subtitle { margin:0 0 12px; color:#555; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; } /* % 폭 고정 */
  thead { display: table-header-group; } /* 각 페이지마다 헤더 반복 */
  th, td { border:1px solid #ddd; padding:6px 8px; word-break:break-all; }
  th { background:#f6f7f8; text-align:center; font-weight:600; }
  tr:nth-child(even) td { background:#fafafa; }

  /* 좁은 열은 줄바꿈 최소화 */
  td[data-prop="RelativeDifference"],
  td[data-prop="CompanyCodeCurrency"],
  th[data-prop="RelativeDifference"],
  th[data-prop="CompanyCodeCurrency"] {
    white-space:nowrap;
  }

  /* 프린트 강제 컬러 유지 */
  @media print {
    td.__hl { background-color:#fff7bf !important; }
  }

  .footnote { margin-top:8px; color:#777; font-size:11px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${this._escapeHTML(title)}</h1>
  ${sub}
  <table>
    <colgroup>${colgroup}</colgroup>
    <thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <div class="footnote">Printed at ${this._escapeHTML(new Date().toLocaleString())}</div>
</div>
</body>
</html>`;
        },
        /**
         * 화면의 실제 "데이터 컬럼" 폭을 %로 환산해서 배열로 반환
         * - RowHeader/내부 컬럼 제외
         * - 숨김 컬럼 제외
         * - DOM 폭 우선(getBoundingClientRect), 없으면 getWidth() 해석(px/rem)
         */


        _getScreenColumnPercentsForCols: function (colsMeta) {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable || !Array.isArray(colsMeta) || !colsMeta.length) {
                return [];
            }

            // property 추론 (기존 로직과 동일)
            const inferProp = (col) => {
                let prop =
                    (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!prop) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { }
                }
                if (!prop) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }
                return prop;
            };

            // 화면상 실제 px 폭 얻기
            const toPx = (c) => {
                const el = c.getDomRef && c.getDomRef();
                if (el && el.getBoundingClientRect) {
                    const w = el.getBoundingClientRect().width;
                    if (w && isFinite(w)) return w;
                    // 일부 브라우저 대비
                    const cs = window.getComputedStyle(el);
                    const ww = cs && parseFloat(cs.width);
                    if (ww && isFinite(ww)) return ww;
                }
                const wStr = (c.getWidth && c.getWidth()) || "";
                if (/^\d+(\.\d+)?px$/.test(wStr)) return parseFloat(wStr);
                if (/^\d+(\.\d+)?rem$/.test(wStr)) {
                    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
                    return parseFloat(wStr) * rem;
                }
                return 100; // fallback
            };

            // 화면의 "보이는 열" → {prop: px} 맵
            const uiCols = oTable.getColumns().filter(c => c.getVisible && c.getVisible());
            const pxMap = {};
            uiCols.forEach(c => {
                const p = inferProp(c);
                if (p) pxMap[p] = toPx(c);
            });

            // colsMeta 순서에 맞춰 % 배열 산출
            const total = colsMeta.reduce((s, cm) => s + (pxMap[cm.property] || 0), 0) || 1;
            const perc = colsMeta.map(cm => {
                const px = pxMap[cm.property];
                if (!px) return Math.round((100 / colsMeta.length) * 10) / 10;
                return Math.max(1, Math.round((px / total) * 1000) / 10);
            });

            // 반올림 누적으로 100%가 어긋날 수 있으니 마지막 칸 보정
            const sum = perc.reduce((a, b) => a + b, 0);
            const diff = Math.round((100 - sum) * 10) / 10;
            if (Math.abs(diff) >= 0.1) perc[perc.length - 1] = Math.max(1, Math.round((perc[perc.length - 1] + diff) * 10) / 10);

            return perc;
        },

        _escapeHTML: function (s) {
            return String(s || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        },
        /**
 * BS/PL 제외 && 금액이 하나라도(≠0) 있으면 true
 */

        _isBSorPLRow: function (r) {
            const t = (r && r.NodeText ? String(r.NodeText) : "").trim().toUpperCase();
            // NodeText가 정확히 "BS" 또는 "PL" 이거나, 그 하위 노드일 경우 제외
            return t === "BS" || t === "PL" || t.startsWith("BS ") || t.startsWith("PL ");
        },


        /** 지정 필드 중 절대값이 0이 아닌 숫자가 하나라도 있으면 true */
        _hasAnyAmount: function (r, fields) {
            for (const f of fields) {
                const v = r && r[f];
                const num = (typeof v === "number") ? v
                    : (typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : NaN);
                if (isFinite(num) && Math.abs(num) > 0) return true;
            }
            return false;
        },


        // ========================================================================
        // SEARCH INTERNALS
        // ========================================================================
        _scrollToActiveHit: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            const st = this._searchState;
            if (!oTable || !ob || !st || !st.hits || st.pos < 0) return;
            const hit = st.hits[st.pos];
            const idx = this._indexOfHitInBinding(hit);
            if (idx < 0) return;
            const half = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
            oTable.setFirstVisibleRow(Math.max(0, idx - half));
        },

        _refreshRowHighlights: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;
            const q = (this._searchState && this._searchState.q || "").toLowerCase().trim();
            const first = oTable.getFirstVisibleRow();
            const rows = oTable.getRows();

            let activeIdx = -1;
            if (this._searchState && this._searchState.hits && this._searchState.pos >= 0) {
                activeIdx = this._indexOfHitInBinding(this._searchState.hits[this._searchState.pos]);
            }

            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                r.removeStyleClass("myHitRow");
                r.removeStyleClass("myHitActive");
                const ctx = ob.getContextByIndex(first + i);
                const o = ctx && ctx.getObject && ctx.getObject();
                if (!o || !q) continue;
                const node = (o.NodeText || "").toLowerCase();
                const gltx = (o.GlAccountText || "").toLowerCase();
                const gla = String(o.GlAccount || "").toLowerCase();
                const isHit = node.includes(q) || gltx.includes(q) || gla.includes(q);
                if (isHit) {
                    r.addStyleClass("myHitRow");
                    if (first + i === activeIdx) r.addStyleClass("myHitActive");
                }
            }
            this._applyGroupRowColors();
        },
        _refreshColumnIndexMap: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) { this._colIdxMap = {}; return; }

            const cols = oTable.getColumns().filter(c => c.getVisible && c.getVisible());
            const map = {};

            cols.forEach((c, i) => {
                // 1순위: filterProperty, 2순위: sortProperty
                let prop = (c.getFilterProperty && c.getFilterProperty()) ||
                    (c.getSortProperty && c.getSortProperty());

                // 3순위: 템플릿 바인딩에서 path 추정 (Text/Link/Number 등의 text|value|number)
                if (!prop) {
                    try {
                        const t = c.getTemplate && c.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { /* noop */ }
                }

                // 4순위: ID가 COL_<Prop> 형태면 거기서 추정
                if (!prop) {
                    const id = c.getId && String(c.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }

                if (prop) map[prop] = i;
            });

            this._colIdxMap = map; // 예: { PeriodBalance: 4, ComparisonBalance: 5, ... }
        },

        _getSelectedSubtreeRange: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return null;

            const start = this._getActiveRowIndex();   // ★ 변경 핵심
            if (start < 0) return null;

            const ctxStart = ob.getContextByIndex(start);
            const node = ctxStart && ctxStart.getObject && ctxStart.getObject();
            if (!node || node.HierarchyLevel == null) return null;

            const baseLevel = Number(node.HierarchyLevel);
            const len = ob.getLength();
            let end = start + 1;
            for (; end < len; end++) {
                const o = ob.getContextByIndex(end)?.getObject?.();
                if (!o) break;
                if (Number(o.HierarchyLevel) <= baseLevel) break;
            }
            return [start, end];
        },


        _ensureFullyExpandedAndCollectHits: async function (sQuery) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) { this._searchState.hits = []; this._searchState.pos = -1; return; }

            if (!this._isClientView) {
                try { oTable.expandToLevel(5); } catch (e) { /*noop*/ }
                await this._waitRowsSettled(oTable, 120);
                try { oTable.expandToLevel(99); } catch (e) { /*noop*/ }
                await this._expandAllDeep(oTable, 30);
                await this._waitRowsSettled(oTable, 220);
            } else {
                await this._waitRowsSettled(oTable, 120);
            }

            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            const hits = [];
            const seen = Object.create(null);

            for (let i = 0; i < ctxs.length; i++) {
                const obj = ctxs[i]?.getObject?.();
                if (!obj) continue;
                const m = this._matchRow(obj, sQuery);
                if (m.score <= 0) continue;

                const nodeTextRaw = obj.NodeText || "";
                const glTextRaw = obj.GlAccountText || "";
                const id = (obj.NodeID || obj.Node || null);
                const hid = (obj.Node || obj.NodeID || obj.HierarchyNodeID || null);
                const parent = (obj.ParentNodeID || obj.ParentNode || null);
                const hierarchy = obj.HierarchyID || "";
                const level = obj.HierarchyLevel;
                const gl = (obj.GlAccount != null ? String(obj.GlAccount) : null);
                const sig = [(nodeTextRaw || "").toLowerCase(), (glTextRaw || "").toLowerCase(), parent || "", level == null ? "" : String(level), hierarchy].join("|");
                const nth = (seen[sig] = (seen[sig] || 0) + 1);

                hits.push({ id, hid, parent, level, hierarchy, gl, text: m.matchedText || null, nodeText: nodeTextRaw, glText: glTextRaw, sig, nth, score: m.score, order: i });
            }

            hits.sort((a, b) => (b.score - a.score) || (b.level - a.level) || (a.order - b.order));
            this._searchState.hits = hits;
            this._searchState.pos = -1;
        },

        _normStr: function (v) { return String(v == null ? "" : v).toLowerCase(); },
        _tokenize: function (v) { return this._normStr(v).split(/[^0-9a-z\uac00-\ud7a3_]+/g).filter(Boolean); },
        _isHit: function (n, qRaw) { return this._rowMatchScore(n, qRaw) > 0; },
        _rowMatchScore: function (obj, qRaw) {
            const q = (qRaw || "").toLowerCase().trim();
            if (!q) return 0;
            const nodeText = (obj.NodeText || "").toLowerCase();
            const glAccountText = (obj.GlAccountText || "").toLowerCase();
            const glAccount = (obj.GlAccount || "").toString().toLowerCase();

            if (glAccount === q) return 6000; // exact GL match
            if (glAccountText.includes(q) || nodeText.includes(q)) {
                if (glAccountText.endsWith(`_${q}`) || nodeText.endsWith(`_${q}`)) return 5000; // suffix pattern
                return 3000; // partial
            }
            if ((obj.hasChildren === false || obj.hasChildren === undefined) && (glAccountText.includes(q) || nodeText.includes(q))) return 1000;
            return 0;
        },

        _matchRow: function (obj, qRaw) {
            const q = (qRaw || "").toLowerCase().trim();
            if (!q) return { score: 0, matchedText: null };
            const nodeText = (obj.NodeText || "").toLowerCase();
            const glAccountText = (obj.GlAccountText || "").toLowerCase();
            const glAccount = (obj.GlAccount || "").toString().toLowerCase();
            if (glAccount === q) return { score: 6000, matchedText: glAccount };
            if (glAccountText === q) return { score: 5000, matchedText: glAccountText };
            if (nodeText === q) return { score: 4000, matchedText: nodeText };
            if (glAccountText.includes(q)) return { score: 3000, matchedText: glAccountText };
            if (nodeText.includes(q)) return { score: 2000, matchedText: nodeText };
            return { score: 0, matchedText: null };
        },

        _scrollSelectHighlightReliable: function (hit, focusCol) {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable || !hit) return;
            const idx = this._indexOfHitInBinding(hit);
            if (idx < 0) return;
            const halfVisibleRows = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
            oTable.setFirstVisibleRow(Math.max(0, idx - halfVisibleRows));
            oTable.setSelectedIndex(idx);
            setTimeout(() => {
                const oRow = oTable.getRows()[oTable.getSelectedIndex() - oTable.getFirstVisibleRow()];
                if (oRow) {
                    const oCell = oRow.getCells()[focusCol];
                    if (oCell) oCell.focus();
                }
            }, 50);
        },

        _indexOfHitInBinding: function (hit) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return -1;
            const wantId = hit.id;
            if (wantId) {
                const len = ob.getLength();
                const ctxs = ob.getContexts(0, len);
                for (let i = 0; i < ctxs.length; i++) {
                    const o = ctxs[i]?.getObject?.();
                    if (!o) continue;
                    const curId = (o.Node != null) ? String(o.Node) : (o.NodeID != null) ? String(o.NodeID) : null;
                    if (curId === wantId) return i;
                }
            }
            const wantGl = hit.gl;
            if (wantGl) {
                const len = ob.getLength();
                const ctxs = ob.getContexts(0, len);
                for (let i = 0; i < ctxs.length; i++) {
                    const o = ctxs[i]?.getObject?.();
                    if (!o) continue;
                    const curGl = (o.GlAccount != null) ? String(o.GlAccount) : null;
                    if (curGl === wantGl) return i;
                }
            }
            return -1;
        },
        _bm_all: async function () {
            const store = await this._getPersContainer();
            return await store.get();                // [{id,name,createdAt,state}, ...]
        },
        _bm_putAll: async function (a) {
            const store = await this._getPersContainer();
            await store.set(a || []);
        },
        _bm_save: async function (name, state) {
            const a = await this._bm_all();
            const id = Date.now().toString(36);
            a.push({ id, name, createdAt: Date.now(), state });
            await this._bm_putAll(a);
            return id;
        },
        _bm_delete: async function (id) {
            const a = await this._bm_all();
            await this._bm_putAll(a.filter(b => b.id !== id));
        },

        // ========================================================================
        // ODATA / CLIENT MODE SWITCHING
        // ========================================================================


        _restoreODataBinding: function () {
            const oTable = this.byId(Control.Table.T_Main);
            oTable.unbindRows();
            oTable.setModel(null, "client");
            oTable.bindRows({
                path: this._origBindingInfo.path,
                filters: this._getTableFilter(),
                parameters: this._origBindingInfo.parameters,
                events: { dataRequested: this._onTreeTableRequested.bind(this), dataReceived: this._onTreeTableReceived.bind(this) }
            });
            this._isClientView = false;
        },

        // ========================================================================
        // TREE & FILTERING HELPERS
        // ========================================================================
        _buildTreeFromFlat: function (flat) {
            const map = Object.create(null);
            (flat || []).forEach(n => {
                const id = n.Node != null ? n.Node : n.NodeID;
                if (id == null) return;
                map[id] = map[id] || { children: [] };
                Object.assign(map[id], n, { children: map[id].children || [] });
            });
            const roots = [];
            (flat || []).forEach(n => {
                const id = n.Node != null ? n.Node : n.NodeID;
                const pid = (n.ParentNodeID != null ? n.ParentNodeID : n.ParentNode);
                if (pid != null && map[pid]) map[pid].children.push(map[id]);
                else roots.push(map[id]);
            });
            return roots;
        },

        _filterTreeByQuery: function (nodes, sQuery) {
            const Q = this._normStr(sQuery);
            const hit = (n) => { const fields = [n.NodeText, n.GlAccountText, n.GlAccount]; const tokens = fields.flatMap(this._tokenize.bind(this)); return tokens.includes(Q); };
            const deepCopy = (n) => { const c = Object.assign({}, n); c.children = (n.children || []).map(deepCopy); return c; };
            const dfs = (n) => { if (hit(n)) return deepCopy(n); const kept = (n.children || []).map(dfs).filter(Boolean); if (kept.length) { const c = Object.assign({}, n); c.children = kept; return c; } return null; };
            return (nodes || []).map(dfs).filter(Boolean);
        },

        _flattenTreeForTable: function (nodes) { const out = []; const visit = (n) => { out.push(n); (n.children || []).forEach(visit); }; (nodes || []).forEach(visit); return out; },

        // ========================================================================
        // ODATA UTILITIES / MISC
        // ========================================================================
        _waitBindingStableOnce: function (idleMs = 160) {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return Promise.resolve();
            return new Promise((resolve) => {
                let t; const on = () => { clearTimeout(t); t = setTimeout(() => { oTable.detachRowsUpdated(on); resolve(); }, idleMs); };
                oTable.attachRowsUpdated(on); on();
            });
        },

        _waitRowsSettled: function (oTable, idleMs = 150) {
            return new Promise((resolve) => {
                let timer; const on = () => { clearTimeout(timer); timer = setTimeout(() => { oTable.detachRowsUpdated(on); resolve(); }, idleMs); };
                oTable.attachRowsUpdated(on); on();
            });
        },

        _expandAllDeep: async function (oTable, maxPass = 30) {
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) return;
            let lastLen = -1;
            for (let pass = 0; pass < maxPass; pass++) {
                if (typeof oBinding.isRequestPending === "function" && oBinding.isRequestPending()) await this._waitRowsSettled(oTable, 180);
                const len = oBinding.getLength();
                const ctxs = oBinding.getContexts(0, len);
                let didExpand = false;
                for (let i = 0; i < ctxs.length; i++) {
                    const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                    if (!obj) continue;
                    if (obj.DrillState === "collapsed") { try { oTable.expand(i); didExpand = true; } catch (e) { /*noop*/ } }
                }
                if (didExpand || len !== lastLen) { lastLen = len; await this._waitRowsSettled(oTable, 220); continue; }
                break; // nothing more to expand
            }
        },

        _busyUntilFullyExpanded: function (oTable, opts) {
            if (!oTable) return;
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) { oTable.setBusy(false); return; }
            const cfg = Object.assign({ idleMs: 200, stableRepeats: 2, timeoutMs: 500 }, opts || {});
            let lastLen = -1, stable = 0, timedOut = false;
            oTable.setBusy(true);
            const finish = () => { if (timedOut) return; oTable.detachRowsUpdated(onRowsUpdated); oTable.setBusy(false); clearTimeout(timeoutId); };
            const onRowsUpdated = () => { clearTimeout(checkId); checkId = setTimeout(() => { const pending = (typeof oBinding.isRequestPending === "function") && oBinding.isRequestPending(); const len = oBinding.getLength(); if (!pending && len === lastLen) { stable += 1; } else { stable = 0; lastLen = len; } if (stable >= cfg.stableRepeats) { finish(); } }, cfg.idleMs); };
            const timeoutId = setTimeout(() => { timedOut = true; oTable.detachRowsUpdated(onRowsUpdated); oTable.setBusy(false); }, cfg.timeoutMs);
            let checkId = null; oTable.attachRowsUpdated(onRowsUpdated); onRowsUpdated();
        },

        _serverGetParent: function (nodeId) {
            if (nodeId == null) return Promise.resolve(null);
            const oModel = this.getView().getModel();
            return new Promise((resolve, reject) => {
                oModel.read("/FinancialStatements", {
                    filters: this._getTableFilter().concat([new sap.ui.model.Filter("Node", sap.ui.model.FilterOperator.EQ, nodeId)]),
                    urlParameters: { "$top": 1, "$select": "Node,ParentNodeID" },
                    success: (data) => { const row = (data && data.results && data.results[0]) || null; resolve(row ? row.ParentNodeID : null); },
                    error: reject
                });
            });
        },

        _serverBuildPath: async function (nodeId) {
            const path = []; let cur = nodeId, guard = 0;
            while (cur != null && guard++ < 200) { path.push(cur); const parent = await this._serverGetParent(cur); if (parent == null) break; cur = parent; }
            return path.reverse();
        },

        _expandPathAndRetry: async function (hit) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;
            const pathIds = await this._serverBuildPath(hit.id);
            for (const nodeId of pathIds) {
                const tmp = { id: String(nodeId), parent: null, level: null, text: null, gl: null };
                const idx = this._indexOfHitInBinding(tmp);
                if (idx >= 0) { try { oTable.expand(idx); } catch (e) { /*noop*/ } await this._waitRowsSettled(oTable, 180); }
            }
        },

        // ========================================================================
        // TOKENS / PERIOD LABEL HELPERS
        // ========================================================================
        _initMonthYearInputs: function () {
            ["MI_PriorStartMonth", "MI_PriorEndMonth", "MI_CurrentStartMonth", "MI_CurrentEndMonth"].forEach(id => this._attachMonthValidator(id));
            ["MI_PriorYear", "MI_CurrentYear"].forEach(id => this._attachYearValidator(id));

            const today = new Date();
            const y = String(today.getFullYear());
            const curMonth = today.getMonth() + 1; // 1-12
            const curMonthStr = String(curMonth).padStart(3, "0");
            const prevMonth = (curMonth === 1) ? 12 : (curMonth - 1);
            const prevMonthStr = String(prevMonth).padStart(3, "0");

            this._setSingleToken("MI_PriorStartMonth", "000");
            this._setSingleToken("MI_PriorEndMonth", curMonthStr);
            this._setSingleToken("MI_CurrentStartMonth", "000");
            this._setSingleToken("MI_CurrentEndMonth", prevMonthStr);
            this._setSingleToken("MI_PriorYear", y);
            this._setSingleToken("MI_CurrentYear", y);
        },

        _attachMonthValidator: function (sId) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.addValidator(args => {
                const raw = (args.text || "").trim();
                if (!/^\d{1,3}$/.test(raw)) { sap.m.MessageToast.show(this.i18n.getText("err.period.nan")); return null; }
                let n = parseInt(raw, 10);
                if (n < 0 || n > 16) { sap.m.MessageToast.show(this.i18n.getText("err.period.range")); return null; }
                const val = String(n).padStart(3, "0");
                mi.destroyTokens();
                return new sap.m.Token({ key: val, text: val });
            });
        },

        _attachYearValidator: function (sId) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.addValidator(args => {
                const raw = (args.text || "").trim();
                if (!/^\d{4}$/.test(raw)) { sap.m.MessageToast.show(this.i18n.getText("err.year.format")); return null; }
                const y = parseInt(raw, 10);
                if (y < 1900 || y > 2100) { sap.m.MessageToast.show(this.i18n.getText("err.year.range")); return null; }
                mi.destroyTokens();
                return new sap.m.Token({ key: String(y), text: String(y) });
            });
        },

        _checkRequiredFields: function (sPriorYear, sCurrYear, sPriorStart, sPriorEnd, sCurrStart, sCurrEnd) {
            if (!sPriorYear || !sCurrYear || !sPriorStart || !sPriorEnd || !sCurrStart || !sCurrEnd) {
                MessageBox.error(this.i18n.getText("err.input.missingPeriods"), { title: this.i18n.getText("title.inputError"), styleClass: "sapUiSizeCompact" });
                return false;
            }
            return true;
        },

        _setSingleToken: function (sId, sVal) { const mi = this.byId(sId); if (!mi) return; mi.destroyTokens(); mi.addToken(new sap.m.Token({ key: sVal, text: sVal })); },
        _getTokenVal: function (sId) { const mi = this.byId(sId); const t = mi ? mi.getTokens() : []; return t.length ? t[0].getKey() : ""; },



        _fmtMMYYYY: function (year, period) {
            if (!year) return "";
            const p = String(period || "000").padStart(3, "0");
            const mm = (p === "000") ? "00" : String(Math.max(1, Math.min(16, parseInt(p, 10)))).padStart(2, "0");
            return `${mm}.${year}`;
        },

        _buildPeriodLabel: function (year, fromP, toP) {
            if (!year) return "";
            const a = this._fmtMMYYYY(year, fromP);
            const b = this._fmtMMYYYY(year, toP);
            return `(${a}-${b})`;
        },

        // ========================================================================
        // CROSS-APP NAV HELPERS
        // ========================================================================
        _navigateToGLBalance: async function (glAccount, companyCode, fromPeriod, toPeriod, fiscalYear) {
            if (!glAccount || !companyCode || !fromPeriod || !toPeriod || !fiscalYear) { sap.m.MessageToast.show(this.i18n.getText("err.balance.paramMissing")); return; }
            const fix = (v, edge) => (v === "000" ? (edge === "from" ? "001" : "016") : v);
            const FromPeriod = fix(fromPeriod, "from");
            const ToPeriod = fix(toPeriod, "to");
            const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
            const sHref = await Navigation.getHref({ target: { semanticObject: "GLAccount", action: "displayBalances" }, params: { GLAccount: glAccount, CompanyCode: companyCode, FromPeriod, ToPeriod, LedgerFiscalYear: fiscalYear } });
            sap.m.URLHelper.redirect(window.location.href.split("#")[0] + sHref, true);
        },

        _navigateToJournalEntry: async function (glAccount, companyCode, fiscalYear, fiscalPeriods) {
            if (!glAccount || !companyCode || !fiscalYear || !Array.isArray(fiscalPeriods) || fiscalPeriods.length === 0) { sap.m.MessageToast.show(this.i18n.getText("err.je.paramMissing")); return; }
            const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
            const sHref = await Navigation.getHref({ target: { semanticObject: "GLAccount", action: "displayGLLineItemReportingView" }, params: { GLAccount: glAccount, CompanyCode: companyCode, FiscalYear: fiscalYear, FiscalPeriod: fiscalPeriods } });
            sap.m.URLHelper.redirect(window.location.href.split("#")[0] + sHref, true);
        },

        // ========================================================================
        // SEARCH FILTERS APPLIED TO ODATA BINDING
        // ========================================================================
        _lastTableQuery: "",
        _deferApplyTableFilters: false,

        _buildSearchFilters: function (sQuery) {
            const q = (sQuery || "").trim();
            if (!q) return [];
            return [new sap.ui.model.Filter({ and: false, filters: [new sap.ui.model.Filter("NodeText", sap.ui.model.FilterOperator.Contains, q), new sap.ui.model.Filter("GlAccount", sap.ui.model.FilterOperator.Contains, q), new sap.ui.model.Filter("GlAccountText", sap.ui.model.FilterOperator.Contains, q)] })];
        },



        _getLocalPersoService: function () {
            const KEY = "zgspkgco0060.T_Main.perso";
            return {
                getPersData: () => Promise.resolve(JSON.parse(localStorage.getItem(KEY) || "{}")),
                setPersData: (o) => { localStorage.setItem(KEY, JSON.stringify(o || {})); return Promise.resolve(); },
                delPersData: () => { localStorage.removeItem(KEY); return Promise.resolve(); }
            };
        },
        onOpenPersonalize: function () {
            if (this._oTPC) this._oTPC.openDialog();
        },

        onResetPersonalize: function () {
            if (!this._oTPC) return;
            this._oTPC.getPersoService().delPersData().then(() => {
                this._oTPC.refresh();
                this._refreshColumnIndexMap();
                this._applyGroupRowColors();
                sap.m.MessageToast.show(this.i18n.getText("toast.reset") || "개인화가 초기화되었습니다.");
            });
        },
        _getVisibleColumnConfigFromTable: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return this._createColumnConfig(); // fallback

            const typeOf = (prop) => {
                switch (prop) {
                    case "PeriodBalance":
                    case "ComparisonBalance":
                    case "AbsoluteDifference":
                    case "RelativeDifference":
                        return EdmType.Currency;
                    default:
                        return EdmType.String;
                }
            };

            const inferProp = (col) => {
                let prop =
                    (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!prop) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { }
                }
                if (!prop) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }
                return prop;
            };
            // 현재 보이는 열만, 현재 순서대로
            return oTable.getColumns()
                .filter(c => c.getVisible && c.getVisible())
                .map(c => {
                    const prop = inferProp(c);
                    if (!prop) return null; // 바인딩 없는 기술열이면 제외
                    const labelCtrl = c.getLabel && c.getLabel();
                    const label = (labelCtrl && labelCtrl.getText && labelCtrl.getText()) || prop;
                    return { label, type: typeOf(prop), property: prop };
                })
                .filter(Boolean);
        },

        _captureAppState: async function () {
            const Search = this.getView().getModel("Search")?.getData() || {};

            const tokens = {
                MI_PriorYear: this._getTokenVal("MI_PriorYear"),
                MI_PriorStartMonth: this._getTokenVal("MI_PriorStartMonth"),
                MI_PriorEndMonth: this._getTokenVal("MI_PriorEndMonth"),
                MI_CurrentYear: this._getTokenVal("MI_CurrentYear"),
                MI_CurrentStartMonth: this._getTokenVal("MI_CurrentStartMonth"),
                MI_CurrentEndMonth: this._getTokenVal("MI_CurrentEndMonth")
            };

            const custom = this._customParams || {};
            const colFilters = this._colFilters || {};

            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding && oTable.getBinding("rows");

            // 화면 스크롤/선택
            let firstVisibleRow = 0;
            let selectedNodeId = null;
            if (oTable) {
                firstVisibleRow = oTable.getFirstVisibleRow() || 0;
                const selIdx = oTable.getSelectedIndex?.() ?? -1;
                if (selIdx >= 0 && ob) {
                    const obj = ob.getContextByIndex(selIdx)?.getObject?.();
                    selectedNodeId = (obj && (obj.Node != null ? obj.Node : obj.NodeID != null ? obj.NodeID : null)) ?? null;
                }
            }

            // 트리 펼침/접힘 (UI 실제 상태)
            const expandedNodes = [];
            const collapsedNodes = [];
            if (ob && oTable && typeof oTable.isExpanded === "function") {
                const len = ob.getLength();
                for (let i = 0; i < len; i++) {
                    const o = ob.getContextByIndex(i)?.getObject?.();
                    if (!o) continue;
                    const id = (o.Node != null) ? o.Node : (o.NodeID != null) ? o.NodeID : null;
                    if (id == null) continue;

                    const dsInitial = String(o.DrillState || "").toLowerCase();
                    const isGroup = dsInitial !== "leaf";
                    if (!isGroup) continue;

                    const uiExpanded = !!oTable.isExpanded(i);
                    if (uiExpanded) expandedNodes.push(String(id));
                    else collapsedNodes.push(String(id));
                }
            }

            // 열 레이아웃(순서/가시성/폭)
            const inferProp = (col) => {
                let prop = (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!prop) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) prop = b.getPath();
                    } catch (e) { /* noop */ }
                }
                if (!prop) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) prop = m[1];
                }
                return prop;
            };

            const toWidthStr = (c) => {
                const w = c.getWidth && c.getWidth();
                if (w) return w;
                const el = c.getDomRef && c.getDomRef();
                if (el && el.getBoundingClientRect) {
                    const px = Math.max(40, Math.round(el.getBoundingClientRect().width));
                    return `${px}px`;
                }
                return "100px";
            };

            const columnLayout = [];
            if (oTable) {
                (oTable.getColumns?.() || []).forEach((col) => {
                    const prop = inferProp(col);
                    if (!prop) return;
                    columnLayout.push({
                        prop,
                        visible: col.getVisible ? !!col.getVisible() : true,
                        width: toWidthStr(col)
                    });
                });
            }

            // 개인화(TPC)
            let tablePerso = {};
            if (this._oTPC) {
                tablePerso = await this._oTPC.getPersoService().getPersData();
            }

            // 통일: expandLevel 로 저장 (복원 시 expandToLevel 등에 사용)
            const expandLevel = Number.isFinite(this._curExpandLevel)
                ? this._curExpandLevel
                : this._getVisibleMaxLevel();

            return {
                Search,
                tokens,
                custom,
                colFilters,
                tablePerso,
                tableState: {
                    columnLayout,
                    // 트리 상태는 tree 아래에 모아 저장 (복원 측과 경로/키 맞춤)
                    tree: {
                        expandLevel,          // number
                        expandedNodes,        // string[]
                        collapsedNodes,       // string[]
                        firstVisibleRow,      // number
                        selectedNodeId        // string | number | null
                    }
                }
            };
        },

        _snapshotNodeParent: function (oBinding) {
            const map = new Map();
            const len = oBinding.getLength();
            for (let i = 0; i < len; i++) {
                const obj = oBinding.getContextByIndex(i)?.getObject?.();
                if (!obj) continue;
                const id = obj.Node ?? obj.NodeID ?? null;
                const pid = obj.ParentNode ?? obj.ParentID ?? null;
                if (id != null) map.set(String(id), pid != null ? String(pid) : null);
            }
            return map;
        },
        _findRowIndexByNodeId: function (oTable, oBinding, nodeId) {
            const len = oBinding.getLength();
            for (let i = 0; i < len; i++) {
                const obj = oBinding.getContextByIndex(i)?.getObject?.();
                const id = obj && (obj.Node ?? obj.NodeID);
                if (String(id) === String(nodeId)) return i;
            }
            return -1;
        },
        _expandPathByIds: async function (oTable, oBinding, pathIds) {
            // pathIds: [rootId, ..., targetId]
            for (const id of pathIds) {
                let idx = this._findRowIndexByNodeId(oTable, oBinding, id);
                if (idx < 0) {
                    // 아직 안 보이면 잠깐 대기 후 재시도
                    await this._waitRowsSettled(oTable, 120);
                    idx = this._findRowIndexByNodeId(oTable, oBinding, id);
                }
                if (idx >= 0 && !oTable.isExpanded(idx)) {
                    try { oTable.expand(idx); } catch (e) { }
                    await this._waitRowsSettled(oTable, 80);
                }
            }
        },

        _expandNodesByIdWithParents: async function (ids) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable?.getBinding("rows");
            if (!oTable || !oBinding) return;

            // 부모 맵이 없으면 만든다
            this._nodeParentMap = this._nodeParentMap || this._snapshotNodeParent(oBinding);

            for (const leafId of ids) {
                // 부모 체인 구성
                const path = [];
                let cur = String(leafId);
                const guard = new Set(); // 루프 방지
                while (cur && !guard.has(cur)) {
                    guard.add(cur);
                    path.push(cur);
                    const p = this._nodeParentMap.get(cur);
                    cur = p != null ? String(p) : null;
                }
                path.reverse(); // root → leaf
                await this._expandPathByIds(oTable, oBinding, path);
            }
        },
        _collapseNodesById: async function (ids, retries = 2) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable?.getBinding("rows");
            if (!oTable || !oBinding) return;

            for (const id of ids) {
                let idx = this._findRowIndexByNodeId(oTable, oBinding, id);
                if (idx >= 0 && oTable.isExpanded(idx)) {
                    try { oTable.collapse(idx); } catch (e) { }
                } else if (retries > 0) {
                    await this._waitRowsSettled(oTable, 150);
                    await this._collapseNodesById([id], retries - 1);
                }
            }
        },


        _inferColumnProperty: function (col) {
            let prop = (col.getFilterProperty && col.getFilterProperty()) ||
                (col.getSortProperty && col.getSortProperty());
            if (!prop) {
                try {
                    const t = col.getTemplate && col.getTemplate();
                    const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                    if (b && b.getPath) prop = b.getPath();
                } catch (e) { }
            }
            if (!prop) {
                const id = col.getId && String(col.getId());
                const m = id && id.match(/COL_(.+)$/);
                if (m) prop = m[1];
            }
            return prop;
        },

        _captureColumnWidths: function () {
            const oTable = this.byId("T_Main");
            if (!oTable) return {};
            const out = {};
            oTable.getColumns().forEach(c => {
                if (c.getVisible && !c.getVisible()) return;
                const p = this._inferColumnProperty(c);
                if (p) out[p] = c.getWidth ? c.getWidth() : null; // ex) "120px" / "12rem" / ""
            });
            return out;
        },


        // === 저장/불러오기 UI ===
        onBookmarkSave: async function () {
            const state = await this._captureAppState();
            const dlg = new sap.m.Dialog({
                title: "북마크 저장",
                content: [new sap.m.Input("BM_NAME",)],
                buttons: [
                    new sap.m.Button({
                        text: "저장", type: "Emphasized",
                        press: async () => {
                            const name = sap.ui.getCore().byId("BM_NAME").getValue().trim() || "내 북마크";
                            await this._bm_save(name, state);
                            dlg.close();
                            sap.m.MessageToast.show("북마크가 저장되었습니다.");
                        }
                    }),
                    new sap.m.Button({ text: "취소", press: () => dlg.close() })
                ],
                afterClose: () => dlg.destroy()
            });
            this.getView().addDependent(dlg);
            dlg.open();
        },
        // 1) PersoController가 준비될 때까지 기다리는 헬퍼 (최대 2초)
        _ensureTPCReady: function () {
            if (this._oTPC) return Promise.resolve();
            const oTable = this.byId("T_Main");
            if (!oTable) return Promise.resolve();
            return new Promise((resolve) => {
                let tries = 0;
                const tick = () => {
                    tries++;
                    if (this._oTPC || tries > 40) return resolve();
                    setTimeout(tick, 50);
                };
                tick();
            });
        },
        _applyAppState: async function (s) {
            try {
                if (!s) return;

                // (a) Search 모델
                const oSearch = this.getView().getModel("Search");
                if (s.Search && oSearch) {
                    oSearch.setData({ ...oSearch.getData(), ...s.Search });
                }

                // (b) 기간 토큰
                Object.entries(s.tokens || {}).forEach(([id, val]) => this._setSingleToken(id, val));

                // (c) 커스텀 파라미터 / 컬럼 필터
                this._customParams = s.custom || {};
                this._colFilters = s.colFilters || {};

                // (d) Table 개인화 (있을 경우 적용)
                await this._ensureTPCReady();
                let usedTPC = false;
                if (this._oTPC && s.tablePerso && Object.keys(s.tablePerso).length > 0) {
                    // ★ 빈 객체는 절대 주지 않는다 → 기본 순서로 리셋되는 문제 방지
                    await this._oTPC.getPersoService().setPersData(s.tablePerso);
                    this._oTPC.refresh();
                    usedTPC = true;
                }

                // (e) 헤더 라벨
                this._setPeriodHeaders();

                // (f) 컬럼 레이아웃
                // - TPC를 썼으면: 순서/가시성은 TPC가 처리 → 우리는 폭만 보정
                // - TPC 데이터가 없으면: columnLayout 전체로 순서/가시성/폭 적용
                if (s.tableState && Array.isArray(s.tableState.columnLayout)) {
                    if (usedTPC) {
                        const widthMap = {};
                        s.tableState.columnLayout.forEach(ent => {
                            if (ent && ent.prop && ent.width) widthMap[ent.prop] = ent.width;
                        });
                        this._applyColumnWidths(widthMap);   // ★ 폭만
                    } else {
                        this._applyColumnLayout(s.tableState.columnLayout); // ★ 순서/가시성/폭
                    }
                }

                // (g) 트리 상태는 dataReceived에서 복원
                this._restoreStateFromBookmark = s.tableState || {};

                // (h) 테이블 리바인드 (필터는 dataReceived 후 재적용)
                const oTable = this.byId("T_Main");
                if (oTable) {
                    oTable.unbindRows();
                    this._deferApplyTableFilters = true;
                    this._bInitialExpandDone = false;
                    this._bindTable(oTable);
                }

                sap.m.MessageToast.show("북마크를 적용했습니다.");
            } catch (e) {
                console.error(e);
                sap.m.MessageBox.error("북마크 적용 중 오류가 발생했습니다.");
            }
            await this._waitBindingStableOnce(150);
            this._refreshColumnIndexMap?.();
            this._applyGroupRowColors?.();
        },



        // 3) 불러오기 다이얼로그 (선택 → 적용)
        // 북마크 관리: 체크 선택 → [적용]으로 불러오기, [삭제]로 다중 삭제
        onBookmarkManage: async function () {
            const items = await this._bm_all();
            if (!items.length) {
                sap.m.MessageToast.show("저장된 북마크가 없습니다.");
                return;
            }

            const oModel = new sap.ui.model.json.JSONModel({ items, selCount: 0 });
            const oList = new sap.m.List({
                mode: sap.m.ListMode.MultiSelect,
                includeItemInSelection: true,
                growing: true,
                items: {
                    path: "/items",
                    template: new sap.m.StandardListItem({
                        title: "{name}",
                        description: {
                            parts: [{ path: "createdAt" }],
                            formatter: (v) => this.formatter.fmtTsLocal(v)   // <- 래퍼로 확실히 호출
                        },
                        icon: "sap-icon://bookmark",
                        selected: false,
                        type: "Inactive"
                    })
                }
            });

            // 선택 개수 → 버튼 활성화 바인딩용
            oList.attachSelectionChange(() => {
                oModel.setProperty("/selCount", (oList.getSelectedItems() || []).length);
            });

            const dlg = new sap.m.Dialog({
                title: "북마크 관리",
                contentWidth: "520px",
                contentHeight: "60vh",
                stretchOnPhone: true,
                content: [oList],
                buttons: [
                    // 적용(불러오기): 하나만 선택 시 가능
                    new sap.m.Button({
                        text: "적용",
                        type: "Emphasized",
                        enabled: "{= ${/selCount} === 1 }",
                        press: async () => {
                            const sel = oList.getSelectedItems() || [];
                            if (sel.length !== 1) {
                                sap.m.MessageToast.show("적용은 하나만 선택해 주세요.");
                                return;
                            }
                            const bm = sel[0].getBindingContext().getObject();
                            if (bm && bm.state) {
                                await this._applyAppState(bm.state);
                                dlg.close();
                            }
                        }
                    }),
                    // 삭제: 다중 가능
                    new sap.m.Button({
                        text: "삭제",
                        type: "Negative",
                        enabled: "{= ${/selCount} > 0 }",
                        press: () => {
                            const sel = oList.getSelectedItems() || [];
                            if (!sel.length) return;

                            sap.m.MessageBox.confirm(`선택한 ${sel.length}개 북마크를 삭제할까요?`, {
                                actions: [sap.m.MessageBox.Action.OK, sap.m.MessageBox.Action.CANCEL],
                                onClose: (act) => {
                                    if (act !== sap.m.MessageBox.Action.OK) return;

                                    sel.forEach(it => {
                                        const id = it.getBindingContext().getObject().id;
                                        this._bm_delete(id);
                                    });

                                    // 목록 새로고침 & 상태 초기화
                                    oModel.setProperty("/items", this._bm_all());
                                    oList.removeSelections(true);
                                    oModel.setProperty("/selCount", 0);
                                    sap.m.MessageToast.show("삭제되었습니다.");
                                }
                            });
                        }
                    }),
                    new sap.m.Button({ text: "닫기", press: () => dlg.close() })
                ],
                afterClose: () => dlg.destroy()
            });

            dlg.setModel(oModel);
            this.getView().addDependent(dlg);
            dlg.open();
        },

        // 필요 시: 기존 onBookmarkLoad는 이 다이얼로그만 띄우게 연결
        onBookmarkLoad: function () {
            this.onBookmarkManage();
        },


        _expandToLevel: async function (level) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable?.getBinding("rows");
            if (!oTable || !ob) return;

            const target = Math.max(1, Math.min(level | 0, this._maxExpandLevel || 1));
            oTable.setBusy(true);
            try {
                // 올리기(펼치기): target까지 부모들을 충분히 펼친다
                if (target > (this._curExpandLevel || 1)) {
                    await this._ensureExpandedUpToLevel(target);
                }

                // 내리기(접기): "절단 레벨"의 그룹 노드들을 접는다
                if (target < (this._curExpandLevel || 1)) {
                    await this._collapseToLevel(target);
                }

                this._curExpandLevel = target;
                this._refreshColumnIndexMap?.();
                this._applyGroupRowColors?.();
            } finally {
                oTable.setBusy(false);
            }
        },




        // target 레벨까지 필요한 부모는 모두 펼친다 (lazy 로딩 고려, 여러 pass)
        _ensureExpandedUpToLevel: async function (targetLevel, maxPass = 20) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable?.getBinding("rows");
            if (!oTable || !ob) return;

            for (let pass = 0; pass < maxPass; pass++) {
                await this._waitRowsSettled(oTable, 140);
                const len = ob.getLength();
                let did = false;
                for (let i = 0; i < len; i++) {
                    const row = ob.getContextByIndex(i)?.getObject?.();
                    if (!row) continue;
                    const lv = this._getLevel(row);
                    const ds = String(row.DrillState || "").toLowerCase(); // expanded/collapsed/leaf
                    if (lv != null && lv < targetLevel && ds === "collapsed") {
                        try { oTable.expand(i); did = true; } catch (e) { }
                    }
                }
                if (!did) break;
            }
        },

        // targetLevel보다 "깊은(>)" 노드는 역순으로 접는다 (인덱스 안전)
        _collapseDeeperThan: async function (targetLevel, maxPass = 12) {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable?.getBinding("rows");
            if (!oTable || !ob) return;

            for (let pass = 0; pass < maxPass; pass++) {
                await this._waitRowsSettled(oTable, 140);
                const len = ob.getLength();
                let did = false;
                for (let i = len - 1; i >= 0; i--) {
                    const row = ob.getContextByIndex(i)?.getObject?.();
                    if (!row) continue;
                    const lv = this._getLevel(row);
                    const ds = String(row.DrillState || "").toLowerCase();
                    if (lv != null && lv > targetLevel && ds !== "leaf") {
                        try { oTable.collapse(i); did = true; } catch (e) { }
                    }
                }
                if (!did) break;
            }
        },


        // 숫자/상태 유틸(이미 있으면 생략),
        _getDrill(o) { return String(o?.DrillState || "").toLowerCase(); },
        // 현재 화면에 "보이는" 최심 레벨
        _getVisibleMaxLevel: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return 1;
            const len = ob.getLength();
            let maxL = 1;
            for (let i = 0; i < len; i++) {
                const obj = ob.getContextByIndex(i)?.getObject?.();
                const lv = Number(obj?.HierarchyLevel);
                if (Number.isFinite(lv) && lv > maxL) maxL = lv;
            }
            return maxL;
        },
        _getLevel: function (o) {
            var n = Number(o && o.HierarchyLevel);
            return isFinite(n) ? n : null;
        },
        _getMaxLevelFromBinding: function () {
            var oTable = this.byId(Control.Table.T_Main), ob = oTable && oTable.getBinding("rows");
            if (!ob) return 1;
            var len = ob.getLength(), maxL = 1;
            for (var i = 0; i < len; i++) {
                var o = ob.getContextByIndex(i)?.getObject?.();
                var lv = this._getLevel(o);
                if (lv != null && lv > maxL) maxL = lv;
            }
            return maxL;
        },
        _onHeaderFilterToLP: function (oEvent) {
            const oCol = oEvent.getParameter("column");
            const sProp = oCol?.getFilterProperty && oCol.getFilterProperty();
            const sVal = oEvent.getParameter("value");

            if (!sProp || !CUSTOM_PARAM_MAP[sProp]) return;

            this._customParams = this._customParams || {};
            if (sVal && sVal.trim()) {
                this._customParams[CUSTOM_PARAM_MAP[sProp]] = sVal.trim();
            } else {
                delete this._customParams[CUSTOM_PARAM_MAP[sProp]];
            }

            const oTable = this.byId("T_Main");
            const oBinding = oTable.getBinding("rows");
            if (oBinding) {
                // 기본 $filter 제거
                oBinding.filter([]);

                // LP 파라미터 교체
                oBinding.changeParameters({ ...this._customParams });
                oBinding.refresh(true);
            }
        },

        // 현재 보이는 최심 레벨 계산
        _getCurrentVisibleMaxLevel: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob) return 1;
            const len = ob.getLength();
            let maxL = 1;
            for (let i = 0; i < len; i++) {
                const o = ob.getContextByIndex(i)?.getObject?.();
                if (!o) continue;
                const lv = Number(o.HierarchyLevel);
                if (Number.isFinite(lv) && lv > maxL) maxL = lv;
            }
            return maxL;
        },

        onExpandLevelUp: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob) return;

            oTable.setBusy(true);
            try {
                const startMax = this._getCurrentVisibleMaxLevel();
                const target = startMax + 1;

                for (let pass = 0; pass < 3; pass++) {
                    let did = false;
                    const len = ob.getLength();

                    for (let i = 0; i < len; i++) {
                        const row = ob.getContextByIndex(i)?.getObject?.();
                        if (!row) continue;
                        const lv = Number(row.HierarchyLevel);
                        if (!Number.isFinite(lv) || lv !== startMax) continue;

                        // leaf 제외, 아직 UI상 확장되지 않은 그룹만 확장
                        const ds = String(row.DrillState || "").toLowerCase();
                        if (ds !== "leaf" && !oTable.isExpanded(i)) {
                            try { oTable.expand(i); did = true; } catch (e) { }
                        }
                    }

                    if (did) await this._waitRowsSettled(oTable, 140);

                    // 목표 레벨이 드러났으면 종료
                    if (this._getCurrentVisibleMaxLevel() >= target) break;

                    // 더 할 게 없으면 중단
                    if (!did) break;
                }

                // 보강: 여전히 늘지 않았으면 한 번에 target까지
                if (this._getCurrentVisibleMaxLevel() < target) {
                    try { oTable.expandToLevel(target); } catch (e) { }
                    await this._waitRowsSettled(oTable, 140);
                }

                this._curExpandLevel = this._getCurrentVisibleMaxLevel();
                this._applyGroupRowColors?.();
            } finally {
                oTable.setBusy(false);
            }
        },
        // 한 단계 축소 (-)
        onExpandLevelDown: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob) return;

            const MIN = 1; // 필요 시 2로
            const curMax = this._getCurrentVisibleMaxLevel();
            if (curMax <= MIN) { sap.m.MessageToast.show("이미 최소 레벨입니다."); return; }

            oTable.setBusy(true);
            try {
                // target 레벨 = curMax - 1
                const target = curMax - 1;
                const len = ob.getLength();
                let did = false;
                // 자식이 먼저 사라지도록 역순으로, target 레벨의 '펼쳐진 그룹'만 접는다
                for (let i = len - 1; i >= 0; i--) {
                    const row = ob.getContextByIndex(i)?.getObject?.();
                    if (!row) continue;
                    const lv = Number(row.HierarchyLevel);
                    if (!Number.isFinite(lv) || lv !== target) continue;
                    const ds = String(row.DrillState || "").toLowerCase();
                    // leaf 제외, 펼쳐져 있으면 접기
                    if (ds !== "leaf" && oTable.isExpanded(i)) {
                        try { oTable.collapse(i); did = true; } catch (e) { }
                    }
                }
                if (did) await this._waitRowsSettled(oTable, 140);
            } finally { oTable.setBusy(false); }
        },

        // 특정 레벨의 노드들을 축소 (수정)
        _collapseNodesAtLevel: function (level) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable.getBinding("rows");

            if (!oTable || !oBinding) return;

            const len = oBinding.getLength();

            // 역순으로 처리 (자식 노드부터 축소)
            for (let i = len - 1; i >= 0; i--) {
                const oContext = oBinding.getContextByIndex(i);
                if (!oContext) continue;

                const oRowData = oContext.getObject();

                // 해당 레벨의 노드이고 확장된 상태인지 확인
                if (oRowData.HierarchyLevel === level &&
                    oRowData.DrillState !== "leaf" &&
                    oTable.isExpanded(i)) {
                    try {
                        oTable.collapse(i);
                    } catch (e) {
                        console.warn("Collapse failed at index", i, e);
                    }
                }
            }
        },

        // 특정 레벨의 노드들을 확장 (수정)
        _expandNodesAtLevel: function (level) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable.getBinding("rows");

            if (!oTable || !oBinding) return;

            const len = oBinding.getLength();

            for (let i = 0; i < len; i++) {
                const oContext = oBinding.getContextByIndex(i);
                if (!oContext) continue;

                const oRowData = oContext.getObject();

                // 해당 레벨의 노드이고 축소된 상태인지 확인
                if (oRowData.HierarchyLevel === level &&
                    oRowData.DrillState === "collapsed" &&
                    !oTable.isExpanded(i)) {
                    try {
                        oTable.expand(i);
                    } catch (e) {
                        console.warn("Expand failed at index", i, e);
                    }
                }
            }
        },
        // FLP Personalization 컨테이너 헬퍼 (FLP 미탑재면 localStorage로 자동 폴백)
        _getPersContainer: async function () {
            try {
                const Pers = await sap.ushell.Container.getServiceAsync("Personalization");
                console.log("[BM] Using FLP Personalization");
                const scope = {
                    keyCategory: Pers.constants.keyCategory.FIXED_KEY,
                    writeFrequency: Pers.constants.writeFrequency.HIGH,
                    clientStorageAllowed: true,
                    validity: Infinity
                };
                // 컨테이너 하나에 items 라는 아이템으로 전체 배열을 저장합니다.
                const container = await Pers.getContainer(BM_KEY, scope, this.getOwnerComponent());
                return {
                    get: async () => container.getItemValue("items") || [],
                    set: async (arr) => { container.setItemValue("items", arr || []); await container.save(); },
                    del: async () => { container.delItem("items"); await container.save(); }
                };
            } catch (e) {
                // FLP 외부 실행(standalone) 등일 때는 기존 localStorage로 폴백
                return {
                    get: async () => { try { return JSON.parse(localStorage.getItem(BM_KEY) || "[]"); } catch { return []; } },
                    set: async (arr) => localStorage.setItem(BM_KEY, JSON.stringify(arr || [])),
                    del: async () => localStorage.removeItem(BM_KEY)
                };
            }
        },
        // 주어진 Filter 트리(flt) 안에 sPath === targetPath 가 하나라도 있는지 재귀 탐색
        _filterContainsPath: function (flt, targetPath) {
            if (!flt) return false;
            if (flt.sPath === targetPath) return true;
            const children = (typeof flt.getFilters === "function" ? flt.getFilters() : flt.aFilters) || [];
            return children.some(child => this._filterContainsPath(child, targetPath));
        },

        // Application 필터 배열에서 특정 path 들을 모두 제거
        _stripAppFilters: function (oBinding, paths /* string[] */) {
            const prev = (oBinding.aApplicationFilters || []);
            return prev.filter(f => !paths.some(p => this._filterContainsPath(f, p)));
        },
        _reapplyAllAppFilters: function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            // 기본(기간/회사) + 상단검색
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            // 현재 선택 상태에서 컬럼필터 만들기
            const aCol = [];

            if (this._colSel.GlAccount && this._colSel.GlAccount.length) {
                aCol.push(new sap.ui.model.Filter({
                    and: false,
                    filters: this._colSel.GlAccount.map(v =>
                        new sap.ui.model.Filter("GlAccount", sap.ui.model.FilterOperator.EQ, v)
                    )
                }));
            }

            if (this._colSel.GlAccountText && this._colSel.GlAccountText.length) {
                aCol.push(new sap.ui.model.Filter({
                    and: false,
                    filters: this._colSel.GlAccountText.map(v =>
                        new sap.ui.model.Filter("GlAccountText", sap.ui.model.FilterOperator.Contains, v)
                    )
                }));
            }

            // ✅ 이전 Application 필터 신경쓰지 말고 “한 번에” 덮어쓰기
            oBinding.filter(aBase.concat(aSearch, aCol), sap.ui.model.FilterType.Application);
        },
        // ★ GL 전체 데이터에서 인덱스 구성
        _rebuildGlIndex: function (arr) {
            this._glIndex = {};
            (arr || []).forEach(it => {
                const code = it.GLAccount;
                const name = it.GLAccountLongName || it.GLAccountName || "";
                if (code) this._glIndex[String(code)] = name || "";
            });
        },

        // 토큰을 선택상태로부터 재구성(두 곳 모두 동기화)
        _syncGlTokensFromSel: function () {
            const toToken = (code, name) => new sap.m.Token({ key: String(code), text: `${name || code} (${code})` });
            const m = this.byId("MI_GlAccountSelected");
            const t = this.byId("MI_GlAccountTextSelected");
            if (m) m.destroyTokens();
            if (t) t.destroyTokens();

            // 이름(롱네임) 필요하면 GLALL 모델에서 역조회
            const model = (this.byId("M_GlAccount") || this.byId("M_GlAccountText"))?.getModel("GLALL");
            const items = (model && model.getProperty("/items")) || [];

            Array.from(this._glSel).forEach(code => {
                const row = items.find(r => String(r.GLAccount) === String(code));
                const token = toToken(code, row && row.GLAccountLongName);
                if (m) m.addToken(token.clone());
                if (t) t.addToken(token.clone());
            });
        },

        // 리스트 체크를 선택상태로부터 재구성(둘 다 동기화)
        _syncGlListSelectionFromSel: function () {
            const lists = [this.byId("L_GlAccount"), this.byId("L_GlAccountText"), this.byId("L_GLaccountFilterList")].filter(Boolean);
            const sel = new Set(Array.from(this._glSel).map(String));
            lists.forEach(L => {
                L.removeSelections(true);
                (L.getItems() || []).forEach(item => {
                    const bc = item.getBindingContext("GLALL");
                    const code = bc && String(bc.getProperty("GLAccount"));
                    if (code && sel.has(code)) L.setSelectedItem(item, true);
                });
            });
        },
        _resetGlAll: function () {
            // 1) 내부 선택상태 비우기
            this._glSel.clear();

            // 2) 컬럼필터 캐시에서 GL 관련 키 제거(혹시 남아있을 수 있으니)
            if (this._colFilters) {
                delete this._colFilters.GlAccount;
                delete this._colFilters.GlAccountText;
            }

            // 3) 실제 바인딩 필터 재적용(= GL 조건 없음 상태로 덮어쓰기)
            this._applyGlSelectionFilters();

            // 4) UI 체크/토큰 동시 초기화
            this._clearGlUiSelection();
        },
        // UI(리스트/토큰) 모두 비우기
        _clearGlUiSelection: function () {
            // 리스트 체크 해제
            ["L_GlAccount", "L_GlAccountText", "L_GLaccountFilterList"].forEach(id => {
                const L = this.byId(id);
                if (L) L.removeSelections(true);
            });
            // 토큰 제거
            ["MI_GlAccountSelected", "MI_GlAccountTextSelected"].forEach(id => {
                const MI = this.byId(id);
                if (MI) MI.setTokens([]);
            });
        },

        // MI_GlAccountSelected / MI_GlAccountTextSelected 의 tokenDelete 이벤트에 연결
        onGlTokenDelete: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            this._onGlTokenDelete(sKey);
        },

        // 1) 필터 적용 함수는 async + 안정화 대기 후 칠하기
        _applyGlSelectionFilters: async function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            const base = this._getTableFilter();
            const search = this._buildSearchFilters(this._lastTableQuery);

            // 다른(비 GL) 컬럼 필터 병합
            const otherCols = Object.entries(this._colFilters || {})
                .filter(([p]) => !/^glaccount(text)?$/i.test(p))
                .map(([p, v]) => this._buildFilterForValueWithType(p, v))
                .flat();

            const all = base.concat(search, otherCols);

            // GL 계정 필터(다중 OR)
            if (this._glSel && this._glSel.size > 0) {
                const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
                const codes = Array.from(this._glSel).map(String);
                all.push(new Filter({
                    and: false,
                    filters: codes.map(c => new Filter("GlAccount", OP.EQ, c))
                }));
            }

            // GL 내역(텍스트) 필터(다중 OR, Contains)
            if (this._glTextSel && this._glTextSel.size > 0) {
                const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
                const texts = Array.from(this._glTextSel).map(String);
                all.push(new Filter({
                    and: false,
                    filters: texts.map(t => new Filter("GlAccountText", OP.Contains, t))
                }));
            }

            oBinding.filter(all, sap.ui.model.FilterType.Application);

            // 안정화 대기 → 칠하기
            await this._waitRowsSettled(oTable, 180);
            this._refreshColumnIndexMap?.();
            this._applyGroupRowColors?.();
        },


        _applyGroupRowColors: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            const first = oTable.getFirstVisibleRow();
            const aRows = oTable.getRows();

            // 1) "property 이름"으로만 대상 컬럼 결정
            const FIELDS = new Set([
                "PeriodBalance",
                "ComparisonBalance",
                "AbsoluteDifference",
                "RelativeDifference",
                "CompanyCodeCurrency"
            ]);

            const inferProp = (col) => {
                let p = (col.getFilterProperty && col.getFilterProperty()) ||
                    (col.getSortProperty && col.getSortProperty());
                if (!p) {
                    try {
                        const t = col.getTemplate && col.getTemplate();
                        const b = t && (t.getBinding && (t.getBinding("text") || t.getBinding("value") || t.getBinding("number")));
                        if (b && b.getPath) p = b.getPath();
                    } catch (e) { }
                }
                if (!p) {
                    const id = col.getId && String(col.getId());
                    const m = id && id.match(/COL_(.+)$/);
                    if (m) p = m[1];
                }
                return p;
            };

            // 화면에 보이는 컬럼들 -> 각 셀 index마다 연결된 property 구함
            const visCols = oTable.getColumns().filter(c => c.getVisible && c.getVisible());
            const cellPropList = visCols.map(inferProp); // 셀 index -> property 이름

            // 2) 각 행에 대해 클래스 제거 -> 조건 맞으면 다시 칠하기
            for (let i = 0; i < aRows.length; i++) {
                const rowCtrl = aRows[i];
                const ctx = oBinding.getContextByIndex(first + i);
                const obj = ctx && ctx.getObject && ctx.getObject();
                const cells = rowCtrl.getCells ? rowCtrl.getCells() : [];

                // 모두 지우기
                cells.forEach(c => {
                    if (!c) return;
                    c.removeStyleClass("sumCellYellow");
                    const $td = c.$().closest("td");
                    if ($td && $td.length) {
                        $td.removeClass("sumCellYellow");
                        $td.css("background-color", "");
                    }
                });

                if (!obj) continue;
                if (this._isBSorPLRow(obj)) continue;

                // 집계행(GlAccount 없음) 이거나, 금액이 하나라도 있는 리프면 칠하기
                const isGroup = !obj.GlAccount;
                const hasAmt = this._hasAnyAmount(obj, [
                    "PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"
                ]);
                if (!(isGroup || hasAmt)) continue;

                // 3) property 이름이 FIELDS에 들어있는 셀만 칠함 (열 순서/개인화/북마크 무관)
                for (let ci = 0; ci < cells.length; ci++) {
                    const prop = cellPropList[ci];
                    if (!prop || !FIELDS.has(prop)) continue;

                    const c = cells[ci];
                    c.addStyleClass("sumCellYellow");
                    const $td = c.$().closest("td");
                    if ($td && $td.length) {
                        $td.addClass("sumCellYellow");
                        // 혹시 테마 우선순위에 지면 인라인 백업
                        if (!$td[0].style.backgroundColor) {
                            $td.css("background-color", "#fff7bf");
                        }
                    }
                }
            }
        },
        _makeGLAccountSorters: function () {
            // primary: 첫 자리(1~7) 오름차순, secondary: 전체 숫자 오름차순
            const cmp = function (a, b) {
                const A = String(a || "").trim();
                const B = String(b || "").trim();

                // 첫 자리 숫자 그룹 (1~7), 없으면 99로 뒤로
                const fa = /^\d/.test(A) ? parseInt(A[0], 10) : 99;
                const fb = /^\d/.test(B) ? parseInt(B[0], 10) : 99;
                if (fa !== fb) return fa - fb;

                // 전체 숫자 비교(숫자 아닌 문자는 제거)
                const na = parseInt(A.replace(/\D/g, ""), 10);
                const nb = parseInt(B.replace(/\D/g, ""), 10);
                if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;

                // 최종 fallback: 문자열 비교
                return A.localeCompare(B);
            };

            // descending=false (오름차순)
            return [new sap.ui.model.Sorter("GLAccount", false, null, cmp)];
        },
        // 선택된 코드 셋을 "진실"로 확정하고 UI/필터 모두 동기화

        // 토큰을 두 MultiInput에 동기화 (양방향 삭제 지원)
        _syncGLTokens: function () {
            const dict = this._glDict || {};
            const keys = Array.from(this._glKeys || []);

            const makeToken = (k) => {
                const nm = dict[k] || k;
                const t = new sap.m.Token({ key: k, text: `${nm} (${k})` });
                t.attachDelete(() => {
                    const next = new Set(this._glKeys || []);
                    next.delete(String(k));
                    this._setGLKeys(next, "token-delete");
                });
                return t;
            };

            const mi1 = this.byId("MI_GlAccountSelected");
            const mi2 = this.byId("MI_GlAccountTextSelected");
            if (mi1) mi1.setTokens(keys.map(makeToken)); // 새 인스턴스
            if (mi2) mi2.setTokens(keys.map(makeToken)); // 또 다른 새 인스턴스
        },
        _sameSet: function (a, b) {
            if (!a || !b || a.size !== b.size) return false;
            for (const v of a) if (!b.has(v)) return false;
            return true;
        },

        _setGLKeys: function (keys, cause) {
            const next = new Set([...(keys || [])].map(String));
            if (this._sameSet(this._glKeys, next)) return; // ✅ 불필요한 재적용/루프 방지

            this._glKeys = next;

            // 1) 토큰 동기화
            this._syncGLTokens();

            // 2) 리스트 선택 복원(이벤트 억제)
            this._restoreSelectionsInList("L_GlAccount");
            this._restoreSelectionsInList("L_GlAccountText");

            // 3) 테이블 필터 적용
            this._applyGLAccountFilterFromKeys();
        },

        // 현재 전역 키셋 기준으로 리스트 선택 복원
        _restoreSelectionsInList: function (listId) {
            const oList = this.byId(listId);
            const b = oList && oList.getBinding("items");
            if (!oList || !b) return;

            const want = this._glKeys;
            (oList.getItems() || []).forEach(item => {
                const ctx = item.getBindingContext("GLALL");
                const k = ctx && String(ctx.getProperty("GLAccount") || "");
                if (!k) return;
                oList.setSelectedItem(item, want.has(k), true);
            });
        },

        // 전역 키셋으로 실제 테이블 필터 적용 (Application 영역)
        _applyGLAccountFilterFromKeys: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;

            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;

            // 1) 기존 Application 필터 트리에서 GlAccount만 제거(재귀)
            const stripPath = (f, path) => {
                if (!f) return null;
                // MultiFilter?
                if (f._bMultiFilter || f.aFilters) {
                    const children = (f.aFilters || []).map(x => stripPath(x, path)).filter(Boolean);
                    if (!children.length) return null;
                    return new Filter({ filters: children, and: !!f.bAnd });
                }
                // 단일 Filter
                return (f.sPath === path) ? null : f;
            };

            const prevApp = (ob.aApplicationFilters || []);
            const others = [];
            prevApp.forEach(f => {
                const kept = stripPath(f, "GlAccount");
                if (kept) others.push(kept);
            });

            // 2) 현재 선택 키셋으로 OR 필터 새로 구성
            let glOr = null;
            if (this._glKeys && this._glKeys.size) {
                const ors = Array.from(this._glKeys).map(k => new Filter("GlAccount", OP.EQ, String(k)));
                glOr = new Filter({ and: false, filters: ors });
            }

            // 3) 교체 적용 (Application 영역)
            const next = glOr ? others.concat(glOr) : others;
            ob.filter(next, sap.ui.model.FilterType.Application);

            // (선택) 색/하이라이트 재적용
            this._applyGroupRowColors && this._applyGroupRowColors();
            this._restoreSelectionsInList("L_GlAccount");
            this._restoreSelectionsInList("L_GlAccountText");
        },
        // ========================================================
        // GLACCOUNT 메뉴 오픈
        // ========================================================
        onGlAccountMenuBeforeOpen: async function () {
            try {
                // 1) 전량 데이터 로딩 (캐시 사용)
                const data = await this._loadGLAll();

                const oList = this.byId("L_GlAccount");
                const oMenu = this.byId("M_GlAccount");
                const oMI = this.byId("MI_GlAccountSelected");
                if (!oList || !oMenu || !oMI) return;

                // 2) 정규화 + 중복 제거
                const normalized = (data || []).map(it => ({
                    GLAccount: String(it.GLAccount || it.GlAccount || it.account || "").trim(),
                    GLAccountLongName: String(it.GLAccountLongName || it.GlAccountLongName || it.accountName || "").trim()
                })).filter(it => it.GLAccount && it.GLAccountLongName);

                const unique = this._removeDuplicates
                    ? this._removeDuplicates(normalized, "GLAccount")
                    : Array.from(new Map(normalized.map(x => [x.GLAccount, x])).values());

                // 3) 모델 구성 & 바인딩
                const m = new sap.ui.model.json.JSONModel({ items: unique });
                this.getView().setModel(m, "GLALL");
                oList.setModel(m, "GLALL");

                // 4) 소팅(숫자 오름차순; 1→2→…→7 우선 정렬)
                const numComparator = (a, b) => {
                    const na = parseInt(a, 10), nb = parseInt(b, 10);
                    if (isNaN(na) || isNaN(nb)) return a === b ? 0 : (a > b ? 1 : -1);
                    // 첫자리 우선 → 같은 첫자리면 전체 숫자 비교
                    const fa = String(na)[0], fb = String(nb)[0];
                    if (fa !== fb) return fa > fb ? 1 : -1;
                    return na - nb;
                };
                const sorters = this._makeGLAccountSorters
                    ? this._makeGLAccountSorters()
                    : [new sap.ui.model.Sorter("GLAccount", false, null, numComparator)];

                oList.unbindItems();
                oList.bindItems({
                    path: "GLALL>/items",
                    sorter: sorters,
                    template: new sap.m.StandardListItem({
                        title: "{GLALL>GLAccount}",
                        description: "{GLALL>GLAccountLongName}",
                       selected: "{= ${GLALL>__sel} === true }" 
                    })
                });

                // 남아있던 검색/필터/소터 제거
                const b = oList.getBinding("items");
                if (b) { b.filter([]); b.sort([]); }

                // 5) UI/성능(스크롤/더보기/크기)
                oList.setGrowing(true);
                oList.setGrowingScrollToLoad(false);
                oList.setGrowingThreshold(Math.max(200, Math.min(unique.length, 2000)));
                if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
                if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

                // 6) 선택 복원(토큰 ∪ 메모리)
                const prior = new Set([...(this._glKeys || new Set())]);
                (oMI.getTokens() || []).forEach(t => prior.add(String(t.getKey())));

                // setTimeout(() => {
                //     (oList.getItems() || []).forEach(item => {
                //         const k = item.getBindingContext("GLALL")?.getProperty("GLAccount");
                //         if (k && prior.has(String(k))) {
                //             // suppressSelectionEvent 사용 안 함(선택 UI만 복원)
                //             oList.setSelectedItem(item, true);
                //         }
                //     });
                // }, 0);
                setTimeout(() => { this._restoreSelectionsInList("L_GlAccount"); }, 0);
            } catch (e) {
                console.error(e);
                sap.m.MessageToast.show("G/L 계정 목록 로딩 중 오류가 발생했습니다.");
            }
            this._menuOpen = true;
            this._glStage = new Set(Array.from(this._glKeys || []));   // ← 커밋값 복사
            this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
            this._previewTokensFromSet(this._glStage);
            this._attachSelSyncOnce("L_GlAccount");
        },

        // ========================================================
        // GLACCOUNTTEXT(내역) 메뉴 오픈
        // ========================================================
        onColumnMenuBeforeOpen: async function () {
            try {
                // 1) 전량 데이터 로딩 (캐시 사용)
                const data = await this._loadGLAll();

                const oList = this.byId("L_GlAccountText");
                const oMenu = this.byId("M_GlAccountText");
                const oMI = this.byId("MI_GlAccountTextSelected");
                if (!oList || !oMenu || !oMI) return;

                // 2) 정규화 + 중복 제거
                const normalized = (data || []).map(it => ({
                    GLAccount: String(it.GLAccount || it.GlAccount || it.account || "").trim(),
                    GLAccountLongName: String(it.GLAccountLongName || it.GlAccountLongName || it.accountName || "").trim()
                })).filter(it => it.GLAccount && it.GLAccountLongName);

                const unique = this._removeDuplicates
                    ? this._removeDuplicates(normalized, "GLAccount")
                    : Array.from(new Map(normalized.map(x => [x.GLAccount, x])).values());

                // 3) 모델 구성 & 바인딩 (제목=내역, 설명=계정)
                const m = new sap.ui.model.json.JSONModel({ items: unique });
                this.getView().setModel(m, "GLALL");
                oList.setModel(m, "GLALL");

                // 4) 소팅(계정 기준 숫자 오름차순)
                const numComparator = (a, b) => {
                    const na = parseInt(a, 10), nb = parseInt(b, 10);
                    if (isNaN(na) || isNaN(nb)) return a === b ? 0 : (a > b ? 1 : -1);
                    const fa = String(na)[0], fb = String(nb)[0];
                    if (fa !== fb) return fa > fb ? 1 : -1;
                    return na - nb;
                };
                const sorters = this._makeGLAccountSorters
                    ? this._makeGLAccountSorters()
                    : [new sap.ui.model.Sorter("GLAccount", false, null, numComparator)];

                oList.unbindItems();
                oList.bindItems({
                    path: "GLALL>/items",
                    sorter: sorters,
                    template: new sap.m.StandardListItem({
                        title: "{GLALL>GLAccountLongName}",
                        description: "{GLALL>GLAccount}",
                        selected: "{= ${GLALL>__sel} === true }" 
                    })
                });

                // 남아있던 검색/필터/소터 제거
                const b = oList.getBinding("items");
                if (b) { b.filter([]); b.sort([]); }

                // 5) 더보기 버튼 & 컨테이너 사이즈
                oList.setGrowing(true);
                oList.setGrowingScrollToLoad(false);
                if (oList.setGrowingTriggerText) {
                    oList.setGrowingTriggerText(this.i18n?.getText("more") || "더보기");
                }
                oList.setGrowingThreshold(Math.max(80, Math.min(unique.length, 1000)));
                if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
                if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

                // 6) 선택 복원(토큰 ∪ 메모리)
                const prior = new Set([...(this._glTextKeys || new Set())]);
                (oMI.getTokens() || []).forEach(t => prior.add(String(t.getKey())));

                // setTimeout(() => {
                //     (oList.getItems() || []).forEach(item => {
                //         const k = item.getBindingContext("GLALL")?.getProperty("GLAccount");
                //         if (k && prior.has(String(k))) {
                //             oList.setSelectedItem(item, true);
                //         }
                //     });
                // }, 0);
                setTimeout(() => { this._restoreSelectionsInList("L_GlAccountText"); }, 0);
            } catch (e) {
                console.error(e);
                sap.m.MessageToast.show("G/L 내역 목록 로딩 중 오류가 발생했습니다.");
            }
            this._menuOpen = true;
            this._glStage = new Set(Array.from(this._glKeys || []));   // ← 커밋값 복사
            this._restoreSelectionsFromSet("L_GlAccountText", this._glStage);
            this._previewTokensFromSet(this._glStage);
            this._attachSelSyncOnce("L_GlAccountText");
        },
_setAllModelSelection: function (checked) {
  const m = this.getView().getModel("GLALL");
  const items = m?.getProperty("/items") || [];
  items.forEach(it => it.__sel = !!checked); // ★ 전량 플래그
  m.refresh(true);
},


        _setListSelectionFromSel: function (oList) {
            if (!oList) return;
            const items = oList.getItems() || [];
            const sel = this._glSel;
            items.forEach(item => {
                const ctx = item.getBindingContext("GLALL");
                const code = ctx && ctx.getProperty("GLAccount");
                if (code != null) oList.setSelectedItem(item, sel.has(String(code)));
            });
        },
        // 전역(컨트롤러 인스턴스)에서 SSOT
        _selGL: new Set(),

        _getAllGLKeys: function () {
            const m = this.getView().getModel("GLALL");
            return (m?.getProperty("/items") || [])
                .map(it => String(it.GLAccount))
                .filter(Boolean);
        },

onGlAccountToggleAll: function (ev) {
  if (!this._menuOpen) return;
  const checked = !!ev.getParameter("selected");
  this._setAllModelSelection(checked);

  const all = this._getAllGLKeys();           // GLALL>/items 전량 키
  this._glStage = new Set(checked ? all : []); // ★ 전량을 스테이징에
  this._previewTokensFromSet(this._glStage);   // 토큰 미리보기(요약 추천)
},

onGlAccountTextToggleAll: function (ev) {
  if (!this._menuOpen) return;
  const checked = !!ev.getParameter("selected");
  this._setAllModelSelection(checked);

  const all = this._getAllGLKeys();
  this._glStage = new Set(checked ? all : []);
  this._previewTokensFromSet(this._glStage);
},


        _attachSelSyncOnce: function (listId) {
            const L = this.byId(listId);
            if (!L || L.__selSyncAttached) return;
            L.__selSyncAttached = true;

            // 리스트가 새로 그려질 때마다(더보기/검색/소트 등) 현재 스테이징에 맞춰 UI 선택 복원
            L.attachUpdateFinished(() => {
                const set = this._menuOpen ? (this._glStage || this._glKeys || new Set()) : (this._glKeys || new Set());
                this._restoreSelectionsFromSet(listId, set);
            });

            // 선택 기억 기능 켜두면 스크롤/리렌더에도 안정적
            if (typeof L.setRememberSelections === "function") {
                L.setRememberSelections(true);
            }
        },

        _previewTokensFromSet: function (set) {
            const map = this._getGLAllMap(); // GLAccount -> GLAccountLongName 맵
            const keys = Array.from(set || new Set());
            ["MI_GlAccountSelected", "MI_GlAccountTextSelected"].forEach(id => {
                const mi = this.byId(id); if (!mi) return;
                mi.destroyTokens();
                keys.forEach(k => {
                    const name = map.get(String(k)) || String(k);
                    mi.addToken(new sap.m.Token({ key: String(k), text: `${name} (${k})` }));
                });
            });
        },

        _restoreSelectionsFromSet: function (listId, set) {
            const L = this.byId(listId); const b = L && L.getBinding("items");
            if (!L || !b) return;
            const want = new Set(Array.from(set || new Set()).map(String));
            L.removeSelections(true);
            (L.getItems() || []).forEach(it => {
                const k = it.getBindingContext("GLALL")?.getProperty("GLAccount");
                if (!k) return;
                L.setSelectedItem(it, want.has(String(k)), true/*suppress*/);
            });
        },

    });
});

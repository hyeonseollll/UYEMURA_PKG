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
        Table: { T_Main: "T_Main", L_GlAccount: "L_GlAccount", L_GlAccountText: "L_GlAccountText" },
        Button: { B_Excel: "B_Excel", B_Print: "B_Print" },
        SearchField: { SF_GlAccount: "SF_GlAccount", SF_GlAccountText: "SF_GlAccountText" }
    };
    const CUSTOM_PARAM_MAP = {
        NodeText: "LP_NODETEXT",
        GlAccount: "LP_GLACCOUNT",
        GlAccountText: "LP_GLACCOUNTTEXT"
    };

    // === 북마크(앱 내부) 유틸 ===
    const BM_KEY = "zgspkgco0060.bookmarks.v1";
    const BOOKMARK = {
        headSet: "/BookMark_Head",      // 헤더 엔티티셋 이름
        itemSet: "/BookMark_Item",      // 아이템 엔티티셋 이름
        headToItemsNav: "to_Items"      // 헤더→아이템 네비게이션 이름 (Deep Insert용)
    };
    let oView;               // cached view
    let vVHGL;               // GL Value Help model

    let aTokenSeletedGLAccount = [];
    let aTokenSeletedGLAccountOrg = [];

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

            // OData 모델의 기본 페이지 크기 제한을 오버라이드
            if (oVH && oVH.setSizeLimit) {
                oVH.setSizeLimit(10000);
            }

            oVH.read("/F_GLAccount_VH", {
                success: function (oData) {
                },
                error: function (oError) {
                }
            });

            if (!oVH) {
                jQuery.sap.log.error("F_GLAccount_VH model not found on view");
            } else {
                this.getView().setModel(oVH, "F_GLAccount_VH"); // 보수적으로 뷰에도 보장
            }

            // 메인 OData 모델의 기본 페이지 크기 제한도 오버라이드
            const oMainModel = this.getOwnerComponent().getModel();
            if (oMainModel && oMainModel.setSizeLimit) {
                oMainModel.setSizeLimit(10000);
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

        onExit: function () {
            try {
                const oFB = this.byId(Control.FilterBar.FB_MainSearch);
                if (oFB && this._fbDelegate) oFB.removeEventDelegate(this._fbDelegate);
            } catch (e) { /* noop */ }

            // Toolbar 관련 정리
            try {
                if (this._glTextPop && this._glTextPop.getFooter) {
                    const footer = this._glTextPop.getFooter();
                    if (footer && footer.destroy) {
                        footer.destroy();
                    }
                }
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
            // GL 페이징 상태 초기화
            this._glPaged = false;
            this._glPages = [];
            this._glPageIndex = 0;

            // 북마크가 로드된 상태가 아니면 북마크 상태 초기화
            if (!this._bookmarkRestored) {
                this._savedBookmarkState = null;
            } else {
            }

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

            // 북마크가 로드된 상태인지 확인
            const hasBookmarkState = this._bookmarkRestored;

            oTable.setBusy(true);
            oTable.unbindRows();
            this._bInitialExpandDone = false;

            // 북마크가 로드된 상태가 아니면 플래그 리셋
            if (!hasBookmarkState) {
                this._bookmarkRestored = false;

            } else {

            }

            // GLAccount 선택 시에만 125개 단위 페이징 분기
            const aSelGL = this._getSelectedGlKeysForPaging();
            if (aSelGL && aSelGL.length > 0) {
                const chunks = [];
                const pageSize = 125;
                for (let i = 0; i < aSelGL.length; i += pageSize) {
                    chunks.push(aSelGL.slice(i, i + pageSize));
                }
                this._glPages = chunks;
                this._glPageIndex = 0;
                this._glPaged = true;
                this._bindTableWithGlPage(oTable, this._glPageIndex);
            } else {
                this._bindTable(oTable);
            }
        },
        onExport: async function () {
            const oBExcel = this.getView().byId(Control.Button.B_Excel);
            if (oBExcel) oBExcel.setBusy(true);

            const oTreeTable = this.getView().byId(Control.Table.T_Main);
            const oRowBinding = oTreeTable && oTreeTable.getBinding('rows');
            if (!oRowBinding) { if (oBExcel) oBExcel.setBusy(false); return; }

            try {
                // 1) 전체 데이터 수집 (페이징된 경우 모든 페이지)
                let aExportData = [];
                
                if (this._glPaged && this._glPages && this._glPages.length > 0) {
                    // GL 계정 페이징된 경우: 모든 페이지의 데이터를 순차적으로 가져옴
                    const oTable = this.byId(Control.Table.T_Main);
                    const originalPageIndex = this._glPageIndex;
                    
                    for (let pageIndex = 0; pageIndex < this._glPages.length; pageIndex++) {
                        // 각 페이지를 바인딩하고 데이터 수집
                        this._bindTableWithGlPage(oTable, pageIndex);
                        await this._waitForDataLoad(oTable);
                        
                        const pageData = this._collectCurrentPageData(oTable);
                        aExportData = aExportData.concat(pageData);
                    }
                    
                    // 원래 페이지로 복원
                    this._bindTableWithGlPage(oTable, originalPageIndex);
                } else {
                    // 일반적인 경우: 현재 바인딩된 데이터 사용
            const iRowCount = oRowBinding.getLength();
            const aNodes = (typeof oRowBinding.getNodes === "function") ? oRowBinding.getNodes() : [];

            for (let i = 0; i < iRowCount; i++) {
                const ctx = oRowBinding.getContextByIndex(i);
                if (!ctx) continue;

                const oRowData = Object.assign({}, ctx.getObject());
                oRowData.HierarchyLevel = aNodes[i] ? aNodes[i].level : 0;
                        aExportData.push(oRowData);
                    }
                }

                // 2) 각 행에 포맷 적용 대신 숫자형 유지
                //    화면 포맷팅 문자열을 엑셀에 쓰면 텍스트가 되므로 숫자 변환하되,
                //    BS/PL 라인에서는 0 값을 빈 칸(null)로 내보내도록 처리합니다.
                aExportData = aExportData.map(oRowData => {
                    const toNumber = (v) => {
                        if (typeof v === "number") return v;
                        if (v == null) return 0;
                        // 화면에서 온 문자열일 경우 모든 비숫자/구분기호 제거 후 숫자 변환
                        const n = Number(String(v).replace(/[^\d.-]/g, ""));
                        return isNaN(n) ? 0 : n;
                    };

                    const isBSPL = (this._isBSorPLRow ? this._isBSorPLRow(oRowData) : false);

                    const vPB = toNumber(oRowData.PeriodBalance);
                    const vCB = toNumber(oRowData.ComparisonBalance);
                    const vAD = toNumber(oRowData.AbsoluteDifference);
                    const vRD = toNumber(oRowData.RelativeDifference);

                    oRowData.PeriodBalance = (isBSPL && vPB === 0) ? null : vPB;
                    oRowData.ComparisonBalance = (isBSPL && vCB === 0) ? null : vCB;
                    
                    // 절대차이는 100을 곱하고 정수로 변환 (숫자 타입 유지)
                    if (isBSPL && vAD === 0) {
                        oRowData.AbsoluteDifference = null;
                    } else {
                        const absDiffValue = Math.round(vAD * 100);
                        // 숫자 타입으로 유지 (엑셀 포맷에서 쉼표 처리)
                        oRowData.AbsoluteDifference = absDiffValue;
                    }
                    
                    // 상대차이는 소수점 4자리로 포맷팅
                    if (isBSPL && vRD === 0) {
                        oRowData.RelativeDifference = null;
                    } else {
                        oRowData.RelativeDifference = parseFloat(vRD.toFixed(4));
                    }

                    return oRowData;
                });

                // 3) 기본 컬럼 정의 가져오기 (정적 → 동적)
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


            // 4) 스프레드시트 설정 및 생성 (요약 행 색칠 포함)
            // 각 행에 스타일 정보를 추가
            const aStyledData = aExportData.map((rowData) => {
                const hasGl = !!(rowData.GlAccount && rowData.GlAccount.toString().trim());
                const hasAmt = this._hasAnyAmount(rowData, [
                    "PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"
                ]);
                const isSummaryRow = !hasGl && hasAmt;
                
                // 스타일 정보를 데이터에 추가
                const styledRow = Object.assign({}, rowData);
                if (isSummaryRow) {
                    styledRow.__style = 'summaryRowStyle';
                }
                return styledRow;
            });

            const oSettings = {
                workbook: { 
                    columns: aCols, 
                    hierarchyLevel: 'HierarchyLevel',
                    styles: [
                        {
                            name: 'summaryRowStyle',
                            backgroundColor: '#fff7bf'
                        }
                    ]
                },
                dataSource: aStyledData,
                fileName: (this.i18n.getText("title") || "Report") + "_" + (new Date()).toISOString() + '.xlsx',
                worker: true
            };

            const oSheet = new Spreadsheet(oSettings);
            oSheet.build().finally(() => {
                oSheet.destroy();
                if (oBExcel) oBExcel.setBusy(false);
            });

            } catch (error) {
                console.error("엑셀 다운로드 중 오류 발생:", error);
                sap.m.MessageToast.show("엑셀 다운로드 중 오류가 발생했습니다.");
                if (oBExcel) oBExcel.setBusy(false);
            }
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
            // 화면 하이라이트 동기화: 현재 화면에서 하이라이트된 행 키 수집
            const highlightKeySet = this._collectScreenHighlightKeySet(oTable, oBinding);
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
                colPercents: percents,
                highlightKeySet
            });
            const w = window.open("", "_blank");
            w.document.open();
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => { w.print(); /* w.close(); */ }, 200);
        },
        // 화면의 하이라이트 상태를 기반으로 프린트용 하이라이트 키 세트 생성
        _collectScreenHighlightKeySet: function (oTable, oBinding) {
            try {
                const set = new Set();
                if (!oTable || !oBinding) return set;
                const len = oBinding.getLength();
                const uiRows = typeof oTable.getRows === "function" ? oTable.getRows() : [];
                for (let i = 0; i < len; i++) {
                    const ctx = oBinding.getContextByIndex(i);
                    if (!ctx) continue;
                    const obj = ctx.getObject();
                    const key = this._rowKey(obj);
                    if (!key) continue;
                    const uiRow = uiRows[i];
                    if (!uiRow || typeof uiRow.$ !== "function") continue;
                    const $r = uiRow.$();
                    if (!$r) continue;
                    const isHit = uiRow.hasStyleClass && (uiRow.hasStyleClass("myHitRow") || uiRow.hasStyleClass("myHitActive"));
                    const hasSumYellow = $r.find("td.sumCellYellow").length > 0;
                    if (isHit || hasSumYellow) set.add(key);
                }
                return set;
            } catch (e) {
                return new Set();
            }
        },
        _rowKey: function (r) {
            if (!r || typeof r !== "object") return "";
            return String(r.Node ?? r.NodeID ?? r.GlAccount ?? r.GLAccount ?? r.Nodetext ?? r.NodeText ?? "") + "|" + String(r.HierarchyLevel ?? "");
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



        // ========================================================================
        // GL ACCOUNT TEXT FILTER FUNCTIONS (Updated)
        // ========================================================================

        // GL 공통 유틸: 중복 제거
        _removeDuplicates: function (aArray, sKey) {
            const oSeenSet = new Set();
            return aArray.filter(oItem => {
                const v = oItem[sKey];
                if (oSeenSet.has(v)) return false;
                oSeenSet.add(v);
                return true;
            });
        },

        // GL 공통 유틸: GLALL 맵(GLAccount→LongName)
        _getGLAllMap: function () {
            const aItems = this.getView().getModel("GLALL")?.getProperty("/items") || [];
            const oMap = new Map();
            aItems.forEach(oIt => oMap.set(String(oIt.GLAccount), String(oIt.GLAccountLongName || oIt.GLAccount)));
            return oMap;
        },

        onGlAccountMenuConfirm: function () {
            try {
                // _glStage를 우선적으로 사용 (실제 선택된 항목)
                let keys = Array.from(this._glStage || []);
                if (!keys.length) keys = this._getStageKeysFromModel();

    

                // _setGLKeys 호출 (menu-ok로 _glKeys 업데이트)
                this._setGLKeys(keys, "menu-ok");

                aTokenSeletedGLAccountOrg = aTokenSeletedGLAccount;
                // 토큰을 두 입력 모두에 즉시 동기화
                if (typeof this._syncGlTokensFromSel === "function") {
                    this._syncGlTokensFromSel();
                } else if (typeof this._syncGLTokens === "function") {
                    this._syncGLTokens();
                }

                // 추가 보강: GLACCOUNT 선택을 GLACCOUNTTEXT 토큰에도 바로 반영
                // 대량일 경우 토큰 렌더링은 생략(성능)
            } finally {
                this.byId("M_GlAccount")?.close();
                this._menuOpen = false;
            }
        },

        onGlAccountTextMenuConfirm: function () {
            try {
                let keys = Array.from(this._glStage || []);
                if (!keys.length) keys = this._getStageKeysFromModel();

                // _setGLKeys 호출 (menu-ok로 _glKeys 업데이트)
                this._setGLKeys(keys, "menu-ok");
                aTokenSeletedGLAccountOrg = aTokenSeletedGLAccount;
                // 토큰을 두 입력 모두에 즉시 동기화
                if (typeof this._syncGlTokensFromSel === "function") {
                    this._syncGlTokensFromSel();
                } else if (typeof this._syncGLTokens === "function") {
                    this._syncGLTokens();
                }
                // 내부 상태 업데이트: 텍스트 선택도 동일하게 전역 키셋 반영
                try { this._setGLKeys(new Set(keys), "menu-confirm-gltext"); } catch (e) { /* noop */ }

                // 추가 보강: GLACCOUNTTEXT 선택을 GLACCOUNT 토큰에도 바로 반영
                // 대량일 경우 토큰 렌더링은 생략(성능)
            } finally {
                this.byId("M_GlAccountText")?.close();
                this._menuOpen = false;
            }
        },

        onGlAccountMenuCancel: function () {
            this._menuOpen = false;
            this._glStage = null;
            this.byId("M_GlAccount")?.close();
        },

        onGlAccountTextMenuCancel: function () {
            this._menuOpen = false;
            this._glStage = null;
            this.byId("M_GlAccountText")?.close();
        },

        onGlAccountSelectionChange: function (oEvent) {
            if (!this._menuOpen) return;

            // 선택 복원 중이면 이벤트 무시
            if (this._isRestoringSelections) {
           
                return;
            }

            let aSelectedIndex = oEvent.getSource().getSelectedIndices();
            let aSelectedContext = aSelectedIndex.map(function (iSelectedIndex) {
                return oEvent.getSource().getContextByIndex(iSelectedIndex)
            })

            let aSelectedGLAccount = aSelectedContext.map((oContext) => {
                return oContext.getProperty('GLAccount');
            })

            const keys = new Set(aSelectedGLAccount);
            this._glStage = keys;



            this._previewTokensFromSet(this._glStage);
        },

        onGlAccountToggleAll: function (oEvent) {
            const bSelected = !!oEvent.getParameter("selected");
            // 렉 방지: 대량 선택 시 테이블 UI 선택 갱신 생략하고 모델에서 직접 키 수집
            try {
                const aItems = this.getView().getModel("GLALL")?.getProperty("/items") || [];
                this._glStage = bSelected ? new Set(aItems.map(it => String(it.GLAccount))) : new Set();
                // _glKeys는 OK 버튼에서만 업데이트

                // 토큰 생성
                this._previewTokensFromSet(this._glStage, "ToggleAll");
            } catch (e) {
                this._glStage = bSelected ? this._glStage || new Set() : new Set();
            }
        },

        onGlAccountTextSelectionChange: function (oEvent) {
            if (!this._menuOpen) return;

            // 선택 복원 중이면 이벤트 무시
            if (this._isRestoringSelections) {
        
                return;
            }

            let aSelectedIndex = oEvent.getSource().getSelectedIndices();
            let aSelectedContext = aSelectedIndex.map(function (iSelectedIndex) {
                return oEvent.getSource().getContextByIndex(iSelectedIndex)
            })

            let aSelectedGLAccount = aSelectedContext.map((oContext) => {
                return oContext.getProperty('GLAccount');
            })

            const keys = new Set(aSelectedGLAccount);
            this._glStage = keys;
            this._previewTokensFromSet(this._glStage);
        },

        // 현재 리스트 바인딩으로부터 선택된 GL 코드 배열을 추출 (GL/GLText 공용)
        _getStageKeysFromModel: function () {
            try {
                const listIds = ["L_GlAccount", "L_GlAccountText"];
                for (const id of listIds) {
                    const oList = this.byId(id);
                    if (!oList) continue;
                    const aIdx = oList.getSelectedIndices ? oList.getSelectedIndices() : [];
                    if (!aIdx || aIdx.length === 0) continue;
                    const out = [];
                    aIdx.forEach(i => {
                        const ctx = oList.getContextByIndex && oList.getContextByIndex(i);
                        const obj = ctx && ctx.getObject && ctx.getObject();
                        const code = obj && (obj.GLAccount || obj.GlAccount);
                        if (code) out.push(String(code));
                    });
                    if (out.length) return out;
                }
            } catch (e) { /* noop */ }
            return [];
        },

        onGlAccountTextToggleAll: function (oEvent) {
            const bSelected = !!oEvent.getParameter("selected");
            // 렉 방지: 대량 선택 시 테이블 UI 선택 갱신 생략하고 모델에서 직접 키 수집
            try {
                const aItems = this.getView().getModel("GLALL")?.getProperty("/items") || [];
                this._glStage = bSelected ? new Set(aItems.map(it => String(it.GLAccount))) : new Set();
            } catch (e) { this._glStage = bSelected ? this._glStage || new Set() : new Set(); }
            // 미리보기 토큰은 생성하지 않음(대량 토큰 생성 렉 방지)
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

            // 현재 스크롤 위치 저장
            const currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            const aColFilters = Object.entries(this._colFilters || {})
                .map(([path, val]) => this._buildFilterForValueWithType(path, val))
                .flat();

            ob.filter(aBase.concat(aSearch, aColFilters), sap.ui.model.FilterType.Application);

            // 필터 후 색/하이라이트 재적용 및 스크롤 위치 복원
            setTimeout(() => {
                this._applyGroupRowColors?.();
                this._refreshRowHighlights?.();

                // 스크롤 위치 복원 (필터 적용 후 데이터가 변경되어도 가능한 한 유지)
                if (oTable.setFirstVisibleRow && currentFirstVisibleRow > 0) {
                    // 약간의 지연을 두어 데이터 바인딩이 완료된 후 스크롤 위치 복원
                    setTimeout(() => {
                        const maxVisibleRows = oTable.getBinding("rows")?.getLength() || 0;
                        const targetRow = Math.min(currentFirstVisibleRow, Math.max(0, maxVisibleRows - 1));
                        if (targetRow >= 0) {
                            oTable.setFirstVisibleRow(targetRow);
                        }
                    }, 100);
                }
            }, 0);
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
                    else {
                        // 북마크 복원 후에는 자동 확장하지 않음
                        if (!this._bookmarkRestored) {
                            try { oTable.expandToLevel(99); } catch (e) { /*noop*/ }
                        }
                    }
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
                else {
                    // 북마크 복원 후에는 자동 확장하지 않음
                    if (!this._bookmarkRestored) {
                        try { oTable.expandToLevel(99); } catch (e) { /*noop*/ }
                    }
                }
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

            // 북마크 복원 후 사용자가 수동으로 노드를 접으면 플래그 리셋
            if (this._bookmarkRestored) {

                this._bookmarkRestored = false;
            }

            // 북마크 복원 후에는 setBusy 호출하지 않음 (즉시 접힘)
            const oTable = this.byId("T_Main");
            if (oTable && !this._bookmarkRestored) {
                // 일반적인 경우에만 짧은 로딩 표시
                oTable.setBusy(true);
                setTimeout(() => {
                    if (oTable.getBusy()) {
                        oTable.setBusy(false);
                    }
                }, 30);
            }
        },

        onExpand: function (oEvent) {
            const oContext = oEvent.getParameter("rowContext");
            if (!oContext) return;
            const sNodeId = oContext.getProperty("Node");
            this._collapsedNodes = this._collapsedNodes || new Set();
            this._collapsedNodes.delete(sNodeId);

            // 북마크 복원 후 사용자가 수동으로 노드를 펼치면 플래그 리셋
            if (this._bookmarkRestored) {

                this._bookmarkRestored = false;
            }

            // 북마크 복원 후에는 setBusy 호출하지 않음 (즉시 확장)
            const oTable = this.byId("T_Main");
            if (oTable && !this._bookmarkRestored) {
                // 일반적인 경우에만 짧은 로딩 표시
                oTable.setBusy(true);
                setTimeout(() => {
                    if (oTable.getBusy()) {
                        oTable.setBusy(false);
                    }
                }, 50);
            }
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

            // 현재 스크롤 위치 저장
            const currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);
            ob.filter(aBase.concat(aSearch), sap.ui.model.FilterType.Application);

            // 스크롤 위치 복원
            if (oTable.setFirstVisibleRow && currentFirstVisibleRow > 0) {
                setTimeout(() => {
                    const maxVisibleRows = oTable.getBinding("rows")?.getLength() || 0;
                    const targetRow = Math.min(currentFirstVisibleRow, Math.max(0, maxVisibleRows - 1));
                    if (targetRow >= 0) {
                        oTable.setFirstVisibleRow(targetRow);
                    }
                }, 100);
            }
        },
        // ========================================================================
        // TABLE BINDING & ODATA EVENTS
        // ========================================================================
        _bindTable: function (oTable) {
            if (!oTable) return;

            // 북마크 복원 완료 플래그 리셋
            this._bookmarkRestoreCompleted = false;

            // 북마크 상태가 있는 경우에만 플래그 유지
            if (!this._bookmarkRestored) {
                this._savedBookmarkState = null; // 북마크 상태가 없으면 초기화
            } else {
                // 북마크 상태가 있으면 _savedBookmarkState 유지
            }

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            // 전체 데이터를 가져오기 위해 OData 모델 설정
            const oModel = this._getOData();
            if (oModel) {
                // setSizeLimit 설정
                if (oModel.setSizeLimit) {
                    oModel.setSizeLimit(10000);
                }
                // defaultCountMode 설정
                if (oModel.setDefaultCountMode) {
                    oModel.setDefaultCountMode("Inline");
                }
            }

            oTable.bindRows({
                path: "/FinancialStatements",
                filters: aBase.concat(aSearch),  // ← 여기서만 합치면 됨
                parameters: {
                    countMode: "Inline",
                    operationMode: "Server",
                    threshold: 10000,  // 전체 데이터를 가져오기 위해 10000으로 증가
                    $top: 10000,  // 직접 $top 파라미터 추가
                    $skip: 0,  // 시작 인덱스
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

        // GLAccount 페이징 전용 바인딩
        _bindTableWithGlPage: function (oTable, pageIndex) {
            if (!oTable) return;
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            const aPages = Array.isArray(this._glPages) ? this._glPages : [];
            const idx = Math.max(0, Math.min(pageIndex | 0, Math.max(0, aPages.length - 1)));
            this._glPageIndex = idx;
            const curPage = aPages[idx] || [];

            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
            const aGlOr = curPage.length
                ? [new Filter({ and: false, filters: curPage.map(k => new Filter("GlAccount", OP.EQ, String(k))) })]
                : [];

            const oModel = this._getOData();
            if (oModel) {
                if (oModel.setSizeLimit) oModel.setSizeLimit(10000);
                if (oModel.setDefaultCountMode) oModel.setDefaultCountMode("Inline");
            }

            oTable.bindRows({
                path: "/FinancialStatements",
                filters: aBase.concat(aSearch, aGlOr),
                parameters: {
                    countMode: "Inline",
                    operationMode: "Server",
                    threshold: 10000,
                    $top: 10000,
                    $skip: 0,
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

            // 툴바 페이지 상태 갱신
            this._updateGlPagingToolbar();
        },

        // 현재 선택된 GL 토큰/스테이지로부터 키 배열 계산 (페이징 기준)
        _getSelectedGlKeysForPaging: function () {
            // 우선 전역 _glKeys 사용, 없으면 메뉴 스테이지나 토큰에서 추출
            if (this._glKeys && this._glKeys.size) return Array.from(this._glKeys).map(String);

            try {
                const mi = this.byId("MI_GlAccountSelected");
                const toks = mi && mi.getTokens ? mi.getTokens() : [];
                const keys = toks.map(t => String(t.getKey && t.getKey() || t.getText())).filter(Boolean);
                if (keys.length) return keys;
            } catch (e) { }

            if (this._glStage && this._glStage.size) return Array.from(this._glStage).map(String);
            return [];
        },

        // 툴바의 페이지 표시/버튼 상태 갱신
        _updateGlPagingToolbar: function () {
            try {
                const btnPrev = this.byId("B_GlPrevPage");
                const btnNext = this.byId("B_GlNextPage");
                const lbl = this.byId("L_GlPageInfo");
                const total = (this._glPages && this._glPages.length) || 0;
                const page = (this._glPageIndex | 0) + 1;
                if (btnPrev && btnPrev.setEnabled) btnPrev.setEnabled(this._glPaged && page > 1);
                if (btnNext && btnNext.setEnabled) btnNext.setEnabled(this._glPaged && page < total);
                if (lbl && lbl.setText) lbl.setText(total > 0 ? `${page}/${total}` : "");
            } catch (e) { /* noop */ }
        },

        // 툴바 버튼 핸들러: 이전/다음 페이지
        onGlPrevPage: function () {
            if (!this._glPaged) return;
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            const next = Math.max(0, (this._glPageIndex | 0) - 1);
            this._bindTableWithGlPage(oTable, next);
        },
        onGlNextPage: function () {
            if (!this._glPaged) return;
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            const total = (this._glPages && this._glPages.length) || 0;
            const next = Math.min(total - 1, (this._glPageIndex | 0) + 1);
            this._bindTableWithGlPage(oTable, next);
        },


        _onTreeTableRequested: function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            // 전체 데이터를 가져오기 위한 설정
            const oModel = oBinding.getModel();
            if (oModel) {
                // setSizeLimit 설정
                if (oModel.setSizeLimit) {
                    oModel.setSizeLimit(10000);
                }
                // defaultCountMode 설정
                if (oModel.setDefaultCountMode) {
                    oModel.setDefaultCountMode("Inline");
                }
                // defaultOperationMode 설정
                if (oModel.setDefaultOperationMode) {
                    oModel.setDefaultOperationMode("Server");
                }
            }

            oTable.setBusy(true);
        },

        _onTreeTableReceived: async function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            // 북마크 복원 중이 아닐 때만 BUSY 설정
            if (!this._bInitialExpandDone && !this._bookmarkRestored) {
                oTable.setBusy(true);
            }
            try {
                // 1) 북마크 트리 상태 안전 취득 (저장된 상태 우선, 그 다음 복원 상태)
                const rawState = this._savedBookmarkState || this._restoreStateFromBookmark || null;
                const st = rawState && (rawState.tree || rawState) || null;

                // 2) 지연된 필터를 '반드시' 먼저 적용
                if (this._deferApplyTableFilters) {
                    this._deferApplyTableFilters = false;
                    const base = this._getTableFilter();
                    const srch = this._buildSearchFilters(this._lastTableQuery);
                    const colf = Object.entries(this._colFilters || {})
                        .map(([p, v]) => this._buildFilterForValueWithType(p, v))
                        .flat();
                    oBinding.filter(base.concat(srch, colf), sap.ui.model.FilterType.Application);
                    await this._waitRowsSettled(oTable, 180);
                }

                // 3) 트리 상태 복원 (첫 실행 vs 북마크 복원 구분)
                const isFirstRun = !this._bInitialExpandDone;
                // 북마크 복원 여부는 플래그뿐 아니라 실제 저장된 상태 존재 여부로도 판단
                const savedState = this._savedBookmarkState || this._restoreStateFromBookmark || null;
                const savedTree = savedState && (savedState.tree || savedState);
                const hasBookmarkState = !!(savedTree && (Array.isArray(savedTree.expandedNodes) || Array.isArray(savedTree.collapsedNodes)));

                // 북마크 복원이 이미 완료된 경우에는 북마크 복원 로직을 실행하지 않음
                if (this._bookmarkRestoreCompleted) {

                    if (isFirstRun) {
                        this._bInitialExpandDone = true;
                        try { oTable.expandToLevel(5); } catch (e) { }
                        await this._waitRowsSettled(oTable, 200);
                        oTable.setBusy(false);
                    }
                } else if (isFirstRun || hasBookmarkState) {
                    if (isFirstRun) {
                        this._bInitialExpandDone = true;

                        // 첫 번째 실행 시 전체 확장
                        try {
                            oTable.expandToLevel(99);
                        } catch (e) {
                        }
                        try {
                            await this._expandAllDeep(oTable, 30);
                        } catch (e) {
                        }
                        await this._waitRowsSettled(oTable, 300);
                        if (!hasBookmarkState) return; // 북마크 없을 때만 종료, 있으면 이어서 복원
                    }

                    if (hasBookmarkState) {
                        // 항상 최신 저장 상태를 사용
                        const stEff = savedTree || st;

                        // 바인딩이 안정화될 때까지 충분히 대기
                        let retryCount = 0;
                        let currentLen = oBinding.getLength();

                        while (currentLen === 0 && retryCount < 10) {
                            await this._waitRowsSettled(oTable, 300);
                            currentLen = oBinding.getLength();
                            retryCount++;
                        }

                        if (currentLen === 0) {
                            try { oTable.expandToLevel(99); } catch (e) { }
                            try { await this._expandAllDeep(oTable, 30); } catch (e) { }
                            await this._waitRowsSettled(oTable, 120);
                            return;
                        }

                        // 3-1) 북마크 상태 복원 (확장 목록만 있는 경우 leaf-collapse 전략 적용)
                        if ((!Array.isArray(stEff.collapsedNodes) || stEff.collapsedNodes.length === 0) && Array.isArray(stEff.expandedNodes)) {
                            try {
                                oTable.collapseAll();
                                await this._waitRowsSettled(oTable, 120);
                            } catch (e) { /* noop */ }
                        }

                        // 3-2) 먼저 저장된 확장된 노드들을 확장
                        if (Array.isArray(stEff.expandedNodes) && stEff.expandedNodes.length) {

                            await this._expandNodesByKeyWithParents(stEff.expandedNodes);
                            await this._waitRowsSettled(oTable, 200);
                        }

                        // 3-3) 저장된 접힌 노드들을 접기
                        if (Array.isArray(stEff.collapsedNodes) && stEff.collapsedNodes.length) {

                            await this._collapseNodesById(stEff.collapsedNodes);
                            await this._waitRowsSettled(oTable, 200);
                        }

                        // 3-4) 최종 상태 확인
                        const finalExpanded = [];
                        const finalCollapsed = [];
                        const ob = oTable?.getBinding("rows");
                        if (ob && oTable) {
                            const len = ob.getLength();
                            for (let i = 0; i < len; i++) {
                                const obj = ob.getContextByIndex(i)?.getObject?.();
                                if (!obj) continue;
                                const id = (obj.Node != null) ? obj.Node : (obj.NodeID != null) ? obj.NodeID : null;
                                if (id == null) continue;

                                const dsInitial = String(obj.DrillState || "").toLowerCase();
                                const isGroup = dsInitial !== "leaf";
                                if (!isGroup) continue;

                                try {
                                    if (oTable.isExpanded(i)) {
                                        finalExpanded.push(String(id));
                                    } else {
                                        finalCollapsed.push(String(id));
                                    }
                                } catch (e) {
                                    finalCollapsed.push(String(id));
                                }
                            }

                            if (finalExpanded.length === 0 && finalCollapsed.length > 0) {
                            } else if (finalExpanded.length > 0 && finalCollapsed.length > 0) {
                            } else if (finalExpanded.length > 0) {
                            } else {
                            }
                        }

                        // 3-4) 모든 노드 확장이 완료될 때까지 추가 대기
                        await this._waitRowsSettled(oTable, 500);

                        // 3-5) 북마크 복원 완료 플래그 설정 (자동 확장 방지)
                        this._bookmarkRestored = true;

                        // 북마크 복원 완료 후 즉시 플래그 리셋 (사용자 수동 조작 허용)
                        this._bookmarkRestored = false;

                        // 북마크 복원 완료 플래그 설정 (다음 호출 시 북마크 복원 로직 건너뜀)
                        this._bookmarkRestoreCompleted = true;

                        // 북마크 상태를 저장하여 필터 변경 시에도 유지
                        this._savedBookmarkState = st;

                        // 선택/스크롤 복원
                        if (st && st.selectedNodeId != null) this._selectRowByNodeId(st.selectedNodeId);
                        if (st && Number.isFinite(st.firstVisibleRow)) {
                            oTable.setFirstVisibleRow(Math.max(0, st.firstVisibleRow | 0));
                        }

                        // 일회성 상태 제거
                        this._restoreStateFromBookmark = null;

                        // 최종 안정화 대기 후 BUSY 해제 (북마크 복원 시에는 BUSY 설정하지 않았으므로 해제도 불필요)
                        await this._waitRowsSettled(oTable, 300);
                        // oTable.setBusy(false); // 북마크 복원 시에는 BUSY를 설정하지 않았으므로 해제도 불필요
                    } else {
                        // 북마크 없으면 기본값(필요시 1~2레벨만)
                        try { oTable.expandToLevel(5); } catch (e) { }
                        await this._waitRowsSettled(oTable, 200);
                        oTable.setBusy(false);
                    }
                }

                // 부가 상태 업데이트
                this._maxExpandLevel = this._getMaxLevelFromBinding?.();
                this._curExpandLevel = this._getVisibleMaxLevel?.();

                // (선택) 전체 노드 로딩 안정화 대기
                this._busyUntilFullyExpanded?.(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
            } catch (e) {
                jQuery.sap.log.error(e?.message || String(e));
                oTable.setBusy(false);
            }
        },
        _getTreeStateForBookmark: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable?.getBinding("rows");
            const out = {
                expandLevel: 0,
                expandedNodes: [],
                collapsedNodes: [],
                firstVisibleRow: oTable ? oTable.getFirstVisibleRow() | 0 : 0,
                selectedNodeId: null
            };
            if (!ob) return out;

            const len = ob.getLength();
            for (let i = 0; i < len; i++) {
                const ctx = ob.getContextByIndex(i); if (!ctx) continue;
                const o = ctx.getObject();
                const id = String(o.Node ?? o.NodeID ?? "");
                const lvl = Number(o.HierarchyLevel ?? 0) | 0;
                const ds = String(o.DrillState ?? o.Drillstate ?? "").toLowerCase();
                if (lvl > out.expandLevel) out.expandLevel = lvl;
                if (id) {
                    if (ds === "expanded") out.expandedNodes.push(id);
                    if (ds === "collapsed") out.collapsedNodes.push(id);
                }
            }
            const selIdx = oTable.getSelectedIndex?.() ?? -1;
            if (selIdx > -1) {
                const so = ob.getContextByIndex(selIdx)?.getObject();
                out.selectedNodeId = so ? String(so.Node ?? so.NodeID ?? "") : null;
            }
            return out;
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
            aCols.push({ label: this.i18n.getText("PeriodBalance"), type: EdmType.Currency, property: 'PeriodBalance', width: 20, unitProperty: 'CompanyCodeCurrency', displayUnit: false });
            aCols.push({ label: this.i18n.getText("ComparisonBalance"), type: EdmType.Currency, property: 'ComparisonBalance', width: 25, unitProperty: 'CompanyCodeCurrency', displayUnit: false });
            aCols.push({ label: this.i18n.getText("AbsoluteDifference"), type: EdmType.Number, property: 'AbsoluteDifference', width: 25, scale: 2 });
            aCols.push({ label: this.i18n.getText("RelativeDifference"), type: EdmType.Number, property: 'RelativeDifference', width: 20, scale: 4 });
            aCols.push({ label: this.i18n.getText("CompanyCodeCurrency"), type: EdmType.String, property: 'CompanyCodeCurrency', width: 10 });
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
        _buildPrintHTML: function ({ title, subTitleLines = [], cols, rows, colPercents = [], highlightKeySet }) {
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
            const rowShouldHL = (r) => {
                // 화면 기준 우선
                try {
                    if (highlightKeySet && highlightKeySet.size) {
                        const key = this._rowKey(r);
                        if (key && highlightKeySet.has(key)) return true;
                    }
                } catch (e) { }
                // 화면 로직과 동일한 기본 규칙: GL 계정이 없고, 금액이 하나라도 있는 경우만 (요약 행)
                if (!r || isBSPL(r)) return false;
                const hasGl = !!(r.GlAccount && r.GlAccount.toString().trim());
                if (hasGl) return false; // G/L 계정이 있으면 색칠하지 않음
                return anyNonZero(r); // G/L 계정이 없고 금액이 있으면 색칠
            };

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
                if (this._searchState.hits[this._searchState.pos]) {

                    activeIdx = this._indexOfHitInBinding(this._searchState.hits[this._searchState.pos]);
                }
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
                // 북마크 복원 후에는 자동 확장하지 않음
                if (!this._bookmarkRestored) {
                    try { oTable.expandToLevel(5); } catch (e) { /*noop*/ }
                    await this._waitRowsSettled(oTable, 120);
                    try { oTable.expandToLevel(99); } catch (e) { /*noop*/ }
                    await this._expandAllDeep(oTable, 30);
                    await this._waitRowsSettled(oTable, 220);
                } else {

                    await this._waitRowsSettled(oTable, 120);
                }
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
            try {
                const store = await this._getPersContainer();
                const result = await store.get();

                return result || [];                // [{id,name,createdAt,state}, ...]
            } catch (e) {

                return [];
            }
        },
        _bm_putAll: async function (a) {
            try {
                const store = await this._getPersContainer();
                await store.set(a || []);

            } catch (e) {
                console.error("[BM] 북마크 목록 저장 실패:", e);
                throw new Error("북마크 저장 실패: " + (e.message || e));
            }
        },
        _bm_save: async function (name, state) {
            try {

                const a = await this._bm_all();

                // 중복 이름 체크 및 처리
                let finalName = name;
                let counter = 1;
                while (a.some(bm => bm.name === finalName)) {
                    finalName = `${name} (${counter})`;
                    counter++;
                }

                const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
                const newBookmark = {
                    id,
                    name: finalName,
                    createdAt: Date.now(),
                    state: state || {}
                };

                a.push(newBookmark);
                await this._bm_putAll(a);


                return id;
            } catch (e) {
                console.error("[BM] 북마크 저장 실패:", e);
                throw new Error("북마크 저장 실패: " + (e.message || e));
            }
        },
        _bm_delete: async function (id) {
            try {

                const a = await this._bm_all();
                const filtered = a.filter(b => b.id !== id);

                if (filtered.length === a.length) {
                    console.warn("[BM] 삭제할 북마크를 찾을 수 없음:", id);
                    return false;
                }

                await this._bm_putAll(filtered);

                return true;
            } catch (e) {
                console.error("[BM] 북마크 삭제 실패:", e);
                throw new Error("북마크 삭제 실패: " + (e.message || e));
            }
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
        _buildTreeFromFlat: function (rows) {
            const byId = Object.create(null);
            const roots = [];
            rows.forEach(r => {
                const id = String(r.Node);
                byId[id] = Object.assign({ children: [] }, r);
            });
            rows.forEach(r => {
                const id = String(r.Node);
                const p = r.ParentNodeID == null ? null : String(r.ParentNodeID);
                const node = byId[id];
                if (p && byId[p]) byId[p].children.push(node);
                else roots.push(node);               // ★ null/undefined/"" -> 루트
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
            // 북마크 복원 중이면 자동 확장하지 않음
            if (this._bookmarkRestored) {
                return;
            }

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
            const oModel = this.getView().getModel("F_GLAccount_VH");
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
                    // 통화형 컬럼은 단위 속성 지정. 표시상 통화 문자열은 숨김 처리(displayUnit:false)
                    if (prop === "PeriodBalance") {
                        return { label, type: EdmType.Currency, property: prop, unitProperty: 'CompanyCodeCurrency', displayUnit: false, width: 20 };
                    }
                    if (prop === "ComparisonBalance") {
                        return { label, type: EdmType.Currency, property: prop, unitProperty: 'CompanyCodeCurrency', displayUnit: false, width: 25 };
                    }
                    // 절대차이는 통화형으로 처리 (쉼표 표시, 소수점 제거)
                    if (prop === "AbsoluteDifference") {
                        return { label, type: EdmType.Currency, property: prop, unitProperty: 'CompanyCodeCurrency', displayUnit: false, width: 25, scale: 0 };
                    }
                    // 상대차이는 숫자형으로 처리
                    if (prop === "RelativeDifference") {
                        return { label, type: EdmType.Number, property: prop, scale: 4 };
                    }
                    return { label, type: typeOf(prop), property: prop };
                })
                .filter(Boolean);
        },

        _captureAppState: async function () {
            try {

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
                if (!oTable) {
                    throw new Error("메인 테이블을 찾을 수 없습니다.");
                }

                const ob = oTable.getBinding && oTable.getBinding("rows");
                if (!ob) {
                    throw new Error("테이블 바인딩을 찾을 수 없습니다.");
                }

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


                    // 먼저 모든 노드를 접힌 상태로 초기화
                    const allNodes = new Set();

                    for (let i = 0; i < len; i++) {
                        const o = ob.getContextByIndex(i)?.getObject?.();
                        if (!o) continue;
                        const id = (o.Node != null) ? o.Node : (o.NodeID != null) ? o.NodeID : null;
                        if (id == null) continue;

                        const dsInitial = String(o.DrillState || "").toLowerCase();
                        const isGroup = dsInitial !== "leaf";
                        if (!isGroup) continue;

                        allNodes.add(String(id));
                    }



                    // 실제로 UI에서 펼쳐진 노드만 찾기
                    let expandedCount = 0;
                    let collapsedCount = 0;

                    for (let i = 0; i < len; i++) {
                        const o = ob.getContextByIndex(i)?.getObject?.();
                        if (!o) continue;
                        const id = (o.Node != null) ? o.Node : (o.NodeID != null) ? o.NodeID : null;
                        if (id == null) continue;

                        const dsInitial = String(o.DrillState || "").toLowerCase();
                        const isGroup = dsInitial !== "leaf";
                        if (!isGroup) continue; // leaf 노드는 제외

                        try {
                            const uiExpanded = !!oTable.isExpanded(i);

                            if (uiExpanded) {
                                expandedNodes.push(String(id));
                                expandedCount++;

                            } else {
                                collapsedNodes.push(String(id));
                                collapsedCount++;

                            }
                        } catch (e) {

                            // 에러가 발생하면 접힌 상태로 간주
                            collapsedNodes.push(String(id));
                            collapsedCount++;

                        }
                    }

                    // 상태 요약
                    if (expandedCount === 0 && collapsedCount > 0) {

                    } else if (expandedCount > 0 && collapsedCount > 0) {

                    } else if (expandedCount > 0) {

                    } else {

                    }

                    // 검증: 모든 노드가 캡처되었는지 확인
                    if (expandedCount + collapsedCount !== allNodes.size) {
                        console.warn("[BM] 일부 노드가 캡처되지 않음:", {
                            expected: allNodes.size,
                            captured: expandedCount + collapsedCount
                        });
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

                const state = {
                    Search,
                    tokens,
                    custom,
                    colFilters,
                    tablePerso,
                    tableState: {
                        columnLayout,
                        // 트리 상태는 tree 아래에 모아 저장 (복원 측과 경로/키 맞춤)
                        tree: {
                            expandedNodes,        // string[] - 실제로 펼쳐진 노드들만
                            collapsedNodes,       // string[] - 실제로 접힌 노드들만
                            firstVisibleRow,      // number
                            selectedNodeId        // string | number | null
                        }
                    }
                };
                return state;
            } catch (e) {
                console.error("[BM] 앱 상태 캡처 실패:", e);
                throw new Error("앱 상태 캡처 실패: " + (e.message || e));
            }
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
                if (!obj) continue;
                const id = String(obj.Node ?? obj.NodeID ?? "");
                if (id === String(nodeId)) return i;
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
        _forceCollapseAllNodes: async function (oTable) {
            const oBinding = oTable?.getBinding("rows");
            if (!oTable || !oBinding) return;

            // 여러 번 시도하여 확실히 모든 노드를 접기
            for (let attempt = 1; attempt <= 10; attempt++) {


                // 1) collapseAll 시도
                try {
                    oTable.collapseAll();
                } catch (e) {
                    console.warn("[BM] collapseAll 실패:", e.message);
                }

                await this._waitRowsSettled(oTable, 200);

                // 2) 개별 노드 접기 시도 (여러 번 반복)
                const len = oBinding.getLength();
                let collapsedCount = 0;
                let stillExpanded = [];

                // 여러 번 반복하여 확실히 접기
                for (let repeat = 0; repeat < 3; repeat++) {
                    for (let i = len - 1; i >= 0; i--) { // 역순으로 접기 (자식부터)
                        const obj = oBinding.getContextByIndex(i)?.getObject?.();
                        if (!obj) continue;

                        const dsInitial = String(obj.DrillState || "").toLowerCase();
                        const isGroup = dsInitial !== "leaf";
                        if (!isGroup) continue;

                        try {
                            if (oTable.isExpanded(i)) {
                                const nodeId = String(obj.Node ?? obj.NodeID ?? "");

                                oTable.collapse(i);
                                collapsedCount++;
                                await this._waitRowsSettled(oTable, 50); // 각 노드 접기 후 잠시 대기
                            }
                        } catch (e) {
                            console.warn(`[BM] 노드 접기 실패 (인덱스: ${i}):`, e.message);
                        }
                    }
                }

                // 3) 여전히 펼쳐진 노드들 찾기
                stillExpanded = [];
                for (let i = 0; i < len; i++) {
                    const obj = oBinding.getContextByIndex(i)?.getObject?.();
                    if (!obj) continue;

                    const dsInitial = String(obj.DrillState || "").toLowerCase();
                    const isGroup = dsInitial !== "leaf";
                    if (!isGroup) continue;

                    try {
                        if (oTable.isExpanded(i)) {
                            const nodeId = String(obj.Node ?? obj.NodeID ?? "");
                            stillExpanded.push({ id: nodeId, index: i });
                        }
                    } catch (e) {
                        // 무시
                    }
                }

                if (stillExpanded.length > 0) {

                }

                // 4) 모든 노드가 접혔는지 확인
                if (stillExpanded.length === 0) {

                    break;
                }

                // 5) 마지막 시도에서도 접히지 않은 노드들 강제 접기
                if (attempt === 10) {

                    for (const node of stillExpanded) {
                        try {

                            oTable.collapse(node.index);
                            await this._waitRowsSettled(oTable, 100);
                        } catch (e) {
                            console.error(`[BM] 강제 접기 실패: 노드 ${node.id}`, e.message);
                        }
                    }
                }

                await this._waitRowsSettled(oTable, 300);
            }
        },

        _collapseNodesById: async function (ids, retries = 3) {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable?.getBinding("rows");
            if (!oTable || !oBinding) return;

            // 여러 번 시도하여 확실히 접기
            for (let attempt = 1; attempt <= retries; attempt++) {


                const len = oBinding.getLength();
                const nodeMap = new Map();

                // 모든 노드를 맵에 저장
                for (let i = 0; i < len; i++) {
                    const obj = oBinding.getContextByIndex(i)?.getObject?.();
                    if (!obj) continue;
                    const id = String(obj.Node ?? obj.NodeID ?? "");
                    if (id) {
                        nodeMap.set(id, { index: i, obj: obj });
                    }
                }

                let collapsedCount = 0;
                let stillExpanded = [];

                for (const id of ids) {
                    const nodeInfo = nodeMap.get(id);
                    if (nodeInfo) {
                        const isExpanded = oTable.isExpanded(nodeInfo.index);


                        if (isExpanded) {
                            try {
                                oTable.collapse(nodeInfo.index);

                                collapsedCount++;
                                await this._waitRowsSettled(oTable, 100);

                                // 접기 후 상태 재확인
                                if (oTable.isExpanded(nodeInfo.index)) {
                                    stillExpanded.push(id);

                                }
                            } catch (e) {
                                console.error(`[BM] 노드 접기 실패: ${id}`, e.message);
                                stillExpanded.push(id);
                            }
                        } else {

                        }
                    } else {
                        console.warn(`[BM] 노드 ${id}를 찾을 수 없음`);
                        stillExpanded.push(id);
                    }
                }


                // 모든 노드가 접혔으면 종료
                if (stillExpanded.length === 0) {

                    break;
                }

                // 마지막 시도가 아니면 잠시 대기 후 재시도
                if (attempt < retries) {
                    await this._waitRowsSettled(oTable, 200);
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
                if (!s || typeof s !== 'object') {
                    console.warn("[BM] 적용할 상태가 올바르지 않습니다:", s);
                    return;
                }

                // (a) Search 모델
                const oSearch = this.getView().getModel("Search");
                if (s.Search && oSearch) {
                    try {
                        oSearch.setData({ ...oSearch.getData(), ...s.Search });

                    } catch (e) {
                        console.warn("[BM] 검색 모델 복원 실패:", e);
                    }
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
                    this._bookmarkRestored = false; // 북마크 복원 플래그 리셋
                    this._bindTable(oTable);
                }

                sap.m.MessageToast.show("북마크를 적용했습니다.");
            } catch (e) {
                console.error("[BM] 앱 상태 복원 실패:", e);
                sap.m.MessageBox.error("북마크 적용 중 오류가 발생했습니다.\n" + (e.message || e));
                throw e; // 상위 함수에서도 에러를 처리할 수 있도록
            } finally {
                // 항상 실행되어야 하는 정리 작업
                try {
                    await this._waitBindingStableOnce(150);
                    this._refreshColumnIndexMap?.();
                    this._applyGroupRowColors?.();
                } catch (e) {
                    console.warn("[BM] 상태 복원 후 정리 작업 실패:", e);
                }
            }
        },
        // 트리 확장 키 수집: 현재 바인딩에 보이는 노드들 중 '펼침' 상태만
        _captureTreeExpandKeys: function (oTable, keyProp = "Node") {
            const ob = oTable.getBinding("rows");
            if (!ob) return [];
            const keys = [];
            const len = ob.getLength();
            for (let i = 0; i < len; i++) {
                if (!oTable.isExpanded || !oTable.isExpanded(i)) continue;   // 펼쳐진 행만
                const ctx = oTable.getContextByIndex(i);
                if (!ctx) continue;
                const k = ctx.getProperty(keyProp);
                if (k != null && k !== "") keys.push(String(k));
            }
            return keys;
        },

        onBookmarkLoad: async function () {
            // 1) 헤더 로드
            let heads = [];
            try {
                heads = await this._loadBookmarkHeads();
            } catch (e) {
                jQuery.sap.log.error(e?.message || e);
                return sap.m.MessageBox.error("북마크 목록을 불러오지 못했습니다.");
            }
            if (!heads.length) return sap.m.MessageToast.show("저장된 북마크가 없습니다.");

            // 2) 모델 준비 (선택 아이디/개수는 '순수 값'만 보관)
            const jm = new sap.ui.model.json.JSONModel({
                items: heads,
                selectedIds: [],
                selCount: 0
            });

            // JSONModel 기본 sizeLimit은 100 → 북마크가 100개 초과 시 잘림 현상 방지
            // 로드된 개수에 맞춰 넉넉히 확장
            try {
                const n = Math.max(1000, (heads && heads.length) ? heads.length : 0);
                jm.setSizeLimit(n);
                console.log("[BM] JSONModel sizeLimit 설정:", n);
                console.log("[BM] 실제 heads 개수:", heads.length);
            } catch (e) { 
                console.error("[BM] sizeLimit 설정 실패:", e);
            }

            // 3) 테이블로 표시 (JSONModel sizeLimit + 서버 페이징 루프 적용되어 전체 표시 가능)

            // 기존 테이블도 유지 (호환성을 위해)
            const table = new sap.m.Table({
                mode: sap.m.ListMode.MultiSelect,
                includeItemInSelection: true,
                showNoData: false,
                items: {
                    path: "/items",
                    templateShareable: false,
                    template: new sap.m.ColumnListItem({
                        cells: [
                            new sap.m.Text({
                                text: "{Bookmarkname}",
                                wrapping: false
                            })
                        ]
                    })
                },
                columns: [
                    new sap.m.Column({
                        header: new sap.m.Text({ text: "북마크 이름" })
                    })
                ]
            });

            table.attachSelectionChange(() => {
                const sel = table.getSelectedItems() || [];
                const ids = sel.map(it => it.getBindingContext().getObject().Bookmarkid);
                jm.setProperty("/selectedIds", ids);
                jm.setProperty("/selCount", ids.length);
            });

            // 4) 다이얼로그 (★ 버튼 바인딩이 보이도록 다이얼로그에도 모델 설정)
            const dlg = new sap.m.Dialog({
                id: this.createId("BM_LoadDlg"),
                title: "북마크 불러오기",
                contentWidth: "520px",
                contentHeight: "60vh",
                stretchOnPhone: true,
                content: [table],
                buttons: [
                    // 적용(하나만)
                    new sap.m.Button({
                        text: "적용",
                        type: "Emphasized",
                        enabled: "{= ${/selCount} === 1 }",
                        press: async function () {
                            const self = this.getView().getController();
                            const sel = table.getSelectedItems() || [];
                            if (sel.length !== 1) return sap.m.MessageToast.show("적용은 하나만 선택하세요.");
                            const head = sel[0].getBindingContext().getObject();
                            dlg.setBusy(true);
                            try {
                                const items = await self._loadBookmarkItems(head.Bookmarkid);
                                await self._applyBookmarkItemsToTable(items);
                                dlg.close();
                            } catch (e) {
                                const msg = self._formatError(e, "북마크 적용 실패");
                                jQuery.sap.log.error(msg);
                                sap.m.MessageBox.error(msg);
                            } finally {
                                dlg.setBusy(false);
                            }
                        }.bind(this)
                    }),
                    // 삭제(다중)
                    new sap.m.Button({
                        text: "삭제",
                        type: "Negative",
                        enabled: "{= ${/selCount} > 0 }",
                        press: function () {
                            const self = this.getView().getController();
                            const sel = table.getSelectedItems() || [];
                            if (!sel.length) return;
                            sap.m.MessageBox.confirm(`선택한 ${sel.length}개 북마크를 삭제할까요?`, {
                                onClose: async (act) => {
                                    if (act !== sap.m.MessageBox.Action.OK) return;
                                    dlg.setBusy(true);
                                    try {
                                        for (const it of sel) {
                                            const id = it.getBindingContext().getObject().Bookmarkid;
                                            await self._deleteBookmarkFromDB(id);
                                        }
                                        const next = await self._loadBookmarkHeads();
                                        // 선택 상태/카운트 초기화
                                        jm.setData({ items: next, selectedIds: [], selCount: 0 });
                                        table.removeSelections(true);
                                        sap.m.MessageToast.show("삭제되었습니다.");
                                    } catch (e) {
                                        jQuery.sap.log.error(e?.message || e);
                                        sap.m.MessageBox.error("삭제 중 오류가 발생했습니다.");
                                    } finally {
                                        dlg.setBusy(false);
                                    }
                                }
                            });
                        }.bind(this)
                    }),
                    new sap.m.Button({ text: "닫기", press: () => dlg.close() })
                ]
            });

            dlg.setModel(jm);
            table.setModel(jm);  // Table에도 모델 설정

            // 5) 정리 & 오픈
            this.getView().addDependent(dlg);
            dlg.attachAfterClose(() => dlg.destroy());
            dlg.open();
        },
        _formatError(e, prefix) {
            // 가능한 문자열만 뽑아서 반환
            const body =
                (e && e.response && (e.response.body || e.response.responseText)) ||
                e?.message ||
                e?.statusText ||
                "";

            const msg = (body && String(body)) || String(e);  // ← 항상 문자열 보장
            return (prefix ? prefix + " - " : "") + msg;
        },


        _onBookmarkLoadConfirm: async function (ev, dlg) {
            try {
                if (!dlg || !dlg.close) {
                    console.error("SelectDialog instance not found in _onBookmarkLoadConfirm");
                    return;
                }

                const ctx =
                    (ev.getParameter("selectedContexts") && ev.getParameter("selectedContexts")[0]) ||
                    (ev.getParameter("selectedItem") && ev.getParameter("selectedItem").getBindingContext && ev.getParameter("selectedItem").getBindingContext());

                if (!ctx) {
                    console.warn("북마크 선택 정보를 찾을 수 없습니다.");
                    dlg.close();
                    return;
                }

                const head = ctx.getObject && ctx.getObject();
                if (!head || !head.Bookmarkid) {
                    console.warn("북마크 데이터가 올바르지 않습니다:", head);
                    dlg.close();
                    return;
                }


                dlg.setBusy(true);

                const items = await this._loadBookmarkItems(head.Bookmarkid);
                if (!items) {
                    throw new Error("저장된 북마크 데이터를 찾을 수 없습니다.");
                }

                await this._applyBookmarkItemsToTable(items);
                sap.m.MessageToast.show(`"${head.Bookmarkname}" 북마크를 적용했습니다.`);


            } catch (e) {
                console.error("북마크 적용 중 오류:", e);
                sap.m.MessageBox.error("북마크 적용 중 오류가 발생했습니다.\n" + (e && e.message || e));
            } finally {
                if (dlg && dlg.setBusy) dlg.setBusy(false);
                if (dlg && dlg.close) dlg.close();
            }
        },

        _onBookmarkCancel: function () {
            const dlg = this._bmLoadDlg;
            if (dlg && dlg.close) dlg.close();
        },

        _cleanForModel(obj) {
            const seen = new WeakSet();
            const isUI5 = v => v && (v.getMetadata || v.getBinding || v.attachEvent || v.oParent);

            const walk = v => {
                if (v == null || typeof v !== "object") return v;
                if (seen.has(v)) return undefined;
                if (isUI5(v)) return undefined;
                seen.add(v);

                if (Array.isArray(v)) return v.map(walk).filter(x => x !== undefined);

                const out = {};
                for (const k of Object.keys(v)) {
                    if (k === "parent" || k === "__parent" || k === "__ctx") continue; // 순환 의심 키 제거
                    const nv = walk(v[k]);
                    if (nv !== undefined) out[k] = nv;
                }
                return out;
            };
            return walk(obj);
        },
        // keys: Set<string>  (Node 또는 HierarchyID 값)
        _restoreExpandStateByKeys: async function (oTable, keys, keyProp = "Node", maxPass = 6) {
            if (!oTable || !keys || keys.size === 0) return;
            for (let pass = 0; pass < maxPass; pass++) {
                let any = false;
                const ob = oTable.getBinding("rows");
                const len = ob.getLength();
                for (let i = 0; i < len; i++) {
                    const ctx = oTable.getContextByIndex(i);
                    if (!ctx) continue;
                    const k = String(ctx.getProperty(keyProp));
                    if (keys.has(k) && !oTable.isExpanded(i)) {
                        try { oTable.expand(i); any = true; } catch (e) { }
                    }
                }
                if (!any) break;  // 더 이상 열릴 게 없으면 종료
                await this._waitRowsSettled(oTable, 60);
            }
        },

        _applyBookmarkItemsToTable: async function (state) {
            // 로컬 스토리지 기반 북마크 시스템에서는 _applyAppState 사용
            if (state) {
                await this._applyAppState(state);
            }
        },

        // Key(=Hierarchyid|Node)로 행 인덱스를 찾아 부모→자식 순서로 expand
        _expandNodesByKeyWithParents: async function (keys) {
            if (!Array.isArray(keys) || !keys.length) {

                return;
            }

            const oTable = this.byId("T_Main");
            const ob = oTable?.getBinding("rows");
            if (!oTable || !ob) {

                return;
            }

            // 더 안정적인 확장을 위해 순차적으로 처리
            const maxRetries = 8;
            let retryCount = 0;
            let processedNodes = new Set();

            while (retryCount < maxRetries && processedNodes.size < keys.length) {
                const len = ob.getLength();


                let foundInThisRound = 0;

                for (const nodeId of keys) {
                    if (processedNodes.has(nodeId)) {
                        continue; // 이미 처리된 노드는 스킵
                    }

                    // 노드를 직접 찾기
                    let foundIndex = -1;
                    for (let i = 0; i < len; i++) {
                        const obj = ob.getContextByIndex(i)?.getObject?.();
                        if (!obj) continue;
                        const id = String(obj.Node ?? obj.NodeID ?? "");
                        if (id === String(nodeId)) {
                            foundIndex = i;
                            break;
                        }
                    }

                    if (foundIndex >= 0) {


                        // 확장 전 상태 확인
                        try {
                            const isExpandedBefore = oTable.isExpanded(foundIndex);

                        } catch (e) {

                        }

                        foundInThisRound++;

                        try {
                            // 부모 노드들을 찾아서 순서대로 확장
                            const obj = ob.getContextByIndex(foundIndex)?.getObject?.();
                            if (obj) {
                                const parentPath = this._buildParentPath(obj, ob, len);


                                // 부모부터 순서대로 확장 (각 단계마다 충분히 대기)
                                for (const parentId of parentPath) {
                                    const parentIndex = this._findNodeIndex(parentId, ob, len);
                                    if (parentIndex >= 0 && !oTable.isExpanded(parentIndex)) {

                                        try {

                                            oTable.expand(parentIndex);
                                            await this._waitRowsSettled(oTable, 300);
                                        } catch (e) {

                                        }
                                    }
                                }

                                // 마지막에 타겟 노드 확장
                                if (!oTable.isExpanded(foundIndex)) {
                                    try {

                                        oTable.expand(foundIndex);
                                        await this._waitRowsSettled(oTable, 300);
                                    } catch (e) {

                                    }
                                }

                                // 확장 후 상태 확인
                                try {
                                    const isExpandedAfter = oTable.isExpanded(foundIndex);

                                    if (isExpandedAfter) {

                                    } else {

                                    }
                                } catch (e) {

                                }

                                // 성공적으로 처리된 노드로 표시
                                processedNodes.add(nodeId);
                            }
                        } catch (e) {
                        }
                    } else {

                    }
                }

                // 이번 라운드에서 찾은 노드가 없으면 더 이상 진행할 수 없음
                if (foundInThisRound === 0) {

                    break;
                }

                // 모든 노드를 처리했으면 종료
                if (processedNodes.size >= keys.length) {

                    break;
                }

                // 다음 라운드를 위해 대기
                retryCount++;
                if (retryCount < maxRetries) {

                    await this._waitRowsSettled(oTable, 500);
                }
            }


        },

        // 노드의 부모 경로를 찾아서 반환
        _buildParentPath: function (obj, ob, len) {
            const path = [];
            let current = obj;
            const visited = new Set();

            while (current && !visited.has(current.Node)) {
                visited.add(current.Node);
                const parentId = String(current.ParentNodeID ?? current.ParentNode ?? "");
                if (!parentId) break;

                // 부모 노드 찾기
                let parentIndex = -1;
                for (let i = 0; i < len; i++) {
                    const parentObj = ob.getContextByIndex(i)?.getObject?.();
                    if (!parentObj) continue;
                    const id = String(parentObj.Node ?? parentObj.NodeID ?? "");
                    if (id === parentId) {
                        parentIndex = i;
                        break;
                    }
                }

                if (parentIndex >= 0) {
                    path.unshift(parentId); // 앞에 추가 (루트부터 순서대로)
                    current = ob.getContextByIndex(parentIndex)?.getObject?.();
                } else {
                    break;
                }
            }

            return path;
        },

        // 노드 ID로 인덱스 찾기
        _findNodeIndex: function (nodeId, ob, len) {
            for (let i = 0; i < len; i++) {
                const obj = ob.getContextByIndex(i)?.getObject?.();
                if (!obj) continue;
                const id = String(obj.Node ?? obj.NodeID ?? "");
                if (id === String(nodeId)) {
                    return i;
                }
            }
            return -1;
        },

        // 노드 경로를 현재 바인딩에서 찾아서 반환
        _buildNodePath: function (nodeId, nodeMap) {
            const path = [];
            let current = nodeId;
            const visited = new Set();


            while (current && !visited.has(current)) {
                visited.add(current);
                path.push(current);

                const nodeInfo = nodeMap.get(current);
                if (!nodeInfo) {

                    break;
                }

                const obj = nodeInfo.obj;
                const parentId = String(obj.ParentNodeID ?? obj.ParentNode ?? "");


                if (!parentId) break;

                current = parentId;
            }

            const result = path.reverse(); // 루트부터 순서대로

            return result;
        },

        _attachDrillStateSync: function () {
            // 로컬 스토리지 기반 북마크 시스템에서는 사용하지 않음

        },

        _collectBookmarkItemsForDB_UI: function () {
            // 로컬 스토리지 기반 북마크 시스템에서는 사용하지 않음

            return [];
        },

        _restoreExpandStateFromDB: async function (expandedItems /* from DB */) {
            // 로컬 스토리지 기반 북마크 시스템에서는 사용하지 않음

        },

        _expandToLevel: async function (level) {
            // 로컬 스토리지 기반 북마크 시스템에서는 사용하지 않음

        },


        // target 레벨까지 필요한 부모는 모두 펼친다 (사용하지 않음)
        _ensureExpandedUpToLevel: async function (targetLevel, maxPass = 20) {

        },

        // targetLevel보다 "깊은(>)" 노드는 역순으로 접는다 (사용하지 않음)
        _collapseDeeperThan: async function (targetLevel, maxPass = 12) {
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

                const scope = {
                    keyCategory: Pers.constants.keyCategory.FIXED_KEY,
                    writeFrequency: Pers.constants.writeFrequency.HIGH,
                    clientStorageAllowed: true,
                    validity: Infinity
                };
                // 컨테이너 하나에 items 라는 아이템으로 전체 배열을 저장합니다.
                const container = await Pers.getContainer(BM_KEY, scope, this.getOwnerComponent());
                return {
                    get: async () => {
                        try {
                            return container.getItemValue("items") || [];
                        } catch (e) {
                            console.warn("[BM] FLP get 실패, localStorage로 폴백:", e);
                            return this._getLocalStorageBackup();
                        }
                    },
                    set: async (arr) => {
                        try {
                            container.setItemValue("items", arr || []);
                            await container.save();
                        } catch (e) {
                            console.warn("[BM] FLP set 실패, localStorage로 폴백:", e);
                            this._setLocalStorageBackup(arr);
                        }
                    },
                    del: async () => {
                        try {
                            container.delItem("items");
                            await container.save();
                        } catch (e) {
                            console.warn("[BM] FLP del 실패, localStorage로 폴백:", e);
                            this._delLocalStorageBackup();
                        }
                    }
                };
            } catch (e) {
                console.warn("[BM] FLP Personalization 서비스 사용 불가, localStorage 사용:", e);
                // FLP 외부 실행(standalone) 등일 때는 기존 localStorage로 폴백
                return {
                    get: async () => this._getLocalStorageBackup(),
                    set: async (arr) => this._setLocalStorageBackup(arr),
                    del: async () => this._delLocalStorageBackup()
                };
            }
        },

        // localStorage 백업 함수들
        _getLocalStorageBackup: function () {
            try {
                const data = localStorage.getItem(BM_KEY);
                return data ? JSON.parse(data) : [];
            } catch (e) {
                console.error("[BM] localStorage get 실패:", e);
                return [];
            }
        },

        _setLocalStorageBackup: function (arr) {
            try {
                localStorage.setItem(BM_KEY, JSON.stringify(arr || []));
            } catch (e) {
                console.error("[BM] localStorage set 실패:", e);
                // localStorage 용량 초과 등의 경우
                if (e.name === 'QuotaExceededError') {
                    // 오래된 북마크부터 삭제하여 공간 확보
                    this._cleanupOldBookmarks();
                    try {
                        localStorage.setItem(BM_KEY, JSON.stringify(arr || []));
                    } catch (e2) {
                        console.error("[BM] localStorage 정리 후에도 저장 실패:", e2);
                    }
                }
            }
        },

        _delLocalStorageBackup: function () {
            try {
                localStorage.removeItem(BM_KEY);
            } catch (e) {
                console.error("[BM] localStorage del 실패:", e);
            }
        },

        // 오래된 북마크 정리 (용량 초과 시)
        _cleanupOldBookmarks: function () {
            try {
                const bookmarks = this._getLocalStorageBackup();
                if (bookmarks.length > 5) {
                    // 생성일 기준으로 정렬하여 오래된 것부터 삭제
                    bookmarks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                    const keepCount = Math.max(3, Math.floor(bookmarks.length * 0.6)); // 최소 3개, 최대 60% 유지
                    const cleaned = bookmarks.slice(-keepCount);
                    localStorage.setItem(BM_KEY, JSON.stringify(cleaned));

                }
            } catch (e) {
                console.error("[BM] 북마크 정리 실패:", e);
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

            // 현재 스크롤 위치 저장
            const currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;

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

            // 이전 Application 필터 신경쓰지 말고 "한 번에" 덮어쓰기
            oBinding.filter(aBase.concat(aSearch, aCol), sap.ui.model.FilterType.Application);

            // 스크롤 위치 복원
            if (oTable.setFirstVisibleRow && currentFirstVisibleRow > 0) {
                setTimeout(() => {
                    const maxVisibleRows = oTable.getBinding("rows")?.getLength() || 0;
                    const targetRow = Math.min(currentFirstVisibleRow, Math.max(0, maxVisibleRows - 1));
                    if (targetRow >= 0) {
                        oTable.setFirstVisibleRow(targetRow);
                    }
                }, 100);
            }
        },
        // GL 전체 데이터에서 인덱스 구성
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
        // 1) 필터 적용 함수는 async + 안정화 대기 후 칠하기
        _applyGlSelectionFilters: async function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            // 현재 스크롤 위치 저장
            const currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;

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

            // 스크롤 위치 복원
            if (oTable.setFirstVisibleRow && currentFirstVisibleRow > 0) {
                setTimeout(() => {
                    const maxVisibleRows = oTable.getBinding("rows")?.getLength() || 0;
                    const targetRow = Math.min(currentFirstVisibleRow, Math.max(0, maxVisibleRows - 1));
                    if (targetRow >= 0) {
                        oTable.setFirstVisibleRow(targetRow);
                    }
                }, 100);
            }
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
                const hasGl = !!(obj.GlAccount && obj.GlAccount.toString().trim());
                const hasAmt = this._hasAnyAmount(obj, [
                    "PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"
                ]);

                // GL 계정이 없고, 금액이 있는 경우만 색상 칠하기 (요약 행)
                if (hasGl || !hasAmt) continue;
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
            // 동일해도 OK 시에는 필터/토큰 재적용을 허용 (menu-ok는 항상 진행)
            if (cause !== "menu-ok" && this._sameSet(this._glKeys, next)) return;

            // _glKeys 업데이트는 OK 버튼에서만 수행
            if (cause === "menu-ok") {
                this._glKeys = next;
   
            }

            // 1) 토큰 동기화
            this._syncGLTokens();

            // 2) 리스트 선택 복원(이벤트 억제) - 전역 플래그 설정
            this._isRestoringSelections = true;
            this._restoreSelectionsInList("L_GlAccount");
            this._restoreSelectionsInList("L_GlAccountText");

            // 이벤트 억제 플래그 해제
            this._isRestoringSelections = false;
 

            // 3) 테이블 필터 적용
            this._applyGLAccountFilterFromKeys();
        },

        // 현재 전역 키셋 기준으로 리스트 선택 복원
        _restoreSelectionsInList: function (sListId) {
     
            const oList = this.byId(sListId);
            if (!oList) return;

            // L_GlAccount는 sap.ui.table.Table이므로 rows 바인딩 확인
            const oItemsBinding = oList.getBinding("items") || oList.getBinding("rows");
            if (!oItemsBinding) return;

            const oWantedSet = this._glKeys;



            // 선택된 항목이 없으면 아무것도 선택하지 않음
            if (!oWantedSet || oWantedSet.size === 0) {
    
                return;
            }


			// Table인 경우 - 바인딩 전체를 스캔하여 선택 복원(보이는 10행 제한 회피)
			if (oList.getRows) {
		
				const ob = oList.getBinding("rows");
				if (ob && ob.getLength && ob.getContextByIndex) {
					const n = ob.getLength();
					for (let i = 0; i < n; i++) {
						const ctx = ob.getContextByIndex(i);
						const sCode = ctx && ctx.getProperty && ctx.getProperty("GLAccount");
						if (sCode && oWantedSet.has(String(sCode))) {
							try { oList.addSelectionInterval(i, i); } catch (e) { /* noop */ }
						}
					}
					
				} else {
					// 폴백: 모델 데이터 전수 스캔
					const items = oList.getModel("GLALL")?.getProperty("/items") || [];
					for (let i = 0; i < items.length; i++) {
						const sCode = items[i] && items[i].GLAccount;
						if (sCode && oWantedSet.has(String(sCode))) {
							try { oList.addSelectionInterval(i, i); } catch (e2) { /* noop */ }
						}
					}
				}
			} else {
                // List인 경우 기존 로직 사용
                const aItems = oList.getItems ? oList.getItems() : [];
                aItems.forEach((oItem, iIndex) => {
                    const oCtx = oItem.getBindingContext("GLALL");
                    const sCode = oCtx && String(oCtx.getProperty("GLAccount") || "");
                    if (!sCode) return;

                    if (oWantedSet.has(sCode)) {
                        oList.setSelectedItem(oItem, true, true);
                    }
                });
            }

        },

        // 전역 키셋으로 실제 테이블 필터 적용 (Application 영역)
        _applyGLAccountFilterFromKeys: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;


            // 현재 스크롤 위치 저장
            const currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;

            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;

            // 1) 기존 Application 필터 트리에서 GlAccount만 제거(재귀)
            const stripPath = (oFilter, sPath) => {
                if (!oFilter) return null;
                // MultiFilter?
                if (oFilter._bMultiFilter || oFilter.aFilters) {
                    const aChildren = (oFilter.aFilters || []).map(x => stripPath(x, sPath)).filter(Boolean);
                    if (!aChildren.length) return null;
                    return new Filter({ filters: aChildren, and: !!oFilter.bAnd });
                }
                // 단일 Filter
                return (oFilter.sPath === sPath) ? null : oFilter;
            };

            const aPrevApp = (ob.aApplicationFilters || []);
            const aOtherFilters = [];
            aPrevApp.forEach(oF => {
                const oKept = stripPath(oF, "GlAccount");
                if (oKept) aOtherFilters.push(oKept);
            });


            // 2) 현재 선택 키셋 처리: 임계치 초과 시 페이지 방식으로 전환하여 긴 URL 방지
            const PAGE_SIZE = 125;
            const selCount = this._glKeys ? this._glKeys.size : 0;
            if (selCount > PAGE_SIZE) {
                const aSel = Array.from(this._glKeys || []);
                const chunks = [];
                for (let i = 0; i < aSel.length; i += PAGE_SIZE) chunks.push(aSel.slice(i, i + PAGE_SIZE));
                this._glPages = chunks;
                this._glPageIndex = 0;
                this._glPaged = true;
                this._updateGlPagingToolbar();

                // 거대한 OR 필터는 Application에 적용하지 않고, 페이지 바인딩으로 대체
                this._bindTableWithGlPage(oTable, 0);
         

                // 스크롤 위치 기록 업데이트
                this._currentFirstVisibleRow = oTable.getFirstVisibleRow ? oTable.getFirstVisibleRow() : 0;
                return;
            } else {
                // 2-소량: OR 필터로 직접 적용
                let oGlOr = null;
                if (selCount > 0) {
                    const ors = Array.from(this._glKeys).map(k => new Filter("GlAccount", OP.EQ, String(k)));
                    oGlOr = new Filter({ and: false, filters: ors });
                   
                } else {
                    
                }

                // 3) 교체 적용 (Application 영역)
                const aNextFilters = oGlOr ? aOtherFilters.concat(oGlOr) : aOtherFilters;
            
                ob.filter(aNextFilters, sap.ui.model.FilterType.Application);
            }

            // (선택) 색/하이라이트 재적용
            this._applyGroupRowColors && this._applyGroupRowColors();
            this._restoreSelectionsInList("L_GlAccount");
            this._restoreSelectionsInList("L_GlAccountText");

            // 스크롤 위치 복원
            if (oTable.setFirstVisibleRow && currentFirstVisibleRow > 0) {
                setTimeout(() => {
                    const maxVisibleRows = oTable.getBinding("rows")?.getLength() || 0;
                    const targetRow = Math.min(currentFirstVisibleRow, Math.max(0, maxVisibleRows - 1));
                    if (targetRow >= 0) {
                        oTable.setFirstVisibleRow(targetRow);
                    }
                }, 100);
            }

            // GL 페이징 상태도 동기화 (소량 선택이면 페이징 해제)
            const aSel = Array.from(this._glKeys || []);
            if (aSel.length === 0) {
                this._glPaged = false;
                this._glPages = [];
                this._glPageIndex = 0;
                this._updateGlPagingToolbar();
            }
        },
        // ========================================================
        // Column Filter
        // ========================================================

        onGlAccountMenuBeforeOpen: async function () {
            try {
                // _glKeys가 비어있으면 기존 토큰에서 복원 시도
                if (!this._glKeys || this._glKeys.size === 0) {
                    
                    const oMI = this.byId("MI_GlAccountSelected");
                    if (oMI && oMI.getTokens && oMI.getTokens().length > 0) {
                        const existingKeys = new Set();
                        oMI.getTokens().forEach(token => {
                            if (token.getKey) {
                                existingKeys.add(token.getKey());
                            }
                        });
                        this._glKeys = existingKeys;
                    }
                } else {
                }

                // 전체 선택된 경우 빠른 처리
                if (this._glKeys && this._glKeys.size > 200) {
            

                    // 캐시된 데이터가 있으면 사용
                    if (this._glAllData && this._glAllData.length > 0) {
                    
                        const data = this._glAllData;
                        this._setupGlAccountMenuQuickly(data);
                        return;
                    }

                    // 캐시된 데이터가 없으면 빈 데이터로 빠르게 열기
                
                    const data = [];
                    this._setupGlAccountMenuQuickly(data);
                    return;
                }

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
                const oGlAllModel = new sap.ui.model.json.JSONModel({ items: unique });
                this.getView().setModel(oGlAllModel, "GLALL");
                oList.setModel(oGlAllModel, "GLALL");

                // 4) 소팅(숫자 오름차순; 1→2→…→7 우선 정렬)
                const numComparator = (sLeft, sRight) => {
                    const iLeft = parseInt(sLeft, 10), iRight = parseInt(sRight, 10);
                    if (isNaN(iLeft) || isNaN(iRight)) return sLeft === sRight ? 0 : (sLeft > sRight ? 1 : -1);
                    // 첫자리 우선 → 같은 첫자리면 전체 숫자 비교
                    const iFirstLeft = String(iLeft)[0], iFirstRight = String(iRight)[0];
                    if (iFirstLeft !== iFirstRight) return iFirstLeft > iFirstRight ? 1 : -1;
                    return iLeft - iRight;
                };
                const sorters = this._makeGLAccountSorters
                    ? this._makeGLAccountSorters()
                    : [new sap.ui.model.Sorter("GLAccount", false, null, numComparator)];

                oList.unbindRows();
                oList.bindRows("GLALL>/items");
                // 스크롤/행 갱신 시 가시행 선택 재동기화
                if (!oList._glSelBound) {
                    const fnSync = function () { 
                        if (this._glStage && this._glStage.size > 0) {
                            setTimeout(() => {
                                this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                            }, 50);
                        }
                    }.bind(this);
                    if (oList.attachFirstVisibleRowChanged) oList.attachFirstVisibleRowChanged(fnSync);
                    if (oList.attachRowsUpdated) oList.attachRowsUpdated(fnSync);
                    // 추가 스크롤 이벤트
                    if (oList.attachScroll) oList.attachScroll(fnSync);
                    oList._glSelBound = true;
                }

                // 남아있던 검색/필터/소터 제거 및 소터 적용
                const b = oList.getBinding("rows");
                if (b) { b.filter([]); b.sort(sorters || []); }

                if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
                if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

                // 6) 선택 복원(토큰 ∪ 메모리)
                const prior = new Set([...(this._glKeys || new Set())]);
                (oMI.getTokens() || []).forEach(t => prior.add(String(t.getKey())));

                // 메뉴 열기 상태 설정 및 스테이징은 prior를 진실로 사용
                this._menuOpen = true;
                this._glStage = new Set(Array.from(prior));

                // 체크박스 선택 복원
                this._restoreSelectionsFromSet("L_GlAccount", this._glStage);

                // 토큰 생성
                this._previewTokensFromSet(this._glStage, "MenuOpen_GL");

                // 추가 지연된 선택 복원
                setTimeout(() => {
                    this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                    this._previewTokensFromSet(this._glStage, "MenuOpen_GL_Delayed_100");
                }, 100);

                setTimeout(() => {
                    this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                    this._previewTokensFromSet(this._glStage, "MenuOpen_GL_Delayed_300");
                }, 300);
            } catch (e) {
                console.error(e);
                sap.m.MessageToast.show("G/L 계정 목록 로딩 중 오류가 발생했습니다.");
            }
            // try 블록 실패 시에도 토큰을 기준으로 복원 시도
            this._menuOpen = true;
            try {
                const oMI = this.byId("MI_GlAccountSelected");
                const prior = new Set([...(this._glKeys || new Set())]);
                (oMI && oMI.getTokens ? oMI.getTokens() : []).forEach(t => prior.add(String(t.getKey())));
                this._glStage = new Set(Array.from(prior));
            } catch (e) {
                this._glStage = new Set(Array.from(this._glKeys || []));
            }
            this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
            this._previewTokensFromSet(this._glStage, "MenuOpen_GL");
            // GLACCOUNTTEXT 선택된 값들을 GLACCOUNT 토큰에도 즉시 표시
            try {
                const oMiGlAccountSelected = this.byId("MI_GlAccountSelected");
                if (oMiGlAccountSelected) {
                    const oGlAllMap = this._getGLAllMap();
                    oMiGlAccountSelected.destroyTokens();
                    Array.from(this._glStage).forEach(sGlAccount => {
                        const sName = oGlAllMap.get(String(sGlAccount)) || String(sGlAccount);
                        oMiGlAccountSelected.addToken(new sap.m.Token({ key: String(sGlAccount), text: `${sName} (${sGlAccount})` }));
                    });
                }
            } catch (e) { /* noop */ }
        },

        onGlAccountMenuAfterClose: async function () {
            let oSearchFilter = this.byId(Control.SearchField.SF_GlAccount);
            oSearchFilter.setValue("");
            this._menuOpen = false;
        },

        onGlAccountMenuSearch: function (oEvent) {
            const sNewValue = (oEvent.getParameter("value") || "").trim();
            const oBinding = this.byId("L_GlAccount")?.getBinding("rows");
            if (!oBinding) return;
            oBinding.filter(sNewValue ? new sap.ui.model.Filter({
                and: false,
                filters: [
                    new sap.ui.model.Filter("GLAccount", sap.ui.model.FilterOperator.Contains, sNewValue),
                    new sap.ui.model.Filter("GLAccountLongName", sap.ui.model.FilterOperator.Contains, sNewValue),
                ]
            }) : []);
            // 필터 후 현재 스테이징에 맞춰 UI 선택 복원
            setTimeout(() => this._restoreSelectionsFromSet("L_GlAccount", this._glStage || new Set()), 0);
        },
        onGlAccountTextMenuSearch: function (oEvent) {
            const sNewValue = (oEvent.getParameter("value") || "").trim();
            const oBinding = this.byId("L_GlAccountText")?.getBinding("rows");
            if (!oBinding) return;
            oBinding.filter(sNewValue ? new sap.ui.model.Filter({
                and: false,
                filters: [
                    new sap.ui.model.Filter("GLAccount", sap.ui.model.FilterOperator.Contains, sNewValue),
                    new sap.ui.model.Filter("GLAccountLongName", sap.ui.model.FilterOperator.Contains, sNewValue),
                ]
            }) : []);
            // 필터 후 현재 스테이징에 맞춰 UI 선택 복원
            setTimeout(() => this._restoreSelectionsFromSet("L_GlAccountText", this._glStage || new Set()), 0);
        },

        // G/L 계정 메뉴 빠른 설정 (전체 선택 시)
        _setupGlAccountMenuQuickly: function (data) {
            const oList = this.byId("L_GlAccount");
            const oMenu = this.byId("M_GlAccount");
            const oMI = this.byId("MI_GlAccountSelected");
            if (!oList || !oMenu || !oMI) return;

            // 데이터 정규화
            const normalized = (data || []).map(it => ({
                GLAccount: String(it.GLAccount || it.GlAccount || it.account || "").trim(),
                GLAccountLongName: String(it.GLAccountLongName || it.GlAccountLongName || it.accountName || "").trim()
            })).filter(it => it.GLAccount && it.GLAccountLongName);

            const unique = Array.from(new Map(normalized.map(x => [x.GLAccount, x])).values());

            // 모델 설정
            const oGlAllModel = new sap.ui.model.json.JSONModel({ items: unique });
            this.getView().setModel(oGlAllModel, "GLALL");
            oList.setModel(oGlAllModel, "GLALL");

            // 바인딩 설정
            oList.unbindRows();
            oList.bindRows("GLALL>/items");
            // 스크롤/행 갱신 시 가시행 선택 재동기화
            if (!oList._glSelBound) {
                const fnSyncTxt = function () { 
                    if (this._glStage && this._glStage.size > 0) {
                        setTimeout(() => {
                            this._restoreSelectionsFromSet("L_GlAccountText", this._glStage);
                        }, 50);
                    }
                }.bind(this);
                if (oList.attachFirstVisibleRowChanged) oList.attachFirstVisibleRowChanged(fnSyncTxt);
                if (oList.attachRowsUpdated) oList.attachRowsUpdated(fnSyncTxt);
                // 추가 스크롤 이벤트
                if (oList.attachScroll) oList.attachScroll(fnSyncTxt);
                oList._glSelBound = true;
            }
            // 스크롤/행 갱신 시 가시행 선택 재동기화
            if (!oList._glSelBound) {
                const fnSync = function () { 
                    if (this._glStage && this._glStage.size > 0) {
                        setTimeout(() => {
                            this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                        }, 50);
                    }
                }.bind(this);
                if (oList.attachFirstVisibleRowChanged) oList.attachFirstVisibleRowChanged(fnSync);
                if (oList.attachRowsUpdated) oList.attachRowsUpdated(fnSync);
                // 추가 스크롤 이벤트
                if (oList.attachScroll) oList.attachScroll(fnSync);
                oList._glSelBound = true;
            }

            // 메뉴 크기 설정
            if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
            if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

            // 메뉴 열기 상태 설정
            this._menuOpen = true;
            this._glStage = new Set(Array.from(this._glKeys || []));

            // 체크박스 선택 복원
            this._restoreSelectionsFromSet("L_GlAccount", this._glStage);

            // 토큰 생성
            this._previewTokensFromSet(this._glStage, "QuickSetup_GL");

            // 선택 복원을 더 확실하게
            setTimeout(() => {
                this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                this._previewTokensFromSet(this._glStage, "QuickSetup_GL_Delayed_100");
            }, 100);
            setTimeout(() => {
                this._restoreSelectionsFromSet("L_GlAccount", this._glStage);
                this._previewTokensFromSet(this._glStage, "QuickSetup_GL_Delayed_500");
            }, 500);
        },

        // G/L 계정 내역 메뉴 빠른 설정 (전체 선택 시)
        _setupGlAccountTextMenuQuickly: function (data) {
            const oList = this.byId("L_GlAccountText");
            const oMenu = this.byId("M_GlAccountText");
            const oMI = this.byId("MI_GlAccountTextSelected");
            if (!oList || !oMenu || !oMI) return;

            // 데이터 정규화
            const normalized = (data || []).map(it => ({
                GLAccount: String(it.GLAccount || it.GlAccount || it.account || "").trim(),
                GLAccountLongName: String(it.GLAccountLongName || it.GlAccountLongName || it.accountName || "").trim()
            })).filter(it => it.GLAccount && it.GLAccountLongName);

            const unique = Array.from(new Map(normalized.map(x => [x.GLAccount, x])).values());

            // 모델 설정
            const oGlAllModel = new sap.ui.model.json.JSONModel({ items: unique });
            this.getView().setModel(oGlAllModel, "GLALL");
            oList.setModel(oGlAllModel, "GLALL");

            // 바인딩 설정
            oList.unbindRows();
            oList.bindRows("GLALL>/items");

            // 메뉴 크기 설정
            if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
            if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

            // 메뉴 상태 설정
            this._menuOpen = true;
            this._glStage = new Set(Array.from(this._glKeys || []));

            // 선택 복원을 더 확실하게
            setTimeout(() => { this._restoreSelectionsInList("L_GlAccountText"); }, 100);
            setTimeout(() => { this._restoreSelectionsInList("L_GlAccountText"); }, 500);
        },

        onGlAccountTextMenuBeforeOpen: async function () {
            try {
                // 전체 선택된 경우 빠른 처리
                if (this._glKeys && this._glKeys.size > 200) {           

                    // 캐시된 데이터가 있으면 사용
                    if (this._glAllData && this._glAllData.length > 0) {
                        
                        const data = this._glAllData;
                        this._setupGlAccountTextMenuQuickly(data);
                        return;
                    }

                    // 캐시된 데이터가 없으면 빈 데이터로 빠르게 열기
                
                    const data = [];
                    this._setupGlAccountTextMenuQuickly(data);
                    return;
                }

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

                // 3) 모델 구성 & 바인딩
                const oGlAllModel = new sap.ui.model.json.JSONModel({ items: unique });
                this.getView().setModel(oGlAllModel, "GLALL");
                oList.setModel(oGlAllModel, "GLALL");

                // 4) 소팅(숫자 오름차순; 1→2→…→7 우선 정렬)
                const numComparator = (sLeft, sRight) => {
                    const iLeft = parseInt(sLeft, 10), iRight = parseInt(sRight, 10);
                    if (isNaN(iLeft) || isNaN(iRight)) return sLeft === sRight ? 0 : (sLeft > sRight ? 1 : -1);
                    // 첫자리 우선 → 같은 첫자리면 전체 숫자 비교
                    const iFirstLeft = String(iLeft)[0], iFirstRight = String(iRight)[0];
                    if (iFirstLeft !== iFirstRight) return iFirstLeft > iFirstRight ? 1 : -1;
                    return iLeft - iRight;
                };
                const sorters = this._makeGLAccountSorters
                    ? this._makeGLAccountSorters()
                    : [new sap.ui.model.Sorter("GLAccount", false, null, numComparator)];

                oList.unbindRows();
                oList.bindRows("GLALL>/items");

                // 남아있던 검색/필터/소터 제거 및 소터 적용
                const b2 = oList.getBinding("rows");
                if (b2) { b2.filter([]); b2.sort(sorters || []); }


                if (oMenu.setContentHeight) oMenu.setContentHeight("36rem");
                if (oMenu.setContentWidth) oMenu.setContentWidth("28rem");

                // 6) 선택 복원(토큰 ∪ 메모리)
                const prior = new Set([...(this._glKeys || new Set())]);
                (oMI.getTokens() || []).forEach(t => prior.add(String(t.getKey())));

                // 스테이징에도 prior 반영
                this._glStage = new Set(Array.from(prior));

                setTimeout(() => { this._restoreSelectionsInList("L_GlAccountText"); }, 0);
            } catch (e) {
                console.error(e);
            }
            this._menuOpen = true;
            try {
                const oMI = this.byId("MI_GlAccountTextSelected");
                const prior = new Set([...(this._glKeys || new Set())]);
                (oMI && oMI.getTokens ? oMI.getTokens() : []).forEach(t => prior.add(String(t.getKey())));
                this._glStage = new Set(Array.from(prior));
            } catch (e) {
                this._glStage = new Set(Array.from(this._glKeys || []));
            }
            this._restoreSelectionsFromSet("L_GlAccountText", this._glStage);
            this._previewTokensFromSet(this._glStage, "MenuOpen_GLTEXT");

            // GLACCOUNT에서 선택된 값들을 GLACCOUNTTEXT 토큰에도 즉시 표시
            try {
                const oMiGlAccountTextSelected = this.byId("MI_GlAccountTextSelected");
                if (oMiGlAccountTextSelected) {
                    const oGlAllMap = this._getGLAllMap();
                    oMiGlAccountTextSelected.destroyTokens();
                    Array.from(this._glStage).forEach(sGlAccount => {
                        const sName = oGlAllMap.get(String(sGlAccount)) || String(sGlAccount);
                        oMiGlAccountTextSelected.addToken(new sap.m.Token({ key: String(sGlAccount), text: `${sName} (${sGlAccount})` }));
                    });
                }
            } catch (e) { /* noop */ }
        },

        _previewTokensFromSet: function (oInputSet, sEvent) {
            const oGlAllMap = this._getGLAllMap(); // GLAccount -> GLAccountLongName 맵
            const aInputCodes = Array.from(oInputSet || new Set());
                       
            ["MI_GlAccountSelected", "MI_GlAccountTextSelected"].forEach(sControlId => {
                const oMultiInput = this.byId(sControlId); if (!oMultiInput) return;
                if (sEvent === "MenuOpen_GL" || sEvent === "MenuOpen_GLTEXT") {
                    let oTable = sEvent === "MenuOpen_GLTEXT"
                        ? (this.byId(Control.Table.L_GlAccountText) || this.byId(Control.Table.L_GlAccount))
                        : (this.byId(Control.Table.L_GlAccount) || this.byId(Control.Table.L_GlAccountText));
                    if (!oTable) return;
                    let aGlAllItems = oTable.getModel("GLALL").getProperty("/items");
                    let aSelectedIndices = aGlAllItems.reduce(function (aIndexList, oGlAllRow, iRowIndex) {
                        const sRowGlAccount = String(oGlAllRow.GLAccount);
                        const bIsSelectedByStage = (this._glStage && this._glStage.has(sRowGlAccount));
                        if (bIsSelectedByStage) {
                            aIndexList.push(iRowIndex);
                        }
                        return aIndexList;
                    }.bind(this), [])

                    aSelectedIndices.forEach(function (iSelectedIndex) {
                        try { oTable.addSelectionInterval(iSelectedIndex, iSelectedIndex); } catch (e) { /* noop */ }
                    })

                } else {
                    oMultiInput.destroyTokens();
                    aTokenSeletedGLAccount = [];
                    const MAX_RENDER_TOKENS = 50;
                    if (aInputCodes.length > MAX_RENDER_TOKENS) {
                        const total = aInputCodes.length;
                        const sample = aInputCodes.slice(0, 3).map(k => `${oGlAllMap.get(String(k)) || String(k)} (${k})`).join(", ");
                        const text = `선택 ${total}개 (${sample} 외 ${total - 3}개)`;
                        oMultiInput.addToken(new sap.m.Token({ key: "__BULK__", text }));
                        aTokenSeletedGLAccount = aInputCodes.slice();
                    } else {
                        aInputCodes.forEach(sInput => {
                            const sName = oGlAllMap.get(String(sInput)) || String(sInput);
                            let oToken = new sap.m.Token({ key: String(sInput), text: `${sName} (${sInput})` });
                            oMultiInput.addToken(oToken);
                            aTokenSeletedGLAccount.push(sInput);
                        });
                    }
            
                }

            });
        },

        _restoreSelectionsFromSet: function (sListId, oSet) {
            const oList = this.byId(sListId);
            if (!oList) return;

            // 스크롤/필터에 따른 선택 복원 중에는 selectionChange 핸들러를 억제
            const prevSuppress = !!this._isRestoringSelections;
            this._isRestoringSelections = true;

            // L_GlAccount는 sap.ui.table.Table이므로 rows 바인딩 확인
            const oItemsBinding = oList.getBinding("items") || oList.getBinding("rows");
            if (!oItemsBinding) { this._isRestoringSelections = prevSuppress; return; }

            const oWanted = new Set(Array.from(oSet || new Set()).map(String));

            // Table인 경우 clearSelection, List인 경우 removeSelections
            if (oList.clearSelection) {
                oList.clearSelection();
            } else if (oList.removeSelections) {
                oList.removeSelections(true);
            }

            // 선택된 항목이 없으면 아무것도 선택하지 않음
            if (oWanted.size === 0) {
                this._isRestoringSelections = prevSuppress;
                return;
            }

			// Table인 경우 - 화면에 보이는 행(약 10개)만 보지 말고 전체 모델 인덱스로 선택 복원
			if (oList.getRows) {
				try {
					const oBinding = oList.getBinding("rows");
					if (oBinding && oBinding.getLength && oBinding.getContextByIndex) {
						const n = oBinding.getLength();
						const CHUNK = 200; // 배치 복원으로 렉 완화
						let start = 0;
						const step = () => {
							const end = Math.min(n, start + CHUNK);
							for (let i = start; i < end; i++) {
								const ctx = oBinding.getContextByIndex(i);
								const sCode = ctx && ctx.getProperty && ctx.getProperty("GLAccount");
								if (sCode && oWanted.has(String(sCode))) {
									try { oList.addSelectionInterval(i, i); } catch (eSel) { /* noop */ }
								}
							}
							start = end;
							if (start < n) { setTimeout(step, 0); }
						};
						step();

					} else {
						// 폴백: 모델 배열 전체 인덱스 기반
						const aAllItems = oList.getModel("GLALL")?.getProperty("/items") || [];
						const n = aAllItems.length;
						const CHUNK = 200;
						let start = 0;
						const step = () => {
							const end = Math.min(n, start + CHUNK);
							for (let i = start; i < end; i++) {
								const sCode = aAllItems[i] && aAllItems[i].GLAccount;
								if (sCode && oWanted.has(String(sCode))) {
									try { oList.addSelectionInterval(i, i); } catch (eIdx) { /* noop */ }
								}
							}
							start = end;
							if (start < n) { setTimeout(step, 0); }
						};
						step();
					}
				} catch (e) {
					// 최후 폴백: 화면 보이는 행 기준
					const aRows = oList.getRows() || [];
					const first = (typeof oList.getFirstVisibleRow === "function") ? oList.getFirstVisibleRow() : 0;
					aRows.forEach((oRow, iIndex) => {
						const sCode = oRow.getBindingContext("GLALL")?.getProperty("GLAccount");
						if (!sCode) return;
						if (oWanted.has(String(sCode))) {
							try {
								const absIndex = (typeof oRow.getIndex === "function") ? oRow.getIndex() : (first + iIndex);
								oList.addSelectionInterval(absIndex, absIndex);
							} catch (e2) { /* noop */ }
						}
					});
				}
			} else {
                // List인 경우 기존 로직 사용
                const aItems = oList.getItems ? oList.getItems() : [];
                aItems.forEach((oItem, iIndex) => {
                    const sCode = oItem.getBindingContext("GLALL")?.getProperty("GLAccount");
                    if (!sCode) return;

                    if (oWanted.has(String(sCode))) {
                        oList.setSelectedItem(oItem, true, true);
                    }
                });
            }
            // 복원 종료 후 억제 플래그 원복
            this._isRestoringSelections = prevSuppress;
        },

        // ========================================================
        // Bookmark
        // ========================================================
        // 헤더 ES/ET에서 아이템 ES로 향하는 네비게이션 이름을 메타에서 찾아옴
        _getHeadToItemNavName: async function () {
            const oModel = this._getOData();
            await this._ensureMetaReady(oModel);
            const oMetaModel = oModel.getMetaModel();

            const oEntitySetHead = oMetaModel.getODataEntitySet("BookMark_Head");
            const oEntitySetItem = oMetaModel.getODataEntitySet("BookMark_Item");
            if (!oEntitySetHead || !oEntitySetItem) throw new Error("BookMark_Head/Item EntitySet 없음");

            const oEntityTypeHead = oMetaModel.getODataEntityType(oEntitySetHead.entityType);
            const aNavigationProperties = oEntityTypeHead.navigationProperty || [];

            for (const oNavigationProperty of aNavigationProperties) {
                // toEntitySet 을 구해 실제 아이템 ES와 매칭
                const oAssociationSet = oMetaModel.getODataAssociationSet(oEntitySetHead, oEntityTypeHead, oNavigationProperty.name);
                if (oAssociationSet && oAssociationSet.end && oAssociationSet.end.length === 2) {
                    const oEndTarget = oAssociationSet.end.find(oEnd => oEnd.entitySet !== oEntitySetHead.name);
                    if (oEndTarget && oEndTarget.entitySet === oEntitySetItem.name) {
                        return oNavigationProperty.name; // 예: "to_Items" 또는 "_Items" 등 실제 이름
                    }
                }
            }
            throw new Error("헤더→아이템 네비게이션을 찾을 수 없음");
        },

        // 헤더 목록
        _loadBookmarkHeads: async function () {
            try {


                const oModel = this._getOData();
                if (!oModel) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                // DB에서 북마크 헤더 목록 조회 (서버 페이징 우회: $skip 반복)
                const pageSizeHead = 500;
                let skipHead = 0;
                let aBookmarks = [];
                while (true) {
                    const aPage = await new Promise((resolve, reject) => {
                        oModel.read("/BookMark_Head", {
                            urlParameters: { "$top": String(pageSizeHead), "$skip": String(skipHead) },
                            success: (oData) => resolve(oData.results || []),
                            error: (oError) => {
                                console.error("[BM] DB 북마크 헤더 조회 실패:", oError);
                                reject(oError);
                            }
                        });
                    });
                    aBookmarks = aBookmarks.concat(aPage);
                    if (aPage.length < pageSizeHead) break; // 마지막 페이지
                    skipHead += aPage.length;
                }
                console.log("[BM] 헤더 누적 로드 개수:", aBookmarks.length);

                // 날짜 형식 변환
                return aBookmarks.map(oBookmark => ({
                    Bookmarkid: oBookmark.Bookmarkid,
                    Bookmarkname: oBookmark.Bookmarkname || "이름 없음",
                    CreatedDate: oBookmark.CreatedDate || new Date().toLocaleDateString('ko-KR')
                }));

            } catch (e) {
                console.error("[BM] DB 북마크 헤더 로드 실패:", e);
                // 실패 시 빈 배열 반환
                return [];
            }
        },

        // 특정 헤더의 아이템
        _loadBookmarkItems: async function (bookmarkId) {
            try {
                const oModel = this._getOData();
                if (!oModel) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                // DB에서 북마크 아이템 조회 (서버 페이징 우회: $skip 반복)
                const pageSizeItem = 500;
                let skipItem = 0;
                let aItems = [];
                while (true) {
                    const aPage = await new Promise((resolve, reject) => {
                        oModel.read("/BookMark_Item", {
                            filters: [new sap.ui.model.Filter("Bookmarkid", sap.ui.model.FilterOperator.EQ, bookmarkId)],
                            urlParameters: { "$top": String(pageSizeItem), "$skip": String(skipItem) },
                            success: (oData) => resolve(oData.results || []),
                            error: (oError) => {
                                console.error("[BM] DB 북마크 아이템 조회 실패:", oError);
                                reject(oError);
                            }
                        });
                    });
                    aItems = aItems.concat(aPage);
                    if (aPage.length < pageSizeItem) break;
                    skipItem += aPage.length;
                }
                console.log("[BM] 아이템 누적 로드 개수:", aItems.length);

                // DB 아이템을 앱 상태 형식으로 변환
                const aExpandedNodes = [];
                const aCollapsedNodes = [];

                aItems.forEach(oItem => {
                    if (oItem.Node) {

                        if (oItem.Drillstate === "expanded") {
                            aExpandedNodes.push(oItem.Node);

                        } else {
                            // "leaf"이거나 다른 값이면 접힌 상태로 간주
                            aCollapsedNodes.push(oItem.Node);

                        }
                    }
                });

                // 앱 상태 형식으로 변환
                const oState = {
                    tableState: {
                        tree: {
                            expandedNodes: aExpandedNodes,
                            collapsedNodes: aCollapsedNodes,
                            firstVisibleRow: 0,
                            selectedNodeId: null
                        }
                    }
                };

                return oState;

            } catch (e) {
                console.error("[BM] DB 북마크 아이템 로드 실패:", e);
                return null;
            }
        },


        // 삭제 (DB에서 제거)
        _deleteBookmarkFromDB: async function (bookmarkId) {
            try {

                const oModel = this._getOData();
                if (!oModel) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                // 먼저 관련 아이템들을 삭제
                const aItems = await new Promise((resolve, reject) => {
                    oModel.read("/BookMark_Item", {
                        filters: [new sap.ui.model.Filter("Bookmarkid", sap.ui.model.FilterOperator.EQ, bookmarkId)],
                        success: (oData) => resolve(oData.results || []),
                        error: reject
                    });
                });

                // 아이템들 삭제
                for (const oItem of aItems) {
                    await new Promise((resolve, reject) => {
                        const sItemKey = oModel.createKey("BookMark_Item", {
                            Bookmarkid: oItem.Bookmarkid,
                            Bookmark_Item: oItem.Bookmark_Item
                        });
                        // createKey 는 "BookMark_Item(...)" 형태를 반환하므로 앞에만 '/'를 붙여야 함
                        oModel.remove(`/${sItemKey}`, {
                            success: resolve,
                            error: reject
                        });
                    });
                }

                // 헤더 삭제
                await new Promise((resolve, reject) => {
                    const sHeadKey = oModel.createKey("BookMark_Head", {
                        Bookmarkid: bookmarkId
                    });
                    // createKey 는 "BookMark_Head(...)" 형태를 반환하므로 앞에만 '/'를 붙여야 함
                    oModel.remove(`/${sHeadKey}`, {
                        success: () => {

                            resolve();
                        },
                        error: reject
                    });
                });

            } catch (e) {
                console.error("[BM] DB 북마크 삭제 실패:", e);
                throw new Error("북마크 삭제 실패: " + e.message);
            }
        },


        _uuid: function () {
            // 간단 GUID
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },

        _collectBookmarkItemsForDB: function (state) {
            try {


                if (!state || !state.tableState || !state.tableState.tree) {
                    console.warn("[BM] 상태 데이터가 올바르지 않습니다:", state);
                    return [];
                }

                const oTreeState = state.tableState.tree;
                const aItems = [];



                // 펼쳐진 노드들만 저장 (DrillState = "expanded")
                if (oTreeState.expandedNodes && Array.isArray(oTreeState.expandedNodes)) {

                    oTreeState.expandedNodes.forEach((sNodeId, nIndex) => {
                        const oItem = {
                            Hierarchyid: "",
                            Node: sNodeId,
                            Glaccount: "",
                            Parentnodeid: "",
                            Glaccounttext: "",
                            Nodetext: "",
                            Hierarchylevel: "",
                            Drillstate: "expanded", // 펼쳐진 노드는 "expanded"
                            Sortindex: 0,
                            Top: 0
                        };
                        aItems.push(oItem);

                    });
                }

                // 접힌 노드들은 별도로 저장하지 않음 (기본 상태)
                // SAPUI5 TreeTable에서는 접힌 상태가 기본값이므로 DB에 저장할 필요 없음
                if (oTreeState.collapsedNodes && Array.isArray(oTreeState.collapsedNodes)) {

                }

                // 특별히 1000, 2000 노드가 포함되어 있는지 확인
                const bHas1000Expanded = oTreeState.expandedNodes?.includes("1000");
                const bHas1000Collapsed = oTreeState.collapsedNodes?.includes("1000");
                const bHas2000Expanded = oTreeState.expandedNodes?.includes("2000");
                const bHas2000Collapsed = oTreeState.collapsedNodes?.includes("2000");



                return aItems;

            } catch (e) {
                console.error("[BM] DB용 북마크 아이템 수집 실패:", e);
                return [];
            }
        },
        // async 호출 함수
        // 기존 _uuid, _collectBookmarkItemsForDB 는 그대로 사용

        saveBookmarkToDB: async function (bookmarkName) {
            try {


                // 입력 검증
                if (!bookmarkName || typeof bookmarkName !== 'string') {
                    throw new Error("북마크 이름이 올바르지 않습니다.");
                }

                // 현재 앱 상태 캡처
                let oState;
                try {
                    oState = await this._captureAppState();
                    if (!oState || typeof oState !== 'object') {
                        throw new Error("앱 상태를 캡처할 수 없습니다.");
                    }

                } catch (e) {
                    console.error("앱 상태 캡처 실패:", e);
                    throw new Error("현재 화면 상태를 저장할 수 없습니다. 다시 시도해주세요.");
                }

                // DB에 저장
                const aItems = this._collectBookmarkItemsForDB(oState);
                const sId = await this._saveBookmarkToDB_direct(bookmarkName.trim(), aItems);


                sap.m.MessageToast.show(`"${bookmarkName}" 북마크가 저장되었습니다.`);

                return sId;
            } catch (e) {
                console.error("DB 북마크 저장 실패:", e);
                const errorMsg = e.message || "알 수 없는 오류가 발생했습니다.";
                sap.m.MessageBox.error(`북마크 저장 실패\n${errorMsg}`);
                throw e;
            }
        },

        listBookmarksFromDB: async function () {
            // 로컬 스토리지에서 북마크 목록 반환
            const bookmarks = await this._bm_all();
            return bookmarks.map(bm => ({
                Bookmarkid: bm.id,
                Bookmarkname: bm.name,
                CreatedDate: bm.createdAt
            }));
        },
        loadBookmarkItemsFromDB: async function (bookmarkId) {
            // 로컬 스토리지에서 특정 북마크의 상태 반환
            const bookmarks = await this._bm_all();
            const bookmark = bookmarks.find(bm => bm.id === bookmarkId);
            return bookmark ? bookmark.state : null;
        },

        _applyBookmarkItemsClient: function (state) {
            // 로컬 스토리지 기반 북마크 시스템에서는 _applyAppState 사용
            if (state) {
                this._applyAppState(state);
            }
        },
        deleteBookmarksFromDB: async function (bookmarkIds /* string[] */) {
            try {
                if (!bookmarkIds || !Array.isArray(bookmarkIds) || bookmarkIds.length === 0) {
                    console.warn("삭제할 북마크 ID가 올바르지 않습니다:", bookmarkIds);
                    return;
                }

                let successCount = 0;
                let failCount = 0;

                for (const id of bookmarkIds) {
                    try {
                        await this._deleteBookmarkFromDB(id);
                        successCount++;
                    } catch (e) {
                        failCount++;
                        console.error("북마크 삭제 실패:", id, e);
                    }
                }

                if (successCount > 0) {
                    sap.m.MessageToast.show(`${successCount}개 북마크가 삭제되었습니다.`);
                }
                if (failCount > 0) {
                    sap.m.MessageBox.warning(`${failCount}개 북마크 삭제에 실패했습니다.`);
                }

            } catch (e) {
                console.error("북마크 삭제 처리 실패:", e);
                sap.m.MessageBox.error("북마크 삭제 중 오류가 발생했습니다.\n" + (e.message || ""));
            }
        },
        onBookmarkSave: async function () {
            try {
                const oTable = this.byId("T_Main");
                const ob = oTable?.getBinding("rows");
                if (!ob) {

                    return sap.m.MessageToast.show("먼저 조회를 실행하세요.");
                }

                // 테이블이 로딩 중인지 확인
                if (oTable.getBusy()) {
                    return sap.m.MessageToast.show("데이터 로딩 중입니다. 잠시 후 다시 시도하세요.");
                }

                await this._waitRowsSettled(oTable, 160);

                // 다이얼로그
                const inp = new sap.m.Input({
                    placeholder: "북마크 이름을 입력하세요",
                    maxLength: 50,
                    liveChange: function (oEvent) {
                        const value = oEvent.getParameter("value") || "";
                        const trimmed = value.trim();
                        if (trimmed.length > 50) {
                            inp.setValue(trimmed.substring(0, 50));
                        }
                    }
                });

                const dlg = new sap.m.Dialog({
                    title: "북마크 저장",
                    content: [
                        new sap.m.VBox({
                            items: [
                                new sap.m.Text({
                                    text: "현재 화면의 설정을 북마크로 저장합니다.",
                                    class: "sapUiSmallMarginBottom"
                                }),
                                inp
                            ]
                        })
                    ],
                    buttons: [
                        new sap.m.Button({
                            text: "저장",
                            type: "Emphasized",
                            press: async function () {
                                const self = this.getView().getController();
                                try {
                                    const name = (inp.getValue() || "").trim();
                                    if (!name) {
                                        sap.m.MessageToast.show("북마크 이름을 입력하세요.");
                                        return;
                                    }
                                    if (name.length > 50) {
                                        sap.m.MessageToast.show("북마크 이름은 50자 이내로 입력하세요.");
                                        return;
                                    }

                                    // 저장 버튼 비활성화
                                    dlg.setBusy(true);
                                    await self.saveBookmarkToDB(name);
                                    dlg.close();
                                } catch (e) {
                                    console.error("북마크 저장 중 오류:", e);
                                    sap.m.MessageBox.error("북마크 저장 실패\n" + (e?.message || e));
                                } finally {
                                    dlg.setBusy(false);
                                }
                            }.bind(this)
                        }),
                        new sap.m.Button({
                            text: "취소",
                            press: () => dlg.close()
                        })
                    ]
                });

                this.getView().addDependent(dlg);
                dlg.attachAfterClose(function () { this.destroy(); }, dlg);
                dlg.open();

                // 다이얼로그가 열린 후 입력 필드에 포커스
                setTimeout(() => {
                    inp.focus();
                }, 100);

            } catch (e) {
                console.error("북마크 저장 다이얼로그 오류:", e);
                sap.m.MessageBox.error("북마크 저장 기능을 사용할 수 없습니다.\n" + (e?.message || e));
            }
        },

        // 현재 테이블의 드릴 상태를 스냅샷(Map)으로 만든다: key = Node(또는 NodeID), val = 'expanded' | 'collapsed' | 'leaf'
        _makeDrillStateMap: function (oTable, oBinding) {
            const map = new Map();
            const len = oBinding.getLength();

            for (let i = 0; i < len; i++) {
                const ctx = oBinding.getContextByIndex(i);
                if (!ctx) continue;
                const o = ctx.getObject();

                // 북마크에서 노드를 구분하는 키(서비스에 맞춰 조정)
                const key = String(o.Node ?? o.NodeID ?? o.GlAccount ?? "");
                if (!key) continue;

                let st = "leaf";
                try {
                    const hasChildren = typeof oBinding.hasChildren === "function"
                        ? oBinding.hasChildren(ctx)
                        : !!o.HasChildren; // 서비스에 HasChildren 같은 플래그가 있으면 사용

                    if (hasChildren) st = oTable.isExpanded(i) ? "expanded" : "collapsed";
                } catch (e) { /* noop */ }

                map.set(key, st);
            }
            return map;
        },

        _whenMetaReady: async function () {
            const m = this.getView().getModel();
            await new Promise(res => m.getServiceMetadata() ? res() : m.attachMetadataLoaded(res));
            const mm = m.getMetaModel && m.getMetaModel();
            if (mm && mm.loaded) await mm.loaded();
        },
        _isGuid36: s => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(s || "")),

        _saveBookmarkToDB: async function (bookmarkName, items /*array*/) {
            await this._whenMetaReady();
            const oModel = this.getView().getModel("F_GLAccount_VH");

            // (A) Head 먼저 생성 → 서버가 Bookmarkid 생성
            const sHeadId = await new Promise((resolve, reject) => {
                oModel.create("/BookMark_Head", { Bookmarkname: bookmarkName }, {
                    success: (oData) => {
                        const sId = oData && oData.Bookmarkid;
                        if (!this._isGuid36(sId)) return reject(new Error("서버가 반환한 Bookmarkid 형식 오류: " + sId));
                        resolve(sId);             // ← 변형 금지(하이픈 제거 X, guid'…'로 싸지 말 것)
                    },
                    error: reject
                });
            });
            // (B) Item 배치 생성
            const sGroupId = "BM_ITEMS_" + Date.now();
            oModel.setDeferredGroups([sGroupId]);

            (items || []).forEach((oItem, nIdx) => {
                oModel.create("/BookMark_Item", {
                    // Bookmarkid: Edm.Guid, creatable=false 라고 되어 있어도
                    // 이 서비스는 값 파싱을 시도합니다 → 그대로 36자 GUID 전달
                    Bookmarkid: sHeadId,
                    // Bookmark_Item: Edm.Guid 이므로 신규 GUID 생성해서 넣기(숫자 금지)
                    Bookmark_Item: this._guid36(),

                    Hierarchyid: oItem.Hierarchyid || "",
                    Node: oItem.Node || "",
                    Glaccount: oItem.Glaccount || "",
                    Parentnodeid: oItem.Parentnodeid || "",
                    Glaccounttext: oItem.Glaccounttext || "",
                    Nodetext: oItem.Nodetext || "",
                    Hierarchylevel: oItem.Hierarchylevel || "",
                    Drillstate: oItem.Drillstate || "",
                    Sortindex: oItem.Sortindex ?? nIdx,   // Edm.Int64 → 숫자 OK
                    Top: oItem.Top ?? 0      // Edm.Int32
                }, { groupId: sGroupId });
            });
            await new Promise((resolve, reject) => {
                oModel.submitChanges({
                    groupId: sGroupId,
                    success: (oRes) => {
                        const bBad = (oRes.__batchResponses || []).some(oBatch =>
                            (oBatch.response && +oBatch.response.statusCode >= 400) ||
                            (oBatch.__changeResponses || []).some(oChangeResp => +oChangeResp.statusCode >= 400)
                        );
                        bBad ? reject(new Error("아이템 저장 실패")) : resolve();
                    },
                    error: reject
                });
            });

            oModel.setDeferredGroups([]);
            return sHeadId;
        },
        // 엔터티셋/프로퍼티 Edm 타입 얻기 (안전, 실패 시 null)
        _getEdmType: async function (entitySetName, propName) {
            await this._whenMetaReady();

            const oModel = this.getView().getModel("F_GLAccount_VH");
            const mm = oModel.getMetaModel && oModel.getMetaModel();
            if (!mm) return null;

            // 메타모델이 로드되었는지 한 번 더 보장
            if (typeof mm.loaded === "function") {
                try { await mm.loaded(); } catch (e) { /* ignore */ }
            }

            // 방어적으로 접근
            const es = mm.getODataEntitySet && mm.getODataEntitySet(entitySetName);
            if (!es) return null;

            const et = mm.getODataEntityType && mm.getODataEntityType(es.entityType);
            if (!et || !Array.isArray(et.property)) return null;

            const p = et.property.find(x => x.name === propName);
            return p && p.type ? p.type : null;          // e.g. "Edm.Int32", "Edm.String"
        },

        // 필터 값 타입 보정 (기존 그대로 사용)
        _coerceForFilter: function (edmType, v) {
            switch (edmType) {
                case "Edm.Int16":
                case "Edm.Int32":
                case "Edm.Int64": return parseInt(v, 10);
                case "Edm.Decimal":
                case "Edm.Double":
                case "Edm.Single": return parseFloat(v);
                case "Edm.Boolean": return String(v).toLowerCase() === "true" || v === true || v === 1;
                default: return String(v);
            }
        },
        _newGuidV4: function () {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }).toUpperCase();
        },
        _guid36: function () {
            const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
            return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`.toLowerCase();
        },

        _getOData: function () {
            try {
                // 기본모델이 OData V2인지 확인 (필요하면 "main" 같은 이름모델을 써도 됨)
                const component = this.getOwnerComponent();
                if (!component) {
                    throw new Error("컴포넌트를 찾을 수 없습니다.");
                }

                const m = component.getModel(); // 또는 getModel("main")
                if (!m) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                if (!(m instanceof sap.ui.model.odata.v2.ODataModel)) {
                    throw new Error("OData V2 모델이 아닙니다. (컴포넌트의 기본/이름모델 확인)");
                }

                return m;
            } catch (e) {
                console.error("[BM] OData 모델 가져오기 실패:", e);
                return null;
            }
        },

        _ensureMetaReady: async function (oModel) {
            // 서비스 메타 + 메타모델 로드 완료까지 대기
            await oModel.metadataLoaded();
            const mm = oModel.getMetaModel();
            await mm.loaded();
            return mm;
        },

        _saveBookmarkToDB_direct: async function (name, rawItems) {
            try {


                const oModel = this._getOData();
                if (!oModel) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                // 1) 메타 & 네비 이름 확인 (에러 발생 시 기본값 사용)
                let sNavName = "to_Item";
                let bItemCreatable = true;

                try {
                    const oMeta = await this._resolveBookmarkMeta();
                    sNavName = oMeta.navName || "to_Item";
                    bItemCreatable = oMeta.itemCreatable !== false;

                } catch (oMetaError) {
                    console.warn("[BM] 메타 정보 해석 실패, 기본값 사용:", oMetaError.message);

                }

                // 2) 헤더 생성
                const sHeadId = await new Promise((resolve, reject) => {
                    oModel.create("/BookMark_Head", { Bookmarkname: name }, {
                        success: oData => {
                            const sId = oData?.Bookmarkid;
                            if (!sId) {
                                reject(new Error("서버가 Bookmarkid를 반환하지 않았습니다."));
                                return;
                            }

                            resolve(sId);
                        },
                        error: (oError) => {
                            console.error("[BM] 북마크 헤더 생성 실패:", oError);
                            reject(new Error("북마크 헤더 생성 실패: " + (oError.message || oError)));
                        }
                    });
                });

                // 3) 배치 준비
                const sGroupId = "BM_SAVE_" + Date.now();
                oModel.setDeferredGroups([sGroupId]);

                // 4) 페이로드 정제
                const aItems = (rawItems || []).map((oRawItem, nIdx) => this._sanitizeBookmarkItem(oRawItem, nIdx, null));

                // 5) 네비 경로 우선 사용(있으면). 없으면 엔티티셋으로 직접 POST (FK 포함)
                if (sNavName) {
                    const sHeadKey = oModel.createKey("BookMark_Head", { Bookmarkid: sHeadId });
                    const sNavPath = `/${sHeadKey}/${sNavName}`;
                    aItems.forEach(oPayload => {
                        // FK는 네비 경로가 채워주므로 넣지 않음
                        const oCleanPayload = Object.assign({}, oPayload);
                        delete oCleanPayload.Bookmarkid;
                        oModel.create(sNavPath, oCleanPayload, { groupId: sGroupId });
                    });
                } else {
                    // 네비가 없으면 엔티티셋으로 직접 POST (FK 필요)
                    if (!bItemCreatable) {
                        throw new Error("BookMark_Item creatable=false (백엔드에서 CUD 활성화 필요)");
                    }
                    aItems.forEach(oPayload => {
                        const oFullPayload = Object.assign({ Bookmarkid: sHeadId }, oPayload);
                        oModel.create("/BookMark_Item", oFullPayload, { groupId: sGroupId });
                    });
                }

                // 6) 배치 전송 + 상세 로그
                await new Promise((resolve, reject) => {
                    oModel.submitChanges({
                        groupId: sGroupId,
                        success: (oRes) => {
                            const aBatch = oRes && oRes.__batchResponses || [];
                            // 로그: 실제로 몇 건의 change 가 나갔는지 출력
                            let nTotalChanges = 0, aErrors = [];
                            aBatch.forEach(oBatch => {
                                const aChanges = oBatch.__changeResponses || [];
                                nTotalChanges += aChanges.length;
                                if (oBatch.response && +oBatch.response.statusCode >= 400) {
                                    aErrors.push(oBatch.response.body || oBatch.response.statusText);
                                }
                                aChanges.forEach(oChangeResp => {
                                    if (+oChangeResp.statusCode >= 400) aErrors.push((oChangeResp.response && oChangeResp.response.body) || oChangeResp.message || "change error");
                                });
                            });

                            if (aErrors.length) {
                                reject(new Error("아이템 저장 실패\n" + aErrors.join("\n\n")));
                                return;
                            }

                            resolve();
                        },
                        error: (oError) => {
                            console.error("[BM] 배치 전송 실패:", oError);
                            reject(new Error("배치 전송 실패: " + (oError.message || oError)));
                        }
                    });
                });

                return sHeadId;

            } catch (e) {
                console.error("[BM] DB 직접 저장 실패:", e);
                throw new Error("DB 북마크 저장 실패: " + (e.message || e));
            }
        },


        _sanitizeBookmarkItem: function (oRawItem, nIdx) {
            const fnCut = (sValue, nMaxLength) => (sValue == null ? "" : String(sValue)).substring(0, nMaxLength);
            const fnAsInt = (vValue, nDefault = 0) => Number.isFinite(Number(vValue)) ? Math.trunc(Number(vValue)) : nDefault;
            const nLevel = fnAsInt(oRawItem.HierarchyLevel, 1);

            return {
                Bookmark_Item: this._guid36(),                          // Edm.Guid
                Hierarchyid: fnCut(oRawItem.HierarchyID || oRawItem.HierarchyId || "", 50),
                Node: fnCut(oRawItem.Node != null ? oRawItem.Node : (oRawItem.NodeID ?? ""), 50),
                Parentnodeid: fnCut(oRawItem.ParentNodeID ?? oRawItem.ParentNode ?? "", 50),
                Glaccount: fnCut(String(oRawItem.GlAccount || "").toUpperCase(), 10),
                Glaccounttext: fnCut(oRawItem.GlAccountText || "", 255),
                Nodetext: fnCut(oRawItem.NodeText || "", 255),
                Hierarchylevel: fnCut(String(nLevel), 6),                    // Edm.String(6)
                Drillstate: fnCut(oRawItem.DrillState || (oRawItem.GlAccount ? "leaf" : "expanded"), 10),
                Sortindex: String(fnAsInt(nIdx)),                       // ★ Edm.Int64 → 문자열로
                Top: fnAsInt(nLevel === 1 ? 1 : 0)                // Edm.Int32
            };
        },

        _extractBatchError(res) {
            try {
                const br = res && res.__batchResponses || [];
                for (const r of br) {
                    if (r.response && r.response.statusCode >= 400) return new Error(r.response.body || "Batch error");
                    if (r.__changeResponses) {
                        for (const cr of r.__changeResponses) {
                            if (cr.statusCode >= 400) return new Error((cr.response && cr.response.body) || "Change error");
                        }
                    }
                }
            } catch (e) { }
            return null;
        },
        // 메타에서 Head → Item 네비 이름, Item 엔티티셋 creatable 여부 확인
        _resolveBookmarkMeta: async function () {
            try {
                const oModel = this._getOData();
                if (!oModel) {
                    throw new Error("OData 모델을 찾을 수 없습니다.");
                }

                await oModel.metadataLoaded();
                const oMetaModel = oModel.getMetaModel();
                if (!oMetaModel) {
                    throw new Error("OData 메타 모델을 찾을 수 없습니다.");
                }

                const oEntitySetHead = oMetaModel.getODataEntitySet("BookMark_Head");
                if (!oEntitySetHead) {
                    throw new Error("BookMark_Head EntitySet을 찾을 수 없습니다.");
                }

                const oEntityTypeHead = oMetaModel.getODataEntityType(oEntitySetHead.entityType);
                if (!oEntityTypeHead) {
                    throw new Error("BookMark_Head EntityType을 찾을 수 없습니다.");
                }

                // 헤더의 네비 중 아이템 타입 가리키는 것 찾기
                const aNavigations = oEntityTypeHead.navigationProperty || [];
                let sNavName = null;
                for (const oNavigationProperty of aNavigations) {
                    const oAssociation = oMetaModel.getODataAssociationEnd(oEntityTypeHead, oNavigationProperty.name);
                    if (!oAssociation) continue;
                    const sToType = oAssociation.type; // 예: ...ZC_MANAGEBOOKMARK_ITEMType
                    if (sToType && /BOOKMARK.*ITEM/i.test(sToType)) {
                        sNavName = oNavigationProperty.name;
                        break;
                    }
                }

                const oEntitySetItem = oMetaModel.getODataEntitySet("BookMark_Item");
                const bItemCreatable = !oEntitySetItem || oEntitySetItem["sap:creatable"] !== "false"; // 없으면 true로 간주


                return { navName: sNavName, itemCreatable: bItemCreatable };

            } catch (e) {
                console.error("[BM] 메타데이터 해석 실패:", e);
                // 기본값 반환
                return {
                    navName: "to_Item", // 기본 네비게이션 이름
                    itemCreatable: true
                };
            }
        },
        _safeGetObjByIndex: function (oBinding, i) {
            try {
                const ctx = oBinding && oBinding.getContextByIndex && oBinding.getContextByIndex(i);
                return (ctx && ctx.getObject) ? ctx.getObject() : null;
            } catch (e) { return null; }
        },
        _collectExportRows: function (oBinding) {
            const out = [];
            const len = oBinding.getLength();
            for (let i = 0; i < len; i++) {
                const o = this._safeGetObjByIndex(oBinding, i);
                if (o) out.push(o);
            }
            return out;
        },

        // 데이터 로드 완료 대기 함수
        _waitForDataLoad: function (oTable) {
            return new Promise((resolve) => {
                const oBinding = oTable.getBinding('rows');
                if (!oBinding) {
                    resolve();
                    return;
                }

                const checkData = () => {
                    if (oBinding.getLength() > 0) {
                        resolve();
                    } else {
                        setTimeout(checkData, 100);
                    }
                };

                // 데이터가 이미 로드된 경우
                if (oBinding.getLength() > 0) {
                    resolve();
                } else {
                    // 데이터 로드 이벤트 대기
                    oBinding.attachDataReceived(() => {
                        resolve();
                    });
                    setTimeout(checkData, 1000); // 최대 1초 대기
                }
            });
        },

        // 현재 페이지의 데이터 수집 함수
        _collectCurrentPageData: function (oTable) {
            const aExportData = [];
            const oBinding = oTable.getBinding('rows');
            if (!oBinding) return aExportData;

            const iRowCount = oBinding.getLength();
            const aNodes = (typeof oBinding.getNodes === "function") ? oBinding.getNodes() : [];

            for (let i = 0; i < iRowCount; i++) {
                const ctx = oBinding.getContextByIndex(i);
                if (!ctx) continue;

                const oRowData = Object.assign({}, ctx.getObject());
                oRowData.HierarchyLevel = aNodes[i] ? aNodes[i].level : 0;
                aExportData.push(oRowData);
            }

            return aExportData;
        }

    });
});

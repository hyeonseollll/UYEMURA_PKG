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
    "sap/ui/table/TablePersoController",
    "sap/ui/model/FilterType",
], function (
    Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet,
    JSONModel, SearchField, Column, Token, Label, Text, formatter, MessageBox, TablePersoController, FilterType
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
            this._colFilters = {};
            this._expandAllAfterBind = false;
            // flags & restore info
            this._isClientView = false;     // JSON client mode?
            this._origBindingInfo = null;   // OData restore info
            this._bInitialExpandDone = false;
            this._hlBound = false;          // rowsUpdated listener bound?
            this._customParams = {};
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

            // oView.setModel(oJson, "GLALL");

            // Model.readODataModel("ZSB_FISTATEMENTS_UI_O2", "F_GLAccount_VH", null, null, null)
            //     .then((res) => {
            //         oJson.setProperty("/", res.results || []);
            //         console.log("GLALL loaded", res.results.length);
            //     })
            //     .catch(console.error);
            const oJson = new sap.ui.model.json.JSONModel([]);
            this.getView().setModel(oJson, "GLALL");

            // FilterBar Go button text (use event delegate after rendering of FB)
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

            // Month/Year inputs: validators + default tokens
            this._initMonthYearInputs();

            // Default Search model values
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
            if (!oVH) {
                // fallback: manifest에 없으면 수동 세팅
                // const oVH = new sap.ui.model.odata.v2.ODataModel("/sap/opu/odata/sap/ZSB_FI_VH_SRV/");
                // this.getView().setModel(oVH, "F_GLAccount_VH");
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

            // ★ 이벤트는 "단 한 번"만 묶습니다.
            if (!this._hlBound) {
                // 행 갱신(스크롤/리바운드 등) 때마다: 열 인덱스 맵 갱신 + 하이라이트 재적용
                oTable.attachRowsUpdated(() => {
                    this._refreshColumnIndexMap();
                    this._refreshRowHighlights();
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

            // (선택) 개인화 컨트롤러 1회만 활성화
            if (typeof TablePersoController === "function" && !this._oTPC) {
                this._oTPC = new TablePersoController({
                    table: oTable,
                    hasGrouping: false,
                    persoService: this._getLocalPersoService() // ③ 참고
                }).activate();
            }
            this._oTPC.attachAfterPersonalization(this._pinPrimaryColumn.bind(this));
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
                colPercents: percents  // ★ 전달
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

        // onMenuFilter: function (oEvent) {
        //     let oList = this.byId("L_GLaccountFilterList");
        //     if (oList.getSelectedItems().length > 0) {

        //         let aFilter = oList.getSelectedItems().map(function (oSeleted) {
        //             return new Filter({
        //                 path: 'GlAccountText', operator: FilterOperator.Contains, value1: oSeleted.getTitle()
        //             })
        //         })


        //         let oFilter = new Filter({
        //             filters: aFilter,
        //             and: false
        //         })

        //         let oFilterFin = new Filter({
        //             filters: [oFilter, new Filter({
        //                 path: 'HierarchyLevel', operator: 'EQ', value1: '6'
        //             })],
        //             and: true
        //         })

        //         this.byId(Control.Table.T_Main).getBinding("rows").filter(oFilterFin, FilterType.Application);
        //     } else {
        //         this.byId(Control.Table.T_Main).getBinding("rows").filter(null, FilterType.Application);
        //     }
        // },
        // 한 번만 로드해서 재사용
        // GL 전체를 OData에서 페이징으로 전량 로드
        _loadGLAll: async function () {
            if (this._glAllLoaded) return this._glAllData;

            const oVH = this.getView().getModel("F_GLAccount_VH"); // v2 ODataModel
            if (!oVH) throw new Error("F_GLAccount_VH model missing");

            const PAGE = 1000;
            const acc = [];

            // 한 페이지 읽기 (skip 또는 skiptoken 사용)
            const readPage = ({ skip = 0, skiptoken = null } = {}) => new Promise((resolve, reject) => {
                const params = {
                    "$select": "GLAccount,GLAccountLongName",
                    "$orderby": "GLAccountLongName",
                    "$top": String(PAGE),
                    "$filter": "GLAccount ne ''",
                    "sap-client": "100" // ✅ 필요시 명시
                };
                if (skiptoken) {
                    params.$skiptoken = skiptoken; // 서버 주도 페이징
                } else {
                    params.$skip = String(skip);    // 전통적 skip
                }

                oVH.read("/F_GLAccount_VH", {
                    urlParameters: params,
                    success: resolve,
                    error: reject
                });
            });

            // __next 를 따라가며 모두 수집
            let skip = 0;
            let nextToken = null;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const d = await readPage({ skip, skiptoken: nextToken });
                const rows = d?.results || [];
                acc.push(...rows);

                // __next 처리
                if (d && d.__next) {
                    // __next 예: .../F_GLAccount_VH?$skiptoken=abc123...
                    const m = d.__next.match(/[?&]\$skiptoken=([^&]+)/);
                    nextToken = m ? decodeURIComponent(m[1]) : null;
                    if (!nextToken && rows.length < PAGE) break;
                    // skip 기반도 함께 증가 (혹시 서버가 둘 다 허용하는 경우)
                    skip += PAGE;
                    continue;
                }

                // __next 없고 rows < PAGE 면 종료
                if (!d.__next && rows.length < PAGE) break;

                // 방어: __next 없지만 정확히 PAGE 개라면 다음 skip 시도
                if (!d.__next && rows.length === PAGE) {
                    skip += PAGE;
                    continue;
                }

                break;
            }

            this._glAllData = acc;
            this._glAllLoaded = true;

            // 디버그 로그 (원하면 살리기)
            console.log("Loaded GL accounts:", acc.length);

            return acc;
        },
        onColumnMenuBeforeOpen: async function () {
            const data = await this._loadGLAll();  // 이미 62989건 로드됨

            const oMenu = this.byId("M_GlAccountText");
            const oList = this.byId("L_GlAccountText");
            if (!oMenu || !oList) return;

            // JSON 모델 세팅
            const oJson = new sap.ui.model.json.JSONModel({ items: data });
            oMenu.setModel(oJson, "GLALL");

            // 리스트 강제 바인딩
            oList.unbindItems();
            oList.bindItems({
                path: "GLALL>/items",
                sorter: new sap.ui.model.Sorter("GLAccountLongName", false),
                templateShareable: false,
                template: new sap.m.StandardListItem({
                    title: "{GLALL>GLAccountLongName}",
                    description: "{GLALL>GLAccount}"
                })
            });
        },


        onColumnMenuSearch: function (ev) {
            const q = (ev.getParameter("newValue") || "").trim();
            const oBind = this.byId("L_GlAccountText")?.getBinding("items");
            if (!oBind) return;
            if (!q) return oBind.filter([]);

            const f1 = new sap.ui.model.Filter("GLAccountLongName", sap.ui.model.FilterOperator.Contains, q);
            const f2 = new sap.ui.model.Filter("GLAccount", sap.ui.model.FilterOperator.Contains, q);
            oBind.filter(new sap.ui.model.Filter([f1, f2], false));
        },
        onColumnMenuConfirm: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable.getBinding("rows");
            const oList = this.byId("L_GlAccountText");
            const aVals = (oList.getSelectedItems() || [])
                .map(it => it.getBindingContext("GLALL").getProperty("GLAccountLongName"));

            // 기존 Application 필터들 중 HierarchyLevel 필터 제거
            const aExisting = (oBinding.aApplicationFilters || []).filter(f => f.sPath !== "HierarchyLevel");

            if (aVals.length) {
                aExisting.push(new sap.ui.model.Filter({
                    filters: aVals.map(v => new sap.ui.model.Filter("GlAccountText", sap.ui.model.FilterOperator.EQ, v)),
                    and: false // OR
                }));
            }
            oBinding.filter(aExisting, "Application");
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
        // 전역: 한 단계 "접기"  (예: L=5 → L=4까지만 보이게)
        onExpandLevelDown: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable?.getBinding("rows");
            if (!ob) return;

            // 지금 보이는 최심 레벨
            const Lmax = this._getVisibleMaxLevel();
            if (Lmax <= 1) return; // 더 접을 게 없음
            const target = Lmax - 1;

            oTable.setBusy(true);
            try {
                await this._waitRowsSettled(oTable, 120);

                let did = false;
                const len = ob.getLength();

                // ★ 핵심: "target 레벨(=Lmax-1)의 '열린 그룹'만" 접는다
                // (lv > target 은 건드리지 않는다 → 한 단계만 사라짐)
                for (let i = len - 1; i >= 0; i--) {
                    const row = ob.getContextByIndex(i)?.getObject?.();
                    if (!row) continue;
                    const lv = this._getLevel(row);
                    const ds = this._getDrill(row);
                    if (lv === target && ds === "expanded") {
                    }
                }

                if (did) await this._waitRowsSettled(oTable, 150);
                // (선택) 상태 갱신
                this._curExpandLevel = target;
            } finally {
                oTable.setBusy(false);
            }
        },
        onExpandLevelUp: async function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable?.getBinding("rows"); if (!ob) return;

            let cur = Number.isFinite(this._curExpandLevel) ? this._curExpandLevel : 1;

            oTable.setBusy(true);
            try {
                await this._waitRowsSettled(oTable, 100);

                let did = false;
                const len = ob.getLength();

                // 현재 단계(cur)의 "접힌 그룹"만 펼친다 → 자식(cur+1)이 드러남
                for (let i = 0; i < len; i++) {
                    const row = ob.getContextByIndex(i)?.getObject?.();
                    if (!row) continue;
                    const lv = Number(row.HierarchyLevel);
                    if (!Number.isFinite(lv) || lv !== cur) continue;

                    const exp = (typeof oTable.isExpanded === "function") && oTable.isExpanded(i);
                    if (!exp) { try { oTable.expand(i); did = true; } catch (e) { } }
                }

                if (did) {
                    await this._waitRowsSettled(oTable, 140);
                    this._curExpandLevel = cur + 1;
                } else {
                    // 최심까지 이미 보이는 상태면 아무 것도 안 함
                    const maxL = this._maxExpandLevel || this._getMaxLevelFromBinding();
                    if (cur < maxL) {
                        // 부모가 접혀 있을 가능성(Lazy) 대비 보완
                        await this._ensureExpandedUpToLevel(cur + 1);
                        this._curExpandLevel = cur + 1;
                    }
                }
            } finally { oTable.setBusy(false); }
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

        _collapseNodesById: async function (ids = []) {
            const set = new Set((ids || []).map(String));
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!oTable || !ob || !set.size) return;

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

        _applyGroupRowColors: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            const first = oTable.getFirstVisibleRow();
            const aRows = oTable.getRows();

            // [필터명] 배열 → 컬럼 인덱스 배열 변환
            const highlightFilters = [
                "PeriodBalance",
                "ComparisonBalance",
                "AbsoluteDifference",
                "RelativeDifference",
                "CompanyCodeCurrency"
            ];

            // 현재 테이블 컬럼들 확인
            const aColumns = oTable.getColumns();
            const targetIdx = aColumns
                .map((col, idx) => {
                    const prop = col.getFilterProperty && col.getFilterProperty();
                    return highlightFilters.includes(prop) ? idx : undefined;
                })
                .filter(idx => idx !== undefined);

            for (let i = 0; i < aRows.length; i++) {
                const oRow = aRows[i];
                const oCtx = oBinding.getContextByIndex(first + i);
                const o = oCtx && oCtx.getObject && oCtx.getObject();
                const cells = oRow.getCells ? oRow.getCells() : [];

                // 1) 기존 하이라이트 제거
                targetIdx.forEach(ix => {
                    const c = cells[ix];
                    if (!c) return;
                    c.removeStyleClass("sumCellYellow");
                    const $td = c.$().closest("td");
                    $td.removeClass("sumCellYellow");
                });

                if (!o) continue;
                if (this._isBSorPLRow(o)) continue; // BS/PL 카테고리 제외
                if (o.GlAccount) continue;          // 상세행 제외

                // 2) 하이라이트 추가
                targetIdx.forEach(ix => {
                    const c = cells[ix];
                    if (!c) return;
                    c.addStyleClass("sumCellYellow");
                    const $td = c.$().closest("td");
                    $td.addClass("sumCellYellow");
                });
            }
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
        _bm_all() { try { return JSON.parse(localStorage.getItem(BM_KEY) || "[]"); } catch (e) { return []; } },
        _bm_putAll(a) { localStorage.setItem(BM_KEY, JSON.stringify(a || [])); },
        _bm_save(name, state) {
            const a = this._bm_all();
            const id = Date.now().toString(36);
            a.push({ id, name, createdAt: Date.now(), state });
            this._bm_putAll(a);
            return id;
        },
        _bm_delete(id) { this._bm_putAll(this._bm_all().filter(b => b.id !== id)); },
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

        _applyTableFilters: function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            const aBase = this._getTableFilter();                  // 기간/회사코드
            const aSearch = this._buildSearchFilters(this._lastTableQuery); // 상단 검색창
            const aColFilters = Object.entries(this._colFilters || {})
                .map(([path, val]) => this._buildFilterForValueWithType(path, val))
                .flat();

            oBinding.filter(aBase.concat(aSearch, aColFilters), sap.ui.model.FilterType.Application);
        },

        // _buildFilterForValueWithType: function (sPath, sRaw) {
        //     const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
        //     const s = (sRaw || "").trim();

        //     // 숫자형 컬럼(서비스에 맞게 필요시 조정)
        //     const NUM = new Set(["PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"]);

        //     // 문자열 다중값 OR: a,b,c
        //     if (!NUM.has(sPath) && s.includes(",")) {
        //         const parts = s.split(",").map(v => v.trim()).filter(Boolean);
        //         if (parts.length) {
        //             return [new Filter({ and: false, filters: parts.map(v => new Filter(sPath, OP.EQ, v)) })];
        //         }
        //     }

        //     // 숫자 범위: 10..100
        //     const m = s.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
        //     if (m && NUM.has(sPath)) return [new Filter(sPath, OP.BT, parseFloat(m[1]), parseFloat(m[2]))];

        //     // 숫자 비교: >10, <=0
        //     const cmp = s.match(/^(<=|>=|<|>)(-?\d+(?:\.\d+)?)$/);
        //     if (cmp && NUM.has(sPath)) {
        //         const map = { ">": OP.GT, "<": OP.LT, ">=": OP.GE, "<=": OP.LE };
        //         return [new Filter(sPath, map[cmp[1]], parseFloat(cmp[2]))];
        //     }

        //     // 정확히: =값
        //     if (s.startsWith("=")) {
        //         const v = s.slice(1);
        //         return [new Filter(sPath, OP.EQ, NUM.has(sPath) ? Number(v) : v)];
        //     }

        //     // 시작/끝: ^값 / 값$
        //     if (!NUM.has(sPath) && s.startsWith("^")) return [new Filter(sPath, OP.StartsWith, s.slice(1))];
        //     if (!NUM.has(sPath) && s.endsWith("$")) return [new Filter(sPath, OP.EndsWith, s.slice(0, -1))];

        //     // 기본
        //     // return [new Filter(sPath, NUM.has(sPath) ? OP.EQ : OP.Contains, NUM.has(sPath) ? Number(s) : s)];
        //     return [new Filter(sPath, OP.EQ, s)];

        // },
        _buildFilterForValueWithType: function (sPath, sRaw) {
            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
            const s = (sRaw || "").trim();
            if (!s) return [];

            // 숫자형 컬럼
            const NUM = new Set(["PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"]);
            const isNum = NUM.has(sPath);

            // GlAccountText 만 Contains 기본
            const isGlText = /^glaccounttext$/i.test(sPath);

            // 문자열 다중값 OR: a,b,c
            if (!isNum && s.includes(",")) {
                const parts = s.split(",").map(v => v.trim()).filter(Boolean);
                if (parts.length) {
                    // GlAccountText 는 각 항목을 Contains 로 OR
                    if (isGlText) {
                        return [new Filter({
                            and: false,
                            filters: parts.map(v => new Filter(sPath, OP.Contains, v))
                        })];
                    }
                    // 그 외 문자열은 EQ 로 OR
                    return [new Filter({
                        and: false,
                        filters: parts.map(v => new Filter(sPath, OP.EQ, v))
                    })];
                }
            }

            // 숫자 범위: 10..100
            const m = s.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
            if (m && isNum) return [new Filter(sPath, OP.BT, parseFloat(m[1]), parseFloat(m[2]))];

            // 숫자 비교: >10, <=0
            const cmp = s.match(/^(<=|>=|<|>)(-?\d+(?:\.\d+)?)$/);
            if (cmp && isNum) {
                const map = { ">": OP.GT, "<": OP.LT, ">=": OP.GE, "<=": OP.LE };
                return [new Filter(sPath, map[cmp[1]], parseFloat(cmp[2]))];
            }

            // 정확히: =값  (문자열도 =면 EQ 강제)
            if (s.startsWith("=")) {
                const v = s.slice(1);
                return [new Filter(sPath, OP.EQ, isNum ? Number(v) : v)];
            }

            // 시작/끝: ^값 / 값$  (문자열만)
            if (!isNum && s.startsWith("^")) return [new Filter(sPath, OP.StartsWith, s.slice(1))];
            if (!isNum && s.endsWith("$")) return [new Filter(sPath, OP.EndsWith, s.slice(0, -1))];

            // 기본 분기
            if (isNum) return [new Filter(sPath, OP.EQ, Number(s))]; // 숫자 기본 EQ
            if (isGlText) return [new Filter(sPath, OP.Contains, s)];   // GlAccountText 기본 Contains
            return [new Filter(sPath, OP.EQ, s)];                          // 그 외 문자열 기본 EQ
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
                    // ⬇️ 트리 상태는 tree 아래에 모아 저장 (복원 측과 경로/키 맞춤)
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
                        press: () => {
                            const name = sap.ui.getCore().byId("BM_NAME").getValue().trim() || "내 북마크";
                            this._bm_save(name, state);
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
        // onBookmarkManage: function () {
        //     const items = this._bm_all();
        //     if (!items.length) { sap.m.MessageToast.show("저장된 북마크가 없습니다."); return; }

        //     const oModel = new sap.ui.model.json.JSONModel({ items, selCount: 0 });

        //     const oList = new sap.m.List({
        //         mode: sap.m.ListMode.MultiSelect,
        //         includeItemInSelection: true,
        //         growing: true,
        //         items: {
        //             path: "/items",
        //             template: new sap.m.StandardListItem({
        //                 title: "{name}",
        //                 description: { path: "createdAt", formatter: this.formatter.fmtTsLocal },
        //                 icon: "sap-icon://bookmark",
        //                 selected: false
        //             })
        //         }
        //     });

        //     oList.attachSelectionChange(() => {
        //         oModel.setProperty("/selCount", (oList.getSelectedItems() || []).length);
        //     });

        //     const dlg = new sap.m.Dialog({
        //         title: "북마크 관리",
        //         contentWidth: "520px",
        //         contentHeight: "60vh",
        //         stretchOnPhone: true,
        //         content: [oList],
        //         buttons: [
        //             new sap.m.Button({
        //                 text: "삭제",
        //                 type: "Negative",
        //                 enabled: "{= ${/selCount} > 0 }",
        //                 press: () => {
        //                     const sel = oList.getSelectedItems() || [];
        //                     if (!sel.length) return;
        //                     sap.m.MessageBox.confirm(`선택한 ${sel.length}개 북마크를 삭제할까요?`, {
        //                         actions: [sap.m.MessageBox.Action.OK, sap.m.MessageBox.Action.CANCEL],
        //                         onClose: (act) => {
        //                             if (act !== sap.m.MessageBox.Action.OK) return;
        //                             sel.forEach(it => {
        //                                 const id = it.getBindingContext().getObject().id;
        //                                 this._bm_delete(id);
        //                             });
        //                             // 목록 갱신
        //                             oModel.setProperty("/items", this._bm_all());
        //                             oList.removeSelections(true);
        //                             oModel.setProperty("/selCount", 0);
        //                             sap.m.MessageToast.show("삭제되었습니다.");
        //                         }
        //                     });
        //                 }
        //             }),
        //             new sap.m.Button({
        //                 text: "불러오기",
        //                 type: "Emphasized",
        //                 press: async () => {
        //                     const sel = oList.getSelectedItems() || [];
        //                     if (sel.length !== 1) { sap.m.MessageToast.show("불러오기는 하나만 선택해 주세요."); return; }
        //                     const bm = sel[0].getBindingContext().getObject();
        //                     if (bm && bm.state) { await this._applyAppState(bm.state); }
        //                     dlg.close();
        //                 }
        //             }),
        //             new sap.m.Button({ text: "닫기", press: () => dlg.close() })
        //         ],
        //         afterClose: () => dlg.destroy()
        //     });

        //     dlg.setModel(oModel);
        //     this.getView().addDependent(dlg);
        //     dlg.open();
        // },
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
        },



        // 3) 불러오기 다이얼로그 (선택 → 적용)
        onBookmarkLoad: function () {
            const list = this._bm_all();
            if (!list.length) { sap.m.MessageToast.show("저장된 북마크가 없습니다."); return; }

            const oModel = new sap.ui.model.json.JSONModel({ items: list });
            const dlg = new sap.m.SelectDialog({
                title: "북마크 불러오기",
                rememberSelections: false,
                multiSelect: false,
                items: {
                    path: "/items",
                    template: new sap.m.StandardListItem({
                        title: "{name}",
                        // 이전 답변대로 표현식 바인딩 대신 포매터 사용
                        description: { path: "createdAt", formatter: formatter.fmtTsLocal },
                        icon: "sap-icon://bookmark"
                    })
                },
                confirm: async (ev) => {
                    const item = ev.getParameter("selectedItem");
                    const bm = item && item.getBindingContext().getObject();
                    if (bm && bm.state) {
                        await this._applyAppState(bm.state);
                    }
                    // ev.getSource().close(); // <- 굳이 직접 닫고 싶다면 이렇게
                },
                cancel: (ev) => {
                    // ev.getSource().close(); // <- 필요 없음
                },
                afterClose: () => dlg.destroy()
            });
            dlg.setModel(oModel);
            this.getView().addDependent(dlg);
            dlg.open();
        },
        // === 북마크 관리(불러오기/삭제) ===
        onBookmarkManage: function () {
            const items = this._bm_all();
            if (!items.length) { sap.m.MessageToast.show("저장된 북마크가 없습니다."); return; }

            const oModel = new sap.ui.model.json.JSONModel({ items, selCount: 0 });

            const oList = new sap.m.List({
                mode: sap.m.ListMode.MultiSelect,
                includeItemInSelection: true,
                growing: true,
                items: {
                    path: "/items",
                    template: new sap.m.StandardListItem({
                        title: "{name}",
                        description: { path: "createdAt", formatter: this.formatter.fmtTsLocal },
                        icon: "sap-icon://bookmark",
                        selected: false
                    })
                }
            });

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
                                    // 목록 갱신
                                    oModel.setProperty("/items", this._bm_all());
                                    oList.removeSelections(true);
                                    oModel.setProperty("/selCount", 0);
                                    sap.m.MessageToast.show("삭제되었습니다.");
                                }
                            });
                        }
                    }),
                    new sap.m.Button({
                        text: "불러오기",
                        type: "Emphasized",
                        press: async () => {
                            const sel = oList.getSelectedItems() || [];
                            if (sel.length !== 1) { sap.m.MessageToast.show("불러오기는 하나만 선택해 주세요."); return; }
                            const bm = sel[0].getBindingContext().getObject();
                            if (bm && bm.state) { await this._applyAppState(bm.state); }
                            dlg.close();
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
        }


    });
});

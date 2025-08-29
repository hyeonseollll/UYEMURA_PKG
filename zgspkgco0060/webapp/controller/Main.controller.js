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
    "sap/m/MessageBox"
], function (
    Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet,
    JSONModel, SearchField, Column, Token, Label, Text, formatter, MessageBox
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
            // flags & restore info
            this._isClientView = false;     // JSON client mode?
            this._origBindingInfo = null;   // OData restore info
            this._bInitialExpandDone = false;
            this._hlBound = false;          // rowsUpdated listener bound?

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
        },

        /**
         * onAfterRendering: UI-only tweaks (rowcount, selection, attach table events),
         * dynamic headers, and highlight wiring.
         */
        onAfterRendering: function () {
            this._setPeriodHeaders();

            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;

            // table setup
            oTable.setSelectionMode(sap.ui.table.SelectionMode.Single);
            oTable.setSelectionBehavior(sap.ui.table.SelectionBehavior.Row);
            oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
            oTable.setVisibleRowCount(25);

            // attach expand/collapse
            if (typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));

            }

            // re-highlight on virtual scroll
            if (!this._hlBound) {
                oTable.attachRowsUpdated(this._refreshRowHighlights.bind(this));
                this._hlBound = true;
            }
            // 첫 렌더 후 한 번 적용
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

            // 2) 기본 컬럼 정의 가져오기
            const aCols = this._createColumnConfig();

            // 3) 기간 라벨 생성해서 '기간 잔액', '비교기간 잔액' 컬럼 라벨 덮어쓰기
            const priorYear = this._getTokenVal("MI_PriorYear");
            const priorFrom = this._getTokenVal("MI_PriorStartMonth");
            const priorTo = this._getTokenVal("MI_PriorEndMonth");
            const currYear = this._getTokenVal("MI_CurrentYear");
            const currFrom = this._getTokenVal("MI_CurrentStartMonth");
            const currTo = this._getTokenVal("MI_CurrentEndMonth");

            const reportLabel = this._buildPeriodLabel(priorYear, priorFrom, priorTo);  // (MM.YYYY-MM.YYYY)
            const compareLabel = this._buildPeriodLabel(currYear, currFrom, currTo);

            const colPB = aCols.find(c => c.property === 'PeriodBalance');
            if (colPB) colPB.label = this.i18n.getText("PeriodBalance") + " " + reportLabel;

            const colCB = aCols.find(c => c.property === 'ComparisonBalance');
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

            // ★ 화면 열 비율(%)
            const percents = this._getScreenColumnPercents();

            // 데이터/컬럼 메타
            const aRows = this._collectExportRows(oBinding);
            const aCols = this._createColumnConfig();

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
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
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
        // 컨트롤러 멤버로 사용할 캐시
        // this._colFilters = { <path>: <rawValue>, ... };

        // 누적 컬럼필터 캐시
        // this._colFilters = { <path>: <rawValue>, ... };

        onColumnFilter: function (oEvent) {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            const oColumn = oEvent.getParameter("column");
            const sValue = (oEvent.getParameter("value") || "").trim();
            const sPath = oColumn && oColumn.getFilterProperty && oColumn.getFilterProperty();
            if (!sPath) return;

            // 1) 누적 컬럼필터 갱신
            this._colFilters = this._colFilters || {};
            if (sValue) this._colFilters[sPath] = sValue;
            else delete this._colFilters[sPath];

            // 2) 모든 컬럼필터 생성
            const aColFilters = Object.entries(this._colFilters)
                .map(([path, val]) => this._buildFilterForValueWithType(path, val))
                .flat();
            // 3) 기본 파라미터 + 테이블 검색어 + 컬럼필터 적용
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);
            oBinding.filter(aBase.concat(aSearch, aColFilters), sap.ui.model.FilterType.Application);
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
                filters: aBase.concat(aSearch),
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

        // _onTreeTableRequested: function () {
        //     const oTable = this.getView().byId(Control.Table.T_Main);
        //     const oBinding = oTable && oTable.getBinding("rows");
        //     if (!oTable || !oBinding) return
        //     oTable.setBusy(true);
        //     // (Optional) access contexts if needed: const aContexts = oBinding.getContexts(0, oBinding.getLength());
        // },
        _onTreeTableRequested: function () {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;
            console.log("tree dataRequested", oBinding.aFilters); // 현재 적용 필터 확인용
            oTable.setBusy(true);
        },
        _onTreeTableReceived: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            oTable.setBusy(true);
            if (!this._bInitialExpandDone) {
                try { oTable.expandToLevel(5); } catch (e) { /*noop*/ }
                this._bInitialExpandDone = true;
                this._collapsedNodes = new Set();
            }

            // Apply deferred filters if any (search while binding)
            if (this._deferApplyTableFilters) {
                this._deferApplyTableFilters = false;
                this._applyTableFilters();
                if (this._lastTableQuery) setTimeout(() => { try { oTable.expandToLevel(20); } catch (e) { /*noop*/ } }, 120);
            }

            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });

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
        _getScreenColumnPercents: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return [];

            // 실제 데이터 컬럼만 (RowHeader 등 제외, visible만)
            const ui5Cols = oTable.getColumns().filter(c => c.getVisible());

            // px 계산
            const toPx = (c) => {
                // 1) DOM 폭 (가장 정확)
                const el = c.getDomRef && c.getDomRef();
                if (el && el.getBoundingClientRect) {
                    const w = el.getBoundingClientRect().width;
                    if (w && isFinite(w)) return w;
                }
                // 2) 선언된 width 해석 (e.g., "20rem", "120px", "auto")
                const wStr = (c.getWidth && c.getWidth()) || "";
                if (/^\d+(\.\d+)?px$/.test(wStr)) return parseFloat(wStr);
                if (/^\d+(\.\d+)?rem$/.test(wStr)) {
                    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
                    return parseFloat(wStr) * rem;
                }
                // fallback: 균등 분배 가정
                return 100; // 임의값
            };

            const px = ui5Cols.map(toPx);
            const total = px.reduce((a, b) => a + b, 0) || 1;

            // %로 환산(소수 1자리)
            const perc = px.map(w => Math.max(1, Math.round((w / total) * 1000) / 10));

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
        /**
         * 런타임 하이라이트: GL 계정이 없는 상위 노드(집계행)만 노란색
         * BS/PL 루트/범주는 제외
         */
        /**
         * 런타임 하이라이트: GL 계정이 없는 상위(집계) 노드만
         * [기간잔액, 비교잔액, 절대차이, 상대차이, 통화] 셀에만 노란색
         * BS/PL 범주는 제외
         */
        // _applyGroupRowColors: function () {
        //     const oTable = this.byId(Control.Table.T_Main);
        //     const oBinding = oTable && oTable.getBinding("rows");
        //     if (!oTable || !oBinding) return;

        //     const first = oTable.getFirstVisibleRow();
        //     const aRows = oTable.getRows();

        //     // 타겟 컬럼 인덱스 (테이블 컬럼 순서 기준)
        //     const targetIdx = [3, 4, 5, 6, 7];

        //     for (let i = 0; i < aRows.length; i++) {
        //         const oRow = aRows[i];
        //         const oCtx = oBinding.getContextByIndex(first + i);
        //         const o = oCtx && oCtx.getObject && oCtx.getObject();

        //         const cells = oRow.getCells ? oRow.getCells() : [];

        //         // 먼저 타겟 컬럼에서 기존 하이라이트 제거
        //         targetIdx.forEach(ix => {
        //             const c = cells[ix];
        //             if (c && c.removeStyleClass) c.removeStyleClass("sumCellYellow");
        //         });

        //         if (!o) continue;

        //         // BS/PL 제외
        //         if (this._isBSorPLRow(o)) continue;

        //         // 상위(집계) 노드 판정: GL 계정이 없으면 집계행으로 간주
        //         const isHeaderNode = !o.GlAccount; // (필요시 && o.hasChildren)
        //         if (!isHeaderNode) continue;

        //         // 금액이 하나라도 있는 경우에만 칠하고 싶으면 주석 해제
        //         // const hasAny = this._hasAnyAmount(o, ["PeriodBalance","ComparisonBalance","AbsoluteDifference","RelativeDifference"]);
        //         // if (!hasAny) continue;

        //         // 타겟 컬럼에만 색상 적용
        //         targetIdx.forEach(ix => {
        //             const c = cells[ix];
        //             if (c && c.addStyleClass) c.addStyleClass("sumCellYellow");
        //         });
        //     }
        // },

        _applyGroupRowColors: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oTable || !oBinding) return;

            const first = oTable.getFirstVisibleRow();
            const aRows = oTable.getRows();
            const targetIdx = [3, 4, 5, 6, 7]; // 하이라이트 컬럼 인덱스

            for (let i = 0; i < aRows.length; i++) {
                const oRow = aRows[i];
                const oCtx = oBinding.getContextByIndex(first + i);
                const o = oCtx && oCtx.getObject && oCtx.getObject();
                const cells = oRow.getCells ? oRow.getCells() : [];

                // 1) 기존 하이라이트 제거 (컨트롤 + TD 둘 다)
                targetIdx.forEach(ix => {
                    const c = cells[ix];
                    if (!c) return;
                    c.removeStyleClass("sumCellYellow"); // 컨트롤
                    const $td = c.$().closest("td");
                    $td.removeClass("sumCellYellow");    // TD
                });

                if (!o) continue;
                if (this._isBSorPLRow(o)) continue;

                const isHeaderNode = !o.GlAccount;
                if (!isHeaderNode) continue;

                // 2) 하이라이트 추가 (컨트롤 + TD 둘 다)
                targetIdx.forEach(ix => {
                    const c = cells[ix];
                    if (!c) return;
                    c.addStyleClass("sumCellYellow");          // 컨트롤
                    const $td = c.$().closest("td");
                    $td.addClass("sumCellYellow");             // TD
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

        _getSelectedSubtreeRange: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return null;
            const start = oTable.getSelectedIndex();
            if (start < 0) return null;
            const ctxStart = ob.getContextByIndex(start);
            if (!ctxStart) return null;
            const node = ctxStart.getObject && ctxStart.getObject();
            if (!node || node.HierarchyLevel == null) return null;
            const baseLevel = node.HierarchyLevel;
            const len = ob.getLength();
            let end = start + 1;
            for (; end < len; end++) {
                const ctx = ob.getContextByIndex(end);
                if (!ctx) break;
                const o = ctx.getObject && ctx.getObject();
                if (!o) break;
                if (o.HierarchyLevel <= baseLevel) break;
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
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);
            oBinding.filter(aBase.concat(aSearch), sap.ui.model.FilterType.Application);
        },
        _buildFilterForValueWithType: function (sPath, sRaw) {
            const Filter = sap.ui.model.Filter, OP = sap.ui.model.FilterOperator;
            const s = (sRaw || "").trim();

            // 숫자형 컬럼(서비스에 맞게 필요시 조정)
            const NUM = new Set(["PeriodBalance", "ComparisonBalance", "AbsoluteDifference", "RelativeDifference"]);

            // 문자열 다중값 OR: a,b,c
            if (!NUM.has(sPath) && s.includes(",")) {
                const parts = s.split(",").map(v => v.trim()).filter(Boolean);
                if (parts.length) {
                    return [new Filter({ and: false, filters: parts.map(v => new Filter(sPath, OP.EQ, v)) })];
                }
            }

            // 숫자 범위: 10..100
            const m = s.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
            if (m && NUM.has(sPath)) return [new Filter(sPath, OP.BT, parseFloat(m[1]), parseFloat(m[2]))];

            // 숫자 비교: >10, <=0
            const cmp = s.match(/^(<=|>=|<|>)(-?\d+(?:\.\d+)?)$/);
            if (cmp && NUM.has(sPath)) {
                const map = { ">": OP.GT, "<": OP.LT, ">=": OP.GE, "<=": OP.LE };
                return [new Filter(sPath, map[cmp[1]], parseFloat(cmp[2]))];
            }

            // 정확히: =값
            if (s.startsWith("=")) {
                const v = s.slice(1);
                return [new Filter(sPath, OP.EQ, NUM.has(sPath) ? Number(v) : v)];
            }

            // 시작/끝: ^값 / 값$
            if (!NUM.has(sPath) && s.startsWith("^")) return [new Filter(sPath, OP.StartsWith, s.slice(1))];
            if (!NUM.has(sPath) && s.endsWith("$")) return [new Filter(sPath, OP.EndsWith, s.slice(0, -1))];

            // 기본
            return [new Filter(sPath, NUM.has(sPath) ? OP.EQ : OP.Contains, NUM.has(sPath) ? Number(s) : s)];
        },


    });
});

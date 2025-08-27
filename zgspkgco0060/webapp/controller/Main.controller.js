sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "com/gsitm/pkg/co/zgspkgco0060/model/models",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    'sap/ui/export/library',
    'sap/ui/export/Spreadsheet',
    "sap/ui/model/json/JSONModel",
    "sap/m/SearchField",
    "sap/ui/table/Column",
    "sap/m/Token",
    "sap/m/Label",
    "sap/m/Text",
    "com/gsitm/pkg/co/zgspkgco0060/formatter/formatter",
    "sap/m/MessageBox"
], (Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet, JSONModel, SearchField, Column, Token, Label, Text, formatter, MessageBox) => {
    "use strict";
    const EdmType = exportLibrary.EdmType;
    const Control = {
        ComboBox: {
            CB_CompanyCode: "CB_CompanyCode"
        },
        FilterBar: {
            FB_MainSearch: "FB_MainSearch"
        },
        Search: {
            MI_CompanyCode: "MI_CompanyCode"
        },
        Table: {
            T_Main: "T_Main"
        },
        Button: {
            B_Excel: "B_Excel"
        }
    };

    var oView;
    var vVHGL;

    return Controller.extend("com.gsitm.pkg.co.zgspkgco0060.controller.Main", {
        formatter: formatter,
        /******************************************************************
             * Life Cycle
             ******************************************************************/

        onInit: function () {

            this._isClientView = false;     // JSON 클라이언트 뷰 여부
            this._origBindingInfo = null;   // OData 복구용

            // i18n
            this.i18n = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            // 뷰/모델
            oView = this.getView();
            oView.setModel(new JSONModel(), "oResult");
            oView.setModel(Model.createDateRangeModel(), "DateRange");
            this.getView().setModel(Model.createSearchModel(), "Search");

            // GL VH 모델
            oView.setModel(new JSONModel(), "oGLAccount");
            vVHGL = oView.getModel("oGLAccount");
            Model.readODataModel("ZSB_FISTATEMENTS_UI_O2", "GLAccount_VH", null, null, null)
                .then((res) => vVHGL.setProperty("/", res.results))
                .catch(console.error);


            // FilterBar Go 버튼 텍스트 변경 ( setGoButtonText 사용 X)
            const oFB = this.byId(Control.FilterBar.FB_MainSearch);
            if (oFB) {
                oFB.addEventDelegate({
                    onAfterRendering: function (ev) {
                        const btn = ev.srcControl && ev.srcControl._oSearchButton;
                        if (btn) {
                            // 번들 키: goButton (권장) / 또는 Search 키를 i18n에 추가
                            btn.setText(this.i18n.getText("goButton"));
                        }
                    }.bind(this),
                });
            }

            // 월/연도 MultiInput 초기 토큰 + validator 연결
            this._initMonthYearInputs();

            // (선택) 기본 회사코드 세팅
            const oSearch = this.getView().getModel("Search");
            if (!oSearch.getProperty("/CompanyCode")) {
                oSearch.setProperty("/CompanyCode", "4310"); // 환경에 맞게
            }
            // GL0 기본값 초기화 (체크박스용)

            if (oSearch.getProperty("/GL0") === undefined) {
                oSearch.setProperty("/GL0", false);  // 초기 unchecked
            }
            // 초기 조회
            this._bInitialExpandDone = false;
            const oTreeTable = this.byId(Control.Table.T_Main);
            this._bindTable(oTreeTable);
        },

        onAfterRendering: function () {
            this._setPeriodHeaders();

            const oTable = this.byId(Control.Table.T_Main);
            oTable.setSelectionMode(sap.ui.table.SelectionMode.Single);
            oTable.setSelectionBehavior(sap.ui.table.SelectionBehavior.Row);
            oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
            oTable.setVisibleRowCount(25);

            if (oTable && typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));
                this._bindColumns(oTable);
            }

            // 🔹 가상 스크롤/펼침 등으로 행이 바뀔 때마다 다시 칠함
            if (!this._hlBound) {
                oTable.attachRowsUpdated(this._refreshRowHighlights.bind(this));
                this._hlBound = true;
            }
        },

        /******************************************************************
         * Event Listener
         ******************************************************************/
        onSearch: function () {
            this._setPeriodHeaders();
            // 상세검색(client) 모드였다면 먼저 복구
            if (this._isClientView) {
                this._restoreODataBinding();
            }

            // 토큰값 읽기  
            const sPriorYear = this._getTokenVal("MI_PriorYear");
            const sPriorStart = this._getTokenVal("MI_PriorStartMonth");
            const sPriorEnd = this._getTokenVal("MI_PriorEndMonth");
            const sCurrYear = this._getTokenVal("MI_CurrentYear");
            const sCurrStart = this._getTokenVal("MI_CurrentStartMonth");
            const sCurrEnd = this._getTokenVal("MI_CurrentEndMonth");

            // 필수값 체크 (팝업 에러)
            if (!this._checkRequiredFields(sPriorYear, sCurrYear, sPriorStart, sPriorEnd, sCurrStart, sCurrEnd)) {
                return;
            }

            // 바인딩 시작
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            oTable.setBusy(true);
            oTable.unbindRows();
            this._bInitialExpandDone = false;
            this._bindTable(oTable);
        },

        onExport: function () {
            let oBExcel = this.getView().byId(Control.Button.B_Excel);
            oBExcel.setBusy(true);

            let oTreeTable = this.getView().byId(Control.Table.T_Main);
            let oRowBinding = oTreeTable.getBinding('rows');

            let aExportData = [];
            let iRowCount = oRowBinding.getLength();

            //  TreeTable 내부의 _aNodes 배열을 사용합니다.
            let aNodes = oRowBinding.getNodes(); // 또는 oTreeTable._aNodes;

            for (let i = 0; i < iRowCount; i++) {
                let oContext = oRowBinding.getContextByIndex(i);
                if (oContext) {
                    let oRowData = oContext.getObject();

                    // 노드에서 직접 레벨을 가져옵니다.
                    oRowData.HierarchyLevel = aNodes[i] ? aNodes[i].level : 0;

                    aExportData.push(oRowData);
                }
            }

            let aCols, oSettings, oSheet;
            aCols = this._createColumnConfig();

            oSettings = {
                workbook: {
                    columns: aCols,
                    hierarchyLevel: 'HierarchyLevel'
                },
                dataSource: aExportData,
                fileName: this.i18n.getText("title") + (new Date()).toISOString() + '.xlsx',
                worker: true
            };

            oSheet = new Spreadsheet(oSettings);
            oSheet.build().finally(function () {
                oSheet.destroy();
                oBExcel.setBusy(false);
            });
        },

        onExpandAllPress: function () {
            const oTable = this.byId("T_Main");
            if (!oTable) return;
            oTable.setBusy(true);
            try { oTable.expandToLevel(20); } catch (e) { }
            this._collapsedNodes = new Set();
            this._bInitialExpandDone = true;
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },

        onCollapseAllPress: function () {
            const oTable = this.byId("T_Main");
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
                } catch (e) { }
            }
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },

        // onTableSearch: async function (oEventOrString) {
        //     const q =
        //         (typeof oEventOrString === "string"
        //             ? oEventOrString
        //             : (oEventOrString.getParameter("query") || "")).trim();

        //     if (!q) {
        //         sap.m.MessageToast.show("검색어를 입력하세요.");
        //         this._searchState = { q: "", hits: [], pos: -1 };
        //         this._refreshRowHighlights(); // 모두 지움
        //         return;
        //     }

        //     // 상태 초기화
        //     this._searchState = this._searchState || { q: "", hits: [], pos: -1 };

        //     // 새 검색어 → 히트 다시 수집
        //     if (this._searchState.q !== q || !this._searchState.hits.length) {
        //         this._searchState.q = q;
        //         await this._ensureFullyExpandedAndCollectHits(q); // hits 채움
        //         this._searchState.pos = 0;
        //     } else {
        //         // 동일 검색어로 다시 엔터 → 다음 매칭
        //         this._searchState.pos = (this._searchState.pos + 1) % this._searchState.hits.length;
        //     }

        //     // 현재 hit로 스크롤만 이동 (선택 X)
        //     this._scrollToActiveHit();

        //     // CSS 칠하기
        //     this._refreshRowHighlights();

        //     // 진행 표시
        //     const n = (this._searchState.pos + 1);
        //     const N = this._searchState.hits.length;
        //     if (N) sap.m.MessageToast.show(`${n} / ${N} 매칭`);
        // },

        // ▶ 교체: onTableSearch
        onTableSearch: async function (oEventOrString) {
            const q =
                (typeof oEventOrString === "string"
                    ? oEventOrString
                    : (oEventOrString.getParameter("query") || "")).trim();

            if (!q) {
                sap.m.MessageToast.show(this.i18n.getText("toast.enterQuery") || "검색어를 입력하세요.");
                this._searchState = { q: "", hits: [], pos: -1 };
                this._refreshRowHighlights(); // 강조 초기화
                return;
            }

            // 상태 초기화/재사용
            this._searchState = this._searchState || { q: "", hits: [], pos: -1 };

            // 새 검색어거나 캐시가 비었으면 → 히트 수집
            if (this._searchState.q !== q || !this._searchState.hits.length) {
                this._searchState.q = q;
                await this._ensureFullyExpandedAndCollectHits(q);
                this._searchState.pos = 0;

                // ❗ 일치 항목 없음 → 에러 메시지 후 종료
                if (!this._searchState.hits || this._searchState.hits.length === 0) {
                    // 토스트
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");

                    // 팝업을 원하시면 위 한 줄 대신 아래를 쓰세요.
                    // sap.m.MessageBox.error(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");

                    this._refreshRowHighlights(); // 강조 초기화
                    return;
                }
            } else {
                // 동일 검색어 재입력 → 다음 매칭으로 순환
                const N = this._searchState.hits.length;
                if (!N) {
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                    this._refreshRowHighlights();
                    return;
                }
                this._searchState.pos = (this._searchState.pos + 1) % N;
            }

            // 현재 hit로 스크롤만 이동 (선택 X)
            this._scrollToActiveHit();

            // CSS 강조 처리
            this._refreshRowHighlights();

            // 진행 표시
            const n = (this._searchState.pos + 1);
            const N = this._searchState.hits.length;
            if (N) sap.m.MessageToast.show(`${n} / ${N} ${this.i18n.getText("toast.matchProgressSuffix") || "매칭"}`);
        },


        _scrollToActiveHit: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            const st = this._searchState;
            if (!oTable || !ob || !st || !st.hits || st.pos < 0) return;

            const hit = st.hits[st.pos];
            const idx = this._indexOfHitInBinding(hit);
            if (idx < 0) return;

            const half = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
            oTable.setFirstVisibleRow(Math.max(0, idx - half));
        },

        _collectHitIndexesInBinding: function (sQuery) {
            const q = (sQuery || "").toLowerCase();
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return [];

            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            const out = [];
            for (let i = 0; i < ctxs.length; i++) {
                const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                if (!obj) continue;
                if (this._rowMatchesQuery(obj, q)) out.push(i);
            }
            return out;
        },
        //VH GLAccount
        onVHGL() {
            if (this._oVHD && this._oVHD.isOpen && this._oVHD.isOpen()) {
                return;
            }
            /*********************************************************
            / 평가클래스(GL) get
            **********************************************************/

            var oMultiInput = this.byId("MI_GL");
            this._oMultiInput = oMultiInput;

            this._oBasicSearchField = new SearchField();

            this.loadFragment({
                name: "com.gsitm.pkg.co.zgspkgco0060/fragment/GLAccount",
            }).then(function (oDialog) {
                var oFilterBar = oDialog.getFilterBar();
                this._oVHD = oDialog;

                this.getView().addDependent(oDialog);

                oFilterBar.setFilterBarExpanded(false);
                oFilterBar.setBasicSearch(this._oBasicSearchField);

                this._oBasicSearchField.attachSearch(function () {
                    oFilterBar.search();
                });

                oDialog.getTableAsync().then(function (oTable) {

                    oTable.setModel(vVHGL);

                    if (oTable.bindRows) {
                        oTable.bindAggregation("rows", {
                            path: "/",
                            events: {
                                dataReceived: function () {
                                    oDialog.update();
                                }
                            }
                        });

                        oTable.addColumn(new Column({ label: new Label({ text: "{i18n>GLAccount}" }), template: new Text({ wrapping: false, text: "{GLAccount}" }) }));
                        oTable.addColumn(new Column({ label: new Label({ text: "{i18n>GLAccountName}" }), template: new Text({ wrapping: false, text: "{GLAccountName}" }) }));
                    }
                }.bind(this));

                oDialog.setTokens(this._oMultiInput.getTokens());
                oDialog.open();
            }.bind(this));
        },

        onValueHelpOkPress: function (oEvent) {
            var aTokens = oEvent.getParameter("tokens");
            this._oMultiInput.setTokens(aTokens);
            this._oVHD.close();
        },

        onValueHelpCancelPress: function () {
            this._oVHD.close();
        },

        onValueHelpAfterClose: function () {
            this._oVHD.destroy();
        },

        onVHFBGL: function (oEvent) {
            var sSearchQueGLry = this._oBasicSearchField.getValue(),
                aSelectionSet = oEvent.getParameter("selectionSet");

            var aFilters = aSelectionSet.reduce(function (aResult, oControl) {
                if (oControl.getValue()) {
                    aResult.push(new Filter({
                        path: oControl.getName(),
                        operator: FilterOperator.Contains,
                        value1: oControl.getValue()
                    }));
                }

                return aResult;
            }, []);

            aFilters.push(new Filter({
                filters: [
                    new Filter({ path: "GLAccount", operator: FilterOperator.Contains, value1: sSearchQueGLry }),
                    new Filter({ path: "GLAccountName", operator: FilterOperator.Contains, value1: sSearchQueGLry })
                ],
                and: false
            }));

            this._filterTable(new Filter({
                filters: aFilters,
                and: true
            }));
        },

        onLiveChange: function (oEvent) {
            var vId = oEvent.getSource().getId();
            var oMultiInput;

            if (vId.endsWith("MI_MT")) {
                oMultiInput = this.byId("MI_MT");
            } else if (vId.endsWith("MI_GL")) {
                oMultiInput = this.byId("MI_GL");
            }

            var vInputValue = oEvent.getParameter("value");
            var aItems = vInputValue.split(" ");
            oMultiInput.setValue("");

            for (var i = 0; i < aItems.length; i++) {
                var vItem = aItems[i].trim();
                if (vItem) {
                    oMultiInput.addToken(new Token({ key: vItem, text: vItem }).data("range", { "exclude": false, "operation": sap.ui.comp.valuehelpdialog.ValueHelpRangeOperation.EQ, "keyField": "GLAccount", "value1": vItem, "value2": "" }));
                }
            }

            setTimeout(function () {
                oMultiInput.setValue("");
            }, 1);
        },

        onCollapse: function (oEvent) {
            let oContext = oEvent.getParameter("rowContext");
            if (oContext) {
                let sNodeId = oContext.getProperty("Node");
                this._collapsedNodes = this._collapsedNodes || new Set();
                this._collapsedNodes.add(sNodeId);
            }
        },

        onExpand: function (oEvent) {
            let oContext = oEvent.getParameter("rowContext");
            if (oContext) {
                let sNodeId = oContext.getProperty("Node");
                this._collapsedNodes = this._collapsedNodes || new Set();
                this._collapsedNodes.delete(sNodeId);
            }
        },
        onPeriodBalancePress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) return;

            const { GlAccount: glAccount, CompanyCode: companyCode = "4310" } = oCtx.getObject() || {};
            if (!glAccount) { sap.m.MessageToast.show(this.i18n.getText("noGLAccount")); return; }

            // 현재 필터(당기) 값 그대로
            const year = this._getTokenVal("MI_PriorYear");          // "2025"
            const fromM = this._getTokenVal("MI_PriorStartMonth");    // "005"
            const toM = this._getTokenVal("MI_PriorEndMonth");      // "008"

            // 월 리스트 (총계정원장용)
            const expand = (a, b) => Array.from({ length: Math.abs(+b - +a) + 1 }, (_, i) => String(Math.min(+a, +b) + i).padStart(3, "0"));
            const periods = expand(fromM, toM);

            const sheet = new sap.m.ActionSheet({
                showCancelButton: true,
                buttons: [
                    new sap.m.Button({
                        // text: "G/L 계정 잔액조회",
                        text: this.i18n.getText("action.glBalance"),
                        press: () => this._navigateToGLBalance(glAccount, companyCode, fromM, toM, year)
                    }),
                    new sap.m.Button({
                        // text: "총계정원장에서 개별 항목 조회",
                        text: this.i18n.getText("action.jeItems"),
                        press: () => this._navigateToJournalEntry(glAccount, companyCode, year, periods)
                    })
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

            // 현재 필터(당기) 값 그대로
            const year = this._getTokenVal("MI_CurrentYear");          // "2025"
            const fromM = this._getTokenVal("MI_CurrentStartMonth");    // "005"
            const toM = this._getTokenVal("MI_CurrentEndMonth");      // "008"

            // 월 리스트 (총계정원장용)
            const expand = (a, b) => Array.from({ length: Math.abs(+b - +a) + 1 }, (_, i) => String(Math.min(+a, +b) + i).padStart(3, "0"));
            const periods = expand(fromM, toM);

            const sheet = new sap.m.ActionSheet({
                showCancelButton: true,
                buttons: [
                    new sap.m.Button({
                        text: "G/L 계정 잔액조회",
                        press: () => this._navigateToGLBalance(glAccount, companyCode, fromM, toM, year)
                    }),
                    new sap.m.Button({
                        text: "총계정원장에서 개별 항목 조회",
                        press: () => this._navigateToJournalEntry(glAccount, companyCode, year, periods)
                    })
                ]
            });
            this.getView().addDependent(sheet);
            sheet.openBy(oEvent.getSource());
        },
        _scrollToHit: function (hit) {
            const oTable = this.byId("T_Main");
            if (!oTable || !hit) return;

            const idx = this._indexOfHitInBinding(hit);
            if (idx < 0) return;

            const half = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
            oTable.setFirstVisibleRow(Math.max(0, idx - half));

            console.log("[SCROLL-ONLY]", {
                idx,
                nodeText: hit.text,
                gl: hit.gl,
                parent: hit.parent,
                level: hit.level
            });
        },

        _refreshRowHighlights: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;

            const q = (this._searchState && this._searchState.q || "").toLowerCase().trim();
            const first = oTable.getFirstVisibleRow();
            const rows = oTable.getRows();

            // 현재 활성 hit의 실제 인덱스
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
                    // 현재(활성) 매칭이면 진하게
                    if (first + i === activeIdx) {
                        r.addStyleClass("myHitActive");
                    }
                }
            }
        },

        // 2) 선택할 때는 NodeID → 현재 인덱스로 변환해서 선택
        jumpToQuery: async function (sQuery, options) {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) { sap.m.MessageToast.show(this.i18n.getText("toast.runSearchFirst") || "먼저 조회를 실행하세요."); return; }

            const qRaw = (sQuery || "").trim();
            if (!qRaw) { sap.m.MessageToast.show(this.i18n.getText("toast.enterQuery") || "검색어를 입력하세요."); return; }

            // 단일 선택 고정
            if (oTable.getSelectionMode() !== sap.ui.table.SelectionMode.Single) {
                oTable.setSelectionMode(sap.ui.table.SelectionMode.Single);
            }
            oTable.clearSelection();

            const focusCol = (options && options.focusCol) || 0;
            const range = this._getSelectedSubtreeRange(); // [start,end) or null

            // ───────────────────────────────────────────────────────
            // 1) 새 검색어 → 히트 수집/정렬 후 첫 히트 선택
            // ───────────────────────────────────────────────────────
            if (!this._searchState || this._searchState.q !== qRaw) {
                this._searchState = { q: qRaw, hits: [], pos: -1 };
                console.log("Starting a new search. Initial state:", this._searchState);

                // 전체 확장 유도 + 히트 수집(리프/레벨 가중치 포함)
                await this._ensureFullyExpandedAndCollectHits(qRaw);
                console.log("Search finished. Final hits collected:", this._searchState.hits);
                let hits = this._searchState.hits; // [{id,parent,level,text,gl,isLeaf,score,order}, ...]
                if (!hits || !hits.length) {
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                    return;
                }

                // 선택된 서브트리로 제한: '인덱스 환산' 후 범위 내만 남김
                if (range) {
                    const [s, e] = range;
                    await this._waitBindingStableOnce(160);
                    hits = hits.filter(h => {
                        const i = this._indexOfHitInBinding(h);
                        return i >= s && i < e;
                    });
                    if (!hits.length) {
                        sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                        return;
                    }
                }

                this._searchState.hits = hits;
                this._searchState.pos = 0;

                // 바인딩 안정화 후 인덱스 환산 → 없으면 1회 재시도(경로 확장 포함)
                await this._waitBindingStableOnce(180);
                let idx = this._indexOfHitInBinding(hits[0]);
                if (idx < 0) {
                    if (typeof this._expandPathAndRetry === "function") {
                        await this._expandPathAndRetry(hits[0]);
                    } else {
                        try { oTable.expandToLevel(99); } catch (e) { }
                    }
                    await this._waitBindingStableOnce(200);
                    idx = this._indexOfHitInBinding(hits[0]);
                }

                if (idx >= 0) {
                    // this._scrollSelectFocusRow(idx, focusCol);
                    // this._scrollAndSelectHit(hits[0], focusCol);
                    this._scrollSelectHighlightReliable(hits[0], focusCol);
                    sap.m.MessageToast.show(this.i18n.getText("toast.matchCount", [hits.length]) || `매칭: ${hits.length}건`);
                } else {
                    sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
                }
                return;
            }

            // ───────────────────────────────────────────────────────
            // 2) 동일 검색어 재입력(엔터) → 다음 히트로 이동
            // ───────────────────────────────────────────────────────
            const hits = this._searchState.hits || [];
            if (!hits.length) { sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다."); return; }

            this._searchState.pos = (this._searchState.pos + 1) % hits.length;
            const hit = hits[this._searchState.pos];

            await this._waitBindingStableOnce(160);
            let idx = this._indexOfHitInBinding(hit);
            if (idx < 0) {
                if (typeof this._expandPathAndRetry === "function") {
                    await this._expandPathAndRetry(hit);
                } else {
                    try { oTable.expandToLevel(99); } catch (e) { }
                }
                await this._waitBindingStableOnce(200);
                idx = this._indexOfHitInBinding(hit);
            }

            if (idx >= 0) {
                // this._scrollSelectFocusRow(idx, focusCol);
                // this._scrollAndSelectHit(hit, focusCol);
                this._scrollSelectHighlightReliable(hit, focusCol);

                const n = this._searchState.pos + 1, N = hits.length;
                sap.m.MessageToast.show(`${n} / ${N} ${this.i18n.getText("toast.matchProgressSuffix") || "매칭"}`);
            } else {
                sap.m.MessageToast.show(this.i18n.getText("toast.noMatch") || "일치 항목이 없습니다.");
            }
        },
        _rowMatchScore: function (obj, qRaw) {
            const q = (qRaw || "").toLowerCase().trim();
            if (!q) {
                return 0;
            }

            const nodeText = (obj.NodeText || "").toLowerCase();
            const glAccountText = (obj.GlAccountText || "").toLowerCase();
            const glAccount = (obj.GlAccount || "").toString().toLowerCase();

            let score = 0;

            // 1. G/L 계정 번호의 정확한 일치 (최고 점수)
            if (glAccount === q) {
                return 6000;
            }

            // 2. GlAccountText 또는 NodeText에 검색어가 정확히 포함되는 경우
            if (glAccountText.includes(q) || nodeText.includes(q)) {
                if (glAccountText.endsWith(`_${q}`) || nodeText.endsWith(`_${q}`)) {
                    score = Math.max(score, 5000); // '_기타'와 같은 패턴을 찾습니다.
                } else {
                    score = Math.max(score, 3000); // 단순 부분 일치
                }
            }

            // 3. 리프 노드에 대한 점수 가산
            if (obj.hasChildren === false || obj.hasChildren === undefined) {
                if (glAccountText.includes(q) || nodeText.includes(q)) {
                    score += 1000;
                }
            }

            return score;
        },

        // ▼ 추가: 현재 선택된 행의 "서브트리" 인덱스 범위를 [start, end)로 반환
        _getSelectedSubtreeRange: function () {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return null;

            const start = oTable.getSelectedIndex(); // 헤더/그룹 노드를 먼저 클릭해두세요
            if (start < 0) return null;

            const ctxStart = ob.getContextByIndex(start);
            if (!ctxStart) return null;

            const node = ctxStart.getObject && ctxStart.getObject();
            if (!node || node.HierarchyLevel == null) return null;

            const baseLevel = node.HierarchyLevel;
            const len = ob.getLength();

            // start 다음 행부터, baseLevel 이하로 떨어지는 지점 직전이 서브트리 끝
            let end = start + 1;
            for (; end < len; end++) {
                const ctx = ob.getContextByIndex(end);
                if (!ctx) break;
                const o = ctx.getObject && ctx.getObject();
                if (!o) break;
                if (o.HierarchyLevel <= baseLevel) break; // 형제/상위로 올라가면 종료
            }
            return [start, end]; // half-open [start, end)
        },
        _ensureFullyExpandedAndCollectHits: async function (sQuery) {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) { this._searchState.hits = []; this._searchState.pos = -1; return; }

            if (!this._isClientView) {
                try { oTable.expandToLevel(5); } catch (e) { }
                await this._waitRowsSettled(oTable, 120);
                try { oTable.expandToLevel(99); } catch (e) { }
                await this._expandAllDeep(oTable, 30);
                await this._waitRowsSettled(oTable, 220);
            } else {
                await this._waitRowsSettled(oTable, 120);
            }

            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            const hits = [];
            const seen = Object.create(null); // sig -> count

            for (let i = 0; i < ctxs.length; i++) {
                const obj = ctxs[i]?.getObject?.();
                if (!obj) continue;

                const m = this._matchRow(obj, sQuery);
                if (m.score <= 0) continue;

                const nodeTextRaw = obj.NodeText || "";
                const glTextRaw = obj.GlAccountText || "";

                // 고유/계층 정보(있으면 활용)
                const id = (obj.NodeID || obj.Node || null);
                const hid = (obj.Node || obj.NodeID || obj.HierarchyNodeID || null);
                const parent = (obj.ParentNodeID || obj.ParentNode || null);
                const hierarchy = obj.HierarchyID || "";
                const level = obj.HierarchyLevel;
                const gl = (obj.GlAccount != null ? String(obj.GlAccount) : null);

                const sig = [
                    (nodeTextRaw || "").toLowerCase(),
                    (glTextRaw || "").toLowerCase(),
                    parent || "",
                    level == null ? "" : String(level),
                    hierarchy
                ].join("|");

                const nth = (seen[sig] = (seen[sig] || 0) + 1);

                hits.push({
                    id, hid, parent, level, hierarchy,
                    gl, text: m.matchedText || null,
                    nodeText: nodeTextRaw,
                    glText: glTextRaw,
                    sig, nth,
                    score: m.score, order: i
                });
            }

            hits.sort((a, b) =>
                (b.score - a.score) ||
                (b.level - a.level) ||
                (a.order - b.order)
            );

            this._searchState.hits = hits;
            this._searchState.pos = -1;
        },


        // 히트 객체 생성(재사용)
        _mkHitFromObj: function (o) {
            return {
                id: String(o.Node != null ? o.Node : o.NodeID),           // 필수
                parent: o.ParentNodeID != null ? String(o.ParentNodeID)
                    : (o.ParentNode != null ? String(o.ParentNode) : null),
                level: o.HierarchyLevel,
                text: o.NodeText || null,
                gl: o.GlAccount != null ? String(o.GlAccount) : null
            };
        },


        // 소문자 정규화
        _normStr: function (v) {
            return String(v == null ? "" : v).toLowerCase();
        },

        _isHangul: function (s) {
            return /[\uac00-\ud7a3]/.test(s);
        },

        _tokenize: function (v) {
            return this._normStr(v)
                .split(/[^0-9a-z\uac00-\ud7a3_]+/g) // '_'는 유지
                .filter(Boolean);
        },

        _rowMatchesQuery: function (obj, qRaw) {
            return this._rowMatchScore(obj, qRaw) > 0;
        },

        _isHit: function (n, qRaw) {
            return this._rowMatchScore(n, qRaw) > 0;
        },

        /******************************************************************
         * Private Function
         ******************************************************************/
        /** 서버에서 nodeId의 조상 경로를 만들어 반환 (루트→...→nodeId) */
        _serverBuildPath: async function (nodeId) {
            const path = [];
            let cur = nodeId, guard = 0;
            while (cur != null && guard++ < 200) {
                path.push(cur);
                const parent = await this._serverGetParent(cur); // 이미 구현되어 있음
                if (parent == null) break; // 루트
                cur = parent;
            }
            return path.reverse(); // 루트→...→node
        },

        _applyNodeCutFilter: async function (sQuery) {
            const oTable = this.byId("T_Main");
            if (!sQuery) {
                if (this._isClientView) {
                    this._restoreODataBinding();
                    // sap.m.MessageToast.show("검색 해제");
                    sap.m.MessageToast.show(this.i18n.getText("toast.enterQuery"));
                }
                return;
            }

            // 최초 한 번: OData 바인딩 정보 저장 (복구용)
            if (!this._origBindingInfo) {
                const ob = oTable.getBinding("rows");
                if (!ob) {
                    // sap.m.MessageToast.show("먼저 조회를 실행하세요.");
                    sap.m.MessageToast.show(this.i18n.getText("toast.runSearchFirst"));
                    return;
                }
                this._origBindingInfo = {
                    path: "/FinancialStatements",
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
                    }
                };
            }

            let flat;

            // 이미 클라이언트 뷰이고, 전체 스냅샷이 있으면 재사용 (빠름)
            if (this._isClientView && Array.isArray(this._flatSnapshot) && this._flatSnapshot.length) {
                flat = this._flatSnapshot;
            } else {
                // 전체 확장 유도 → 지연 로딩 모두 가져와 평면 리스트 스냅샷 생성
                try { oTable.expandToLevel(99); } catch (e) { }
                await this._expandAllDeep(oTable); // 지연 로딩 모두 트리거 (이미 구현되어 있음)
                // 🔸 깊은 레벨까지 확실히 로드
                await this._expandAllDeep(oTable, 30);
                await this._waitRowsSettled(oTable, 220);
                const obNow = oTable.getBinding("rows");
                const len = obNow.getLength();
                const ctxs = obNow.getContexts(0, len);
                flat = ctxs.map(c => c && c.getObject()).filter(Boolean);
                this._flatSnapshot = flat; // 이후 검색 재사용
            }

            // 평면 → 트리 구성 후 쿼리로 필터링 (매칭 노드와 조상/자손 경로 보존)
            const tree = this._buildTreeFromFlat(flat);
            const filtered = this._filterTreeByQuery(tree, sQuery);

            // 클라이언트(JSON) 모델로 바인딩 전환
            const oJson = new sap.ui.model.json.JSONModel({ nodes: filtered });
            oTable.setModel(oJson, "client");
            oTable.unbindRows();
            oTable.bindRows({
                path: "client>/nodes",
                parameters: { arrayNames: ["children"] }
            });
            this._isClientView = true;

            // 모두 펼친 뒤 안정화 대기
            try { oTable.expandToLevel(99); } catch (e) { }
            await this._waitRowsSettled(oTable, 180);

            // 현재 화면 테이블 순서(전위 순회)로 평탄화
            this._clientFlat = this._flattenTreeForTable(filtered);

            // 히트 노드 목록 계산 (Node 또는 NodeID 기준)
            const q = (sQuery || "").toLowerCase();
            this._hitNodeIds = [];
            for (let i = 0; i < this._clientFlat.length; i++) {
                const n = this._clientFlat[i];
                if (this._isHit(n, q)) {
                    const id = (n.Node != null ? n.Node : n.NodeID);
                    if (id != null) this._hitNodeIds.push(id);
                }
            }
            this._hitPos = -1;

            return;
        },

        /** 평면 -> 트리 (키 명칭 혼용 안전) */
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
                if (pid != null && map[pid]) {
                    map[pid].children.push(map[id]);
                } else {
                    roots.push(map[id]);
                }
            });

            return roots;
        },




        _filterTreeByQuery: function (nodes, sQuery) {
            const Q = this._normStr(sQuery);
            const hit = (n) => {
                const fields = [n.NodeText, n.GlAccountText, n.GlAccount];
                const tokens = fields.flatMap(this._tokenize.bind(this));
                return tokens.includes(Q);
            };

            const deepCopy = (n) => {
                const c = Object.assign({}, n);
                c.children = (n.children || []).map(deepCopy);
                return c;
            };

            const dfs = (n) => {
                if (hit(n)) return deepCopy(n);              // 매칭 → 하위 전부 보존
                const kept = (n.children || []).map(dfs).filter(Boolean);
                if (kept.length) {
                    const c = Object.assign({}, n);
                    c.children = kept;                         // 자손 매칭 → 조상만 보존
                    return c;
                }
                return null;
            };

            return (nodes || []).map(dfs).filter(Boolean);
        },

        /** 트리 노드를 테이블 표시 순서(전위 순회)로 평탄화 */
        _flattenTreeForTable: function (nodes) {
            const out = [];
            const visit = (n) => { out.push(n); (n.children || []).forEach(visit); };
            (nodes || []).forEach(visit);
            return out;
        },

        _collectHitsInCurrentView: function (sQuery) {
            const q = (sQuery || "").toLowerCase();
            const arr = this._clientFlat || [];
            this._hitNodeIds = []; this._hitPos = -1;
            for (let i = 0; i < arr.length; i++) {
                const n = arr[i];
                if (this._isHit(n, q)) {
                    const id = n.Node != null ? n.Node : n.NodeID;
                    if (id != null) this._hitNodeIds.push(id);
                }
            }
        },
        /** 현재 바인딩에서 Node 키로 행 인덱스를 찾는다 */
        _indexOfHitInBinding: function (hit) {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) {
                return -1;
            }

            // 우선 id를 사용해 행을 찾습니다.
            const wantId = hit.id;
            if (wantId) {
                const len = ob.getLength();
                const ctxs = ob.getContexts(0, len);
                for (let i = 0; i < ctxs.length; i++) {
                    const o = ctxs[i]?.getObject?.();
                    if (!o) continue;
                    const curId = (o.Node != null) ? String(o.Node) : (o.NodeID != null) ? String(o.NodeID) : null;
                    if (curId === wantId) {
                        return i;
                    }
                }
            }

            // id가 null일 경우, 대체 식별자인 glAccount를 사용해 행을 찾습니다.
            const wantGl = hit.gl;
            if (wantGl) {
                const len = ob.getLength();
                const ctxs = ob.getContexts(0, len);
                for (let i = 0; i < ctxs.length; i++) {
                    const o = ctxs[i]?.getObject?.();
                    if (!o) continue;
                    const curGl = (o.GlAccount != null) ? String(o.GlAccount) : null;
                    if (curGl === wantGl) {
                        return i;
                    }
                }
            }

            // 최종적으로 일치하는 행을 찾지 못한 경우
            return -1;
        },
        _scrollSelectHighlightReliable: function (hit, focusCol) {
            const oTable = this.byId("T_Main");
            if (!oTable || !hit) return;

            const idx = this._indexOfHitInBinding(hit);

            if (idx < 0) {
                return;
            }

            const halfVisibleRows = Math.floor((oTable.getVisibleRowCount() || 10) / 2);
            oTable.setFirstVisibleRow(Math.max(0, idx - halfVisibleRows));

            // 1. 먼저 선택 인덱스를 설정합니다.
            oTable.setSelectedIndex(idx);

            // 2. 잠시 기다린 후 포커스 로직을 실행합니다.
            // 50ms는 대부분의 경우 충분하지만, 필요에 따라 더 늘릴 수 있습니다.
            setTimeout(() => {
                const oRow = oTable.getRows()[oTable.getSelectedIndex() - oTable.getFirstVisibleRow()];
                if (oRow) {
                    const oCell = oRow.getCells()[focusCol];
                    if (oCell) {
                        oCell.focus();
                    }
                }
            }, 50); // 50ms (0.05초) 지연
        },

        _matchRow: function (obj, qRaw) {
            const q = (qRaw || "").toLowerCase().trim();
            if (!q) {
                return { score: 0, matchedText: null };
            }

            const nodeText = (obj.NodeText || "").toLowerCase();
            const glAccountText = (obj.GlAccountText || "").toLowerCase();
            const glAccount = (obj.GlAccount || "").toString().toLowerCase();

            // 1. G/L 계정 번호의 정확한 일치
            if (glAccount === q) {
                return { score: 6000, matchedText: glAccount };
            }

            // 2. GlAccountText의 정확한 일치
            if (glAccountText === q) {
                return { score: 5000, matchedText: glAccountText };
            }

            // 3. NodeText의 정확한 일치
            if (nodeText === q) {
                return { score: 4000, matchedText: nodeText };
            }

            // 4. GlAccountText의 부분 일치
            if (glAccountText.includes(q)) {
                return { score: 3000, matchedText: glAccountText };
            }

            // 5. NodeText의 부분 일치
            if (nodeText.includes(q)) {
                return { score: 2000, matchedText: nodeText };
            }

            return { score: 0, matchedText: null };
        },


        /** 선택 전에 바인딩이 안정화될 때까지 잠시 대기 */
        _waitBindingStableOnce: function (idleMs = 160) {
            const oTable = this.byId("T_Main");
            if (!oTable) return Promise.resolve();
            return new Promise((resolve) => {
                let t;
                const on = () => {
                    clearTimeout(t);
                    t = setTimeout(() => { oTable.detachRowsUpdated(on); resolve(); }, idleMs);
                };
                oTable.attachRowsUpdated(on);
                on();
            });
        },

        // (신규) 경로 강제 확장 후 재시도
        _expandPathAndRetry: async function (hit) {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return;

            // 서버에서 조상 경로 조회 (이미 있는 함수)
            const pathIds = await this._serverBuildPath(hit.id); // [root, ..., parent, id]

            for (const nodeId of pathIds) {
                const tmp = { id: String(nodeId), parent: null, level: null, text: null, gl: null };
                const idx = this._indexOfHitInBinding(tmp);
                if (idx >= 0) {
                    try { oTable.expand(idx); } catch (e) { }
                    await this._waitRowsSettled(oTable, 180);
                }
            }
        },


        _gotoNextHit: function () {
            const oTable = this.byId("T_Main");
            if (!oTable || !this._hitNodeIds || !this._hitNodeIds.length) {
                // sap.m.MessageToast.show("일치 항목이 없습니다."); return;
                sap.m.MessageToast.show(this.i18n.getText("toast.noMatch"));
                return;
            }
            this._hitPos = (this._hitPos + 1) % this._hitNodeIds.length;

            // 현재 바인딩에서 해당 Node 의 인덱스를 다시 계산
            const nodeId = this._hitNodeIds[this._hitPos];
            const idx = this._indexOfNodeInBinding(nodeId);

            if (idx >= 0) {
                oTable.setFirstVisibleRow(Math.max(0, idx - 2));
                oTable.setSelectedIndex(idx);
                sap.m.MessageToast.show((this._hitPos + 1) + " / " + this._hitNodeIds.length + " 매칭");
            } else {
                // 이 경우는 거의 없지만, 바인딩이 갱신 중일 때 한 번 더 기다렸다 재시도
                setTimeout(() => {
                    const j = this._indexOfNodeInBinding(nodeId);
                    if (j >= 0) {
                        oTable.setFirstVisibleRow(Math.max(0, j - 2));
                        oTable.setSelectedIndex(j);
                        sap.m.MessageToast.show((this._hitPos + 1) + " / " + this._hitNodeIds.length + " 매칭");
                    }
                }, 120);
            }
        },

        /** rowsUpdated 이벤트가 잠잠해질 때까지 잠깐 대기 */
        _waitRowsSettled: function (oTable, idleMs = 150) {
            return new Promise((resolve) => {
                let timer;
                const on = () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        oTable.detachRowsUpdated(on);
                        resolve();
                    }, idleMs);
                };
                oTable.attachRowsUpdated(on);
                on(); // 즉시 1회 트리거
            });
        },
        _expandAllDeep: async function (oTable, maxPass = 30) {
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) return;

            let lastLen = -1;
            for (let pass = 0; pass < maxPass; pass++) {
                // 아직 서버 요청 중이면 잠깐 대기
                if (typeof oBinding.isRequestPending === "function" && oBinding.isRequestPending()) {
                    await this._waitRowsSettled(oTable, 180);
                }

                const len = oBinding.getLength();
                const ctxs = oBinding.getContexts(0, len);
                let didExpand = false;

                for (let i = 0; i < ctxs.length; i++) {
                    const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                    if (!obj) continue;
                    // DrillState = 'collapsed' 인 노드는 실제 expand 호출
                    if (obj.DrillState === "collapsed") {
                        try { oTable.expand(i); didExpand = true; } catch (e) { }
                    }
                }

                // 길이가 늘었거나 방금 펼쳤다면 안정화 대기 후 다음 패스
                if (didExpand || len !== lastLen) {
                    lastLen = len;
                    await this._waitRowsSettled(oTable, 220);
                    continue;
                }
                // 더 이상 펼칠 게 없음 → 종료
                break;
            }
        },

        _restoreODataBinding: function () {
            const oTable = this.byId(Control.Table.T_Main);
            oTable.unbindRows();
            oTable.setModel(null, "client");
            oTable.bindRows({
                path: this._origBindingInfo.path,                 // "/FinancialStatements"
                filters: this._getTableFilter(),
                parameters: this._origBindingInfo.parameters,     // Node/ParentNodeID/DrillState
                events: {
                    dataRequested: this._onTreeTableRequested.bind(this),
                    dataReceived: this._onTreeTableReceived.bind(this),
                }
            });
            this._isClientView = false;
        },

        /** 서버에서 단일 노드의 ParentNodeID 조회 */
        _serverGetParent: function (nodeId) {
            if (nodeId == null) return Promise.resolve(null);
            const oModel = this.getView().getModel();

            // 키 구조를 모르면 filter로 단건 조회
            return new Promise((resolve, reject) => {
                oModel.read("/FinancialStatements", {
                    filters: this._getTableFilter().concat([
                        new sap.ui.model.Filter("Node", sap.ui.model.FilterOperator.EQ, nodeId)
                    ]),
                    urlParameters: { "$top": 1, "$select": "Node,ParentNodeID" },
                    success: (data) => {
                        const row = (data && data.results && data.results[0]) || null;
                        resolve(row ? row.ParentNodeID : null);
                    },
                    error: reject
                });
            });
        },
        /** 바인딩에서 NodeId로 행 인덱스 찾기 */
        /** 바인딩에서 NodeId로 행 인덱스 찾기 (문자열 비교) */
        _indexOfNodeInBindingById: function (nodeId) {
            const want = this._normId(nodeId);
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return -1;

            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            for (let i = 0; i < ctxs.length; i++) {
                const o = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                if (!o) continue;
                const cur = this._normId(o.Node != null ? o.Node : o.NodeID);
                if (cur != null && cur === want) return i;
            }
            return -1;
        },

        _normId: function (v) { return v == null ? null : String(v); },

        /** 현재 가시 컨텍스트에서 'collapsed'만 최대 N개까지 펼친다(너무 많이 안 펴도록 예산 제한) */
        _expandVisibleOnce: function (oTable, budget = 200) {
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) return 0;

            const len = oBinding.getLength();
            const ctxs = oBinding.getContexts(0, len);
            let expanded = 0;

            for (let i = 0; i < ctxs.length && expanded < budget; i++) {
                const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                if (!obj) continue;
                if (obj.DrillState === "collapsed") {
                    try { oTable.expand(i); expanded++; } catch (e) { }
                }
            }
            return expanded;
        },

        _filterTable: function (oFilter) {
            var oVHD = this._oVHD;

            oVHD.getTableAsync().then(function (oTable) {
                if (oTable.bindRows) {
                    oTable.getBinding("rows").filter(oFilter);
                }
                if (oTable.bindItems) {
                    oTable.getBinding("items").filter(oFilter);
                }

                oVHD.update();
            });
        },
        _bindTable: function (oTable) {
            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);
            oTable.bindRows({
                path: "/FinancialStatements",
                filters: aBase.concat(aSearch),
                // filters: this._getTableFilter(),
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
                    dataReceived: this._onTreeTableReceived.bind(this),
                }
            });
        },

        _onTreeTableRequested: function () {
            let oTable = this.getView().byId(Control.Table.T_Main);
            let oBinding = oTable.getBinding("rows");
            const aContexts = oBinding.getContexts(0, oBinding.getLength());
            oTable.setBusy(true);
        },

        _onTreeTableReceived: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable.getBinding("rows");
            oTable.setBusy(true);

            if (!this._bInitialExpandDone) {
                try { oTable.expandToLevel(5); } catch (e) { }
                this._bInitialExpandDone = true;
                this._collapsedNodes = new Set();
            }
            // 바인딩 전에 들어온 검색을 지금 적용
            if (this._deferApplyTableFilters) {
                this._deferApplyTableFilters = false;
                this._applyTableFilters();
                if (this._lastTableQuery) {
                    setTimeout(() => { try { oTable.expandToLevel(20); } catch (e) { } }, 120);
                }
            }

            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },


        _onCBCompanyRequested: function () {
            let oComboBox = this.getView().byId(Control.ComboBox.CB_CompanyCode);
            oComboBox.setBusy(true);
        },

        _onCBCompanyReceived: function () {
            let oComboBox = this.getView().byId(Control.ComboBox.CB_CompanyCode);
            oComboBox.setBusy(false);
        },
        _getTableFilter: function () {
            const oSearch = this.getView().getModel("Search").getData();

            // 전기(비교)
            const sPriorYear = this._getTokenVal("MI_PriorYear");
            const sPriorStart = this._getTokenVal("MI_PriorStartMonth");
            const sPriorEnd = this._getTokenVal("MI_PriorEndMonth");

            // 당기
            const sCurrYear = this._getTokenVal("MI_CurrentYear");
            const sCurrStart = this._getTokenVal("MI_CurrentStartMonth");
            const sCurrEnd = this._getTokenVal("MI_CurrentEndMonth");

            const aFilter = [];
            // 전기
            aFilter.push(new Filter("P_SYEAR", FilterOperator.EQ, sPriorYear));
            aFilter.push(new Filter("P_SMONTH", FilterOperator.EQ, sPriorStart));
            aFilter.push(new Filter("P_SENDMONTH", FilterOperator.EQ, sPriorEnd));
            // 당기
            aFilter.push(new Filter("P_CYEAR", FilterOperator.EQ, sCurrYear));
            aFilter.push(new Filter("P_CMONTH", FilterOperator.EQ, sCurrStart));
            aFilter.push(new Filter("P_CENDMONTH", FilterOperator.EQ, sCurrEnd));
            // 회사코드
            aFilter.push(new Filter("P_COMPCD", FilterOperator.EQ, oSearch.CompanyCode.split(" ")[0]));

            //  GL0 체크박스: true 일 때만 파라미터 전송
            if (oSearch.GL0 === true) {
                // 백엔드가 Boolean을 받으면:
                aFilter.push(new Filter("P_GL0", FilterOperator.EQ, true));

                // 만약 "X"/"" 를 받는다면:
                // aFilter.push(new Filter("P_GL0", FilterOperator.EQ, "X"));
            }
            return aFilter;
        },

        _createColumnConfig: function () {
            var aCols = [];

            aCols.push({
                label: this.i18n.getText("NodeText"), // "노드 이름"
                type: EdmType.String,
                property: 'NodeText',
                width: 30
            });

            aCols.push({
                label: this.i18n.getText("GlAccount"), // "G/L 계정"
                type: EdmType.String,
                property: 'GlAccount',
                width: 12
            });

            aCols.push({
                label: this.i18n.getText("GlAccountText"), // "계정 설명"
                type: EdmType.String,
                property: 'GlAccountText',
                width: 30
            });

            aCols.push({
                label: this.i18n.getText("PeriodBalance"), // "기간 잔액"
                type: EdmType.Currency,
                property: 'PeriodBalance',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("ComparisonBalance"), // "비교기간 잔액"
                type: EdmType.Currency,
                property: 'ComparisonBalance',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("AbsoluteDifference"), // "차이 금액"
                type: EdmType.Currency,
                property: 'AbsoluteDifference',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("RelativeDifference"), // "증감률"
                type: EdmType.Currency,
                property: 'RelativeDifference',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("CompanyCodeCurrency"), // 통화
                type: EdmType.Currency,
                property: 'CompanyCodeCurrency',
                width: 10
            });

            return aCols;
        },

        _makeURL: function (sFilterParams, icount) {
            let sfilters = decodeURI(sFilterParams);
            let ofilters = {
                "$filter": sfilters.substring(1, sfilters.length - 1)
            };
            if (icount) {
                ofilters["$top"] = icount;
            }
            return ofilters;
        },
        // GL 계정 잔액 조회 (현재 필터 기준)
        _navigateToGLBalance: async function (glAccount, companyCode, fromPeriod, toPeriod, fiscalYear) {
            if (!glAccount || !companyCode || !fromPeriod || !toPeriod || !fiscalYear) {
                // sap.m.MessageToast.show("잔액 조회에 필요한 값이 부족합니다.");
                sap.m.MessageToast.show(this.i18n.getText("err.balance.paramMissing"));
                return;
            }

            // 000 보정 방침이 필요하면 여기서만 처리
            const fix = (v, edge) => (v === "000" ? (edge === "from" ? "001" : "016") : v);
            const FromPeriod = fix(fromPeriod, "from");
            const ToPeriod = fix(toPeriod, "to");

            const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
            const sHref = await Navigation.getHref({
                target: { semanticObject: "GLAccount", action: "displayBalances" },
                params: {
                    GLAccount: glAccount,
                    CompanyCode: companyCode,
                    FromPeriod: FromPeriod,
                    ToPeriod: ToPeriod,
                    LedgerFiscalYear: fiscalYear
                }
            });
            sap.m.URLHelper.redirect(window.location.href.split("#")[0] + sHref, true);
        },


        // 총계정원장에서 개별 항목 조회 (현재 필터 기준, FiscalPeriod 다건)
        _navigateToJournalEntry: async function (glAccount, companyCode, fiscalYear, fiscalPeriods) {
            if (!glAccount || !companyCode || !fiscalYear || !Array.isArray(fiscalPeriods) || fiscalPeriods.length === 0) {
                // sap.m.MessageToast.show("개별 항목 조회에 필요한 값이 부족합니다.");
                sap.m.MessageToast.show(this.i18n.getText("err.je.paramMissing"));
                return;
            }

            const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
            const sHref = await Navigation.getHref({
                target: { semanticObject: "GLAccount", action: "displayGLLineItemReportingView" },
                params: {
                    GLAccount: glAccount,
                    CompanyCode: companyCode,
                    FiscalYear: fiscalYear,
                    FiscalPeriod: fiscalPeriods // 배열 → key=val1&key=val2...
                }
            });
            sap.m.URLHelper.redirect(window.location.href.split("#")[0] + sHref, true);
        },

        _initMonthYearInputs: function () {
            ["MI_PriorStartMonth", "MI_PriorEndMonth", "MI_CurrentStartMonth", "MI_CurrentEndMonth"]
                .forEach(id => this._attachMonthValidator(id));
            ["MI_PriorYear", "MI_CurrentYear"].forEach(id => this._attachYearValidator(id));

            const today = new Date();
            const y = String(today.getFullYear());

            // 1) 현재 달(1~12)
            const curMonth = today.getMonth() + 1;          // 1~12
            const curMonthStr = String(curMonth).padStart(3, "0");

            // 2) 비교 종료 기간 = 현재달 - 1  (1월이면 12로)
            const prevMonth = (curMonth === 1) ? 12 : (curMonth - 1);
            const prevMonthStr = String(prevMonth).padStart(3, "0");

            // ▼ 기본값 세팅 (요구사항 유지)
            this._setSingleToken("MI_PriorStartMonth", "000");   // 그대로
            this._setSingleToken("MI_PriorEndMonth", curMonthStr);   // 그대로: 현재달
            this._setSingleToken("MI_CurrentStartMonth", "000"); // 그대로
            this._setSingleToken("MI_CurrentEndMonth", prevMonthStr); // ← 현재달 -1 **여기만 변경**

            this._setSingleToken("MI_PriorYear", y);   // 그대로
            this._setSingleToken("MI_CurrentYear", y); // 그대로

            // ※ 만약 1월일 때 비교연도도 전년으로 바꾸고 싶다면 위 한 줄을 아래처럼 바꾸세요:
            // if (curMonth === 1) this._setSingleToken("MI_CurrentYear", String(today.getFullYear() - 1));
        },

        _attachMonthValidator: function (sId) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.addValidator(args => {
                const raw = (args.text || "").trim();
                // if (!/^\d{1,3}$/.test(raw)) { sap.m.MessageToast.show("기간은 숫자 0~16입니다."); return null; }
                if (!/^\d{1,3}$/.test(raw)) { sap.m.MessageToast.show(this.i18n.getText("err.period.nan")); return null; }
                let n = parseInt(raw, 10);
                // if (n < 0 || n > 16) { sap.m.MessageToast.show("기간은 000~016 범위입니다."); return null; }
                if (n < 0 || n > 16) { sap.m.MessageToast.show(this.i18n.getText("err.period.range")); return null; }
                const val = String(n).padStart(3, "0");
                mi.destroyTokens(); // 단일 값 정책
                return new sap.m.Token({ key: val, text: val });
            });
        },

        _attachYearValidator: function (sId) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.addValidator(args => {
                const raw = (args.text || "").trim();
                if (!/^\d{4}$/.test(raw)) {
                    sap.m.MessageToast.show(this.i18n.getText("err.year.format"));
                    return null;
                }
                const y = parseInt(raw, 10);

                if (y < 1900 || y > 2100) {
                    sap.m.MessageToast.show(this.i18n.getText("err.year.range"));
                    return null;
                }
                mi.destroyTokens(); // 단일 값 정책
                return new sap.m.Token({ key: String(y), text: String(y) });
            });
        },

        _checkRequiredFields: function (sPriorYear, sCurrYear, sPriorStart, sPriorEnd, sCurrStart, sCurrEnd) {
            if (!sPriorYear || !sCurrYear || !sPriorStart || !sPriorEnd || !sCurrStart || !sCurrEnd) {

                MessageBox.error(
                    this.i18n.getText("err.input.missingPeriods"),
                    { title: this.i18n.getText("title.inputError"), styleClass: "sapUiSizeCompact" }
                );
                return false; // 체크 실패
            }
            return true; // 체크 성공
        },

        _setSingleToken: function (sId, sVal) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.destroyTokens();
            mi.addToken(new sap.m.Token({ key: sVal, text: sVal }));
        },

        _getTokenVal: function (sId) {
            const mi = this.byId(sId);
            const t = mi ? mi.getTokens() : [];
            return t.length ? t[0].getKey() : "";
        },

        // 월 범위 → ["006","007",...]
        _expandPeriods: function (sStart, sEnd) {
            const toNum = (v) => Math.max(0, Math.min(16, parseInt(v || "0", 10)));
            let a = toNum(sStart), b = toNum(sEnd);
            if (a === 0 && b === 0) return [];     // 둘 다 000이면 비워둠
            if (a === 0) a = 1;                    // 000은 '미지정' → 001로 보정
            if (b === 0) b = 16;                   // 000은 '미지정' → 016로 보정
            if (a > b) [a, b] = [b, a];
            const out = [];
            for (let i = a; i <= b; i++) out.push(String(i).padStart(3, "0"));
            return out;
        },

        _getToken: function (id) {
            const mi = this.byId(id);
            const t = mi ? mi.getTokens() : [];
            return t.length ? t[0].getKey() : "";
        },

        // 모든 expand/collapse/추가 로딩이 끝나고 행 수가 안정될 때까지 Busy 유지
        _busyUntilFullyExpanded: function (oTable, opts) {
            if (!oTable) return;
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) { oTable.setBusy(false); return; }

            const cfg = Object.assign({ idleMs: 200, stableRepeats: 2, timeoutMs: 500 }, opts || {});
            let lastLen = -1;
            let stable = 0;
            let timedOut = false;

            oTable.setBusy(true);

            const finish = () => {
                if (timedOut) return; // 이미 타임아웃으로 종료된 경우
                oTable.detachRowsUpdated(onRowsUpdated);
                oTable.setBusy(false);
                clearTimeout(timeoutId);
            };

            const onRowsUpdated = () => {
                // 디바운스: idleMs 후 검사
                clearTimeout(checkId);
                checkId = setTimeout(() => {
                    const pending = (typeof oBinding.isRequestPending === "function") && oBinding.isRequestPending();
                    const len = oBinding.getLength();

                    if (!pending && len === lastLen) {
                        stable += 1;
                    } else {
                        stable = 0;
                        lastLen = len;
                    }

                    if (stable >= cfg.stableRepeats) {
                        finish();
                    }
                }, cfg.idleMs);
            };

            // 안전장치: 비정상 상황에서 최대 timeoutMs 뒤 Busy 해제
            const timeoutId = setTimeout(() => {
                timedOut = true;
                oTable.detachRowsUpdated(onRowsUpdated);
                oTable.setBusy(false);
            }, cfg.timeoutMs);

            let checkId = null;
            oTable.attachRowsUpdated(onRowsUpdated);

            // 즉시 한 번 트리거
            onRowsUpdated();
        },
        // 마지막 검색어 저장용(초기값)
        _lastTableQuery: "",
        _deferApplyTableFilters: false,

        // 검색어 OR 필터 생성 (NodeText, GlAccount, GlAccountText)
        _buildSearchFilters: function (sQuery) {
            const q = (sQuery || "").trim();
            if (!q) return [];
            return [
                new sap.ui.model.Filter({
                    and: false,
                    filters: [
                        new sap.ui.model.Filter("NodeText", sap.ui.model.FilterOperator.Contains, q),
                        new sap.ui.model.Filter("GlAccount", sap.ui.model.FilterOperator.Contains, q),
                        new sap.ui.model.Filter("GlAccountText", sap.ui.model.FilterOperator.Contains, q)
                    ]
                })
            ];
        },

        // 현재 바인딩에 (기간/회사코드 등) 기본필터 + 검색필터 적용
        _applyTableFilters: function () {
            const oTable = this.byId(Control.Table.T_Main);
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) return;

            const aBase = this._getTableFilter();
            const aSearch = this._buildSearchFilters(this._lastTableQuery);

            // Application 필터 그룹으로 적용 (서버 모드와 공존)
            oBinding.filter(aBase.concat(aSearch), sap.ui.model.FilterType.Application);
        },

        // 교체
        _fmtMMYYYY(year, period) {
            if (!year) return "";
            const p = String(period || "000").padStart(3, "0");
            // 000이면 "00", 그 외 001~016은 01~16로
            const mm = (p === "000")
                ? "00"
                : String(Math.max(1, Math.min(16, parseInt(p, 10)))).padStart(2, "0");
            return `${mm}.${year}`;
        },

        _buildPeriodLabel(year, fromP, toP) {
            if (!year) return "";
            const a = this._fmtMMYYYY(year, fromP);
            const b = this._fmtMMYYYY(year, toP);
            return `(${a}-${b})`;
        },

        /** 헤더(라벨) 텍스트 바꾸기 */
        _setPeriodHeaders() {
            const oTable = this.byId("T_Main");
            if (!oTable) return;

            // ※ 현재 코드 기준: PeriodBalance ← 전기(Prior), ComparisonBalance ← 당기(Current)
            const priorYear = this._getTokenVal("MI_PriorYear");
            const priorFrom = this._getTokenVal("MI_PriorStartMonth");
            const priorTo = this._getTokenVal("MI_PriorEndMonth");

            const currYear = this._getTokenVal("MI_CurrentYear");
            const currFrom = this._getTokenVal("MI_CurrentStartMonth");
            const currTo = this._getTokenVal("MI_CurrentEndMonth");

            const reportLabel = this._buildPeriodLabel(priorYear, priorFrom, priorTo); // 리포팅기간(=전기)
            const compareLabel = this._buildPeriodLabel(currYear, currFrom, currTo);  // 비교기간(=당기)

            const colReport = this.byId("COL_PeriodBalance");
            const colCompare = this.byId("COL_ComparisonBalance");

            if (colReport && colReport.getLabel()) {
                colReport.getLabel()
                    .setText(this.i18n.getText("PeriodBalance") + " " + reportLabel);
            }
            if (colCompare && colCompare.getLabel()) {
                colCompare.getLabel()
                    .setText(this.i18n.getText("ComparisonBalance") + " " + compareLabel);
            }
        }

    });
});
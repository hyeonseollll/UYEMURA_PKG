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
        // onInit: function () {
        //     // i18n Init
        //     this.i18n = this.getOwnerComponent().getModel("i18n").getResourceBundle();
        //     oView = this.getView();
        //     oView.setModel(new JSONModel(), "oResult");
        //     oView.setModel(Model.createDateRangeModel(), 'DateRange');
        //     // ▼ 월/연도 MultiInput 토큰 세팅 + validator 연결
        //     this._initMonthYearInputs();

        //     //GL 데이터
        //     oView.setModel(new JSONModel(), "oGLAccount");
        //     vVHGL = oView.getModel("oGLAccount"),
        //         Model.readODataModel("ZSB_FISTATEMENTS_UI_O2", "GLAccount_VH", null, null, null)
        //             .then((vMVGLH) => {
        //                 vVHGL.setProperty("/", vMVGLH.results); // results로 바인딩
        //             })
        //             .catch((err) => console.error(err));


        //     //---------------------------------------------------------------/
        //     // Change Filterbar's Go Text
        //     //---------------------------------------------------------------/
        //     let oFilter = this.byId(Control.FilterBar.FB_MainSearch);
        //     oFilter.addEventDelegate({
        //         "onAfterRendering": function (oEvent) {
        //             let oButton = oEvent.srcControl._oSearchButton;
        //             if (oButton) {
        //                 oButton.setText(this.i18n.getText("goButton"));
        //             }
        //         }.bind(this)
        //     });

        //     //---------------------------------------------------------------/
        //     // Search Model 
        //     //---------------------------------------------------------------/
        //     this.getView().setModel(Model.createSearchModel(), 'Search');

        //     //---------------------------------------------------------------/
        //     // Search Model 
        //     //---------------------------------------------------------------/
        //     let oTreeTable = this.getView().byId(Control.Table.T_Main);
        //     //this._bindTable(oTreeTable);
        // },

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

            // 초기 조회
            this._bInitialExpandDone = false;
            const oTreeTable = this.byId(Control.Table.T_Main);
            this._bindTable(oTreeTable);
        },


        onAfterRendering: function () {

            let oTable = this.byId(Control.Table.T_Main);
            // 🔹 자동 → 고정 모드
            oTable.setVisibleRowCountMode(sap.ui.table.VisibleRowCountMode.Fixed);
            oTable.setVisibleRowCount(25); // 원하는 값으로(15~25 권장)
            if (oTable && typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));

                this._bindColumns(oTable);
            } else {
                console.error("TreeTable not ready or not found", oTable);
            }
        },


        /******************************************************************
         * Event Listener
         ******************************************************************/
        onSearch: function () {
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

        // onExport: function () {
        //     let oBExcel = this.getView().byId(Control.Button.B_Excel);
        //     oBExcel.setBusy(true);

        //     let oTreeTable = this.getView().byId(Control.Table.T_Main);
        //     let oRowBinding = oTreeTable.getBinding('rows');

        //     this.getView().getModel().read('/FinancialStatements/$count', {
        //         urlParameters: this._makeURL(oRowBinding.sFilterParams),
        //         success: function (oResult) {
        //             this.count = oResult;
        //             this.getView().getModel().read('/FinancialStatements', {
        //                 urlParameters: this._makeURL(oRowBinding.sFilterParams, oResult),
        //                 success: function (oResult) {
        //                     this.data = oResult.results
        //                     let aCols, oSettings, oSheet;
        //                     aCols = this._createColumnConfig();

        //                     oSettings = {
        //                         workbook: {
        //                             columns: aCols,
        //                             hierarchyLevel: "HierarchyLevel"
        //                         },
        //                         dataSource: this.data,
        //                         fileName: this.i18n.getText("title") + (new Date()).toISOString() + '.xlsx',
        //                         worker: true
        //                     };

        //                     oSheet = new Spreadsheet(oSettings);
        //                     oSheet.build().finally(function () {
        //                         oSheet.destroy();
        //                         oBExcel.setBusy(false);
        //                     });
        //                 }.bind(this)
        //             })
        //         }.bind(this)
        //     })
        // },


        onExport: function () {
            let oBExcel = this.getView().byId(Control.Button.B_Excel);
            oBExcel.setBusy(true);

            let oTreeTable = this.getView().byId(Control.Table.T_Main);
            let oRowBinding = oTreeTable.getBinding('rows');

            let aExportData = [];
            let iRowCount = oRowBinding.getLength();

            // 🌳 TreeTable 내부의 _aNodes 배열을 사용합니다.
            let aNodes = oRowBinding.getNodes(); // 또는 oTreeTable._aNodes;

            for (let i = 0; i < iRowCount; i++) {
                let oContext = oRowBinding.getContextByIndex(i);
                if (oContext) {
                    let oRowData = oContext.getObject();

                    // 💡 노드에서 직접 레벨을 가져옵니다.
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

        onTableSearch: function (oEventOrString) {
            const sQuery =
                (typeof oEventOrString === "string"
                    ? oEventOrString
                    : (oEventOrString.getParameter("query") || "")).trim();

            if (!sQuery) { sap.m.MessageToast.show("검색어를 입력하세요."); return; }
            this.jumpToQuery(sQuery, { focusCol: 0 });
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
        /** 모두 접힌 상태라도, 얕게→넓게 펼치며 매칭을 찾으면 즉시 점프 */
        jumpToQuery: async function (sQuery, options) {
            const oTable = this.byId("T_Main");
            const oBinding = oTable && oTable.getBinding("rows");
            if (!oBinding) { sap.m.MessageToast.show("먼저 조회를 실행하세요."); return; }

            const opt = Object.assign({
                maxRounds: 12,      // 확장 라운드 상한 (너무 많이 펴지 않도록)
                perRoundBudget: 200, // 라운드당 펼칠 최대 노드 수
                focusCol: 0
            }, options);

            const q = (sQuery || "").toLowerCase();

            // 0) 루트가 다 닫혀있으면 최소 1레벨은 보이게
            try { oTable.expandToLevel(5); } catch (e) { }
            await this._waitRowsSettled(oTable, 120);

            // 매 라운드: (찾기 → 못 찾으면 조금 펼치기 → 안정화 대기) 반복
            for (let round = 0; round < opt.maxRounds; round++) {
                // A) 현재 가시 영역에서 먼저 찾기
                const len = oBinding.getLength();
                const ctxs = oBinding.getContexts(0, len);
                for (let i = 0; i < ctxs.length; i++) {
                    const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                    if (!obj) continue;
                    if (this._rowMatchesQuery(obj, q)) {
                        this._scrollSelectFocusRow(i, opt.focusCol);
                        return;
                    }
                }

                // B) 못 찾았으면 가볍게 한 층 더 펼치기
                const expanded = this._expandVisibleOnce(oTable, opt.perRoundBudget);

                // 더 펼칠 게 없으면 종료
                if (!expanded) break;

                // C) 로딩 안정화 대기 후 다음 라운드
                await this._waitRowsSettled(oTable, 180);
            }

            sap.m.MessageToast.show("일치 항목이 없습니다.");
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
                    sap.m.MessageToast.show("검색 해제");
                }
                return;
            }

            // 최초 한 번: OData 바인딩 정보 저장 (복구용)
            if (!this._origBindingInfo) {
                const ob = oTable.getBinding("rows");
                if (!ob) {
                    sap.m.MessageToast.show("먼저 조회를 실행하세요.");
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
                const obNow = oTable.getBinding("rows");
                const len = obNow.getLength();
                const ctxs = obNow.getContexts(0, len);
                flat = ctxs.map(c => c && c.getObject()).filter(Boolean);
                this._flatSnapshot = flat; // ⬅️ 이후 검색 재사용
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

            // ⬇️ 여기서는 점프/토스트를 하지 않습니다. (호출자 onTableSearch에서 처리)
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


        /** 매칭 노드의 서브트리는 전부 보존 + 매칭 자손의 조상 경로 보존 */
        _filterTreeByQuery: function (nodes, sQuery) {
            const q = (sQuery || "").toLowerCase();
            const V = v => String(v == null ? "" : v).toLowerCase();

            const hit = (n) => {
                const cands = [
                    n.NodeText
                ];
                return cands.some(x => V(x).includes(q));
            };

            const deepCopy = (n) => {
                const c = Object.assign({}, n);
                c.children = (n.children || []).map(deepCopy);
                return c;
            };

            const dfs = (n) => {
                if (hit(n)) return deepCopy(n);               // 매칭 → 하위 전부 보존
                const kept = (n.children || []).map(dfs).filter(Boolean);
                if (kept.length) {                            // 자손 매칭 → 조상 경로 보존
                    const c = Object.assign({}, n);
                    c.children = kept;
                    return c;
                }
                return null;
            };

            return (nodes || []).map(dfs).filter(Boolean);
        },
        _isHit: function (n, q) {
            const V = v => String(v == null ? "" : v).toLowerCase();
            const cands = [n.NodeText, n.GlAccount, n.GlAccountText]; //  확대
            return cands.some(x => V(x).includes(q));
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
        _indexOfNodeInBinding: function (nodeId) {
            const oTable = this.byId("T_Main");
            const ob = oTable && oTable.getBinding("rows");
            if (!ob) return -1;
            const len = ob.getLength();
            const ctxs = ob.getContexts(0, len);
            for (let i = 0; i < ctxs.length; i++) {
                const o = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                const id = o && (o.Node != null ? o.Node : o.NodeID);
                if (id === nodeId) return i;
            }
            return -1;
        },


        _gotoNextHit: function () {
            const oTable = this.byId("T_Main");
            if (!oTable || !this._hitNodeIds || !this._hitNodeIds.length) {
                sap.m.MessageToast.show("일치 항목이 없습니다."); return;
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
        /**
 * 모든 'collapsed' 행을 실제로 expand 하며(지연 로딩 트리거) 더 이상 펼칠 게 없을 때까지 반복
 * - maxPass: 전체 스캔 반복 횟수 상한(안전장치)
 */
        _expandAllDeep: async function (oTable, maxPass = 8) {
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) return;

            for (let pass = 0; pass < maxPass; pass++) {
                const len = oBinding.getLength();
                const ctxs = oBinding.getContexts(0, len);
                let didExpand = false;

                for (let i = 0; i < ctxs.length; i++) {
                    const obj = ctxs[i] && ctxs[i].getObject && ctxs[i].getObject();
                    if (!obj) continue;
                    // 트리 어노테이션에서 DrillState 사용 중
                    if (obj.DrillState === "collapsed") {
                        try { oTable.expand(i); didExpand = true; } catch (e) { }
                    }
                }

                if (!didExpand) break;                 // 더 펼칠 노드가 없으면 종료
                await this._waitRowsSettled(oTable);   // 로딩 안정화 대기 후 다음 패스
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

        /** 해당 인덱스로 스크롤하고 선택 + 포커스까지 맞춤 */
        _scrollSelectFocusRow: function (idx, focusCol = 0) {
            const oTable = this.byId("T_Main");
            if (!oTable || idx < 0) return;

            // 스크롤 먼저
            oTable.setFirstVisibleRow(Math.max(0, idx - 2));
            oTable.setSelectedIndex(idx);

            // 행 렌더가 끝난 뒤 셀에 포커스 주기
            const once = () => {
                oTable.detachRowsUpdated(once);
                const first = oTable.getFirstVisibleRow();
                const rel = idx - first;
                const aRows = oTable.getRows();
                if (rel >= 0 && rel < aRows.length) {
                    const aCells = aRows[rel].getCells ? aRows[rel].getCells() : [];
                    if (aCells[focusCol] && aCells[focusCol].focus) {
                        aCells[focusCol].focus();
                    }
                }
            };
            oTable.attachRowsUpdated(once);
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

        /** 행 오브젝트가 쿼리와 매칭되는지 */
        _rowMatchesQuery: function (obj, q) {
            const V = v => String(v == null ? "" : v).toLowerCase();
            // 숫자만(또는 숫자-하이픈)인 경우는 GLAccount에 '포함'보다 '정확 일치' 우선
            const isGlLike = /^\d[\d-]*$/.test(q);
            if (isGlLike && V(obj.GlAccount) === q) return true;

            const cands = [obj.NodeText, obj.GlAccount, obj.GlAccountText];
            return cands.some(v => V(v).includes(q));
        },
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

        // _onTreeTableReceived: function () {
        //     const oTable = this.byId(Control.Table.T_Main);
        //     const oBinding = oTable.getBinding("rows");

        //     // 데이터 도착 시점부터 Busy 유지
        //     oTable.setBusy(true);

        //     if (!this._bInitialExpandDone) {
        //         try { oTable.expandToLevel(5); } catch (e) { console.warn("expandToLevel failed:", e); }
        //         this._bInitialExpandDone = true;
        //         this._collapsedNodes = new Set();
        //     } else if (this._collapsedNodes && this._collapsedNodes.size && oBinding) {
        //         const aContexts = oBinding.getContexts(0, oBinding.getLength());
        //         aContexts.forEach((ctx, idx) => {
        //             const id = ctx.getObject().Node;
        //             if (this._collapsedNodes.has(id)) {
        //                 try { oTable.collapse(idx); } catch (e) { console.warn("collapse failed:", e); }
        //             }
        //         });
        //     }

        //     // 노드가 모두 펼쳐지고 네트워크 요청이 끝나며 행 수가 '연속'으로 안정될 때 Busy OFF
        //     this._busyUntilFullyExpanded(oTable, {
        //         idleMs: 250,        // rowsUpdated 후 안정 대기 시간
        //         stableRepeats: 2,   // 연속 2회 동일하면 안정으로 간주
        //         timeoutMs: 15000    // 안전 타임아웃
        //     });
        // },
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

            // // 필수값 체크
            // if (!sPriorYear || !sCurrYear || !sPriorStart || !sPriorEnd || !sCurrStart || !sCurrEnd) {
            //     sap.m.MessageToast.show("기준 기간과 비교 기간의 시작 월, 종료 월, 회계연도를 모두 입력하세요.");
            // }

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
                ype: EdmType.Currency,
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
                sap.m.MessageToast.show("잔액 조회에 필요한 값이 부족합니다.");
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
                sap.m.MessageToast.show("개별 항목 조회에 필요한 값이 부족합니다.");
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

        // ====== 토큰 유틸 & 초기화 ======
        _initMonthYearInputs: function () {
            ["MI_PriorStartMonth", "MI_PriorEndMonth", "MI_CurrentStartMonth", "MI_CurrentEndMonth"]
                .forEach(id => this._attachMonthValidator(id));
            ["MI_PriorYear", "MI_CurrentYear"].forEach(id => this._attachYearValidator(id));

            const today = new Date();
            const y = String(today.getFullYear());
            const m = String(today.getMonth() + 1).padStart(3, "0"); // ← 현재 달(001~012)

            // 시작월 기본값은 기존 정책 유지(000), 종료월은 현재 달로
            this._setSingleToken("MI_PriorStartMonth", "000");
            this._setSingleToken("MI_PriorEndMonth", m);   // ← 현재 달
            this._setSingleToken("MI_CurrentStartMonth", "000");
            this._setSingleToken("MI_CurrentEndMonth", m);   // ← 현재 달

            this._setSingleToken("MI_PriorYear", y);
            this._setSingleToken("MI_CurrentYear", y);
        },

        _attachMonthValidator: function (sId) {
            const mi = this.byId(sId);
            if (!mi) return;
            mi.addValidator(args => {
                const raw = (args.text || "").trim();
                if (!/^\d{1,3}$/.test(raw)) { sap.m.MessageToast.show("기간은 숫자 0~16입니다."); return null; }
                let n = parseInt(raw, 10);
                if (n < 0 || n > 16) { sap.m.MessageToast.show("기간은 000~016 범위입니다."); return null; }
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
                if (!/^\d{4}$/.test(raw)) { sap.m.MessageToast.show("연도는 YYYY(4자리)로 입력하세요."); return null; }
                const y = parseInt(raw, 10);
                if (y < 1900 || y > 2100) { sap.m.MessageToast.show("연도 범위: 1900~2100"); return null; }
                mi.destroyTokens(); // 단일 값 정책
                return new sap.m.Token({ key: String(y), text: String(y) });
            });
        },

        _checkRequiredFields: function (sPriorYear, sCurrYear, sPriorStart, sPriorEnd, sCurrStart, sCurrEnd) {
            if (!sPriorYear || !sCurrYear || !sPriorStart || !sPriorEnd || !sCurrStart || !sCurrEnd) {
                MessageBox.error(
                    "기준 기간과 비교 기간의 시작 월, 종료 월, 회계연도를 모두 입력하세요.",
                    {
                        title: "입력 오류",
                        styleClass: "sapUiSizeCompact"
                    }
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
    });
});
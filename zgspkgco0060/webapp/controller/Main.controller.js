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

            this.getView().getModel().read('/FinancialStatements/$count', {
                urlParameters: this._makeURL(oRowBinding.sFilterParams),
                success: function (oResult) {
                    this.count = oResult;
                    this.getView().getModel().read('/FinancialStatements', {
                        urlParameters: this._makeURL(oRowBinding.sFilterParams, oResult),
                        success: function (oResult) {
                            this.data = oResult.results
                            let aCols, oSettings, oSheet;
                            aCols = this._createColumnConfig();

                            oSettings = {
                                workbook: {
                                    columns: aCols,
                                    hierarchyLevel: "HierarchyLevel"
                                },
                                dataSource: this.data,
                                fileName: this.i18n.getText("title") + (new Date()).toISOString() + '.xlsx',
                                worker: true
                            };

                            oSheet = new Spreadsheet(oSettings);
                            oSheet.build().finally(function () {
                                oSheet.destroy();
                                oBExcel.setBusy(false);
                            });
                        }.bind(this)
                    })
                }.bind(this)
            })
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
            var oMultiInput; ``

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

        /******************************************************************
         * Private Function
         ******************************************************************/

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
            console.log(oTable);
            oTable.bindRows({
                path: "/FinancialStatements",
                filters: this._getTableFilter(),
                parameters: {
                    countMode: "Inline",
                    operationMode: "Server",
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

            // 데이터 도착 시점부터 Busy 유지
            oTable.setBusy(true);

            if (!this._bInitialExpandDone) {
                try { oTable.expandToLevel(5); } catch (e) { console.warn("expandToLevel failed:", e); }
                this._bInitialExpandDone = true;
                this._collapsedNodes = new Set();
            } else if (this._collapsedNodes && this._collapsedNodes.size && oBinding) {
                const aContexts = oBinding.getContexts(0, oBinding.getLength());
                aContexts.forEach((ctx, idx) => {
                    const id = ctx.getObject().Node;
                    if (this._collapsedNodes.has(id)) {
                        try { oTable.collapse(idx); } catch (e) { console.warn("collapse failed:", e); }
                    }
                });
            }

            // 노드가 모두 펼쳐지고 네트워크 요청이 끝나며 행 수가 '연속'으로 안정될 때 Busy OFF
            this._busyUntilFullyExpanded(oTable, {
                idleMs: 250,        // rowsUpdated 후 안정 대기 시간
                stableRepeats: 2,   // 연속 2회 동일하면 안정으로 간주
                timeoutMs: 15000    // 안전 타임아웃
            });
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
                label: this.i18n.getText("PeriodBalance"), // "당기 금액"
                template: new sap.m.HBox({
                    items: [
                        new sap.m.Link({
                            // GlAccount가 있을 때만 링크를 표시하고,
                            // text와 press 이벤트도 조건부로 바인딩
                            visible: "{= !!${GlAccount} }",
                            text: {
                                path: 'PeriodBalance',
                                type: new sap.ui.model.type.Currency({
                                    showMeasure: false,
                                    currencyCode: false
                                })
                            },
                            press: this.onPeriodBalancePress.bind(this)
                        }),
                        new sap.m.Text({
                            // GlAccount가 없을 때만 일반 텍스트를 표시합니다.
                            visible: "{= !${GlAccount} }",
                            text: {
                                path: 'PeriodBalance',
                                type: new sap.ui.model.type.Currency({
                                    showMeasure: false,
                                    currencyCode: false
                                })
                            },
                            textAlign: "End"
                        })
                    ],
                    justifyContent: "End",
                    width: "100%"
                }),
                width: "20rem"
            });

            aCols.push({
                label: this.i18n.getText("ComparisonBalance"), // "전기 금액"
                type: EdmType.Number,
                property: 'ComparisonBalance',
                unitProperty: 'CompanyCodeCurrency',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("AbsoluteDifference"), // "차이 금액"
                type: EdmType.Number,
                property: 'AbsoluteDifference',
                unitProperty: 'CompanyCodeCurrency',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("RelativeDifference"), // "증감률"
                type: EdmType.Number,
                property: 'RelativeDifference',
                unitProperty: 'CompanyCodeCurrency',
                width: 20
            });

            aCols.push({
                label: this.i18n.getText("CompanyCodeCurrency"), // 통화
                type: EdmType.String,
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

            const cfg = Object.assign({ idleMs: 200, stableRepeats: 2, timeoutMs: 15000 }, opts || {});
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
    });
});
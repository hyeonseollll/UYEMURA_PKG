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
    "com/gsitm/pkg/co/zgspkgco0060/formatter/formatter"
], (Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet, JSONModel, SearchField, Column, Token, Label, Text, formatter) => {
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
            // i18n Init
            this.i18n = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            oView = this.getView();
            oView.setModel(new JSONModel(), "oResult");
            oView.setModel(Model.createDateRangeModel(), 'DateRange');

            //GL 데이터
            oView.setModel(new JSONModel(), "oGLAccount");
            vVHGL = oView.getModel("oGLAccount"),
                Model.readODataModel("ZSB_FISTATEMENTS_UI_O2", "GLAccount_VH", null, null, null)
                    .then((vMVGLH) => {
                        vVHGL.setProperty("/", vMVGLH.results); // results로 바인딩
                    })
                    .catch((err) => console.error(err));


            //---------------------------------------------------------------/
            // Change Filterbar's Go Text
            //---------------------------------------------------------------/
            let oFilter = this.byId(Control.FilterBar.FB_MainSearch);
            oFilter.addEventDelegate({
                "onAfterRendering": function (oEvent) {
                    let oButton = oEvent.srcControl._oSearchButton;
                    if (oButton) {
                        oButton.setText(this.i18n.getText("goButton"));
                    }
                }.bind(this)
            });

            //---------------------------------------------------------------/
            // Search Model 
            //---------------------------------------------------------------/
            this.getView().setModel(Model.createSearchModel(), 'Search');

            //---------------------------------------------------------------/
            // Search Model 
            //---------------------------------------------------------------/
            let oTreeTable = this.getView().byId(Control.Table.T_Main);
            //this._bindTable(oTreeTable);
        },

        // onAfterRendering: function () {
        //     let oTable = this.byId(Control.Table.T_Main);

        //     if (oTable && typeof oTable.attachCollapse === "function") {
        //         oTable.attachCollapse(this.onCollapse.bind(this));
        //         oTable.attachExpand(this.onExpand.bind(this));
        //     } else {
        //         console.error("TreeTable not ready or not found", oTable);
        //     }
        // },

        onAfterRendering: function () {
            let oTable = this.byId(Control.Table.T_Main);

            if (oTable && typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));

                // 🚩 컬럼을 다시 생성하는 로직을 추가합니다.
                // 이렇게 하면 테이블이 렌더링될 때마다 컬럼이 재정의됩니다.
                this._bindColumns(oTable);
            } else {
                console.error("TreeTable not ready or not found", oTable);
            }
        },


        /******************************************************************
         * Event Listener
         ******************************************************************/
        onSearch: function (oEvent) {
            console.log(this.getView().getModel("Search").getData());

            let oTable = this.getView().byId(Control.Table.T_Main);
            oTable.unbindRows(); // 바인딩된 해제
            this._bindTable(oTable);
            this._bInitialExpandDone = false;

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
                                worker: true // We need to disable worker because we are using a Mockserver as OData Service
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

        // onPeriodBalancePress: function (oEvent) {
        //     const oContext = oEvent.getSource().getBindingContext();
        //     const oData = oContext.getObject();
        //     const glAccount = oData.GlAccount;
        //     const companyCode = oData.CompanyCode || "4310";

        //     // DateRange 모델에서 priorStart, priorEnd 가져오기
        //     const oDate = this.getView().getModel("DateRange").getData();
        //     const priorStart = new Date(oDate.priorStart);
        //     const priorEnd = new Date(oDate.priorEnd);

        //     const fiscalYear = priorStart.getFullYear(); // 전기 기준
        //     const fromperiod = (priorStart.getMonth() + 1).toString().padStart(3, '0');
        //     const toperiod = (priorEnd.getMonth() + 1).toString().padStart(3, '0');

        //     if (!glAccount) {
        //         sap.m.MessageToast.show("G/L 계정이 없습니다.");
        //         return;
        //     }

        //     const oActionSheet = new sap.m.ActionSheet({
        //         showCancelButton: true,
        //         buttons: [
        //             new sap.m.Button({
        //                 text: "G/L 계정 잔액조회",
        //                 press: () => this._navigateToGLBalance(glAccount, companyCode, fromperiod, toperiod, fiscalYear)
        //             }),
        //             new sap.m.Button({
        //                 text: "총계정원장에서 개별 항목 조회",
        //                 press: () => this._navigateToJournalEntry(glAccount, companyCode, fromperiod, toperiod, fiscalYear,)
        //             })
        //         ]
        //     });

        //     this.getView().addDependent(oActionSheet);
        //     oActionSheet.openBy(oEvent.getSource());
        // },

        // ... in your controller.extend block
        // ... in your controller.extend block

        onPeriodBalancePress: function (oEvent) {
            const oLink = oEvent.getSource();
            const oBindingContext = oLink.getBindingContext();

            // 이 부분에서 바인딩 컨텍스트의 유효성을 먼저 확인합니다.
            if (oBindingContext) {
                const oData = oBindingContext.getObject();

                // G/L 계정 필드의 데이터가 존재하는지 확인합니다.
                const glAccount = oData.GlAccount;

                // G/L 계정이 없으면 메시지를 표시하고 함수를 종료합니다.
                // 이렇게 하면 상위 노드를 클릭했을 때 아무런 동작 없이 안전하게 처리됩니다.
                if (!glAccount) {
                    sap.m.MessageToast.show(this.i18n.getText("noGLAccount")); // i18n으로 처리된 메시지 사용
                    return;
                }

                const companyCode = oData.CompanyCode || "4310";

                // DateRange 모델에서 priorStart, priorEnd 가져오기
                const oDate = this.getView().getModel("DateRange").getData();
                const priorStart = new Date(oDate.priorStart);
                const priorEnd = new Date(oDate.priorEnd);

                const fiscalYear = priorStart.getFullYear(); // 전기 기준
                const fromperiod = (priorStart.getMonth() + 1).toString().padStart(3, '0');
                const toperiod = (priorEnd.getMonth() + 1).toString().padStart(3, '0');
                const FiscalPeriod = [{
                    Sign: "I",
                    Option: "BT",
                    Low: fromperiod,
                    High: toperiod
                }];

                // ActionSheet을 생성하여 버튼을 추가합니다.
                const oActionSheet = new sap.m.ActionSheet({
                    showCancelButton: true,
                    buttons: [
                        new sap.m.Button({
                            text: "G/L 계정 잔액조회",
                            press: () => this._navigateToGLBalance(glAccount, companyCode, fromperiod, toperiod, fiscalYear,)
                        }),
                        new sap.m.Button({
                            text: "총계정원장에서 개별 항목 조회",
                            press: () => this._navigateToJournalEntry(glAccount, companyCode, fromperiod, toperiod, fiscalYear)
                        })
                    ]
                });

                // ActionSheet을 열고, oEvent.getSource()를 기준으로 위치를 지정합니다.
                this.getView().addDependent(oActionSheet);
                oActionSheet.openBy(oEvent.getSource());
            } else {
                // 바인딩 컨텍스트가 없는 경우 (예: G/L 계정이 없는 상위 노드)
                // 경고 메시지를 로그에 남기고 함수를 종료합니다.
                console.warn("바인딩 컨텍스트를 찾을 수 없습니다. (G/L 계정이 없는 상위 노드일 가능성)");
            }
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

        // _onTreeTableReceived: function () {
        //     let oTable = this.getView().byId(Control.Table.T_Main);
        //     oTable.expandToLevel(4);

        //     var aIndices = oTable.getBinding("rows").getContexts(0, oTable.getBinding("rows").getLength());

        //     aIndices.forEach(function (oContext, iIndex) {
        //         var oRowData = oContext.getObject();


        //         // if (oRowData.DrillState === "expanded") {
        //         //     // 중요: index는 바뀔 수 있어서 안전하게 context 기반으로 처리해야 하나,
        //         //     // 간단하게는 index로 처리 가능
        //         //     try {
        //         //         oTable.expand(iIndex);
        //         //     } catch (e) {
        //         //         console.warn("Expand failed at index", iIndex, e);
        //         //     }
        //         // }
        //     });

        //     oTable.setBusy(false);
        // },

        // ... in your controller.extend block

        _onTreeTableReceived: function () {
            let oTable = this.getView().byId(Control.Table.T_Main);
            oTable.setBusy(false);

            // Initial expansion up to level 4 and initialize the set
            if (!this._bInitialExpandDone) {
                oTable.expandToLevel(4);
                this._bInitialExpandDone = true;
                this._collapsedNodes = new Set();
                return;
            }

            // After the initial load, re-apply the collapsed state
            const aContexts = oTable.getBinding("rows").getContexts(0, oTable.getBinding("rows").getLength());
            if (this._collapsedNodes) {
                aContexts.forEach((oContext, iIndex) => {
                    const oRowData = oContext.getObject();
                    const sNodeId = oRowData.Node;

                    if (this._collapsedNodes.has(sNodeId)) {
                        // If this node was collapsed by the user, collapse it again
                        try {
                            oTable.collapse(iIndex);
                        } catch (e) {
                            console.warn("Collapse failed at", iIndex, e);
                        }
                    }
                });
            }
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
            const oDate = this.getView().getModel("DateRange").getData();

            const parseDate = (val) => {
                if (val instanceof Date) return val;
                if (typeof val === "string") return new Date(val + "T00:00:00");
                return new Date(); // fallback
            };

            const priorStart = parseDate(oDate.priorStart);
            const priorEnd = parseDate(oDate.priorEnd);
            const currentStart = parseDate(oDate.currentStart);
            const currentEnd = parseDate(oDate.currentEnd);


            let aFilter = [];

            // 전기
            aFilter.push(new Filter("P_SYEAR", FilterOperator.EQ, priorStart.getFullYear()));
            aFilter.push(new Filter("P_SMONTH", FilterOperator.EQ, (priorStart.getMonth() + 1 + "").padStart(3, '0')));
            aFilter.push(new Filter("P_SENDMONTH", FilterOperator.EQ, (priorEnd.getMonth() + 1 + "").padStart(3, '0')));

            // 당기
            aFilter.push(new Filter("P_CYEAR", FilterOperator.EQ, currentStart.getFullYear()));
            aFilter.push(new Filter("P_CMONTH", FilterOperator.EQ, (currentStart.getMonth() + 1 + "").padStart(3, '0')));
            aFilter.push(new Filter("P_CENDMONTH", FilterOperator.EQ, (currentEnd.getMonth() + 1 + "").padStart(3, '0')));

            // 회사 코드
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

            // aCols.push({
            //     label: this.i18n.getText("PeriodBalance"), // "당기 금액"
            //     template: new sap.m.Link({
            //         text: {
            //             parts: [
            //                 { path: 'PeriodBalance' },
            //                 { path: 'CompanyCodeCurrency' }
            //             ],
            //             type: new sap.ui.model.type.Currency({
            //                 showMeasure: false,
            //                 currencyCode: false
            //             })
            //         },
            //         press: this.onPeriodBalancePress.bind(this)
            //     }),
            //     width: "20rem"
            // });

            aCols.push({
                label: this.i18n.getText("PeriodBalance"), // "당기 금액"
                template: new sap.m.HBox({
                    items: [
                        new sap.m.Link({
                            // GlAccount가 있을 때만 링크를 표시하고,
                            // text와 press 이벤트도 조건부로 바인딩합니다.
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
        // GL 계정 잔액 조회
        _navigateToGLBalance: async function (glAccount, companyCode, fromperiod, toperiod, fiscalYear) {
            const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
            const sHref = await Navigation.getHref({
                target: {
                    semanticObject: "GLAccount", // 실제 등록된 Semantic Object로 변경
                    action: "displayBalances"
                },
                params: {
                    GLAccount: glAccount,
                    CompanyCode: companyCode,
                    FromPeriod: fromperiod,
                    ToPeriod: toperiod,
                    LedgerFiscalYear: fiscalYear,
                }
            });
            sap.m.URLHelper.redirect(window.location.href.split('#')[0] + sHref, true);
        },
        // 총계정원장에서 개별 항목 조회
        // _navigateToJournalEntry: async function (glAccount, companyCode, fromPeriod, toPeriod, fiscalYear, ) {
        //     const Navigation = await sap.ushell.Container.getServiceAsync("Navigation");
        //     const sHref = await Navigation.getHref({
        //         target: {
        //             semanticObject: "GLAccount", // 실제 등록된 Semantic Object로 변경
        //             action: "displayGLLineItemReportingView"
        //         },
        //         params: {
        //             GLAccount: glAccount,
        //             CompanyCode: companyCode,
        //             FiscalPeriod: `BT${fromPeriod}..${toPeriod}`,
        //             FiscalYear: fiscalYear,
        //         }
        //     });
        //     sap.m.URLHelper.redirect(window.location.href.split('#')[0] + sHref, true);
        // }
        _navigateToJournalEntry: function (glAccount, companyCode, fromPeriod, toPeriod, fiscalYear) {

            // URL에 전달할 필터 객체를 생성합니다.
            const oFilter = {
                FiscalPeriod: {  // ✅ 키를 'FiscalPeriod'로 수정
                    ranges: [{
                        exclude: false,
                        operation: 'BT', // 'Between' 연산자
                        value1: fromPeriod,
                        value2: toPeriod
                    }],
                    items: []
                }
            };

            // URL 매개변수들을 정의하고, 값을 URL 인코딩합니다.
            const sShellHash = `#GLAccount-displayGLLineItemReportingView?` +
                `GLAccount=${encodeURIComponent(glAccount)}&` +
                `CompanyCode=${encodeURIComponent(companyCode)}&` +
                `FiscalYear=${encodeURIComponent(fiscalYear)}&` +
                `FiscalPeriod=${encodeURIComponent(JSON.stringify(oFilter.LedgerFiscalPeriod))}`; // ✅ 여기에 맞춰져야 함

            // 생성된 URL로 이동
            sap.m.URLHelper.redirect(window.location.href.split('#')[0] + sShellHash, true);
        }


    });
});
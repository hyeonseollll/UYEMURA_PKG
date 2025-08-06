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
            this._collapsedNodes = new Set();           // 닫은 노드 기억
            this._bInitialExpandDone = false;

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

        onAfterRendering: function () {
            let oTable = this.byId(Control.Table.T_Main);

            if (oTable && typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse(this.onCollapse.bind(this));
                oTable.attachExpand(this.onExpand.bind(this));
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
            const oContext = oEvent.getParameter("rowContext");
            const oData = oContext?.getObject();
            const sKey = this._getNodeKey(oData);
            this._collapsedNodes.add(sKey);
        },

        onExpand: function (oEvent) {
            const oContext = oEvent.getParameter("rowContext");
            const oData = oContext?.getObject();
            const sKey = this._getNodeKey(oData);
            this._collapsedNodes.delete(sKey);
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

        _onTreeTableReceived: function () {
            const oTable = this.byId(Control.Table.T_Main);
            oTable.setBusy(false);

            const aContexts = oTable.getBinding("rows").getContexts(0, oTable.getBinding("rows").getLength());

            if (!this._bInitialExpandDone) {
                // 최초 실행 시 4레벨까지 모두 펼침
                oTable.expandToLevel(4);
                this._bInitialExpandDone = true;
                return;
            }

            // 이후엔 닫은 노드는 절대 다시 열리지 않음
            aContexts.forEach((oContext, iIndex) => {
                const oRowData = oContext.getObject();
                const sKey = this._getNodeKey(oRowData);
                const isCollapsed = this._collapsedNodes?.has(sKey);

                if (!isCollapsed && oRowData.HierarchyLevel < 4 && oRowData.DrillState === "expanded") {
                    try {
                        oTable.expand(iIndex);
                    } catch (e) {
                        console.warn("Expand failed at", iIndex, e);
                    }
                }
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

            aCols.push({
                label: this.i18n.getText("PeriodBalance"), // "당기 금액"
                type: EdmType.Number,
                property: 'PeriodBalance',
                unitProperty: 'CompanyCodeCurrency',
                width: 20
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
        _getNodeKey: function (oData) {
            return oData?.Node || `${oData?.GlAccount}_${oData?.HierarchyLevel}_${oData?.NodeText}`;
        }




    });
});
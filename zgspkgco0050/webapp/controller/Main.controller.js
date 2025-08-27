sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "com/worldex/co/zworldexco0013/model/models",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    'sap/ui/export/library',
    'sap/ui/export/Spreadsheet',
], (Controller, Model, Filter, FilterOperator, exportLibrary, Spreadsheet) => {
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

    return Controller.extend("com.worldex.co.zworldexco0013.controller.Main", {
        /******************************************************************
             * Life Cycle
             ******************************************************************/
        onInit: function () {
            // i18n Init
            this.i18n = this.getOwnerComponent().getModel("i18n").getResourceBundle();

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

        /******************************************************************
         * Event Listener
         ******************************************************************/
        onSearch: function (oEvent) {
            var oRunTypeCK = this.byId("IP_RunType").getValue()
            if (!oRunTypeCK) {
                sap.m.MessageToast.show("런타입을 입력하세요");
                return;
            }
            let oTable = this.getView().byId(Control.Table.T_Main);
            oTable.unbindRows(); // 바인딩된 해제
            this._bindTable(oTable);

        },

        onExport: function () {
            let oBExcel = this.getView().byId(Control.Button.B_Excel);
            oBExcel.setBusy(true);

            let oTreeTable = this.getView().byId(Control.Table.T_Main);
            let oRowBinding = oTreeTable.getBinding('rows');

            this.getView().getModel().read('/Main/$count', {
                urlParameters: this._makeURL(oRowBinding.sFilterParams),
                success: function (oResult) {
                    this.count = oResult;
                    this.getView().getModel().read('/Main', {
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


        /******************************************************************
         * Private Function
         ******************************************************************/
        _bindTable: function (oTable) {
            console.log(oTable);
            oTable.bindRows({
                path: "/Main",
                filters: this._getTableFilter(),
                parameters: {
                    countMode: "Inline",
                    operationMode: "Server",
                    treeAnnotationProperties: {
                        hierarchyLevelFor: "HierarchyLevel",
                        hierarchyNodeFor: "NodeID",
                        hierarchyParentNodeFor: "ParentNodeID",
                        hierarchyDrillStateFor: "DrillState"
                    },
                    rootLevel: 2
                },
                events: {
                    dataRequested: this._onTreeTableRequested.bind(this),
                    dataReceived: this._onTreeTableReceived.bind(this),
                }
            });
        },

        _onTreeTableRequested: function () {
            let oTable = this.getView().byId(Control.Table.T_Main);
            oTable.setBusy(true);
        },

        _onTreeTableReceived: function () {
            let oTable = this.getView().byId(Control.Table.T_Main);
            // oTable.expandToLevel(5);
            var aIndices = oTable.getBinding("rows").getContexts(0, oTable.getBinding("rows").getLength());

            aIndices.forEach(function (oContext, iIndex) {
                var oRowData = oContext.getObject();

                if (oRowData.DrillState === "expanded") {
                    // 중요: index는 바뀔 수 있어서 안전하게 context 기반으로 처리해야 하나,
                    // 간단하게는 index로 처리 가능
                    try {
                        oTable.expand(iIndex);
                    } catch (e) {
                        console.warn("Expand failed at index", iIndex, e);
                    }
                }
            });
            
            oTable.setBusy(false);
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
            let oSearch = this.getView().getModel("Search").getData();
            console.log(oSearch);
            let aFilter = [];

            let oFilterToYear = new Filter({
                path: "P_TOYEAR",
                operator: FilterOperator.EQ,
                value1: oSearch.ToDate.getFullYear(),
            });

            let oFilterToMonth = new Filter({
                path: "P_TOMONTH",
                operator: FilterOperator.EQ,
                value1: (oSearch.ToDate.getMonth() + 1 + "").padStart(3, '0'),
            });

            let oFilterCheckGL = new Filter({
                path: "P_CHEKGL",
                operator: FilterOperator.EQ,
                value1: oSearch.CheckGL,
            });

            let oFilterCompanyCode = new Filter({
                path: "P_COMPCD",
                operator: FilterOperator.EQ,
                value1: oSearch.CompanyCode,
            });

            let oFilterRunType = new Filter({
                path: "P_RUNTYPE",
                operator: FilterOperator.EQ,
                value1: oSearch.RunType,
            });

            aFilter.push(oFilterToYear);
            aFilter.push(oFilterToMonth);
            aFilter.push(oFilterCheckGL);
            aFilter.push(oFilterCompanyCode);
            aFilter.push(oFilterRunType);

            return aFilter;
        },

        _createColumnConfig: function () {
            var aCols = [];

            /* 1. SubjectText */
            aCols.push({
                label: this.i18n.getText("SubjectText"),
                type: EdmType.String,
                property: 'SubjectText',
                width: 29,
                wrap: true
            });

            aCols.push({
                label: this.i18n.getText("GlAccount"),
                type: EdmType.String,
                property: 'GlAccount',
                width: 12.5
            });

            aCols.push({
                label: this.i18n.getText("GlAccountText"),
                type: EdmType.String,
                property: 'GlAccountText',
                width: 32
            });

            aCols.push({
                label: this.i18n.getText("AmountInCompanyCodeCurrency"),
                type: EdmType.Currency,
                property: 'AmountInCompanyCodeCurrency',
                unitProperty: 'CompanyCodeCurrency',
                displayUnit: false,
                width: 32
            });

            /* 4. Add a simple Decimal column */
            aCols.push({
                label: this.i18n.getText("CompanyCodeCurrency"),
                type: EdmType.String,
                property: 'CompanyCodeCurrency',
            });

            return aCols;
        },

        _makeURL: function (sFilterParams, icount) {
            let sfilters = decodeURI(sFilterParams);
            let ofilters = {
                "$filter": sfilters.substring(1, sfilters.length - 1)
            };
            if (icount) {
                _.set(ofilters, "$top", icount);
            }
            return ofilters;
        }
    });
});
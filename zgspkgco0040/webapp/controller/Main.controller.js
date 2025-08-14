sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "com/gsitm/pkg/co/zgspkgco0040/model/models",
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

    return Controller.extend("com.gsitm.pkg.co.zgspkgco0040.controller.Main", {
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

        onAfterRendering: function () {
            const oTable = this.byId(Control.Table.T_Main);
            if (!oTable) return;
            if (typeof oTable.attachCollapse === "function") {
                oTable.attachCollapse((e) => {
                    const ctx = e.getParameter("rowContext");
                    if (!ctx) return;
                    const id = ctx.getProperty("NodeID");
                    this._collapsedNodes = this._collapsedNodes || new Set();
                    this._collapsedNodes.add(id);
                });
                oTable.attachExpand((e) => {
                    const ctx = e.getParameter("rowContext");
                    if (!ctx) return;
                    const id = ctx.getProperty("NodeID");
                    this._collapsedNodes = this._collapsedNodes || new Set();
                    this._collapsedNodes.delete(id);
                });
            }
        },


        onExport: function () {
            let oBExcel = this.getView().byId(Control.Button.B_Excel);
            oBExcel.setBusy(true);

            let oTreeTable = this.getView().byId(Control.Table.T_Main);
            let oRowBinding = oTreeTable.getBinding('rows');

            this.getView().getModel().read('/MfgCostStmt/$count', {
                urlParameters: this._makeURL(oRowBinding.sFilterParams),
                success: function (oResult) {
                    this.count = oResult;
                    this.getView().getModel().read('/MfgCostStmt', {
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

        onExpand: function () {
            const oTable = this.byId("T_Main");
            if (!oTable) return;
            oTable.setBusy(true);
            try { oTable.expandToLevel(20); } catch (e) { }
            this._collapsedNodes = new Set();
            this._bInitialExpandDone = true;
            this._busyUntilFullyExpanded(oTable, { idleMs: 250, stableRepeats: 2, timeoutMs: 15000 });
        },

        onCollapse: function () {
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


        /******************************************************************
         * Private Function
         ******************************************************************/
        _bindTable: function (oTable) {
            console.log(oTable);
            oTable.bindRows({
                path: "/MfgCostStmt",
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
            oTable.setBusy(true);
        },

        // _onTreeTableReceived: function () {
        //     let oTable = this.getView().byId(Control.Table.T_Main);
        //     // oTable.expandToLevel(5);
        //     var aIndices = oTable.getBinding("rows").getContexts(0, oTable.getBinding("rows").getLength());

        //     aIndices.forEach(function (oContext, iIndex) {
        //         var oRowData = oContext.getObject();

        //         if (oRowData.DrillState === "expanded") {
        //             // 중요: index는 바뀔 수 있어서 안전하게 context 기반으로 처리해야 하나,
        //             // 간단하게는 index로 처리 가능
        //             try {
        //                 oTable.expand(iIndex);
        //             } catch (e) {
        //                 console.warn("Expand failed at index", iIndex, e);
        //             }
        //         }
        //     });

        //     oTable.setBusy(false);
        // },
        _onTreeTableReceived: function () {
            const oTable = this.getView().byId(Control.Table.T_Main);
            const oBinding = oTable.getBinding("rows");
            oTable.setBusy(true);

            // 1) 서버가 준 DrillState 기준 초기 확장
            const ctxs = oBinding.getContexts(0, oBinding.getLength());
            ctxs.forEach((ctx, idx) => {
                const row = ctx.getObject();
                if (row && row.DrillState === "expanded") {
                    try { oTable.expand(idx); } catch (e) { }
                }
            });

            // 2) 사용자가 이전에 접었던 노드 강제 접기 (있을 때만)
            if (this._collapsedNodes && this._collapsedNodes.size) {
                ctxs.forEach((ctx, idx) => {
                    const row = ctx.getObject();
                    if (row && row.NodeID && this._collapsedNodes.has(row.NodeID)) {
                        try { oTable.collapse(idx); } catch (e) { }
                    }
                });
            }

            // 3) 안정화될 때까지 Busy 유지
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
                value1: oSearch.CompanyCode.split(" ")[0]
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
                ofilters["$top"] = icount;
            }
            return ofilters;
        },

        _busyUntilFullyExpanded: function (oTable, opts) {
            if (!oTable) return;
            const oBinding = oTable.getBinding("rows");
            if (!oBinding) { oTable.setBusy(false); return; }

            const cfg = Object.assign({ idleMs: 200, stableRepeats: 2, timeoutMs: 15000 }, opts || {});
            let lastLen = -1, stable = 0, timedOut = false, checkId = null;

            oTable.setBusy(true);

            const finish = () => {
                if (timedOut) return;
                oTable.detachRowsUpdated(onRowsUpdated);
                oTable.setBusy(false);
                clearTimeout(timeoutId);
            };

            const onRowsUpdated = () => {
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
                    if (stable >= cfg.stableRepeats) finish();
                }, cfg.idleMs);
            };

            const timeoutId = setTimeout(() => {
                timedOut = true;
                oTable.detachRowsUpdated(onRowsUpdated);
                oTable.setBusy(false);
            }, cfg.timeoutMs);

            oTable.attachRowsUpdated(onRowsUpdated);
            onRowsUpdated();
        },


    });
});
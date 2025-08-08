sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device",
    "sap/m/Link", // 🚩 Link 컨트롤 추가
    "sap/m/Text", // 🚩 Text 컨트롤 추가
    "sap/ui/model/type/Currency" // 🚩 Currency 타입 추가
],
    function (JSONModel, Device, Link, Text, Currency) {
        "use strict";

        let todate = new Date();

        let oSearchModel = {
            ToDate: todate,
            CheckGL: true,
            CompanyCode: '1000',
            RunType: ''
        };

        return {
            createDeviceModel: function () {
                var oModel = new JSONModel(Device);
                oModel.setDefaultBindingMode("OneWay");
                return oModel;
            },

            createSearchModel: function () {
                return new sap.ui.model.json.JSONModel({
                    CompanyCode: "4310 (한국우에무라)",
                });
            },

            createODataModel: function (sServiceUrl) {
                return new sap.ui.model.odata.v2.ODataModel(sServiceUrl, {
                    useBatch: false
                });
            },
            createDateRangeModel: function () {
                return new JSONModel({
                    priorStart: new Date(),
                    priorEnd: new Date(),
                    currentStart: new Date(),
                    currentEnd: new Date()
                });
            },

            readODataModel: function (sModelName, sEntitySet, mFilters, mSorters, mParams) {
                return new Promise(function (resolve, reject) {
                    const oModel = new sap.ui.model.odata.v2.ODataModel("/sap/opu/odata/sap/" + sModelName);
                    oModel.read("/" + sEntitySet, {
                        filters: mFilters,
                        sorters: mSorters,
                        urlParameters: mParams,
                        success: resolve,
                        error: reject
                    });
                });
            },

            // 🚩 이 부분을 추가합니다.
            getPeriodBalanceControl: function (sGlAccount, sPeriodBalance, sCurrency) {
                const oCurrencyType = new Currency({
                    showMeasure: false,
                    currencyCode: false
                });

                if (sGlAccount) {
                    return new Link({
                        text: oCurrencyType.formatValue([sPeriodBalance, sCurrency], "string"),
                        press: this.onPeriodBalancePress
                    });
                }

                return new Text({
                    text: oCurrencyType.formatValue([sPeriodBalance, sCurrency], "string")
                });
            }
        };
    });
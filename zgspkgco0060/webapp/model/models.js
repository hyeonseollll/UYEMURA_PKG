sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
],
    function (JSONModel, Device) {
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
                    priorStart: new Date(),      // 전기 시작
                    priorEnd: new Date(),        // 전기 종료
                    currentStart: new Date(),    // 당기 시작
                    currentEnd: new Date()       // 당기 종료
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
            }

        };


    });
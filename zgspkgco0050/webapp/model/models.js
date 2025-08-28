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
            /**
             * Provides runtime information for the device the UI5 app is running on as a JSONModel.
             * @returns {sap.ui.model.json.JSONModel} The device model.
             */
            createDeviceModel: function () {
                var oModel = new JSONModel(Device);
                oModel.setDefaultBindingMode("OneWay");
                return oModel;
            },
            createSearchModel: function () {
                return new sap.ui.model.json.JSONModel({
                    CompanyCode: "4310 (한국우에무라)",  
                    ToDate: new Date(),
                    RunType: "UY_ML",
                    CheckGL: true
                });
            }
        };

    });
sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/core/Fragment"
], function (MessageToast, Fragment) {
    'use strict';

    return {
        onExcelUpload: function (oEvent) {
            var oView = this.getView();
            if (!this.pDialog) {
                Fragment.load({
                    id: "excel_upload",
                    name: "com.gsitm.pkg.co.zgspkgco0020.ext.fragment.ExcelUpload",
                    type: "XML",
                    controller: this
                }).then((oDialog) => {
                    var oFileUploader = Fragment.byId("excel_upload", "uploadSet");
                    oFileUploader.removeAllItems();
                    this.pDialog = oDialog;
                    this.pDialog.open();
                })
                    .catch(error => alert(error.message));
            } else {
                var oFileUploader = Fragment.byId("excel_upload", "uploadSet");
                oFileUploader.removeAllItems();
                this.pDialog.open();
            }
        },
        onUploadSet: function (oEvent) {
            const oBundle = this.getView().getModel("i18n").getResourceBundle();

            // checking if excel file contains data or not
            if (!this.excelSheetsData.length) {
                // MessageToast.show("업로드할 파일을 선택해주세요.");
                MessageToast.show(oBundle.getText("excel.noFileSelected"));
                return;
            }

            var that = this;
            var oSource = oEvent.getSource();

            // creating a promise as the extension api accepts odata call in form of promise only
            var fnAddMessage = function () {
                return new Promise((fnResolve, fnReject) => {
                    that.callOdata(fnResolve, fnReject);
                });
            };

            var mParameters = {
                sActionLabel: oSource.getText() // or "Your custom text" 
            };
            // calling the oData service using extension api
            this.extensionAPI.securedExecution(fnAddMessage, mParameters);

            this.pDialog.close();

        },
        onTempDownload: function (oEvent) {
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oModel = this.getView().getModel();

            var oBuilding = oModel.getServiceMetadata().dataServices.schema[0].entityType.find(x => x.name === 'MaterialCateSegType');

            var propertyList = ['Sequence', 'Materialledgercategory', 'Materialledgercategorytext',];

            var excelColumnList = [];
            var colList = {};


            propertyList.forEach((value, index) => {
                let property = oBuilding.property.find(x => x.name === value);
                colList[property.extensions.find(x => x.name === 'label').value] = '';
            });
            excelColumnList.push(colList);

            // initialising the excel work sheet
            const ws = XLSX.utils.json_to_sheet(excelColumnList);
            // creating the new excel work book
            const wb = XLSX.utils.book_new();
            // set the file value
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            // download the created excel file
            XLSX.writeFile(wb, '수불부 자재원장 순번 기준정보.xlsx');

            // MessageToast.show("다운로드 중입니다...");
            MessageToast.show(oBundle.getText("excel.downloading"));
        },
        onCloseDialog: function (oEvent) {
            this.pDialog.close();
        },
        onBeforeUploadStart: function (oEvent) {
            console.log("File Before Upload Event Fired!!!")
            /* TODO: check for file upload count */
        },
        onUploadSetComplete: function (oEvent) {
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            var oFileUploader = Fragment.byId("excel_upload", "uploadSet");

            var oFile = oEvent.getParameter("item").getFileObject();
            oEvent.getSource().addItem(new sap.m.upload.UploadSetItem({ fileName: oFile.name, mediaType: oFile.type }))

            var reader = new FileReader();
            var that = this;

            this.excelSheetsData = [];

            reader.onload = (e) => {
                let xlsx_content = e.currentTarget.result;
                let workbook = XLSX.read(xlsx_content, { type: 'binary' });
                var excelData = XLSX.utils.sheet_to_row_object_array(workbook.Sheets["Sheet1"]);

                workbook.SheetNames.forEach(function (sheetName) {

                    that.excelSheetsData.push(XLSX.utils.sheet_to_row_object_array(workbook.Sheets[sheetName]));
                });
            };
            reader.readAsBinaryString(oFile);

            // MessageToast.show("업로드 되었습니다.");
            MessageToast.show(oBundle.getText("excel.uploaded"));
        },
        onItemRemoved: function (oEvent) {
            this.excelSheetsData = [];
        },
        callOdata: function (fnResolve, fnReject) {
            const oBundle = this.getView().getModel("i18n").getResourceBundle();

            //  intializing the message manager for displaying the odata response messages
            var oModel = this.getView().getModel();

            var payload = {};

            this.excelSheetsData[0].forEach((value, index) => {
                // setting the payload data
                payload = {
                    "Sequence": Number(value["순번"]),
                    "Materialledgercategory": String(value["자재원장"]),
                    "Materialledgercategorytext": String(value["자재원장범주텍스트"]),
                };
                // calling the odata service
                oModel.create("/MaterialCateSeg", payload, {
                    success: (result) => {
                        console.log(result);
                        var oMessageManager = sap.ui.getCore().getMessageManager();
                        var oMessage = new sap.ui.core.message.Message({
                            // message: "자재원장" + result.Materialledgercategory + "가 생성되었습니다.",
                            message: oBundle.getText("odata.materialcat.create.success", [result.Materialledgercategory]),
                            persistent: true, // create message as transition message
                            type: sap.ui.core.MessageType.Success
                        });
                        oMessageManager.addMessages(oMessage);
                        fnResolve();
                    },
                    error: fnReject
                });
            });
        }
    };
});
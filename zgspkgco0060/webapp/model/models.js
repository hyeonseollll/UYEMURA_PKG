/**
 * ===================================================================================
 * zgspkgco0060 - 재무제표 애플리케이션 모델 팩토리
 * ===================================================================================
 * 
 * 주요 기능:
 * - 다양한 JSON 모델 생성 (디바이스, 검색, 날짜범위 등)
 * - OData 모델 생성 및 관리
 * - 재무제표 관련 UI 컨트롤 생성 (Link, Text 등)
 * 
 * 작성자: GS ITM
 * 작성일: 2024
 * ===================================================================================
 */
sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device",
    "sap/m/Link", // Link 컨트롤 (클릭 가능한 링크)
    "sap/m/Text", // Text 컨트롤 (일반 텍스트)
    "sap/ui/model/type/Currency" // Currency 타입 (통화 포맷팅)
],
    function (JSONModel, Device, Link, Text, Currency) {
        "use strict";

        // 현재 날짜 기준으로 기본 검색 모델 생성
        let todate = new Date();

        // 기본 검색 조건 모델 구조
        let oSearchModel = {
            ToDate: todate,        // 기준일
            CheckGL: true,         // GL 계정 체크 여부
            CompanyCode: '1000',   // 회사 코드 (기본값)
            RunType: ''            // 실행 타입
        };

        return {
            /**
             * 디바이스 정보 모델 생성
             * @returns {sap.ui.model.json.JSONModel} 디바이스 정보가 포함된 JSON 모델
             */
            createDeviceModel: function () {
                var oModel = new JSONModel(Device);
                oModel.setDefaultBindingMode("OneWay");
                return oModel;
            },

            /**
             * 검색 조건 모델 생성
             * @returns {sap.ui.model.json.JSONModel} 기본 검색 조건이 설정된 JSON 모델
             */
            createSearchModel: function () {
                return new sap.ui.model.json.JSONModel({
                    CompanyCode: "4310 (한국우에무라)", // 기본 회사 코드
                });
            },

            /**
             * OData 모델 생성
             * @param {string} sServiceUrl OData 서비스 URL
             * @returns {sap.ui.model.odata.v2.ODataModel} OData v2 모델
             */
            createODataModel: function (sServiceUrl) {
                return new sap.ui.model.odata.v2.ODataModel(sServiceUrl, {
                    useBatch: false // 배치 처리 비활성화
                });
            },
            
            /**
             * 날짜 범위 모델 생성 (재무제표 비교 기간용)
             * @returns {sap.ui.model.json.JSONModel} 날짜 범위 정보가 포함된 JSON 모델
             */
            createDateRangeModel: function () {
                return new JSONModel({
                    priorStart: new Date(),    // 이전 기간 시작일
                    priorEnd: new Date(),      // 이전 기간 종료일
                    currentStart: new Date(),  // 현재 기간 시작일
                    currentEnd: new Date()     // 현재 기간 종료일
                });
            },

            /**
             * OData 모델에서 데이터 읽기 (Promise 기반)
             * @param {string} sModelName 모델명
             * @param {string} sEntitySet 엔티티셋명
             * @param {Array} mFilters 필터 배열
             * @param {Array} mSorters 정렬 배열
             * @param {Object} mParams URL 파라미터
             * @returns {Promise} 데이터 읽기 Promise
             */
            readODataModel: function (sModelName, sEntitySet, mFilters, mSorters, mParams) {
                return new Promise(function (resolve, reject) {
                    const oModel = new sap.ui.model.odata.v2.ODataModel("/sap/opu/odata/sap/" + sModelName);
                    oModel.read("/" + sEntitySet, {
                        filters: mFilters,      // 필터 조건
                        sorters: mSorters,      // 정렬 조건
                        urlParameters: mParams, // URL 파라미터
                        success: resolve,       // 성공 콜백
                        error: reject          // 실패 콜백
                    });
                });
            },
            
            /**
             * 기간 잔액 컨트롤 생성 (Link 또는 Text)
             * GL 계정이 있는 경우 클릭 가능한 Link로, 없는 경우 일반 Text로 생성
             * @param {string} sGlAccount GL 계정
             * @param {number} sPeriodBalance 기간 잔액
             * @param {string} sCurrency 통화 코드
             * @returns {sap.m.Link|sap.m.Text} 생성된 컨트롤
             */
            getPeriodBalanceControl: function (sGlAccount, sPeriodBalance, sCurrency) {
                // 통화 포맷팅 타입 설정
                const oCurrencyType = new Currency({
                    showMeasure: false,    // 측정 단위 표시 안함
                    currencyCode: false    // 통화 코드 표시 안함
                });

                // GL 계정이 있으면 클릭 가능한 Link 생성
                if (sGlAccount) {
                    return new Link({
                        text: oCurrencyType.formatValue([sPeriodBalance, sCurrency], "string"),
                        press: this.onPeriodBalancePress // 클릭 이벤트 핸들러
                    });
                }

                // GL 계정이 없으면 일반 Text 생성
                return new Text({
                    text: oCurrencyType.formatValue([sPeriodBalance, sCurrency], "string")
                });
            }
        };
    });
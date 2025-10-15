/**
 * ===================================================================================
 * zgspkgco0060 - 재무제표 애플리케이션 Component
 * ===================================================================================
 * 
 * 역할:
 * - UI5 애플리케이션의 메인 컴포넌트
 * - 모델 초기화 및 라우팅 설정
 * - 디바이스 모델 설정
 * 
 * 주요 모델:
 * - device: 디바이스 정보 모델
 * - i18n: 국제화 모델 (manifest.json에서 자동 설정)
 * - F_GLAccount_VH: GL 계정 Value Help 모델 (manifest.json에서 자동 설정)
 * - mainService: 재무제표 OData 모델 (manifest.json에서 자동 설정)
 * 
 * 작성자: GS ITM
 * 작성일: 2024
 * ===================================================================================
 */
sap.ui.define([
    "sap/ui/core/UIComponent",
    "com/gsitm/pkg/co/zgspkgco0060/model/models"
], (UIComponent, models) => {
    "use strict";

    return UIComponent.extend("com.gsitm.pkg.co.zgspkgco0060.Component", {
        /**
         * 컴포넌트 메타데이터 정의
         */
        metadata: {
            manifest: "json",  // manifest.json 파일 사용
            interfaces: [
                "sap.ui.core.IAsyncContentCreation" // 비동기 콘텐츠 생성 인터페이스
            ]
        },

        /**
         * 컴포넌트 초기화 함수
         * 
         * 초기화 순서:
         * 1. 부모 컴포넌트 초기화
         * 2. 디바이스 모델 설정
         * 3. 라우팅 초기화
         */
        init() {
            // 부모 컴포넌트의 초기화 함수 호출
            UIComponent.prototype.init.apply(this, arguments);

            // 디바이스 정보 모델 설정 (반응형 UI용)
            this.setModel(models.createDeviceModel(), "device");

            // 라우팅 초기화 (manifest.json의 routing 설정 활성화)
            this.getRouter().initialize();
        }
    });
});
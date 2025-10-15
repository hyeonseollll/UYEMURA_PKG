# zgspkgco0060 - 재무제표 애플리케이션

## 프로젝트 개요

**zgspkgco0060**은 SAP Fiori 기반의 재무제표 조회 및 분석 애플리케이션입니다.

### 주요 기능
-  **재무제표 데이터 조회**: 계정별/기간별 재무 데이터 표시
-  **GL 계정 검색**: 계정과목 검색 및 필터링 기능
-  **기간 비교**: 이전 기간 대비 현재 기간 비교 분석
-  **Excel 내보내기**: 조회 결과를 Excel 파일로 내보내기
-  **북마크 기능**: 검색 조건 저장 및 복원
-  **트리 구조**: 계정과목의 계층 구조 표시

## 시스템 아키텍처

### 기술 스택
- **Frontend**: SAP UI5 1.130.11
- **Framework**: SAP Fiori
- **Language**: JavaScript (ES6+)
- **Data Source**: OData v2
- **Theme**: sap_horizon

### 데이터 소스
- **ZSB_FISTATEMENTS_UI_O2**: 재무제표 메인 OData 서비스
- **F_GLAccount_VH**: GL 계정 Value Help 서비스
- **ZSB_FISTATEMENTS_UI_O2_VAN**: OData 어노테이션 서비스

## 프로젝트 구조

```
zgspkgco0060/
├── webapp/
│   ├── controller/
│   │   ├── App.controller.js          # 애플리케이션 레벨 컨트롤러
│   │   └── Main.controller.js         # 메인 화면 컨트롤러 (6,764 라인)
│   ├── model/
│   │   └── models.js                  # 모델 팩토리 및 유틸리티
│   ├── view/
│   │   ├── App.view.xml               # 애플리케이션 루트 뷰
│   │   └── Main.view.xml              # 메인 화면 뷰
│   ├── i18n/
│   │   ├── i18n.properties            # 한국어 리소스
│   │   └── i18n_ja.properties         # 일본어 리소스
│   ├── formatter/
│   │   └── formatter.js               # 데이터 포맷터
│   ├── fragment/
│   │   └── GLAccount.fragment.xml     # GL 계정 선택 프래그먼트
│   ├── css/
│   │   └── style.css                  # 커스텀 스타일
│   ├── libs/
│   │   └── xlsx.full.min.js           # Excel 라이브러리
│   ├── localService/
│   │   └── mainService/               # Mock 서비스 (개발용)
│   ├── test/                          # 테스트 파일들
│   ├── Component.js                   # 메인 컴포넌트
│   ├── manifest.json                  # 애플리케이션 설정
│   └── index.html                     # 진입점
├── package.json                       # NPM 패키지 설정
└── README.md                          # 이 파일
```

## 주요 화면 구성

### 1. 필터 영역
- **회사 코드**: 기본값 "4310 (한국우에무라)"
- **이전 기간**: 비교 기준 기간 설정
- **현재 기간**: 비교 대상 기간 설정
- **회계연도**: 회계연도 설정

### 2. GL 계정 검색
- **MultiInput**: GL 계정 코드 입력
- **Value Help**: GL 계정 검색 팝업
- **토큰**: 선택된 GL 계정 표시

### 3. 결과 테이블
- **트리 구조**: 계정과목 계층 표시
- **기간별 잔액**: 이전/현재 기간 잔액 비교
- **클릭 가능**: 상세 계정 클릭 시 드릴다운

## 주요 기능 상세

### GL 계정 관리
```javascript
// GL 계정 데이터 구조
this._glDict = {};              // GL 계정 정보 딕셔너리
this._glKeys = new Set();       // GL 계정 키 세트
this._glAllLoaded = false;      // 전체 GL 데이터 로드 완료 플래그
this._glSelKeys = new Set();    // 선택된 GL 계정 키들
```

### 북마크 기능
```javascript
// 북마크 관련 상수
const BM_KEY = "zgspkgco0060.bookmarks.v1";
const BOOKMARK = {
    headSet: "/BookMark_Head",      // 북마크 헤더 엔티티셋
    itemSet: "/BookMark_Item",      // 북마크 아이템 엔티티셋
    headToItemsNav: "to_Items"      // 헤더→아이템 네비게이션
};
```



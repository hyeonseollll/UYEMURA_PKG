// 경로: com/gsitm/pkg/co/zgspkgco0060/formatter/formatter.js
sap.ui.define([], function () {
    "use strict";
    const EPS = 1e-9;

    function toNumberSafe(v) {
        if (v === null || v === undefined) return NaN;
        if (typeof v === "number") return v;
        if (typeof v === "string") {
            let s = v.trim();
            if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1); // (1,234) -> -1234
            s = s.replace(/,/g, "");
            const n = Number(s);
            return isNaN(n) ? NaN : n;
        }
        return NaN;
    }
    function toNumberSafe(v) {
        if (v === null || v === undefined) return NaN;
        if (typeof v === "number") return v;
        const s = String(v).replace(/,/g, "");
        const n = parseFloat(s);
        return isNaN(n) ? NaN : n;
    }

    return {

        multiplyByHundredth: function (vValue) {
            if (!vValue && vValue !== 0) return "";
            return (parseFloat(vValue) / 100).toFixed(2);
        },
        multiplyByHundredth2: function (vValue) {
            if (!vValue && vValue !== 0) return "";
            return (parseFloat(vValue) / 100).toFixed(4);
        },
        // 0이면 공백, 아니면 표시 (통화코드는 별도 컬럼)
        hideZeroCurrency: function (amount, curr) {
            // 만약 XML에서 parts 순서를 실수했다면 자동 보정
            // (amount가 숫자가 아니고 curr가 숫자면 swap)
            let a = toNumberSafe(amount);
            const b = toNumberSafe(curr);
            if (isNaN(a) && !isNaN(b)) a = b;

            if (isNaN(a)) return "";                 // 변환 실패 시 빈값
            if (Math.abs(a) < EPS) return "";        // 0 → 빈값

            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 0,
                maxFractionDigits: 3
            });
            return nf.format(a);
        },
        // ▶ 0이면 "", 아니면 소수 0~4 자리로 표시 (나누기 없음)
        hideZeroNumber4: function (value) {
            const n = toNumberSafe(value);
            if (isNaN(n)) return "";
            // 소수 4자리 기준으로 0 판정
            if (Math.round(n * 10000) === 0) return "";
            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 4,
                maxFractionDigits: 4
            });
            return nf.format(n);
        },
        hideZeroNumber2: function (value) {
            const n = toNumberSafe(value);
            if (isNaN(n)) return "";

            // 0일 때만 "0.00" 고정 출력
            if (Math.abs(n) < EPS) {
                return "0.00";
            }

            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 2,
                maxFractionDigits: 2
            });
            return nf.format(n);
        },

        hideAbsDiffIfBsPl: function (absDiff, parentId) {
            // 절대차이가 숫자 0이고, ParentNodeID가 BS/PL이면 빈칸
            if (Number(absDiff) === 0 && (parentId === "BS" || parentId === "PL")) {
                return "";
            }
            // 그 외에는 원래 값 유지 (필요 시 포맷 추가 가능)
            return absDiff;
        },

        formatAbsDiff: function (absDiff, parentId) {
            const n = toNumberSafe(absDiff);
            if (isNaN(n)) return "";

            const isZero4 = Math.round(n * 10000) === 0;

            // 포맷터 (소수 4자리 고정, 천단위 구분)
            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 4,
                maxFractionDigits: 4
            });

            // BS / PL 이면 → 0은 빈칸
            if (parentId === "BS" || parentId === "PL") {
                return isZero4 ? "" : nf.format(n);
            }

            // 그 외에는 0도 "0.0000" 로 표시
            return nf.format(n);
        }


    }
});

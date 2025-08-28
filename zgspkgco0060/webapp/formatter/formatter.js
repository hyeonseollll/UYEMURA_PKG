// 경로: com/gsitm/pkg/co/zgspkgco0060/formatter/formatter.js
sap.ui.define([], function () {
    "use strict";
    const EPS = 1e-9;

    function approx(a, b) {
        // 상대/절대 혼합 허용 오차
        return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-6);
    }

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
        },
        formatAbsDiffNumber: function (absDiff, parentId) {
            const n = toNumberSafe(absDiff);
            if (isNaN(n)) return "";

            // BS/PL인 경우 0 → 빈칸
            if ((parentId === "BS" || parentId === "PL") && Math.abs(n) < EPS) {
                return "";
            }

            // 0이면 "0.00" 고정
            if (Math.abs(n) < EPS) {
                return "0.00";
            }

            // 일반 포맷 (천단위 구분, 소수 2자리~2자리)
            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 2,
                maxFractionDigits: 2
            });
            return nf.format(n);
        },

        // 0도 반드시 0.00, BS/PL에서는 0이면 빈칸(원하시면 이 줄 삭제)
        currencyHideZeroForBsPl: function (amount, curr, nodeText) {
            const n = toNumberSafe(amount);
            if (isNaN(n)) return "";

            // BS/PL이고 0이면 숨김 (원치 않으면 이 블록 제거)
            if ((nodeText === "BS" || nodeText === "PL") && Math.abs(n) < 1e-9) {
                return "";
            }

            const nf = sap.ui.core.format.NumberFormat.getCurrencyInstance({
                showMeasure: false,
                currencyDigits: false,      // ★ 통화 기본 자릿수 무시
                minFractionDigits: 2,       // ★ 항상 둘째 자리까지
                maxFractionDigits: 2
            });

            return nf.format ? nf.format(n, curr) : nf.formatValue([n, curr], "string");
        },

        absDiffFixed2AutoScale: function (v, curr, parentId, period, comparison) {
            let n = toNumberSafe(v);
            const p = toNumberSafe(period);
            const c = toNumberSafe(comparison);
            if (isNaN(n)) return "";

            // 기대 차이(부호 포함)
            if (!isNaN(p) && !isNaN(c)) {
                const expected = p - c;
                const absExp = Math.abs(expected);
                const absN = Math.abs(n);

                // /100 로 들어온 경우
                if (approx(absN, absExp / 100)) {
                    n = Math.sign(expected) * Math.abs(n * 100);
                } else if (approx(absN, absExp)) {
                    n = Math.sign(expected) * Math.abs(n); // 부호만 보정
                }
            }

            // BS/PL인 경우
            if (parentId === "BS" || parentId === "PL") {
                if (Math.abs(n) < EPS) return ""; // 0은 빈칸
            } else {
                if (Math.abs(n) < EPS) {
                    // 그 외 노드일 때 0은 "0.00"
                    const nf0 = sap.ui.core.format.NumberFormat.getFloatInstance({
                        groupingEnabled: true,
                        minFractionDigits: 2,
                        maxFractionDigits: 2
                    });
                    return nf0.format(0);
                }
            }

            // 비-제로 포맷
            const nf = sap.ui.core.format.NumberFormat.getFloatInstance({
                groupingEnabled: true,
                minFractionDigits: 2,
                maxFractionDigits: 2
            });
            return nf.format(n);
        },

    }
});

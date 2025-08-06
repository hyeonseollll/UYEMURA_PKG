// 경로: com/gsitm/pkg/co/zgspkgco0060/formatter/formatter.js
sap.ui.define([], function () {
    "use strict";
    return {

        multiplyByHundredth: function (vValue) {
            if (!vValue && vValue !== 0) return "";
            return (parseFloat(vValue) / 100).toFixed(1);
        }

    };
});

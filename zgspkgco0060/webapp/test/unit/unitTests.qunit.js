/* global QUnit */
QUnit.config.autostart = false;

sap.ui.getCore().attachInit(function () {
	"use strict";

	sap.ui.require([
		"com/gsitm/pkg/co/zgspkgco0060/test/unit/AllTests"
	], function () {
		QUnit.start();
	});
});

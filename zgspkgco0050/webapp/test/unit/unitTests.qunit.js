/* global QUnit */
QUnit.config.autostart = false;

sap.ui.getCore().attachInit(function () {
	"use strict";

	sap.ui.require([
		"com/gspkg/co/zgspkgco0050/test/unit/AllTests"
	], function () {
		QUnit.start();
	});
});

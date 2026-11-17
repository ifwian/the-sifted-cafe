'use strict';
// Public health/config endpoint: GET /api/config
// Kept as its own single-segment function so deployment checks can still open
// /api/config directly. The website itself calls /api/router?__path=config.
const { handle } = require('../lib/routes');

module.exports = (req, res) => handle(req, res);

'use strict';
// Vercel serverless function: every request to /api/* lands here and is routed in lib/routes.js.
const { handle } = require('../lib/routes');

module.exports = (req, res) => handle(req, res);

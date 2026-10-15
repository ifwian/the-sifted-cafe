// Vercel entry point for every /api/... request (/api/health, /api/config,
// /api/auth/login, /api/reservations, ...).
// The file name "[...path]" tells Vercel to send all the remaining path
// segments after /api to this function. Because Vercel matches the file
// before the request reaches the code, Express still receives the ORIGINAL
// path, so the routes in server/server.js and server/routes/ match exactly
// as they do when you run "npm start" on your own computer.
// (No rewrite rule is needed in vercel.json because of this file.)
module.exports = require('../server/server').app;
// Vercel entry point for the path /api.
// Vercel turns every file in the /api folder into a serverless function.
// It reuses the Express app from server/server.js, which only starts listening
// when you run "npm start", so importing it here is safe.
module.exports = require('../server/server').app;
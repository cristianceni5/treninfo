// netlify/functions/api.js
const serverless = require('serverless-http');
const app = require('../../src/app');

// Diciamo a serverless-http qual è il "prefisso" da togliere
exports.handler = serverless(app, {
  basePath: '/.netlify/functions/api',
});

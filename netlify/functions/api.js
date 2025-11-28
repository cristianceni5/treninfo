//Developed by Cristian Ceni 2025 dhn

// netlify/functions/api.js
const serverless = require('serverless-http');
const app = require('../../src/app');

exports.handler = serverless(app);

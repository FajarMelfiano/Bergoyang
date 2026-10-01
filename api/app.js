'use strict';

/**
 * Titik masuk serverless Vercel — satu fungsi untuk semua rute
 * (halaman statis, /api/*, audio) berkat rewrite di vercel.json.
 * Logika tetap di server.js; di sini hanya diteruskan.
 */
const { handleRequest } = require('../server');

module.exports = handleRequest;

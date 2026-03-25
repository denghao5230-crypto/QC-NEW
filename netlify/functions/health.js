const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  try {
    const sql = getDb();
    await sql`SELECT 1`;
    return jsonResponse({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    return errorResponse('Database offline: ' + e.message, 503);
  }
};

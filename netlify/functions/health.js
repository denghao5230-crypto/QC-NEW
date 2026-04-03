const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  try {
    const supabase = getDb();
    // 简单查询测试连接
    const { error } = await supabase.from('users').select('username').limit(1);
    if (error) throw error;
    return jsonResponse({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    return errorResponse('Database offline: ' + e.message, 503);
  }
};

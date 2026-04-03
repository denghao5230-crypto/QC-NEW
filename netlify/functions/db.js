// 共享数据库连接模块 — Supabase
const { createClient } = require('@supabase/supabase-js');

let _supabase = null;

function getDb() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL 或 SUPABASE_KEY 环境变量未设置');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// CORS 响应头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

// 快捷响应
function jsonResponse(data, statusCode = 200) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function errorResponse(message, statusCode = 400) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

// OPTIONS 预检请求
function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  return null;
}

module.exports = { getDb, CORS_HEADERS, jsonResponse, errorResponse, handleCors };

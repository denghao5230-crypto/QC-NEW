// 共享数据库连接模块
const { neon } = require('@neondatabase/serverless');

let _sql = null;

function getDb() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL 环境变量未设置');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
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

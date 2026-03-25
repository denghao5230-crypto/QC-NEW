const bcrypt = require('bcryptjs');
const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');

// 简单的管理密钥验证（防止任意注册）
const ADMIN_KEY = process.env.ADMIN_KEY || 'senia-admin-2024';

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { username, password, name, role, adminKey } = JSON.parse(event.body || '{}');

    // 验证管理密钥
    if (adminKey !== ADMIN_KEY) {
      return errorResponse('管理密钥错误', 403);
    }

    if (!username || !password || !name || !role) {
      return errorResponse('请填写所有字段');
    }

    if (!['inspector', 'supervisor'].includes(role)) {
      return errorResponse('角色无效，必须是 inspector 或 supervisor');
    }

    if (password.length < 4) {
      return errorResponse('密码至少4位');
    }

    const sql = getDb();

    // 检查用户名是否已存在
    const existing = await sql`SELECT username FROM users WHERE username = ${username}`;
    if (existing.length > 0) {
      return errorResponse('用户名已存在');
    }

    // bcrypt 哈希密码
    const hash = await bcrypt.hash(password, 10);

    await sql`
      INSERT INTO users (username, name, role, password_hash)
      VALUES (${username}, ${name}, ${role}, ${hash})
    `;

    return jsonResponse({ success: true, username, name, role });

  } catch (e) {
    console.error('Register error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

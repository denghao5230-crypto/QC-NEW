const bcrypt = require('bcryptjs');
const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');
const { signToken } = require('./auth');

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return errorResponse('请输入用户名和密码');
    }

    const sql = getDb();
    const rows = await sql`
      SELECT username, name, role, password_hash
      FROM users WHERE username = ${username}
    `;

    if (rows.length === 0) {
      return errorResponse('用户名或密码错误', 401);
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return errorResponse('用户名或密码错误', 401);
    }

    // 生成 JWT Token
    const token = signToken({
      username: user.username,
      name: user.name,
      role: user.role,
    });

    return jsonResponse({
      username: user.username,
      name: user.name,
      role: user.role,
      token,
    });

  } catch (e) {
    console.error('Login error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

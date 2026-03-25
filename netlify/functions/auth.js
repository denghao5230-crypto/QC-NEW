// JWT 认证中间件
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'senia-inspection-default-secret-change-me';
const JWT_EXPIRES = '7d'; // Token 有效期 7 天

/**
 * 生成 JWT Token
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/**
 * 验证 JWT Token
 * @param {string} authHeader - Authorization header value ("Bearer xxx")
 * @returns {{ valid: boolean, user?: object, error?: string }}
 */
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: '缺少认证令牌' };
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      valid: true,
      user: {
        username: decoded.username,
        role: decoded.role,
        name: decoded.name,
      }
    };
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return { valid: false, error: '令牌已过期，请重新登录' };
    }
    return { valid: false, error: '无效的认证令牌' };
  }
}

module.exports = { signToken, verifyToken };

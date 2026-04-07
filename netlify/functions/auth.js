// JWT 认证中间件
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d'; // Token 有效期 7 天

function getJwtSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < 16) {
    throw new Error('服务器配置错误：JWT_SECRET 未设置或过短');
  }
  return JWT_SECRET;
}

/**
 * 生成 JWT Token
 */
function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES });
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
    const decoded = jwt.verify(token, getJwtSecret());
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
    if (String(e.message || '').includes('JWT_SECRET')) {
      return { valid: false, error: e.message };
    }
    return { valid: false, error: '无效的认证令牌' };
  }
}

module.exports = { signToken, verifyToken };

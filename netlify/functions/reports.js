const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');
const { verifyToken } = require('./auth');

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  // ===== JWT 认证 =====
  const authResult = verifyToken(event.headers.authorization || event.headers.Authorization || '');
  if (!authResult.valid) {
    return errorResponse(authResult.error, 401);
  }
  const currentUser = authResult.user;

  const sql = getDb();
  const method = event.httpMethod;

  try {
    // GET /api/reports — 获取报告
    if (method === 'GET') {
      let rows;
      if (currentUser.role === 'supervisor') {
        // 主管可以看所有报告
        rows = await sql`
          SELECT id, data, status, created_by, created_at, updated_at
          FROM reports ORDER BY updated_at DESC
        `;
      } else {
        // 质检员只能看自己的报告
        rows = await sql`
          SELECT id, data, status, created_by, created_at, updated_at
          FROM reports WHERE created_by = ${currentUser.username}
          ORDER BY updated_at DESC
        `;
      }
      const reports = rows.map(row => {
        const report = row.data || {};
        report.id = row.id;
        report.status = row.status || report.status;
        report.createdBy = row.created_by || report.createdBy;
        // Strip base64 photo data from list response to avoid exceeding payload limits
        if (report.photos) {
          const photoKeys = Object.keys(report.photos);
          report._photoCount = photoKeys.length;
          report.photos = {};
          // Keep only a flag that photos exist, not the actual data
          photoKeys.forEach(k => { report.photos[k] = '__HAS_PHOTO__'; });
        }
        return report;
      });
      return jsonResponse(reports);
    }

    // POST /api/reports — 新建/更新报告 (upsert)
    if (method === 'POST') {
      const report = JSON.parse(event.body || '{}');
      if (!report.id) {
        return errorResponse('缺少报告ID');
      }

      // 检查权限：质检员只能修改自己的报告
      if (currentUser.role !== 'supervisor') {
        const existing = await sql`SELECT created_by FROM reports WHERE id = ${report.id}`;
        if (existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权修改此报告', 403);
        }
      }

      // 检查权限：只有主管可以审批/驳回
      if ((report.status === 'approved' || report.status === 'rejected') && currentUser.role !== 'supervisor') {
        return errorResponse('只有主管可以审批报告', 403);
      }

      await sql`
        INSERT INTO reports (id, data, status, created_by, updated_at)
        VALUES (
          ${report.id},
          ${JSON.stringify(report)},
          ${report.status || 'draft'},
          ${report.createdBy || currentUser.username},
          ${report.updatedAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO UPDATE SET
          data = ${JSON.stringify(report)},
          status = ${report.status || 'draft'},
          updated_at = ${report.updatedAt || new Date().toISOString()}
      `;

      return jsonResponse({ success: true, id: report.id });
    }

    // DELETE /api/reports?id=xxx — 永久删除
    if (method === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return errorResponse('缺少报告ID');
      }

      // 检查权限：质检员只能删除自己的报告
      if (currentUser.role !== 'supervisor') {
        const existing = await sql`SELECT created_by FROM reports WHERE id = ${id}`;
        if (existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权删除此报告', 403);
        }
      }

      await sql`DELETE FROM reports WHERE id = ${id}`;
      return jsonResponse({ success: true, deleted: id });
    }

    return errorResponse('Method not allowed', 405);

  } catch (e) {
    console.error('Reports error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

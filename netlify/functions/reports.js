const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');

exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  const sql = getDb();
  const method = event.httpMethod;

  try {
    // GET /api/reports — 获取所有报告
    if (method === 'GET') {
      const rows = await sql`
        SELECT id, data, status, created_by, created_at, updated_at
        FROM reports
        ORDER BY updated_at DESC
      `;
      const reports = rows.map(row => {
        const report = row.data || {};
        report.id = row.id;
        report.status = row.status || report.status;
        report.createdBy = row.created_by || report.createdBy;
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

      await sql`
        INSERT INTO reports (id, data, status, created_by, updated_at)
        VALUES (
          ${report.id},
          ${JSON.stringify(report)},
          ${report.status || 'draft'},
          ${report.createdBy || ''},
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

      await sql`DELETE FROM reports WHERE id = ${id}`;
      return jsonResponse({ success: true, deleted: id });
    }

    return errorResponse('Method not allowed', 405);

  } catch (e) {
    console.error('Reports error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

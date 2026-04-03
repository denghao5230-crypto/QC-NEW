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

  const supabase = getDb();
  const method = event.httpMethod;

  try {
    // GET /api/reports — 获取报告
    if (method === 'GET') {
      let query = supabase
        .from('reports')
        .select('id, data, status, created_by, created_at, updated_at')
        .order('updated_at', { ascending: false });

      // 质检员只能看自己的报告
      if (currentUser.role !== 'supervisor') {
        query = query.eq('created_by', currentUser.username);
      }

      const { data: rows, error } = await query;
      if (error) throw error;

      // Also fetch photo slot indices from the report_photos table
      let photoSlotMap = {};
      try {
        const { data: photoRows, error: photoErr } = await supabase
          .from('report_photos')
          .select('report_id, slot_index');

        if (!photoErr && photoRows) {
          photoRows.forEach(pr => {
            if (!photoSlotMap[pr.report_id]) photoSlotMap[pr.report_id] = [];
            photoSlotMap[pr.report_id].push(pr.slot_index);
          });
        }
      } catch (e) {
        // Table may not exist yet — ignore
        console.warn('report_photos table not available:', e.message);
      }

      const reports = (rows || []).map(row => {
        const report = row.data || {};
        report.id = row.id;
        report.status = row.status || report.status;
        report.createdBy = row.created_by || report.createdBy;

        // Merge photo indicators from both JSONB and report_photos table
        const photoFlags = {};
        // From JSONB (legacy)
        if (report.photos) {
          Object.keys(report.photos).forEach(k => {
            if (report.photos[k] && report.photos[k] !== '__HAS_PHOTO__') {
              photoFlags[k] = '__HAS_PHOTO__';
            }
          });
        }
        // From report_photos table (new)
        if (photoSlotMap[row.id]) {
          photoSlotMap[row.id].forEach(slot => {
            photoFlags[slot] = '__HAS_PHOTO__';
          });
        }

        report.photos = photoFlags;
        report._photoCount = Object.keys(photoFlags).length;
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
        const { data: existing } = await supabase
          .from('reports')
          .select('created_by')
          .eq('id', report.id);

        if (existing && existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权修改此报告', 403);
        }
      }

      // 检查权限：只有主管可以审批/驳回
      if ((report.status === 'approved' || report.status === 'rejected') && currentUser.role !== 'supervisor') {
        return errorResponse('只有主管可以审批报告', 403);
      }

      const { error } = await supabase
        .from('reports')
        .upsert({
          id: report.id,
          data: report,
          status: report.status || 'draft',
          created_by: report.createdBy || currentUser.username,
          updated_at: report.updatedAt || new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) throw error;

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
        const { data: existing } = await supabase
          .from('reports')
          .select('created_by')
          .eq('id', id);

        if (existing && existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权删除此报告', 403);
        }
      }

      const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return jsonResponse({ success: true, deleted: id });
    }

    return errorResponse('Method not allowed', 405);

  } catch (e) {
    console.error('Reports error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

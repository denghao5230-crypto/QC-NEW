const { getDb, jsonResponse, errorResponse, handleCors } = require('./db');
const { verifyToken } = require('./auth');

/**
 * 独立照片上传/下载端点
 * POST /api/photos — 上传单张照片 { reportId, slotIndex, dataUrl }
 * GET  /api/photos?reportId=xxx — 获取报告的所有照片
 * GET  /api/photos?reportId=xxx&slot=0 — 获取单张照片
 */
exports.handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;

  // JWT 认证
  const authResult = verifyToken(event.headers.authorization || event.headers.Authorization || '');
  if (!authResult.valid) {
    return errorResponse(authResult.error, 401);
  }
  const currentUser = authResult.user;
  const supabase = getDb();
  const method = event.httpMethod;

  try {
    // ===== GET: 获取照片 =====
    if (method === 'GET') {
      const reportId = event.queryStringParameters?.reportId;
      if (!reportId) return errorResponse('缺少 reportId');
      const slot = event.queryStringParameters?.slot;

      // 检查权限
      if (currentUser.role !== 'supervisor') {
        const { data: existing } = await supabase
          .from('reports')
          .select('created_by')
          .eq('id', reportId);

        if (existing && existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权查看此报告照片', 403);
        }
      }

      // 先尝试从photos表读取
      if (slot !== undefined && slot !== null) {
        const { data: rows, error } = await supabase
          .from('report_photos')
          .select('data_url')
          .eq('report_id', reportId)
          .eq('slot_index', parseInt(slot));

        if (!error && rows && rows.length > 0) {
          return jsonResponse({ dataUrl: rows[0].data_url });
        }

        // 回退：从报告JSONB中读取
        const { data: reportRows } = await supabase
          .from('reports')
          .select('data')
          .eq('id', reportId);

        if (reportRows && reportRows.length > 0) {
          const report = reportRows[0].data || {};
          const photo = report.photos?.[slot];
          if (photo && photo !== '__HAS_PHOTO__') {
            return jsonResponse({ dataUrl: photo });
          }
        }
        return jsonResponse({ dataUrl: null });
      }

      // 获取所有照片的slot列表（不含数据，避免超payload）
      const { data: rows } = await supabase
        .from('report_photos')
        .select('slot_index, data_url')
        .eq('report_id', reportId)
        .order('slot_index', { ascending: true });

      // 也检查JSONB中的照片
      const { data: reportRows } = await supabase
        .from('reports')
        .select('data')
        .eq('id', reportId);

      const reportPhotos = (reportRows && reportRows.length > 0) ? (reportRows[0].data?.photos || {}) : {};
      const slots = {};
      // 从photos表
      if (rows) {
        rows.forEach(r => {
          slots[r.slot_index] = { stored: true, size: r.data_url ? r.data_url.length : 0 };
        });
      }
      // 从JSONB（向后兼容）
      Object.keys(reportPhotos).forEach(k => {
        if (!slots[k] && reportPhotos[k] && reportPhotos[k] !== '__HAS_PHOTO__') {
          slots[k] = { stored: false, size: reportPhotos[k].length };
        }
      });
      return jsonResponse({ reportId, slots });
    }

    // ===== POST: 上传单张照片 =====
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { reportId, slotIndex, dataUrl } = body;
      if (!reportId) return errorResponse('缺少 reportId');
      if (slotIndex === undefined || slotIndex === null) return errorResponse('缺少 slotIndex');
      if (!dataUrl) return errorResponse('缺少 dataUrl');

      // 检查权限
      if (currentUser.role !== 'supervisor') {
        const { data: existing } = await supabase
          .from('reports')
          .select('created_by')
          .eq('id', reportId);

        if (existing && existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权修改此报告照片', 403);
        }
      }

      // 验证 dataUrl 格式：必须是真正的 base64 图片数据
      if (!dataUrl.startsWith('data:image/')) {
        return errorResponse('无效的照片数据格式，必须为 data:image/* 格式', 400);
      }

      // 检查dataUrl大小（单张最大1MB base64 ≈ 750KB图片）
      if (dataUrl.length > 1.5 * 1024 * 1024) {
        return errorResponse('单张照片过大，请压缩后重试', 413);
      }

      // Upsert到photos表
      const { error } = await supabase
        .from('report_photos')
        .upsert({
          report_id: reportId,
          slot_index: parseInt(slotIndex),
          data_url: dataUrl,
          uploaded_by: currentUser.username,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'report_id,slot_index' });

      if (error) throw error;

      return jsonResponse({ success: true, reportId, slotIndex });
    }

    // ===== DELETE: 删除照片 =====
    if (method === 'DELETE') {
      const reportId = event.queryStringParameters?.reportId;
      const slot = event.queryStringParameters?.slot;
      if (!reportId) return errorResponse('缺少 reportId');

      if (currentUser.role !== 'supervisor') {
        const { data: existing } = await supabase
          .from('reports')
          .select('created_by')
          .eq('id', reportId);

        if (existing && existing.length > 0 && existing[0].created_by !== currentUser.username) {
          return errorResponse('无权删除此报告照片', 403);
        }
      }

      if (slot !== undefined && slot !== null) {
        const { error } = await supabase
          .from('report_photos')
          .delete()
          .eq('report_id', reportId)
          .eq('slot_index', parseInt(slot));
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('report_photos')
          .delete()
          .eq('report_id', reportId);
        if (error) throw error;
      }
      return jsonResponse({ success: true });
    }

    return errorResponse('Method not allowed', 405);
  } catch (e) {
    console.error('Photos API error:', e);
    return errorResponse('服务器错误: ' + e.message, 500);
  }
};

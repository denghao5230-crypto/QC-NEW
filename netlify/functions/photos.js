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
    const code = String(authResult.error || '').includes('配置错误') ? 500 : 401;
    return errorResponse(authResult.error, code);
  }
  const currentUser = authResult.user;
  const supabase = getDb();
  const method = event.httpMethod;

  try {
    async function ensureReportAccess(reportId, actionText) {
      const { data: rows, error } = await supabase
        .from('reports')
        .select('id, created_by')
        .eq('id', reportId)
        .limit(1);
      if (error) throw error;
      if (!rows || rows.length === 0) {
        return { ok: false, response: errorResponse('报告不存在', 404) };
      }
      const owner = rows[0].created_by;
      if (currentUser.role !== 'supervisor' && owner !== currentUser.username) {
        return { ok: false, response: errorResponse(`无权${actionText}此报告照片`, 403) };
      }
      return { ok: true, owner };
    }

    // ===== GET: 获取照片 =====
    if (method === 'GET') {
      const reportId = event.queryStringParameters?.reportId;
      if (!reportId) return errorResponse('缺少 reportId');
      const slot = event.queryStringParameters?.slot;

      const access = await ensureReportAccess(reportId, '查看');
      if (!access.ok) return access.response;

      // 先尝试从photos表读取
      if (slot !== undefined && slot !== null) {
        const parsedSlot = parseInt(slot, 10);
        if (isNaN(parsedSlot) || parsedSlot < 0 || parsedSlot > 28) {
          return errorResponse('无效的 slot (0-28)', 400);
        }
        const { data: rows, error } = await supabase
          .from('report_photos')
          .select('data_url')
          .eq('report_id', reportId)
          .eq('slot_index', parsedSlot);

        if (!error && rows && rows.length > 0 && typeof rows[0].data_url === 'string' && rows[0].data_url.startsWith('data:image/')) {
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
          if (typeof photo === 'string' && photo.startsWith('data:image/')) {
            return jsonResponse({ dataUrl: photo });
          }
        }
        return jsonResponse({ dataUrl: null });
      }

      // 获取所有照片的slot列表（不含数据，避免超payload）
      const { data: rows } = await supabase
        .from('report_photos')
        .select('slot_index')
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
          slots[r.slot_index] = { stored: true };
        });
      }
      // 从JSONB（向后兼容）
      Object.keys(reportPhotos).forEach(k => {
        if (!slots[k] && typeof reportPhotos[k] === 'string' && reportPhotos[k].startsWith('data:image/')) {
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
      const parsedSlot = parseInt(slotIndex, 10);
      if (isNaN(parsedSlot) || parsedSlot < 0 || parsedSlot > 28) return errorResponse('无效的 slotIndex (0-28)', 400);
      if (!dataUrl) return errorResponse('缺少 dataUrl');

      const access = await ensureReportAccess(reportId, '修改');
      if (!access.ok) return access.response;

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
          slot_index: parsedSlot,
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
      const access = await ensureReportAccess(reportId, '删除');
      if (!access.ok) return access.response;

      if (slot !== undefined && slot !== null) {
        const parsedSlot = parseInt(slot, 10);
        if (isNaN(parsedSlot) || parsedSlot < 0 || parsedSlot > 28) {
          return errorResponse('无效的 slot (0-28)', 400);
        }
        const { error } = await supabase
          .from('report_photos')
          .delete()
          .eq('report_id', reportId)
          .eq('slot_index', parsedSlot);
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

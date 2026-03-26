// ===== PDF Generation Module =====
// Depends on: jsPDF, html2canvas, APP, INSPECT_ITEMS, PHOTO_SLOTS, escapeHtml, showToast, parseSizeNominals, evaluateDimension

/**
 * 尺寸判定 - 对比实测值与标准公差
 * @param {Array} values - 实测值数组
 * @param {string} stdStr - 标准字符串，如 "±0.5mm", "7±1°", "3~5"
 * @param {number|null} nominal - 标称值（从尺寸字段解析），gloss 无需传
 * @returns {{result: string, outOfSpec: boolean[]}}
 */
function evaluateDimensionForPDF(values, stdStr, nominal) {
  const filled = values.filter(v => v !== '' && v !== null && v !== undefined);
  if (filled.length === 0) return { result: '', outOfSpec: values.map(() => false) };

  const parsed = parseTolerance(stdStr);
  if (!parsed) return { result: 'PASS', outOfSpec: values.map(() => false) };

  const outOfSpec = [];
  let anyFail = false;

  for (const v of values) {
    if (v === '' || v === null || v === undefined) {
      outOfSpec.push(false);
      continue;
    }
    const num = parseFloat(v);
    if (isNaN(num)) { outOfSpec.push(false); continue; }

    let isOut = false;
    if (parsed.type === 'tolerance' && nominal != null) {
      // ±tolerance around nominal
      isOut = num < (nominal - parsed.tolerance) || num > (nominal + parsed.tolerance);
    } else if (parsed.type === 'absoluteTolerance') {
      // e.g. "7±1°" → target=7, tol=1
      isOut = num < (parsed.target - parsed.tolerance) || num > (parsed.target + parsed.tolerance);
    } else if (parsed.type === 'range') {
      // e.g. "3~5"
      isOut = num < parsed.min || num > parsed.max;
    }
    outOfSpec.push(isOut);
    if (isOut) anyFail = true;
  }

  return { result: anyFail ? 'FAIL' : 'PASS', outOfSpec };
}

async function generatePDF() {
  const r = APP.currentReport;
  if (!r) { showToast('没有数据', 'error'); return; }
  showToast('正在生成PDF... Generating...', 'info');

  let c = document.getElementById('pdfArea');
  if (c) c.remove();
  c = document.createElement('div');
  c.id = 'pdfArea';
  c.style.cssText = 'position:absolute;left:-3000px;top:0;z-index:-1;';
  document.body.appendChild(c);

  const CSS = `<style>
    .pg{width:794px;height:1123px;background:#fff;padding:10px 16px;font-family:'Noto Sans','Noto Sans Thai','Noto Sans Myanmar','PingFang SC','Microsoft YaHei',sans-serif;font-size:6.5px;color:#222;line-height:1.3;box-sizing:border-box;position:relative;overflow:hidden}
    .pg-land{width:1123px;height:794px;padding:10px 20px}
    .pg *{box-sizing:border-box}
    table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #999;padding:2px 3px;vertical-align:middle;word-break:break-all;font-size:6px}
    th{background:#d6e4f0;font-weight:600}
    .hdr{background:#1a5276;color:#fff;text-align:center;padding:4px;font-size:9px;font-weight:700;border:none}
    .hdr2{font-size:7.5px}
    .val{font-size:8px;font-weight:700;text-align:center}
    .pass{color:#1a8c3e;font-weight:700;font-size:7.5px;text-align:center}
    .fail{color:#c0392b;font-weight:700;font-size:7.5px;text-align:center}
    .lbl{font-size:6px;color:#333;line-height:1.25}
    .pc{width:33.33%;vertical-align:top;padding:1px}
    .pc .pl{font-size:5px;background:#f0f0f0;padding:1px 2px;line-height:1.15;border-bottom:1px solid #ccc;min-height:14px}
    .pc .img-wrap{width:100%;height:160px;display:flex;align-items:center;justify-content:center;background:#fafafa;overflow:hidden}
    .pc .img-wrap img{max-width:100%;max-height:160px;display:block}
    .pc .emp{height:160px;background:#fafafa}
    .res{padding:3px;font-size:5.5px;line-height:1.25;border:1px solid #888}
    .resbg{background:#d4edda}
    .ftd{border:none;font-size:5.5px;padding:3px}
    .photo-pg-hdr{display:flex;align-items:center;gap:6px;padding:2px 0 3px;border-bottom:1.5px solid #1a5276;margin-bottom:3px}
    .pass-stamp{position:absolute;top:52px;right:8px;width:80px;height:80px;border:4px solid #23b187;border-radius:50%;display:flex;align-items:center;justify-content:center;transform:rotate(-15deg);opacity:0.85;z-index:10}
    .pass-stamp .inner{text-align:center;line-height:1}
    .pass-stamp .t{font-size:22px;font-weight:900;color:#23b187;letter-spacing:2px}
    .pass-stamp .d{font-size:6px;color:#23b187;margin-top:2px}
  </style>`;

  // Parse nominal values from size field
  const nominals = parseSizeNominals(r.size);

  // Dimension results with real validation
  const dimKeys = ['length', 'width', 'thickness', 'gloss'];
  const dimStds = [r.dimensions.lengthStd, r.dimensions.widthStd, r.dimensions.thicknessStd, r.dimensions.glossStd];
  const dimNominals = [nominals.length, nominals.width, nominals.thickness, null]; // gloss has no nominal from size
  const dimResults = {};
  dimKeys.forEach((k, i) => {
    dimResults[k] = evaluateDimensionForPDF(r.dimensions[k], dimStds[i], dimNominals[i]);
  });

  // Page 1
  const inspHtml = INSPECT_ITEMS.map(it => {
    const res = r.inspectItems[it.key] || '/';
    const rem = r.inspectRemarks?.[it.key] || '';
    return `<tr><td class="lbl" style="width:17%;white-space:pre-line">${it.name} ${it.en}\n${it.my}</td>
      <td class="lbl" style="width:13%">${it.std}</td>
      <td class="lbl" style="width:57%;font-size:5px">${rem}</td>
      <td class="${res === 'PASS' ? 'pass' : res === 'FAIL' ? 'fail' : ''}" style="width:13%;text-align:center">${res}</td></tr>`;
  }).join('');

  const dimLabels = [
    '长度 Length\nအလျား', '宽度 Width\nအနံ',
    '厚度 Thickness\nအထူ', '光泽度 Gloss\nတောက်ပမှု'
  ];

  const dimHtml = dimKeys.map((k, ki) => {
    const vals = r.dimensions[k];
    const dr = dimResults[k];
    return `<tr><td class="lbl" style="white-space:pre-line">${dimLabels[ki]}</td><td style="text-align:center;font-size:5.5px">${dimStds[ki]}</td>
      ${vals.map((v, vi) => `<td class="val" style="font-size:7px;${dr.outOfSpec[vi] ? 'color:#c0392b;background:#fff0f0' : ''}">${v || ''}</td>`).join('')}
      <td class="${dr.result === 'FAIL' ? 'fail' : 'pass'}">${dr.result}</td></tr>`;
  }).join('');

  const p1 = `<div class="pg pg-land">
    <table><tr><td colspan="9" class="hdr">森雅国际有限公司 บริษัท เซเนีย อินเตอร์เนชั่นแนล จำกัด Senia International Co., Ltd.</td></tr>
    <tr><td colspan="9" class="hdr hdr2">成品出厂终检报告 Finished Product Release Inspection Report รายงานตรวจสอบปล่อยผลิตภัณฑ์สำเร็จรูป ကုန်ချော ထုတ်ပေးခြင်းဆိုင်ရာ စစ်ဆေးမှုအစီရင်ခံစာ</td></tr></table>
    <table><tr>
      <td class="lbl" style="width:11%">日期 Date\nวันที่ ရက်စွဲ</td><td class="val" style="width:13%">${r.date}</td>
      <td class="lbl" style="width:7%">PO No.</td><td class="val" style="width:13%">${escapeHtml(r.poOrderNo)}</td>
      <td class="lbl" style="width:16%">彩膜型号 Color Film\nรุ่นฟิล์มสี ရောင်စုံဖလင်</td><td class="val" style="width:13%">${escapeHtml(r.colorFilmModel)}</td>
    </tr><tr>
      <td class="lbl">产品类别 Product Type\nประเภทผลิตภัณฑ์\nကုန်ပစ္စည်းအမျိုးအစား</td><td class="val">${r.productType}</td>
      <td class="lbl">尺寸 Size\nขนาด အရွယ်အစား</td><td class="val">${escapeHtml(r.size)}</td>
      <td class="lbl">耐磨层厚度 Wear Layer\nความหนาชั้นกันสึก\nအကြမ်းခံလွှာအထူ</td><td class="val">${escapeHtml(r.wearLayerThickness)}</td>
    </tr><tr>
      <td class="lbl">扣型 Lock Type\nรูปแบบตัวล็อค\nချိတ်အမျိုးအစား</td><td class="val">${escapeHtml(r.lockType)}</td>
      <td class="lbl">压纹 Embossed\nลายปั๊มนูน အဆင်</td><td class="val">${escapeHtml(r.embossedTexture)}</td>
      <td class="lbl">型号 Model\nรุ่น မော်ဒယ်</td><td class="val">${escapeHtml(r.model)}</td>
    </tr></table>
    <table><tr><th style="width:42%">外观 Appearance ลักษณะภายนอก အသွင်အပြင်</th><th style="width:14%">测量(片) Tests</th><th style="width:14%">不合格 Defects</th><th style="width:16%">检测值 Value</th><th style="width:14%">判定 Result</th></tr>
    <tr><td class="lbl" style="font-size:4.5px;line-height:1.1">缺损、龟裂、皱纹、孔洞、分层、剥离、杂质、气泡、擦伤、胶印、变色、异常凹痕、污迹、白边等 Flaws, cracks, wrinkles, holes, delamination, peeling, impurities, air bubbles, scratches, glue marks, discoloration, stains, white edges etc. ตำหนิ,รอยแตก,รอยยับ,รู,ฟองอากาศ,รอยขีดข่วน,คราบกาว,ขอบขาว ချို့ယွင်းချက်များ၊ အက်ကြောင်းများ၊ အပေါက်များ၊ ပွန်းပဲ့ရာများ</td>
    <td class="val">${r.appearance.testCount}</td><td class="val">${r.appearance.defectCount}</td>
    <td class="lbl" style="font-size:5px">详见抽检照片 Refer to photos\nดูรายละเอียดในภาพ\nဓာတ်ပုံများတွင်ကြည့်ပါ</td><td class="pass">${r.appearance.result || 'PASS'}</td></tr></table>
    <table><tr><th style="width:14%">项目 Item\nรายการ အချက်</th><th style="width:9%">标准 Std\nစံနှုန်း</th>${Array.from({length: 6}, (_, i) => `<th>${i + 1}</th>`).join('')}<th style="width:8%">判定\nResult</th></tr>${dimHtml}</table>
    <table>${inspHtml}</table>
    <table><tr><td class="lbl" style="font-size:5.5px">（${r.packaging.pcsPerBox}）片pcs แผ่น ချပ် ×（${r.packaging.layersPerBox}）层/箱 layer/box ชั้น/กล่อง လွှာ/ပုံး &nbsp; （${r.packaging.boxesPerPallet}）箱boxes กล่อง ပုံး ×（${r.packaging.layersPerPallet}）层/托 layers/pallet ชั้น/พาเลท လွှာ/ခံပြား</td></tr>
    <tr><td class="lbl" style="font-size:5.5px">单包重 Box Wt น้ำหนักกล่อง တစ်ပုံးအလေးချိန်（${escapeHtml(r.boxWeightKg)}）kg &nbsp; 单拖重 Pallet Wt น้ำหนักพาเลท ခံပြားအလေးချိန်（${escapeHtml(r.palletWeightKg)}）KG</td></tr></table>
    <div class="res ${r.finalResult === 'pass' ? 'resbg' : ''}" style="margin:3px 0;white-space:pre-line">${r.finalResult === 'pass'
      ? '■检验合格，可以发货。Final inspection PASSED, goods can be shipped.\nผ่านการตรวจสอบ สามารถจัดส่งได้ စစ်ဆေးမှုအောင်မြင်၊ ကုန်ပစ္စည်းများတင်ပို့နိုင်ပါသည်။'
      : '■检验不合格，不能发货。Inspection FAILED, cannot ship.\nไม่ผ่านการตรวจสอบ ไม่สามารถจัดส่งได้ စစ်ဆေးမှုမအောင်မြင်၊ ပို့ဆောင်ပေးခြင်းမပြုလုပ်နိုင်ပါ။'}</div>
    <table><tr><td class="ftd" style="width:40%">终检 Inspector ผู้ตรวจสอบ နောက်ဆုံးစစ်ဆေးသူ：Htet Aung</td>
    <td class="ftd" style="width:40%">审核 Reviewer ผู้ทบทวน ပြန်လည်စစ်ဆေးသူ：Mr. Jianhuai Luo</td>
    <td class="ftd" style="width:20%"></td></tr></table>
    ${r.status === 'approved' ? '<div class="pass-stamp"><div class="inner"><div class="t">PASS</div><div class="d">' + r.updatedAt.slice(0, 10) + '</div></div></div>' : ''}
    <div style="position:absolute;bottom:4px;right:16px;font-size:4.5px;color:#999">DCN:FM-00-QC-023-001</div>
  </div>`;

  // Photo pages
  function photoPage(start, end) {
    let rows = '';
    for (let i = start; i < end; i += 3) {
      rows += '<tr>';
      for (let j = 0; j < 3; j++) {
        const idx = i + j;
        if (idx >= PHOTO_SLOTS.length) { rows += '<td class="pc"><div class="emp"></div></td>'; continue; }
        const lbl = PHOTO_SLOTS[idx];
        const photo = r.photos[idx];
        rows += `<td class="pc"><div class="pl">${lbl}</div>${photo ? `<div class="img-wrap"><img src="${photo}"></div>` : '<div class="emp"></div>'}</td>`;
      }
      rows += '</tr>';
    }
    const isLast = end >= PHOTO_SLOTS.length;
    return `<div class="pg">
      <table style="margin-bottom:3px"><tr><td style="font-size:6px;width:50%">PO订单号 PO Order No. အမှာစာနံပါတ် <b>${escapeHtml(r.poOrderNo)}</b></td>
      <td style="font-size:6px;width:50%">产品型号 Product Model ကုန်ပစ္စည်းမော်ဒယ် <b>${escapeHtml(r.colorFilmModel)}</b></td></tr></table>
      <table>${rows}</table>
      ${isLast ? `<table style="margin-top:4px"><tr><td class="ftd">终检 Inspector စစ်ဆေးသူ：Htet Aung</td><td class="ftd">审核 Reviewer ပြန်လည်စစ်ဆေးသူ：Mr. Jianhuai Luo</td><td class="ftd">日期 Date ရက်စွဲ：${r.date}</td></tr></table>` : ''}
      ${r.status === 'approved' ? '<div class="pass-stamp"><div class="inner"><div class="t">PASS</div><div class="d">' + r.updatedAt.slice(0, 10) + '</div></div></div>' : ''}
      <div style="position:absolute;bottom:4px;right:16px;font-size:4.5px;color:#999">FM-QC-86_02 : Rev.00</div>
    </div>`;
  }

  c.innerHTML = CSS + p1 + photoPage(0, 15) + photoPage(15, 29);

  // Wait for all images to load
  const imgs = c.querySelectorAll('img');
  await Promise.all(Array.from(imgs).map(img =>
    img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; })
  ));
  await new Promise(r => setTimeout(r, 800));

  const pages = c.querySelectorAll('.pg');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  for (let i = 0; i < pages.length; i++) {
    const isLand = pages[i].classList.contains('pg-land');
    const pgW = isLand ? 1123 : 794;
    if (i > 0) doc.addPage('a4', isLand ? 'landscape' : 'portrait');
    try {
      const canvas = await html2canvas(pages[i], {
        scale: 3, useCORS: true, allowTaint: true,
        backgroundColor: '#fff', width: pgW, windowWidth: pgW
      });
      const imgW = isLand ? 297 : 210;
      const imgH = isLand ? 210 : 297;
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, imgH);
    } catch (e) { console.error('Render error:', e); }
  }
  c.remove();

  // Download PDF
  try {
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.poOrderNo || 'Report'}-${r.colorFilmModel || ''}-${r.date}.pdf`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
    showToast('PDF已生成 Generated!', 'success');
  } catch (e) {
    const dataUri = doc.output('datauristring');
    window.open(dataUri, '_blank');
    showToast('PDF已生成 (新窗口打开)', 'success');
  }
}

/**
 * Photo Compression Web Worker
 * Offloads heavy canvas operations to a separate thread,
 * keeping the main thread responsive during photo processing.
 */

self.addEventListener('message', async (e) => {
  const { id, imageBitmap, maxDim, maxBase64Chars } = e.data;

  try {
    const MAX_DIM = maxDim || 1200;
    const MAX_B64 = maxBase64Chars || (1.35 * 1024 * 1024);

    let baseW = imageBitmap.width;
    let baseH = imageBitmap.height;
    if (baseW > MAX_DIM || baseH > MAX_DIM) {
      if (baseW > baseH) {
        baseH = baseH * MAX_DIM / baseW;
        baseW = MAX_DIM;
      } else {
        baseW = baseW * MAX_DIM / baseH;
        baseH = MAX_DIM;
      }
    }

    let dataUrl = '';
    let finalW = Math.round(baseW);
    let finalH = Math.round(baseH);
    let qualityUsed = 0.72;

    // Use OffscreenCanvas for worker-based rendering
    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt++) {
      const scale = Math.pow(0.82, resizeAttempt);
      const w = Math.max(320, Math.round(baseW * scale));
      const h = Math.max(320, Math.round(baseH * scale));

      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(imageBitmap, 0, 0, w, h);

      let quality = 0.72;
      let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

      // Check size and reduce quality if needed
      while (blob.size * 1.37 > MAX_B64 && quality > 0.32) {
        quality -= 0.08;
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      }

      // Convert blob to base64 dataUrl
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      dataUrl = 'data:image/jpeg;base64,' + base64;

      qualityUsed = quality;
      finalW = w;
      finalH = h;
      if (dataUrl.length <= MAX_B64) break;
    }

    if (!dataUrl || dataUrl.length > MAX_B64) {
      self.postMessage({ id, error: '图片过大，压缩后仍超限，请靠近拍摄或截图后重试' });
      return;
    }

    const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
    self.postMessage({
      id,
      dataUrl,
      meta: {
        originalWidth: imageBitmap.width,
        originalHeight: imageBitmap.height,
        finalWidth: finalW,
        finalHeight: finalH,
        quality: qualityUsed,
        sizeKB
      }
    });
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || '照片处理失败' });
  } finally {
    imageBitmap.close();
  }
});

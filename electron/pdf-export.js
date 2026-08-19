// ---------- Browser PDF export (replaces Electron's webContents.printToPDF flow) ----------
// The desktop app renders each band (cover/header/footer/end) as an HTML page and prints it via
// Chromium's native PDF printer, purely to lay out already-rasterized PNG images — there's no
// browser equivalent of printToPDF. Since it's "just" image placement, pdf-lib can do the exact
// same layout directly (embed the PNGs, draw them at the right position/size on each page),
// which works identically in any browser and needs no native printing pipeline at all.

(function () {
  'use strict';

  const PT = 0.75; // CSS px (96dpi) -> PDF points (72dpi)
  const PAGE_W = 794 * PT;
  const PAGE_H = 1123 * PT;
  const BAND_H = Math.round(794 * 186 / 1237) * PT;

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function embedImage(doc, dataUrl) {
    const bytes = dataUrlToBytes(dataUrl);
    return dataUrl.startsWith('data:image/png') ? doc.embedPng(bytes) : doc.embedJpg(bytes);
  }

  // "object-fit: contain" — scale to fit inside the box without cropping, centered.
  function containBox(img, boxW, boxH) {
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * scale, h = img.height * scale;
    return { w, h, x: (boxW - w) / 2, y: (boxH - h) / 2 };
  }

  function drawBg(page, bg) {
    page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: bg });
  }

  // Cover/end pages: one image stretched to fill the whole page — these are purpose-built at the
  // page's own aspect ratio by buildCoverImage/buildEndImage, so a plain stretch is equivalent to
  // the desktop version's "object-fit: cover" without needing to crop anything.
  async function drawFullBleedPage(doc, dataUrl, bg) {
    const img = await embedImage(doc, dataUrl);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawBg(page, bg);
    page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    return page;
  }

  async function drawContentPage(doc, { img: contentSrc, headerImg, footerImg }, pageH, bg, showHeader, showFooter) {
    const page = doc.addPage([PAGE_W, pageH]);
    drawBg(page, bg);
    const headerH = showHeader ? BAND_H : 0;
    const footerH = showFooter ? BAND_H : 0;

    if (showHeader && headerImg) {
      const img = await embedImage(doc, headerImg);
      page.drawImage(img, { x: 0, y: pageH - BAND_H, width: PAGE_W, height: BAND_H });
    }
    if (showFooter && footerImg) {
      const img = await embedImage(doc, footerImg);
      page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: BAND_H });
    }

    const contentImg = await embedImage(doc, contentSrc);
    const boxH = pageH - headerH - footerH;
    const place = containBox(contentImg, PAGE_W, boxH);
    page.drawImage(contentImg, { x: place.x, y: footerH + place.y, width: place.w, height: place.h });
  }

  // Builds the final PDF as a Blob, mirroring main.js's export:pdf-full handler band-for-band.
  async function buildExportPdfBlob(payload) {
    const { PDFDocument, rgb } = PDFLib;
    const { theme, coverImg, footerImg, endImg, contentPages, pdfPrefs, contentPageHeight } = payload;
    const prefs = { showCover: true, showEnd: true, showHeader: true, showFooter: true, ...(pdfPrefs || {}) };
    const bg = theme === 'dark' ? rgb(0x2A / 255, 0x2A / 255, 0x2A / 255) : rgb(1, 1, 1);
    const useCustomEndPdf = prefs.showEnd && prefs.endPdfPath;

    const doc = await PDFDocument.create();

    if (prefs.showCover && coverImg) await drawFullBleedPage(doc, coverImg, bg);

    const showHeaderBand = prefs.showHeader || prefs.showPageNumbers;

    if (contentPageHeight) {
      const headerH = showHeaderBand ? BAND_H : 0;
      const footerH = prefs.showFooter ? BAND_H : 0;
      const totalH = Math.round((headerH + contentPageHeight * PT + footerH) * 100) / 100;
      await drawContentPage(doc, { ...contentPages[0], footerImg }, totalH, bg, showHeaderBand, prefs.showFooter);
    } else {
      for (const page of contentPages) {
        await drawContentPage(doc, { ...page, footerImg }, PAGE_H, bg, showHeaderBand, prefs.showFooter);
      }
    }

    if (prefs.showEnd && !useCustomEndPdf && endImg) await drawFullBleedPage(doc, endImg, bg);

    if (useCustomEndPdf) {
      const customBytes = dataUrlToBytes(prefs.endPdfPath);
      const customDoc = await PDFDocument.load(customBytes);
      const copied = await doc.copyPages(customDoc, customDoc.getPageIndices());
      copied.forEach((p) => doc.addPage(p));
    }

    const bytes = await doc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  window.buildExportPdfBlob = buildExportPdfBlob;
})();

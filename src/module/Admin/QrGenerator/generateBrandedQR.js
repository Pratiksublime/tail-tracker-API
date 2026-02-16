/**
 * generateBrandedQR.js
 *
 * Wraps the qrcodejs library (loaded via CDN) and returns a rich result object
 * with canvas, SVG, toDataURL, and download helpers.
 *
 * Depends on: https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
 */

/* global QRCode */

function generateBrandedQR(options) {
  const {
    data = "",
    size = 300,
    quietZone = 4,
    errorCorrectionLevel = "H",
    format = "SVG",
    dpi = 300,
    foregroundColor = "#000000",
    backgroundColor = "#FFFFFF",
  } = options || {};

  // --- Map error-correction level string to qrcodejs constant ---
  const ecLevels = { L: QRCode.CorrectLevel.L, M: QRCode.CorrectLevel.M, Q: QRCode.CorrectLevel.Q, H: QRCode.CorrectLevel.H };
  const correctLevel = ecLevels[errorCorrectionLevel.toUpperCase()] || QRCode.CorrectLevel.H;

  // --- Render via qrcodejs into a hidden container to get a canvas ---
  const tempContainer = document.createElement("div");
  tempContainer.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
  document.body.appendChild(tempContainer);

  // qrcodejs renders synchronously when width/height are provided
  new QRCode(tempContainer, {
    text: data,
    width: size,
    height: size,
    colorDark: foregroundColor,
    colorLight: backgroundColor,
    correctLevel: correctLevel,
  });

  // Grab the generated canvas
  const canvas = tempContainer.querySelector("canvas");

  // Remove the temporary container from the DOM but keep the canvas reference
  document.body.removeChild(tempContainer);

  // --- Build SVG string from the canvas pixel data ---
  const svgString = buildSVG(canvas, size, quietZone, foregroundColor, backgroundColor, dpi);

  // --- Return result object ---
  const result = {
    canvas: canvas,
    svg: svgString,

    /**
     * Returns a data-URL of the QR code image.
     * @param {string}  [mime="image/png"]  MIME type (image/png, image/jpeg, image/webp)
     * @param {number}  [quality=1]         Quality for lossy formats (0-1)
     * @returns {string}
     */
    toDataURL: function (mime, quality) {
      return canvas.toDataURL(mime || "image/png", quality != null ? quality : 1);
    },

    /**
     * Triggers a browser download of the QR code.
     * @param {string} [filename="qr-code"]  Name without extension
     */
    download: function (filename) {
      const name = (filename || "qr-code").replace(/\.[^.]+$/, ""); // strip extension if provided
      const fmt = (format || "SVG").toUpperCase();

      if (fmt === "SVG") {
        // Download as SVG file
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        triggerDownload(blob, name + ".svg");
      } else {
        // Download as PNG
        canvas.toBlob(function (blob) {
          triggerDownload(blob, name + ".png");
        }, "image/png");
      }
    },
  };

  return result;
}

// ---- Helper: build an SVG string by reading the canvas pixel data ----
function buildSVG(canvas, size, quietZone, fgColor, bgColor, dpi) {
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imgData.data; // RGBA flat array

  // Detect module size by scanning the top-left quiet-zone boundary
  // Strategy: find the first dark pixel from the top-left; the offset is the quiet-zone in px
  let moduleSize = 1;
  let qzPx = 0;

  // Scan from (0,0) rightward to find first dark pixel
  for (let x = 0; x < canvas.width; x++) {
    const idx = x * 4;
    if (pixels[idx] < 128) {
      // dark pixel found
      qzPx = x;
      break;
    }
  }

  // Now find width of first module (contiguous dark pixels)
  if (qzPx > 0) {
    let darkRun = 0;
    for (let x = qzPx; x < canvas.width; x++) {
      const idx = x * 4;
      if (pixels[idx] < 128) {
        darkRun++;
      } else {
        break;
      }
    }
    moduleSize = darkRun || 1;
  } else {
    // fallback: try scanning row 0 for transitions
    moduleSize = Math.max(1, Math.round(canvas.width / 40));
  }

  // Calculate module count
  const contentPx = canvas.width - 2 * qzPx;
  const moduleCount = Math.round(contentPx / moduleSize);

  // Build module matrix by sampling centre of each module
  const modules = [];
  for (let row = 0; row < moduleCount; row++) {
    const rowArr = [];
    for (let col = 0; col < moduleCount; col++) {
      const cx = qzPx + col * moduleSize + Math.floor(moduleSize / 2);
      const cy = qzPx + row * moduleSize + Math.floor(moduleSize / 2);
      const idx = (cy * canvas.width + cx) * 4;
      const dark = pixels[idx] < 128;
      rowArr.push(dark);
    }
    modules.push(rowArr);
  }

  // Build SVG
  const cellSize = size / (moduleCount + 2 * quietZone);
  const totalSize = size;

  let svgParts = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}" shape-rendering="crispEdges">`
  );
  // Background
  svgParts.push(`<rect width="${totalSize}" height="${totalSize}" fill="${bgColor}"/>`);

  // Modules
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (modules[r][c]) {
        const x = (quietZone + c) * cellSize;
        const y = (quietZone + r) * cellSize;
        svgParts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${fgColor}"/>`);
      }
    }
  }

  svgParts.push("</svg>");
  return svgParts.join("\n");
}

// ---- Helper: trigger file download ----
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 100);
}


import './assets/style.css';
import JSZip from 'jszip';

const DELAY_BETWEEN_CALLS_MS = 150;

function setProgress(percent, status) {
  const fill = document.getElementById('progress-fill');
  const statusEl = document.getElementById('progress-status');
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (statusEl) statusEl.textContent = status ?? '';
}

function showError(message) {
  const el = document.getElementById('error-message');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function showDone(message, blob) {
  const progressContainer = document.getElementById('progress-container');
  const doneContainer = document.getElementById('done-container');
  const doneMessage = document.getElementById('done-message');
  const downloadBtn = document.getElementById('download-btn');
  if (progressContainer) progressContainer.hidden = true;
  if (doneContainer) doneContainer.hidden = false;
  if (doneMessage) doneMessage.textContent = message;
  if (downloadBtn && blob) {
    downloadBtn.disabled = false;
    const url = URL.createObjectURL(blob);
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'miro-export-images.zip';
      a.click();
      URL.revokeObjectURL(url);
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeName(name) {
  return String(name)
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim() || 'unnamed';
}

function extensionFromMime(mime) {
  if (!mime || !mime.startsWith('image/')) return '.png';
  const subtype = mime.slice(6).toLowerCase();
  if (subtype === 'jpeg') return '.jpg';
  return '.' + subtype;
}

function sortByPosition(items) {
  return [...items].sort((a, b) => {
    const yA = a.y ?? 0;
    const yB = b.y ?? 0;
    if (Math.abs(yA - yB) > 1) return yA - yB;
    return (a.x ?? 0) - (b.x ?? 0);
  });
}

async function buildExportList(images) {
  const byParent = new Map();
  byParent.set(null, []);

  for (const img of images) {
    const parentId = img.parentId ?? null;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(img);
  }

  const frameNames = new Map();
  const parentIds = [...byParent.keys()].filter(Boolean);

  const framesWithPosition = [];
  for (const id of parentIds) {
    try {
      const frame = await miro.board.getById(id);
      const title = frame?.title?.trim();
      const name = title ? safeName(title) : null;
      framesWithPosition.push({
        id,
        name,
        x: frame?.x ?? 0,
        y: frame?.y ?? 0,
      });
    } catch {
      framesWithPosition.push({ id, name: null, x: 0, y: 0 });
    }
    await delay(DELAY_BETWEEN_CALLS_MS);
  }

  framesWithPosition.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
    return a.x - b.x;
  });

  framesWithPosition.forEach((f, i) => {
    frameNames.set(f.id, f.name ?? `Frame ${i + 1}`);
  });

  const exportList = [];
  const rootImages = sortByPosition(byParent.get(null) ?? []);
  rootImages.forEach((img, idx) => {
    exportList.push({ image: img, folderName: '', indexInFolder: idx + 1 });
  });

  for (const { id: parentId } of framesWithPosition) {
    const folderName = frameNames.get(parentId) ?? 'Frame';
    const inFrame = sortByPosition(byParent.get(parentId) ?? []);
    inFrame.forEach((img, idx) => {
      exportList.push({ image: img, folderName, indexInFolder: idx + 1 });
    });
  }

  return exportList;
}

async function runExport() {
  setProgress(0, 'Getting selection…');

  try {
    const selection = await miro.board.getSelection();
    await delay(DELAY_BETWEEN_CALLS_MS);

    const images = selection.filter((item) => item.type === 'image');
    if (images.length === 0) {
      showError('No images selected. Select one or more image items on the board, then try Export again.');
      return;
    }

    setProgress(5, `Found ${images.length} image(s). Resolving frames…`);
    const exportList = await buildExportList(images);
    const total = exportList.length;

    const zip = new JSZip();
    const usedNamesByFolder = new Map();

    const useImageNames = document.getElementById('use-names-toggle')?.checked ?? true;

    function chooseFileName(folderName, image, ext, indexInFolder) {
      const used = usedNamesByFolder.get(folderName) ?? new Set();
      usedNamesByFolder.set(folderName, used);

      if (!useImageNames) {
        const num = String(indexInFolder).padStart(3, '0');
        return `image-${num}${ext}`;
      }

      const baseFromTitle = image.title?.trim();
      const base = baseFromTitle ? safeName(baseFromTitle) : null;

      let fileName;
      if (base) {
        let candidate = base + ext;
        let n = 1;
        while (used.has(candidate.toLowerCase())) {
          n += 1;
          candidate = `${base}-${n}${ext}`;
        }
        used.add(candidate.toLowerCase());
        fileName = candidate;
      } else {
        const num = String(indexInFolder).padStart(3, '0');
        fileName = `image-${num}${ext}`;
      }
      return fileName;
    }

    for (let i = 0; i < exportList.length; i++) {
      const { image, folderName, indexInFolder } = exportList[i];

      let blob;
      try {
        const file = await image.getFile('original');
        blob = file;
        await delay(DELAY_BETWEEN_CALLS_MS);
      } catch (e) {
        const dataUrl = await image.getDataUrl('original');
        await delay(DELAY_BETWEEN_CALLS_MS);
        const res = await fetch(dataUrl);
        blob = await res.blob();
      }

      const ext = blob.type ? extensionFromMime(blob.type) : '.png';
      const fileName = chooseFileName(folderName, image, ext, indexInFolder);
      const zipPath = folderName ? `${folderName}/${fileName}` : fileName;
      zip.file(zipPath, blob);

      const pct = 10 + (80 * (i + 1)) / total;
      setProgress(pct, `Exporting ${i + 1} / ${total}…`);
    }

    setProgress(95, 'Creating ZIP…');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    setProgress(100, `Done. ${total} image(s) in ZIP.`);

    showDone(`Exported ${total} image(s). Click Download ZIP to save.`, zipBlob);
    miro.board.notifications.showInfo(`Exported ${total} image(s). Download the ZIP from the modal.`);
  } catch (err) {
    console.error(err);
    showError(err.message || 'Export failed. Try again.');
    miro.board.notifications.showError(err.message || 'Export failed.');
  }
}

function init() {
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      miro.board.ui.closeModal();
    });
  }

  const downloadBtn = document.getElementById('download-btn');
  if (downloadBtn) {
    downloadBtn.disabled = true;
  }

  const optionsContainer = document.getElementById('options-container');
  const progressContainer = document.getElementById('progress-container');
  const startExportBtn = document.getElementById('start-export-btn');

  if (startExportBtn) {
    startExportBtn.addEventListener('click', () => {
      if (optionsContainer) optionsContainer.hidden = true;
      if (progressContainer) progressContainer.hidden = false;
      runExport();
    });
  }
}

init();

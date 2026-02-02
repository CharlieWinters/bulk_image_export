import './assets/style.css';

async function runExport() {
  const btn = document.getElementById('export-btn');
  if (btn) btn.disabled = true;

  try {
    if (await miro.board.ui.canOpenModal()) {
      await miro.board.ui.openModal({
        url: 'export-modal.html',
        width: 520,
        height: 360,
        fullscreen: false,
      });
    } else {
      miro.board.notifications.showError('Please close other modals and try again.');
    }
  } catch (err) {
    console.error(err);
    miro.board.notifications.showError(err.message || 'Failed to open export.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function init() {
  const btn = document.getElementById('export-btn');
  if (btn) {
    btn.addEventListener('click', runExport);
  }
}

init();

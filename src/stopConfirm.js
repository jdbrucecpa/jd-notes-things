// Renderer for the "End the recording?" countdown dialog.
// SECURITY: all dynamic content is written via textContent — never innerHTML.
const countdownEl = document.getElementById('countdown');
const endBtn = document.getElementById('end-btn');
const keepBtn = document.getElementById('keep-btn');

if (window.confirmAPI) {
  window.confirmAPI.onTick(data => {
    const remaining = data && typeof data.remaining === 'number' ? data.remaining : 0;
    countdownEl.textContent = String(remaining);
  });
}

endBtn.addEventListener('click', () => {
  if (window.confirmAPI) window.confirmAPI.end();
});

keepBtn.addEventListener('click', () => {
  if (window.confirmAPI) window.confirmAPI.keep();
});

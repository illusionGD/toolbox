const button = document.querySelector('#run');
button.addEventListener('click', async () => {
  button.disabled = true;
  const result = document.querySelector('#result');
  result.textContent = '检查中…';
  try {
    const output = await window.toolbox.commands.run('check', {
      source: document.querySelector('#source').value,
      target: document.querySelector('#target').value,
    });
    result.textContent = JSON.stringify(output, null, 2);
  } catch (error) {
    result.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});

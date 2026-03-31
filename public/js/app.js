document.addEventListener('DOMContentLoaded', () => {
  const actionSelect = document.getElementById('action-select');
  const inputGroup = document.getElementById('input-group');
  const inputData = document.getElementById('input-data');
  const executeBtn = document.getElementById('execute-btn');
  const output = document.getElementById('output');
  const outputMeta = document.getElementById('output-meta');

  let actionsMap = new Map();

  // Load config and populate action dropdown
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();

      data.actions.forEach(a => {
        actionsMap.set(a.id, a);
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.label;
        actionSelect.appendChild(opt);
      });

      updateFormState();
    } catch (err) {
      showError('Failed to load configuration: ' + err.message);
    }
  }

  // Show/hide input field based on selected action
  function updateInputVisibility() {
    const action = actionsMap.get(actionSelect.value);
    if (action && action.usesInput) {
      inputGroup.style.display = '';
      inputData.placeholder = action.inputPlaceholder || 'Enter value...';
    } else {
      inputGroup.style.display = 'none';
      inputData.value = '';
    }
  }

  // Enable/disable execute button based on form validity
  function updateFormState() {
    const action = actionsMap.get(actionSelect.value);
    const inputRequired = action && action.usesInput;
    const inputValid = !inputRequired || inputData.value.trim();
    executeBtn.disabled = !(actionSelect.value && inputValid);
  }

  // Execute the command
  async function execute() {
    const action = actionsMap.get(actionSelect.value);
    if (!action) return;

    setLoading(true);
    output.innerHTML = '';
    outputMeta.textContent = '';

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: actionSelect.value,
          input: inputData.value.trim()
        })
      });

      const data = await res.json();

      if (data.success) {
        output.innerHTML = data.output;
        outputMeta.textContent = `${data.action} — ${(data.executionTime / 1000).toFixed(1)}s, exit code: ${data.exitCode}`;
      } else {
        showError(data.error);
      }
    } catch (err) {
      showError('Request failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function showError(message) {
    output.innerHTML = `<div class="output-error"><strong>Error: </strong>${escapeHtml(message)}</div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setLoading(loading) {
    executeBtn.disabled = loading;
    if (loading) {
      executeBtn.classList.add('loading');
    } else {
      executeBtn.classList.remove('loading');
    }
  }

  // Event listeners
  actionSelect.addEventListener('change', () => {
    updateInputVisibility();
    updateFormState();
  });

  inputData.addEventListener('input', updateFormState);
  executeBtn.addEventListener('click', execute);

  // Ctrl+Enter / Cmd+Enter shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !executeBtn.disabled) {
      execute();
    }
  });

  loadConfig();
});

document.addEventListener('DOMContentLoaded', () => {
  const agentStatusEl = document.getElementById('agent-status');
  const agentLabelEl = agentStatusEl.querySelector('.agent-label');

  async function checkAgentStatus() {
    try {
      const res = await fetch('/api/agent-status');
      const data = await res.json();
      agentStatusEl.className = 'agent-status ' + (data.connected ? 'agent-connected' : 'agent-disconnected');
      agentLabelEl.textContent = data.connected ? 'Local agent connected' : 'Local agent disconnected';
    } catch {
      agentStatusEl.className = 'agent-status agent-unknown';
      agentLabelEl.textContent = 'Agent status unknown';
    }
  }

  checkAgentStatus();
  setInterval(checkAgentStatus, 5000);

  const serverSelect = document.getElementById('server-select');
  const actionSelect = document.getElementById('action-select');
  const inputGroup = document.getElementById('input-group');
  const inputData = document.getElementById('input-data');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const executeBtn = document.getElementById('execute-btn');
  const output = document.getElementById('output');
  const outputMeta = document.getElementById('output-meta');

  let actionsMap = new Map();

  // Load config and populate dropdowns
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();

      data.servers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.label;
        serverSelect.appendChild(opt);
      });

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
    const valid = serverSelect.value
      && actionSelect.value
      && username.value.trim()
      && password.value.trim();

    const action = actionsMap.get(actionSelect.value);
    const inputRequired = action && action.usesInput;
    const inputValid = !inputRequired || inputData.value.trim();

    executeBtn.disabled = !(valid && inputValid);
  }

  // Execute the command
  async function execute() {
    const action = actionsMap.get(actionSelect.value);
    if (!action) return;

    setLoading(true);
    output.innerHTML = '';
    outputMeta.textContent = '';

    const startTime = Date.now();

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: serverSelect.value,
          actionId: actionSelect.value,
          input: inputData.value.trim(),
          username: username.value.trim(),
          password: password.value
        })
      });

      const data = await res.json();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (data.success) {
        output.innerHTML = data.output;
        outputMeta.textContent = `${data.server} - ${data.action} (${elapsed}s, exit code: ${data.exitCode})`;
      } else {
        showError(data.error);
      }
    } catch (err) {
      showError('Request failed: ' + err.message);
    } finally {
      setLoading(false);
      // Clear password after execution for security
      password.value = '';
      updateFormState();
    }
  }

  function showError(message) {
    output.innerHTML = `<div class="output-error"><strong>Error</strong>${escapeHtml(message)}</div>`;
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

  serverSelect.addEventListener('change', updateFormState);
  username.addEventListener('input', updateFormState);
  password.addEventListener('input', updateFormState);
  inputData.addEventListener('input', updateFormState);
  executeBtn.addEventListener('click', execute);

  // Ctrl+Enter shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !executeBtn.disabled) {
      execute();
    }
  });

  loadConfig();
});

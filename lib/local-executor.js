const { exec } = require('child_process');

/**
 * Execute a command on the local machine.
 */
function executeCommand({ command, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.killed) {
        return reject(new Error('Command execution timed out after ' + (timeout / 1000) + ' seconds'));
      }
      let output = stdout || '';
      if (stderr) {
        output += (stdout ? '\n' : '') + '[STDERR]\n' + stderr;
      }
      resolve({ output, exitCode: err ? err.code ?? 1 : 0 });
    });
  });
}

module.exports = { executeCommand };

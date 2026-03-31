const { Client } = require('ssh2');

/**
 * Execute a command on a remote server via SSH.
 * Credentials are never logged or persisted.
 */
function executeCommand({ host, port, username, password, command, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let commandTimeout;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(commandTimeout);
      conn.end();
      fn(value);
    };

    conn.on('ready', () => {
      commandTimeout = setTimeout(() => {
        settle(reject, new Error('Command execution timed out after ' + (timeout / 1000) + ' seconds'));
      }, timeout);

      conn.exec(command, (err, stream) => {
        if (err) return settle(reject, err);

        let stdout = '';
        let stderr = '';

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        stream.on('close', (code) => {
          let output = stdout;
          if (stderr) {
            output += (stdout ? '\n' : '') + '[STDERR]\n' + stderr;
          }
          settle(resolve, { output, exitCode: code });
        });
      });
    });

    conn.on('error', (err) => {
      let message = 'SSH connection failed';
      if (err.level === 'client-authentication') {
        message = 'Authentication failed: invalid username or password';
      } else if (err.code === 'ECONNREFUSED') {
        message = 'Connection refused: server is unreachable or SSH is not running on port ' + port;
      } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
        message = 'Connection timed out: server did not respond';
      } else if (err.message) {
        message = 'SSH error: ' + err.message;
      }
      settle(reject, new Error(message));
    });

    conn.connect({
      host,
      port,
      username,
      password,
      readyTimeout: 10000,
      // Disable host key verification for admin tool (in production, use known_hosts)
      algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']
      }
    });
  });
}

module.exports = { executeCommand };

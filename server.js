const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config/config.json');
const { executeCommand } = require('./lib/local-executor');
const { parseOutput } = require('./lib/output-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (relaxed CSP for inline styles used by output parser)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"]
    }
  }
}));

// JSON body parser with size limit
app.use(express.json({ limit: '1kb' }));

// Rate limiter on execute endpoint
const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

// GET /api/config — return actions list
app.get('/api/config', (req, res) => {
  const actions = config.actions.map(a => ({
    id: a.id,
    label: a.label,
    usesInput: a.usesInput,
    inputPlaceholder: a.inputPlaceholder || ''
  }));

  res.json({ actions });
});

// POST /api/execute — run a predefined command locally
app.post('/api/execute', executeLimiter, async (req, res) => {
  try {
    const { actionId, input } = req.body;

    // Look up action
    const action = config.actions.find(a => a.id === actionId);
    if (!action) {
      return res.status(400).json({ success: false, error: 'Invalid action selection.' });
    }

    // Validate input if action requires it
    if (action.usesInput) {
      if (!input || input.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'This action requires input data. Please provide the required input.'
        });
      }

      // Sanitize input — reject dangerous shell metacharacters
      const dangerous = /[;|&$`(){}<>!\\\n\r]/;
      if (dangerous.test(input)) {
        return res.status(400).json({
          success: false,
          error: 'Input contains disallowed characters. Special shell characters are not permitted.'
        });
      }
    }

    // Build the command from template
    let command = action.command;
    if (action.usesInput && input) {
      command = command.replace('{{input}}', input.trim());
    }

    // Execute locally
    const start = Date.now();
    const result = await executeCommand({ command, timeout: 30000 });
    const executionTime = Date.now() - start;

    // Parse and return output
    const parsedOutput = parseOutput(result.output, action.parser);

    res.json({
      success: true,
      output: parsedOutput,
      exitCode: result.exitCode,
      action: action.label,
      executionTime
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || 'An unexpected error occurred while executing the command.'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`SA Web Tool running at http://localhost:${PORT}`);
});

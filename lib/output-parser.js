/**
 * Parse raw command output into safe, formatted HTML.
 * All output is HTML-escaped first to prevent XSS.
 */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePlain(raw) {
  return '<pre class="output-plain">' + escapeHtml(raw) + '</pre>';
}

function parseTable(raw) {
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    return parsePlain(raw);
  }

  // Split header by 2+ whitespace to detect columns
  const headerParts = lines[0].trim().split(/\s{2,}/);
  if (headerParts.length < 2) {
    // Fallback: try single whitespace split
    const singleSplit = lines[0].trim().split(/\s+/);
    if (singleSplit.length < 2) return parsePlain(raw);
    return buildTable(lines, /\s+/);
  }

  return buildTable(lines, /\s{2,}/);
}

function buildTable(lines, separator) {
  let html = '<div class="table-wrapper"><table class="output-table">';

  // Header row
  const headers = lines[0].trim().split(separator);
  html += '<thead><tr>';
  headers.forEach(h => {
    html += '<th>' + escapeHtml(h) + '</th>';
  });
  html += '</tr></thead>';

  // Data rows
  html += '<tbody>';
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(separator);
    html += '<tr>';
    // If fewer columns than headers, merge remaining into last column
    for (let j = 0; j < headers.length; j++) {
      if (j === headers.length - 1 && cols.length > headers.length) {
        html += '<td>' + escapeHtml(cols.slice(j).join(' ')) + '</td>';
      } else {
        html += '<td>' + escapeHtml(cols[j] || '') + '</td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  return html;
}

function parseLog(raw) {
  const lines = raw.split('\n');
  let html = '<pre class="output-log">';

  lines.forEach(line => {
    const escaped = escapeHtml(line);
    const lower = line.toLowerCase();

    if (/\b(error|fail|fatal|critical)\b/.test(lower)) {
      html += '<span class="log-error">' + escaped + '</span>\n';
    } else if (/\b(warn|warning)\b/.test(lower)) {
      html += '<span class="log-warn">' + escaped + '</span>\n';
    } else if (/\b(info)\b/.test(lower)) {
      html += '<span class="log-info">' + escaped + '</span>\n';
    } else {
      html += escaped + '\n';
    }
  });

  html += '</pre>';
  return html;
}

function parseOutput(raw, parserType) {
  if (!raw || raw.trim() === '') {
    return '<pre class="output-plain output-empty">(No output)</pre>';
  }

  switch (parserType) {
    case 'table':
      return parseTable(raw);
    case 'log':
      return parseLog(raw);
    case 'plain':
    default:
      return parsePlain(raw);
  }
}

module.exports = { parseOutput };

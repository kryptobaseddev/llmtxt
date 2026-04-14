import { sanitizeHtml } from '../middleware/sanitize.js';

/** Render the server-side HTML view template for a document page, including meta tags and structured content display. */
export function renderViewHtml(slug: string, data: any): string {
  const format = data.format || 'text';
  const created = data.createdAt ? new Date(data.createdAt).toLocaleString() : '-';
  const tokens = data.tokenCount || '-';
  
  let compression = '-';
  if (data.compressionRatio && !isNaN(data.compressionRatio) && data.compressionRatio !== Infinity) {
    compression = ((1 - data.compressionRatio) * 100).toFixed(1) + '%';
  } else if (data.originalSize && data.compressedSize) {
    const ratio = data.compressedSize / data.originalSize;
    if (!isNaN(ratio) && ratio !== Infinity) {
      compression = ((1 - ratio) * 100).toFixed(1) + '%';
    }
  }

  const originalSize = formatBytes(data.originalSize);
  const compressedSize = formatBytes(data.compressedSize);

  let initialContent = '';
  if (format === 'json') {
    try {
      const parsed = JSON.parse(data.content);
      initialContent = `<pre style="margin:0;">${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
    } catch {
      initialContent = escapeHtml(data.content);
    }
  } else {
    // Sanitize the markdown-rendered HTML before embedding in the page to
    // prevent XSS from user-supplied content. Sanitization is on output only —
    // stored content is never modified.
    initialContent = sanitizeHtml(renderMarkdown(data.content || ''));
  }

  // Inject data into window object for client-side JS to use
  const { compressedData, ...safeData } = data;
  const injectedData = JSON.stringify(safeData).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLMtxt - View Document</title>
  <link rel="alternate" type="application/json" href="/api/documents/${escapeHtml(slug)}" />
  <link rel="alternate" type="text/plain" href="/api/documents/${escapeHtml(slug)}/raw" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    html {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, sans-serif;
    }
    
    body {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    
    header {
      padding: 1rem 2rem;
      border-bottom: 1px solid rgba(128,128,128,0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .logo {
      font-size: 1.5rem;
      font-weight: 600;
      color: #58a6ff;
      text-decoration: none;
    }
    
    .slug {
      opacity: 0.7;
      font-family: monospace;
    }
    
    .actions {
      display: flex;
      gap: 0.5rem;
    }
    
    button {
      padding: 0.5rem 1rem;
      border: 1px solid rgba(128,128,128,0.3);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
    }
    
    button:hover {
      background: rgba(128,128,128,0.1);
    }
    
    .metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      padding: 2rem;
      background: rgba(128,128,128,0.05);
      border-bottom: 1px solid rgba(128,128,128,0.2);
    }
    
    .meta-item {
      text-align: center;
    }
    
    .meta-label {
      font-size: 12px;
      text-transform: uppercase;
      opacity: 0.6;
      margin-bottom: 0.5rem;
      letter-spacing: 0.5px;
    }
    
    .meta-value {
      font-size: 1.1rem;
      font-weight: 600;
      font-family: monospace;
    }
    
    .content {
      flex: 1;
      padding: 2rem;
      overflow: auto;
      white-space: pre-wrap;
      font: 14px/1.6 monospace;
      background: rgba(0,0,0,0.2);
    }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      opacity: 0.6;
    }
    
    .error {
      color: #ff6b6b;
      padding: 2rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <a href="/" class="logo">LLMtxt</a>
      <span class="slug">/ <span id="slug">${escapeHtml(slug)}</span></span>
    </div>
    <div class="actions">
      <button onclick="copyContent()">Copy</button>
      <button onclick="toggleRaw()" id="raw-btn">Raw</button>
    </div>
  </header>
  
  <div class="metadata" id="metadata">
    <div class="meta-item">
      <div class="meta-label">Format</div>
      <div class="meta-value" id="format">${escapeHtml(format)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Created</div>
      <div class="meta-value" id="created">${escapeHtml(created)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Tokens</div>
      <div class="meta-value" id="tokens">${escapeHtml(String(tokens))}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Compression</div>
      <div class="meta-value" id="compression">${escapeHtml(compression)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Original Size</div>
      <div class="meta-value" id="original-size">${escapeHtml(originalSize)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Compressed</div>
      <div class="meta-value" id="compressed-size">${escapeHtml(compressedSize)}</div>
    </div>
  </div>
  
  <div class="content" id="content">${initialContent}</div>

  <script>
    const slug = ${JSON.stringify(slug)};
    let documentData = ${injectedData};
    let isRaw = false;
    
    function updateContentDisplay() {
      if (!documentData) return;
      
      const contentEl = document.getElementById('content');
      
      if (isRaw) {
        contentEl.textContent = documentData.content;
      } else {
        // Render based on format
        if (documentData.format === 'json') {
          try {
            const parsed = JSON.parse(documentData.content);
            contentEl.innerHTML = '<pre style="margin:0;">' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</pre>';
          } catch {
            contentEl.textContent = documentData.content;
          }
        } else {
          // Markdown/text rendering
          contentEl.innerHTML = renderMarkdown(documentData.content);
        }
      }
    }
    
    function renderMarkdown(text) {
      // Simple markdown renderer
      return escapeHtml(text)
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\\*\\*(.*)\\*\\*/gim, '<strong>$1</strong>')
        .replace(/\\*(.*)\\*/gim, '<em>$1</em>')
        .replace(/\`(.*?)\`/gim, '<code style="background:rgba(128,128,128,0.2);padding:2px 4px;border-radius:3px;">$1</code>')
        .replace(/\\n/gim, '<br>');
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function copyContent() {
      if (documentData && documentData.content) {
        navigator.clipboard.writeText(documentData.content);
        alert('Copied to clipboard!');
      }
    }
    
    function toggleRaw() {
      isRaw = !isRaw;
      document.getElementById('raw-btn').textContent = isRaw ? 'Rendered' : 'Raw';
      updateContentDisplay();
    }
  </script>
</body>
</html>`;
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/`(.*?)`/gim, '<code style="background:rgba(128,128,128,0.2);padding:2px 4px;border-radius:3px;">$1</code>')
    .replace(/\n/gim, '<br>');
}

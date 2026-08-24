/**
 * ChatGPT UX Suite - Unified Content Script
 */
(function () {
  'use strict';

  // Run-once guard on the shared DOM: this script may arrive as the
  // standalone extension's content script and, separately, inside the
  // universal Scry extension's payload — different JS worlds, one page.
  if (document.documentElement.hasAttribute('data-chatgpt-ux-suite')) {
    return;
  }
  document.documentElement.setAttribute('data-chatgpt-ux-suite', '1');

  // =============================================================================
  // Settings Management
  // =============================================================================
  // DEFAULT_SETTINGS, CHIME_PRESETS and DEFAULT_CHIME are globals from
  // shared.js (loaded first by the manifest).
  //
  // Settings reach the features through one host interface:
  //   load()        -> Promise<settings>   (DEFAULT_SETTINGS keys + selectedChime)
  //   onChange(cb)  -> cb(settings) on every change
  //   onCommand(cb) -> cb(message) for keyboard-command messages (PROMPT_JUMP)
  // Standalone, the host is chrome.storage.sync + runtime messages. Inside
  // the Scry payload, `__chatgptUxHost` is declared in the enclosing scope.
  const host = typeof __chatgptUxHost !== 'undefined' ? __chatgptUxHost : {
    load: () => new Promise((resolve) => {
      chrome.storage.sync.get({ ...DEFAULT_SETTINGS, selectedChime: DEFAULT_CHIME }, resolve);
    }),
    onChange: (callback) => {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        const next = { ...currentSettings };
        Object.keys(changes).forEach((key) => {
          if (key in next) next[key] = changes[key].newValue;
        });
        callback(next);
      });
    },
    onCommand: (callback) => {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        callback(message);
        sendResponse({ received: true });
      });
    }
  };

  let selectedChime = DEFAULT_CHIME;
  let currentSettings = { ...DEFAULT_SETTINGS, selectedChime: DEFAULT_CHIME };

  function adoptSettings(settings) {
    currentSettings = { ...DEFAULT_SETTINGS, selectedChime: DEFAULT_CHIME, ...settings };
    selectedChime = currentSettings.selectedChime || DEFAULT_CHIME;
    return currentSettings;
  }

  async function loadSettings() {
    return adoptSettings(await host.load());
  }

  function onSettingsChanged(callback) {
    host.onChange((settings) => callback(adoptSettings(settings)));
  }

  // =============================================================================
  // Shared Utilities
  // =============================================================================
  function getConversationMain() {
    return (
      document.querySelector('main#main') ||
      document.querySelector('main[role="main"]') ||
      document.querySelector('main')
    );
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  const CONVERSATION_TURN_SELECTORS = [
    '[data-testid^="conversation-turn"]',
    '[data-testid*="conversation-turn"]',
    '[data-message-author-role]',
    '[data-message-id]',
    'article'
  ];
  const MESSAGE_TEXT_STRIP_SELECTORS = 'button, svg, style, script, textarea, input, select, [role="button"], [aria-hidden="true"], [hidden]';
  const MESSAGE_PREFIX_PATTERNS = [
    /^You said:\s*/i,
    /^You wrote:\s*/i,
    /^ChatGPT said:\s*/i,
    /^ChatGPT wrote:\s*/i,
    /^ChatGPT\s*\n+/i,
    /^Assistant said:\s*/i,
    /^User said:\s*/i
  ];

  function determineMessageRole(el, index) {
    const roleAttr = el.getAttribute('data-message-author-role') || el.dataset?.messageAuthorRole;
    if (roleAttr) return roleAttr;

    const nestedRoleEl = el.querySelector('[data-message-author-role]');
    if (nestedRoleEl) {
      return nestedRoleEl.getAttribute('data-message-author-role');
    }

    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('user')) return 'user';
    if (testId.includes('assistant') || testId.includes('model') || testId.includes('gpt')) return 'assistant';

    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('you')) return 'user';
    if (ariaLabel.includes('chatgpt') || ariaLabel.includes('assistant')) return 'assistant';

    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function getConversationTurnContainer(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return (
      node.closest('[data-testid^="conversation-turn"]') ||
      node.closest('[data-testid*="conversation-turn"]') ||
      node.closest('article') ||
      node.closest('[data-message-id]') ||
      (typeof node.matches === 'function' && node.matches(CONVERSATION_TURN_SELECTORS.join(', ')) ? node : null)
    );
  }

  function collectConversationTurns(root) {
    const candidates = Array.from(root.querySelectorAll(CONVERSATION_TURN_SELECTORS.join(', ')));

    if (candidates.length === 0) {
      return [];
    }

    const seen = new Set();
    const turns = [];
    candidates.forEach((node) => {
      const container = getConversationTurnContainer(node);

      if (container && !seen.has(container)) {
        seen.add(container);
        turns.push(container);
      }
    });
    return turns;
  }

  function isReasoningOnlyTurn(el) {
    const text = (el?.textContent || '').trim();

    if (/^Thought for \d+/i.test(text)) return true;
    if (/^Thinking\.{0,3}$/i.test(text)) return true;

    const ariaLabel = el?.getAttribute?.('aria-label') || '';
    if (/thought for|thinking/i.test(ariaLabel)) return true;

    const details = el?.querySelector?.('details, summary');
    if (details) {
      const detailsText = (details.textContent || '').trim();
      if (/^Thought for \d+/i.test(detailsText) || /^Thinking/i.test(detailsText)) return true;
    }

    const hasThinkingText = /Thought for \d+|Thinking/i.test(text);
    return hasThinkingText && text.length < 100;
  }

  function extractMessageTextFromTurn(turn, extraStripSelectors) {
    if (!turn || typeof turn.cloneNode !== 'function') return '';

    const clone = turn.cloneNode(true);
    const stripSelectors = [MESSAGE_TEXT_STRIP_SELECTORS, extraStripSelectors].filter(Boolean).join(', ');
    if (stripSelectors) {
      clone.querySelectorAll(stripSelectors).forEach((el) => el.remove());
    }

    clone.querySelectorAll('details, summary').forEach((el) => {
      const text = el.textContent || '';
      if (/Thought for \d+|Thinking|reasoning/i.test(text)) {
        el.remove();
      }
    });

    let text = (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    MESSAGE_PREFIX_PATTERNS.forEach((pattern) => {
      text = text.replace(pattern, '');
    });

    text = text
      .replace(/^Thought for [^\n]+$/gim, '')
      .replace(/^Thinking\.{0,3}$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }

  /**
   * Visible conversation turns with their role, in document order.
   * Reasoning-only turns ("Thought for 12s") are dropped unless asked for.
   */
  function getRenderedTurns({ includeReasoning = false } = {}) {
    const main = getConversationMain();
    if (!main) return [];
    return collectConversationTurns(main)
      .map((turn, index) => ({ turn, index, role: determineMessageRole(turn, index) }))
      .filter(({ turn }) => isElementVisible(turn) && (includeReasoning || !isReasoningOnlyTurn(turn)));
  }

  function normalizeUnixTimestampMs(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    // ChatGPT message create_time is typically in seconds.
    return numeric > 1e12 ? Math.round(numeric) : Math.round(numeric * 1000);
  }

  function extractTimestampFromTimeElement(turn) {
    if (!turn || typeof turn.querySelector !== 'function') return null;
    const timeEl = turn.querySelector('time[datetime]');
    if (!timeEl) return null;
    const datetime = timeEl.getAttribute('datetime');
    if (!datetime) return null;
    const parsed = Date.parse(datetime);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  }

  // Message times come from the conversation payload; the rendered DOM carries
  // none a content script can read (React's fiber expandos live in the page
  // world), so a <time> element is the only DOM fallback.
  function getTurnTimestampMs(turn) {
    const record = ConversationDataStore.findRecordForTurn(turn);
    if (record && record.createTimeMs) return record.createTimeMs;
    return extractTimestampFromTimeElement(turn);
  }

  function formatAbsoluteDateTime(timestamp, options = {}) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const sameYear = now.getFullYear() === date.getFullYear();
    const includeSeconds = options.includeSeconds === true;

    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: includeSeconds ? '2-digit' : undefined
      }).format(date);
    } catch (e) {
      return date.toLocaleString();
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getConversationIdFromLocation() {
    const match = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  function normalizeTextForSignature(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getTextSignature(text) {
    const normalized = normalizeTextForSignature(text);
    if (!normalized) return '';
    return `${normalized.length}:${normalized.slice(0, 180)}`;
  }

  function getTurnMessageIdCandidates(turn) {
    if (!turn || typeof turn !== 'object') return [];
    const ids = [];
    const add = (value) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    };

    if (typeof turn.getAttribute === 'function') {
      add(turn.getAttribute('data-message-id'));
      add(turn.getAttribute('data-testid'));
      add(turn.id);
    }

    const messageNode =
      typeof turn.matches === 'function' && turn.matches('[data-message-id]')
        ? turn
        : turn.querySelector && turn.querySelector('[data-message-id]');
    if (messageNode && typeof messageNode.getAttribute === 'function') {
      add(messageNode.getAttribute('data-message-id'));
      add(messageNode.id);
    }

    return ids;
  }

  function getRecordKey(record) {
    if (!record) return '';
    return String(record.key || record.id || record.nodeId || `message-${record.index}`);
  }

  function recordMatchesTurn(record, turn) {
    if (!record || !turn) return false;
    const ids = getTurnMessageIdCandidates(turn);
    if (ids.length) {
      if (record.id && ids.includes(record.id)) return true;
      if (record.nodeId && ids.includes(record.nodeId)) return true;
    }

    const turnRole = determineMessageRole(turn, 0);
    if (record.role && turnRole && record.role !== turnRole) return false;

    const text = extractMessageTextFromTurn(turn);
    if (!text) return false;
    return getTextSignature(text) === record.fingerprint;
  }

  function extractConversationPartText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';

    const directText = part.text || part.content || part.value || part.transcript;
    if (typeof directText === 'string') return directText;

    if (directText && typeof directText === 'object') {
      const nested = directText.text || directText.value || directText.content;
      if (typeof nested === 'string') return nested;
    }

    if (part.content_type === 'image_asset_pointer' || part.asset_pointer) {
      return part.name ? `[Image: ${part.name}]` : '[Image]';
    }

    if (part.name && (part.mime_type || part.file_id || part.asset_pointer)) {
      return `[Attachment: ${part.name}]`;
    }

    return '';
  }

  function extractConversationMessageText(message) {
    if (!message || typeof message !== 'object') return '';
    const content = message.content;
    const pieces = [];

    if (typeof content === 'string') {
      pieces.push(content);
    } else if (content && typeof content === 'object') {
      if (Array.isArray(content.parts)) {
        content.parts.forEach((part) => {
          const text = extractConversationPartText(part);
          if (text) pieces.push(text);
        });
      }

      ['text', 'result', 'summary'].forEach((key) => {
        if (typeof content[key] === 'string') pieces.push(content[key]);
      });
    }

    const attachments = message.metadata && Array.isArray(message.metadata.attachments)
      ? message.metadata.attachments
      : [];
    attachments.forEach((attachment) => {
      const name = attachment && (attachment.name || attachment.file_name || attachment.filename);
      if (name) pieces.push(`[Attachment: ${name}]`);
    });

    return stripConversationMarkup(
      pieces
        .map((piece) => String(piece).trim())
        .filter(Boolean)
        .join('\n')
    ).trim();
  }

  // ChatGPT encodes citations, nav lists, and image groups inline as
  // private-use-area spans (\ue200 ... \ue201, fields split by \ue202). The site
  // renders them as chips; in copied text they are garbage.
  function stripConversationMarkup(text) {
    return String(text || '')
      .replace(/\ue200[\s\S]*?\ue201/g, '')
      .replace(/[\ue000-\uf8ff]/g, '')
      .replace(/[ \t]+\n/g, '\n');
  }

  function shouldIncludeConversationMessage(message) {
    if (!message || typeof message !== 'object') return false;
    const role = message.author && message.author.role;
    if (role !== 'user' && role !== 'assistant') return false;

    // Tool calls (web.run, python, computer.*, canmore.*) are assistant-authored
    // but addressed to a tool, not to the user. Visible turns are always
    // recipient "all" with text/multimodal_text content.
    const recipient = message.recipient || 'all';
    if (recipient !== 'all') return false;
    // Agent/thinking runs emit interim progress notes on the "commentary"
    // channel; the UI folds them into the "Worked for …" disclosure. Only the
    // "final" channel (or legacy messages with no channel) is the reply.
    if (message.channel && message.channel !== 'final') return false;
    const contentType = message.content && message.content.content_type;
    if (contentType && contentType !== 'text' && contentType !== 'multimodal_text') return false;

    const metadata = message.metadata || {};
    if (
      metadata.is_visually_hidden_from_conversation ||
      metadata.is_user_system_message ||
      metadata.hidden ||
      metadata.message_type === 'system'
    ) {
      return false;
    }

    return true;
  }

  function createDomMessageRecord(turn, index) {
    if (!turn) return null;
    const text = extractMessageTextFromTurn(turn, '.cc-checkbox-overlay');
    if (!text) return null;
    const role = determineMessageRole(turn, index);
    if (role !== 'user' && role !== 'assistant') return null;
    const ids = getTurnMessageIdCandidates(turn);
    const id = ids.find((candidate) => !candidate.startsWith('conversation-turn')) || ids[0] || `dom-${index}`;

    return {
      id,
      nodeId: id,
      key: id,
      role,
      text,
      createTimeMs: getTurnTimestampMs(turn),
      index,
      branchIndex: index,
      userIndex: role === 'user' ? index : null,
      source: 'dom',
      fingerprint: getTextSignature(text)
    };
  }

  const ConversationDataStore = (() => {
    const CACHE_TTL_MS = 30000;
    const FETCH_RETRY_MS = 120000;
    const ACCESS_TOKEN_TTL_MS = 300000;
    let cache = null;
    let pendingFetch = null;
    let accessTokenCache = { token: '', fetchedAt: 0 };
    const listeners = new Set();

    function getOrderedNodes(payload) {
      const mapping = payload && payload.mapping;
      if (!mapping || typeof mapping !== 'object') return [];

      const nodes = [];
      const seen = new Set();
      let current = payload.current_node;
      while (current && mapping[current] && !seen.has(current)) {
        const node = mapping[current];
        seen.add(current);
        nodes.push(node);
        current = node.parent;
      }

      if (nodes.length) return nodes.reverse();

      return Object.values(mapping).sort((a, b) => {
        const aTime = normalizeUnixTimestampMs(a && a.message && a.message.create_time) || 0;
        const bTime = normalizeUnixTimestampMs(b && b.message && b.message.create_time) || 0;
        return aTime - bTime;
      });
    }

    function parsePayload(payload, conversationId) {
      const orderedNodes = getOrderedNodes(payload);
      const messages = [];
      let userIndex = 0;

      orderedNodes.forEach((node, branchIndex) => {
        const message = node && node.message;
        if (!shouldIncludeConversationMessage(message)) return;

        const text = extractConversationMessageText(message);
        if (!text) return;

        const role = message.author.role;
        const id = String(message.id || node.id || `message-${messages.length}`);
        const nodeId = String(node.id || message.id || id);
        const record = {
          id,
          nodeId,
          key: `${nodeId}:${id}`,
          role,
          text,
          createTimeMs: normalizeUnixTimestampMs(message.create_time),
          index: messages.length,
          branchIndex,
          userIndex: role === 'user' ? userIndex : null,
          source: 'api',
          fingerprint: getTextSignature(text)
        };
        if (role === 'user') userIndex += 1;
        messages.push(record);
      });

      return {
        conversationId,
        currentNode: payload && payload.current_node,
        title: payload && payload.title,
        messages,
        userMessages: messages.filter((message) => message.role === 'user'),
        fetchedAt: Date.now()
      };
    }

    async function getAccessToken(force = false) {
      const now = Date.now();
      if (!force && accessTokenCache.token && now - accessTokenCache.fetchedAt < ACCESS_TOKEN_TTL_MS) {
        return accessTokenCache.token;
      }

      const response = await fetch(`${location.origin}/api/auth/session`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return '';

      const session = await response.json();
      const token = session && (session.accessToken || session.access_token || session.token);
      accessTokenCache = {
        token: typeof token === 'string' ? token : '',
        fetchedAt: Date.now()
      };
      return accessTokenCache.token;
    }

    async function fetchConversationWithToken(conversationId, accessToken) {
      const endpoint = `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
      const headers = { Accept: 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers
      });
    }

    // The backend answers an unauthenticated conversation GET with 404
    // ("conversation_inaccessible"), not 401/403, so the bearer token must be
    // sent up front; a stale token is refreshed once on any auth-shaped status.
    async function fetchConversation(conversationId) {
      let response = await fetchConversationWithToken(conversationId, await getAccessToken(false));
      if ([401, 403, 404].includes(response.status)) {
        const accessToken = await getAccessToken(true);
        if (accessToken) {
          response = await fetchConversationWithToken(conversationId, accessToken);
        }
      }
      if (!response.ok) {
        throw new Error(`Conversation fetch failed: ${response.status}`);
      }
      return response.json();
    }

    function getCachedSnapshot() {
      const conversationId = getConversationIdFromLocation();
      if (!conversationId || !cache || cache.conversationId !== conversationId) return null;
      return cache.snapshot || null;
    }

    async function refresh(options = {}) {
      const conversationId = getConversationIdFromLocation();
      if (!conversationId) {
        cache = null;
        return null;
      }

      const now = Date.now();
      if (
        !options.force &&
        cache &&
        cache.conversationId === conversationId &&
        cache.snapshot &&
        now - cache.fetchedAt < CACHE_TTL_MS
      ) {
        return cache.snapshot;
      }

      if (
        !options.force &&
        cache &&
        cache.conversationId === conversationId &&
        cache.error &&
        now - cache.fetchedAt < FETCH_RETRY_MS
      ) {
        return cache.snapshot;
      }

      if (pendingFetch && pendingFetch.conversationId === conversationId) {
        return pendingFetch.promise;
      }

      const promise = fetchConversation(conversationId)
        .then((payload) => {
          const snapshot = parsePayload(payload, conversationId);
          cache = { conversationId, snapshot, fetchedAt: Date.now(), error: null };
          listeners.forEach((listener) => listener(snapshot));
          return snapshot;
        })
        .catch((error) => {
          console.warn('ChatGPT UX Suite: full conversation fetch unavailable; falling back to rendered messages.', error);
          cache = { conversationId, snapshot: cache && cache.conversationId === conversationId ? cache.snapshot : null, fetchedAt: Date.now(), error };
          return cache.snapshot;
        })
        .finally(() => {
          if (pendingFetch && pendingFetch.conversationId === conversationId) pendingFetch = null;
        });

      pendingFetch = { conversationId, promise };
      return promise;
    }

    function findRecordForTurn(turn, records) {
      const list = records || (getCachedSnapshot() && getCachedSnapshot().messages) || [];
      if (!turn || !list.length) return null;
      return list.find((record) => recordMatchesTurn(record, turn)) || null;
    }

    /** Called with every freshly fetched snapshot. */
    function subscribe(listener) {
      listeners.add(listener);
    }

    return {
      getCachedSnapshot,
      refresh,
      subscribe,
      findRecordForTurn,
      getRecordKey
    };
  })();

  // =============================================================================
  // Feature 1: Token Counter
  // =============================================================================
  const TokenCounter = (function () {
    const COUNTER_ID = 'chatgpt-token-counter';
    const DETAILS_STORAGE_KEY = 'chatgptTokenCounterDetails';
    const UPDATE_DEBOUNCE_MS = 400;
    const ATTACHMENT_SELECTORS = [
      '[data-testid*="attachment"]',
      '[data-testid*="upload"]',
      '[data-testid*="file"]',
      '[data-testid*="resource"]',
      'a[download]',
      '[data-file-name]',
      '[data-filename]',
      '[aria-label*="attachment" i]',
      '[aria-label*="uploaded" i]'
    ];
    const SIZE_PATTERN = /([\d.,]+\s*(?:[kmgt]i?b|[kmgt]?b|bytes?))/i;

    let pendingUpdate = null;
    let lastSignature = '';
    let mutationObserver = null;
    let counterDismissed = false;
    let enabled = true;

    const estimator = window.ChatGPTTokenEstimator;

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return null;
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
      }
      const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
      return `${value.toFixed(precision)} ${units[unitIndex]}`;
    }

    function parseBytesValue(value, source) {
      if (value == null) return null;
      const string = String(value).trim();
      if (!string) return null;
      const patternMatch = string.match(SIZE_PATTERN);
      if (patternMatch) {
        const sizeText = patternMatch[1];
        const bytes = estimator.parseFileSizeToBytes(sizeText);
        if (bytes) return { sizeText, bytes, source };
      }
      const numeric = string.replace(/[^0-9.]/g, '');
      if (!numeric) return null;
      const bytes = Number(numeric);
      if (!Number.isFinite(bytes) || bytes <= 0) return null;
      return { sizeText: formatBytes(bytes), bytes, source };
    }

    function resolveAttachmentSize(element, candidates) {
      let resolved = null;
      for (const candidate of candidates) {
        const parsed = parseBytesValue(candidate, 'text');
        if (parsed) {
          resolved = parsed;
          if (parsed.sizeText && parsed.bytes) break;
        }
      }
      const attributeNames = ['data-size', 'data-filesize', 'data-file-size', 'data-size-bytes', 'data-bytes'];
      const attributeCandidates = [];
      attributeNames.forEach((name) => {
        const attr = element.getAttribute(name);
        if (attr) attributeCandidates.push({ value: attr, source: `attr:${name}` });
      });
      for (const candidate of attributeCandidates) {
        const parsed = parseBytesValue(candidate.value, candidate.source);
        if (!parsed) continue;
        if (!resolved) {
          resolved = parsed;
          if (parsed.sizeText && parsed.bytes) break;
          continue;
        }
        if (!resolved.bytes && parsed.bytes) {
          resolved = { sizeText: resolved.sizeText || parsed.sizeText, bytes: parsed.bytes, source: parsed.source };
        }
        if (resolved.sizeText && resolved.bytes) break;
      }
      return resolved || { sizeText: null, bytes: null, source: null };
    }

    function createMetaRow(labelText, dataRole) {
      const row = document.createElement('div');
      row.className = 'token-counter__meta-row';
      const label = document.createElement('span');
      label.className = 'token-counter__meta-label';
      label.textContent = labelText;
      const value = document.createElement('span');
      value.className = 'token-counter__meta-value';
      value.dataset.role = dataRole;
      const defaults = {
        'user-token-count': '0 tokens',
        'assistant-token-count': '0 tokens',
        'word-count': '0 words',
        'attachment-count': '0 attachments'
      };
      value.textContent = defaults[dataRole] || '0';
      row.appendChild(label);
      row.appendChild(value);
      return row;
    }

    function setDetailsVisibility(container, expanded, persistPreference) {
      const details = container.querySelector('.token-counter__details');
      const toggle = container.querySelector('[data-role="details-toggle"]');
      if (!details || !toggle) return;
      details.hidden = !expanded;
      container.classList.toggle('token-counter--expanded', expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.textContent = expanded ? '-' : '+';
      toggle.title = expanded ? 'Hide details' : 'Show details';
      if (persistPreference) {
        try {
          localStorage.setItem(DETAILS_STORAGE_KEY, expanded ? 'expanded' : 'collapsed');
        } catch (error) { }
      }
    }

    function applyStoredDetailsPreference(container) {
      let expanded = false;
      try {
        const stored = localStorage.getItem(DETAILS_STORAGE_KEY);
        if (stored === 'expanded') expanded = true;
      } catch (error) { }
      setDetailsVisibility(container, expanded, false);
    }

    function hideCounter(container) {
      const target = container || document.getElementById(COUNTER_ID);
      if (!target) return;
      counterDismissed = true;
      target.remove();
    }

    function createCounterElement() {
      const container = document.createElement('section');
      container.id = COUNTER_ID;
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');

      const header = document.createElement('div');
      header.className = 'token-counter__header';

      const title = document.createElement('span');
      title.className = 'token-counter__title';
      title.textContent = 'Tokens';

      const actions = document.createElement('div');
      actions.className = 'token-counter__actions';

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'token-counter__toggle';
      toggleButton.dataset.role = 'details-toggle';
      toggleButton.setAttribute('aria-expanded', 'false');
      toggleButton.title = 'Show details';
      toggleButton.textContent = '+';
      toggleButton.addEventListener('click', () => {
        const expanded = toggleButton.getAttribute('aria-expanded') !== 'true';
        setDetailsVisibility(container, expanded, true);
      });

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'token-counter__close';
      closeButton.title = 'Hide counter';
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => hideCounter(container));

      actions.appendChild(toggleButton);
      actions.appendChild(closeButton);
      header.appendChild(title);
      header.appendChild(actions);

      const primary = document.createElement('div');
      primary.className = 'token-counter__primary';
      const countLabel = document.createElement('span');
      countLabel.textContent = 'Tokens';
      countLabel.className = 'token-counter__approx-label';
      const countValue = document.createElement('strong');
      countValue.dataset.role = 'token-count';
      countValue.textContent = '~0';
      primary.appendChild(countLabel);
      primary.appendChild(countValue);

      const meta = document.createElement('div');
      meta.className = 'token-counter__meta';
      [['You', 'user-token-count'], ['ChatGPT', 'assistant-token-count'], ['Words', 'word-count'], ['Attachments', 'attachment-count']]
        .forEach(([label, role]) => meta.appendChild(createMetaRow(label, role)));

      const details = document.createElement('div');
      details.className = 'token-counter__details';
      details.hidden = true;
      details.appendChild(meta);

      container.appendChild(header);
      container.appendChild(primary);
      container.appendChild(details);
      document.body.appendChild(container);
      return container;
    }

    function ensureCounterElement() {
      if (counterDismissed || !enabled) return null;
      let container = document.getElementById(COUNTER_ID);
      if (!container) {
        container = createCounterElement();
        applyStoredDetailsPreference(container);
      }
      return container;
    }

    function gatherAttachments(root) {
      const scope = root instanceof HTMLElement ? root : document;
      const elements = Array.from(scope.querySelectorAll(ATTACHMENT_SELECTORS.join(', ')));
      const attachments = [];
      const seen = new Set();
      elements.forEach((element) => {
        const anchor = element.closest('[data-testid*="attachment"]') || element.closest('[data-testid*="file"]') || element;
        if (!isElementVisible(anchor)) return;
        const candidates = [];
        ['data-file-name', 'data-filename', 'title', 'aria-label'].forEach((attr) => {
          if (anchor.hasAttribute(attr)) candidates.push(anchor.getAttribute(attr));
        });
        const textContent = anchor.textContent?.trim();
        if (textContent) candidates.push(textContent);
        const resolvedSize = resolveAttachmentSize(anchor, candidates);
        if (!resolvedSize.bytes && !resolvedSize.sizeText) return;
        let label = candidates.find((c) => c && !SIZE_PATTERN.test(c)) || 'Attachment';
        if (label.length > 80) label = label.slice(0, 77) + '…';
        const sig = `${label}|${resolvedSize.sizeText || ''}|${resolvedSize.bytes || ''}`.toLowerCase();
        if (seen.has(sig)) return;
        seen.add(sig);
        attachments.push({ label, sizeText: resolvedSize.sizeText, bytes: resolvedSize.bytes });
      });
      return attachments;
    }

    function gatherConversation() {
      const main = getConversationMain();
      if (!main) return { messages: [], attachments: [] };
      const messages = getRenderedTurns().map(({ turn, index, role }) => {
        const text = extractMessageTextFromTurn(turn);
        if (!text) return null;
        const messageNode = turn.matches('[data-message-id]') ? turn : turn.querySelector('[data-message-id]');
        return {
          id: messageNode?.getAttribute('data-message-id') || turn.getAttribute('data-testid') || turn.id || `msg-${index}`,
          role,
          text
        };
      }).filter(Boolean);
      return { messages, attachments: gatherAttachments(main) };
    }

    function estimateConversationStats(messages, attachments) {
      if (!messages.length && !attachments.length) return null;
      const enrichedMessages = messages.map((msg) => {
        const stats = estimator.estimateTokensFromText(msg.text);
        return { ...msg, stats };
      });
      const totals = enrichedMessages.reduce((acc, msg) => {
        acc.totalTokens += msg.stats.tokens;
        acc.totalWords += msg.stats.words;
        acc.byRole[msg.role] = (acc.byRole[msg.role] || 0) + msg.stats.tokens;
        return acc;
      }, { totalTokens: 0, totalWords: 0, byRole: {} });
      const attachmentDetails = attachments.map((att) => {
        let bytes = att.bytes;
        let tokens = 0;
        if (!bytes && att.sizeText) {
          const est = estimator.estimateTokensFromFileSizeString(att.sizeText);
          bytes = est.bytes;
          tokens = est.tokens;
        } else if (bytes) {
          tokens = estimator.estimateTokensFromBytes(bytes);
        }
        return { ...att, bytes, tokens, sizeText: att.sizeText || formatBytes(bytes) };
      });
      const attachmentTokens = attachmentDetails.reduce((sum, item) => sum + item.tokens, 0);
      return {
        enrichedMessages,
        attachmentDetails,
        snapshot: {
          totalTokens: totals.totalTokens + attachmentTokens,
          userTokens: totals.byRole.user || 0,
          assistantTokens: totals.byRole.assistant || 0,
          totalWords: totals.totalWords,
          attachments: attachmentDetails.map((item) => ({ label: item.label, sizeText: item.sizeText, tokens: item.tokens }))
        }
      };
    }

    function formatNumber(value) {
      return Number.isFinite(value) ? value.toLocaleString() : '0';
    }

    function renderCounterSnapshot(container, snapshot) {
      if (!container || !snapshot) return;
      const totalTokens = snapshot.totalTokens || 0;
      const userTokens = snapshot.userTokens || 0;
      const assistantTokens = snapshot.assistantTokens || 0;
      const totalWords = snapshot.totalWords || 0;
      const attachments = snapshot.attachments || [];

      const tokenNode = container.querySelector('[data-role="token-count"]');
      const userTokenNode = container.querySelector('[data-role="user-token-count"]');
      const assistantTokenNode = container.querySelector('[data-role="assistant-token-count"]');
      const wordsNode = container.querySelector('[data-role="word-count"]');
      const attachmentsNode = container.querySelector('[data-role="attachment-count"]');

      if (tokenNode) tokenNode.textContent = `~${formatNumber(totalTokens)}`;
      if (userTokenNode) userTokenNode.textContent = `${formatNumber(userTokens)} tokens`;
      if (assistantTokenNode) assistantTokenNode.textContent = `${formatNumber(assistantTokens)} tokens`;
      if (wordsNode) wordsNode.textContent = `${formatNumber(totalWords)} words`;
      
      // Add hover tooltip with prompt/completion breakdown
      container.title = `Prompt: ${formatNumber(userTokens)} / Completion: ${formatNumber(assistantTokens)}`;
      if (attachmentsNode) {
        const attachmentCount = attachments.length;
        const attachmentTokens = attachments.reduce((sum, item) => sum + (item.tokens || 0), 0);
        if (attachmentTokens) {
          attachmentsNode.textContent = `+${formatNumber(attachmentTokens)} tokens`;
          attachmentsNode.title = attachments.map((item) => `${item.label}${item.sizeText ? ` (${item.sizeText})` : ''} ≈ ${formatNumber(item.tokens)} tokens`).join('\n');
        } else if (attachmentCount) {
          attachmentsNode.textContent = `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;
        } else {
          attachmentsNode.textContent = '0 attachments';
          attachmentsNode.removeAttribute('title');
        }
      }
    }

    function buildSignature(messages, attachments, totalTokens) {
      const msgSig = messages.map((m) => `${m.id}:${m.role}:${m.stats.tokens}:${m.text.length}`).join('|');
      const attSig = attachments.map((a) => `${a.label}:${a.sizeText || ''}:${a.tokens}`).join('|');
      return `${location.href}|${totalTokens}|${msgSig}|${attSig}`;
    }

    function updateCounter() {
      pendingUpdate = null;
      if (!enabled) return;
      const container = ensureCounterElement();
      if (!container) return;
      const { messages, attachments } = gatherConversation();
      const estimation = estimateConversationStats(messages, attachments);
      if (!estimation) {
        const emptySignature = `${location.href}|empty`;
        if (container.dataset.signature !== emptySignature) {
          renderCounterSnapshot(container, {
            totalTokens: 0,
            userTokens: 0,
            assistantTokens: 0,
            totalWords: 0,
            attachments: []
          });
          container.dataset.signature = emptySignature;
        }
        lastSignature = emptySignature;
        return;
      }
      const { enrichedMessages, attachmentDetails, snapshot } = estimation;
      const signature = buildSignature(enrichedMessages, attachmentDetails, snapshot.totalTokens);
      if (signature === lastSignature && container.dataset.signature === signature) return;
      lastSignature = signature;
      renderCounterSnapshot(container, snapshot);
      container.dataset.signature = signature;
    }

    function scheduleUpdate() {
      if (pendingUpdate) clearTimeout(pendingUpdate);
      pendingUpdate = setTimeout(updateCounter, UPDATE_DEBOUNCE_MS);
    }

    function initObservers() {
      if (mutationObserver) return;
      mutationObserver = new MutationObserver(scheduleUpdate);
      mutationObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    }

    function enable() {
      enabled = true;
      counterDismissed = false;
      lastSignature = '';
      scheduleUpdate();
      initObservers();
    }

    function disable() {
      enabled = false;
      lastSignature = '';
      const container = document.getElementById(COUNTER_ID);
      if (container) container.remove();
    }

    function init() {
      if (!estimator) {
        console.warn('ChatGPT UX Suite: Token estimator not available');
        return;
      }
      scheduleUpdate();
      initObservers();
      window.addEventListener('resize', scheduleUpdate);
      window.addEventListener('hashchange', scheduleUpdate);
      document.addEventListener('visibilitychange', scheduleUpdate);
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Feature 2: Prompt Navigator
  // =============================================================================
  const PromptNavigator = (function () {
    const WIDGET_ID = 'prompt-navigator-widget';
    const DUPLICATE_TRIGGER_WINDOW_MS = 140;
    let enabled = true;
    let prompts = [];
    let promptRecords = [];
    let lastAnchor = null;
    let lastJumpTime = 0;
    let lastJumpTrigger = { source: '', direction: '', timestamp: 0 };
    let widgetLabel = null;
    let revertTimer = null;
    let refreshTimer = null;
    let scrollTimer = null;
    let dataRefreshTimer = null;

    function scan() {
      const rendered = getRenderedTurns({ includeReasoning: true });
      const userPrompts = rendered.filter(({ role }) => role === 'user').map(({ turn }) => turn);
      prompts = userPrompts.length === 0 ? rendered.map(({ turn }) => turn) : userPrompts;

      const snapshot = ConversationDataStore.getCachedSnapshot();
      promptRecords = snapshot && snapshot.userMessages && snapshot.userMessages.length
        ? snapshot.userMessages
        : [];
      return prompts;
    }

    async function refreshConversationData(options = {}) {
      const snapshot = await ConversationDataStore.refresh(options);
      if (snapshot && snapshot.userMessages) {
        promptRecords = snapshot.userMessages;
      }
      scan();
      updateStatus();
      return snapshot;
    }

    function scheduleConversationRefresh(force = false) {
      if (dataRefreshTimer) clearTimeout(dataRefreshTimer);
      dataRefreshTimer = setTimeout(() => {
        dataRefreshTimer = null;
        refreshConversationData({ force }).catch((error) => {
          console.warn('PromptNav conversation refresh failed:', error);
        });
      }, force ? 50 : 500);
    }

    function getPromptTotal() {
      return promptRecords.length || prompts.length;
    }

    function getScrollContext() {
      let container = null;
      const scrollProbe = prompts[0] || getConversationMain();
      if (scrollProbe) {
        let current = scrollProbe.parentElement || scrollProbe;
        while (current) {
          const style = window.getComputedStyle(current);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
            container = current;
            break;
          }
          if (current === document.body || current === document.documentElement) break;
          current = current.parentElement;
        }
      }
      if (!container) container = window;
      if (container === window || container === document.documentElement || container === document.body) {
        return { container: window, scrollTop: window.scrollY, viewHeight: window.innerHeight, containerTop: 0, isWindow: true };
      }
      const rect = container.getBoundingClientRect();
      return { container, scrollTop: container.scrollTop, viewHeight: rect.height, containerTop: rect.top, isWindow: false };
    }

    function getMaxScroll(context) {
      return Math.max(0, (context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight) - context.viewHeight);
    }

    function setScrollTop(context, top, behavior = 'smooth') {
      const target = Math.max(0, Math.min(top, getMaxScroll(context)));
      if (context.isWindow) {
        window.scrollTo({ top: target, behavior });
      } else {
        context.container.scrollTo({ top: target, behavior });
      }
    }

    function buildAnchors(context) {
      const anchors = [];
      const largeThreshold = context.viewHeight * 0.8;
      prompts.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const topY = context.scrollTop + (rect.top - context.containerTop);
        const height = rect.height;
        anchors.push({ element: el, kind: 'top', y: topY, promptIndex: index });
        if (height > largeThreshold) {
          anchors.push({ element: el, kind: 'bottom', y: topY + height, promptIndex: index });
        }
      });
      const scrollHeight = context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight;
      anchors.push({ element: null, kind: 'chat-bottom', y: scrollHeight, promptIndex: prompts.length });
      return anchors.sort((a, b) => a.y - b.y);
    }

    function findTargetAnchor(anchors, context, direction) {
      const currentScroll = context.scrollTop;
      const scrollOffset = context.viewHeight * 0.15;

      // Helper to calculate what scroll position an anchor would result in
      function getTargetScroll(anchor) {
        if (anchor.kind === 'chat-bottom') {
          return (context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight) - context.viewHeight;
        } else if (anchor.kind === 'top') {
          return anchor.y - scrollOffset;
        } else {
          return anchor.y - context.viewHeight + context.viewHeight * 0.2;
        }
      }

      let currentIndex = -1;
      if (lastAnchor) {
        currentIndex = anchors.findIndex((a) => a.element === lastAnchor.element && a.kind === lastAnchor.kind);
      }

      if (currentIndex === -1) {
        // No valid last anchor - find target directly based on direction
        // This guarantees we always scroll in the correct direction
        const tolerance = 10; // pixels

        if (direction === 'previous') {
          // Find the last anchor that would scroll us UP (target scroll < current scroll)
          for (let i = anchors.length - 1; i >= 0; i--) {
            if (getTargetScroll(anchors[i]) < currentScroll - tolerance) {
              return anchors[i];
            }
          }
          return null; // No anchor above
        } else {
          // Find the first anchor that would scroll us DOWN (target scroll > current scroll)
          for (let i = 0; i < anchors.length; i++) {
            if (getTargetScroll(anchors[i]) > currentScroll + tolerance) {
              return anchors[i];
            }
          }
          return null; // No anchor below
        }
      }

      // Have a valid lastAnchor - use sequential navigation
      if (direction === 'next') {
        return currentIndex >= anchors.length - 1 ? null : anchors[currentIndex + 1];
      } else {
        return currentIndex <= 0 ? null : anchors[currentIndex - 1];
      }
    }

    function scrollToAnchor(anchor, context) {
      const now = Date.now();
      const isRapid = (now - lastJumpTime) < 300;
      lastJumpTime = now;
      const behavior = isRapid ? 'auto' : 'smooth';
      let targetScrollTop = 0;
      if (anchor.kind === 'chat-bottom') {
        targetScrollTop = (context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight) - context.viewHeight;
      } else if (anchor.kind === 'top') {
        targetScrollTop = anchor.y - context.viewHeight * 0.15;
      } else {
        targetScrollTop = anchor.y - context.viewHeight + context.viewHeight * 0.2;
      }
      const maxScroll = (context.isWindow ? document.documentElement.scrollHeight : context.container.scrollHeight) - context.viewHeight;
      targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
      if (context.isWindow) {
        window.scrollTo({ top: targetScrollTop, behavior });
      } else {
        context.container.scrollTo({ top: targetScrollTop, behavior });
      }
    }

    function scrollToTurnElement(turn, context) {
      const rect = turn.getBoundingClientRect();
      const topY = context.scrollTop + (rect.top - context.containerTop);
      scrollToAnchor({ element: turn, kind: 'top', y: topY, promptIndex: 0 }, context);
    }

    function getPromptIndexForMessageRecord(record) {
      if (!record || !promptRecords.length) return -1;
      if (record.role === 'user' && Number.isFinite(record.userIndex)) return record.userIndex;
      let promptIndex = -1;
      promptRecords.forEach((prompt, index) => {
        if (prompt.index <= record.index) promptIndex = index;
      });
      return promptIndex;
    }

    function getMountedPromptObservation(targetIndex, context) {
      if (!promptRecords.length) return null;
      const thresholdY = context.scrollTop + (context.viewHeight / 2);
      const observations = [];
      getRenderedTurns().forEach(({ turn }) => {
        const record = ConversationDataStore.findRecordForTurn(turn);
        const promptIndex = getPromptIndexForMessageRecord(record);
        if (promptIndex < 0) return;
        const rect = turn.getBoundingClientRect();
        const topY = context.scrollTop + (rect.top - context.containerTop);
        observations.push({ turn, record, promptIndex, topY });
      });

      if (!observations.length) return null;

      let active = observations[0];
      for (const observation of observations) {
        if (observation.topY <= thresholdY) active = observation;
      }

      const closest = observations.reduce((best, observation) => {
        if (!best) return observation;
        return Math.abs(observation.promptIndex - targetIndex) < Math.abs(best.promptIndex - targetIndex)
          ? observation
          : best;
      }, null);

      return { active, closest, observations };
    }

    function findMountedTurnForPromptRecord(record) {
      const main = getConversationMain();
      if (!main || !record) return null;
      const turns = collectConversationTurns(main);
      return turns.find((turn) => isElementVisible(turn) && recordMatchesTurn(record, turn)) || null;
    }

    async function scrollToPromptRecord(record, targetIndex) {
      const total = promptRecords.length;
      let context = getScrollContext();
      const maxScroll = getMaxScroll(context);
      if (maxScroll <= 0) return false;

      const ratio = total <= 1 ? 0 : targetIndex / (total - 1);
      setScrollTop(context, maxScroll * ratio, 'smooth');

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await delay(140 + attempt * 45);
        scan();
        context = getScrollContext();

        const mounted = findMountedTurnForPromptRecord(record);
        if (mounted) {
          scrollToTurnElement(mounted, context);
          lastAnchor = { element: mounted, kind: 'top' };
          return true;
        }

        const observation = getMountedPromptObservation(targetIndex, context);
        if (observation && observation.closest) {
          const currentMax = getMaxScroll(context);
          const closestIndex = observation.closest.promptIndex;
          const deltaRatio = total <= 1 ? 0 : (targetIndex - closestIndex) / (total - 1);
          const minStep = context.viewHeight * 0.65;
          const rawDelta = deltaRatio * currentMax;
          const direction = Math.sign(rawDelta);
          const delta = direction === 0 ? 0 : Math.max(Math.abs(rawDelta), minStep) * direction;
          setScrollTop(context, context.scrollTop + delta, 'auto');
        } else {
          setScrollTop(context, getMaxScroll(context) * ratio, 'auto');
        }
      }

      return false;
    }

    async function jumpUsingConversationData(direction) {
      const total = promptRecords.length;
      if (!total) return { success: false, reason: 'no_prompts' };

      let currentIndex = getCurrentPromptIndex();
      if (currentIndex < 0) currentIndex = direction === 'previous' ? total : -1;

      const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (targetIndex < 0 || targetIndex >= total) {
        return { success: false, reason: 'no_target' };
      }

      const targetRecord = promptRecords[targetIndex];
      const context = getScrollContext();
      const mounted = findMountedTurnForPromptRecord(targetRecord);
      if (mounted) {
        scrollToTurnElement(mounted, context);
        lastAnchor = { element: mounted, kind: 'top' };
        return { success: true, promptIndex: targetIndex, total };
      }

      const mountedAfterScroll = await scrollToPromptRecord(targetRecord, targetIndex);
      return { success: true, promptIndex: targetIndex, total, virtualized: !mountedAfterScroll };
    }

    async function jump(direction) {
      if (promptRecords.length) {
        return jumpUsingConversationData(direction);
      }

      if (!prompts.length) return { success: false, reason: 'no_prompts' };
      const context = getScrollContext();
      const anchors = buildAnchors(context);
      if (!anchors.length) return { success: false, reason: 'no_anchors' };
      const target = findTargetAnchor(anchors, context, direction);
      if (!target) return { success: false, reason: 'no_target' };
      scrollToAnchor(target, context);
      lastAnchor = { element: target.element, kind: target.kind };
      return { success: true, promptIndex: target.promptIndex, total: prompts.length };
    }

    function getCurrentPromptIndex() {
      if (promptRecords.length) {
        const context = getScrollContext();
        const observation = getMountedPromptObservation(-1, context);
        if (observation && observation.active) {
          return observation.active.promptIndex;
        }

        const maxScroll = getMaxScroll(context);
        if (maxScroll > 0) {
          const ratio = Math.max(0, Math.min(1, context.scrollTop / maxScroll));
          return Math.max(0, Math.min(promptRecords.length - 1, Math.round(ratio * (promptRecords.length - 1))));
        }
        return promptRecords.length ? 0 : -1;
      }

      if (!prompts.length) return -1;
      const context = getScrollContext();
      const thresholdY = context.scrollTop + (context.viewHeight / 2);
      let activeIndex = -1;
      for (let i = 0; i < prompts.length; i++) {
        const rect = prompts[i].getBoundingClientRect();
        const topY = context.scrollTop + (rect.top - context.containerTop);
        if (topY <= thresholdY) activeIndex = i;
        else break;
      }
      return activeIndex;
    }

    function injectStyles() {
      if (document.getElementById('prompt-navigator-style')) return;
      const style = document.createElement('style');
      style.id = 'prompt-navigator-style';
      style.textContent = `
        #${WIDGET_ID} {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 99999;
          display: flex;
          flex-direction: column;
          padding: 6px 10px;
          background: #202123;
          color: #ececf1;
          border: 1px solid #565869;
          border-radius: 6px;
          font-family: sans-serif;
          font-size: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          user-select: none;
          opacity: 0.9;
          transition: opacity 0.2s;
        }
        #${WIDGET_ID}:hover { opacity: 1; }
        .pn-controls {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #${WIDGET_ID} button {
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
        }
        #${WIDGET_ID} button:hover { background: rgba(255,255,255,0.1); }
        .pn-label { font-weight: 600; min-width: 60px; text-align: center; }
        .pn-error { border-color: #ef4444 !important; color: #ef4444 !important; }
      `;
      document.head.appendChild(style);
    }

    function createWidget() {
      if (document.getElementById(WIDGET_ID)) return;
      const container = document.createElement('div');
      container.id = WIDGET_ID;
      
      // Controls row (label + buttons)
      const controls = document.createElement('div');
      controls.className = 'pn-controls';
      
      const label = document.createElement('span');
      label.className = 'pn-label';
      label.textContent = 'PromptNav';
      widgetLabel = label;

      const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const prevShortcutHint = isMacPlatform ? 'Alt+E / Ctrl+E' : 'Alt+E';
      const nextShortcutHint = isMacPlatform ? 'Alt+D / Ctrl+D' : 'Alt+D';
      
      const btnUp = document.createElement('button');
      btnUp.textContent = '▲';
      btnUp.title = `Previous Prompt (${prevShortcutHint})`;
      btnUp.onclick = (e) => { e.stopPropagation(); handleJump('previous', 'widget-button'); };
      
      const btnDown = document.createElement('button');
      btnDown.textContent = '▼';
      btnDown.title = `Next Prompt (${nextShortcutHint})`;
      btnDown.onclick = (e) => { e.stopPropagation(); handleJump('next', 'widget-button'); };
      
      controls.appendChild(label);
      controls.appendChild(btnUp);
      controls.appendChild(btnDown);
      container.appendChild(controls);
      document.body.appendChild(container);
    }

    function updateStatus() {
      if (!widgetLabel || revertTimer) return;
      const total = getPromptTotal();
      const currentIndex = getCurrentPromptIndex();
      if (total === 0) {
        widgetLabel.textContent = 'No Prompts';
      } else if (currentIndex >= 0) {
        widgetLabel.textContent = `${currentIndex + 1} / ${total}`;
      } else {
        widgetLabel.textContent = `- / ${total}`;
      }
    }

    function flashMessage(msg, isError = false) {
      if (!widgetLabel) return;
      const widget = document.getElementById(WIDGET_ID);
      if (isError && widget) widget.classList.add('pn-error');
      widgetLabel.textContent = msg;
      if (revertTimer) clearTimeout(revertTimer);
      revertTimer = setTimeout(() => {
        if (widget) widget.classList.remove('pn-error');
        revertTimer = null;
        updateStatus();
      }, 1500);
    }

    function isEditableTarget(target) {
      const element = target && target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
      if (!element) return false;
      if (element.isContentEditable) return true;
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true;
      return typeof element.closest === 'function'
        && !!element.closest('[contenteditable="true"], [role="textbox"]');
    }

    // Shortcuts are strings like "Alt+E" or "Ctrl+Shift+K" (settings
    // shortcutPrev / shortcutNext). Matching is on event.code for letters
    // and digits so Alt-modified keys (which change event.key on macOS)
    // still match. The default Alt combos also accept Ctrl on macOS, where
    // Alt+letter types a symbol in some layouts.
    function parseShortcut(spec) {
      const parts = String(spec || '').split('+').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) return null;
      const key = parts.pop().toLowerCase();
      const mods = new Set(parts.map((p) => p.toLowerCase()));
      return {
        key,
        alt: mods.has('alt') || mods.has('option'),
        ctrl: mods.has('ctrl') || mods.has('control'),
        shift: mods.has('shift'),
        meta: mods.has('meta') || mods.has('cmd') || mods.has('command')
      };
    }

    function shortcutMatches(spec, event, allowCtrlAlias) {
      const s = parseShortcut(spec);
      if (!s) return false;
      const code = (event.code || '').toLowerCase();
      const key = (event.key || '').toLowerCase();
      const keyHit = code === 'key' + s.key || code === 'digit' + s.key || code === s.key || key === s.key;
      if (!keyHit) return false;
      if (event.shiftKey !== s.shift || event.metaKey !== s.meta) return false;
      if (event.altKey === s.alt && event.ctrlKey === s.ctrl) return true;
      return allowCtrlAlias && s.alt && !s.ctrl && event.ctrlKey && !event.altKey;
    }

    function getShortcutDirection(event) {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const prev = currentSettings.shortcutPrev || DEFAULT_SETTINGS.shortcutPrev;
      const next = currentSettings.shortcutNext || DEFAULT_SETTINGS.shortcutNext;
      if (shortcutMatches(prev, event, isMac && prev === DEFAULT_SETTINGS.shortcutPrev)) return 'previous';
      if (shortcutMatches(next, event, isMac && next === DEFAULT_SETTINGS.shortcutNext)) return 'next';
      return null;
    }

    function shouldIgnoreDuplicateJump(direction, source) {
      const now = Date.now();
      const isDuplicate = lastJumpTrigger.direction === direction
        && lastJumpTrigger.source
        && lastJumpTrigger.source !== source
        && (now - lastJumpTrigger.timestamp) < DUPLICATE_TRIGGER_WINDOW_MS;

      lastJumpTrigger = { direction, source, timestamp: now };
      return isDuplicate;
    }

    async function handleJump(direction, source = 'unknown') {
      if (shouldIgnoreDuplicateJump(direction, source)) return;
      try {
        scan();
        if (!promptRecords.length) {
          await refreshConversationData({ force: false });
        }
        const result = await jump(direction);
        if (result.success) {
          updateStatus();
        } else {
          if (result.reason === 'no_prompts') flashMessage('No Prompts', true);
          else if (result.reason === 'no_target') flashMessage('End of Chat', false);
          else flashMessage('Error', true);
        }
      } catch (err) {
        console.error('PromptNav Error:', err);
        flashMessage('Error!', true);
      }
    }

    function setupInputHandler() {
      window.addEventListener('keydown', (e) => {
        if (!enabled) return;
        if (isEditableTarget(e.target)) return;
        const direction = getShortcutDirection(e);
        if (!direction) return;
        e.preventDefault();
        e.stopPropagation();
        handleJump(direction, 'inline-shortcut');
      }, { capture: true });

      host.onCommand((msg) => {
        if (msg && msg.type === 'PROMPT_JUMP' && enabled) {
          handleJump(msg.direction, 'extension-command');
        }
      });
    }

    function setupObservers() {
      const observer = new MutationObserver(() => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          scan();
          updateStatus();
          scheduleConversationRefresh(false);
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      window.addEventListener('scroll', () => {
        if (scrollTimer) return;
        scrollTimer = setTimeout(() => {
          updateStatus();
          scrollTimer = null;
        }, 100);
      }, { capture: true, passive: true });

      const main = getConversationMain();
      if (main) {
        main.addEventListener('scroll', () => {
          if (scrollTimer) return;
          scrollTimer = setTimeout(() => {
            updateStatus();
            scrollTimer = null;
          }, 100);
        }, { passive: true });
      }
    }

    function enable() {
      enabled = true;
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) {
        injectStyles();
        createWidget();
      } else {
        widget.style.display = 'flex';
      }
      scan();
      updateStatus();
      scheduleConversationRefresh(false);
    }

    function disable() {
      enabled = false;
      const widget = document.getElementById(WIDGET_ID);
      if (widget) widget.style.display = 'none';
    }

    function init() {
      injectStyles();
      createWidget();
      setupInputHandler();
      scan();
      updateStatus();
      setupObservers();
      scheduleConversationRefresh(true);
      setInterval(() => {
        scan();
        updateStatus();
        scheduleConversationRefresh(false);
      }, 2000);
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Feature 3: Response Styling
  // =============================================================================
  const ResponseStyling = (function () {
    const MODEL_CLASS = 'chatgpt-styling-model-response';
    const PROCESSED_ATTR = 'data-ux-styled';
    let enabled = true;
    let timeout = null;

    function isThinkingPanel(element) {
      if (!element) return false;
      // Check for thinking panel indicators in text content
      const text = element.textContent || '';
      if (/^Thought for \d+/i.test(text.trim()) || /^Thinking/i.test(text.trim())) {
        return true;
      }
      // Check for summary/details elements often used for collapsible thinking
      if (element.tagName === 'SUMMARY' || element.tagName === 'DETAILS') {
        return true;
      }
      if (element.querySelector('summary, details')) {
        const summaryText = element.querySelector('summary')?.textContent || '';
        if (/thought|thinking/i.test(summaryText)) {
          return true;
        }
      }
      return false;
    }

    function styleTurns() {
      if (!enabled) return;
      getRenderedTurns({ includeReasoning: true }).forEach(({ turn, role }) => {
        if (turn.hasAttribute(PROCESSED_ATTR)) return;
        if (turn.querySelector(`.${MODEL_CLASS}`)) return;

        if (role === 'user') {
          turn.setAttribute(PROCESSED_ATTR, 'user');
          return;
        }
        
        // Find the best target element for styling
        let target = turn.querySelector('[data-message-author-role="assistant"]');
        if (!target || target === turn) {
          const childDiv = turn.querySelector('div');
          if (childDiv) {
            target = childDiv;
            const grandChild = childDiv.querySelector('div');
            if (grandChild && isElementVisible(grandChild)) target = grandChild;
          } else {
            target = turn;
          }
        }
        
        // Skip thinking/thought panels - only style the actual response content
        if (isThinkingPanel(target)) {
          return; // Don't mark as processed, the actual response may come later
        }
        
        target.classList.add(MODEL_CLASS);
        turn.setAttribute(PROCESSED_ATTR, 'assistant');
      });
    }

    function removeAllStyling() {
      document.querySelectorAll(`.${MODEL_CLASS}`).forEach((el) => el.classList.remove(MODEL_CLASS));
      document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => el.removeAttribute(PROCESSED_ATTR));
    }

    function enable() {
      enabled = true;
      styleTurns();
    }

    function disable() {
      enabled = false;
      removeAllStyling();
    }

    function init() {
      styleTurns();
      const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(styleTurns, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Feature 4: Session Time Tracker (integrates with Prompt Navigator widget)
  // =============================================================================
  const SessionTracker = (function () {
    const TRACKER_ROW_ID = 'pn-session-row';
    const STORAGE_PREFIX = 'chatgpt_session_';
    let enabled = true;
    let sessionStartTime = null;
    let lastPromptTime = null;
    let lastPromptCount = 0;
    let lastPromptTurnIndex = -1;
    let updateInterval = null;
    let promptObserver = null;
    let routeMonitorInterval = null;
    let promptPollInterval = null;
    let observedMain = null;
    let lastObservedUrl = location.href;
    let activeStorageKey = null;

    function formatCompactTime(timestamp) {
      if (!timestamp) return '—';
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}d`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return '<1m';
    }

    function getConversationId() {
      return getConversationIdFromLocation();
    }

    function getStorageKey() {
      const convId = getConversationId();
      return convId ? `${STORAGE_PREFIX}${convId}` : null;
    }

    function loadSessionData() {
      try {
        const key = getStorageKey();
        if (!key) return null;
        const data = localStorage.getItem(key);
        if (data) {
          return JSON.parse(data);
        }
      } catch (e) { }
      return null;
    }

    function saveSessionData() {
      try {
        const key = getStorageKey();
        if (!key) return;
        localStorage.setItem(key, JSON.stringify({
          sessionStartTime,
          lastPromptTime,
          lastPromptCount,
          lastPromptTurnIndex
        }));
      } catch (e) { }
    }

    function injectStyles() {
      if (document.getElementById('session-tracker-style')) return;
      const style = document.createElement('style');
      style.id = 'session-tracker-style';
      style.textContent = `
        #${TRACKER_ROW_ID} {
          display: flex;
          justify-content: center;
          gap: 8px;
          font-size: 9px;
          font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
          color: #6b6b6b;
          border-bottom: 1px solid #3a3a3a;
          padding-bottom: 5px;
          margin-bottom: 5px;
        }
        #${TRACKER_ROW_ID} .st-section { white-space: nowrap; }
        #${TRACKER_ROW_ID} .st-val { color: #b0b0b0; }
      `;
      document.head.appendChild(style);
    }

    function createTrackerSection(sectionName, labelText, role) {
      const section = document.createElement('span');
      section.className = 'st-section';
      section.dataset.section = sectionName;
      section.appendChild(document.createTextNode(labelText + ': '));
      const val = document.createElement('span');
      val.className = 'st-val';
      val.dataset.role = role;
      val.textContent = '—';
      section.appendChild(val);
      return section;
    }

    function ensureTrackerRow() {
      const widget = document.getElementById('prompt-navigator-widget');
      if (!widget) return null;

      let row = document.getElementById(TRACKER_ROW_ID);
      if (!row) {
        row = document.createElement('div');
        row.id = TRACKER_ROW_ID;
        row.appendChild(createTrackerSection('start', 'chatStart', 'started'));
        row.appendChild(createTrackerSection('prompt', 'lastPrompt', 'active'));
        // Insert before controls row
        const controls = widget.querySelector('.pn-controls');
        if (controls) {
          widget.insertBefore(row, controls);
        } else {
          widget.insertBefore(row, widget.firstChild);
        }
      }
      return row;
    }

    function getPromptSnapshot() {
      let userCount = 0;
      let maxUserTurnIndex = -1;
      let firstUserTimestampMs = null;
      let lastUserTimestampMs = null;
      getRenderedTurns({ includeReasoning: true }).forEach(({ turn, role }) => {
        if (role !== 'user') return;

        userCount++;
        const testId = turn.getAttribute('data-testid') || '';
        const match = testId.match(/conversation-turn-(\d+)/i);
        if (match) {
          const numericIndex = Number(match[1]);
          if (Number.isFinite(numericIndex)) {
            maxUserTurnIndex = Math.max(maxUserTurnIndex, numericIndex);
          }
        }

        const turnTimestamp = getTurnTimestampMs(turn);
        if (turnTimestamp) {
          if (!firstUserTimestampMs || turnTimestamp < firstUserTimestampMs) {
            firstUserTimestampMs = turnTimestamp;
          }
          if (!lastUserTimestampMs || turnTimestamp > lastUserTimestampMs) {
            lastUserTimestampMs = turnTimestamp;
          }
        }
      });
      return { userCount, maxUserTurnIndex, firstUserTimestampMs, lastUserTimestampMs };
    }

    function updateDisplay() {
      if (!enabled) return;
      const row = document.getElementById(TRACKER_ROW_ID);
      if (!row) return;

      const startedEl = row.querySelector('[data-role="started"]');
      const activeEl = row.querySelector('[data-role="active"]');
      const startSection = row.querySelector('[data-section="start"]');
      const promptSection = row.querySelector('[data-section="prompt"]');

      const startTime = formatCompactTime(sessionStartTime);
      const promptTime = formatCompactTime(lastPromptTime);

      if (startedEl) startedEl.textContent = startTime;
      if (activeEl) activeEl.textContent = promptTime;

      // Only show sections if we have recorded times
      if (startSection) {
        startSection.style.display = sessionStartTime ? 'inline' : 'none';
      }
      if (promptSection) {
        promptSection.style.display = lastPromptTime ? 'inline' : 'none';
      }
    }

    function checkForNewPrompts() {
      const snapshot = getPromptSnapshot();
      const indexTrackingAvailable = snapshot.maxUserTurnIndex >= 0 && lastPromptTurnIndex >= 0;
      const indexIncreased = indexTrackingAvailable && snapshot.maxUserTurnIndex > lastPromptTurnIndex;
      const countIncreased = !indexTrackingAvailable && snapshot.userCount > lastPromptCount;
      const detectedNewPrompt = indexIncreased || countIncreased;

      if (detectedNewPrompt) {
        // A NEW prompt was added RIGHT NOW (we witnessed it!)
        const now = Date.now();

        // Recover from any missed first-prompt event (e.g., URL changed to /c/<id> mid-flow).
        if (!sessionStartTime && snapshot.userCount >= 1) {
          sessionStartTime = now;
        }

        // Only set lastPromptTime for 2nd+ prompts (no "last" when there's only 1)
        if (snapshot.userCount >= 2) {
          lastPromptTime = now;
        }

        lastPromptCount = Math.max(lastPromptCount, snapshot.userCount);
        if (snapshot.maxUserTurnIndex >= 0) {
          lastPromptTurnIndex = Math.max(lastPromptTurnIndex, snapshot.maxUserTurnIndex);
        }
        saveSessionData();
        updateDisplay();
        return;
      }

      // Baseline sync: absorb improvements in loaded DOM but avoid lowering baseline due virtualization churn.
      if (snapshot.userCount > lastPromptCount) {
        lastPromptCount = snapshot.userCount;
      }
      if (snapshot.maxUserTurnIndex >= 0 && snapshot.maxUserTurnIndex > lastPromptTurnIndex) {
        lastPromptTurnIndex = snapshot.maxUserTurnIndex;
      }
    }

    function attachObserverToMain() {
      if (!promptObserver) return;
      const main = getConversationMain();
      if (!main || main === observedMain) return;

      promptObserver.disconnect();
      observedMain = main;
      promptObserver.observe(main, { childList: true, subtree: true });
      checkForNewPrompts();
    }

    function setupPromptTracking() {
      if (promptObserver) return;

      promptObserver = new MutationObserver(() => {
        // Debounce the check
        clearTimeout(promptObserver._debounce);
        promptObserver._debounce = setTimeout(checkForNewPrompts, 500);
      });

      attachObserverToMain();

      // Track URL changes
      if (!routeMonitorInterval) {
        routeMonitorInterval = setInterval(() => {
          if (location.href !== lastObservedUrl) {
            lastObservedUrl = location.href;
            observedMain = null;
            initSession();
            attachObserverToMain();
            return;
          }

          // Re-attach if ChatGPT swapped the main conversation container.
          attachObserverToMain();
        }, 1000);
      }

      // Periodic reconciliation catches edge cases where DOM mutations were missed.
      if (!promptPollInterval) {
        promptPollInterval = setInterval(checkForNewPrompts, 5000);
      }
    }

    function initSession() {
      ConversationDataStore.refresh().catch(() => {});
      const nextStorageKey = getStorageKey();
      const previousStorageKey = activeStorageKey;
      activeStorageKey = nextStorageKey;

      const existingData = loadSessionData();
      const snapshot = getPromptSnapshot();

      if (existingData) {
        // Returning to a conversation we've seen before
        sessionStartTime = existingData.sessionStartTime || null;
        lastPromptTime = existingData.lastPromptTime || null;
        lastPromptTurnIndex = Number.isFinite(existingData.lastPromptTurnIndex)
          ? existingData.lastPromptTurnIndex
          : -1;
      } else {
        // Preserve in-memory first-prompt timing when a fresh chat gains a conversation id.
        const promotedUntitledConversation =
          !previousStorageKey &&
          !!nextStorageKey &&
          !!sessionStartTime &&
          snapshot.userCount > 0;

        if (!promotedUntitledConversation) {
          // First time seeing this conversation (new or old)
          sessionStartTime = snapshot.firstUserTimestampMs || null;
          lastPromptTime = snapshot.userCount >= 2 ? (snapshot.lastUserTimestampMs || null) : null;
          lastPromptTurnIndex = -1;
        }
      }

      // Fill gaps when older data exists but lacked historical timestamps.
      if (!sessionStartTime && snapshot.firstUserTimestampMs) {
        sessionStartTime = snapshot.firstUserTimestampMs;
      }
      if (!lastPromptTime && snapshot.userCount >= 2 && snapshot.lastUserTimestampMs) {
        lastPromptTime = snapshot.lastUserTimestampMs;
      }

      // Always sync to current rendered state to prevent stale baseline after navigation.
      lastPromptCount = snapshot.userCount;
      if (snapshot.maxUserTurnIndex >= 0) {
        lastPromptTurnIndex = snapshot.maxUserTurnIndex;
      }

      saveSessionData();
      updateDisplay();
    }

    ConversationDataStore.subscribe(() => {
      if (enabled) initSession();
    });

    function enable() {
      enabled = true;
      injectStyles();
      // Wait for prompt navigator widget to exist
      const tryAttach = () => {
        const row = ensureTrackerRow();
        if (row) {
          row.style.display = 'flex';
          initSession();
          setupPromptTracking();
        } else {
          setTimeout(tryAttach, 200);
        }
      };
      tryAttach();
      if (!updateInterval) {
        updateInterval = setInterval(updateDisplay, 30000);
      }
    }

    function disable() {
      enabled = false;
      const row = document.getElementById(TRACKER_ROW_ID);
      if (row) row.style.display = 'none';
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
    }

    function init() {
      injectStyles();
      ensureTrackerRow();
      initSession();
      setupPromptTracking();
      if (!updateInterval) {
        updateInterval = setInterval(updateDisplay, 30000);
      }
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Feature 5: Message Datetimes
  // =============================================================================
  const ChatTimestamps = (function () {
    const MESSAGE_SELECTOR = 'div[data-message-id]';
    const TIMESTAMP_CLASS = 'ux-chat-timestamp-inline';
    const MESSAGE_MARK_ATTR = 'data-ux-chat-timestamp-attached';
    const STYLE_ID = 'chat-timestamps-style';

    let enabled = false;
    let observer = null;
    let observedMain = null;
    let routeInterval = null;
    let refreshInterval = null;
    let updateTimeout = null;
    let lastObservedUrl = location.href;

    function injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .${TIMESTAMP_CLASS} {
          display: block;
          font-size: 11px;
          line-height: 1.3;
          font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
          color: #8b949e;
          opacity: 0.78;
          margin: 0 0 6px auto;
          width: fit-content;
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          user-select: text;
          pointer-events: none;
        }
        @media (max-width: 768px) {
          .${TIMESTAMP_CLASS} {
            font-size: 9px;
            margin-bottom: 4px;
          }
        }
        @media (prefers-color-scheme: light) {
          .${TIMESTAMP_CLASS} {
            color: #6b7280;
          }
        }
      `;
      document.head.appendChild(style);
    }

    function findMessageNode(turn) {
      if (!turn || typeof turn !== 'object') return null;
      if (typeof turn.matches === 'function' && turn.matches(MESSAGE_SELECTOR)) {
        return turn;
      }
      if (typeof turn.querySelector === 'function') {
        return turn.querySelector(MESSAGE_SELECTOR);
      }
      return null;
    }

    function findTimestampElement(messageNode) {
      if (!messageNode || typeof messageNode.querySelector !== 'function') return null;
      try {
        const directChild = messageNode.querySelector(`:scope > .${TIMESTAMP_CLASS}`);
        if (directChild) return directChild;
      } catch (e) { }

      const candidates = messageNode.querySelectorAll(`.${TIMESTAMP_CLASS}`);
      for (const candidate of candidates) {
        if (candidate.parentElement === messageNode) return candidate;
      }
      return messageNode.querySelector(`.${TIMESTAMP_CLASS}`);
    }

    function clearTimestamps(root = document) {
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
      scope.querySelectorAll(`.${TIMESTAMP_CLASS}`).forEach((timestampEl) => {
        timestampEl.remove();
      });
      scope.querySelectorAll(`${MESSAGE_SELECTOR}[${MESSAGE_MARK_ATTR}]`).forEach((messageNode) => {
        messageNode.removeAttribute(MESSAGE_MARK_ATTR);
      });
    }

    function applyTimestamps() {
      if (!enabled) return;
      const main = getConversationMain();
      if (!main) return;

      const seenMessageNodes = new Set();
      getRenderedTurns({ includeReasoning: true }).forEach(({ turn, role }) => {
        const messageNode = findMessageNode(turn);
        if (!messageNode) return;
        seenMessageNodes.add(messageNode);

        const existingTimestamp = findTimestampElement(messageNode);
        if (role !== 'assistant') {
          if (existingTimestamp) existingTimestamp.remove();
          messageNode.removeAttribute(MESSAGE_MARK_ATTR);
          return;
        }

        const timestampMs = getTurnTimestampMs(turn);
        if (!timestampMs) {
          if (existingTimestamp) existingTimestamp.remove();
          messageNode.removeAttribute(MESSAGE_MARK_ATTR);
          return;
        }

        const timestampLabel = formatAbsoluteDateTime(timestampMs);
        if (!timestampLabel) return;

        const fullDateTime = new Date(timestampMs).toLocaleString();
        const timestampEl = existingTimestamp || document.createElement('span');
        timestampEl.className = TIMESTAMP_CLASS;
        timestampEl.textContent = timestampLabel;
        timestampEl.title = fullDateTime;
        timestampEl.setAttribute('aria-label', `Message time ${fullDateTime}`);

        if (messageNode.firstElementChild !== timestampEl) {
          messageNode.prepend(timestampEl);
        }
        messageNode.setAttribute(MESSAGE_MARK_ATTR, '1');
      });

      main.querySelectorAll(`.${TIMESTAMP_CLASS}`).forEach((timestampEl) => {
        const host = timestampEl.closest(MESSAGE_SELECTOR);
        if (!host || !seenMessageNodes.has(host) || host.getAttribute(MESSAGE_MARK_ATTR) !== '1') {
          timestampEl.remove();
        }
      });
    }

    function scheduleApply() {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        updateTimeout = null;
        applyTimestamps();
      }, 160);
    }

    function attachObserverToMain() {
      if (!observer) return;
      const main = getConversationMain();
      if (!main || main === observedMain) return;

      observer.disconnect();
      observedMain = main;
      observer.observe(main, { childList: true, subtree: true });
      scheduleApply();
    }

    function startMonitoring() {
      if (!observer) {
        observer = new MutationObserver(() => {
          scheduleApply();
        });
      }

      attachObserverToMain();

      if (!routeInterval) {
        routeInterval = setInterval(() => {
          if (!enabled) return;

          if (location.href !== lastObservedUrl) {
            lastObservedUrl = location.href;
            observedMain = null;
            attachObserverToMain();
            scheduleApply();
            requestConversationData();
            return;
          }

          attachObserverToMain();
        }, 1000);
      }

      if (!refreshInterval) {
        refreshInterval = setInterval(() => {
          if (enabled) applyTimestamps();
        }, 10000);
      }
    }

    function stopMonitoring() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      observedMain = null;

      if (routeInterval) {
        clearInterval(routeInterval);
        routeInterval = null;
      }
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
      if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
      }
    }

    function requestConversationData() {
      ConversationDataStore.refresh().catch(() => {});
    }

    function enable() {
      if (enabled) return;
      enabled = true;
      injectStyles();
      lastObservedUrl = location.href;
      startMonitoring();
      applyTimestamps();
      requestConversationData();
    }

    function disable() {
      if (!enabled) return;
      enabled = false;
      stopMonitoring();
      clearTimestamps(document);
    }

    ConversationDataStore.subscribe(() => {
      if (enabled) scheduleApply();
    });

    function init() {
      enable();
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Feature 6: Context Collector
  // =============================================================================
  const ContextCollector = (function () {
    const FAB_ID = 'context-collector-fab';
    const PANEL_ID = 'context-collector-panel';
    const CHECKBOX_CLASS = 'cc-checkbox-overlay';
    const SELECTED_CLASS = 'cc-turn-selected';
    const FORMAT_STORAGE_KEY = 'contextCollectorFormat';
    const DELIMITER_STORAGE_KEY = 'contextCollectorDelimiter';

    const DELIMITER_PRESETS = {
      newline: '\n\n',
      dash: '\n\n---\n\n',
      equals: '\n\n===\n\n',
      custom: ''
    };

    let enabled = true;
    let selectionMode = false;
    let selectedTurns = new Map();
    let lastClickedIndex = -1;
    let allTurns = [];
    let allMessages = [];
    let selectionObserver = null;
    let selectionSyncTimer = null;
    let currentFormat = 'plain';
    let currentDelimiter = { preset: 'newline', custom: '' };

    const estimator = window.ChatGPTTokenEstimator;

    function loadFormatPreference() {
      try {
        const stored = localStorage.getItem(FORMAT_STORAGE_KEY);
        if (stored) {
          // Migrate old 'markdown' to 'plain'
          if (stored === 'markdown') {
            currentFormat = 'plain';
            saveFormatPreference('plain');
          } else if (['plain', 'json', 'xml'].includes(stored)) {
            currentFormat = stored;
          }
        }
      } catch (e) { }
    }

    function saveFormatPreference(format) {
      try {
        localStorage.setItem(FORMAT_STORAGE_KEY, format);
      } catch (e) { }
    }

    function loadDelimiterPreference() {
      try {
        const stored = localStorage.getItem(DELIMITER_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.preset && DELIMITER_PRESETS.hasOwnProperty(parsed.preset)) {
            currentDelimiter = parsed;
          }
        }
      } catch (e) { }
    }

    function saveDelimiterPreference(delimiter) {
      try {
        localStorage.setItem(DELIMITER_STORAGE_KEY, JSON.stringify(delimiter));
      } catch (e) { }
    }

    function getDelimiterValue() {
      if (currentDelimiter.preset === 'custom') {
        // Convert escape sequences like \n to actual newlines
        const custom = (currentDelimiter.custom || '\n\n')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');
        return custom;
      }
      return DELIMITER_PRESETS[currentDelimiter.preset] || '\n\n';
    }

    function injectStyles() {
      if (document.getElementById('context-collector-style')) return;
      const style = document.createElement('style');
      style.id = 'context-collector-style';
      style.textContent = `
        #${FAB_ID} {
          position: fixed !important;
          bottom: 80px !important;
          right: 20px !important;
          width: 40px !important;
          height: 40px !important;
          border-radius: 50% !important;
          background: #202123 !important;
          border: 1px solid #565869 !important;
          cursor: pointer !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        #${FAB_ID}:hover {
          background: #2a2b2e !important;
          transform: scale(1.05);
        }
        #${FAB_ID}.active {
          background: rgba(45, 212, 191, 0.15) !important;
          border-color: #2dd4bf !important;
        }
        #${FAB_ID} svg {
          width: 18px !important;
          height: 18px !important;
          fill: #8b949e !important;
          transition: fill 0.2s ease !important;
        }
        #${FAB_ID}:hover svg {
          fill: #e6edf3 !important;
        }
        #${FAB_ID}.active svg {
          fill: #2dd4bf !important;
        }
        #${FAB_ID} .fab-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 18px;
          height: 18px;
          background: #2dd4bf;
          color: #0d1117;
          font-size: 10px;
          font-weight: 700;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
        }
        .${CHECKBOX_CLASS} {
          position: absolute !important;
          right: calc(50% - 380px) !important;
          top: 8px !important;
          width: 24px !important;
          height: 24px !important;
          border-radius: 50% !important;
          background: #202123 !important;
          border: 2px solid #565869 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.15s ease !important;
          z-index: 10000 !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4) !important;
        }
        @media (max-width: 900px) {
          .${CHECKBOX_CLASS} {
            right: auto !important;
            left: 8px !important;
          }
        }
        .${CHECKBOX_CLASS}:hover {
          border-color: #2dd4bf !important;
          background: rgba(45, 212, 191, 0.2) !important;
        }
        .${CHECKBOX_CLASS}.checked {
          background: #2dd4bf !important;
          border-color: #2dd4bf !important;
        }
        .${CHECKBOX_CLASS}.checked::after {
          content: '✓' !important;
          color: #0d1117 !important;
          font-size: 14px !important;
          font-weight: 700 !important;
        }
        .${SELECTED_CLASS} {
          outline: 2px solid rgba(45, 212, 191, 0.5) !important;
          outline-offset: 4px !important;
          background: rgba(45, 212, 191, 0.03) !important;
          border-radius: 8px !important;
        }
        #${PANEL_ID} {
          position: fixed !important;
          bottom: 131px !important;
          right: 20px !important;
          width: 280px !important;
          background: #1c2128 !important;
          border: 1px solid #30363d !important;
          border-radius: 12px !important;
          padding: 12px !important;
          z-index: 2147483647 !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
          animation: cc-pop-in 0.15s ease-out !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        }
        @keyframes cc-pop-in {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .cc-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid #30363d;
        }
        .cc-panel-title {
          font-size: 12px;
          font-weight: 600;
          color: #e6edf3;
        }
        .cc-panel-close {
          background: none;
          border: none;
          color: #8b949e;
          font-size: 16px;
          cursor: pointer;
          padding: 2px 6px;
          line-height: 1;
          border-radius: 4px;
        }
        .cc-panel-close:hover { background: #30363d; color: #e6edf3; }
        .cc-panel-stats {
          font-size: 11px;
          color: #8b949e;
          margin-bottom: 10px;
          text-align: center;
          padding: 6px;
          background: #161b22;
          border-radius: 6px;
        }
        .cc-panel-stats strong {
          color: #2dd4bf;
        }
        .cc-section {
          margin-bottom: 10px;
        }
        .cc-section-label {
          font-size: 9px;
          font-weight: 600;
          color: #6e7681;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
        .cc-btn-row {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .cc-btn {
          padding: 5px 8px;
          font-size: 10px;
          font-weight: 500;
          background: #30363d;
          border: 1px solid #484f58;
          border-radius: 4px;
          color: #8b949e;
          cursor: pointer;
          transition: all 0.15s ease;
          flex: 1;
          min-width: 0;
          text-align: center;
        }
        .cc-btn:hover {
          background: #3d444d;
          color: #e6edf3;
        }
        .cc-btn.active {
          background: rgba(45, 212, 191, 0.15);
          border-color: #2dd4bf;
          color: #2dd4bf;
        }
        .cc-quick-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
        }
        .cc-quick-btn {
          padding: 5px 4px;
          font-size: 9px;
          background: transparent;
          border: 1px solid #484f58;
          border-radius: 4px;
          color: #8b949e;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .cc-quick-btn:hover {
          background: #30363d;
          color: #e6edf3;
        }
        .cc-delimiter-row {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .cc-delimiter-input {
          flex: 1;
          padding: 5px 8px;
          font-size: 10px;
          font-family: 'SF Mono', Consolas, monospace;
          background: #161b22;
          border: 1px solid #484f58;
          border-radius: 4px;
          color: #e6edf3;
          outline: none;
          min-width: 0;
        }
        .cc-delimiter-input:focus {
          border-color: #2dd4bf;
        }
        .cc-delimiter-input::placeholder {
          color: #6e7681;
        }
        .cc-format-section {
          margin-bottom: 10px;
        }
        .cc-format-grid {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cc-format-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .cc-format-option:hover {
          background: #1c2128;
          border-color: #2dd4bf;
        }
        .cc-format-option:active {
          transform: scale(0.98);
        }
        .cc-format-option.copied {
          background: rgba(34, 197, 94, 0.15);
          border-color: #22c55e;
        }
        .cc-format-icon {
          font-size: 12px;
          color: #6e7681;
          flex-shrink: 0;
        }
        .cc-format-option:hover .cc-format-icon {
          color: #2dd4bf;
        }
        .cc-format-label {
          font-size: 11px;
          font-weight: 600;
          color: #e6edf3;
          min-width: 60px;
        }
        .cc-format-preview {
          flex: 1;
          font-size: 9px;
          font-family: 'SF Mono', Consolas, monospace;
          color: #6e7681;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .cc-format-option:hover .cc-format-preview {
          opacity: 1;
        }
        .cc-format-copy-hint {
          font-size: 9px;
          color: #484f58;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .cc-format-option:hover .cc-format-copy-hint {
          opacity: 1;
          color: #2dd4bf;
        }
        .cc-no-selection {
          text-align: center;
          padding: 20px 10px;
          color: #6e7681;
          font-size: 11px;
        }
        .cc-delimiter-inline {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 0;
          border-top: 1px solid #30363d;
          margin-top: 6px;
        }
        .cc-delimiter-inline-label {
          font-size: 9px;
          color: #6e7681;
          white-space: nowrap;
        }
        .cc-delimiter-mini-btn {
          padding: 3px 6px;
          font-size: 9px;
          background: transparent;
          border: 1px solid #484f58;
          border-radius: 3px;
          color: #8b949e;
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .cc-delimiter-mini-btn:hover {
          background: #30363d;
          color: #e6edf3;
        }
        .cc-delimiter-mini-btn.active {
          background: rgba(45, 212, 191, 0.15);
          border-color: #2dd4bf;
          color: #2dd4bf;
        }
        .cc-delimiter-mini-input {
          width: 50px;
          padding: 3px 6px;
          font-size: 9px;
          font-family: 'SF Mono', Consolas, monospace;
          background: #0d1117;
          border: 1px solid #484f58;
          border-radius: 3px;
          color: #e6edf3;
          outline: none;
        }
        .cc-delimiter-mini-input:focus {
          border-color: #2dd4bf;
        }
      `;
      document.head.appendChild(style);
    }

    function createFAB() {
      if (document.getElementById(FAB_ID)) return;
      const fab = document.createElement('button');
      fab.id = FAB_ID;
      fab.title = 'Select messages to copy';

      // Create clipboard SVG icon
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 640 640');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M288 64C252.7 64 224 92.7 224 128L224 384C224 419.3 252.7 448 288 448L480 448C515.3 448 544 419.3 544 384L544 183.4C544 166 536.9 149.3 524.3 137.2L466.6 81.8C454.7 70.4 438.8 64 422.3 64L288 64zM160 192C124.7 192 96 220.7 96 256L96 512C96 547.3 124.7 576 160 576L352 576C387.3 576 416 547.3 416 512L416 496L352 496L352 512L160 512L160 256L176 256L176 192L160 192z');
      svg.appendChild(path);
      fab.appendChild(svg);

      fab.addEventListener('click', toggleSelectionMode);
      document.body.appendChild(fab);
    }

    function updateFABBadge() {
      const fab = document.getElementById(FAB_ID);
      if (!fab) return;
      let badge = fab.querySelector('.fab-badge');
      const count = selectedTurns.size;
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'fab-badge';
          fab.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    }

    function scanTurns() {
      const main = getConversationMain();
      if (!main) {
        allTurns = [];
        allMessages = [];
        return [];
      }
      allTurns = getRenderedTurns().map(({ turn }) => turn);
      const snapshot = ConversationDataStore.getCachedSnapshot();
      if (snapshot && snapshot.messages && snapshot.messages.length) {
        allMessages = snapshot.messages;
      } else {
        allMessages = allTurns
          .map((turn, index) => createDomMessageRecord(turn, index))
          .filter(Boolean)
          .map((record, index) => ({ ...record, index }));
      }
      return allTurns;
    }

    function getMessageForTurn(turn, mountedIndex) {
      const record = ConversationDataStore.findRecordForTurn(turn, allMessages);
      if (record) return record;
      return createDomMessageRecord(turn, mountedIndex);
    }

    function getMessageByKey(key) {
      if (!key) return null;
      return allMessages.find((message) => getRecordKey(message) === key) || null;
    }

    function setRenderedSelectionForKey(key, selected) {
      allTurns.forEach((turn) => {
        const checkbox = turn.querySelector(`.${CHECKBOX_CLASS}`);
        if (!checkbox || checkbox.dataset.key !== key) return;
        checkbox.classList.toggle('checked', selected);
        turn.classList.toggle(SELECTED_CLASS, selected);
      });
    }

    function syncRenderedSelectionState() {
      allTurns.forEach((turn, index) => {
        const message = getMessageForTurn(turn, index);
        const key = getRecordKey(message);
        const selected = key && selectedTurns.has(key);
        const checkbox = turn.querySelector(`.${CHECKBOX_CLASS}`);
        if (checkbox && key) {
          checkbox.dataset.key = key;
          checkbox.dataset.index = String(message.index);
          checkbox.classList.toggle('checked', selected);
        }
        turn.classList.toggle(SELECTED_CLASS, !!selected);
      });
    }

    function addCheckboxes() {
      allTurns.forEach((turn, index) => {
        const message = getMessageForTurn(turn, index);
        if (!message) return;
        const key = getRecordKey(message);
        if (!key) return;

        let checkbox = turn.querySelector(`.${CHECKBOX_CLASS}`);
        if (checkbox) {
          checkbox.dataset.key = key;
          checkbox.dataset.index = String(message.index);
          return;
        }

        turn.style.position = 'relative';
        checkbox = document.createElement('div');
        checkbox.className = CHECKBOX_CLASS;
        checkbox.dataset.key = key;
        checkbox.dataset.index = String(message.index);
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          handleTurnClick(checkbox.dataset.key, e.shiftKey);
        });
        turn.appendChild(checkbox);
      });
      syncRenderedSelectionState();
    }

    function removeCheckboxes() {
      document.querySelectorAll(`.${CHECKBOX_CLASS}`).forEach((cb) => cb.remove());
      document.querySelectorAll(`.${SELECTED_CLASS}`).forEach((el) => el.classList.remove(SELECTED_CLASS));
    }

    function handleTurnClick(key, isShiftClick) {
      const message = getMessageByKey(key);
      if (!message) return;
      const index = message.index;
      if (isShiftClick && lastClickedIndex >= 0) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          selectMessageAtIndex(i);
        }
      } else {
        toggleMessage(key);
      }
      lastClickedIndex = index;
      updateUI();
    }

    function toggleMessage(key) {
      if (!key) return;
      if (selectedTurns.has(key)) {
        selectedTurns.delete(key);
        setRenderedSelectionForKey(key, false);
      } else {
        selectMessageByKey(key);
      }
    }

    function selectMessageByKey(key) {
      const message = getMessageByKey(key);
      if (!message || selectedTurns.has(key)) return;
      const tokens = estimator ? estimator.estimateTokensFromText(message.text).tokens : 0;
      selectedTurns.set(key, {
        index: message.index,
        role: message.role,
        text: message.text,
        tokens,
        key
      });
      setRenderedSelectionForKey(key, true);
    }

    function selectMessageAtIndex(index) {
      const message = allMessages[index];
      if (!message) return;
      selectMessageByKey(getRecordKey(message));
    }

    function clearSelection() {
      selectedTurns.clear();
      lastClickedIndex = -1;
      syncRenderedSelectionState();
      updateUI();
    }

    async function ensureFullMessagesLoaded() {
      const snapshot = await ConversationDataStore.refresh({ force: false });
      if (snapshot && snapshot.messages && snapshot.messages.length) {
        scanTurns();
        addCheckboxes();
      }
      return allMessages;
    }

    async function selectAll() {
      await ensureFullMessagesLoaded();
      allMessages.forEach((_, i) => selectMessageAtIndex(i));
      updateUI();
    }

    async function selectLast(n) {
      await ensureFullMessagesLoaded();
      clearSelection();
      const start = Math.max(0, allMessages.length - n);
      for (let i = start; i < allMessages.length; i++) {
        selectMessageAtIndex(i);
      }
      updateUI();
    }

    async function selectByRole(role) {
      await ensureFullMessagesLoaded();
      clearSelection();
      allMessages.forEach((message, i) => {
        if (message.role === role) selectMessageAtIndex(i);
      });
      updateUI();
    }

    function getSortedSelectedMessages() {
      return Array.from(selectedTurns.values())
        .sort((a, b) => a.index - b.index);
    }

    function generatePreview(format) {
      if (selectedTurns.size === 0) return '';
      const sorted = getSortedSelectedMessages();
      const first = sorted[0];
      const roleLabel = first.role === 'user' ? 'User' : 'Assistant';
      const snippet = first.text.substring(0, 18).replace(/\n/g, ' ').trim();
      const hasMore = sorted.length > 1;
      const delimPreview = currentDelimiter.preset === 'dash' ? '---' :
                           currentDelimiter.preset === 'equals' ? '===' : '¶';

      if (format === 'plain') {
        return hasMore ? `${roleLabel}: ${snippet}... ${delimPreview} ...` : `${roleLabel}: ${snippet}...`;
      }
      if (format === 'json') {
        return `{"role":"${first.role}","content":"${snippet}..."}`;
      }
      if (format === 'xml') {
        const tag = first.role === 'user' ? 'user' : 'assistant';
        return `<${tag}>${snippet}...</${tag}>`;
      }
      return '';
    }

    function formatOutputAs(format) {
      const sorted = getSortedSelectedMessages();
      const delimiter = getDelimiterValue();

      if (format === 'plain') {
        return sorted.map((data) => {
          const roleLabel = data.role === 'user' ? 'User' : 'Assistant';
          return `${roleLabel}:\n${data.text}`;
        }).join(delimiter);
      }

      if (format === 'json') {
        // OpenAI API format
        const messages = sorted.map((data) => ({
          role: data.role,
          content: data.text
        }));
        return JSON.stringify(messages, null, 2);
      }

      if (format === 'xml') {
        // Clean XML with <user> and <assistant> tags
        const messages = sorted.map((data) => {
          const tag = data.role === 'user' ? 'user' : 'assistant';
          return `<${tag}>\n${data.text}\n</${tag}>`;
        }).join('\n');
        return messages;
      }

      return '';
    }

    async function copyAs(format) {
      const output = formatOutputAs(format);
      if (!output) return;
      try {
        await navigator.clipboard.writeText(output);
        return true;
      } catch (e) {
        console.error('Failed to copy:', e);
        return false;
      }
    }

    function createPanel() {
      if (document.getElementById(PANEL_ID)) return;
      const panel = document.createElement('div');
      panel.id = PANEL_ID;

      // Header
      const header = document.createElement('div');
      header.className = 'cc-panel-header';
      const title = document.createElement('span');
      title.className = 'cc-panel-title';
      title.textContent = 'Context Collector';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'cc-panel-close';
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', exitSelectionMode);
      header.appendChild(title);
      header.appendChild(closeBtn);

      // Stats
      const stats = document.createElement('div');
      stats.className = 'cc-panel-stats';
      stats.id = 'cc-stats';

      // Quick Select Section
      const quickSection = document.createElement('div');
      quickSection.className = 'cc-section';
      const quickLabel = document.createElement('div');
      quickLabel.className = 'cc-section-label';
      quickLabel.textContent = 'Quick Select';
      const quickRow = document.createElement('div');
      quickRow.className = 'cc-quick-row';
      [
        { label: 'Last 2 msgs', action: () => selectLast(2) },
        { label: 'Last 4 msgs', action: () => selectLast(4) },
        { label: 'All', action: selectAll },
        { label: 'User only', action: () => selectByRole('user') },
        { label: 'GPT only', action: () => selectByRole('assistant') },
        { label: 'Clear', action: clearSelection }
      ].forEach(({ label, action }) => {
        const btn = document.createElement('button');
        btn.className = 'cc-quick-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          Promise.resolve(action()).catch((error) => {
            console.error('Context Collector action failed:', error);
          });
        });
        quickRow.appendChild(btn);
      });
      quickSection.appendChild(quickLabel);
      quickSection.appendChild(quickRow);

      // Copy As Section (Format options with click-to-copy)
      const copySection = document.createElement('div');
      copySection.className = 'cc-format-section';
      copySection.id = 'cc-copy-section';
      const copyLabel = document.createElement('div');
      copyLabel.className = 'cc-section-label';
      copyLabel.textContent = 'Click to Copy';
      const formatGrid = document.createElement('div');
      formatGrid.className = 'cc-format-grid';
      formatGrid.id = 'cc-format-grid';

      const formats = [
        { id: 'plain', label: 'Plain Text', icon: 'Aa' },
        { id: 'json', label: 'JSON (API)', icon: '{ }' },
        { id: 'xml', label: 'XML', icon: '</>' }
      ];

      formats.forEach(({ id, label, icon }) => {
        const option = document.createElement('div');
        option.className = 'cc-format-option';
        option.dataset.format = id;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'cc-format-icon';
        iconSpan.textContent = icon;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'cc-format-label';
        labelSpan.textContent = label;

        const preview = document.createElement('span');
        preview.className = 'cc-format-preview';
        preview.dataset.format = id;

        const copyHint = document.createElement('span');
        copyHint.className = 'cc-format-copy-hint';
        copyHint.textContent = '📋';

        option.appendChild(iconSpan);
        option.appendChild(labelSpan);
        option.appendChild(preview);
        option.appendChild(copyHint);

        option.addEventListener('click', async () => {
          if (selectedTurns.size === 0) return;
          const success = await copyAs(id);
          if (success) {
            option.classList.add('copied');
            copyHint.textContent = '✓';
            setTimeout(() => {
              option.classList.remove('copied');
              copyHint.textContent = '📋';
            }, 1500);
          }
        });

        option.addEventListener('mouseenter', () => {
          preview.textContent = generatePreview(id);
        });

        formatGrid.appendChild(option);
      });

      // Inline delimiter controls (only for plain text)
      const delimiterInline = document.createElement('div');
      delimiterInline.className = 'cc-delimiter-inline';
      delimiterInline.id = 'cc-delimiter-inline';

      const delimiterLabel = document.createElement('span');
      delimiterLabel.className = 'cc-delimiter-inline-label';
      delimiterLabel.textContent = 'Plain text separator:';
      delimiterInline.appendChild(delimiterLabel);

      const delimiterPresets = [
        { preset: 'newline', label: '¶', title: 'Blank line' },
        { preset: 'dash', label: '---', title: 'Dashes' },
        { preset: 'equals', label: '===', title: 'Equals' }
      ];
      delimiterPresets.forEach(({ preset, label, title }) => {
        const btn = document.createElement('button');
        btn.className = 'cc-delimiter-mini-btn cc-delimiter-btn' + (currentDelimiter.preset === preset ? ' active' : '');
        btn.dataset.delimiter = preset;
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', () => setDelimiter({ preset, custom: '' }));
        delimiterInline.appendChild(btn);
      });

      const delimiterInput = document.createElement('input');
      delimiterInput.type = 'text';
      delimiterInput.id = 'cc-delimiter-input';
      delimiterInput.className = 'cc-delimiter-mini-input';
      delimiterInput.placeholder = '\\n\\n';
      delimiterInput.value = currentDelimiter.preset === 'custom' ? currentDelimiter.custom : '';
      delimiterInput.addEventListener('input', (e) => {
        currentDelimiter = { preset: 'custom', custom: e.target.value };
        saveDelimiterPreference(currentDelimiter);
        document.querySelectorAll('.cc-delimiter-btn').forEach((btn) => {
          btn.classList.remove('active');
        });
      });
      delimiterInput.addEventListener('focus', () => {
        document.querySelectorAll('.cc-delimiter-btn').forEach((btn) => {
          btn.classList.remove('active');
        });
      });
      delimiterInline.appendChild(delimiterInput);

      copySection.appendChild(copyLabel);
      copySection.appendChild(formatGrid);
      copySection.appendChild(delimiterInline);

      panel.appendChild(header);
      panel.appendChild(stats);
      panel.appendChild(quickSection);
      panel.appendChild(copySection);
      document.body.appendChild(panel);
    }

    function removePanel() {
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
    }

    function scheduleSelectionSync() {
      if (!selectionMode) return;
      if (selectionSyncTimer) clearTimeout(selectionSyncTimer);
      selectionSyncTimer = setTimeout(() => {
        selectionSyncTimer = null;
        scanTurns();
        addCheckboxes();
        updateUI();
      }, 150);
    }

    function startSelectionObserver() {
      if (!selectionObserver) {
        selectionObserver = new MutationObserver(scheduleSelectionSync);
        selectionObserver.observe(document.body, { childList: true, subtree: true });
      }
      window.addEventListener('scroll', scheduleSelectionSync, { capture: true, passive: true });
    }

    function stopSelectionObserver() {
      if (selectionObserver) {
        selectionObserver.disconnect();
        selectionObserver = null;
      }
      window.removeEventListener('scroll', scheduleSelectionSync, { capture: true });
      if (selectionSyncTimer) {
        clearTimeout(selectionSyncTimer);
        selectionSyncTimer = null;
      }
    }

    function setDelimiter(delimiter) {
      currentDelimiter = delimiter;
      saveDelimiterPreference(delimiter);
      document.querySelectorAll('.cc-delimiter-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.delimiter === delimiter.preset);
      });
      // Clear custom input highlight when selecting a preset
      if (delimiter.preset !== 'custom') {
        const input = document.getElementById('cc-delimiter-input');
        if (input) input.value = '';
      }
    }

    function updateUI() {
      updateFABBadge();
      const stats = document.getElementById('cc-stats');
      const formatGrid = document.getElementById('cc-format-grid');
      if (!stats) return;

      const count = selectedTurns.size;
      let totalTokens = 0;
      selectedTurns.forEach((data) => {
        totalTokens += data.tokens;
      });

      stats.textContent = '';
      if (count === 0) {
        stats.textContent = allMessages.length
          ? `${allMessages.length} message${allMessages.length === 1 ? '' : 's'} loaded`
          : 'Click checkboxes to select messages';
      } else {
        const countStrong = document.createElement('strong');
        countStrong.textContent = count;
        const tokenStrong = document.createElement('strong');
        tokenStrong.textContent = totalTokens.toLocaleString();
        stats.appendChild(countStrong);
        stats.appendChild(document.createTextNode(` message${count === 1 ? '' : 's'} \u2022 ~`));
        stats.appendChild(tokenStrong);
        stats.appendChild(document.createTextNode(' tokens'));
      }

      // Update format options state
      if (formatGrid) {
        const options = formatGrid.querySelectorAll('.cc-format-option');
        options.forEach((opt) => {
          opt.style.opacity = count === 0 ? '0.5' : '1';
          opt.style.pointerEvents = count === 0 ? 'none' : 'auto';
          // Update preview on selection change
          const preview = opt.querySelector('.cc-format-preview');
          if (preview && count > 0) {
            preview.textContent = generatePreview(opt.dataset.format);
          } else if (preview) {
            preview.textContent = '';
          }
        });
      }
    }

    // Ctrl/Cmd+Enter copies in the last-used format.
    function copyToClipboard() {
      return copyAs(currentFormat);
    }

    function enterSelectionMode() {
      selectionMode = true;
      scanTurns();
      addCheckboxes();
      createPanel();
      startSelectionObserver();
      const fab = document.getElementById(FAB_ID);
      if (fab) fab.classList.add('active');
      updateUI();
      ensureFullMessagesLoaded().then(() => {
        if (!selectionMode) return;
        scanTurns();
        addCheckboxes();
        updateUI();
      }).catch((error) => {
        console.warn('Context Collector full-message load failed:', error);
      });
    }

    function exitSelectionMode() {
      selectionMode = false;
      stopSelectionObserver();
      removeCheckboxes();
      removePanel();
      selectedTurns.clear();
      lastClickedIndex = -1;
      const fab = document.getElementById(FAB_ID);
      if (fab) fab.classList.remove('active');
      updateFABBadge();
    }

    function toggleSelectionMode() {
      if (selectionMode) {
        exitSelectionMode();
      } else {
        enterSelectionMode();
      }
    }

    function setupKeyboardHandler() {
      document.addEventListener('keydown', (e) => {
        if (!selectionMode) return;
        if (e.key === 'Escape') {
          exitSelectionMode();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          copyToClipboard();
        }
      });
    }

    function enable() {
      enabled = true;
      createFAB();
    }

    function disable() {
      enabled = false;
      exitSelectionMode();
      const fab = document.getElementById(FAB_ID);
      if (fab) fab.remove();
    }

    function init() {
      loadFormatPreference();
      loadDelimiterPreference();
      injectStyles();
      createFAB();
      setupKeyboardHandler();
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable() };
  })();

  // =============================================================================
  // Sound Notification - Play sound when response completes
  // =============================================================================
  const SoundNotification = (() => {
    let enabled = false;
    let observer = null;
    let isGenerating = false;
    let lastCheckTime = 0;

    const playNotificationSound = () => playChime(selectedChime);

    // ChatGPT swaps the composer's send control for a stop control while a
    // reply streams; any of these spellings means "still generating".
    function isResponseGenerating() {
      return !!document.querySelector(
        '[data-testid="stop-button"], [data-testid*="stop-button"], button[aria-label*="stop" i], [data-testid="send-button"][disabled]'
      );
    }

    function checkGenerationState() {
      if (!enabled) return;

      const now = Date.now();
      if (now - lastCheckTime < 500) return; // Throttle checks
      lastCheckTime = now;

      const currentlyGenerating = isResponseGenerating();

      // Detect transition from generating to not generating
      if (isGenerating && !currentlyGenerating) {
        playNotificationSound();
      }

      isGenerating = currentlyGenerating;
    }

    function setupObserver() {
      if (observer) return;

      observer = new MutationObserver(() => {
        checkGenerationState();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'data-testid']
      });

      // Also check periodically as backup
      setInterval(checkGenerationState, 1000);
    }

    function enable() {
      if (enabled) return;
      enabled = true;
      setupObserver();
    }

    function disable() {
      if (!enabled) return;
      enabled = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function init() {
      enable();
    }

    return { init, enable, disable, setEnabled: (val) => val ? enable() : disable(), playNotificationSound };
  })();

  // =============================================================================
  // Initialization
  // =============================================================================
  function updateSessionTrackerVisibility() {
    // Session tracker only shows if BOTH it and prompt navigator are enabled
    const shouldShow = currentSettings.sessionTracker && currentSettings.promptNavigator;
    SessionTracker.setEnabled(shouldShow);
  }

  async function initializeAllFeatures() {
    await loadSettings();

    if (currentSettings.tokenCounter) TokenCounter.init();
    else TokenCounter.disable();

    if (currentSettings.promptNavigator) PromptNavigator.init();
    else PromptNavigator.disable();

    if (currentSettings.responseStyling) ResponseStyling.init();
    else ResponseStyling.disable();

    // Session tracker depends on prompt navigator
    if (currentSettings.sessionTracker && currentSettings.promptNavigator) {
      SessionTracker.init();
    } else {
      SessionTracker.disable();
    }

    if (currentSettings.contextCollector) ContextCollector.init();
    else ContextCollector.disable();

    if (currentSettings.chatTimestamps) ChatTimestamps.init();
    else ChatTimestamps.disable();

    if (currentSettings.soundNotification) SoundNotification.init();
    else SoundNotification.disable();

    // Live settings changes (popup toggles, synced storage, Scry config).
    onSettingsChanged((settings) => {
      TokenCounter.setEnabled(settings.tokenCounter);
      PromptNavigator.setEnabled(settings.promptNavigator);
      ResponseStyling.setEnabled(settings.responseStyling);
      ContextCollector.setEnabled(settings.contextCollector);
      ChatTimestamps.setEnabled(settings.chatTimestamps);
      SoundNotification.setEnabled(settings.soundNotification);
      updateSessionTrackerVisibility();
    });

    // Popup nicety: hear the chime when it is switched on or changed.
    host.onCommand((message) => {
      if (!message) return;
      const preview = (message.type === 'SETTINGS_CHANGED' && message.feature === 'soundNotification' && message.enabled)
        || (message.type === 'CHIME_CHANGED' && message.chime);
      if (message.type === 'CHIME_CHANGED' && message.chime) selectedChime = message.chime;
      if (preview) SoundNotification.playNotificationSound();
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeAllFeatures();
  } else {
    window.addEventListener('DOMContentLoaded', initializeAllFeatures);
  }
})();

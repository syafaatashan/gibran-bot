// lib/session-migrator.mjs - Pemindahan konteks tanpa kehilangan histori, murni API cloud.
import crypto from 'node:crypto';
import { redact } from './minimax-client.mjs';

export const MIGRATION = {
  HISTORY: 'history-inject',      // terbukti bekerja (probe1/probe2/probe3)
  DISPATCH: 'session-dispatch',   // prepare+upload terbukti, commit butuh native transfer client
};

function textOf(m) {
  const c = m && m.msg_content;
  return typeof c === 'string' ? c : '';
}

export class SessionMigrator {
  constructor(opts = {}) {
    this.cloud = opts.cloud;
    this.pool = opts.pool;
    this.log = opts.log || (() => {});
    this.maxMessages = opts.maxMessages || 24;
    this.maxChars = opts.maxChars || 6000;
  }

  // Ekspor seluruh histori sesi (dengan paginasi 'before'). Hanya akun owner bisa.
  async exportHistory(sessionId, token, { limit = 50, maxPages = 8 } = {}) {
    const all = [];
    let before;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.cloud.listMessages(sessionId, { limit, before }, token);
      const msgs = (res && res.messages) || [];
      all.push(...msgs);
      const next = res && res.next_cursor;
      if (!res || res.has_more === false || !next) break;
      before = next;
    }
    // urut kronologis (server bisa balain menurun)
    const seen = new Set();
    const uniq = [];
    for (const m of all) {
      const id = m && m.msg_id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      uniq.push(m);
    }
    uniq.sort((x, y) => Number(x.timestamp || 0) - Number(y.timestamp || 0));
    return uniq;
  }

  // Bangun brief konteks yang dikirim ulang ke sesi baru.
  buildBrief(messages, { marker } = {}) {
    const lines = [];
    for (const m of messages) {
      const role = m && m.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const t = textOf(m).trim();
      if (!t) continue;
      lines.push(role + ': ' + t);
    }
    let brief = lines.slice(-this.maxMessages).join('\n');
    if (brief.length > this.maxChars) brief = '...\n' + brief.slice(-this.maxChars);
    if (!brief) return '';
    return [
      '# LANJUTAN PERCAKAPAN UNTUK PENGGUNA YANG SAMA',
      '# (sesi cloud baru dibuat karena akun OAuth diganti; histori di bawah adalah bagian dari percakapan yang sama)',
      '# Perlakukan semua fakta, preferensi, dan data yang ada di bawah sebagai SUDAH DIKETAHUI - jangan bilang "memori tidak ikut" atau "sesi baru".',
      '# Jawab sebagai kelanjutan percakapan yang sama, bukan sebagai percakapan baru.',
      '# Ringkasan faktual: ' + brief,
    ].join('\n');
  }

  // --- Pola utama: export -> sesi baru di akun tujuan -> inject ---
  async migrateViaHistory({ sessionId, oldLabel, newLabel, userText, marker, contextBundle }) {
    const oldToken = await this.pool.tokenFor(oldLabel);
    const newToken = await this.pool.tokenFor(newLabel);
    const newAgentId = await this.pool.agentIdFor(newLabel);
    const messages = await this.exportHistory(sessionId, oldToken);
    const brief = this.buildBrief(messages, { marker });
    const newSessionId = await this.cloud.createSession(newAgentId, 'migrasi-' + oldLabel + '-' + Date.now(), newToken);
    // Sesi baru = sesi agen baru: instruksi (persona + skill) harus ikut inject,
    // kalau tidak persona/skill hilang begitu akun rotasi.
    const parts = [];
    if (contextBundle) parts.push(contextBundle);
    if (brief) parts.push(brief);
    if (userText) parts.push('# PESAN LANJUTAN PENGGUNA\n' + userText);
    const content = parts.length ? parts.join('\n\n') : 'Lanjutkan percakapan.';
    const out = await this.cloud.postMessage(newSessionId, content, {
      sender: { agent_name: newAgentId }, token: newToken, timeoutMs: 600000,
    });
    this.log('migrasiViaHistory: ' + oldLabel + ' -> ' + newLabel + ' | ekspor ' + messages.length
      + ' pesan | brief ' + brief.length + ' char | sesi baru ' + newSessionId);
    return {
      method: MIGRATION.HISTORY,
      newSessionId,
      newLabel,
      exportedCount: messages.length,
      briefChars: brief.length,
      reply: out.text,
    };
  }

  // --- Alternatif vendor: session-dispatch (prepare -> upload artefak -> commit) ---
  // Status live 2026-11-28: prepare OK, upload artefak OK, commit ditolak server dengan
  // 'session dispatch workspace transfer is not complete' -> butuh native transfer client.
  async migrateViaDispatch({ sessionId, oldLabel, newLabel, userText, sourceDeviceId, localSessionId }) {
    const oldToken = await this.pool.tokenFor(oldLabel);
    const newToken = await this.pool.tokenFor(newLabel);
    const messages = await this.exportHistory(sessionId, oldToken);
    const historyJson = JSON.stringify({
      version: 1, session_id: sessionId,
      messages: messages.map((m) => ({ role: m.role, content: textOf(m), msg_type: m.msg_type, timestamp: m.timestamp })),
    });
    const contextJson = JSON.stringify({ summary: 'Migrasi ' + oldLabel + ' -> ' + newLabel, source_session: sessionId });
    const manifestJson = JSON.stringify({ revision_id: 'rev-' + crypto.randomUUID(), files: [] });
    const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    const arts = [1, 2, 3].map((k) => {
      const s = k === 1 ? historyJson : (k === 2 ? contextJson : manifestJson);
      return { kind: k, sha256: sha(s), size_bytes: Buffer.byteLength(s, 'utf8') };
    });
    const body = {
      client_request_id: crypto.randomUUID(),
      handoff_operation_id: crypto.randomUUID(),
      source_device_id: sourceDeviceId || 'gibran-relay-device',
      local_session_id: localSessionId || ('mvs_gibran_' + Date.now()),
      checkpoint: { turn_count: messages.length, last_message_id: String((messages[messages.length - 1] || {}).msg_id || '') },
      session_spec: { agent_name: 'mavis', title: 'gibran-migrasi-' + Date.now() },
      artifacts: arts,
      workspace: { revision_id: 'rev-' + crypto.randomUUID(), manifest: { manifest_hash: sha(manifestJson), file_count: 0, total_bytes: 0 } },
    };
    const prep = await this.cloud.req({ method: 'POST', path: '/minimax-cloud/api/v1/session-dispatch/prepare', body, token: newToken });
    const dispatchId = prep && prep.dispatch && prep.dispatch.dispatch_id;
    const srcToken = String((prep && prep.source_device_token) || '');
    const payloads = { 1: historyJson, 2: contextJson, 3: manifestJson };
    for (const t of ((prep && prep.upload_tickets) || [])) {
      const data = payloads[t.kind];
      const url = t.upload_url || t.url;
      if (!data || !url) continue;
      const put = await fetch(url, { method: 'PUT', body: data, headers: Object.assign({ 'Content-Type': 'application/json' }, t.headers || {}), redirect: 'error', signal: AbortSignal.timeout(90000) });
      if (!put.ok) throw new Error('upload artefak kind ' + t.kind + ' HTTP ' + put.status);
    }
    let commit;
    try {
      commit = await this.cloud.req({ method: 'POST', path: '/minimax-cloud/api/v1/session-dispatch/' + encodeURIComponent(dispatchId) + '/resolve', body: { decision: 1 }, headers: { 'X-Mavis-Session-Dispatch-Token': srcToken }, token: newToken });
    } catch (e) {
      return { method: MIGRATION.DISPATCH, ok: false, dispatchId, blockedBy: String(e.message || e).slice(0, 200), body: redact(e.body) };
    }
    const cloudSessionId = commit && commit.dispatch && commit.dispatch.cloud_session_id;
    return { method: MIGRATION.DISPATCH, ok: !!cloudSessionId, dispatchId, cloudSessionId };
  }
}
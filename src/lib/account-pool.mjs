// lib/account-pool.mjs - Token broker: 管理 1.365 akun OAuth MiniMax Code dengan refresh-token single-use yang aman.
import fs from 'node:fs';
import path from 'node:path';
import { MiniMaxCloud, DEFAULTS, refreshOAuth, ERR } from './minimax-client.mjs';

export class AccountPool {
  constructor(opts = {}) {
    this.accountsFile = opts.accountsFile;
    this.stateFile = opts.stateFile;
    this.cloud = opts.cloud || new MiniMaxCloud({});
    this.timezone = opts.timezone || DEFAULTS.timezone;
    this.log = opts.log || (() => {});
    this.accounts = [];
    this.byLabel = new Map();
    this.currentIndex = -1;
    this.agentIds = new Map();
    this.leases = new Map(); // chatId -> { label, sessionId, agentId }
  }

  // Muat pool akun. Format: [{label,email,accessToken,refreshToken,expiresAtMs,agentId,runtime}]
  load() {
    const raw = JSON.parse(fs.readFileSync(this.accountsFile, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.accounts || []);
    this.accounts = list.filter((a) => a && (a.accessToken || a.refreshToken));
    this.byLabel = new Map(this.accounts.map((a) => [a.label || a.email, a]));
    this.log('pool dimuat: ' + this.accounts.length + ' akun');
    return this.accounts.length;
  }

  size() { return this.accounts.length; }
  labels() { return this.accounts.map((a) => a.label || a.email); }

  // Refresh satu akun. WAJIB: token hasil refresh langsung ditulis balik ke file,
  // karena refresh token single-use -> token lama langsung invalid_grant.
  async refresh(label) {
    const acc = this.byLabel.get(label);
    if (!acc) throw new Error('akun tidak dikenal: ' + label);
    if (!acc.refreshToken) throw new Error('akun ' + label + ' tidak punya refresh token');
    const cred = await refreshOAuth({
      tokenUrl: DEFAULTS.tokenUrl, clientId: DEFAULTS.clientId,
      scope: DEFAULTS.scope, audience: DEFAULTS.audience,
      refreshToken: acc.refreshToken,
    });
    acc.accessToken = cred.accessToken;
    acc.refreshToken = cred.refreshToken;
    acc.expiresAtMs = cred.expiresAtMs;
    this.persist();
    this.log('refresh OAuth akun ' + label + ' -> token baru tersimpan');
    return acc;
  }

  persist() {
    if (!this.stateFile) return;
    const tmp = this.stateFile + '.tmp';
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ accounts: this.accounts, savedAt: Date.now() }, null, 2), 'utf8');
    fs.renameSync(tmp, this.stateFile);
  }

  async tokenFor(label) {
    const acc = this.byLabel.get(label);
    if (!acc) throw new Error('akun tidak dikenal: ' + label);
    const exp = Number(acc.expiresAtMs || 0);
    if (acc.accessToken && exp - Date.now() > 5 * 60 * 1000) return acc.accessToken;
    const r = await this.refresh(label);
    return r.accessToken;
  }

  // Agent id per akun. Cache; resolve via GET /agent (field 'name' = agent id).
  async agentIdFor(label) {
    if (this.agentIds.has(label)) return this.agentIds.get(label);
    const token = await this.tokenFor(label);
    const info = await this.cloud.resolveAgentId(token);
    if (!info || !info.agentId) throw new Error('agent id tidak ditemukan untuk akun ' + label);
    this.agentIds.set(label, info.agentId);
    return info.agentId;
  }

  async credit(label) {
    const token = await this.tokenFor(label);
    return this.cloud.credit(token);
  }

  // Klaim check-in harian untuk akun. Aman dipanggil berulang (server balas claim_result 2 = sudah diklaim).
  async claimCheckin(label) {
    const token = await this.tokenFor(label);
    const st = await this.cloud.signinStatus(token);
    if (st.claimedToday) return { action: 'already-claimed', today: st.today };
    const claim = await this.cloud.claimSignin(token);
    return { action: 'claimed', claimResult: claim.claimResult, points: claim.points, dayNo: claim.dayNo };
  }

  // Akun berikutnya yang punya kredit. Skip akun token mati / refresh invalid_grant.
  async nextUsable(fromIndex) {
    const n = this.accounts.length;
    for (let i = 1; i <= n; i++) {
      const idx = ((fromIndex + i) % n + n) % n;
      const acc = this.accounts[idx];
      const label = acc.label || acc.email;
      try {
        const c = await this.credit(label);
        if (c.remaining > 0) return { index: idx, label, credit: c };
      } catch (e) {
        // token mati: coba refresh sekali; kalau invalid_grant, tandai akun mati.
        if (e && e.kind === 'invalid_grant') { acc.dead = true; acc.deadReason = 'invalid_grant'; this.persist(); }
        else if (e && e.kind === ERR.AUTH) { try { await this.refresh(label); } catch (e2) { acc.dead = true; acc.deadReason = String(e2 && e2.kind || 'auth'); this.persist(); } }
      }
    }
    return null;
  }

  // --- Lease sesi per chat ---
  lease(chatId) { return this.leases.get(String(chatId)) || null; }
  setLease(chatId, info) { this.leases.set(String(chatId), Object.assign({}, this.leases.get(String(chatId)), info, { updatedAt: Date.now() })); }
  clearLease(chatId) { this.leases.delete(String(chatId)); }
  leaseCount() { return this.leases.size; }
}
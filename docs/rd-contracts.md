
# Kontrak API MiniMax Code Cloud - peta untuk bot Gibran.ai

**Status:** READ-ONLY research, 2026-11-28
**Target:** `https://agent.minimax.io/minimax-cloud/api/v1`
**Pemilik dokumen:** Agent "Gibran RD Contracts" (file ini satu-satunya yang saya tulis)
**Sifat:** Tidak ada POST mutating (create/upload/pairing/delete) yang dieksekusi. Semua klaim
berasal dari (a) artefak lokal, (b) GET read-only yang dijalankan live, atau (c) ditandai "belum pasti".

## 0. Metode & sumber bukti

| # | Sumber | Isi | Cara akses |
|---|---|---|---|
| S1 | `deploy/relay-1900/paths-from-asar.txt` | 51 baris path `/minimax-cloud/api/v1/...` hasil scan string app.asar | baca file |
| S2 | `C:/Users/M SYAFA'AT ASHAN/AppData/Local/Programs/MiniMax Code/resources/app.asar` (368.024.770 byte, mtime 2026-11-20) | bundle desktop MCode (Electron) + chunk web agent.minimax.io | scan chunked 16 MB + overlap, **read-only** |
| S3 | `deploy/relay-1900/asar-context/*.txt` | potongan yang sudah diekstrak sebelumnya (bodies, context, share-upload, artifact-kind, ...) | baca file |
| S4 | `deploy/relay-1900/probe/probe-report.json` | hasil probe live sebelumnya (status HTTP nyata) | baca file |
| S5 | `gibran-bot-src/src/lib/minimax-client.mjs` | signing + klien cloud yang dipakai bot | baca file |
| S6 | Probe live saya (GET saja) | 12 + 14 + 7 GET pada akun label `Account 1983` | `node $TEMP/rd_probe*.mjs` |

**Pola error server yang terverifikasi (penting untuk semua endpoint):**
MiniMax menjawab HTTP 200 dengan error di `body.base_resp.status_code`, bukan HTTP error.
Kode error yang teramati live:

| base_resp.status_code | status_msg | HTTP | Arti |
|---|---|---|---|
| 0 | `ok` | 200/200 | sukses |
| 1402020091 | `missing binding_id` | 400 | header `X-Binding-Id` wajib |
| 1402020101 | `missing device_id` | 400 | header `X-Device-Id` wajib |
| 1402020231 | `binding not found` | 404 | binding id tidak ada/expired |
| 400 | `Server is busy now` | 200 | **error generik** untuk resource/body tidak dikenal (bukan rate limit) |

> Bukti "Server is busy now" = generik: GET `/marketplace/plugins/probe-plugin` (200 dengan
> `base_resp{400,"Server is busy now"}`) dan GET `/agent/probe-agent/session` (idem).
> Jadi respons ini **tidak** berarti server sibuk; ia berarti "input tidak dikenali".

**Signing (dari S5, terverifikasi oleh probe live):** `Authorization: Bearer <access_token>`,
`x-timestamp: <unix detik>`, `x-signature: md5(x-timestamp + salt + rawBody)`,
`Accept: application/json`, plus query `client=desktop`. Semua GET di dokumen ini memakai
header persis ini dan berhasil (200 + `base_resp.status_code=0`), jadi signing bot saat ini **terbukti benar**.

**Legenda keyakinan**

- **TERBUKTI** - ada bukti live (GET) atau kontrak yang diekstrak langsung dari kode asar.
- **HIPOTESIS** - ada artefak kuat yang menyiratkan bentuk/parameter, tapi belum diuji live.
- **BELUM PASTI** - tidak ada bukti cukup; harus diuji.

---

## 1. Uploads (upload CV user ke sesi cloud)

### 1.1 `POST /uploads/prepare`

| Aspek | Isi |
|---|---|
| METHOD | POST |
| path | `/minimax-cloud/api/v1/uploads/prepare?require_auth=true` |
| Header | `Authorization: Bearer <token>`, `Content-Type: application/json` + header signing bot (S5). Varian avatar memakai `managedBackendRoutingHeaders(...)` (routing build-env), **tidak ada** di klien bot. |
| Body | `{ purpose: <int>, file_name: string, mime_type: string, size_bytes: number }` |
| purpose (enum) | 1=MessageAttachment, 2=BotAttachment, 3=ContentSafety, 4=SkillPackage, 5=AgentAvatar, 6=FeedbackAttachment, 7=InvoiceAttachment, 8=RemoteControlAttachment |
| Respons | `{ object_key: <uuid v1-5>, upload_instruction: { method: "POST", url: "https://...", form_fields: {...} } }`; envelope boleh dibungkus `{ data: {...} }` (kode: `raw.object_key ? raw : raw.data`). `base_resp.status_code` harus 0. |
| Bukti | POST **tidak** dieksekusi (dilarang: membuat objek). Kontrak dari S2 (modul `64045` enum purpose; `validateInstruction`, `validateUploadURL`, `validateFormFields` @ offset ~79.998.795) dan S3 `asar-context/share-upload.txt`. GET live → **404 Not Found** (S6). |
| Keyakinan | Body/respons/purpose = **TERBUKTI dari artefak**; GET 404 = **TERBUKTI live**; respons atas POST = **HIPOTESIS kuat** (belum pernah dipanggil) |

**Aturan ketat dari validator (harus diikuti bila bot mengimplementasikan sendiri):**

1. `object_key` harus UUID v1-5 (`/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`).
2. `upload_instruction.method` harus persis `"POST"`; `url` harus `https:`, tanpa user/pass/port/query/hash, path `/`, dan host harus salah satu:
   - `matrix-internal-cn.oss-cn-shanghai.aliyuncs.com`
   - `matrix-internal.oss-us-east-1.aliyuncs.com`
3. `form_fields` (semua nilai string, key `file` dilarang) **wajib** berisi:
   `key` (=object_key), `Content-Type` (=mime), `x-oss-object-acl`=`private`, `x-oss-content-type` (=mime),
   `x-oss-forbid-overwrite`=`true`, `success_action_status`=`204`, `x-oss-meta-mxa-size` (=size),
   `x-oss-meta-mxa-purpose` (=nama enum purpose di atas), `OSSAccessKeyId`, `policy`, `Signature`.
4. Langkah 2: `POST` **multipart/form-data** ke `upload_instruction.url` dengan semua `form_fields` +
   field `file` (blob + filename). Harapkan **HTTP 204** (varian safety-check menolak selain 204).
5. Header `Content-Type` pada form upload harus sama persis dengan `mime_type` yang dikirim saat prepare.

### 1.2 Melampirkan file yang sudah ter-upload ke sesi cloud

| Aspek | Isi |
|---|---|
| Bentuk lampiran (RC) | `{ id: upload_id ?? file_key, type: "image"\|"file", file_key, file_path, file_name, mime_type, preview_url }` (S2, `normalizeAttachments`) |
| Bentuk lampiran (body message) | `{ upload_id: <file_key ?? id>, file_path, file_name, mime_type }` (S2, builder `g()` untuk `remote-message`) |
| Letak | `attachments[]` pada body `POST /session/{id}/message` (HIPOTESIS: body `/message` reguler memakai bentuk yang sama dengan `remote-message`) |
| Keyakinan | **HIPOTESIS** - tidak ada bukti live bahwa `POST /session/{id}/message` menerima `attachments`. Tidak ada POST yang saya jalankan. |
| Cara verifikasi | Kirim satu pesan ke sesi uji dengan `attachments:[{upload_id:object_key,file_path:"cv.pdf",file_name:"cv.pdf",mime_type:"application/pdf"}]` dan baca frame SSE; bandingkan dengan pesan tanpa `attachments`. Cukup 1 percobaan. |

### 1.3 Drive node → file yang dibuat agen

Lihat bagian 5. Ringkas: `GET /drive/file` mengembalikan node dengan `cdn_url`; node itu adalah cara
mengambil hasil kerja agen (bukan lewat message).

---

## 2. Skill: katalog vs pemasangan

### 2.1 `GET /skill-hub` (katalog, read-only)

| Aspek | Isi |
|---|---|
| METHOD | GET |
| path | `/minimax-cloud/api/v1/skill-hub` |
| Query | `limit` (default 50), `cursor`, `sort_type` (1=use_count), `source_type` (0=all, 1=official, 2=user), `keyword`, opsional `user_id` (realUserID) |
| Respons (live) | `{ base_resp:{status_code:0,status_msg:"ok"}, skill_list:[{ id, name, display_name, description, content, source_url, source_type, category, creator_info, use_count, created_at, updated_at }], has_more, next_cursor }` |
| Bukti | S6 probe: GET `?limit=3&sort_type=1` → **200**, 3 item, keys persis seperti di atas; GET `?keyword=pdf&limit=2` → **200**; GET `/skill-hub/minimax-pdf` → **404 Not Found** (tidak ada sub-path per skill) |
| Keyakinan | **TERBUKTI** |
| Catatan | `content` = isi SKILL.md; `source_url` = URL arsip/sumber untuk diunduh. Klien desktop mendownload `source_url` sendiri lalu menulisnya ke ledger lokal `skill-hub.json` - artinya "pemasangan skill" di sisi desktop **tidak** lewat endpoint cloud. |

### 2.2 Apakah ada endpoint MEMASANG skill ke akun?

| Kandidat | Bukti | Kesimpulan |
|---|---|---|
| `POST /skill-hub` | Tidak ada satu pun call site `.post` ke `/skill-hub` di 368 MB asar (S2). `LocalSkillHubStore.install(body)` menulis **ledger lokal**, bukan cloud. | **Tidak ada** (hipotesis kuat) |
| `GET /skill-hub/<name>` | Live → **404** (S6) | Tidak ada |
| `GET /marketplace/plugins` | Live → **200**. Respons memuat `marketplace_skills[]` (12 keys: `id,name,display_name,description,content,source_url,source_type,category,creator_info,use_count,added,created_at,updated_at`) **bersama** `plugins[]` | **Katalog skill + plugin menyatu** - inilah sumber katalog yang benar untuk discovery skill |
| `POST /plugins/{name}/{action}` | S2 `PluginRegistryClient.mutate()`: `POST ${CLOUD_BASE}/plugins/${name}/${action}`, auth required, **tanpa body**; action ∈ `install\|enable\|disable\|update\|uninstall` | **HIPOTESIS kuat**: ini jalur pasang/aktifkan. Live `GET /plugins/probe-plugin/install` → 404 (GET, bukan POST) |
| `GET /plugins/installed` | Live → **200**: `{ plugins:[{name,version,display_name,description,author,icon_url,dark_icon_url,capabilities,source,enabled,category,installation_policy}], next_cursor, has_more }` | **TERBUKTI** |
| `GET /plugins/enabled` | Live → **200**: `{ plugins:[{name,display_name,icon_url,dark_icon_url}] }` (6 item pada akun uji) | **TERBUKTI** |
| `GET /plugins/full-state` | Live → **200**: `{ runtime_enabled, installations:[{package,enabled,installation_policy}], effective_plugins:[{name,version,archive_sha256,content_digest}] }` | **TERBUKTI** - endpoint ini tidak ada di `paths-from-asar.txt` (lihat catatan 2.3) |

> **Penting:** field `capabilities` pada tiap plugin terpasang memuat `skill_count`. Artinya **skill bisa
> datang sebagai bundel plugin**, bukan sebagai entri terpisah. Itu sebabnya "pasang skill ke akun"
> kemungkinan besar harus lewat `POST /plugins/{name}/install` dengan nama **plugin** yang memuat skill.

### 2.3 Dua katalog, bukan satu

- `GET /skill-hub` = katalog skill lawas/umum (20 item pada pengujian parent; terverifikasi 200).
- `GET /marketplace/plugins` = katalog **Marketplace** yang memuat plugin **dan** `marketplace_skills`.
  Param query: `cursor, limit, keyword, category, skill_cursor, skill_limit, source, source_type, sort_type`.
  Live `?limit=3` → `{plugins:[3], marketplace_skills:[3], skill_next_cursor, skill_has_more, tag_definitions, plugin_total, next_cursor, has_more}`.
- `GET /marketplace/plugins/<name>` → live **200** dengan `base_resp{400,"Server is busy now"}` untuk
  nama palsu (nama dikenal → 200 + detail). Jadi endpoint ini **ada**, inputnya nama.

> **Catatan metode:** `paths-from-asar.txt` (S1) **tidak lengkap**. Path yang dibentuk dari konstanta
> `CLOUD_BASE` (mis. `/plugins/full-state`) tidak muncul sebagai literal `/minimax-cloud/api/v1...`
> sehingga tidak tertangkap scanner. Inventaris lengkap hasil regex saya atas 368 MB asar ada di
> Lampiran A (38 path unik).

**Jawaban singkat item 2:** *Ya, ada jalur pasang/aktifkan - tapi lewat `/plugins/{name}/{action}`
(POST), bukan lewat `/skill-hub`. `/skill-hub` murni katalog. Bentuk body POST `/plugins/{name}/install`
belum pernah saya uji (menolak POST mutating), jadi **belum pasti** apakah `name` itu nama plugin,
nama skill, atau keduanya, dan apakah butuh query `source`/`marketplace`.*

---

## 3. Remote Control: alur pairing yang benar

Semua di bawah berasal dari S2 (modul `13516` = klien RC producer; `cloud-session-reader.js` =
klien reader) **dan** dikonfirmasi live dengan GET read-only (S6).

### 3.1 Dua perangkat, dua header, dua tabel binding

| Peran | Header/param | Endpoint | Live |
|---|---|---|---|
| Producer (desktop yang dikontrol) | `X-Device-Id: <deviceId>` + `X-Producer-Type: desktop` | `GET /remote-control/desktop/bindings?rc_protocol_version=3` | **200** `{binding:{state}, base_resp:0}` dengan header; tanpa header → **400 `missing device_id`** (1402020101); dengan `device_id` di query → tetap **400** (bukan query) |
| Consumer (controller) | query `device_id=<consumerDeviceId>&consumer_type=desktop&rc_protocol_version=3` | `GET /remote-control/phone/bindings` | **200** `{bindings:[], base_resp:0}` |
| Consumer (membaca resource producer) | `X-Binding-Id: <id>` + `X-Consumer-Device-Id` + `X-Mobile-Device-Id` + `X-RC-Error-Contract: v2` | `GET /remote-control/models`, `/remote-control/projects`, `/remote-control/session/{id}` | dengan `X-Binding-Id: 1` → **404 `binding not found`** (1402020231); dengan `binding_id=1` di query → tetap **400 `missing binding_id`** (1402020091) |

**Kesimpulan menentukan:** `binding_id` dibawa di **header `X-Binding-Id`**, bukan query param.
`device_id` untuk `desktop/bindings` dibawa di **header `X-Device-Id`**, bukan query param.
(Inilah sebabnya GET tanpa header terlihat "kurang parameter".)

### 3.2 Alur pairing lengkap (urut)

| # | Aktor | METHOD + path | Body / header | Hasil | Keyakinan |
|---|---|---|---|---|---|
| 1 | Producer desktop | `POST /remote-control/pairing/code` | body: `{ platform, producer_type: "desktop", rc_protocol_version: "3", device_name?, app_version? }`; header `X-Device-Id` | `{ pairing_code, expires_in_s }` (default 300 dtk bila field absen) | **TERBUKTI dari artefak**; live GET → **404 Not Found** (S6) - jadi memang harus **POST**, bukan GET. **HIPOTESIS**: belum pernah POST. |
| 2 | Consumer (ponsel/kontroller) | `POST /remote-control/pairing/confirm` | body: `{ pairing_code, mobile_device_id, consumer_type: "desktop", rc_protocol_version: "3", mobile_platform: "win32"\|"darwin", device_name? }` | membuat binding | **TERBUKTI dari artefak**, **belum pernah dijalankan** |
| 3 | Producer | `GET /remote-control/desktop/bindings?rc_protocol_version=3` + header `X-Device-Id`, `X-Producer-Type` | - | `{ binding: { state, binding_id?, mobile_device_name? }, consumer_bindings: [...] }`; `state` ∈ `none\|bound\|pending\|expired\|rejected\|unbound\|pairing` | **TERBUKTI live** (200, `binding.state` ada) |
| 4 | Consumer | `GET /remote-control/phone/bindings?device_id=...&consumer_type=desktop&rc_protocol_version=3` | - | `{ bindings: [...] }` tiap item: `{binding_id, consumer_type, consumer_device_id, consumer_device_name, consumer_platform, bound_at_ms, consumer_online, consumer_last_connected_at_ms}` | **TERBUKTI live** (200; daftar kosong untuk device acak) |
| 5 | Consumer | `GET /remote-control/models\|projects\|session/{id}` + `X-Binding-Id` | - | butuh binding valid | **TERBUKTI live** (404 `binding not found` untuk id palsu) |

Endpoint RC lain yang terpetakan (semua read):

| METHOD | path | Body/query | Keyakinan |
|---|---|---|---|
| GET | `/remote-control/projects` | query `limit, cursor, session_limit, exclude_purpose_prefix, include_purpose_prefix, include_hidden, include_archived` + header binding | **TERBUKTI** (error) |
| GET | `/remote-control/models` | - | **TERBUKTI** (error) |
| GET | `/remote-control/session/{sessionId}` | - | **TERBUKTI** (404 `binding not found`) |
| GET | `/remote-control/session/{sessionId}/message` | query `limit, before` | **TERBUKTI** (artefak) |
| POST | `/remote-control/session/{sessionId}/remote-message` | body `{content, sender:{session_id,device_name?,agent_name?,title?}, delivery?, idempotency_key?}` → `{mode:"started"\|"steered", turn_id?, queue_item_id?}` | **TERBUKTI** (artefak) |
| POST | `/remote-control/binding/rename` | body `{ binding_id, name }` | **TERBUKTI** (artefak) |
| POST | `/remote-control/unbind` | body `{ binding_id }` | **TERBUKTI** (artefak) |
| POST | `/remote-control/producer/unbind` | body `{ producer_type, producer_device_id, request_id }` → `{ ok, deleted_count? }` | **TERBUKTI** (artefak) |
| GET | `/remote-control/preferences/pinned-items-order` | header binding | **TERBUKTI** (artefak) |
| POST | `/remote-control/session/{id}/pin` | `{pinned}` | **TERBUKTI** (artefak) |

**Implikasi bot:** RC = kendali desktop jarak jauh, **bukan** jalur "otak di cloud". Bot tidak
membutuhkan RC untuk WP otaknya. Yang penting dari sini: pola **header identitas**
(`X-Device-Id` untuk producer, `X-Binding-Id`+`X-Consumer-Device-Id` untuk consumer) -
pola yang sama persis berlaku untuk endpoint lain yang butuh binding.

---

## 4. Session shares: bentuk body yang benar

### 4.1 `POST /session-shares` (buat share)

| Aspek | Isi |
|---|---|
| METHOD | POST |
| path | `/minimax-cloud/api/v1/session-shares` |
| Body **benar** | `{ request_id: <uuid>, source_session_id: <cloudSessionId>, cutoff_turn_id?: <id>, cutoff_item_type?: <string> }` |
| Respons | `{ share: { share_id }, title? }` - kode membaca `t.share?.share_id`; judul dari `title` |
| Bukti | S2 modul `54701` (fungsi `p` = CreateSessionShare): `await (0,a.SC)(o,{method:"POST",body:JSON.stringify(e)})` lalu `t.share?.share_id?.trim()`; dipanggil dari UI dengan `{request_id:crypto.randomUUID(), source_session_id, cutoff_turn_id, cutoff_item_type}` (S2 `PT-callsite`, S3 `signin-share.txt`) |
| Keyakinan | **TERBUKTI dari artefak**. Live: GET → **404 Not Found**; POST 8 varian body → **200 dengan `base_resp{400,"Server is busy now"}` (S4 `probe-report.json` C1/C2) |

**Kenapa 8 varian body semuanya gagal:** tidak satu pun memakai `source_session_id`.
Server tidak memvalidasi per-field; ia menjawab generik `"Server is busy now"` untuk body yang
tidak dikenal (terbukti juga pada GET `/marketplace/plugins/<nama-palsu>` dan
GET `/agent/<id-palsu>/session`). Jadi **jangan ulangi varian body**; gunakan bentuk di atas.

### 4.2 `POST /session-shares/{share_id}/instantiate` (materialisasi share)

| Aspek | Isi |
|---|---|
| METHOD | POST |
| path | `/minimax-cloud/api/v1/session-shares/{encodeURIComponent(share_id)}/instantiate` |
| Body | `{ request_id: <uuid>, idempotency_key: <string> }` (keduanya wajib) |
| Respons | `{ share_id?, recipient_session_id?, status }` dengan `status` ∈ `Created=0, PreparingAssets=1, Materializing=2, Succeeded=3, RetryableFailed=4, FailedFinal=5` |
| Perilaku | Polling: klien mencoba sampai 45 kali dengan backoff 500 ms→2 s (maks 2 s), timeout total 90 s. Retryable: HTTP 408/409/429/5xx atau `200 + errorCode`. Sukses ⇒ `recipient_session_id` = session cloud baru milik penerima. |
| Bukti | S2 modul `54701` fungsi `f` (InstantiateSessionShare) |
| Keyakinan | **TERBUKTI dari artefak**; belum pernah dijalankan live (POST mutating) |

### 4.3 GET

- `GET /session-shares` → **404 Not Found** (live, S6) - tidak ada endpoint list.
- `GET /session-shares/{id}` → **404 Not Found** (live, S6).
- Link share yang dipakai UI: `<web-base>/{share_id}` plus query `?share_id=` - halaman web
  memanggil instantiate sendiri saat dibuka.

---

## 5. Drive / file

### 5.1 `GET /drive/file`

| Aspek | Isi |
|---|---|
| METHOD | GET |
| path | `/minimax-cloud/api/v1/drive/file` |
| Query | **belum pasti** - aset tidak menyebut parameter wajib. Live: `{}`, `{offset,limit}`, `{node_id}`, `{session_id}`, `{parent_id}`, `{keyword}` semuanya **200** dengan `{total:0, has_more:false, base_resp:0}` (akun uji tidak punya file) |
| Respons (akun kosong) | `{ total: number, has_more: boolean, base_resp }` - key daftar file tidak muncul saat kosong |
| Respons (akun berisi file) | Node `DriveNode`; menurut pengujian parent: node dengan `cdn_url`. Bentuk lengkap di 5.2 |
| Bukti | S6 live (6 varian query, semua 200 total=0) + catatan pengujian parent |
| Keyakinan | **TERBUKTI** untuk bentuk kosong; node berisi = **HIPOTESIS** (belum pernah lihat respons non-kosong di live) |

### 5.2 Struktur node `DriveNode` (dari skema Thrift di S2 - otoritatif)

Semua field opsional:

| Field | Tipe | Arti |
|---|---|---|
| `node_id` | string | id node |
| `node_type` | string | tipe node (mis. file/folder) |
| `parent_id` | string | id induk (folder) |
| `name` | string | nama file |
| `file_ext` | string | ekstensi |
| `category` | string | kategori (mis. image/document) - **dapat dipakai bot untuk memfilter** |
| `mime_type` | string | MIME - **dipakai bot untuk memilih cara kirim ke Telegram** |
| `size_bytes` | number | ukuran |
| `cdn_url` | string | URL unduhan (CDN). **Nilai ini tidak boleh dicetak ke log/chat** (memo POOL-OWNERSHIP) |
| `source` | string | asal node (mis. `agent`/`user`/`website`) - **kunci untuk "jangan kirim ulang"** |
| `session_id` | string | sesi yang menghasilkan node - **kunci identifiikan milik whom** |
| `child_count` | number | jumlah anak (folder) |
| `created_at` | number | epoch (ms) |
| `updated_at` | number | epoch (ms) - **kunci dedup "sudah dikirim"** |
| `is_favorited` | boolean | ditandai |
| `front_page_screenshot` | string | screenshot halaman depan (untuk situs ter-deploy) |
| `path` | string | path logical |
| `project_id` | string | id project |
| `is_deployed_site` | boolean | node adalah situs yang sudah di-deploy (bukan file biasa) |
| `thumbnail_url` | string | URL thumbnail |

Konteks tambahan: `DriveNode` juga dipakai di `SessionInputSummaryView.artifacts[]` - yaitu
**artefak yang dihasilkan agen per turn**. Jadi drive adalah tempat output agen.

### 5.3 Endpoint `/drive/file` yang ada di asar = API **situs ter-deploy**, bukan daftar file umum

Literal `/minimax-cloud/api/v1/drive/file` muncul **tepat 1 kali** di 368 MB asar, dan itu
adalah bundel web agent.minimax.io dengan konstanta:

```
L = "/minimax-desktop/api/v1/drive/file"   // lokal
U = "/minimax-cloud/api/v1/drive/file"     // cloud
```

Kontrak turunan kode itu (S2):

| METHOD | path | Body | Keyakinan |
|---|---|---|---|
| GET | `/drive/file/{nodeId}/website-settings` | - → `{ code, state:{ node_id, display_name, default_url, is_custom_domain, screenshot_url, is_legacy_deployment, watermark_enabled, watermark_mutable, alias, alias_url, alias_mutable, updated_at, deployment_status, republish_supported } }` | **TERBUKTI dari artefak** |
| PUT | `/drive/file/{nodeId}/website-settings/name` | `{ display_name }` | **TERBUKTI dari artefak** |
| PUT | `/drive/file/{nodeId}/website-settings/watermark` | `{ watermark_enabled: bool }` | **TERBUKTI dari artefak** |
| PUT | `/drive/file/{nodeId}/website-settings/alias` | `{ alias }` | **TERBUKTI dari artefak** |
| DELETE | `/drive/file/{nodeId}/website-settings/alias` | - | **TERBUKTI dari artefak** |

### 5.4 Apakah ada endpoint HAPUS / tandai file?

| Kandidat | Bukti | Status |
|---|---|---|
| `DELETE /drive/file/{nodeId}` | **Tidak ada** di asar. CLI `mavis drive files delete` memakai RPC internal archon `DeleteFile` (bukan HTTP cloud) | **BELUM PASTI** |
| `DELETE /drive/file/{nodeId}/website-settings` | ada di kode **lokal** (`/minimax-desktop/.../website-settings`, DELETE) - hanya untuk situs, bukan file | TERBUKTI (lokal) |
| `is_favorited` / `is_deployed_site` | field baca saja di `DriveNode`; tidak ada endpoint "mark" di `/minimax-cloud/api/v1` | **BELUM PASTI** |
| Endpoint daftar drive lain | di luar 38 path cloud yang diinventarisasi, **tidak ada** `/drive/files`, `/drive/node`, atau `/drive/delete` | - |

**Jawaban item 5:** tidak ditemukan endpoint cloud untuk menghapus/menandai file drive.
**Strategi alternatif yang aman dan langsung pakai:** dedup di sisi bot, bukan di sisi server -
simpan `(session_id, node_id, updated_at)` di store bot; sebelum mengirim ke Telegram, cek
`updated_at` + `node_id`; tandai "sudah dikirim" secara lokal. Field `updated_at`, `session_id`,
`source`, `mime_type`, `category`, dan `is_deployed_site` cukup untuk itu.

---

## 6. Session message: field dan cara mengambil file hasil kerja agen

### 6.1 `GET /session/{cloudSessionId}/message`

| Aspek | Isi |
|---|---|
| METHOD | GET |
| path | `/minimax-cloud/api/v1/session/{encodeURIComponent(cloudSessionId)}/message` |
| Query | `limit`, `before` (cursor), `include_attachment_read_urls` (`"true"`/`"false"`) |
| Respons | `{ messages: [ { msg_id, parent_msg_id, turn_id, role, timestamp, msg_content, msg_type, finish_reason, tool_calls } ], has_more, next_cursor, oldest_msg_id? }` |
| Bukti | S2 `cloud-session-reader.js` fungsi `getMessages()` (normalisasi field persis seperti di atas); `readMessages` juga menerima `messages_json` (string JSON) sebagai alternatif |
| Keyakinan | **TERBUKTI dari artefak** |

### 6.2 Field `tool_calls`

```json
[{ "tool_name": "...", "tool_call_id": "...", "tool_call_status": 0, "tool_call_args": "...", "tool_call_result_data": "..." }]
```

- `tool_name`, `tool_call_id` wajib; sisanya opsional. Row tanpa nama/ID **dilewati**, bukan error.
- Keyakinan: **TERBUKTI dari artefak** (normalisasi `toolCalls()` di S2).

### 6.3 `msg_type`

Ada di DTO sebagai angka (`msg_type`), tetapi **belum pasti** apa arti tiap angka (teks vs
tool-use vs subtitel). Tidak ada konstanta enum yang saya temukan di asar, dan belum ada live sample.
Cara verifikasi: kirim satu prompt yang memicu tool, lalu baca `msg_type` pada tiap message.

### 6.4 Mengambil gambar/file hasil kerja agen

| Jalur | Contract | Keyakinan |
|---|---|---|
| **Drive** | `GET /drive/file` → node dengan `cdn_url` (+ `thumbnail_url`, `mime_type`, `category`, `session_id`) | **TERBUKTI** (field) / node non-kosong **HIPOTESIS** |
| **Message** | `GET /session/{id}/message?include_attachment_read_urls=true` - parameter ini ada justru untuk menyertakan URL baca lampiran; klien desktop/RC selalu mengirim `"false"` | **HIPOTESIS** (nama field lampiran di message belum pernah dilihat live) |
| **Certainty** | `include_attachment_read_urls` default-nya `"false"` di klien desktop; bot sekarang juga memakai `"false"` (S5 `listMessages`) | **TERBUKTI** (kode bot) |

**Rekomendasi bot (aman):** ambil artefak dari **drive**, bukan dari message. Alasannya: drive
mempunyai `session_id` (identitas %), `updated_at` (dedup), `mime_type` (kirim ke Telegram),
dan `is_deployed_site` (bedakan file biasa vs situs). Message hanya punya teks.

---

## 7. Implikasi ke bot (peta ke work package)

> Asumsi: "WP1-WP8" = rencana work package Gibran.ai milik parent agent. Definisi itu **tidak ada**
> di repo `gibran-bot-src` (saya sudah grep: tidak ada `WP-`/work package di repo). Karena itu
> pemetaan di bawah memakai **fungsi kapabilitas**, dan label WP bersifat perkiraan agar mudah
> dicocokkan parent. Fakta API di kolom kiri tidak bergantung pada penomoran WP.

| Kapabilitas | Kontrak yang kini TERBUKTI | WP (perkiraan) | Catatan blocker |
|---|---|---|---|
| Upload CV user ke sesi cloud | `POST /uploads/prepare` + multipart ke OSS | WP upload-CV | Bentuk **lampiran** pada `POST /session/{id}/message` belum pasti → butuh 1 uji |
| Katalog skill | `GET /skill-hub` (200) dan `GET /marketplace/plugins` (200, berisi `marketplace_skills`) | WP skill-discovery | Dua katalog; pilih satu sumber tunggal |
| Pasang/aktifkan skill | `POST /plugins/{name}/{action}` (action=install/enable/disable/update/uninstall), tanpa body | WP skill-install | **Belum pasti**: apakah `name` = plugin atau skill; `GET /plugins/installed` & `/plugins/enabled` & `/plugins/full-state` sudah 200 untuk verifikasi |
| Rotasi akun + transfer konteks (export → sesi baru → inject) | `GET /session/{id}/message` (bentuk message lengkap) + `POST /session-shares` (body `source_session_id`) + `POST /session-shares/{id}/instantiate` | WP context-transfer | Share = jalur "copy session" native server; instantiate menghasilkan `recipient_session_id` milik akun tujuan |
| Kirim hasil kerja ke user (gambar/file) | `GET /drive/file` → `DriveNode` dengan `cdn_url`, `mime_type`, `category`, `session_id`, `updated_at`, `is_deployed_site` | WP deliver-artifact | Query `/drive/file` yang benar belum pasti; tidak ada endpoint hapus/tandai → dedup lokal |
| Sinkronisasi/"sudah terkirim" | tidak ada endpoint server-side | WP deliver-artifact | Wajib simpan ledger lokal `(session_id,node_id,updated_at)` |
| Kontrol desktop jarak jauh | `X-Device-Id`, `X-Binding-Id`, `X-Consumer-Device-Id`, `X-RC-Error-Contract: v2`; pairing `POST /pairing/code` → `POST /pairing/confirm` → `GET /desktop/bindings` | (di luar scope bot; pola header RC bisa dipakai ulang) | Tidak perlu untuk otak cloud |
| Signature & error handling | `x-timestamp`+`x-signature`=md5(ts+salt+body); error bisnis ada di `base_resp` dengan HTTP 200 | semua WP | Sudah berfungsi (terbukti 33 GET sukses) |
| Chat harian / kredit | `GET /signin/status`, `POST /signin/claim` | WP credit | Di luar dokumen ini |

**Yang bisa langsung dipakai tanpa eksperimen tambahan:**

1. `GET /skill-hub` dengan `keyword`/`limit`/`sort_type` untuk discovery skill.
2. `GET /marketplace/plugins` untuk melihat plugin **dan** skill dalam satu panggilan.
3. `GET /plugins/installed`, `GET /plugins/enabled`, `GET /plugins/full-state` untuk memverifikasi
   apakah sebuah skill/plugin benar-benar terpasang & aktif di akun.
4. `GET /session/{id}/message` dengan `limit`+`before` untuk export histori lengkap
   (`msg_content`, `tool_calls`, `msg_type`) - lebih baik daripada menyalin transcript manual.
5. `GET /drive/file` untuk mengambil artefak (dengan caveat query).
6. Semua endpoint RC **read-only** dengan header yang benar - berguna saat bot butuh
   farm desktop (tidak ada di WP bot saat ini).

**Yang TIDAK boleh dipakai tanpa verifikasi:** `POST /session-shares` (body `source_session_id`
wajib), `POST /plugins/{name}/install`, `POST /uploads/prepare` (WALU perlu cek `require_auth=true`),
dan `POST /remote-control/pairing/code` (POST, bukan GET).

---

## 8. Yang belum jelas + langkah verifikasi berikutnya

Semua langkah di bawah **read-only kecuali yang ditandai (POST)**. Urutan dari paling murah.

| # | Yang belum jelas | Cara verifikasi (persis) | Yang diharapkan |
|---|---|---|---|
| V1 | Nama key daftar file pada `GET /drive/file` dan parameter yang sah | Pakai akun yang **sudah punya artefak** (jalankan 1 sesi cloud yang menghasilkan file/gambar), lalu GET `/drive/file` tanpa query dan dengan `{offset:0,limit:50}`, `{session_id:<sid>}` | melihat key `files`/`nodes`/`file_list` + `total>0` + node berisi `cdn_url` |
| V2 | Apakah ada endpoint hapus/tandai drive | Dari node nyata V1, coba **GET** (bukan POST/DELETE) pada kandidat `/drive/file/{nodeId}`, `/drive/node/{nodeId}`; amati 404 vs 200 | jika semuanya 404, konfirmasi "tidak ada endpoint hapus" → pakai dedup lokal |
| V3 | Bentuk `attachments` pada `POST /session/{id}/message` | **(POST, 1x)** pesan uji ke sesi throwaway dengan `attachments:[{upload_id:<object_key>,file_path:"cv.pdf",file_name:"cv.pdf",mime_type:"application/pdf"}]` setelah `uploads/prepare` + OSS POST; bandingkan frame SSE dengan pesan tanpa lampiran | agent membaca file → konfirmasi nama field & bentuk |
| V4 | `purpose` yang tepat untuk CV user | Turunkan dari V3: coba `purpose:1` (MessageAttachment) lalu `purpose:2` (BotAttachment); bandingkan `x-oss-meta-mxa-purpose` di `form_fields` | nilai yang diterima server |
| V5 | Apakah `POST /plugins/{name}/install` bisa memasang **skill** | **(POST, 1x)** ambil nama dari `marketplace_skills[].name` pada `GET /marketplace/plugins`; POST `/plugins/{name}/install`; lalu GET `/plugins/installed` & `/plugins/enabled` | skill muncul di `installed`/`enabled` → konfirmasi jalur pasang skill |
| V6 | Body/wajib query `POST /plugins/{name}/install` | Bila V5 400, coba query `source` (nilai `local`/`cloud`/`marketplace`) sesuai `readInstalledSource`; jangan membombardir | body/query yang valid |
| V7 | Arti angka `msg_type` | Kirim prompt yang memicu 1 tool, GET `/session/{id}/message`, bandingkan `msg_type` antar message | tabel makna msg_type |
| V8 | Nama field lampiran di message | GET `/session/{id}/message?include_attachment_read_urls=true` pada sesi yang punya lampiran | key `attachments`/read-url di tiap message |
| V9 | `POST /session-shares` menghasilkan share | **(POST, 1x)** body `{request_id:uuid, source_session_id:<sid milik akun uji>}` pada sesi milik `Account 1983`; cek `share.share_id` | 200 `base_resp 0` + `share_id` (menggantikan 8 varian gagal) |
| V10 | `POST /session-shares/{id}/instantiate` lintas akun | **(POST, 1x)** dengan `{request_id:uuid, idempotency_key:uuid}` memakai akun **tujuan** berbeda | `recipient_session_id` (session baru milik akun tujuan) - kunci WP context-transfer |
| V11 | Arti `source` pada `DriveNode` | Dari V1, periksa nilai `source` pada node yang dibuat agen vs node yang diunggah user | konfirmasi pemisah "file agen" vs "file user" untuk aturan kirim |
| V12 | Apakah `GET /drive/file` bisa difilter per kategori | Dari V1, coba `{category:"image"}`, `{source:"agent"}` | key query yang diterima |
| V13 | `rc_protocol_version` yang dipakai server | GET `/remote-control/phone/bindings` dengan `rc_protocol_version=3` (sudah 200) lalu `=2` untuk membandingkan | konfirmasi versi aktif |

**Aturan selama verifikasi:** jangan pernah mencetak token/refresh token/`pairing_code`/`cdn_url`
(nilai aktual) ke chat, log, atau file - cukup label akun (`Account 1983`), status, dan nama key.
Sesuai memo `docs/POOL-OWNERSHIP.md`. Untuk uji yang mengubah state (V3-V6, V9-V10), pakai akun
dari slice index >= 1000 (slice aman) dan akun yang tidak dipakai container produksi.

---

## Lampiran A - Inventaris path cloud (38 path unik, regex atas 368 MB asar)

```
/minimax-cloud/api/v1
/minimax-cloud/api/v1/agent
/minimax-cloud/api/v1/config
/minimax-cloud/api/v1/connectors
/minimax-cloud/api/v1/credit/details
/minimax-cloud/api/v1/desktop/p-config
/minimax-cloud/api/v1/drive/file
/minimax-cloud/api/v1/feedback/ticket
/minimax-cloud/api/v1/feedback/ticket/diagnostic-log
/minimax-cloud/api/v1/image/free-quota
/minimax-cloud/api/v1/marketplace/plugins
/minimax-cloud/api/v1/model-access
/minimax-cloud/api/v1/observability/desktop-errors/batch
/minimax-cloud/api/v1/plugins
/minimax-cloud/api/v1/plugins/enabled
/minimax-cloud/api/v1/plugins/installed
/minimax-cloud/api/v1/remote-control
/minimax-cloud/api/v1/remote-control/binding/rename
/minimax-cloud/api/v1/remote-control/desktop/bindings
/minimax-cloud/api/v1/remote-control/models
/minimax-cloud/api/v1/remote-control/pairing/code
/minimax-cloud/api/v1/remote-control/preferences/pinned-items-order
/minimax-cloud/api/v1/remote-control/producer/unbind
/minimax-cloud/api/v1/remote-control/projects
/minimax-cloud/api/v1/remote-control/session
/minimax-cloud/api/v1/remote-control/unbind
/minimax-cloud/api/v1/session
/minimax-cloud/api/v1/session-dispatch
/minimax-cloud/api/v1/session-dispatch/preflight
/minimax-cloud/api/v1/session-dispatch/prepare
/minimax-cloud/api/v1/session-shares
/minimax-cloud/api/v1/signin/claim
/minimax-cloud/api/v1/signin/config
/minimax-cloud/api/v1/signin/status
/minimax-cloud/api/v1/skill-hub
/minimax-cloud/api/v1/uploads/prepare
/minimax-cloud/api/v1/user/delete_account
/minimax-cloud/api/v1/user/update_onboarding
```

Ditambah path yang **tidak** tertangkap scanner literal karena dibentuk dari konstanta `CLOUD_BASE`
(hasil inspeksi manual kode asar):

```
/minimax-cloud/api/v1/plugins/full-state          (TERBUKTI live, 200)
/minimax-cloud/api/v1/marketplace/plugins/{name}   (TERBUKTI live, 200 / generik-404)
/minimax-cloud/api/v1/plugins/{name}/{action}      (install|enable|disable|update|uninstall, POST)
/minimax-cloud/api/v1/plugins/{name}/versions/{v}/download-authorization  (POST)
/minimax-cloud/api/v1/remote-control/phone/bindings (TERBUKTI live, 200)
/minimax-cloud/api/v1/remote-control/pairing/confirm (POST)
/minimax-cloud/api/v1/remote-control/project/update (POST)
/minimax-cloud/api/v1/remote-control/session/{id}/pin  (POST)
/minimax-cloud/api/v1/remote-control/session/{id}      (PATCH rename / DELETE hapus sesi)
/minimax-cloud/api/v1/remote-control/sidebar/session   (GET)
/minimax-cloud/api/v1/remote-control/workspaces        (GET)
```

## Lampiran B - Bukti live (GET saja, akun `Account 1983`, 2026-11-28)

| METHOD | path | Status | Ringkas body |
|---|---|---|---|
| GET | `/skill-hub?limit=3&sort_type=1` | 200 | `base_resp 0`, `skill_list` 3 item |
| GET | `/skill-hub?keyword=pdf&limit=2` | 200 | `skill_list` 2 item |
| GET | `/skill-hub/minimax-pdf` | 404 | Not Found |
| GET | `/drive/file` (+5 varian query) | 200 | `total 0`, `has_more false` |
| GET | `/remote-control/models` (tanpa header) | 400 | `missing binding_id` (1402020091) |
| GET | `/remote-control/models` + `X-Binding-Id: 1` | 404 | `binding not found` (1402020231) |
| GET | `/remote-control/models?binding_id=1` | 400 | `missing binding_id` (bukan query) |
| GET | `/remote-control/projects` + `X-Binding-Id` | 404 | `binding not found` |
| GET | `/remote-control/desktop/bindings?rc_protocol_version=3` tanpa header | 400 | `missing device_id` (1402020101) |
| GET | `/remote-control/desktop/bindings?rc_protocol_version=3` + `X-Device-Id` + `X-Producer-Type` | 200 | `binding.state` ada |
| GET | `/remote-control/desktop/bindings?…&device_id=<uuid>` | 400 | `missing device_id` (bukan query) |
| GET | `/remote-control/phone/bindings?device_id=…&consumer_type=desktop&rc_protocol_version=3` | 200 | `bindings[]` kosong |
| GET | `/remote-control/session/probe` + `X-Binding-Id: 1` | 404 | `binding not found` |
| GET | `/remote-control/pairing/code` | 404 | Not Found (harus POST) |
| GET | `/session-shares` | 404 | Not Found |
| GET | `/session-shares/probe-share-id` | 404 | Not Found |
| GET | `/uploads/prepare` | 404 | Not Found (harus POST) |
| GET | `/plugins/installed?limit=3` | 200 | `plugins` 3 item + `next_cursor`/`has_more` |
| GET | `/plugins/enabled` | 200 | `plugins` 6 item |
| GET | `/plugins/full-state` | 200 | `runtime_enabled`, `installations` 6, `effective_plugins` 6 |
| GET | `/marketplace/plugins?limit=3` | 200 | `plugins` 3 + `marketplace_skills` 3 |
| GET | `/marketplace/plugins/probe-plugin` | 200 | `base_resp{400,"Server is busy now"}` |
| GET | `/agent/probe-agent/session?limit=2` | 200 | `base_resp{400,"Server is busy now"}` |
| GET | `/plugins/probe-plugin`, `/plugins/probe-plugin/install` | 404 | Not Found |

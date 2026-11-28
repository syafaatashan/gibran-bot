// test/linkedin-plan.mjs - Uji offline modul linkedin (tanpa jaringan, tanpa browser).
// Semua data di bawah ini fixture palsu, tidak memuat data pribadi nyata.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(p).href);

const searchMod = await imp(path.join(HERE, '..', 'src', 'linkedin', 'search.mjs'));
const applyMod = await imp(path.join(HERE, '..', 'src', 'linkedin', 'apply.mjs'));
const trackerMod = await imp(path.join(HERE, '..', 'src', 'linkedin', 'tracker.mjs'));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' - ' + detail : ''));
}

// --- Fixture lowongan (palsu) ---
const FIXTURE_LISTING = {
  company: 'PT Contoh Teknologi',
  role: 'Data Analyst',
  type: 'remote',
  location: 'Jakarta, Indonesia',
  url: 'https://www.linkedin.com/jobs/view/4100000001',
};
const FIXTURE_CV = {
  summary: 'Analis data dengan pengalaman 4 tahun',
  skills: ['SQL', 'Python'],
  education: 'S1 Ekonomi',
};

// ================= SEARCH =================
const plan = searchMod.buildSearchPlan({ keywords: 'data analyst', location: 'Jakarta, Indonesia', limit: 10 });
check('S1 url target linkedin', plan.url.indexOf('https://www.linkedin.com/jobs/search/?keywords=') === 0, plan.url);
check('S2 location ter-encode di url', plan.url.indexOf('&location=Jakarta%2C%20Indonesia') > 0, plan.url);
check('S3 queries 5-10 variasi', plan.queries.length >= 5 && plan.queries.length <= 10, plan.queries.length + ' query');
check('S4 query ringkas 1-6 kata', plan.queries.every((q) => q.split(' ').length >= 1 && q.split(' ').length <= 6), plan.queries.join(' | '));
check('S5 outputFile CSV lowongan', plan.outputFile === '/workspace/output/Job_Listings.csv', plan.outputFile);
check('S6 kolom sesuai skema', plan.columns.join(',') === 'company,role,type,location,url,contact,salary,match_score,notes,date_found,status', plan.columns.join(','));
const gtext = plan.guardrails.join(' | ').toLowerCase();
check('S7 guardrail: fetch/captcha/mengarang/konfirmasi', /fetch/.test(gtext) && /captcha/.test(gtext) && /mengarang/.test(gtext) && /konfirmasi/.test(gtext));
const itext = plan.instructions.join(' ').toLowerCase();
check('S8 instruksi: browser, storage state, viewport, frame, csv', /browser/.test(itext) && /storage state/.test(itext) && /1280x900/.test(itext) && /frame_latest\.png/.test(itext) && /frame_status\.json/.test(itext) && /job_listings\.csv/.test(itext));
check('S9 instruksi: frame_status isi goal/url/step/caption', /goal/.test(itext) && /url/.test(itext) && /step/.test(itext) && /caption/.test(itext));
check('S10 instruksi: fallback Indeed + Glassdoor', /indeed/.test(itext) && /glassdoor/.test(itext));

const CARDS = [
  'Senior Data Analyst',
  'PT Contoh Teknologi',
  'Jakarta, Indonesia',
  'https://www.linkedin.com/jobs/view/4100000001',
  '',
  'Backend Engineer',
  'PT Contoh Digital',
  'Remote',
  'https://www.linkedin.com/jobs/view/4100000002',
].join('\n');
const cards = searchMod.parseListingCards(CARDS);
check('S11 parseListingCards jumlah kartu', cards.length === 2, cards.length + ' kartu');
check('S12 parseListingCards isi kartu 1', cards[0].title === 'Senior Data Analyst' && cards[0].company === 'PT Contoh Teknologi' && cards[0].location === 'Jakarta, Indonesia' && cards[0].url === 'https://www.linkedin.com/jobs/view/4100000001', JSON.stringify(cards[0]));
check('S13 parseListingCards kartu remote', cards[1].company === 'PT Contoh Digital' && cards[1].location === 'Remote', JSON.stringify(cards[1]));
check('S14 parseListingCards teks kosong', Array.isArray(searchMod.parseListingCards('')) && searchMod.parseListingCards('').length === 0);
const CARDS2 = 'Data Analyst di PT Contoh | Jakarta\nhttps://www.linkedin.com/jobs/view/4100000003';
const cards2 = searchMod.parseListingCards(CARDS2);
check('S15 parseListingCards toleran "Title di Company | Kota"', cards2.length === 1 && cards2[0].title === 'Data Analyst' && cards2[0].company === 'PT Contoh' && cards2[0].location === 'Jakarta', JSON.stringify(cards2[0]));
const CARDS3 = 'Senior Data Analyst, PT Contoh Teknologi, Jakarta, Indonesia\nhttps://www.linkedin.com/jobs/view/4100000004';
const cards3 = searchMod.parseListingCards(CARDS3);
check('S16 parseListingCards toleran satu baris gabungan', cards3.length === 1 && cards3[0].title === 'Senior Data Analyst' && cards3[0].company === 'PT Contoh Teknologi' && cards3[0].location === 'Jakarta, Indonesia', JSON.stringify(cards3[0]));

// ================= APPLY =================
const confirmPlan = applyMod.buildApplyPlan({ listing: FIXTURE_LISTING, cv: FIXTURE_CV, mode: 'confirm', dailyCap: 5, appliedToday: 1 });
check('A1 mode confirm needsConfirmation true', confirmPlan.needsConfirmation === true);
const confirmHasSubmit = confirmPlan.steps.some((s) => /submit/i.test(String(s.do)) || /submit/i.test(String(s.detail)) || /submit/i.test(String(s.guard)));
check('A2 mode confirm tanpa langkah submit', !confirmHasSubmit, confirmPlan.steps.map((s) => s.do).join(' > '));
check('A3 mode confirm berhenti di review', confirmPlan.steps[confirmPlan.steps.length - 1].do === 'review', confirmPlan.steps[confirmPlan.steps.length - 1].do);
check('A4 mode confirm delay antar aksi 3-8 detik', confirmPlan.steps.every((s) => s.delaySec >= 3 && s.delaySec <= 8));
check('A5 mode confirm message: bahan + JANGAN submit', /resume_tailored\.md/.test(confirmPlan.message) && /cover_letter\.md/.test(confirmPlan.message) && /followup_email\.md/.test(confirmPlan.message) && /jangan tekan tombol kirim/i.test(confirmPlan.message));
check('A6 mode confirm summary Bahasa Indonesia', /konfirmasi/i.test(confirmPlan.summary) && /belum dikirim/i.test(confirmPlan.summary), confirmPlan.summary);
check('A7 stopConditions lengkap', ['captcha', 'challenge', '999', '429', '403'].every((s) => confirmPlan.stopConditions.indexOf(s) >= 0) && confirmPlan.stopConditions.some((s) => /verifikasi identitas/i.test(s)), confirmPlan.stopConditions.join(','));

const autoPlan = applyMod.buildApplyPlan({ listing: FIXTURE_LISTING, cv: FIXTURE_CV, mode: 'auto', dailyCap: 5, appliedToday: 2 });
check('A8 mode auto punya langkah submit', autoPlan.steps.some((s) => s.do === 'submit'), autoPlan.steps.map((s) => s.do).join(' > '));
check('A9 mode auto di bawah cap tidak perlu konfirmasi', autoPlan.needsConfirmation === false);
const submitStep = autoPlan.steps.find((s) => s.do === 'submit');
check('A10 jeda sebelum submit minimal 20 detik', !!submitStep && submitStep.delaySec >= 20, submitStep ? submitStep.delaySec + ' detik' : 'tidak ada');
check('A11 langkah lain delay 3-8 detik', autoPlan.steps.filter((s) => s.do !== 'submit').every((s) => s.delaySec >= 3 && s.delaySec <= 8));
check('A12 message auto boleh kirim + aturan CV', /tekan tombol kirim/i.test(autoPlan.message) && /hanya dari data cv/i.test(autoPlan.message) && /jangan mengarang/i.test(autoPlan.message));

const blockedPlan = applyMod.buildApplyPlan({ listing: FIXTURE_LISTING, cv: FIXTURE_CV, mode: 'auto', dailyCap: 5, appliedToday: 5 });
check('A13 cap terlampaui needsConfirmation true', blockedPlan.needsConfirmation === true);
check('A14 cap terlampaui blockedReason', /batas harian tercapai/i.test(blockedPlan.blockedReason), blockedPlan.blockedReason);
check('A15 cap terlampaui tidak ada langkah submit', !blockedPlan.steps.some((s) => s.do === 'submit'));
check('A16 jeda antar lowongan minimal 20 detik', blockedPlan.minGapBetweenListingsSec >= 20, blockedPlan.minGapBetweenListingsSec + ' detik');

check('A17 shouldStop deteksi captcha', applyMod.shouldStop('captcha') === true);
check('A18 shouldStop deteksi HTTP 999', applyMod.shouldStop('HTTP 999') === true);
check('A19 shouldStop deteksi 429', applyMod.shouldStop('429 Too Many Requests') === true);
check('A20 shouldStop deteksi please verify', applyMod.shouldStop('please verify your identity') === true);
check('A21 shouldStop deteksi challenge/403/sign in', applyMod.shouldStop('challenge') && applyMod.shouldStop('403 Forbidden') && applyMod.shouldStop('Please sign in to continue'));
check('A22 shouldStop teks biasa false', applyMod.shouldStop('Silakan lengkapi biodata dan pengalaman kerja Anda') === false);
check('A23 shouldStop teks kosong false', applyMod.shouldStop('') === false);
const d1 = applyMod.humanDelay('seed-1');
const d2 = applyMod.humanDelay('seed-1');
const d3 = applyMod.humanDelay('seed-2');
check('A24 humanDelay deterministik dan 3-8 detik', d1 === d2 && d1 >= 3 && d1 <= 8 && d3 >= 3 && d3 <= 8, d1 + '/' + d2 + '/' + d3);

// ================= TRACKER =================
const CSV = [
  'company,role,type,location,url,contact,salary,match_score,notes,date_found,status,updated_at',
  'PT Contoh Teknologi,Data Analyst,remote,Jakarta,https://www.linkedin.com/jobs/view/4100000001,,,5,cocok,2026-11-28,applied,2026-11-28',
  'PT Contoh Digital,Backend Engineer,hybrid,Bandung,https://www.linkedin.com/jobs/view/4100000002,,,4,ok,2026-11-28,reviewing,2026-11-28',
  'PT Contoh Lama,Analist Data,remote,Surabaya,https://www.linkedin.com/jobs/view/4100000003,,,3,lama,2026-11-20,skipped,2026-11-28',
  'PT Kutip,Analist Data,remote,Medan,https://www.linkedin.com/jobs/view/4100000004,,,2,"catatan, dengan koma",2026-11-28,new,2026-11-28',
].join('\n');
const rows = trackerMod.parseCsv(CSV);
check('T1 parseCsv jumlah baris', rows.length === 4, rows.length + ' baris');
check('T2 parseCsv header aware', rows[0].company === 'PT Contoh Teknologi' && rows[0].role === 'Data Analyst' && rows[0].match_score === '5', JSON.stringify(rows[0]));
check('T3 parseCsv kutip dengan koma', rows[3].notes === 'catatan, dengan koma', rows[3].notes);
const csvOut = trackerMod.toCsv(rows);
const rows2 = trackerMod.parseCsv(csvOut);
check('T4 toCsv roundtrip', JSON.stringify(rows2) === JSON.stringify(rows), csvOut.split('\n').length + ' baris csv');
check('T5 toCsv escape koma', /"catatan, dengan koma"/.test(csvOut));

const up1 = trackerMod.upsertRow(rows, { company: 'PT Contoh Teknologi', role: 'Data Analyst', url: 'https://www.linkedin.com/jobs/view/4100000001', date_found: '2026-11-28', status: 'new' });
check('T6 upsert dedupe company+role+url', up1.length === rows.length, up1.length + ' baris');
const up2 = trackerMod.upsertRow(rows, { company: 'PT Contoh Teknologi', role: 'Data Analyst', url: 'https://www.linkedin.com/jobs/view/4100000999', date_found: '2026-12-01' });
check('T7 upsert URL beda tetap ditambah', up2.length === rows.length + 1, up2.length + ' baris');
const refreshed = up2.filter((r) => r.url === 'https://www.linkedin.com/jobs/view/4100000001')[0];
check('T8 upsert company+role sama refresh date_found', !!refreshed && refreshed.date_found === '2026-12-01', refreshed ? refreshed.date_found : 'tidak ada');

const st = trackerMod.setStatus(rows, 'PT Contoh Digital', 'Backend Engineer', 'applied');
const target = st.filter((r) => r.company === 'PT Contoh Digital')[0];
check('T9 setStatus jadi applied', !!target && target.status === 'applied', target ? target.status : 'tidak ada');
check('T10 setStatus isi updated_at', !!target && /^\d{4}-\d{2}-\d{2}$/.test(target.updated_at || ''), target ? target.updated_at : '-');
const st2 = trackerMod.setStatus(rows, 'PT Contoh Digital', 'Backend Engineer', 'interviewing');
check('T11 setStatus alias interviewing -> interview', st2.filter((r) => r.company === 'PT Contoh Digital')[0].status === 'interview');

const sum = trackerMod.dailySummary(rows, '2026-11-28');
check('T12 dailySummary total lowongan baru', sum.total === 3, 'total ' + sum.total);
check('T13 dailySummary applied/interview/skipped', sum.applied === 1 && sum.interview === 0 && sum.skipped === 1, 'applied ' + sum.applied + ' interview ' + sum.interview + ' skipped ' + sum.skipped);
check('T14 dailySummary top urut match score', sum.top.length === 3 && sum.top[0].company === 'PT Contoh Teknologi' && sum.top[0].match_score === '5', sum.top.map((t) => t.company + ':' + t.match_score).join(', '));
check('T15 dailySummary text Bahasa Indonesia', /Harian 2026-11-28/.test(sum.text) && /lowongan baru/.test(sum.text) && /dilamar/.test(sum.text), sum.text);

console.log('');
console.log('=== RINGKASAN: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);

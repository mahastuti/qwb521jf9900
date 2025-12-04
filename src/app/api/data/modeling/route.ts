import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type SortOrder = 'asc' | 'desc';

const waktuFromHour = (hour: number): string => {
  if (hour >= 0 && hour <= 3) return 'Dini Hari';
  if (hour > 3 && hour <= 8) return 'Pagi';
  if (hour > 8 && hour <= 13) return 'Siang';
  if (hour > 13 && hour <= 18) return 'Sore';
  return 'Malam';
};

const normalizeCuaca = (s: string): string => {
  const x = (s || '').toLowerCase();
  if (!x) return '';
  if (x.includes('badai') || x.includes('petir') || x.includes('thunder')) return 'Badai Petir';
  if (x.includes('kabut')) return 'Berkabut';
  if (x.includes('gerimis')) return 'Hujan';
  if (x.includes('hujan') || x.includes('rain')) return 'Hujan';
  if (x.includes('cerah') && x.includes('awan')) return 'Cerah Berawan';
  if (x.includes('cerah') || x.includes('clear')) return 'Cerah';
  if (x.includes('awan') || x.includes('cloud')) return 'Berawan';
  return s;
};

// In-memory cache to avoid repeated Open-Meteo requests per 10 minutes
let HOURLY_CACHE: { map: Map<string, { weather_code: number }>; expires: number } | null = null;
async function getHourlyWeatherMap(): Promise<Map<string, { weather_code: number }>> {
  try {
    if (HOURLY_CACHE && HOURLY_CACHE.expires > Date.now()) return HOURLY_CACHE.map;
    const { fetchWeatherApi } = await import('openmeteo');
    const params: Record<string, string | number> = { latitude: -7.38, longitude: 112.7851, start_date: '2024-12-29', end_date: '2025-09-01', hourly: 'weather_code' };
    const responses = await fetchWeatherApi('https://historical-forecast-api.open-meteo.com/v1/forecast', params as unknown as Record<string, unknown>);
    const toHourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / 3600000) * 3600000);
    const map = new Map<string, { weather_code: number }>();
    if (responses && responses.length) {
      const response = responses[0];
      const utcOffsetSeconds = response.utcOffsetSeconds();
      const hourlyBlock = response.hourly();
      if (hourlyBlock) {
        const timeStart = Number(hourlyBlock.time());
        const timeEnd = Number(hourlyBlock.timeEnd());
        const interval = hourlyBlock.interval();
        if (Number.isFinite(timeStart) && Number.isFinite(timeEnd) && Number.isFinite(interval) && interval > 0) {
          const steps = Math.max(0, Math.floor((timeEnd - timeStart) / interval));
          const times = Array.from({ length: steps }, (_, i) => new Date((timeStart + i * interval + utcOffsetSeconds) * 1000));
          const var0 = (hourlyBlock as unknown as { variables?: (i: number) => { valuesArray?: () => ArrayLike<number> } }).variables?.(0);
          const codes = var0 && typeof var0.valuesArray === 'function' ? var0.valuesArray() : [];
          for (let i = 0; i < times.length; i++) {
            const dt = times[i];
            const dtHour = toHourFloor(new Date(dt));
            const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
            const code = Number((codes as ArrayLike<number>)[i] ?? NaN);
            if (Number.isFinite(code)) map.set(key, { weather_code: code });
          }
        }
      }
    }
    HOURLY_CACHE = { map, expires: Date.now() + 10 * 60 * 1000 };
    return map;
  } catch {
    const map = new Map<string, { weather_code: number }>();
    HOURLY_CACHE = { map, expires: Date.now() + 10 * 60 * 1000 };
    return map;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const search = searchParams.get('search') || '';
    const rebuildIfEmpty = searchParams.get('rebuildIfEmpty') === '1';

    const sortOrderParam: SortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
    const sortByParamRaw = (searchParams.get('sortBy') || 'id').toString();
    const allowedSort = new Set(['id','tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike']);
    const sortByParam = allowedSort.has(sortByParamRaw) ? sortByParamRaw : 'id';
    const pageParam = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const source = (searchParams.get('source') || 'all').toLowerCase();

    const orderBy: Prisma.modelOrderByWithRelationInput[] = [
      { strike: 'desc' },
      { [sortByParam]: sortOrderParam } as Prisma.modelOrderByWithRelationInput,
      { id: sortOrderParam }
    ];

    const orFilters: Record<string, unknown>[] = [];
    if (search) {
      const s = search.trim();
      const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
      for (const k of ['waktu','cuaca','fase','strike']) { orFilters.push(like(k)); }
      if (/^\d+$/.test(s)) {
        try { orFilters.push({ id: BigInt(s) }); } catch {}
        const asInt = Number.parseInt(s, 10);
        if (!Number.isNaN(asInt)) { orFilters.push({ titik: BigInt(asInt) }); orFilters.push({ rata_rata_burung_di_titik_x: BigInt(asInt) }); }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s); if (!Number.isNaN(d.getTime())) orFilters.push({ tanggal: d }); }
      if (/^\d{2}:\d{2}$/.test(s)) { const t = new Date(`1970-01-01T${s}:00.000Z`); if (!Number.isNaN(t.getTime())) orFilters.push({ jam: t }); }
    }

    const whereBase = search ? { OR: orFilters } : {};
    const where = ((): Record<string, unknown> => {
      if (source === 'bird-strike') return { ...whereBase, strike: '1' };
      if (source === 'traffic-flight') return { ...whereBase, strike: '0' };
      return whereBase;
    })();

    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e) { console.error('prisma:error count()', e); return 0; }
    };

    // Debug/report endpoint to analyze removed traffic-flight rows and counts
    const report = searchParams.get('report');
    if (report === 'removed') {
      if (!process.env.DATABASE_URL) {
        return NextResponse.json({ success: true, message: 'No database configured', summary: {}, removed: [] });
      }

      const tf = await prisma.trafficFlight.findMany({
        orderBy: [{ tahun: 'asc' }, { bulan: 'asc' }, { id: 'asc' }],
        select: { id: true, no: true, ata: true, atd: true, bulan: true, tahun: true }
      });

      const extract_day_and_time = (s: string | null | undefined): { day: number; hh: number; mm: number } | null => {
        if (!s) return null;
        const parts = String(s).split('/');
        if (parts.length < 2) return null;
        const day = Number(parts[0]);
        const m = parts[1].match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        const hh = Number(m[1]);
        const mm = Number(m[2]);
        if ([day, hh, mm].some(v => Number.isNaN(v))) return null;
        return { day, hh, mm };
      };

      type TFRow = { day: number | null; month: number | null; year: number | null; jam: string | null; fase: string; source_no: number | null };
      const rowsTF: TFRow[] = [];
      let unparsed = 0;
      for (const r of tf) {
        const bulan = r.bulan ? Number(r.bulan) : null;
        const tahun = r.tahun ? Number(r.tahun) : null;
        const no = r.no ?? null;
        const ata = extract_day_and_time(r.ata ?? null);
        const atd = extract_day_and_time(r.atd ?? null);
        if (!ata && !atd) { unparsed++; continue; }
        if (ata) rowsTF.push({ day: ata.day, month: bulan, year: tahun, jam: `${String(ata.hh).padStart(2,'0')}:${String(ata.mm).padStart(2,'0')}`, fase: 'Landing', source_no: no });
        if (atd) rowsTF.push({ day: atd.day, month: bulan, year: tahun, jam: `${String(atd.hh).padStart(2,'0')}:${String(atd.mm).padStart(2,'0')}`, fase: 'Take Off', source_no: no });
      }

      const apply_validasi_manual_v2_local = (rows: TFRow[]) => {
        const out: TFRow[] = rows.map((r) => ({ ...r }));
        for (const r of out) {
          if (r.month != null && (!Number.isFinite(r.month) || r.month < 1 || r.month > 12)) r.month = null;
        }
        return out;
      };

      const rowsTFValidated = apply_validasi_manual_v2_local(rowsTF);
      const max_day = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
      const build_tanggal_cap_from_row = (r: TFRow): Date | null => {
        if (r.year == null || r.month == null || r.day == null) return null;
        const y = r.year; const m = r.month; let d = r.day;
        if (!(m >= 1 && m <= 12)) return null;
        const md = max_day(y, m);
        if (d > md) d = md;
        return new Date(Date.UTC(y, m - 1, d));
      };

      const withTanggal = rowsTFValidated.map(r => ({ ...r, tanggal: build_tanggal_cap_from_row(r) }));
      const invalidRows = withTanggal.filter(r => !r.tanggal);
      const validRows = withTanggal.filter(r => !!r.tanggal);
      const expandedExpected = validRows.length * 8;
      const currentTrafficCount = await safeCount(() => prisma.model.count({ where: { strike: '0' } }));

      const limitRemoved = Math.min(Number.parseInt(searchParams.get('removedLimit') || '200', 10) || 200, 2000);
      const removedSamples = invalidRows.slice(0, limitRemoved).map(r => ({
        source_no: r.source_no,
        year: r.year,
        month: r.month,
        day: r.day,
        jam: r.jam,
        fase: r.fase,
        reason: (r.year == null ? 'invalid_year' : (r.month == null || (r.month < 1 || r.month > 12) ? 'invalid_month' : (r.day == null ? 'missing_day' : 'unknown_invalid_date')))
      }));

      return NextResponse.json({
        success: true,
        summary: {
          traffic_source_records: tf.length,
          traffic_rows_parsed: rowsTF.length,
          traffic_rows_after_validation: rowsTFValidated.length,
          traffic_rows_with_valid_date: validRows.length,
          traffic_rows_invalid_date: invalidRows.length,
          expected_model_rows_from_traffic: expandedExpected,
          current_model_rows_with_strike_0: currentTrafficCount,
          unparsed_source_rows: unparsed,
          difference_expected_minus_current: expandedExpected - currentTrafficCount
        },
        removed: removedSamples
      });
    }

    if (searchParams.get('preview') === '1') {
      // Build preview data in-memory (no DB writes), using same pipeline as POST
      if (!process.env.DATABASE_URL) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const base = path.join(process.cwd(), 'src', 'scripts', 'modeling');
          const files = ['1.csv','2.csv','3.csv','4.csv','5.csv','6.csv','7.csv','8.csv'].filter(f => fs.existsSync(path.join(base, f)));
          const waktuFromHourLocal = (h: number) => waktuFromHour(h);
          const toHourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / 3600000) * 3600000);
          const hourlyByKey = await getHourlyWeatherMap();
          const mapWeatherCode = (code: number | null | undefined): string => {
            if (code === null || code === undefined) return 'Tidak tersedia';
            const m: Record<number, string> = {0:'Cerah',1:'Cerah Berawan',2:'Berawan Sebagian',3:'Berawan',45:'Berkabut',48:'Rime Kabut',51:'Gerimis Ringan',53:'Gerimis Sedang',55:'Gerimis Lebat',56:'Gerimis Beku Ringan',57:'Gerimis Beku Lebat',61:'Hujan Ringan',63:'Hujan Sedang',65:'Hujan Lebat',66:'Hujan Beku Ringan',67:'Hujan Beku Lebat',71:'Salju Ringan',73:'Salju Sedang',75:'Salju Lebat',77:'Butiran Salju',80:'Hujan Gerimis',81:'Hujan Lebat Sesaat',82:'Hujan Sangat Lebat Sesaat',85:'Hujan Salju Ringan',86:'Hujan Salju Lebat',95:'Badai Petir',96:'Badai Petir',99:'Badai Petir'}; return m[Number(code)] ?? 'Tidak tersedia';
          };
          type ModelRow = { tanggal: Date; jam: Date | null; waktu: string | null; cuaca: string | null; rata_rata_burung_di_titik_x: number | null; titik: number | null; fase: string | null; strike: '0' | '1' };
          const tfRows: ModelRow[] = [];
          const timeRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
          for (const f of files) {
            const txt = fs.readFileSync(path.join(base, f), 'utf8');
            const lines = txt.split(/\r?\n/).filter(l => l.trim() !== '');
            if (!lines.length) continue;
            const header = lines[0].split(',');
            const h = (k: string) => header.indexOf(k);
            const extract = (s: string | null | undefined): { day: number | null; jam: string | null } => {
              if (!s) return { day: null, jam: null };
              const left = s.split('/',1)[0]?.trim();
              const right = s.includes('/') ? s.slice(s.indexOf('/')+1).trim() : '';
              const m = right.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
              return { day: left ? Number(left) : null, jam: m ? m[1] : null };
            };
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(',');
              const bulan = Number(cols[h('bulan')] ?? NaN);
              const tahun = Number(cols[h('tahun')] ?? NaN);
              const ata = extract(cols[h('ata')] ?? null);
              const atd = extract(cols[h('atd')] ?? null);
              const pushTF = (day: number | null, jam: string | null, fase: 'Landing' | 'Take Off') => {
                if (day == null || !Number.isFinite(bulan) || !Number.isFinite(tahun) || !jam || !timeRegex.test(jam)) return;
                const tanggal = new Date(Date.UTC(tahun, bulan - 1, Math.max(1, Math.min(31, Number(day)))));
                const hh = Number(String(jam).split(':')[0]);
                const jamDate = new Date(Date.UTC(1970,0,1, Number.isFinite(hh)?hh:0, Number(String(jam).split(':')[1]||'0')));
                const dtHour = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), Number.isFinite(hh) ? hh : 0, 0, 0, 0));
                const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
                const cuaca = mapWeatherCode(hourlyByKey.get(key)?.weather_code);
                tfRows.push({ tanggal, jam: jamDate, waktu: waktuFromHourLocal(hh), cuaca, rata_rata_burung_di_titik_x: null, titik: null, fase, strike: '0' });
              };
              if (ata.day != null && ata.jam) pushTF(ata.day, ata.jam, 'Landing');
              if (atd.day != null && atd.jam) pushTF(atd.day, atd.jam, 'Take Off');
            }
          }
          const expanded = tfRows.flatMap(r => Array.from({ length: 8 }, (_, i) => ({ ...r, titik: i + 1 })));
          const sortByParamRaw = (searchParams.get('sortBy') || 'id').toString();
          const allowedSort = new Set(['id','tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike']);
          const sortByParam = allowedSort.has(sortByParamRaw) ? sortByParamRaw : 'tanggal';
          const sortOrderParam: SortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
          expanded.sort((a,b) => {
            if (a.strike !== b.strike) return a.strike === '1' ? -1 : 1;
            const dir = sortOrderParam === 'asc' ? 1 : -1;
            if (sortByParam === 'tanggal') return (a.tanggal.getTime() - b.tanggal.getTime()) * dir;
            if (sortByParam === 'jam') return ((a.jam?.getTime() || 0) - (b.jam?.getTime() || 0)) * dir;
            if (sortByParam === 'titik') return ((a.titik ?? 0) - (b.titik ?? 0)) * dir;
            return String((a as any)[sortByParam] ?? '').localeCompare(String((b as any)[sortByParam] ?? '')) * dir;
          });
          const total = expanded.length; const start = (pageParam - 1) * limit; const rows = expanded.slice(start, start + limit);
          const serialize = (value: unknown): unknown => { if (value === null || value === undefined) return value; if (typeof value === 'bigint') return value.toString(); if (value instanceof Date) return value.toISOString(); if (Array.isArray(value)) return value.map(serialize); if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v); return out; } return value; };
          return NextResponse.json({ success: true, data: serialize(rows), pagination: { page: pageParam, limit, total, pages: Math.ceil(total / Math.max(1, limit)) }, pageInfo: { limit, hasMore: start + rows.length < total, nextCursor: null } });
        } catch (e) {
          console.warn('modeling preview CSV fallback failed:', e);
          return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit, total: 0, pages: 0 }, pageInfo: { limit, hasMore: false, nextCursor: null } });
        }
      }

      const waktuFromHourLocal = (h: number) => waktuFromHour(h);
      const normTitik = (s: string | null | undefined): number | null => {
        if (!s) return null; const m = String(s).match(/-?\d+(?:[\.,]\d+)?/); if (!m) return null; const f = parseFloat(m[0].replace(',', '.')); if (!Number.isFinite(f)) return null; return Math.round(f);
      };
      const toHourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / 3600000) * 3600000);
      const titleWaktu = (w: string) => { const s = w.trim().toLowerCase(); if (s.includes('dini')) return 'Dini Hari'; if (s.includes('pagi')) return 'Pagi'; if (s.includes('siang')) return 'Siang'; if (s.includes('sore')) return 'Sore'; return 'Malam'; };
      const mapWeatherCode = (code: number | null | undefined): string => {
        if (code === null || code === undefined) return 'Tidak tersedia';
        const m: Record<number, string> = {0:'Cerah',1:'Cerah Berawan',2:'Berawan Sebagian',3:'Berawan',45:'Berkabut',48:'Rime Kabut',51:'Gerimis Ringan',53:'Gerimis Sedang',55:'Gerimis Lebat',56:'Gerimis Beku Ringan',57:'Gerimis Beku Lebat',61:'Hujan Ringan',63:'Hujan Sedang',65:'Hujan Lebat',66:'Hujan Beku Ringan',67:'Hujan Beku Lebat',71:'Salju Ringan',73:'Salju Sedang',75:'Salju Lebat',77:'Butiran Salju',80:'Hujan Gerimis',81:'Hujan Lebat Sesaat',82:'Hujan Sangat Lebat Sesaat',85:'Hujan Salju Ringan',86:'Hujan Salju Lebat',95:'Badai Petir',96:'Badai Petir',99:'Badai Petir'}; return m[Number(code)] ?? 'Tidak tersedia';
      };
      const hourlyByKey = await getHourlyWeatherMap();

      // Bird strike subset (2025 confirmed, runway 10/28, Landing/Take Off)
      const tahunTargetMulai = new Date('2025-01-01T00:00:00.000Z');
      const tahunTargetAkhir = new Date('2025-12-31T23:59:59.999Z');
      const birdRaw = await prisma.birdStrike.findMany({ where: { tanggal: { gte: tahunTargetMulai, lte: tahunTargetAkhir }, remark: { equals: 'Terkonfirmasi' }, fase: { in: ['Landing','Take Off'] }, runway_use: { in: ['10','28','10.0','28.0','010','028'] } }, orderBy: { tanggal: 'asc' } });
      type ModelRow = { tanggal: Date; jam: Date | null; waktu: string | null; cuaca: string | null; rata_rata_burung_di_titik_x: number | null; titik: number | null; fase: string | null; strike: '0' | '1' };
      let birdPrepared: ModelRow[] = birdRaw.map((r) => {
        const tInt = normTitik(r.titik ?? null);
        const hour = r.jam ? new Date(r.jam).getUTCHours() : null;
        const waktu = hour == null ? 'Malam' : waktuFromHourLocal(hour);
        const jam = r.jam ?? null;
        const dtHour = toHourFloor(new Date(new Date(r.tanggal ?? new Date()).getTime()));
        const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
        const h = hourlyByKey.get(key);
        const cuaca = mapWeatherCode(h?.weather_code);
        return { tanggal: r.tanggal!, jam, waktu, cuaca: cuaca ?? 'Tidak tersedia', rata_rata_burung_di_titik_x: null, titik: tInt != null ? tInt : null, fase: r.fase ?? null, strike: '1' };
      });

      // Add Traffic Flight rows (2 rows per record) for preview
      const tfRaw = await prisma.trafficFlight.findMany({ orderBy: [{ tahun: 'asc' }, { bulan: 'asc' }, { id: 'asc' }] });
      const extract_day_and_time = (s: string | null | undefined): { day_str: string | null; jam: string | null } => {
        if (typeof s !== 'string' || !s.includes('/')) return { day_str: null, jam: null };
        const [left] = s.split('/', 1);
        const leftTrim = left.trim();
        const right = s.slice(s.indexOf('/') + 1).trim();
        let jam: string | null = null; const m = right.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (m) jam = m[1]; else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(right)) jam = right;
        return { day_str: leftTrim || null, jam };
      };
      const timeRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
      type TFRow = { source_no: number | null; day: number | null; month: number | null; year: number | null; jam: string | null; waktu: string | null; fase: string; strike: '0' };
      const rowsTF: TFRow[] = [];
      for (const r of tfRaw) {
        const bulan = r.bulan ? Number(r.bulan) : null; const tahun = r.tahun ? Number(r.tahun) : null; const srcNo = r.no ?? null;
        const ata = extract_day_and_time(r.ata ?? null); if (ata.day_str && ata.jam) rowsTF.push({ source_no: srcNo, day: Number(String(ata.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: ata.jam, waktu: null, fase: 'Landing', strike: '0' });
        const atd = extract_day_and_time(r.atd ?? null); if (atd.day_str && atd.jam) rowsTF.push({ source_no: srcNo, day: Number(String(atd.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: atd.jam, waktu: null, fase: 'Take Off', strike: '0' });
      }
      for (const r of rowsTF) { if (r.jam) { const hh = Number(String(r.jam).split(':')[0]); r.waktu = Number.isFinite(hh) ? waktuFromHourLocal(hh) : null; } }
      const rowsTFClean = rowsTF.filter(r => r.day != null && r.month != null && r.year != null && !!r.jam && timeRegex.test(String(r.jam)) && !Object.values(r).some(v => String(v ?? '').includes('--:--'))).map(r => ({ ...r, jam: String(r.jam).trim() }));

      // apply_validasi_manual_v2 per source_no and per-month rules
      const apply_validasi_manual_v2 = (rows: TFRow[]) => {
        const out = rows.map(r => ({ ...r }));
        const toDrop = new Set<number>();
        const groups = new Map<string, number[]>();
        for (let i = 0; i < out.length; i++) { const key = String(out[i].source_no ?? 'null'); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(i); }
        const max_day = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
        const safe = (x: unknown): number | null => { const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; };
        for (const idxs of groups.values()) {
          for (let k = 0; k < idxs.length - 1; k++) {
            const i = idxs[k]; const j = idxs[k + 1];
            const cur = out[i]; const nxt = out[j];
            const curF = String(cur.fase || '').trim().toLowerCase(); const nxtF = String(nxt.fase || '').trim().toLowerCase();
            if (curF !== 'landing' || nxtF !== 'take off') continue;
            const y = safe(cur.year); const m = safe(cur.month); const d = safe(cur.day);
            const ny = safe(nxt.year); const nm = safe(nxt.month); const nd = safe(nxt.day);
            if ([y,m,d,ny,nm,nd].some(v => v == null)) continue;
            if (nd !== 1) continue;
            const nextMonth = (m! < 12) ? (m! + 1) : 1; const nextYear = (m! < 12) ? y! : (y! + 1);
            if (!((nm === m && ny === y) || (nm === nextMonth && ny === nextYear))) continue;
            if (m === 1 && [29,30,31].includes(d!)) { toDrop.add(i); continue; }
            if (m === 2 && [29,30,31].includes(d!)) { out[i].month = 1; continue; }
            if (m === 3) { if ((y! % 2 === 1 && d === 28) || (y! % 2 === 0 && (d === 28 || d === 29))) { out[i].month = 2; } continue; }
            if (m === 4) { const mdPrev = max_day(y!, 3); if (d! >= mdPrev) out[i].month = 3; continue; }
            if (m === 5) { const mdPrev = max_day(y!, 4); if (d! >= mdPrev) out[i].month = 4; continue; }
            if (m! >= 6 && m! <= 12) { const mdPrev = max_day(y!, m! - 1); if (d! >= mdPrev) out[i].month = (m! - 1); continue; }
          }
        }
        return out.filter((_, i) => !toDrop.has(i));
      };

      const tfValidated = apply_validasi_manual_v2(rowsTFClean);

      // 2) Hitung jumlah hari maksimum per baris (md_arr)
      const md_arr: (number | null)[] = tfValidated.map((r) => {
        const yy = r.year; const mm = r.month;
        if (yy == null || mm == null || !Number.isFinite(yy) || !Number.isFinite(mm)) return null;
        try {
          if (!(mm >= 1 && mm <= 12)) return null;
          const maxDay = new Date(Date.UTC(Number(yy), Number(mm), 0)).getUTCDate();
          return Number.isFinite(maxDay) ? maxDay : null;
        } catch {
          return null;
        }
      });

      // 3) Cap nilai day agar ≤ max_day
      const day_capped: (number | null)[] = tfValidated.map((r, i) => {
        const md = md_arr[i];
        const d = r.day;
        if (md == null || d == null || !Number.isFinite(d)) return null;
        return Math.min(Number(d), md);
      });

      // 1) Bentuk kolom string tanggal (tanggal_str) dari (year, month, day_capped)
      const tanggal_str_arr: string[] = tfValidated.map((r, i) => {
        const y = r.year; const m = r.month; const dcap = day_capped[i];
        if (y == null || m == null || dcap == null || !(m >= 1 && m <= 12)) return '';
        const yyyy = String(y).padStart(4, '0');
        const mm = String(m).padStart(2, '0');
        const dd = String(dcap).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      });

      // 2) Parse tanggal_str ke datetime (NaN -> null)
      const tanggal_parsed_arr: (Date | null)[] = tanggal_str_arr.map((s) => {
        if (!s) return null;
        const d = new Date(`${s}T00:00:00.000Z`);
        return Number.isNaN(d.getTime()) ? null : d;
      });

      // 5) Deteksi kasus input non-null tapi gagal parse jadi tanggal
      const problem_mask = tfValidated.map((r, i) => {
        const nonNullInputs = (r.year != null) && (r.month != null) && (r.day != null);
        return nonNullInputs && !tanggal_parsed_arr[i] && Boolean(tanggal_str_arr[i]);
      });

      const problem_rows = tfValidated
        .map((r, i) => ({ idx: i, year: r.year, month: r.month, day: r.day, tanggal_str: tanggal_str_arr[i] || null, jam: r.jam, fase: r.fase }))
        .filter((_, i) => problem_mask[i])
        .slice(0, 20);

      const tfPreparedBase = tfValidated.map((r, i) => {
        const tanggal = tanggal_parsed_arr[i];
        if (!tanggal) return null;
        const hh = Number(String(r.jam).split(':')[0]);
        const jamDate = new Date(Date.UTC(1970,0,1, Number.isFinite(hh)?hh:0, Number(String(r.jam).split(':')[1]||'0')));
        // Build hour key using tanggal + hh to match hourly weather
        const dtHour = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), Number.isFinite(hh) ? hh : 0, 0, 0, 0));
        const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
        const h = hourlyByKey.get(key);
        const cuaca = mapWeatherCode(h?.weather_code) ?? 'Tidak tersedia';
        const row: ModelRow | null = tanggal ? { tanggal, jam: jamDate, waktu: r.waktu ?? (Number.isFinite(hh)? waktuFromHourLocal(hh):'Malam'), cuaca, rata_rata_burung_di_titik_x: null, titik: null, fase: r.fase, strike: '0' } : null;
        return row;
      }).filter((x): x is ModelRow => x !== null);
      // Expand each TF row into 8 titik (1..8)
      let tfPrepared: ModelRow[] = tfPreparedBase.flatMap((row) => Array.from({ length: 8 }, (_, i2) => ({ ...row, titik: i2 + 1 })));

      // If DB returned nothing for both, fallback to local CSVs
      if (birdPrepared.length === 0 && tfPrepared.length === 0) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const base = path.join(process.cwd(), 'src', 'scripts');
          // Build birdPrepared from d1.csv minimally
          try {
            const text = fs.readFileSync(path.join(base, 'd1.csv'), 'utf8');
            const parseCsv = (input: string): string[][] => {
              const rows: string[][] = []; let cur: string[] = []; let field = ''; let i = 0; let inQ = false; let q: '"' | "'" | null = null; while (i < input.length) { const ch = input[i]; if (inQ) { if (ch === q) { if (input[i+1]===q) { field+=q; i+=2; continue; } inQ=false; q=null; i++; continue; } field+=ch; i++; continue; } else { if (ch==='"' || ch==="'") { inQ=true; q=ch as '"'|"'"; i++; continue; } if (ch===',') { cur.push(field); field=''; i++; continue; } if (ch==='\n') { cur.push(field); rows.push(cur); cur=[]; field=''; i++; continue; } if (ch==='\r') { i++; continue; } field+=ch; i++; }} cur.push(field); rows.push(cur); return rows.filter(r=>r.some(c=>c!=='')); };
            const table = parseCsv(text);
            if (table.length >= 2) {
              const header = table[0]; const ix = (k: string) => header.indexOf(k);
              const subset = [] as ModelRow[];
              for (let i = 1; i < table.length && subset.length < limit; i++) {
                const c = table[i];
                const tanggal = c[ix('tanggal')] ? new Date(String(c[ix('tanggal')])) : new Date('2025-01-01T00:00:00.000Z');
                const jamStr = c[ix('jam')] || null; const jam = jamStr ? new Date(`1970-01-01T${String(jamStr).slice(11,16)}:00.000Z`) : null;
                const hh = jam ? jam.getUTCHours() : 0; const waktu = waktuFromHourLocal(hh);
                const dtHour = toHourFloor(new Date(tanggal)); const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth()+1).padStart(2,'0')}-${String(dtHour.getUTCDate()).padStart(2,'0')} ${String(dtHour.getUTCHours()).padStart(2,'0')}:${String(dtHour.getUTCMinutes()).padStart(2,'0')}`;
                const cuaca = mapWeatherCode(hourlyByKey.get(key)?.weather_code);
                subset.push({ tanggal, jam, waktu, cuaca, rata_rata_burung_di_titik_x: null, titik: null, fase: c[ix('fase')] || null, strike: '1' });
              }
              birdPrepared = subset;
            }
          } catch {}
          // Build tfPrepared from modeling/* CSVs
          try {
            const baseTF = path.join(base, 'modeling');
            const files = ['1.csv','2.csv','3.csv','4.csv','5.csv','6.csv','7.csv','8.csv'].filter(f => fs.existsSync(path.join(baseTF, f)));
            const rowsTF: { tanggal: Date; jam: Date; waktu: string; fase: string }[] = [];
            const parseCsv = (input: string): string[][] => { const rows: string[][] = []; let cur: string[] = []; let field = ''; let i = 0; let inQ = false; let q: '"' | "'" | null = null; while (i < input.length) { const ch = input[i]; if (inQ) { if (ch === q) { if (input[i+1]===q) { field+=q; i+=2; continue; } inQ=false; q=null; i++; continue; } field+=ch; i++; continue; } else { if (ch==='"' || ch==="'") { inQ=true; q=ch as '"'|"'"; i++; continue; } if (ch===',') { cur.push(field); field=''; i++; continue; } if (ch==='\n') { cur.push(field); rows.push(cur); cur=[]; field=''; i++; continue; } if (ch==='\r') { i++; continue; } field+=ch; i++; }} cur.push(field); rows.push(cur); return rows.filter(r=>r.some(c=>c!=='')); };
            for (const f of files) {
              const txt = fs.readFileSync(path.join(baseTF, f), 'utf8');
              const table = parseCsv(txt);
              if (table.length < 2) continue;
              const h = (k: string) => table[0].indexOf(k);
              for (let i = 1; i < table.length; i++) {
                const c = table[i];
                const bulan = Number(c[h('bulan')] ?? NaN); const tahun = Number(c[h('tahun')] ?? NaN);
                const get = (s: string | null): { day: number | null; jam: string | null } => { if (!s) return { day: null, jam: null }; const left = s.split('/',1)[0]; const right = s.includes('/') ? s.slice(s.indexOf('/')+1) : ''; const m = right.match(/(\d{1,2}:\d{2}(?::\d{2})?)/); return { day: left ? Number(left) : null, jam: m ? m[1] : null }; };
                const ata = get(c[h('ata')] ?? null); const atd = get(c[h('atd')] ?? null);
                const pushRow = (d: number | null, jamStr: string | null, fase: string) => { if (d==null || !Number.isFinite(bulan) || !Number.isFinite(tahun) || !jamStr) return; const tanggal = new Date(Date.UTC(tahun, bulan-1, Math.max(1, Math.min(31, d)))); const hh = Number(String(jamStr).split(':')[0]); const jam = new Date(Date.UTC(1970,0,1, Number.isFinite(hh)?hh:0, Number(String(jamStr).split(':')[1]||'0'))); const waktu = waktuFromHourLocal(Number.isFinite(hh)?hh:0); rowsTF.push({ tanggal, jam, waktu, fase }); };
                if (ata.day != null && ata.jam) pushRow(ata.day, ata.jam, 'Landing');
                if (atd.day != null && atd.jam) pushRow(atd.day, atd.jam, 'Take Off');
              }
            }
            const baseRows: ModelRow[] = rowsTF.map(r => {
              const dtHour = new Date(Date.UTC(r.tanggal.getUTCFullYear(), r.tanggal.getUTCMonth(), r.tanggal.getUTCDate(), r.jam.getUTCHours(), 0, 0, 0));
              const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth()+1).padStart(2,'0')}-${String(dtHour.getUTCDate()).padStart(2,'0')} ${String(dtHour.getUTCHours()).padStart(2,'0')}:${String(dtHour.getUTCMinutes()).padStart(2,'0')}`;
              const cuaca = mapWeatherCode(hourlyByKey.get(key)?.weather_code);
              return { tanggal: r.tanggal, jam: r.jam, waktu: r.waktu, cuaca, rata_rata_burung_di_titik_x: null, titik: null, fase: r.fase, strike: '0' };
            });
            tfPrepared = baseRows.flatMap(row => Array.from({ length: 8 }, (_, i) => ({ ...row, titik: i + 1 })));
          } catch {}
        } catch {}
      }

      // Optional debugging output when requested
      const debugDate = searchParams.get('debugDate') === '1';
      const debugInfo = debugDate ? { md_arr, day_capped, problems_count: problem_rows.length, problem_rows } : undefined;

      // Merge and filter by source
      let merged: ModelRow[] = [...birdPrepared, ...tfPrepared];
      if (source === 'bird-strike') merged = merged.filter(r => r.strike === '1');
      if (source === 'traffic-flight') merged = merged.filter(r => r.strike === '0');


      // Search filter: support text, time (HH:MM), and dates like 2025-01-01 or 1/1/2025
      if (search) {
        const raw = search.trim();
        const s = raw.toLowerCase();
        const dateCandidates: string[] = (() => {
          const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
          if (!m) return [];
          const a = Number(m[1]);
          const b = Number(m[2]);
          let y = Number(m[3]);
          if (y < 100) y = 2000 + y;
          const A = String(a).padStart(2, '0');
          const B = String(b).padStart(2, '0');
          const YYYY = String(y).padStart(4, '0');
          // Both dd/mm/yyyy and mm/dd/yyyy possibilities
          return [
            `${YYYY}-${A}-${B}`,
            `${YYYY}-${B}-${A}`
          ];
        })();
        merged = merged.filter(r => {
          const tanggalIso = r.tanggal.toISOString();
          const jamIso = r.jam ? r.jam.toISOString() : '';
          const jamHM = jamIso ? jamIso.slice(11, 16) : '';
          const vals = [
            r.waktu,
            r.cuaca,
            r.fase,
            r.strike,
            tanggalIso,
            jamIso,
            jamHM,
            r.titik != null ? String(r.titik) : '',
            r.rata_rata_burung_di_titik_x != null ? String(r.rata_rata_burung_di_titik_x) : ''
          ].map(v => (v == null ? '' : String(v).toLowerCase()));

          if (vals.some(v => v.includes(s))) return true;
          if (dateCandidates.length && (tanggalIso || jamIso)) {
            const lowTanggal = String(tanggalIso || '').toLowerCase();
            const lowJam = String(jamIso || '').toLowerCase();
            if (dateCandidates.some(tok => lowTanggal.includes(tok) || lowJam.includes(tok))) return true;
          }
          return false;
        });
      }
      // Sort
      merged.sort((a, b) => {
        if (a.strike !== b.strike) return a.strike === '1' ? -1 : 1; // strike desc
        const key = sortByParam as keyof ModelRow; const dir = sortOrderParam === 'asc' ? 1 : -1;
        const va = a[key] as Date | number | string | null | undefined; const vb = b[key] as Date | number | string | null | undefined;
        if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
        if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });

      const serialize = (value: unknown): unknown => {
        if (value === null || value === undefined) return value;
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(serialize);
        if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v); return out; }
        return value;
      };
      const total = merged.length; const start = (pageParam - 1) * limit; const rows = merged.slice(start, start + limit);
      return NextResponse.json({ success: true, data: serialize(rows), pagination: { page: pageParam, limit, total, pages: Math.ceil(total / Math.max(1, limit)) }, pageInfo: { limit, hasMore: start + rows.length < total, nextCursor: null }, ...(debugDate ? { debugDate: debugInfo } : {}) });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit, total: 0, pages: 0 }, pageInfo: { limit, hasMore: false, nextCursor: null } });
    }

    let total = await safeCount(() => prisma.model.count({ where }));
    if (total === 0 && rebuildIfEmpty) {
      try { await POST(); } catch (e) { console.error('autobuild error', e); }
      total = await safeCount(() => prisma.model.count({ where }));
    }

    const safeFind = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (e) { console.error('prisma:error find()', e); return fallback; }
    };

    const skip = (pageParam - 1) * limit;
    const rows = await safeFind(() => prisma.model.findMany({
      where,
      orderBy,
      skip,
      take: limit
    }), [] as Awaited<ReturnType<typeof prisma.model.findMany>>);

    const hasMore = skip + rows.length < (await safeCount(() => prisma.model.count({ where })));
    const nextCursor = null;

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v); return out; }
      return value;
    };

    return NextResponse.json({ success: true, data: serialize(rows), pagination: { page: 1, limit, total, pages: Math.ceil(total / Math.max(1, limit)) }, pageInfo: { limit, hasMore, nextCursor } });
  } catch (error) {
    console.error('Error fetching modeling data:', error);
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 }, pageInfo: { limit: 10, hasMore: false, nextCursor: null } });
    }
    return NextResponse.json({ success: false, message: 'Failed to fetch modeling data' }, { status: 500 });
  }
}

export async function POST() {
  let lockAcquired = false;
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: false, message: 'DATABASE_URL is not set' }, { status: 500 });
    }

    try {
      const res = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(214748364, 987654321) AS locked`;
      lockAcquired = Array.isArray(res) && Boolean(res[0]?.locked);
      if (!lockAcquired) {
        return NextResponse.json({ success: false, message: 'Regeneration is already running' }, { status: 409 });
      }
    } catch (e) {
      console.error('Failed to acquire advisory lock:', e);
    }

    await prisma.model.deleteMany({});

    const FALLBACK_LAT = -7.38;
    const FALLBACK_LON = 112.7851;

    const waktuFromHourLocal = (h: number) => waktuFromHour(h);

    const mapWeatherCode = (code: number | null | undefined): string => {
      if (code === null || code === undefined) return 'Tidak tersedia';
      const m: Record<number, string> = {
        0: 'Cerah', 1: 'Cerah Berawan', 2: 'Berawan Sebagian', 3: 'Berawan',
        45: 'Berkabut', 48: 'Rime Kabut',
        51: 'Gerimis Ringan', 53: 'Gerimis Sedang', 55: 'Gerimis Lebat',
        56: 'Gerimis Beku Ringan', 57: 'Gerimis Beku Lebat',
        61: 'Hujan Ringan', 63: 'Hujan Sedang', 65: 'Hujan Lebat',
        66: 'Hujan Beku Ringan', 67: 'Hujan Beku Lebat',
        71: 'Salju Ringan', 73: 'Salju Sedang', 75: 'Salju Lebat',
        77: 'Butiran Salju',
        80: 'Hujan Gerimis', 81: 'Hujan Lebat Sesaat', 82: 'Hujan Sangat Lebat Sesaat',
        85: 'Hujan Salju Ringan', 86: 'Hujan Salju Lebat',
        95: 'Badai Petir', 96: 'Badai Petir', 99: 'Badai Petir'
      };
      return m[Number(code)] ?? 'Tidak tersedia';
    };

    const normTitik = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const m = String(s).match(/-?\d+(?:[\.,]\d+)?/);
      if (!m) return null;
      const f = parseFloat(m[0].replace(',', '.'));
      if (!Number.isFinite(f)) return null;
      return Math.round(f);
    };

    const toHourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / 3600000) * 3600000);

    const seeded = (() => { let s = 42 >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0, s / 0x100000000); })();
    const titleWaktu = (w: string) => {
      const s = w.trim().toLowerCase();
      if (s.includes('dini')) return 'Dini Hari';
      if (s.includes('pagi')) return 'Pagi';
      if (s.includes('siang')) return 'Siang';
      if (s.includes('sore')) return 'Sore';
      return 'Malam';
    };
    const normalizeCuaca = (s: string): string => {
      const x = (s || '').toLowerCase();
      if (!x) return '';
      if (x.includes('badai') || x.includes('petir') || x.includes('thunder')) return 'Badai Petir';
      if (x.includes('kabut')) return 'Berkabut';
      if (x.includes('gerimis')) return 'Hujan';
      if (x.includes('hujan') || x.includes('rain')) return 'Hujan';
      if (x.includes('cerah') && x.includes('awan')) return 'Cerah Berawan';
      if (x.includes('cerah') || x.includes('clear')) return 'Cerah';
      if (x.includes('awan') || x.includes('cloud')) return 'Berawan';
      return s;
    };

    const buildHourlyWeather = async () => {
      try {
        const { fetchWeatherApi } = await import('openmeteo');
        const params: Record<string, string | number> = {
          latitude: -7.38,
          longitude: 112.7851,
          start_date: '2024-12-29',
          end_date: '2025-09-01',
          hourly: 'weather_code'
        };
        const url = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
        const responses = await fetchWeatherApi(url, params as unknown as Record<string, unknown>);
        if (!responses || !responses.length) return [];
        const response = responses[0];
        const utcOffsetSeconds = response.utcOffsetSeconds();
        const hourlyBlock = response.hourly();
        if (!hourlyBlock) return [];
        const timeStart = Number(hourlyBlock.time());
        const timeEnd = Number(hourlyBlock.timeEnd());
        const interval = hourlyBlock.interval();
        if (!Number.isFinite(timeStart) || !Number.isFinite(timeEnd) || !Number.isFinite(interval) || interval <= 0) return [];
        const steps = Math.max(0, Math.floor((timeEnd - timeStart) / interval));
        const times = Array.from({ length: steps }, (_, i) => new Date((timeStart + i * interval + utcOffsetSeconds) * 1000));
        const var0 = (hourlyBlock as unknown as { variables?: (i: number) => { valuesArray?: () => ArrayLike<number> } }).variables?.(0);
        const codes = var0 && typeof var0.valuesArray === 'function' ? var0.valuesArray() : [];
        const items: { date: Date; dt_hour: Date; key_hour: string; weather_code: number }[] = [];
        for (let i = 0; i < times.length; i++) {
          const dt = times[i];
          const dtHour = toHourFloor(new Date(dt));
          const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
          const code = Number((codes as ArrayLike<number>)[i] ?? NaN);
          if (Number.isFinite(code)) items.push({ date: dt, dt_hour: dtHour, key_hour: key, weather_code: code });
        }
        return items;
      } catch {
        return [];
      }
    };

    // Prepare bird species stats for fill_fix_with_b
    const species = await prisma.burung_bio.findMany({
      where: { tanggal: { not: null }, jumlah_burung: { not: null } },
      select: { tanggal: true, jumlah_burung: true, waktu: true, titik: true, cuaca: true }
    });

    type DailyMean = { _tanggal_dt: Date; mean_harian: number };
    const byGroupDaily = new Map<string, DailyMean[]>();
    const minDateByGroup = new Map<string, Date>();
    for (const r of species) {
      const tInt = normTitik(String(r.titik));
      const dt = r.tanggal as Date | null;
      const w = titleWaktu(String(r.waktu ?? ''));
      const jb = Number(r.jumlah_burung ?? NaN);
      if (tInt == null || !dt || !Number.isFinite(jb)) continue;
      const dKey = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
      const gKey = `${tInt}|${w}`;
      if (!byGroupDaily.has(gKey)) byGroupDaily.set(gKey, []);
      const arr = byGroupDaily.get(gKey)!;
      const ex = arr.find(x => x._tanggal_dt.getTime() === dKey.getTime());
      if (ex) {
        ex.mean_harian = (ex.mean_harian + jb) / 2;
      } else {
        arr.push({ _tanggal_dt: dKey, mean_harian: jb });
      }
      if (!minDateByGroup.has(gKey) || dKey < minDateByGroup.get(gKey)!) minDateByGroup.set(gKey, dKey);
    }
    for (const [, arr] of byGroupDaily.entries()) arr.sort((a, b) => a._tanggal_dt.getTime() - b._tanggal_dt.getTime());

    const randomDailyMeanByGroup = new Map<string, number>();
    for (const [gKey, arr] of byGroupDaily.entries()) {
      if (arr.length) {
        const idx = Math.floor(seeded() * arr.length);
        randomDailyMeanByGroup.set(gKey, arr[idx].mean_harian);
      }
    }

    // build meanByWaktu and global mean for relaxed fallback
    const meanByWaktu = new Map<string, number>();
    const valsByWaktu = new Map<string, number[]>();
    for (const r of species) {
      try {
        const w = titleWaktu(String(r.waktu ?? ''));
        const jb = Number(r.jumlah_burung ?? NaN);
        if (!Number.isFinite(jb)) continue;
        if (!valsByWaktu.has(w)) valsByWaktu.set(w, []);
        valsByWaktu.get(w)!.push(jb);
      } catch {}
    }
    let globalSum = 0; let globalCount = 0;
    for (const [w, arr] of valsByWaktu.entries()) {
      const sum = arr.reduce((s, x) => s + x, 0);
      meanByWaktu.set(w, sum / arr.length);
      globalSum += sum; globalCount += arr.length;
    }
    const globalMean = globalCount ? (globalSum / globalCount) : null;

    const hourly = await buildHourlyWeather();

    // A. Bird Strike preprocessing as per flow
    const tahunTargetMulai = new Date('2025-01-01T00:00:00.000Z');
    const tahunTargetAkhir = new Date('2025-12-31T23:59:59.999Z');

    const birdRaw = await prisma.birdStrike.findMany({
      where: {
        tanggal: { gte: tahunTargetMulai, lte: tahunTargetAkhir },
        remark: { equals: 'Terkonfirmasi' },
        fase: { in: ['Landing', 'Take Off'] },
        runway_use: { in: ['10', '28', '10.0', '28.0', '010', '028'] }
      },
      orderBy: { tanggal: 'asc' }
    });

    type RowA = { tanggal: Date; jam: Date | null; waktu: string; cuaca: string | null; jumlah: bigint | null; titik: number | null; fase: string | null; strike: '1' };
    const a: RowA[] = [];
    for (const r of birdRaw) {
      if (!r.tanggal) continue;
      const tInt = normTitik(r.titik ?? null);
      const hour = r.jam ? new Date(r.jam).getUTCHours() : null;
      const waktu = hour == null ? 'Malam' : waktuFromHourLocal(hour);
      a.push({
        tanggal: r.tanggal,
        jam: r.jam ?? null,
        waktu,
        cuaca: null,
        jumlah: null,
        titik: tInt,
        fase: r.fase ?? null,
        strike: '1'
      });
    }

    const jam_to_hm = (x: Date | null): string | null => {
      if (!x) return null;
      const hh = String(x.getUTCHours()).padStart(2, '0');
      const mm = String(x.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const build_dt = (tanggal: Date, jam: Date | null): Date => {
      const hm = jam_to_hm(jam) ?? '00:00';
      const y = tanggal.getUTCFullYear();
      const m = tanggal.getUTCMonth();
      const d = tanggal.getUTCDate();
      const [hh, mm] = hm.split(':').map(Number);
      return new Date(Date.UTC(y, m, d, hh, mm));
    };

    type KRow = RowA & { jam_asli: Date | null; dt_hour: Date; key_hour: string; weather_code?: number };
    const k: KRow[] = [];
    for (const r of a) {
      const dt = build_dt(r.tanggal, r.jam);
      const dtHour = toHourFloor(dt);
      const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
      k.push({ ...r, jam_asli: r.jam, dt_hour: dtHour, key_hour: key });
    }

    // Left-join hourly on dt_hour
    const hourlyByKey = new Map(hourly.map(h => [h.key_hour, h] as const));
    for (const r of k) {
      const h = hourlyByKey.get(r.key_hour);
      r.weather_code = h?.weather_code;
      r.cuaca = mapWeatherCode(h?.weather_code);
    }

    // E. Keep rata-rata burung di titik x as null (no auto-fill)
    const birdPrepared: InsertRow[] = k.map((r) => ({
      tanggal: r.tanggal,
      jam: r.jam_asli,
      waktu: r.waktu,
      cuaca: r.cuaca ?? 'Tidak tersedia',
      rata_rata_burung_di_titik_x: null,
      titik: r.titik != null ? BigInt(r.titik) : null,
      fase: r.fase,
      strike: '1' as const
    }));

    // C. Traffic Flight preprocessing (2 rows per record: ATA as Landing, ATD as Take Off)
    const tfRaw = await prisma.trafficFlight.findMany({ orderBy: [{ tahun: 'asc' }, { bulan: 'asc' }, { id: 'asc' }] });

    const extract_day_and_time = (s: string | null | undefined): { day_str: string | null; jam: string | null } => {
      if (typeof s !== 'string' || !s.includes('/')) return { day_str: null, jam: null };
      const [left] = s.split('/', 1);
      const leftTrim = left.trim();
      const right = s.slice(s.indexOf('/') + 1).trim();
      let jam: string | null = null;
      const m = right.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (m) jam = m[1];
      else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(right)) jam = right;
      return { day_str: leftTrim || null, jam };
    };
    const timeRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
    type TFRow = { source_no: number | null; day: number | null; month: number | null; year: number | null; jam: string | null; fase: string; strike: '0' };
    const rowsTF: TFRow[] = [];
    for (const r of tfRaw) {
      const bulan = r.bulan ? Number(r.bulan) : null;
      const tahun = r.tahun ? Number(r.tahun) : null;
      const srcNo = r.no ?? null;
      const ata = extract_day_and_time(r.ata ?? null);
      if (ata.day_str && ata.jam) rowsTF.push({ source_no: srcNo, day: Number(String(ata.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: ata.jam, fase: 'Landing', strike: '0' });
      const atd = extract_day_and_time(r.atd ?? null);
      if (atd.day_str && atd.jam) rowsTF.push({ source_no: srcNo, day: Number(String(atd.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: atd.jam, fase: 'Take Off', strike: '0' });
    }
    // Drop rows with any NaN-like and any '--:--'
    const rowsTFClean = rowsTF.filter(r => r.day != null && r.month != null && r.year != null && !!r.jam && timeRegex.test(String(r.jam)) && !Object.values(r).some(v => String(v ?? '').includes('--:--')));

    // apply per-month validation rules grouped by source_no
    const apply_validasi_manual_v2 = (rows: TFRow[]) => {
      const out = rows.map(r => ({ ...r }));
      const toDrop = new Set<number>();
      const groups = new Map<string, number[]>();
      for (let i = 0; i < out.length; i++) { const key = String(out[i].source_no ?? 'null'); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(i); }
      const max_day = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
      const safe = (x: unknown): number | null => { const n = Number(x); return Number.isFinite(n) ? Math.trunc(n) : null; };
      for (const idxs of groups.values()) {
        for (let k = 0; k < idxs.length - 1; k++) {
          const i = idxs[k]; const j = idxs[k + 1];
          const cur = out[i]; const nxt = out[j];
          const curF = String(cur.fase || '').trim().toLowerCase(); const nxtF = String(nxt.fase || '').trim().toLowerCase();
          if (curF !== 'landing' || nxtF !== 'take off') continue;
          const y = safe(cur.year); const m = safe(cur.month); const d = safe(cur.day);
          const ny = safe(nxt.year); const nm = safe(nxt.month); const nd = safe(nxt.day);
          if ([y,m,d,ny,nm,nd].some(v => v == null)) continue;
          if (nd !== 1) continue;
          const nextMonth = (m! < 12) ? (m! + 1) : 1; const nextYear = (m! < 12) ? y! : (y! + 1);
          if (!((nm === m && ny === y) || (nm === nextMonth && ny === nextYear))) continue;
          if (m === 1 && [29,30,31].includes(d!)) { toDrop.add(i); continue; }
          if (m === 2 && [29,30,31].includes(d!)) { out[i].month = 1; continue; }
          if (m === 3) { if ((y! % 2 === 1 && d === 28) || (y! % 2 === 0 && (d === 28 || d === 29))) { out[i].month = 2; } continue; }
          if (m === 4) { const mdPrev = max_day(y!, 3); if (d! >= mdPrev) out[i].month = 3; continue; }
          if (m === 5) { const mdPrev = max_day(y!, 4); if (d! >= mdPrev) out[i].month = 4; continue; }
          if (m! >= 6 && m! <= 12) { const mdPrev = max_day(y!, m! - 1); if (d! >= mdPrev) out[i].month = (m! - 1); continue; }
        }
      }
      return out.filter((_, i) => !toDrop.has(i));
    };

    const rowsTFValidated = apply_validasi_manual_v2(rowsTFClean);

    const max_day = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
    const build_tanggal_cap_from_row = (r: TFRow): Date | null => {
      if (r.year == null || r.month == null || r.day == null) return null;
      const y = r.year; const m = r.month; let d = r.day;
      if (!(m >= 1 && m <= 12)) return null;
      const md = max_day(y, m); if (d > md) d = md;
      return new Date(Date.UTC(y, m - 1, d));
    };

    // Diagnostics: detect cases where inputs are present but tanggal fails to build
    const md_arr_post: (number | null)[] = rowsTFValidated.map((r) => {
      if (r.year == null || r.month == null || !(r.month >= 1 && r.month <= 12)) return null;
      try { return new Date(Date.UTC(r.year, r.month, 0)).getUTCDate(); } catch { return null; }
    });

    const hourlyByKeyPost = new Map(hourly.map(h => [h.key_hour, h] as const));

    type TFBase = { tanggal: Date; jam: Date; waktu: string; cuaca: string; fase: string };
    type InsertRow = { tanggal: Date; jam: Date | null; waktu: string; cuaca: string; rata_rata_burung_di_titik_x: bigint | null; titik: bigint | null; fase: string | null; strike: '0' | '1' };
    const tfPreparedBase = rowsTFValidated.map<TFBase | null>((r, i) => {
      const tanggal = build_tanggal_cap_from_row(r);
      if (!tanggal) return null;
      const hh = Number(String(r.jam).split(':')[0]);
      const jamDate = new Date(Date.UTC(1970, 0, 1, Number.isFinite(hh) ? hh : 0, Number(String(r.jam).split(':')[1]||'0') ));
      const dtHour = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), Number.isFinite(hh) ? hh : 0, 0, 0, 0));
      const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
      const h = hourlyByKeyPost.get(key);
      const cuaca = mapWeatherCode(h?.weather_code) ?? 'Tidak tersedia';
      return {
        tanggal,
        jam: jamDate,
        waktu: Number.isFinite(hh) ? waktuFromHourLocal(hh) : 'Malam',
        cuaca,
        fase: r.fase ?? 'Landing'
      };
    }).filter((x): x is TFBase => x !== null);
    // Expand to 8 titik rows (1..8)
    const tfPrepared: InsertRow[] = tfPreparedBase.flatMap((row) =>
      Array.from({ length: 8 }, (_, i2) => ({
        tanggal: row.tanggal,
        jam: row.jam,
        waktu: row.waktu,
        cuaca: row.cuaca,
        rata_rata_burung_di_titik_x: null,
        titik: BigInt(i2 + 1),
        fase: row.fase,
        strike: '0' as const
      }))
    );

    try {
      const problem_rows_post = rowsTFValidated
        .map((r, idx) => ({ idx, y: r.year, m: r.month, d: r.day, md: md_arr_post[idx] }))
        .filter((row) => row.y != null && row.m != null && row.d != null && !(row.m! >= 1 && row.m! <= 12));
      if (problem_rows_post.length) {
        console.warn('modeling: tanggal build problems (POST), sample:', problem_rows_post.slice(0, 20));
      }
    } catch {}

    // Merge bird first, then TF
    const merged: InsertRow[] = [...birdPrepared, ...tfPrepared];


    // Compute rata_rata_burung_di_titik_x using species (df_b) per requested algorithm
    const buildDateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // group species by multiple keys (titik|cuaca|waktu), (cuaca|waktu), (waktu), and keep full list
    const speciesGroups = new Map<string, { tanggal: Date; jumlah: number }[]>();
    const speciesGroupsByCuacaWaktu = new Map<string, { tanggal: Date; jumlah: number }[]>();
    const speciesGroupsByWaktu = new Map<string, { tanggal: Date; jumlah: number }[]>();
    const speciesAll: { tanggal: Date; jumlah: number; titik: number | null; waktu: string }[] = [];
    for (const r of species) {
      try {
        const tInt = normTitik(String(r.titik));
        const w = titleWaktu(String(r.waktu ?? ''));
        const cu = normalizeCuaca(String(r.cuaca ?? ''));
        const d = r.tanggal as Date | null;
        const jb = Number(r.jumlah_burung ?? NaN);
        if (!d || !Number.isFinite(jb)) continue;
        const key = `${tInt}|${cu}|${w}`;
        const arr = speciesGroups.get(key) || [];
        arr.push({ tanggal: buildDateOnly(d), jumlah: jb });
        speciesGroups.set(key, arr);
        const k2 = `${cu}|${w}`;
        const arr2 = speciesGroupsByCuacaWaktu.get(k2) || [];
        arr2.push({ tanggal: buildDateOnly(d), jumlah: jb });
        speciesGroupsByCuacaWaktu.set(k2, arr2);
        const k3 = `${w}`;
        const arr3 = speciesGroupsByWaktu.get(k3) || [];
        arr3.push({ tanggal: buildDateOnly(d), jumlah: jb });
        speciesGroupsByWaktu.set(k3, arr3);
        speciesAll.push({ tanggal: buildDateOnly(d), jumlah: jb, titik: tInt, waktu: w });
      } catch {}
    }

    // For each merged row, find candidates and nearest date average with relaxed fallbacks
    const avgResults: (number | null)[] = [];
    for (const row of merged) {
      try {
        const tVal = row.titik == null ? null : (typeof row.titik === 'bigint' ? Number(row.titik) : Number(row.titik));
        const w = titleWaktu(String(row.waktu ?? ''));
        const cu = normalizeCuaca(String(row.cuaca ?? ''));
        const key = `${tVal}|${cu}|${w}`;
        // exact (requires exact titik numeric match)
        let candidates = speciesGroups.get(key) || [];
        // Fallbacks: same titik + waktu (ignore cuaca)
        if (!candidates.length && tVal != null) {
          const partsMatch: { tanggal: Date; jumlah: number }[] = [];
          for (const [k, arr] of speciesGroups.entries()) {
            const parts = k.split('|');
            if (parts.length !== 3) continue;
            if (parts[0] === String(tVal) && parts[2] === w) partsMatch.push(...arr);
          }
          if (partsMatch.length) candidates = partsMatch;
        }
        // Fallback: same titik only
        if (!candidates.length && tVal != null) {
          const partsMatch: { tanggal: Date; jumlah: number }[] = [];
          for (const [k, arr] of speciesGroups.entries()) {
            const parts = k.split('|');
            if (parts.length !== 3) continue;
            if (parts[0] === String(tVal)) partsMatch.push(...arr);
          }
          if (partsMatch.length) candidates = partsMatch;
        }
        // Fallback: same cuaca + waktu (ignore titik)
        if (!candidates.length) {
          const k2 = `${cu}|${w}`;
          const arr2 = speciesGroupsByCuacaWaktu.get(k2) || [];
          if (arr2.length) candidates = arr2;
        }
        // Fallback: same waktu only
        if (!candidates.length) {
          const arr3 = speciesGroupsByWaktu.get(w) || [];
          if (arr3.length) candidates = arr3;
        }
        // Final fallback: try mean by waktu or global mean first
        if (!candidates.length) {
          const m = meanByWaktu.get(w);
          if (m != null) { avgResults.push(m); continue; }
          if (globalMean != null) { avgResults.push(globalMean); continue; }
          if (speciesAll.length) {
            candidates = speciesAll.map(x => ({ tanggal: x.tanggal, jumlah: x.jumlah }));
          }
        }

        if (!candidates.length) { avgResults.push(null); continue; }

        const targetDate = buildDateOnly(row.tanggal);
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const c of candidates) {
          const diff = Math.abs(targetDate.getTime() - c.tanggal.getTime());
          if (diff < bestDiff) bestDiff = diff;
        }
        const nearest = candidates.filter(c => Math.abs(targetDate.getTime() - c.tanggal.getTime()) === bestDiff);
        if (!nearest.length) { avgResults.push(null); continue; }
        const sum = nearest.reduce((s, x) => s + x.jumlah, 0);
        const avg = sum / nearest.length;
        avgResults.push(Number.isFinite(avg) ? avg : null);
      } catch { avgResults.push(null); }
    }

    // Interpolate missing values per-titik group (simple linear interpolation by index within same titik)
    const interpGroup = (arr: (number | null)[], groups: Map<number, number[]>) => {
      const out = arr.slice();
      for (const [tKey, indices] of groups.entries()) {
        if (!indices.length) continue;
        // build subarray
        const sub = indices.map(i => out[i]);
        const n = sub.length;
        let i = 0;
        while (i < n && (sub[i] == null || !Number.isFinite(Number(sub[i])))) i++;
        if (i === n) {
          // all null - leave as null
          continue;
        }
        // fill leading with first known
        for (let k = 0; k < i; k++) sub[k] = sub[i];
        while (i < n) {
          if (sub[i] != null && Number.isFinite(Number(sub[i]))) { i++; continue; }
          const start = i - 1;
          let j = i;
          while (j < n && (sub[j] == null || !Number.isFinite(Number(sub[j])))) j++;
          const end = j;
          const left = Number(sub[start]);
          const right = end < n ? Number(sub[end]) : left;
          const gap = end - start;
          for (let t = 1; t < gap; t++) {
            const val = left + (right - left) * (t / gap);
            sub[start + t] = val;
          }
          i = end;
        }
        // write back
        for (let k = 0; k < indices.length; k++) out[indices[k]] = sub[k];
      }
      return out;
    };

    // build groups by titik numeric value
    const groups = new Map<number, number[]>();
    for (let i = 0; i < merged.length; i++) {
      const rv = merged[i].titik == null ? NaN : (typeof merged[i].titik === 'bigint' ? Number(merged[i].titik) : Number(merged[i].titik));
      const key = Number.isFinite(rv) ? rv : -1;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }

    const interpolated = interpGroup(avgResults, groups);

    for (let idx = 0; idx < merged.length; idx++) {
      const v = interpolated[idx];
      merged[idx].rata_rata_burung_di_titik_x = v == null || !Number.isFinite(Number(v)) || Number.isNaN(Number(v)) ? null : BigInt(Math.round(Number(v)));
    }

    const toInsert: InsertRow[] = merged;

    // Insert batched
    let created = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      if (chunk.length) {
        const res = await prisma.model.createMany({ data: chunk, skipDuplicates: true });
        created += res.count;
      }
    }

    // Trigger background training when new modeling rows were created
    if (created > 0) {
      try {
        const { spawn } = await import('child_process');
        const python = process.env.PYTHON_BIN || 'python3';
        const script = process.env.TRAIN_SCRIPT || 'backend/scripts/train.py';
        const output = process.env.MODEL_OUTPUT || 'backend/models/model.cbm';
        const query = 'SELECT tanggal, jam, waktu, cuaca, rata_rata_burung_di_titik_x, titik, fase, strike FROM model';
        const args = ['--output', output, '--query', query];
        const modelType = process.env.MODEL_TYPE || 'random_forest';
        const nodeEnv = (process.env.NODE_ENV as 'development' | 'production' | 'test' | undefined) || 'production';
        const envVars: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: nodeEnv, MODEL_TYPE: modelType };
        const proc = spawn(python, [script, ...args], { detached: true, stdio: 'ignore', env: envVars }) as import('child_process').ChildProcess;
        try { proc.unref(); } catch {}
        console.log('Triggered background training:', script, 'MODEL_TYPE=', modelType);
      } catch (e) {
        console.error('Failed to trigger training script:', e);
      }
    }

    return NextResponse.json({ success: true, deleted_before: true, created });
  } catch (error) {
    console.error('Error generating modeling data:', error);
    return NextResponse.json({ success: false, message: 'Failed to generate modeling data' }, { status: 500 });
  } finally {
    if (lockAcquired) {
      try { await prisma.$executeRaw`SELECT pg_advisory_unlock(214748364, 987654321)`; } catch (e) { console.error('Failed to release advisory lock:', e); }
    }
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = (searchParams.get('source') || 'all').toLowerCase();
    const sinceStr = searchParams.get('since');
    const untilStr = searchParams.get('until');

    const where: Record<string, unknown> = {};
    if (source === 'bird-strike') where.strike = '1';
    if (source === 'traffic-flight') where.strike = '0';

    const andConds: Record<string, unknown>[] = [];
    if (sinceStr) {
      const d = new Date(sinceStr);
      if (!Number.isNaN(d.getTime())) andConds.push({ tanggal: { gte: d } });
    }
    if (untilStr) {
      const d = new Date(untilStr);
      if (!Number.isNaN(d.getTime())) andConds.push({ tanggal: { lte: d } });
    }
    if (andConds.length) (where as { AND?: unknown[] }).AND = andConds;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    const result = await prisma.model.deleteMany({ where });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    console.error('Error deleting modeling data:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete modeling data' }, { status: 500 });
  }
}

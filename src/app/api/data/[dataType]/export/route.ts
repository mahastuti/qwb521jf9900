import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

// Utility to serialize values for CSV
const toCsvValue = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'bigint') return val.toString();
  if (val instanceof Date) return val.toISOString();
  const s = String(val);
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
};

const buildResponse = (csv: string, filename: string) =>
  new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });

// Shared in-memory cache for Open-Meteo hourly weather (10 minutes)
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
    // cache even if map is empty, to avoid retry storms when offline
    HOURLY_CACHE = { map, expires: Date.now() + 10 * 60 * 1000 };
    return map;
  } catch {
    // Quietly fallback; return empty map and cache to suppress repeated retries
    const map = new Map<string, { weather_code: number }>();
    HOURLY_CACHE = { map, expires: Date.now() + 10 * 60 * 1000 };
    return map;
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ dataType: string }> }) {
  try {
    const { dataType } = await context.params;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const showDeleted = searchParams.get('showDeleted') === 'true';
    const sortByParam = searchParams.get('sortBy') || '';
    const sortOrderParam = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
    const pageParam = Number.parseInt(searchParams.get('page') || '', 10);
    const limitParam = Number.parseInt(searchParams.get('limit') || '', 10);

    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}_${pad(ts.getHours())}-${pad(ts.getMinutes())}-${pad(ts.getSeconds())}`;

    if (dataType === 'bird-strike') {
      const allowedSort = new Set(['id','tanggal','jam','waktu','fase','lokasi_perimeter','titik','kategori_kejadian','airline','runway_use','komponen_pesawat','dampak_pada_pesawat','kondisi_kerusakan','tindakan_perbaikan','sumber_informasi','remark','deskripsi','jenis_pesawat','createdAt']);
      const sortBy = allowedSort.has(sortByParam) ? sortByParam : 'createdAt';
      const orderBy = { [sortBy]: sortOrderParam } as Record<string, 'asc' | 'desc'>;

      const orFilters: Record<string, unknown>[] = [];
      if (search) {
        const s = search;
        const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
        for (const k of [
          'waktu','fase','lokasi_perimeter','titik','kategori_kejadian','remark','airline','runway_use','komponen_pesawat','dampak_pada_pesawat','kondisi_kerusakan','tindakan_perbaikan','sumber_informasi','deskripsi','dokumentasi','jenis_pesawat'
        ]) {
          orFilters.push(like(k));
        }
        if (/^\d+$/.test(s)) { try { orFilters.push({ id: BigInt(s) }); } catch {}
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const d = new Date(s); if (!Number.isNaN(d.getTime())) orFilters.push({ tanggal: d });
        }
        if (/^\d{2}:\d{2}$/.test(s)) {
          const t = new Date(`1970-01-01T${s}:00.000Z`); if (!Number.isNaN(t.getTime())) orFilters.push({ jam: t });
        }
      }

      const where = {
        deletedAt: showDeleted ? { not: null } : null,
        ...(search && { OR: orFilters })
      };

      if (!process.env.DATABASE_URL) {
        const headers = ['tanggal','jam','waktu','fase','lokasi_perimeter','titik','kategori_kejadian','airline','runway_use','komponen_pesawat','dampak_pada_pesawat','kondisi_kerusakan','tindakan_perbaikan','sumber_informasi','remark','deskripsi','dokumentasi','jenis_pesawat'];
        return buildResponse(headers.join(','), `bird-strike_all_${timestamp}.csv`);
      }
      let rows = await prisma.birdStrike.findMany({ where, orderBy });
      if (Number.isFinite(pageParam) && Number.isFinite(limitParam) && pageParam > 0 && limitParam > 0) {
        const start = (pageParam - 1) * limitParam;
        rows = rows.slice(start, start + limitParam);
      }

      const DOC_BASE = 'https://odjhvlqvbnqrjlowjywq.supabase.co/storage/v1/object/public/bird-strike/';
      const toYmd = (d: Date | string | null | undefined): string | null => {
        if (!d) return null;
        const dd = d instanceof Date ? d : new Date(String(d));
        if (Number.isNaN(dd.getTime())) return null;
        const yyyy = dd.getFullYear();
        const mm = String(dd.getMonth() + 1).padStart(2, '0');
        const ddp = String(dd.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${ddp}`;
      };
      const headers = [
        'tanggal','jam','waktu','fase','lokasi_perimeter','titik','kategori_kejadian','airline','runway_use','komponen_pesawat','dampak_pada_pesawat','kondisi_kerusakan','tindakan_perbaikan','sumber_informasi','remark','deskripsi','dokumentasi','jenis_pesawat'
      ];
      const csvRows = [headers.join(',')];
      for (const r of rows) {
        const obj = r as unknown as Record<string, unknown>;
        const ymd = toYmd(obj['tanggal'] as unknown as Date);
        const doc = obj['dokumentasi'] ?? (ymd ? `${DOC_BASE}${ymd}.png` : '');
        const rowVals = headers.map((h) => {
          const v = h === 'dokumentasi' ? doc : obj[h];
          if (v instanceof Date && (h === 'tanggal' || h === 'jam')) return toCsvValue(v.toISOString());
          return toCsvValue(v);
        });
        csvRows.push(rowVals.join(','));
      }
      return buildResponse(csvRows.join('\n'), `bird-strike_all_${timestamp}.csv`);
    }

    if (dataType === 'bird-species') {
      const allowedSort = new Set(['id','longitude','latitude','lokasi','titik','tanggal','jam','waktu','cuaca','jenis_burung','nama_ilmiah','jumlah_burung','createdAt']);
      const sortBy = allowedSort.has(sortByParam) ? sortByParam : 'createdAt';
      const orderBy = { [sortBy]: sortOrderParam } as Record<string, 'asc' | 'desc'>;

      const orFilters: Record<string, unknown>[] = [];
      if (search) {
        const s = search;
        const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
        for (const k of ['longitude','latitude','lokasi','titik','waktu','cuaca','jenis_burung','nama_ilmiah','keterangan','dokumentasi']) {
          orFilters.push(like(k));
        }
        const asInt = Number.parseInt(s, 10);
        if (!Number.isNaN(asInt)) { orFilters.push({ jumlah_burung: asInt }); }
        if (/^\d+$/.test(s)) { try { orFilters.push({ id: BigInt(s) }); } catch {} }
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const d = new Date(s); if (!Number.isNaN(d.getTime())) orFilters.push({ tanggal: d });
        }
        if (/^\d{2}:\d{2}$/.test(s)) {
          const t = new Date(`1970-01-01T${s}:00.000Z`); if (!Number.isNaN(t.getTime())) orFilters.push({ jam: t });
        }
      }

      const where = {
        deletedAt: showDeleted ? { not: null } : null,
        ...(search && { OR: orFilters })
      };

      if (!process.env.DATABASE_URL) {
        const headers = ['longitude','latitude','lokasi','titik','tanggal','jam','waktu','cuaca','jenis_burung','nama_ilmiah','jumlah_burung','keterangan','dokumentasi'];
        return buildResponse(headers.join(','), `bird-species_all_${timestamp}.csv`);
      }
      let rows = await prisma.burung_bio.findMany({ where, orderBy });
      if (Number.isFinite(pageParam) && Number.isFinite(limitParam) && pageParam > 0 && limitParam > 0) {
        const start = (pageParam - 1) * limitParam;
        rows = rows.slice(start, start + limitParam);
      }

      const headers = [
        'longitude','latitude','lokasi','titik','tanggal','jam','waktu','cuaca','jenis_burung','nama_ilmiah','jumlah_burung','keterangan','dokumentasi'
      ];
      const csvRows = [headers.join(',')];
      for (const r of rows) {
        const rowVals = headers.map((h) => {
          const v = (r as unknown as Record<string, unknown>)[h];
          if (v instanceof Date && (h === 'tanggal' || h === 'jam')) return toCsvValue(v.toISOString());
          return toCsvValue(v);
        });
        csvRows.push(rowVals.join(','));
      }
      return buildResponse(csvRows.join('\n'), `bird-species_all_${timestamp}.csv`);
    }

    if (dataType === 'modeling') {
      const allowedSort = new Set(['id','tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike']);
      const sortBy = allowedSort.has(sortByParam) ? sortByParam : 'id';
      const orderByArr = [{ strike: 'desc' as const }, { [sortBy]: sortOrderParam } as Record<string,'asc'|'desc'>, { id: 'asc' as const }];
      const source = (searchParams.get('source') || 'all').toLowerCase();
      const preview = searchParams.get('preview') === '1';

      const orFilters: Record<string, unknown>[] = [];
      if (search) {
        const s = search;
        const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
        for (const k of ['waktu','cuaca','fase','strike']) {
          orFilters.push(like(k));
        }
        if (/^\d+$/.test(s)) {
          try { orFilters.push({ id: BigInt(s) }); } catch {}
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const d = new Date(s); if (!Number.isNaN(d.getTime())) orFilters.push({ tanggal: d });
        }
        if (/^\d{2}:\d{2}$/.test(s)) {
          const t = new Date(`1970-01-01T${s}:00.000Z`); if (!Number.isNaN(t.getTime())) orFilters.push({ jam: t });
        }
      }

      if (preview) {
        if (!process.env.DATABASE_URL) {
          const headers = ['tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike'];
          return buildResponse(headers.join(','), `modeling_all_${timestamp}.csv`);
        }
        const waktuFromHour = (hour: number): string => {
          if (hour >= 0 && hour <= 3) return 'Dini Hari';
          if (hour > 3 && hour <= 8) return 'Pagi';
          if (hour > 8 && hour <= 13) return 'Siang';
          if (hour > 13 && hour <= 18) return 'Sore';
          return 'Malam';
        };
        const titleWaktu = (w: string) => { const s = w.trim().toLowerCase(); if (s.includes('dini')) return 'Dini Hari'; if (s.includes('pagi')) return 'Pagi'; if (s.includes('siang')) return 'Siang'; if (s.includes('sore')) return 'Sore'; return 'Malam'; };
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
        const mapWeatherCode = (code: number | null | undefined): string => {
          if (code === null || code === undefined) return 'Tidak tersedia';
          const m: Record<number, string> = {0:'Cerah',1:'Cerah Berawan',2:'Berawan Sebagian',3:'Berawan',45:'Berkabut',48:'Rime Kabut',51:'Gerimis Ringan',53:'Gerimis Sedang',55:'Gerimis Lebat',56:'Gerimis Beku Ringan',57:'Gerimis Beku Lebat',61:'Hujan Ringan',63:'Hujan Sedang',65:'Hujan Lebat',66:'Hujan Beku Ringan',67:'Hujan Beku Lebat',71:'Salju Ringan',73:'Salju Sedang',75:'Salju Lebat',77:'Butiran Salju',80:'Hujan Gerimis',81:'Hujan Lebat Sesaat',82:'Hujan Sangat Lebat Sesaat',85:'Hujan Salju Ringan',86:'Hujan Salju Lebat',95:'Badai Petir',96:'Badai Petir',99:'Badai Petir'}; return m[Number(code)] ?? 'Tidak tersedia';
        };
        const toHourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / 3600000) * 3600000);

        // Build hourly weather map (cached, quiet on failure)
        const hourlyByKey = await getHourlyWeatherMap();

        // Bird strike subset (2025, confirmed, runway 10/28, Landing/Take Off)
        const tahunTargetMulai = new Date('2025-01-01T00:00:00.000Z');
        const tahunTargetAkhir = new Date('2025-12-31T23:59:59.999Z');
        const birdRaw = await prisma.birdStrike.findMany({ where: { tanggal: { gte: tahunTargetMulai, lte: tahunTargetAkhir }, remark: { equals: 'Terkonfirmasi' }, fase: { in: ['Landing','Take Off'] }, runway_use: { in: ['10','28','10.0','28.0','010','028'] } }, orderBy: { tanggal: 'asc' } });
        const normTitik = (s: string | null | undefined): number | null => { if (!s) return null; const m = String(s).match(/-?\d+(?:[\.,]\d+)?/); if (!m) return null; const f = parseFloat(m[0].replace(',', '.')); if (!Number.isFinite(f)) return null; return Math.round(f); };
        type ModelRow = { tanggal: Date; jam: Date | null; waktu: string | null; cuaca: string | null; rata_rata_burung_di_titik_x: number | null; titik: number | null; fase: string | null; strike: '0' | '1' };
        const birdPrepared: ModelRow[] = birdRaw.map(r => {
          const tInt = normTitik(r.titik ?? null);
          const hour = r.jam ? new Date(r.jam).getUTCHours() : null;
          const waktu = hour == null ? 'Malam' : waktuFromHour(hour);
          const jam = r.jam ?? null;
          const dtHour = toHourFloor(new Date(new Date(r.tanggal ?? new Date()).getTime()));
          const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
          const h = hourlyByKey.get(key);
          const cuaca = mapWeatherCode(h?.weather_code);
          return { tanggal: r.tanggal!, jam, waktu, cuaca: cuaca ?? 'Tidak tersedia', rata_rata_burung_di_titik_x: null, titik: tInt != null ? tInt : null, fase: r.fase ?? null, strike: '1' as const };
        });

        // Traffic flight rows with weather
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
        type TFRow = { source_no: number | null; day: number | null; month: number | null; year: number | null; jam: string | null; waktu: string | null; fase: string; strike: '0' };
        const rowsTF: TFRow[] = [];
        for (const r of tfRaw) {
          const bulan = r.bulan ? Number(r.bulan) : null; const tahun = r.tahun ? Number(r.tahun) : null; const srcNo = r.no ?? null;
          const ata = extract_day_and_time(r.ata ?? null); if (ata.day_str && ata.jam) rowsTF.push({ source_no: srcNo, day: Number(String(ata.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: ata.jam, waktu: null, fase: 'Landing', strike: '0' });
          const atd = extract_day_and_time(r.atd ?? null); if (atd.day_str && atd.jam) rowsTF.push({ source_no: srcNo, day: Number(String(atd.day_str).replace(/\D/g,'')) || null, month: bulan, year: tahun, jam: atd.jam, waktu: null, fase: 'Take Off', strike: '0' });
        }
        for (const r of rowsTF) { if (r.jam) { const hh = Number(String(r.jam).split(':')[0]); r.waktu = Number.isFinite(hh) ? waktuFromHour(hh) : null; } }
        const timeRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
        const rowsTFClean = rowsTF.filter(r => r.day != null && r.month != null && r.year != null && !!r.jam && timeRegex.test(String(r.jam)) && !Object.values(r).some(v => String(v ?? '').includes('--:--'))).map(r => ({ ...r, jam: String(r.jam).trim() }));
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
        const max_day = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
        const build_tanggal_cap_from_row = (r: TFRow): Date | null => { if (r.year == null || r.month == null || r.day == null) return null; const y = r.year; const m = r.month; let d = r.day; if (!(m >= 1 && m <= 12)) return null; const md = max_day(y, m); if (d > md) d = md; return new Date(Date.UTC(y, m - 1, d)); };
        const tfPreparedBase = tfValidated.map<ModelRow | null>(r => {
          const tanggal = build_tanggal_cap_from_row(r);
          if (!tanggal) return null;
          const hh = Number(String(r.jam).split(':')[0]);
          const jamDate = new Date(Date.UTC(1970,0,1, Number.isFinite(hh)?hh:0, Number(String(r.jam).split(':')[1]||'0')));
          const dtHour = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), Number.isFinite(hh) ? hh : 0, 0, 0, 0));
          const key = `${dtHour.getUTCFullYear()}-${String(dtHour.getUTCMonth() + 1).padStart(2, '0')}-${String(dtHour.getUTCDate()).padStart(2, '0')} ${String(dtHour.getUTCHours()).padStart(2, '0')}:${String(dtHour.getUTCMinutes()).padStart(2, '0')}`;
          const h = hourlyByKey.get(key);
          const cuaca = mapWeatherCode(h?.weather_code) ?? 'Tidak tersedia';
          return { tanggal, jam: jamDate, waktu: r.waktu ?? (Number.isFinite(hh)? waktuFromHour(hh):'Malam'), cuaca, rata_rata_burung_di_titik_x: null, titik: null, fase: r.fase, strike: '0' };
        }).filter((x): x is ModelRow => x !== null);
        const tfPrepared: ModelRow[] = tfPreparedBase.flatMap((row) => Array.from({ length: 8 }, (_, i2) => ({ ...row, titik: i2 + 1 })));

        // Merge and filter by source
        let merged: ModelRow[] = [...birdPrepared, ...tfPrepared];
        if (source === 'bird-strike') merged = merged.filter(r => r.strike === '1');
        if (source === 'traffic-flight') merged = merged.filter(r => r.strike === '0');

        // Join species average with fallbacks
        try {
          const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
          if (merged.length) {
            const minMs = Math.min(...merged.map(r => r.tanggal.getTime()));
            const maxMs = Math.max(...merged.map(r => r.tanggal.getTime()));
            const windowStart = new Date(minMs - 90*24*3600*1000);
            const windowEnd = new Date(maxMs + 90*24*3600*1000);
            const speciesRows = await prisma.burung_bio.findMany({ where: { tanggal: { gte: windowStart, lte: windowEnd } }, select: { titik: true, tanggal: true, cuaca: true, waktu: true, jumlah_burung: true } });
            const agg = new Map<string, { sum: number; count: number }>();
            const aggNoCuaca = new Map<string, { sum: number; count: number }>();
            const byGroupDaily = new Map<string, { _tanggal_dt: Date; mean_harian: number }[]>();
            const normW = (w: string|null|undefined) => w ? titleWaktu(String(w)) : '';
            const normT = (t: unknown) => { const m = String(t ?? '').match(/-?\d+(?:[\.,]\d+)?/); if (!m) return null; const f = parseFloat(m[0].replace(',','.')); return Number.isFinite(f) ? Math.round(f) : null; };
            for (const s of speciesRows) {
              const tInt = normT(s.titik);
              const dt = s.tanggal as Date | null;
              const cStr = normalizeCuaca(String(s.cuaca ?? ''));
              const wStr = normW(s.waktu ?? '');
              const jb = Number(s.jumlah_burung ?? NaN);
              if (tInt == null || !dt || !Number.isFinite(jb)) continue;
              const dKey = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
              const kExact = `${tInt}|${ymd(dKey)}|${String(cStr)}|${wStr}`;
              const kNoC = `${tInt}|${ymd(dKey)}|${wStr}`;
              const cur = agg.get(kExact) || { sum: 0, count: 0 };
              cur.sum += jb; cur.count += 1; agg.set(kExact, cur);
              const cur2 = aggNoCuaca.get(kNoC) || { sum: 0, count: 0 };
              cur2.sum += jb; cur2.count += 1; aggNoCuaca.set(kNoC, cur2);
              const gDaily = `${tInt}|${wStr}`;
              if (!byGroupDaily.has(gDaily)) byGroupDaily.set(gDaily, []);
              byGroupDaily.get(gDaily)!.push({ _tanggal_dt: dKey, mean_harian: jb });
            }
            for (const arr of byGroupDaily.values()) arr.sort((a,b)=>a._tanggal_dt.getTime()-b._tanggal_dt.getTime());

            const avgByTitikWaktu = new Map<string, number>();
            const avgByWaktu = new Map<string, number>();
            for (const [gKey, arr] of byGroupDaily.entries()) {
              if (arr.length) {
                const mean = arr.reduce((a,b)=>a+b.mean_harian,0)/arr.length;
                avgByTitikWaktu.set(gKey, mean);
                const waktu = gKey.split('|')[1] || '';
                const cur = avgByWaktu.get(waktu) || 0;
                const cnt = (avgByWaktu.get(`${waktu}__cnt`) as unknown as number) || 0;
                const newMean = (cur*cnt + mean) / (cnt + 1);
                avgByWaktu.set(waktu, newMean);
                avgByWaktu.set(`${waktu}__cnt`, (cnt + 1) as unknown as number);
              }
            }

            const maxDiff = 90*24*3600*1000;
            for (const r of merged) {
              const waktuNorm = titleWaktu(String(r.waktu ?? ''));
              const kExact = `${Number(r.titik ?? NaN)}|${ymd(r.tanggal)}|${normalizeCuaca(String(r.cuaca ?? ''))}|${waktuNorm}`;
              const kNoC = `${Number(r.titik ?? NaN)}|${ymd(r.tanggal)}|${waktuNorm}`;
              let vv = agg.get(kExact) || null;
              if (!vv) vv = aggNoCuaca.get(kNoC) || null;
              if (!vv) {
                const gDaily = `${Number(r.titik ?? NaN)}|${waktuNorm}`;
                const arr = byGroupDaily.get(gDaily) || [];
                let best: { diff: number; val: number } | null = null;
                for (const x of arr) {
                  const diff = Math.abs(x._tanggal_dt.getTime() - r.tanggal.getTime());
                  if (diff <= maxDiff && (!best || diff < best.diff)) best = { diff, val: x.mean_harian };
                }
                if (best) vv = { sum: best.val, count: 1 };
              }
              if (!vv) {
                const gDaily = `${Number(r.titik ?? NaN)}|${waktuNorm}`;
                const broad = avgByTitikWaktu.get(gDaily);
                if (broad != null) vv = { sum: broad, count: 1 };
              }
              if (!vv) {
                const broadW = avgByWaktu.get(waktuNorm);
                if (broadW != null) vv = { sum: broadW, count: 1 };
              }
              r.rata_rata_burung_di_titik_x = null;
            }
          }
        } catch (e) { console.error('join species avg failed (export preview)', e); }

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
            return [ `${YYYY}-${A}-${B}`, `${YYYY}-${B}-${A}` ];
          })();
          merged = merged.filter(r => {
            const tanggalIso = r.tanggal.toISOString();
            const jamIso = r.jam ? r.jam.toISOString() : '';
            const jamHM = jamIso ? jamIso.slice(11, 16) : '';
            const vals = [ r.waktu, r.cuaca, r.fase, r.strike, tanggalIso, jamIso, jamHM, r.titik != null ? String(r.titik) : '', r.rata_rata_burung_di_titik_x != null ? String(r.rata_rata_burung_di_titik_x) : '' ].map(v => (v == null ? '' : String(v).toLowerCase()));
            if (vals.some(v => v.includes(s))) return true;
            if (dateCandidates.length && (tanggalIso || jamIso)) {
              const lowTanggal = String(tanggalIso || '').toLowerCase();
              const lowJam = String(jamIso || '').toLowerCase();
              if (dateCandidates.some(tok => lowTanggal.includes(tok) || lowJam.includes(tok))) return true;
            }
            return false;
          });
        }

        merged.sort((a, b) => {
          if (a.strike !== b.strike) return a.strike === '1' ? -1 : 1;
          const key = sortBy as keyof ModelRow; const dir = sortOrderParam === 'asc' ? 1 : -1;
          const va = a[key] as Date | number | string | null | undefined; const vb = b[key] as Date | number | string | null | undefined;
          if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
          if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * dir;
          return String(va).localeCompare(String(vb)) * dir;
        });

        let rows: ModelRow[] = merged;
        if (Number.isFinite(pageParam) && Number.isFinite(limitParam) && pageParam > 0 && limitParam > 0) {
          const start = (pageParam - 1) * limitParam; rows = merged.slice(start, start + limitParam);
        }
        const headers = ['tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike'];
        const csvRows = [headers.join(',')];
        for (const r of rows) {
          const rowVals = headers.map((h) => {
            const v = (r as Record<string, unknown>)[h];
            if (v instanceof Date && (h === 'tanggal' || h === 'jam')) return toCsvValue(v.toISOString());
            return toCsvValue(v);
          });
          csvRows.push(rowVals.join(','));
        }
        return buildResponse(csvRows.join('\n'), `modeling_all_${timestamp}.csv`);
      }

      // Not preview: export from DB, with optional source filter
      const where: Record<string, unknown> = search ? { OR: orFilters } : {};
      if (source === 'bird-strike') (where as { strike?: string }).strike = '1';
      if (source === 'traffic-flight') (where as { strike?: string }).strike = '0';

      if (!process.env.DATABASE_URL) {
        const headers = ['tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike'];
        return buildResponse(headers.join(','), `modeling_all_${timestamp}.csv`);
      }
      let rows = await prisma.model.findMany({ where: where as Prisma.modelWhereInput, orderBy: orderByArr as Prisma.modelOrderByWithRelationInput[] });
      if (Number.isFinite(pageParam) && Number.isFinite(limitParam) && pageParam > 0 && limitParam > 0) {
        const start = (pageParam - 1) * limitParam;
        rows = rows.slice(start, start + limitParam);
      }

      const headers = ['tanggal','jam','waktu','cuaca','rata_rata_burung_di_titik_x','titik','fase','strike'];
      const csvRows = [headers.join(',')];
      for (const r of rows) {
        const rowVals = headers.map((h) => {
          const v = (r as unknown as Record<string, unknown>)[h];
          if (v instanceof Date && (h === 'tanggal' || h === 'jam')) return toCsvValue(v.toISOString());
          return toCsvValue(v);
        });
        csvRows.push(rowVals.join(','));
      }
      return buildResponse(csvRows.join('\n'), `modeling_all_${timestamp}.csv`);
    }

    if (dataType === 'traffic-flight') {
      const allowedSort = new Set(['id','no','act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun']);
      const sortBy = allowedSort.has(sortByParam) ? sortByParam : 'id';
      const orderBy = { [sortBy]: sortOrderParam } as Record<string, 'asc' | 'desc'>;

      const bulanFilter = (searchParams.get('bulan') || '').trim();
      const tahunFilter = (searchParams.get('tahun') || '').trim();

      const orFilters: Record<string, unknown>[] = [];
      if (search) {
        const s = search;
        const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
        for (const k of ['act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun']) {
          orFilters.push(like(k));
        }
        const asInt = Number.parseInt(s, 10);
        if (!Number.isNaN(asInt)) orFilters.push({ no: asInt });
      }

      const andConds: Record<string, unknown>[] = [];
      if (search && orFilters.length) andConds.push({ OR: orFilters });
      if (tahunFilter) andConds.push({ tahun: tahunFilter });
      if (bulanFilter) {
        const bulanAlt = String(Number.parseInt(bulanFilter, 10));
        andConds.push({ OR: [{ bulan: bulanFilter }, { bulan: bulanAlt }] });
      }
      const where = andConds.length ? { AND: andConds } : {};

      if (!process.env.DATABASE_URL) {
        const headers = ['no','act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun'];
        return buildResponse(headers.join(','), `traffic-flight_all_${timestamp}.csv`);
      }
      let rows = await prisma.trafficFlight.findMany({ where, ...(sortBy === 'no' ? {} : { orderBy }) });
      if (sortBy === 'no') {
        const num = (v: unknown): number => {
          if (v == null) return Number.POSITIVE_INFINITY;
          const s = String(v).trim();
          const m = s.match(/^-?\d+/);
          const n = m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
          return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
        };
        type TF = { no?: unknown } & Record<string, unknown>;
        rows.sort((a: TF, b: TF) => {
          const da = num(a.no);
          const db = num(b.no);
          if (da !== db) return sortOrderParam === 'asc' ? da - db : db - da;
          const sa = (a.no ?? '').toString();
          const sb = (b.no ?? '').toString();
          return sortOrderParam === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        });
      }
      if (Number.isFinite(pageParam) && Number.isFinite(limitParam) && pageParam > 0 && limitParam > 0) {
        const start = (pageParam - 1) * limitParam;
        rows = rows.slice(start, start + limitParam);
      }

      const headers = [
        'no','act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun'
      ];
      const csvRows = [headers.join(',')];
      for (const r of rows) {
        const rowVals = headers.map((h) => toCsvValue((r as unknown as Record<string, unknown>)[h]));
        csvRows.push(rowVals.join(','));
      }
      return buildResponse(csvRows.join('\n'), `traffic-flight_all_${timestamp}.csv`);
    }

    return NextResponse.json({ success: false, message: 'Invalid data type' }, { status: 400 });
  } catch (error) {
    console.error('Error exporting CSV:', error);
    return NextResponse.json({ success: false, message: 'Failed to export data' }, { status: 500 });
  }
}

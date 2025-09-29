import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface TrafficFlightCreate {
  no: number | null;
  act_type: string | null;
  reg_no: string | null;
  opr: string | null;
  flight_number_origin: string | null;
  flight_number_dest: string | null;
  ata: string | null;
  block_on: string;
  block_off: string;
  atd: string | null;
  ground_time: string | null;
  org: string | null;
  des: string | null;
  ps: string | null;
  runway: string | null;
  avio_a: string | null;
  avio_d: string | null;
  f_stat: string | null;
  bulan: string | null;
  tahun: string | null;
}

const toNullIfPlaceholder = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const lower = s.toLowerCase();
  const placeholders = new Set([
    '-', '–', '—', 'none', 'null', 'n/a', 'na', '#', '#n/a', 'nil'
  ]);
  return placeholders.has(lower) ? null : s;
};

// Normalize helpers
const normalizeMonth = (v: string | null): string | null => {
  if (!v) return null;
  const n = Number.parseInt(String(v).trim(), 10);
  if (Number.isNaN(n)) return String(v).trim();
  if (n < 1 || n > 12) return String(n);
  return String(n).padStart(2, '0');
};
const normalizeYear = (v: string | null): string | null => {
  if (!v) return null;
  const n = Number.parseInt(String(v).trim(), 10);
  if (Number.isNaN(n)) return String(v).trim();
  return String(n);
};

// Robust CSV parser supporting quotes and commas/newlines inside quotes
const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  let quoteChar: '"' | "'" | null = null;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === quoteChar) {
        if (input[i + 1] === quoteChar) { field += quoteChar; i += 2; continue; }
        inQuotes = false; quoteChar = null; i++; continue;
      }
      field += ch; i++; continue;
    } else {
      if (ch === '"' || ch === "'") { inQuotes = true; quoteChar = ch as '"' | "'"; i++; continue; }
      if (ch === ',') { cur.push(field.trim()); field = ''; i++; continue; }
      if (ch === '\n') { cur.push(field.trim()); rows.push(cur); cur = []; field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      field += ch; i++;
    }
  }
  cur.push(field.trim());
  rows.push(cur);
  return rows.filter(r => r.some(c => c !== ''));
};

// Header normalization and mapping to canonical keys
const canonicalKeys = [
  'no','act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun'
] as const;

const normalizeHeader = (s: string) => s
  .replace(/\uFEFF/g, '')
  .replace(/["']/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')
  .trim();

const headerAliases: Record<string, typeof canonicalKeys[number]> = {
  no: 'no',
  nomor: 'no',
  index: 'no',
  acttype: 'act_type',
  aircrafttype: 'act_type',
  aircraft: 'act_type',
  regno: 'reg_no',
  registration: 'reg_no',
  opr: 'opr',
  operator: 'opr',
  flightnumberorigin: 'flight_number_origin',
  flightnoorigin: 'flight_number_origin',
  fnorigin: 'flight_number_origin',
  flightnumberdest: 'flight_number_dest',
  flightnodest: 'flight_number_dest',
  fndest: 'flight_number_dest',
  ata: 'ata',
  blockon: 'block_on',
  blockoff: 'block_off',
  atd: 'atd',
  groundtime: 'ground_time',
  org: 'org',
  origin: 'org',
  des: 'des',
  dest: 'des',
  destination: 'des',
  ps: 'ps',
  runway: 'runway',
  avioa: 'avio_a',
  aviod: 'avio_d',
  fstat: 'f_stat',
  status: 'f_stat',
  bulan: 'bulan',
  month: 'bulan',
  tahun: 'tahun',
  year: 'tahun',
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const csvFile = form.get('csvFile') as File | null;

    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e) { console.error('prisma:error count()', e); return 0; }
    };
    const safeExec = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch (e) { console.error('prisma:error exec()', e); return null; }
    };

    if (!csvFile) {
      return NextResponse.json(
        { success: false, message: 'File CSV diperlukan' },
        { status: 400 }
      );
    }

    const text = await csvFile.text();
    const pre = text.split(/\r?\n/).map((line) => {
      const trimmed = line.replace(/\s+$/, '');
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        const q = trimmed[0];
        const inner = trimmed.slice(1, -1);
        const undoubled = q === '"' ? inner.replace(/""/g, '"') : inner.replace(/''/g, "'");
        return undoubled;
      }
      return line;
    }).join('\n');
    const rows = parseCsv(pre);
    if (rows.length < 2) {
      return NextResponse.json(
        { success: false, message: 'CSV harus memiliki header dan minimal 1 baris data' },
        { status: 400 }
      );
    }

    const rawHeaders = rows[0];
    const headersNorm = rawHeaders.map(h => normalizeHeader(h));
    const indices: Partial<Record<typeof canonicalKeys[number], number>> = {};
    headersNorm.forEach((h, idx) => {
      const key = headerAliases[h];
      if (key) indices[key] = idx;
    });

    type Row = Record<string, string | null>;
    const inputRows: Row[] = [];

    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i];
      if (!raw) continue;

      // Attempt to fix unquoted comma in ground_time (e.g. 1 day, 08:21:00)
      const gtIdx = indices.ground_time ?? headersNorm.indexOf('groundtime');
      const adj = raw.slice();
      if (gtIdx >= 0 && adj.length > rawHeaders.length) {
        while (adj.length > rawHeaders.length && gtIdx + 1 < adj.length) {
          adj[gtIdx] = `${(adj[gtIdx] ?? '').toString().trim()}${adj[gtIdx] !== undefined ? ', ' : ','}${(adj[gtIdx + 1] ?? '').toString().trim()}`;
          adj.splice(gtIdx + 1, 1);
        }
      }

      const row: Row = {};
      for (const key of canonicalKeys) {
        const idx = indices[key as typeof canonicalKeys[number]];
        const val = idx !== undefined ? (adj[idx] ?? '') as string : '';
        row[key as string] = val.replace(/\uFEFF/g, '') || null;
      }

      // Normalize 'no' to keep digits only (e.g., "1." or "1#" => "1")
      if (row.no) {
        const cleaned = String(row.no).replace(/[^0-9]/g, '').trim();
        row.no = cleaned || null;
      }

      row.bulan = normalizeMonth(toNullIfPlaceholder(row.bulan));
      row.tahun = normalizeYear(toNullIfPlaceholder(row.tahun));
      if (!row.block_on || toNullIfPlaceholder(row.block_on) === null) row.block_on = '';
      if (!row.block_off || toNullIfPlaceholder(row.block_off) === null) row.block_off = '';

      inputRows.push(row);
    }

    if (!inputRows.length) {
      return NextResponse.json(
        { success: false, message: 'Tidak ada baris valid untuk diimport' },
        { status: 400 }
      );
    }

    const data: TrafficFlightCreate[] = [];
    let idx = 1;
    for (const r of inputRows) {
      let noVal: number | null = null;
      if (r.no) {
        const m = String(r.no).match(/^\d+/);
        if (m) {
          const n = Number.parseInt(m[0], 10);
          noVal = Number.isNaN(n) ? null : n;
        }
      }
      data.push({
        no: noVal ?? idx++,
        act_type: toNullIfPlaceholder(r.act_type),
        reg_no: toNullIfPlaceholder(r.reg_no),
        opr: toNullIfPlaceholder(r.opr),
        flight_number_origin: toNullIfPlaceholder(r.flight_number_origin),
        flight_number_dest: toNullIfPlaceholder(r.flight_number_dest),
        ata: toNullIfPlaceholder(r.ata),
        block_on: (toNullIfPlaceholder(r.block_on) ?? '') as string,
        block_off: (toNullIfPlaceholder(r.block_off) ?? '') as string,
        atd: toNullIfPlaceholder(r.atd),
        ground_time: toNullIfPlaceholder(r.ground_time),
        org: toNullIfPlaceholder(r.org),
        des: toNullIfPlaceholder(r.des),
        ps: toNullIfPlaceholder(r.ps),
        runway: toNullIfPlaceholder(r.runway),
        avio_a: toNullIfPlaceholder(r.avio_a),
        avio_d: toNullIfPlaceholder(r.avio_d),
        f_stat: toNullIfPlaceholder(r.f_stat),
        bulan: toNullIfPlaceholder(r.bulan),
        tahun: toNullIfPlaceholder(r.tahun),
      });
    }

    // Build groups and check existing for confirmation flow
    const groupSet = new Map<string, { bulan: string | null; tahun: string | null }>();
    for (const r of inputRows) {
      const b = r.bulan ?? null;
      const t = r.tahun ?? null;
      groupSet.set(`${b ?? ''}__${t ?? ''}`, { bulan: b, tahun: t });
    }

    // Count existing rows per group
    const conflicts: { bulan: string | null; tahun: string | null; existing: number }[] = [];
    for (const { bulan, tahun } of groupSet.values()) {
      const count = bulan
        ? await safeCount(() => prisma.trafficFlight.count({ where: { tahun: tahun ?? null, OR: [{ bulan }, { bulan: String(Number.parseInt(bulan, 10)) }] } }))
        : await safeCount(() => prisma.trafficFlight.count({ where: { tahun: tahun ?? null, bulan: null } }));
      if (count > 0) conflicts.push({ bulan, tahun, existing: count });
    }

    const url = new URL(request.url);
    const replace = url.searchParams.get('replace') === 'true';
    if (conflicts.length && !replace) {
      return NextResponse.json({ success: false, needsConfirm: true, message: 'Data bulan/tahun sudah ada', conflicts }, { status: 409 });
    }

    // If confirmed, delete old rows per group
    if (conflicts.length && replace) {
      for (const { bulan, tahun } of conflicts) {
        if (bulan) {
          const alt = String(Number.parseInt(bulan, 10));
          await safeExec(() => prisma.trafficFlight.deleteMany({ where: { tahun: tahun ?? null, OR: [{ bulan }, { bulan: alt }] } }));
        } else {
          await safeExec(() => prisma.trafficFlight.deleteMany({ where: { tahun: tahun ?? null, bulan: null } }));
        }
      }
    }

    // Insert in chunks with simple retry to mitigate pool timeouts
    const chunkSize = 500;
    let inserted = 0;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      let tries = 0;
      while (tries < 2) {
        const res = await safeExec(() => prisma.trafficFlight.createMany({ data: chunk, skipDuplicates: false }));
        if (res) { inserted += (res as { count: number }).count ?? 0; break; }
        tries++;
      }
    }
    if (inserted <= 0) {
      return NextResponse.json({ success: false, message: 'Gagal memproses CSV' }, { status: 500 });
    }

    // Renumber ALL rows globally: order by tahun asc, bulan asc, then id asc
    try {
      // Fast global renumber using SQL window function
      await prisma.$executeRawUnsafe(`
        WITH ordered AS (
          SELECT id,
                 row_number() OVER (
                   ORDER BY
                     COALESCE(NULLIF(tahun, ''), '999999')::int,
                     COALESCE(NULLIF(bulan, ''), '99')::int,
                     id
                 ) AS rn
          FROM "traffic_flight"
        )
        UPDATE "traffic_flight" t
        SET "no" = o.rn
        FROM ordered o
        WHERE t.id = o.id;
      `);
    } catch (e) {
      console.error('prisma:error renumber (raw)', e);
      try {
        // Fallback: slower chunked renumber via Prisma
        const all = await prisma.trafficFlight.findMany({ select: { id: true, bulan: true, tahun: true }, orderBy: [{ tahun: 'asc' }, { bulan: 'asc' }, { id: 'asc' }] });
        const toNum = (v: string | null | undefined) => {
          const n = Number.parseInt(String(v ?? ''), 10);
          return Number.isFinite(n) && !Number.isNaN(n) ? n : Number.MAX_SAFE_INTEGER;
        };
        const sorted = all.sort((a, b) => {
          const ty = toNum(a.tahun) - toNum(b.tahun);
          if (ty !== 0) return ty;
          const tm = toNum(a.bulan) - toNum(b.bulan);
          if (tm !== 0) return tm;
          return Number(a.id) - Number(b.id);
        });
        const batchSize = 200;
        for (let i = 0; i < sorted.length; i += batchSize) {
          const chunk = sorted.slice(i, i + batchSize);
          await prisma.$transaction(
            chunk.map((row, idx2) => prisma.trafficFlight.update({ where: { id: row.id as unknown as bigint }, data: { no: i + idx2 + 1 } }))
          );
        }
      } catch (e2) {
        console.error('prisma:error renumber (fallback)', e2);
      }
    }

    return NextResponse.json({ success: true, message: `Berhasil import ${inserted} baris`, count: inserted }, { status: 201 });
  } catch (error) {
    console.error('Error processing CSV:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses CSV', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const data = await prisma.trafficFlight.findMany({ orderBy: { id: 'desc' } });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching traffic flight data:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil data traffic flight', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

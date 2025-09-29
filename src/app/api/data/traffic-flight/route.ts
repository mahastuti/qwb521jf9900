import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type SortOrder = 'asc' | 'desc';

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
  no: 'no', nomor: 'no', index: 'no',
  acttype: 'act_type', aircrafttype: 'act_type', aircraft: 'act_type',
  regno: 'reg_no', registration: 'reg_no',
  opr: 'opr', operator: 'opr',
  flightnumberorigin: 'flight_number_origin', flightnoorigin: 'flight_number_origin', fnorigin: 'flight_number_origin',
  flightnumberdest: 'flight_number_dest', flightnodest: 'flight_number_dest', fndest: 'flight_number_dest',
  ata: 'ata',
  blockon: 'block_on', blockoff: 'block_off',
  atd: 'atd',
  groundtime: 'ground_time',
  org: 'org', origin: 'org',
  des: 'des', dest: 'des', destination: 'des',
  ps: 'ps', runway: 'runway',
  avioa: 'avio_a', aviod: 'avio_d',
  fstat: 'f_stat', status: 'f_stat',
  bulan: 'bulan', month: 'bulan',
  tahun: 'tahun', year: 'tahun',
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const csvFile = form.get('csvFile') as File | null;

    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e) { console.error('prisma:error count()', e); return 0; }
    };

    if (!csvFile) {
      return NextResponse.json({ success: false, message: 'File CSV diperlukan' }, { status: 400 });
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
      return NextResponse.json({ success: false, message: 'CSV harus memiliki header dan minimal 1 baris data' }, { status: 400 });
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

      const gtIdx = indices.ground_time ?? headersNorm.indexOf('groundtime');
      const adj = raw.slice();
      if (gtIdx >= 0 && adj.length > rawHeaders.length) {
        while (adj.length > rawHeaders.length && gtIdx + 1 < adj.length) {
          adj[gtIdx] = `${(adj[gtIdx] ?? '').toString().trim()}${(adj[gtIdx] !== undefined ? ', ' : ',')}${(adj[gtIdx + 1] ?? '').toString().trim()}`;
          adj.splice(gtIdx + 1, 1);
        }
      }

      const row: Row = {};
      for (const key of canonicalKeys) {
        const idx = indices[key as typeof canonicalKeys[number]];
        const val = idx !== undefined ? (adj[idx] ?? '') as string : '';
        row[key as string] = val.replace(/\uFEFF/g, '') || null;
      }

      // Normalize 'no' to remove any dots (e.g., "1." => "1")
      if (row.no) {
        const cleaned = String(row.no).replace(/\./g, '').trim();
        row.no = cleaned || null;
      }

      row.bulan = normalizeMonth(row.bulan);
      row.tahun = normalizeYear(row.tahun);
      if (!row.block_on) row.block_on = '';
      if (!row.block_off) row.block_off = '';

      inputRows.push(row);
    }

    if (!inputRows.length) {
      return NextResponse.json({ success: false, message: 'Tidak ada baris valid untuk diimport' }, { status: 400 });
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
        act_type: r.act_type ?? null,
        reg_no: r.reg_no ?? null,
        opr: r.opr ?? null,
        flight_number_origin: r.flight_number_origin ?? null,
        flight_number_dest: r.flight_number_dest ?? null,
        ata: r.ata ?? null,
        block_on: (r.block_on ?? '') as string,
        block_off: (r.block_off ?? '') as string,
        atd: r.atd ?? null,
        ground_time: r.ground_time ?? null,
        org: r.org ?? null,
        des: r.des ?? null,
        ps: r.ps ?? null,
        runway: r.runway ?? null,
        avio_a: r.avio_a ?? null,
        avio_d: r.avio_d ?? null,
        f_stat: r.f_stat ?? null,
        bulan: r.bulan ?? null,
        tahun: r.tahun ?? null,
      });
    }

    // Build groups and check existing for confirmation flow
    const groupSet = new Map<string, { bulan: string | null; tahun: string | null }>();
    for (const r of inputRows) {
      const b = r.bulan ?? null;
      const t = r.tahun ?? null;
      groupSet.set(`${b ?? ''}__${t ?? ''}`, { bulan: b, tahun: t });
    }
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

    if (conflicts.length && replace) {
      for (const { bulan, tahun } of conflicts) {
        if (bulan) {
          const alt = String(Number.parseInt(bulan, 10));
          await prisma.trafficFlight.deleteMany({ where: { tahun: tahun ?? null, OR: [{ bulan }, { bulan: alt }] } });
        } else {
          await prisma.trafficFlight.deleteMany({ where: { tahun: tahun ?? null, bulan: null } });
        }
      }
    }

    const result = await prisma.trafficFlight.createMany({ data, skipDuplicates: false });

    const all = await prisma.trafficFlight.findMany({ select: { id: true, bulan: true, tahun: true }, orderBy: { id: 'asc' } });
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

    return NextResponse.json({ success: true, message: `Berhasil import ${result.count} baris`, count: result.count }, { status: 201 });
  } catch (error) {
    console.error('Error processing CSV:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses CSV', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const search = searchParams.get('search') || '';
    const bulanFilter = (searchParams.get('bulan') || '').trim();
    const tahunFilter = (searchParams.get('tahun') || '').trim();
    const skipCounts = searchParams.get('skipCounts') === '1';

    const sortOrderParam: SortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
    const sortByParam = (searchParams.get('sortBy') || 'id').trim();
    const cursorParam = searchParams.get('cursor');
    const cursorId = cursorParam && /^\d+$/.test(cursorParam) ? BigInt(cursorParam) : null;

    const allowed: Array<keyof Prisma.TrafficFlightOrderByWithRelationInput> = ['id','no','bulan','tahun'];
    const sortKey = (allowed as string[]).includes(sortByParam) ? sortByParam as 'id' | 'no' | 'bulan' | 'tahun' : 'id';
    const orderBy: Prisma.TrafficFlightOrderByWithRelationInput = { [sortKey]: sortOrderParam } as Prisma.TrafficFlightOrderByWithRelationInput;

    const orFilters: Record<string, unknown>[] = [];
    if (search) {
      const s = search;
      const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
      for (const k of ['act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat','bulan','tahun']) {
        orFilters.push(like(k));
      }
      if (/^\d+$/.test(s)) {
        const asInt = Number.parseInt(s, 10);
        if (!Number.isNaN(asInt)) orFilters.push({ no: asInt });
        try { orFilters.push({ id: BigInt(s) }); } catch {}
      }
    }

    const andConds: Prisma.TrafficFlightWhereInput[] = [];
    if (search && orFilters.length) andConds.push({ OR: orFilters as unknown as Prisma.TrafficFlightWhereInput[] } as unknown as Prisma.TrafficFlightWhereInput);
    if (tahunFilter) andConds.push({ tahun: tahunFilter });
    if (bulanFilter) {
      const bulanAlt = String(Number.parseInt(bulanFilter, 10));
      andConds.push({ OR: [{ bulan: bulanFilter }, { bulan: bulanAlt }] });
    }
    const where: Prisma.TrafficFlightWhereInput = andConds.length ? { AND: andConds } : {};

    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e) { console.error('prisma:error count()', e); return 0; }
    };

    const safeFind = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (e) { console.error('prisma:error find()', e); return fallback; }
    };

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit, total: 0, pages: 0 }, pageInfo: { limit, hasMore: false, nextCursor: null }, filters: { months: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), years: [] } });
    }

    const items = await safeFind(() => prisma.trafficFlight.findMany({
      where,
      orderBy,
      select: {
        id: true,
        no: true,
        act_type: true,
        reg_no: true,
        opr: true,
        flight_number_origin: true,
        flight_number_dest: true,
        ata: true,
        block_on: true,
        block_off: true,
        atd: true,
        ground_time: true,
        org: true,
        des: true,
        ps: true,
        runway: true,
        avio_a: true,
        avio_d: true,
        f_stat: true,
        bulan: true,
        tahun: true,
      },
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
    }), [] as Awaited<ReturnType<typeof prisma.trafficFlight.findMany>>);
    const hasMore = items.length > limit;
    const rows = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? String(rows[rows.length - 1].id) : null;

    const distinct = await safeFind(() => prisma.trafficFlight.groupBy({ by: ['bulan','tahun'] }), [] as Awaited<ReturnType<typeof prisma.trafficFlight.groupBy>>);

    const total = skipCounts ? 0 : await safeCount(() => prisma.trafficFlight.count({ where }));
    const totalAll = await safeCount(() => prisma.trafficFlight.count());

    const monthsSet = new Set<string>();
    const yearsSet = new Set<string>();
    for (const r of distinct) {
      if (r.bulan) monthsSet.add(String(r.bulan).padStart(2, '0'));
      if (r.tahun) yearsSet.add(String(r.tahun));
    }
    const months = Array.from(monthsSet).sort((a, b) => Number(a) - Number(b));
    const years = Array.from(yearsSet).sort((a, b) => Number(a) - Number(b));

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
        return out;
      }
      return value;
    };

    return NextResponse.json({
      success: true,
      data: serialize(rows),
      pagination: { page: 1, limit, total, totalAll, pages: Math.ceil((total || 0) / Math.max(1, limit)) },
      pageInfo: { limit, hasMore, nextCursor },
      filters: { months, years }
    });
  } catch (error) {
    console.error('Error fetching traffic flight data:', error);
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 }, pageInfo: { limit: 10, hasMore: false, nextCursor: null }, filters: { months: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), years: [] } });
    }
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil data traffic flight', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID diperlukan' }, { status: 400 });
    await prisma.trafficFlight.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true, message: 'Data berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting traffic flight:', error);
    return NextResponse.json({ success: false, message: 'Gagal menghapus data' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID diperlukan' }, { status: 400 });
    const body = await request.json();
    const b = body as Record<string, unknown>;

    const toStr = (k: string) => (b[k] === '' || b[k] === undefined) ? null : String(b[k]);
    const data: Record<string, unknown> = {};
    if ('no' in b) {
      const n = String(b.no).trim();
      data.no = n ? Number.parseInt(n, 10) : null;
    }
    for (const k of ['act_type','reg_no','opr','flight_number_origin','flight_number_dest','ata','block_on','block_off','atd','ground_time','org','des','ps','runway','avio_a','avio_d','f_stat'] as const) {
      if (k in b) data[k] = toStr(k);
    }
    if ('bulan' in b) data.bulan = normalizeMonth(toStr('bulan'));
    if ('tahun' in b) data.tahun = normalizeYear(toStr('tahun'));

    const updated = await prisma.trafficFlight.update({ where: { id: BigInt(id) }, data: data as Prisma.TrafficFlightUpdateInput });

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
        return out;
      }
      return value;
    };

    return NextResponse.json({ success: true, data: serialize(updated) });
  } catch (error) {
    console.error('Error updating traffic flight:', error);
    return NextResponse.json({ success: false, message: 'Gagal memperbarui data' }, { status: 500 });
  }
}

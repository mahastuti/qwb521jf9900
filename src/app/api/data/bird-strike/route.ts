import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type SortOrder = 'asc' | 'desc';

type BirdStrikeUpdate = Partial<{
  tanggal: Date | null;
  jam: Date | null;
  waktu: string | null;
  fase: string | null;
  lokasi_perimeter: string | null;
  kategori_kejadian: string | null;
  remark: string | null;
  airline: string | null;
  runway_use: string | null;
  komponen_pesawat: string | null;
  dampak_pada_pesawat: string | null;
  kondisi_kerusakan: string | null;
  tindakan_perbaikan: string | null;
  sumber_informasi: string | null;
  deskripsi: string | null;
  dokumentasi: string | null;
  jenis_pesawat: string | null;
  titik: string | null;
}>;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const search = searchParams.get('search') || '';
    const showDeleted = searchParams.get('showDeleted') === 'true';
    const sTrim = search.trim();
    const doSearch = sTrim.length >= 2;

    const safeCount = async (fn: () => Promise<number>) => {
      try { return await fn(); } catch (e) { console.error('prisma:error count()', e); return 0; }
    };
    const safeFind = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch (e) { console.error('prisma:error find()', e); return fallback; }
    };

    const sortOrder: SortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
    const cursorParam = searchParams.get('cursor');
    const cursorId = cursorParam && /^\d+$/.test(cursorParam) ? BigInt(cursorParam) : null;

    const orderBy: Record<string, SortOrder> = { id: sortOrder };

    const orFilters: Record<string, unknown>[] = [];
    if (doSearch) {
      const s = sTrim;
      const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
      for (const k of [
        'waktu','fase','lokasi_perimeter','titik','kategori_kejadian','remark','airline','runway_use','komponen_pesawat','dampak_pada_pesawat','kondisi_kerusakan','tindakan_perbaikan','sumber_informasi','deskripsi','dokumentasi','jenis_pesawat'
      ]) {
        orFilters.push(like(k));
      }
      if (/^\d+$/.test(s)) {
        try { orFilters.push({ id: BigInt(s) }); } catch {}
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) orFilters.push({ tanggal: d });
      }
      if (/^\d{2}:\d{2}$/.test(s)) {
        const t = new Date(`1970-01-01T${s}:00.000Z`);
        if (!Number.isNaN(t.getTime())) orFilters.push({ jam: t });
      }
    }

    const where = {
      deletedAt: showDeleted ? { not: null } : null,
      ...(doSearch && { OR: orFilters })
    };

    const total = 0;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page: 1, limit, total: 0, pages: 0 },
        pageInfo: { limit, hasMore: false, nextCursor: null }
      });
    }

    const items = await safeFind(() => prisma.birdStrike.findMany({
      where,
      orderBy,
      select: {
        id: true,
        tanggal: true,
        jam: true,
        waktu: true,
        fase: true,
        lokasi_perimeter: true,
        titik: true,
        kategori_kejadian: true,
        remark: true,
        airline: true,
        runway_use: true,
        komponen_pesawat: true,
        dampak_pada_pesawat: true,
        kondisi_kerusakan: true,
        tindakan_perbaikan: true,
        sumber_informasi: true,
        deskripsi: true,
        dokumentasi: true,
        jenis_pesawat: true,
        deletedAt: true,
      },
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
    }), [] as Awaited<ReturnType<typeof prisma.birdStrike.findMany>>);
    let hasMore = items.length > limit;
    let rows = hasMore ? items.slice(0, limit) : items;
    let nextCursor = hasMore ? String(rows[rows.length - 1].id) : null;

    // CSV fallback when DB has no rows
    if (rows.length === 0) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const files = ['d1.csv','d2.csv'];
        const base = path.join(process.cwd(), 'src', 'scripts');
        const out: any[] = [];
        const parseCsv = (input: string): string[][] => {
          const rows: string[][] = [];
          let cur: string[] = [];
          let field = '';
          let i = 0;
          let inQuotes = false;
          let quote: '"' | "'" | null = null;
          while (i < input.length) {
            const ch = input[i];
            if (inQuotes) {
              if (ch === quote) {
                if (input[i + 1] === quote) { field += quote; i += 2; continue; }
                inQuotes = false; quote = null; i++; continue;
              }
              field += ch; i++; continue;
            } else {
              if (ch === '"' || ch === "'") { inQuotes = true; quote = ch as '"' | "'"; i++; continue; }
              if (ch === ',') { cur.push(field); field = ''; i++; continue; }
              if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
              if (ch === '\r') { i++; continue; }
              field += ch; i++;
            }
          }
          cur.push(field);
          rows.push(cur);
          return rows.filter(r => r.some(c => c !== ''));
        };
        for (const f of files) {
          const fp = path.join(base, f);
          if (!fs.existsSync(fp)) continue;
          const text = fs.readFileSync(fp, 'utf8');
          const table = parseCsv(text);
          if (table.length < 2) continue;
          const header = table[0];
          const idx = (k: string) => header.indexOf(k);
          for (let i = 1; i < table.length && out.length < limit; i++) {
            const cols = table[i];
            out.push({
              id: `${f}-${i}`,
              tanggal: cols[idx('tanggal')] ?? null,
              jam: cols[idx('jam')] ?? null,
              waktu: cols[idx('waktu')] ?? null,
              fase: cols[idx('fase')] ?? null,
              lokasi_perimeter: cols[idx('lokasi_perimeter')] ?? null,
              titik: cols[idx('titik')] ?? null,
              kategori_kejadian: cols[idx('kategori_kejadian')] ?? null,
              remark: cols[idx('remark')] ?? null,
              airline: cols[idx('airline')] ?? null,
              runway_use: cols[idx('runway_use')] ?? null,
              komponen_pesawat: cols[idx('komponen_pesawat')] ?? null,
              dampak_pada_pesawat: cols[idx('dampak_pada_pesawat')] ?? null,
              kondisi_kerusakan: cols[idx('kondisi_kerusakan')] ?? null,
              tindakan_perbaikan: cols[idx('tindakan_perbaikan')] ?? null,
              sumber_informasi: cols[idx('sumber_informasi')] ?? null,
              deskripsi: cols[idx('deskripsi')] ?? null,
              dokumentasi: cols[idx('dokumentasi')] ?? null,
              jenis_pesawat: cols[idx('jenis_pesawat')] ?? null,
              deletedAt: null,
            });
          }
          if (out.length >= limit) break;
        }
        rows = out;
        hasMore = out.length >= limit;
        nextCursor = null;
      } catch (e) {
        console.warn('bird-strike CSV fallback failed:', e);
      }
    }

    const DOC_BASE = 'https://odjhvlqvbnqrjlowjywq.supabase.co/storage/v1/object/public/bird-strike/';
    const ymdLocal = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    };

    const enriched: typeof rows = rows.map((r) => {
      if ((!r.dokumentasi || r.dokumentasi === '') && r.tanggal) {
        const dRaw = r.tanggal as unknown as (Date | string);
        const d = dRaw instanceof Date ? dRaw : new Date(String(dRaw));
        if (!Number.isNaN(d.getTime())) {
          const url = `${DOC_BASE}${ymdLocal(d)}.png`;
          return { ...r, dokumentasi: url };
        }
      }
      return r as typeof rows[number];
    });

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) { out[k] = serialize(v); } return out; }
      return value;
    };

    const totalAll = 0;
    return NextResponse.json({
      success: true,
      data: serialize(enriched),
      pagination: { page: 1, limit, total, totalAll, pages: Math.ceil(total / Math.max(1, limit)) },
      pageInfo: { limit, hasMore, nextCursor }
    });
  } catch (error) {
    console.error('Error fetching bird strike data:', error);
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 }, pageInfo: { limit: 10, hasMore: false, nextCursor: null } });
    }
    return NextResponse.json(
      { success: false, message: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'ID is required' },
        { status: 400 }
      );
    }

    await prisma.birdStrike.update({
      where: { id: BigInt(id) },
      data: { deletedAt: new Date() }
    });

    return NextResponse.json({
      success: true,
      message: 'Data berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting bird strike data:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete data' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const action = searchParams.get('action');

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'ID is required' },
        { status: 400 }
      );
    }

    if (action === 'restore') {
      await prisma.birdStrike.update({
        where: { id: BigInt(id) },
        data: { deletedAt: null }
      });

      return NextResponse.json({
        success: true,
        message: 'Data berhasil dipulihkan'
      });
    }

    return NextResponse.json(
      { success: false, message: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error restoring bird strike data:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to restore data' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: 'ID is required' }, { status: 400 });
    }
    const body = await request.json();
    const b = body as Record<string, unknown>;

    const data: BirdStrikeUpdate = {};
    if ('tanggal' in b) data.tanggal = b.tanggal ? new Date(String(b.tanggal)) : null;
    if ('jam' in b) data.jam = b.jam ? new Date(`1970-01-01T${String(b.jam)}:00.000Z`) : null;
    if ('waktu' in b) data.waktu = b.waktu as string | null;
    if ('fase' in b) data.fase = b.fase as string | null;
    if ('lokasi_perimeter' in b) data.lokasi_perimeter = b.lokasi_perimeter as string | null;
    if ('kategori_kejadian' in b) data.kategori_kejadian = b.kategori_kejadian as string | null;
    if ('remark' in b) data.remark = b.remark as string | null;
    if ('airline' in b) data.airline = b.airline as string | null;
    if ('runway_use' in b) data.runway_use = b.runway_use as string | null;
    if ('komponen_pesawat' in b) data.komponen_pesawat = b.komponen_pesawat as string | null;
    if ('dampak_pada_pesawat' in b) data.dampak_pada_pesawat = b.dampak_pada_pesawat as string | null;
    if ('kondisi_kerusakan' in b) data.kondisi_kerusakan = b.kondisi_kerusakan as string | null;
    if ('tindakan_perbaikan' in b) data.tindakan_perbaikan = b.tindakan_perbaikan as string | null;
    if ('sumber_informasi' in b) data.sumber_informasi = b.sumber_informasi as string | null;
    if ('deskripsi' in b) data.deskripsi = b.deskripsi as string | null;
    if ('dokumentasi' in b) data.dokumentasi = (b as Record<string, unknown>).dokumentasi as string | null ?? null;
    if ('jenis_pesawat' in b) data.jenis_pesawat = b.jenis_pesawat as string | null;
    if ('titik' in b) data.titik = b.titik as string | null;

    // If dokumentasi is being cleared or not provided, set default URL from tanggal
    if ((!('dokumentasi' in b) || data.dokumentasi === null) && ('tanggal' in b) && data.tanggal) {
      const d = data.tanggal as Date;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      data.dokumentasi = `https://odjhvlqvbnqrjlowjywq.supabase.co/storage/v1/object/public/bird-strike/${y}${m}${da}.png`;
    }

    const updated = await prisma.birdStrike.update({ where: { id: BigInt(id) }, data });

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
    console.error('Error updating bird strike:', error);
    return NextResponse.json({ success: false, message: 'Failed to update data' }, { status: 500 });
  }
}

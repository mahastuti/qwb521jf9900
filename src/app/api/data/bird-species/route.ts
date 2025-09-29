import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type SortOrder = 'asc' | 'desc';

type BurungBioUpdate = Partial<{
  longitude: string | null;
  latitude: string | null;
  lokasi: string | null;
  titik: string | null;
  tanggal: Date | null;
  jam: Date | null;
  waktu: string | null;
  cuaca: string | null;
  jenis_burung: string | null;
  nama_ilmiah: string | null;
  jumlah_burung: number | null;
  keterangan: string | null;
  dokumentasi: string | null;
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

    const orderByClause: Prisma.burung_bioOrderByWithRelationInput | Prisma.burung_bioOrderByWithRelationInput[] = showDeleted ? ([{ deletedAt: 'desc' }, { id: 'desc' }]) : ({ id: sortOrder });

    const orFilters: Record<string, unknown>[] = [];
    if (doSearch) {
      const s = sTrim;
      const like = (key: string) => ({ [key]: { contains: s, mode: 'insensitive' as const } });
      for (const k of ['longitude','latitude','lokasi','titik','waktu','cuaca','jenis_burung','nama_ilmiah','keterangan','dokumentasi']) {
        orFilters.push(like(k));
      }
      const asInt = Number.parseInt(s, 10);
      if (!Number.isNaN(asInt)) {
        orFilters.push({ jumlah_burung: asInt });
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
      return NextResponse.json({ success: true, data: [], pagination: { page: 1, limit, total: 0, pages: 0 }, pageInfo: { limit, hasMore: false, nextCursor: null } });
    }

    const items = await safeFind(() => prisma.burung_bio.findMany({
      where,
      orderBy: orderByClause,
      select: {
        id: true,
        longitude: true,
        latitude: true,
        lokasi: true,
        titik: true,
        tanggal: true,
        jam: true,
        waktu: true,
        cuaca: true,
        jenis_burung: true,
        nama_ilmiah: true,
        jumlah_burung: true,
        keterangan: true,
        dokumentasi: true,
        deletedAt: true,
      },
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
    }), [] as Awaited<ReturnType<typeof prisma.burung_bio.findMany>>);

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? String(data[data.length - 1].id) : null;

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = serialize(v);
        }
        return out;
      }
      return value;
    };

    const waktuFromHour = (hour: number): string => {
      if (hour >= 0 && hour <= 3) return 'Dini Hari';
      if (hour > 3 && hour <= 8) return 'Pagi';
      if (hour > 8 && hour <= 13) return 'Siang';
      if (hour > 13 && hour <= 18) return 'Sore';
      return 'Malam';
    };

    const enriched = data.map((r) => {
      if (!r.waktu && r.jam) {
        const hour = (r.jam as Date).getUTCHours();
        return { ...r, waktu: waktuFromHour(hour) } as typeof r;
      }
      return r;
    });

    const safeData = serialize(enriched);

    const totalAll = 0;
    return NextResponse.json({
      success: true,
      data: safeData,
      pagination: { page: 1, limit, total, totalAll, pages: Math.ceil(total / Math.max(1, limit)) },
      pageInfo: { limit, hasMore, nextCursor }
    });
  } catch (error) {
    console.error('Error fetching bird species data:', error);
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

    await prisma.burung_bio.update({
      where: { id: BigInt(id) },
      data: { deletedAt: new Date() }
    });

    return NextResponse.json({
      success: true,
      message: 'Data berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting bird species data:', error);
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
      await prisma.burung_bio.update({
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
    console.error('Error restoring bird species data:', error);
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

    const mapWaktu = (time: string | null | undefined): string | null => {
      if (!time) return null;
      const hour = Number(String(time).split(':')[0]);
      if (hour >= 0 && hour <= 3) return 'Dini Hari';
      if (hour >= 3 && hour <= 8) return 'Pagi';
      if (hour >= 8 && hour <= 13) return 'Siang';
      if (hour >= 13 && hour <= 18) return 'Sore';
      return 'Malam';
    };

    const data: BurungBioUpdate = {};
    if ('longitude' in b) data.longitude = b.longitude as string | null;
    if ('latitude' in b) data.latitude = b.latitude as string | null;
    if ('lokasi' in b) data.lokasi = b.lokasi as string | null;
    if ('titik' in b) data.titik = b.titik as string | null;
    if ('tanggal' in b) data.tanggal = b.tanggal ? new Date(String(b.tanggal)) : null;
    if ('jam' in b) data.jam = b.jam ? new Date(`1970-01-01T${String(b.jam)}:00.000Z`) : null;
    if ('waktu' in b || 'jam' in b) data.waktu = (b as Record<string, unknown>).waktu as string | null ?? mapWaktu(b.jam as string | null | undefined);
    if ('cuaca' in b) data.cuaca = b.cuaca as string | null;
    if ('jenis_burung' in b) data.jenis_burung = b.jenis_burung as string | null;
    if ('nama_ilmiah' in b) data.nama_ilmiah = b.nama_ilmiah as string | null;
    if ('jumlah_burung' in b) {
      const v = (b as Record<string, unknown>).jumlah_burung;
      data.jumlah_burung = v !== undefined && v !== null ? parseInt(String(v), 10) : null;
    }
    if ('keterangan' in b) data.keterangan = b.keterangan as string | null;
    if ('dokumentasi' in b) data.dokumentasi = (b as Record<string, unknown>).dokumentasi as string | null ?? null;

    const updated = await prisma.burung_bio.update({ where: { id: BigInt(id) }, data });

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
    console.error('Error updating bird species:', error);
    return NextResponse.json({ success: false, message: 'Failed to update data' }, { status: 500 });
  }
}

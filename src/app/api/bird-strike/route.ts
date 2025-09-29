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

export async function POST(request: NextRequest) {
  try {
    const ct = request.headers.get('content-type') || '';

    const normalizeSpaces = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const toTitleCaseWords = (s: string | null | undefined) => normalizeSpaces(String(s)).toLowerCase().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');

    let payload: Record<string, unknown> = {};
    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData();
      fd.forEach((v, k) => { if (typeof v === 'string') payload[k] = v; });
    } else if (ct.includes('application/json')) {
      payload = await request.json();
    } else {
      try { payload = await request.json(); } catch { const fd = await request.formData(); fd.forEach((v, k) => { if (typeof v === 'string') payload[k] = v; }); }
    }

    const mapWaktu = (time: string | null | undefined): string | null => {
      if (!time) return null;
      const hour = Number(String(time).split(':')[0]);
      if (hour >= 0 && hour <= 3) return 'Dini Hari';
      if (hour <= 8) return 'Pagi';
      if (hour <= 13) return 'Siang';
      if (hour <= 18) return 'Sore';
      return 'Malam';
    };

    const outPhases = new Set(['Approach','Final','Short Final']);
    const inPhases = new Set(['Landing','Take Off','Take-Off']);
    const fase = String(payload.fase ?? '').trim();
    const lokasi_perimeter = payload.lokasi_perimeter ? String(payload.lokasi_perimeter) : (outPhases.has(fase) ? 'Out' : inPhases.has(fase) ? 'In' : null);

    const rawDoc = (payload as Record<string, unknown>)['dokumentasi'];
    const dokumentasi: string | null = typeof rawDoc === 'string' ? rawDoc : null;

    let created = await prisma.birdStrike.create({
      data: {
        tanggal: payload.tanggal ? new Date(String(payload.tanggal)) : null,
        jam: payload.jam ? new Date(`1970-01-01T${String(payload.jam)}:00.000Z`) : null,
        waktu: payload.waktu ? String(payload.waktu) : mapWaktu(String(payload.jam || '')),
        fase: fase || null,
        lokasi_perimeter,
        kategori_kejadian: payload.kategori_kejadian ? String(payload.kategori_kejadian) : null,
        remark: payload.remark ? String(payload.remark) : null,
        airline: toTitleCaseWords(String(payload.airline ?? '')) || null,
        runway_use: payload.runway_use ? String(payload.runway_use) : null,
        komponen_pesawat: toTitleCaseWords(String(payload.komponen_pesawat ?? '')) || null,
        dampak_pada_pesawat: payload.dampak_pada_pesawat ? String(payload.dampak_pada_pesawat) : null,
        kondisi_kerusakan: payload.kondisi_kerusakan ? String(payload.kondisi_kerusakan) : null,
        tindakan_perbaikan: payload.tindakan_perbaikan ? String(payload.tindakan_perbaikan) : null,
        sumber_informasi: payload.sumber_informasi ? String(payload.sumber_informasi) : null,
        deskripsi: payload.deskripsi ? String(payload.deskripsi) : null,
        dokumentasi: dokumentasi,
        jenis_pesawat: toTitleCaseWords(String(payload.jenis_pesawat ?? '')) || null,
        titik: payload.titik ? String(payload.titik) : null,
      }
    });

    if ((!dokumentasi || dokumentasi === '') && created.tanggal) {
      const d = created.tanggal as Date;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      const url = `https://odjhvlqvbnqrjlowjywq.supabase.co/storage/v1/object/public/bird-strike/${y}${m}${da}.png`;
      await prisma.birdStrike.update({ where: { id: created.id }, data: { dokumentasi: url } });
      created = { ...created, dokumentasi: url };
    }

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) { out[k] = serialize(v); } return out; }
      return value;
    };

    return NextResponse.json({ success: true, message: 'berhasil input', data: serialize(created) }, { status: 201 });
  } catch (error) {
    console.error('Error creating bird strike:', error);
    return NextResponse.json({ success: false, message: 'Gagal menyimpan data' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);
    const search = searchParams.get('search') || '';
    const showDeleted = searchParams.get('showDeleted') === 'true';

    const sortOrder: SortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc');
    const cursorParam = searchParams.get('cursor');
    const cursorId = cursorParam && /^\d+$/.test(cursorParam) ? BigInt(cursorParam) : null;

    const orderBy: Record<string, SortOrder> = { id: sortOrder };

    const orFilters: Record<string, unknown>[] = [];
    if (search) {
      const s = search;
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
      ...(search && { OR: orFilters })
    };

    const items = await prisma.birdStrike.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
    });
    const hasMore = items.length > limit;
    const rows = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? String(rows[rows.length - 1].id) : null;

    const DOC_BASE = 'https://odjhvlqvbnqrjlowjywq.supabase.co/storage/v1/object/public/bird-strike/';
    const ymdLocal = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    };

    const enriched: typeof rows = rows.map((r) => {
      if ((!r.dokumentasi || r.dokumentasi === '') && r.tanggal) {
        const d = r.tanggal as Date;
        const url = `${DOC_BASE}${ymdLocal(d)}.png`;
        return { ...r, dokumentasi: url };
      }
      return r;
    });

    const serialize = (value: unknown): unknown => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(serialize);
      if (typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) { out[k] = serialize(v); } return out; }
      return value;
    };

    return NextResponse.json({
      success: true,
      data: serialize(enriched),
      pageInfo: { limit, hasMore, nextCursor }
    });
  } catch (error) {
    console.error('Error fetching bird strike data:', error);
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

    try {
      const since = new Date('2025-01-01T00:00:00.000Z');
      const fase = (updated.fase || '').toLowerCase();
      const kategori = (updated.kategori_kejadian || '').toLowerCase();
      const remark = (updated.remark || '').toLowerCase();
      const eligible = (!!updated.tanggal && updated.tanggal >= since) &&
        (kategori.includes('bird strike')) &&
        (remark.includes('terkonfirmasi')) &&
        (fase.includes('landing') || fase.includes('take off') || fase.includes('take-off'));
      if (eligible) {
        const normTitik = (s: string | null | undefined) => {
          if (!s) return null;
          const m = String(s).match(/-?\d+(?:[\.,]\d+)?/);
          if (!m) return null;
          const f = parseFloat(m[0].replace(',', '.'));
          if (!Number.isFinite(f)) return null;
          return Math.round(f);
        };
        const tInt = normTitik(updated.titik || '');
        if (tInt != null) {
          const candidates = [String(updated.titik || ''), String(tInt), `${tInt}.0`, `${tInt}.00`, `${tInt},0`, `${tInt},00`];
          const loc = await prisma.burung_bio.findFirst({ where: { OR: candidates.map(c => ({ titik: c })), longitude: { not: null }, latitude: { not: null } }, orderBy: { tanggal: 'desc' } });
          const hour = updated.jam ? new Date(updated.jam).getUTCHours() : 12;
          const waktu = updated.waktu || (hour !== null ? (hour >= 0 && hour <= 3 ? 'Dini Hari' : hour <= 8 ? 'Pagi' : hour <= 13 ? 'Siang' : hour <= 18 ? 'Sore' : 'Malam') : '');
          let cuaca: string | null = null;
          if (loc && updated.tanggal) {
            try {
              const dateStr = updated.tanggal.toISOString().slice(0, 10);
              const url = new URL('https://archive-api.open-meteo.com/v1/era5');
              url.searchParams.set('latitude', String(parseFloat(String(loc.latitude))));
              url.searchParams.set('longitude', String(parseFloat(String(loc.longitude))));
              url.searchParams.set('start_date', dateStr);
              url.searchParams.set('end_date', dateStr);
              url.searchParams.set('hourly', 'precipitation,cloudcover');
              url.searchParams.set('timezone', 'Asia/Jakarta');
              const res = await fetch(url.toString(), { cache: 'no-store' });
              if (res.ok) {
                const json = await res.json();
                const times: string[] = json?.hourly?.time || [];
                const prec: number[] = json?.hourly?.precipitation || [];
                const cloud: number[] = json?.hourly?.cloudcover || [];
                const idx = times.findIndex((t: string) => t === `${dateStr}T${String(hour).padStart(2,'0')}:00`);
                if (idx >= 0) {
                  const p = Number(prec[idx] ?? 0);
                  const c = Number(cloud[idx] ?? 0);
                  if (p > 0.2) cuaca = 'Hujan'; else if (c >= 70) cuaca = 'Berawan'; else if (c >= 30) cuaca = 'Cerah Berawan'; else cuaca = 'Cerah';
                }
              }
            } catch {}
          }
          const exists = await prisma.model.findFirst({ where: { tanggal: updated.tanggal ?? undefined, titik: BigInt(tInt) } });
          if (!exists) {
            await prisma.model.create({ data: { tanggal: updated.tanggal!, jam: updated.jam ?? null, waktu, cuaca, rata_rata_burung_di_titik_x: null, titik: BigInt(tInt), fase: updated.fase ?? null, strike: '1' } });
          }
        }
      }
    } catch (e) { console.error('Auto-modeling after update error:', e); }

    return NextResponse.json({ success: true, data: serialize(updated) });
  } catch (error) {
    console.error('Error updating bird strike:', error);
    return NextResponse.json({ success: false, message: 'Failed to update data' }, { status: 500 });
  }
}

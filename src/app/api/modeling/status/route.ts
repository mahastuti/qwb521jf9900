import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const candidates = [process.env.MODEL_OUTPUT || 'backend/models/model.pkl', 'backend/models/model.cbm', 'backend/models/model.pkl'];
    for (const p of candidates) {
      try {
        const fp = path.join(process.cwd(), p);
        const st = await fs.stat(fp);
        return NextResponse.json({ success: true, model: { path: p, size: st.size, mtime: st.mtime.toISOString(), ext: path.extname(p).toLowerCase() } });
      } catch (e) {
        // try next
      }
    }
    return NextResponse.json({ success: false, message: 'No model file found' });
  } catch (e) {
    console.error('Error checking model status', e);
    return NextResponse.json({ success: false, message: 'Failed to check model' }, { status: 500 });
  }
}

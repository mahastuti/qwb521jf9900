import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const python = process.env.PYTHON_BIN || 'python3';
    const script = process.env.TRAIN_SCRIPT || 'backend/scripts/train.py';
    const args: string[] = [];
    if (body.output) args.push('--output', String(body.output));
    if (body.limit) args.push('--limit', String(body.limit));

    // Dynamic import to avoid TS child_process overload typing issues
    const { spawn } = await import('child_process');
    const spawnAny = (spawn as unknown) as (...args: any[]) => any;
    const proc = spawnAny(python, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timeoutMs = Number(process.env.ML_TRAIN_TIMEOUT_MS || 120000);

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {};
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer | string) => { stdout += String(d); });
    proc.stderr.on('data', (d: Buffer | string) => { stderr += String(d); });

    // optionally stream provided body into stdin (not strictly required)
    try {
      proc.stdin.write(JSON.stringify(body));
      proc.stdin.end();
    } catch {}

    const code: number = await new Promise<number>((resolve) => proc.on('close', (c: number | null) => resolve(typeof c === 'number' ? c : 1)));
    clearTimeout(timer);

    if (code !== 0) {
      console.error('Train script failed', code, stderr);
      return NextResponse.json({ success: false, message: 'Train script failed', error: stderr }, { status: 500 });
    }

    try {
      const parsed = JSON.parse(stdout);
      return NextResponse.json({ success: true, result: parsed });
    } catch (e) {
      return NextResponse.json({ success: true, output: stdout.trim() });
    }
  } catch (error) {
    console.error('Error in train route', error);
    return NextResponse.json({ success: false, message: 'Failed to trigger training' }, { status: 500 });
  }
}

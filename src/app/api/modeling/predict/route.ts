import { NextRequest, NextResponse } from 'next/server';

async function callExternalService(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // If an external ML service URL is configured, forward the request
    const mlService = process.env.ML_SERVICE_URL;
    if (mlService) {
      try {
        const js = await callExternalService(mlService, body);
        return NextResponse.json({ success: true, result: js });
      } catch (e) {
        console.error('Forward to ML_SERVICE failed', e);
      }
    }

    // Otherwise call local python predict script
    const python = process.env.PYTHON_BIN || 'python3';
    const script = process.env.PREDICT_SCRIPT || 'backend/scripts/predict.py';

    // Dynamic import to avoid TS child_process typing issues
    const { spawn } = await import('child_process');
    const spawnAny = (spawn as unknown) as (...args: any[]) => any;
    const proc = spawnAny(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timeoutMs = Number(process.env.ML_TIMEOUT_MS || 30000);

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {};
    }, timeoutMs);

    // send input
    proc.stdin.write(JSON.stringify(body));
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk); });
    proc.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });

    const exitCode: number = await new Promise<number>((resolve) => {
      proc.on('close', (code: number | null) => resolve(typeof code === 'number' ? code : 1));
    });

    clearTimeout(timer);

    if (exitCode !== 0) {
      console.error('Predict script failed', exitCode, stderr);
      return NextResponse.json({ success: false, message: 'Predict script failed', error: stderr }, { status: 500 });
    }

    try {
      const parsed = JSON.parse(stdout);
      return NextResponse.json({ success: true, result: parsed });
    } catch (e) {
      // If the script returned plain text, return it
      return NextResponse.json({ success: true, result: stdout.trim() });
    }
  } catch (error) {
    console.error('Error in predict route', error);
    return NextResponse.json({ success: false, message: 'Failed to run prediction' }, { status: 500 });
  }
}

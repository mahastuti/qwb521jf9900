"use client";

import { useEffect, useState } from 'react';

export default function PredictSection() {
  const [showPopup, setShowPopup] = useState(false);
  const [predictionResult, setPredictionResult] = useState<string | null>('0.98674');
  const [loadingPredict, setLoadingPredict] = useState(false);
  const [modelInfo, setModelInfo] = useState<{ path?: string; mtime?: string; ext?: string; size?: number } | null>(null);
  type FormState = {
    tanggal: string;
    tahun: string;
    bulan: string;
    jam: string;
    waktu: string;
    cuaca: string;
    jumlahBurung: string;
    titik: string;
    fase: string;
    strike: string;
  };
  const [formData, setFormData] = useState<FormState>({
    tanggal: '',
    tahun: '',
    bulan: '',
    jam: '',
    waktu: '',
    cuaca: '',
    jumlahBurung: '',
    titik: '',
    fase: '',
    strike: ''
  });

  const mapWaktu = (time: string): string => {
    const hour = Number((time || '00:00').split(':')[0]);
    if (hour >= 0 && hour <= 2) return 'Dini Hari';
    if (hour >= 3 && hour <= 5) return 'Subuh';
    if (hour >= 6 && hour <= 11) return 'Pagi';
    if (hour >= 12 && hour <= 15) return 'Siang';
    if (hour >= 16 && hour <= 18) return 'Sore';
    return 'Malam';
  };

  const handleInputChange = (field: keyof FormState, value: string) => {
    setFormData(prev => {
      const next: FormState = { ...prev };
      if (field === 'tanggal') {
        next.tanggal = value;
        if (value) {
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) {
            next.tahun = String(d.getFullYear());
            next.bulan = String(d.getMonth() + 1).padStart(2, '0');
          }
        }
      } else if (field === 'jam') {
        next.jam = value;
        next.waktu = mapWaktu(value);
      } else {
        next[field] = value;
      }
      return next;
    });
  };

  useEffect(() => {
    // fetch model status on mount
    const f = async () => {
      try {
        const res = await fetch('/api/modeling/status');
        const js = await res.json();
        if (js && js.success && js.model) setModelInfo(js.model);
      } catch (e) {
        // ignore
      }
    };
    f();
  }, []);

  const handlePredict = async () => {
    setLoadingPredict(true);
    try {
      const payload = {
        tanggal: formData.tanggal,
        jam: formData.jam,
        waktu: formData.waktu,
        cuaca: formData.cuaca,
        jumlahBurung: formData.jumlahBurung,
        titik: formData.titik,
        fase: formData.fase
      };
      const res = await fetch('/api/modeling/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const js = await res.json();
      if (res.ok && js.success) {
        let out: any = js.result?.predictions ?? js.result ?? js.output ?? null;
        if (Array.isArray(out)) out = out[0];
        const num = typeof out === 'string' && !isNaN(Number(out)) ? Number(out) : typeof out === 'number' ? out : null;
        setPredictionResult(num != null ? num.toFixed(5) : String(out ?? 'N/A'));
        // refresh model info after prediction (in case retrained)
        try {
          const r2 = await fetch('/api/modeling/status');
          const j2 = await r2.json();
          if (j2 && j2.success && j2.model) setModelInfo(j2.model);
        } catch {}
      } else {
        console.error('Predict API error', js);
        setPredictionResult('Error');
      }
    } catch (e) {
      console.error(e);
      setPredictionResult('Error');
    } finally {
      setLoadingPredict(false);
      setShowPopup(true);
    }
  };
  const closePopup = () => setShowPopup(false);

  // Auto-fetch cuaca (Open-Meteo), using default airport coords
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        if (!formData.tanggal || !formData.jam) return;
        const latitude = '-7.3797';
        const longitude = '112.7722';
        const start = formData.tanggal;
        const end = formData.tanggal;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dt = new Date(`${formData.tanggal}T00:00:00`);
        const threeMonthsAgo = new Date(today); threeMonthsAgo.setMonth(today.getMonth() - 3);
        const base = dt < threeMonthsAgo ? 'https://historical-forecast-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
        const url = `${base}?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&hourly=weather_code&timezone=auto&start_date=${start}&end_date=${end}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const hourly = json?.hourly || {};
        const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];
        const codesRaw = Array.isArray(hourly.weather_code) ? hourly.weather_code : Array.isArray(hourly.weathercode) ? hourly.weathercode : [];
        const codes: number[] = codesRaw.map((x: unknown) => Number(x));
        if (!times.length || !codes.length) { setFormData(p => ({ ...p, cuaca: '' })); return; }
        const [hs, ms] = formData.jam.split(':');
        const h = Math.max(0, Math.min(23, Number(hs) || 0));
        const m = Math.max(0, Math.min(59, Number(ms) || 0));
        const hr = Math.min(23, m < 30 ? h : h + 1);
        const hh = String(hr).padStart(2, '0');
        const needle = `${formData.tanggal}T${hh}:00`;
        let idx = times.indexOf(needle);
        if (idx === -1) {
          const dayIdx: number[] = [];
          times.forEach((t: string, i: number) => { if (t.startsWith(`${formData.tanggal}T`)) dayIdx.push(i); });
          if (dayIdx.length) {
            const hours = dayIdx.map(i => Number(times[i].slice(11, 13)) || 0);
            const exact = dayIdx.find((i, k) => hours[k] === hr);
            if (typeof exact === 'number') idx = exact;
            else {
              let best = dayIdx[0];
              let bestDiff = Math.abs((Number(times[best].slice(11, 13)) || 0) - hr);
              for (let k = 1; k < dayIdx.length; k++) {
                const i = dayIdx[k];
                const diff = Math.abs((Number(times[i].slice(11, 13)) || 0) - hr);
                if (diff < bestDiff) { best = i; bestDiff = diff; }
              }
              idx = best;
            }
          }
        }
        const weatherCodeToDesc = (code: number): string => {
          if (code === 0) return 'Langit cerah';
          if ([1, 2, 3].includes(code)) return code === 1 ? 'Sebagian besar cerah' : code === 2 ? 'Berawan sebagian' : 'Mendung';
          if ([45, 48].includes(code)) return code === 45 ? 'Kabut' : 'Kabut es';
          if ([51, 53, 55].includes(code)) return code === 51 ? 'Gerimis ringan' : code === 53 ? 'Gerimis sedang' : 'Gerimis lebat';
          if ([56, 57].includes(code)) return code === 56 ? 'Gerimis membeku ringan' : 'Gerimis membeku lebat';
          if ([61, 63, 65].includes(code)) return code === 61 ? 'Hujan ringan' : code === 63 ? 'Hujan sedang' : 'Hujan lebat';
          if ([66, 67].includes(code)) return code === 66 ? 'Hujan membeku ringan' : 'Hujan membeku lebat';
          if ([71, 73, 75].includes(code)) return code === 71 ? 'Salju ringan' : code === 73 ? 'Salju sedang' : 'Salju lebat';
          if (code === 77) return 'Butiran salju';
          if ([80, 81, 82].includes(code)) return code === 80 ? 'Hujan deras ringan' : code === 81 ? 'Hujan deras sedang' : 'Hujan deras sangat deras';
          if ([85, 86].includes(code)) return code === 85 ? 'Hujan salju ringan' : 'Hujan salju lebat';
          if (code === 95) return 'Badai petir ringan/sedang';
          if ([96, 99].includes(code)) return code === 96 ? 'Badai petir dengan hujan es ringan' : 'Badai petir dengan hujan es lebat';
          return 'Tidak diketahui';
        };
        const code = idx === -1 ? null : codes[idx];
        if (code == null || Number.isNaN(Number(code))) { setFormData(p => ({ ...p, cuaca: '' })); return; }
        const desc = weatherCodeToDesc(Number(code));
        setFormData(p => ({ ...p, cuaca: desc }));
      } catch {
        setFormData(p => ({ ...p, cuaca: '' }));
      }
    };
    fetchWeather();
  }, [formData.tanggal, formData.jam]);


  return (
    <div className="max-w-4xl mx-auto space-y-6 mb-19">
      {/* Prediction Result Section */}
      <div className="bg-white border-2 border-gray-300 rounded-lg p-8">
        <h2 className="text-xl font-medium text-center mb-6">Peluang Burung dari Titik {formData.titik} Menyebabkan Bird Strike Sebesar</h2>
        <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-8 mb-2">
          <div className="text-4xl font-bold text-center mb-2">{predictionResult ?? '—'}</div>
          <div className="text-center text-sm text-gray-600">{modelInfo ? `Model: ${modelInfo.path ?? ''} ${modelInfo.mtime ? `· trained ${new Date(modelInfo.mtime).toLocaleString()}` : ''}` : 'Model: not available'}</div>
        </div>
        <div className="text-center">
          <button
            onClick={handlePredict}
            disabled={loadingPredict}
            className={`px-6 py-2 rounded-lg font-medium transition-colors text-white ${loadingPredict ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}
          >
            {loadingPredict ? 'Memproses...' : 'Prediksi'}
          </button>
        </div>
      </div>

      {/* Input Form Section */}
      <div className="bg-white border-2 border-gray-300 rounded-lg p-6">
        <h3 className="text-lg font-medium text-center mb-6">Input Data Prediksi</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Tanggal</label>
            <input
              type="date"
              value={formData.tanggal}
              onChange={(e) => handleInputChange('tanggal', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Jam</label>
            <input
              type="text"
              value={formData.jam}
              onChange={(e) => handleInputChange('jam', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
              placeholder="14:30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Waktu</label>
            <input
              type="text"
              value={formData.waktu}
              readOnly
              className="w-full p-2 border border-gray-300 rounded-md bg-gray-50"
              placeholder="Auto-generate dari jam"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Cuaca</label>
            <input
              type="text"
              value={formData.cuaca}
              readOnly
              className="w-full p-2 border border-gray-300 rounded-md bg-gray-50"
              placeholder="Auto-generate dari API Open-Meteo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Jumlah Burung pada Titik X</label>
            <input
              type="text"
              value={formData.jumlahBurung}
              onChange={(e) => handleInputChange('jumlahBurung', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
              placeholder="25"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Titik</label>
            <input
              type="text"
              value={formData.titik}
              onChange={(e) => handleInputChange('titik', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
              placeholder="A1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Fase</label>
            <input
              type="text"
              value={formData.fase}
              onChange={(e) => handleInputChange('fase', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
              placeholder="Takeoff"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Strike</label>
            <input
              type="text"
              value={formData.strike}
              onChange={(e) => handleInputChange('strike', e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
              placeholder="Yes/No"
            />
          </div>
        </div>
      </div>

      {/* Popup Modal */}
      {showPopup && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg max-w-md w-full mx-4 text-center">
            <h3 className="text-lg font-medium mb-4">Hasil Prediksi</h3>
            <p className="text-gray-700 mb-6">
              Peluang Burung dari titik {formData.titik} Menyebabkan Bird Strike adalah {predictionResult}
            </p>
            <button
              onClick={closePopup}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

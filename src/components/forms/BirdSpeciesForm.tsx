import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";

interface BirdSpeciesFormData {
  longitude: string;
  latitude: string;
  lokasi: string;
  titik: string;
  tanggal: string;
  jam: string;
  waktu: string;
  cuaca: string;
  jenis_burung: string;
  nama_ilmiah: string;
  jumlah_burung: string;
  keterangan: string;
  dokumentasi: string;
}

type BirdSpeciesFormProps = {
  onSubmit?: (data: BirdSpeciesFormData) => Promise<void>;
  isSubmitting?: boolean;
}

export default function BirdSpeciesForm({ onSubmit, isSubmitting = false }: BirdSpeciesFormProps) {
  const [formData, setFormData] = useState<BirdSpeciesFormData>({
    longitude: '',
    latitude: '',
    lokasi: '',
    titik: '',
    tanggal: '',
    jam: '',
    waktu: '',
    cuaca: '',
    jenis_burung: '',
    nama_ilmiah: '',
    jumlah_burung: '',
    keterangan: '',
    dokumentasi: '',
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dateError, setDateError] = useState<string>('');
  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const today = new Date();
  const maxDateObj = new Date(today);
  maxDateObj.setDate(today.getDate() + 16);
  const maxDate = formatDate(maxDateObj);
  const isWithinFuture16Days = (s: string) => !!s && s <= maxDate;

  // Lokasi yang diizinkan berdasarkan titik (khusus 1-4)
  const getAllowedLokasi = (titik: string): string[] => {
    switch (titik) {
      case '1':
        return ['Dalam', 'Luar Barat'];
      case '2':
        return ['Dalam', 'Luar Timur'];
      case '3':
        return ['Dalam', 'Luar Selatan'];
      case '4':
        return ['Dalam', 'Luar Utara'];
      default:
        return ['Dalam', 'Luar Barat', 'Luar Timur', 'Luar Selatan', 'Luar Utara'];
    }
  };

  // Peta koordinat untuk kombinasi Titik + Lokasi
  const coords: Record<string, { lat: string; lon: string }> = {
    '1|Dalam': { lat: '-7.3753', lon: '112.7703' },
    '2|Dalam': { lat: '-7.3750', lon: '112.7786' },
    '3|Dalam': { lat: '-7.3770', lon: '112.794' },
    '4|Dalam': { lat: '-7.3786', lon: '112.8006' },
    '5|Dalam': { lat: '-7.3786', lon: '112.8006' },
    '6|Dalam': { lat: '-7.3817', lon: '112.7878' },
    '7|Dalam': { lat: '-7.3814', lon: '112.7739' },
    '8|Dalam': { lat: '-7.3797', lon: '112.7722' },
    '1|Luar Barat': { lat: '-7.3753', lon: '112.7703' },
    '2|Luar Timur': { lat: '-7.3839', lon: '112.8097' },
    '3|Luar Selatan': { lat: '-7.3892', lon: '112.7842' },
    '4|Luar Utara': { lat: '-7.3706', lon: '112.7906' },
  };

  const mapWaktu = (time: string): string => {
    if (!time) return '';
    const hour = Number(time.split(':')[0]);
    if (hour >= 0 && hour <= 2) return 'Dini Hari';
    if (hour >= 3 && hour <= 5) return 'Subuh';
    if (hour >= 6 && hour <= 11) return 'Pagi';
    if (hour >= 12 && hour <= 15) return 'Siang';
    if (hour >= 16 && hour <= 18) return 'Sore';
    return 'Malam';
  };

  const weatherCodeToDesc = (code: number): string => {
    if (code === 0) return 'Langit cerah';
    if ([1,2,3].includes(code)) return code === 1 ? 'Sebagian besar cerah' : code === 2 ? 'Berawan sebagian' : 'Mendung';
    if ([45,48].includes(code)) return code === 45 ? 'Kabut' : 'Kabut es';
    if ([51,53,55].includes(code)) return code === 51 ? 'Gerimis ringan' : code === 53 ? 'Gerimis sedang' : 'Gerimis lebat';
    if ([56,57].includes(code)) return code === 56 ? 'Gerimis membeku ringan' : 'Gerimis membeku lebat';
    if ([61,63,65].includes(code)) return code === 61 ? 'Hujan ringan' : code === 63 ? 'Hujan sedang' : 'Hujan lebat';
    if ([66,67].includes(code)) return code === 66 ? 'Hujan membeku ringan' : 'Hujan membeku lebat';
    if ([71,73,75].includes(code)) return code === 71 ? 'Salju ringan' : code === 73 ? 'Salju sedang' : 'Salju lebat';
    if (code === 77) return 'Butiran salju';
    if ([80,81,82].includes(code)) return code === 80 ? 'Hujan deras ringan' : code === 81 ? 'Hujan deras sedang' : 'Hujan deras sangat deras';
    if ([85,86].includes(code)) return code === 85 ? 'Hujan salju ringan' : 'Hujan salju lebat';
    if (code === 95) return 'Badai petir ringan/sedang';
    if ([96,99].includes(code)) return code === 96 ? 'Badai petir dengan hujan es ringan' : 'Badai petir dengan hujan es lebat';
    return 'Tidak diketahui';
  };

  const { latitude, longitude, tanggal, jam } = formData;

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        if (!latitude || !longitude || !tanggal || !jam) return;
        const start = tanggal; // YYYY-MM-DD
        const end = tanggal;
        const today = new Date(); today.setHours(0,0,0,0);
        const dt = new Date(`${tanggal}T00:00:00`);
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
        if (!times.length || !codes.length) {
          setFormData(prev => ({ ...prev, cuaca: '' }));
          return;
        }
        const [hs, ms] = jam.split(':');
        const h = Math.max(0, Math.min(23, Number(hs) || 0));
        const m = Math.max(0, Math.min(59, Number(ms) || 0));
        const hr = Math.min(23, m < 30 ? h : h + 1);
        const hh = String(hr).padStart(2, '0');
        const needle = `${tanggal}T${hh}:00`;
        // Cari index jam yang cocok/terdekat di tanggal yang sama
        let idx = times.indexOf(needle);
        if (idx === -1) {
          const dayIdx: number[] = [];
          times.forEach((t, i) => { if (t.startsWith(`${tanggal}T`)) dayIdx.push(i); });
          if (dayIdx.length) {
            const hours = dayIdx.map(i => Number(times[i].slice(11,13)) || 0);
            const exact = dayIdx.find((i, k) => hours[k] === hr);
            if (typeof exact === 'number') idx = exact;
            else {
              let best = dayIdx[0];
              let bestDiff = Math.abs((Number(times[best].slice(11,13))||0) - hr);
              for (let k = 1; k < dayIdx.length; k++) {
                const i = dayIdx[k];
                const diff = Math.abs((Number(times[i].slice(11,13))||0) - hr);
                if (diff < bestDiff) { best = i; bestDiff = diff; }
              }
              idx = best;
            }
          }
        }
        if (idx === -1 || codes[idx] == null || Number.isNaN(Number(codes[idx]))) {
          setFormData(prev => ({ ...prev, cuaca: '' }));
          return;
        }
        const desc = weatherCodeToDesc(Number(codes[idx]));
        setFormData(prev => ({ ...prev, cuaca: desc }));
      } catch {
        setFormData(prev => ({ ...prev, cuaca: '' }));
      }
    };
    fetchWeather();
  }, [latitude, longitude, tanggal, jam]);

  useEffect(() => {
    try {
      const f = fileInputRef.current?.files?.[0];
      if (!f || !formData.tanggal) return;
      const m = f.name.match(/^(\d{8})/);
      if (!m) return;
      const d = new Date(formData.tanggal);
      const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      if (m[1] !== ymd) {
        alert(`Nama file dokumentasi harus sama dengan tanggal yang dipilih (${ymd})`);
        setFormData(prev => ({ ...prev, dokumentasi: '' }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {}
  }, [formData.tanggal]);

  const normalizeSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();
  const toScientificCase = (s: string) => {
    const words = normalizeSpaces(s).toLowerCase().split(' ');
    if (words.length === 0) return '';
    const first = words[0] ? words[0][0].toUpperCase() + words[0].slice(1) : '';
    return [first, ...words.slice(1)].join(' ');
  };

  // Kapital setiap awal kata tanpa mengubah spasi yang sedang diketik
  const capitalizeWords = (s: string) => s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

  const [speciesMap, setSpeciesMap] = useState<Record<string,string>>({});
  const [needsManualScientific, setNeedsManualScientific] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/data/bird-species?map=1');
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          const map: Record<string,string> = {};
          for (const r of json.data as Array<{ jenis_burung?: string | null; nama_ilmiah?: string | null }>) {
            const k = (r.jenis_burung ?? '').trim();
            const v = (r.nama_ilmiah ?? '').trim();
            if (k && v && !map[k.toLowerCase()]) map[k.toLowerCase()] = v;
          }
          setSpeciesMap(map);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const key = normalizeSpaces(formData.jenis_burung).toLowerCase();
    if (!key) { setNeedsManualScientific(false); return; }
    let found = speciesMap[key];
    if (!found) {
      const entries = Object.entries(speciesMap);
      const cands = entries.filter(([k]) => k.includes(key) || key.includes(k) || k.split(' ').some(w => w.startsWith(key)));
      if (cands.length) {
        cands.sort((a, b) => {
          const ka = a[0], kb = b[0];
          const pa = ka.startsWith(key) ? 0 : 1;
          const pb = kb.startsWith(key) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return kb.length - ka.length;
        });
        found = cands[0][1];
      }
    }
    if (found) {
      setFormData(prev => ({ ...prev, nama_ilmiah: found }));
      setNeedsManualScientific(false);
    } else {
      setFormData(prev => ({ ...prev, nama_ilmiah: '' }));
      setNeedsManualScientific(true);
    }
  }, [formData.jenis_burung, speciesMap]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev } as BirdSpeciesFormData;
      if (name === 'jam') {
        next.jam = value;
        next.waktu = mapWaktu(value);
      } else if (name === 'jenis_burung') {
        next.jenis_burung = capitalizeWords(value);
      } else if (name === 'nama_ilmiah') {
        next.nama_ilmiah = capitalizeWords(value);
      } else if (name in prev) {
        const key = name as keyof BirdSpeciesFormData;
        next[key] = value as BirdSpeciesFormData[typeof key];
      }

      // Pastikan opsi lokasi sesuai titik 1-4
      if (name === 'titik') {
        const allowed = getAllowedLokasi(value);
        if (!allowed.includes(next.lokasi)) {
          next.lokasi = '';
        }
      }

      // Auto-fill koordinat bila kombinasi titik+lokasi terdefinisi
      const t = name === 'titik' ? value : next.titik;
      const l = name === 'lokasi' ? value : next.lokasi;
      const key = `${t}|${l}`;
      if (coords[key]) {
        next.latitude = coords[key].lat;
        next.longitude = coords[key].lon;
      } else if (name === 'titik' || name === 'lokasi') {
        next.latitude = '';
        next.longitude = '';
      }

      return next;
    });
  };


  const clearDokumentasi = () => {
    setFormData(prev => ({ ...prev, dokumentasi: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFormData(prev => ({ ...prev, dokumentasi: '' }));
      return;
    }
    const allowed = ['image/png','image/jpeg','application/pdf'];
    if (!allowed.includes(file.type)) {
      alert('Format file harus PNG, JPG/JPEG, atau PDF');
      e.currentTarget.value = '';
      return;
    }
    const m = file.name.match(/^(\d{8})(-\d+)?\.(png|pdf|jpe?g)$/i);
    if (!m) {
      alert('Nama file harus: YYYYMMDD atau YYYYMMDD-1, dengan ekstensi png/pdf/jpg/jpeg. Contoh: 20220929.png atau 20220929-2.jpg');
      e.currentTarget.value = '';
      return;
    }
    if (!formData.tanggal) {
      alert('Isi Tanggal terlebih dahulu sebelum memilih file dokumentasi');
      e.currentTarget.value = '';
      return;
    }
    const fileYmd = m[1];
    const d = new Date(formData.tanggal);
    const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    if (fileYmd !== ymd) {
      alert(`Nama file harus sama dengan tanggal yang dipilih (${ymd})`);
      e.currentTarget.value = '';
      return;
    }
    const maxBytes = 5 * 1024 * 1024; // 5MB
    if (file.size > maxBytes) {
      alert('Ukuran file maksimal 5MB');
      e.currentTarget.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setFormData(prev => ({ ...prev, dokumentasi: result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      await onSubmit(formData);
    }
    setFormData({
      longitude: '',
      latitude: '',
      lokasi: '',
      titik: '',
      tanggal: '',
      jam: '',
      waktu: '',
      cuaca: '',
      jenis_burung: '',
      nama_ilmiah: '',
      jumlah_burung: '',
      keterangan: '',
      dokumentasi: '',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
      <div className="bg-white rounded-lg border-2 border-gray-300 shadow-sm">


        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700 select-text">
                {formData.longitude || '-'}
              </div>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700 select-text">
                {formData.latitude || '-'}
              </div>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Lokasi</label>
              <select
                name="lokasi"
                value={formData.lokasi}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Pilih lokasi</option>
                {getAllowedLokasi(formData.titik).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Titik</label>
              <select
                name="titik"
                value={formData.titik}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Pilih titik</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
              </select>
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal</label>
              <input
                type="date"
                name="tanggal"
                value={formData.tanggal}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData(prev => ({ ...prev, tanggal: v }));
                  if (v && !isWithinFuture16Days(v)) {
                    setDateError(`Tanggal tidak boleh melebihi 16 hari dari hari ini (${maxDate})`);
                  } else {
                    setDateError('');
                  }
                }}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${dateError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'} focus:border-transparent`}
                required
                max={maxDate}
                aria-invalid={!!dateError}
              />
              {dateError && <p className="text-red-600 text-sm mt-1">{dateError}</p>}
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Jam</label>
              <input
                type="time"
                name="jam"
                value={formData.jam}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Waktu</label>
              <input
                type="text"
                name="waktu"
                value={formData.waktu}
                onChange={handleInputChange}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Waktu"
                required
              />
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cuaca</label>
              <input
                type="text"
                name="cuaca"
                value={formData.cuaca}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 focus:outline-none"
                placeholder="Otomatis dari API Open-Meteo"
                required
              />
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Jenis Burung</label>
              <input
                 type="text"
                 name="jenis_burung"
                 value={formData.jenis_burung}
                 onChange={handleInputChange}
                 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                 placeholder="Masukkan jenis burung"
                 required
               />
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nama Ilmiah</label>
              {needsManualScientific ? (
                <input
                  type="text"
                  name="nama_ilmiah"
                  value={formData.nama_ilmiah}
                  onChange={handleInputChange}
                  onBlur={(e) => setFormData(prev => ({ ...prev, nama_ilmiah: toScientificCase(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Masukkan nama ilmiah"
                  required
                />
              ) : (
                <input
                  type="text"
                  name="nama_ilmiah"
                  value={formData.nama_ilmiah}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 focus:outline-none"
                  placeholder="Terisi otomatis dari database"
                  required
                />
              )}
            </div>

            <div className="form-group">
              <label className="block text-sm font-medium text-gray-700 mb-1">Jumlah Burung</label>
              <input
                type="number"
                name="jumlah_burung"
                value={formData.jumlah_burung}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Masukkan jumlah burung"
                min="0"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="block text-sm font-medium text-gray-700 mb-1">Keterangan</label>
            <textarea
              name="keterangan"
              value={formData.keterangan}
              onChange={handleInputChange}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Masukkan keterangan tambahan"
            />
          </div>

          <div className="form-group">
            <label className="block text-sm font-medium text-gray-700 mb-1">Dokumentasi (png, pdf, jpeg, jpg)</label>
            <ul className="text-xs text-gray-600 mb-2 list-disc pl-6 space-y-1">
              <li>Rename file dengan format: YYYYMMDD. Contoh: 20220929</li>
              <li>Jika satu tanggal ada 2+ file: tambahkan -1, -2, dst. Contoh: 20220929-1, 20220929-2</li>
              <li>Harus sama dengan tanggal yang dipilih</li>
            </ul>
            <input
              type="file"
              accept=".png,.pdf,.jpeg,.jpg"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent file:bg-gray-700 file:text-white file:hover:bg-gray-800 file:border-0 file:rounded-md file:px-4 file:py-2 file:mr-3 bg-gray-100"
            />
            <div className="mt-2">
              <button type="button" onClick={clearDokumentasi} className="px-4 py-2 rounded-md text-red-500 hover:bg-gray-100">Hapus Dokumentasi</button>
            </div>
          </div>

          <div className="flex justify-center pt-4">
            <button
              type="submit"
              disabled={isSubmitting || !!dateError}
              className={`px-8 py-3 rounded-lg font-medium transition-colors ${isSubmitting
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-gradient-to-r from-[#72BB34] to-[#40A3DC] text-white hover:opacity-90'
                }`}
            >
              {isSubmitting ? 'Menyimpan...' : 'Submit Data'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

export type { BirdSpeciesFormData };

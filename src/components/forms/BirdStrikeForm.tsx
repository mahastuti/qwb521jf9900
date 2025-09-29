import { useState, useRef } from "react";
import type { FormEvent } from "react";

interface BirdStrikeFormData {
  tanggal: string;
  jam: string;
  waktu: string;
  fase: string;
  lokasi_perimeter: string;
  kategori_kejadian: string;
  remark: string;
  airline: string;
  jenis_pesawat: string;
  runway_use: string;
  komponen_pesawat: string;
  dampak_pada_pesawat: string;
  kondisi_kerusakan: string;
  tindakan_perbaikan: string;
  sumber_informasi: string;
  deskripsi: string;
  dokumentasi: string;
  titik: string;
}

type BirdStrikeFormProps = {
  onSubmit?: (data: BirdStrikeFormData) => Promise<void>;
  isSubmitting?: boolean;
}

export default function BirdStrikeForm({ onSubmit, isSubmitting = false }: BirdStrikeFormProps) {
  const [formData, setFormData] = useState<BirdStrikeFormData>({
    tanggal: "",
    jam: "",
    waktu: "",
    fase: "",
    lokasi_perimeter: "",
    kategori_kejadian: "",
    remark: "",
    airline: "",
    jenis_pesawat: "",
    runway_use: "",
    komponen_pesawat: "",
    dampak_pada_pesawat: "",
    kondisi_kerusakan: "",
    tindakan_perbaikan: "",
    sumber_informasi: "",
    deskripsi: "",
    dokumentasi: "",
    titik: "",
  });

  const mapWaktu = (time: string): string => {
    if (!time) return "";
    const hour = Number(time.split(":")[0]);
    if (hour >= 0 && hour < 5) return "Dini Hari";
    if (hour >= 5 && hour < 11) return "Pagi";
    if (hour >= 11 && hour < 15) return "Siang";
    if (hour >= 15 && hour < 18) return "Sore";
    return "Malam";
  };

  const toTitleCase = (s: string): string =>
    s.toLowerCase().replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));

  const clearDokumentasi = () => {
    setFormData(prev => ({ ...prev, dokumentasi: "" }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFormData(prev => ({ ...prev, dokumentasi: "" }));
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      alert('Format file harus PNG, JPG/JPEG, atau PDF');
      e.currentTarget.value = '';
      return;
    }

    const nameOk = /^(\d{8})(-\d+)?\.(png|pdf|jpe?g)$/i.test(file.name);
    if (!nameOk) {
      alert('Nama file harus: YYYYMMDD atau YYYYMMDD-1, dengan ekstensi png/pdf/jpg/jpeg. Contoh: 20220929.png atau 20220929-2.jpg');
      e.currentTarget.value = '';
      return;
    }

    const maxBytes = 5 * 1024 * 1024;
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

  const [airlineChoice, setAirlineChoice] = useState<string>('');
  const [jenisChoice, setJenisChoice] = useState<string>('');
  const [komponenChoice, setKomponenChoice] = useState<string>('');
  const [dateError, setDateError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const allowedTitik = formData.lokasi_perimeter === 'Out'
    ? ['1','2','3','4']
    : formData.lokasi_perimeter === 'In'
      ? ['1','2','3','4','5','6','7','8']
      : [];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (formData.tanggal) {
      if (formData.tanggal > maxDate) {
        alert(`Tanggal tidak boleh melebihi 16 hari dari hari ini (${maxDate})`);
        return;
      }
    }

    if (onSubmit) {
      await onSubmit(formData);
    }
    setFormData({
      tanggal: "",
      jam: "",
      waktu: "",
      fase: "",
      lokasi_perimeter: "",
      kategori_kejadian: "",
      remark: "",
      airline: "",
      jenis_pesawat: "",
      runway_use: "",
      komponen_pesawat: "",
      dampak_pada_pesawat: "",
      kondisi_kerusakan: "",
      tindakan_perbaikan: "",
      sumber_informasi: "",
      deskripsi: "",
      dokumentasi: "",
      titik: "",
    });
    setAirlineChoice('');
    setJenisChoice('');
    setKomponenChoice('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      <div className="p-6 space-y-4 bg-white rounded-lg border-2 border-gray-300 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
            <input
              type="date"
              value={formData.tanggal}
              onChange={(e) => {
                const v = e.target.value;
                setFormData({ ...formData, tanggal: v });
                if (v && !isWithinFuture16Days(v)) {
                  setDateError(`Tanggal tidak boleh melebihi 16 hari dari hari ini (${maxDate})`);
                } else {
                  setDateError('');
                }
              }}
              className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent ${dateError ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'}`}
              required
              max={maxDate}
              aria-invalid={!!dateError}
            />
            {dateError && (
              <p className="text-red-600 text-sm mt-1">{dateError}</p>
            )}
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Jam</label>
            <input
              type="time"
              value={formData.jam}
              onChange={(e) => setFormData({ ...formData, jam: e.target.value, waktu: mapWaktu(e.target.value) })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Waktu</label>
            <input
              type="text"
              value={formData.waktu}
              readOnly
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Dini Hari/ Pagi/ Siang/ Sore/ Malam"
              required
            />
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Fase</label>
            <select
              value={formData.fase}
              onChange={(e) => {
                const phase = e.target.value;
                const outPhases = new Set(['Approach', 'Final', 'Short Final']);
                const inPhases = new Set(['Landing', 'Take Off']);
                const lokasi = outPhases.has(phase) ? 'Out' : inPhases.has(phase) ? 'In' : '';
                const allowed = lokasi === 'Out' ? ['1','2','3','4'] : lokasi === 'In' ? ['1','2','3','4','5','6','7','8'] : [];
                const titik = allowed.includes(formData.titik) ? formData.titik : '';
                setFormData({ ...formData, fase: phase, lokasi_perimeter: lokasi, titik });
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Pilih Fase</option>
              <option value="Approach">Approach</option>
              <option value="Final">Final</option>
              <option value="Short Final">Short Final</option>
              <option value="Landing">Landing</option>
              <option value="Take Off">Take Off</option>
            </select>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Lokasi Perimeter</label>
            <input
              type="text"
              value={formData.lokasi_perimeter}
              readOnly
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="In/ Out"
              required
            />
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Titik</label>
            <select
              value={formData.titik}
              onChange={(e) => setFormData({ ...formData, titik: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={allowedTitik.length === 0}
            >
              <option value="">{formData.lokasi_perimeter ? 'Pilih Titik' : 'Pilih fase terlebih dahulu'}</option>
              {allowedTitik.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Kategori Kejadian</label>
            <select
              value={formData.kategori_kejadian}
              onChange={(e) => setFormData({ ...formData, kategori_kejadian: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Pilih Kategori</option>
              <option value="Strike">Bird Strike</option>
              <option value="Near Miss">Bat Strike</option>
            </select>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Remark</label>
            <select
              value={formData.remark}
              onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Pilih Kategori</option>
              <option value="Strike">Terkonfirmasi</option>
              <option value="Near Miss">Tidak Terkonfirmasi</option>
            </select>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Airline</label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={airlineChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setAirlineChoice(v);
                  if (v === 'Air Asia' || v === 'Lion Air') {
                    setFormData({ ...formData, airline: v });
                  } else if (v === 'Lainnya') {
                    setFormData({ ...formData, airline: '' });
                  } else {
                    setFormData({ ...formData, airline: '' });
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Pilih Airline</option>
                <option value="Air Asia">Air Asia</option>
                <option value="Lion Air">Lion Air</option>
                <option value="Lainnya">Lainnya</option>
              </select>

              {airlineChoice === 'Lainnya' && (
                <input
                  type="text"
                  value={formData.airline}
                  onChange={(e) => setFormData({ ...formData, airline: toTitleCase(e.target.value) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ketik nama maskapai (otomatis Kapitalisasi)"
                  required
                />
              )}
            </div>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Jenis Pesawat</label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={jenisChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setJenisChoice(v);
                  if (v === 'Airbus' || v === 'Boeing') {
                    setFormData({ ...formData, jenis_pesawat: v });
                  } else if (v === 'Lainnya') {
                    setFormData({ ...formData, jenis_pesawat: '' });
                  } else {
                    setFormData({ ...formData, jenis_pesawat: '' });
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Pilih Jenis</option>
                <option value="Airbus">Airbus</option>
                <option value="Boeing">Boeing</option>
                <option value="Lainnya">Lainnya</option>
              </select>

              {jenisChoice === 'Lainnya' && (
                <input
                  type="text"
                  value={formData.jenis_pesawat}
                  onChange={(e) => setFormData({ ...formData, jenis_pesawat: toTitleCase(e.target.value) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ketik jenis pesawat (otomatis Kapitalisasi)"
                />
              )}
            </div>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Runway Use</label>
            <select
              value={formData.runway_use}
              onChange={(e) => setFormData({ ...formData, runway_use: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Pilih Kategori</option>
              <option value="10">10</option>
              <option value="28">28</option>
            </select>
          </div>

          <div className="input-group">
            <label className="block text-sm font-medium text-gray-700 mb-2">Komponen Pesawat</label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={komponenChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setKomponenChoice(v);
                  if (['Engine','Nose','Kaca Kokpit','Radome','Fuselage'].includes(v)) {
                    setFormData({ ...formData, komponen_pesawat: v });
                  } else if (v === 'Lainnya') {
                    setFormData({ ...formData, komponen_pesawat: '' });
                  } else {
                    setFormData({ ...formData, komponen_pesawat: '' });
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Pilih Komponen</option>
                <option value="Engine">Engine</option>
                <option value="Nose">Nose</option>
                <option value="Kaca Kokpit">Kaca Kokpit</option>
                <option value="Radome">Radome</option>
                <option value="Fuselage">Fuselage</option>
                <option value="Lainnya">Lainnya</option>
              </select>

              {komponenChoice === 'Lainnya' && (
                <input
                  type="text"
                  value={formData.komponen_pesawat}
                  onChange={(e) => setFormData({ ...formData, komponen_pesawat: toTitleCase(e.target.value) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ketik komponen (otomatis Kapitalisasi)"
                  required
                />
              )}
            </div>
          </div>
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Kondisi Kerusakan</label>
          <textarea
            value={formData.kondisi_kerusakan}
            onChange={(e) => setFormData({ ...formData, kondisi_kerusakan: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Deskripsikan kondisi kerusakan"
            required
          />
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Dampak Pada Pesawat</label>
          <textarea
            value={formData.dampak_pada_pesawat}
            onChange={(e) => setFormData({ ...formData, dampak_pada_pesawat: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Deskripsikan dampak pada pesawat"
            required
          />
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Tindakan Perbaikan</label>
          <textarea
            value={formData.tindakan_perbaikan}
            onChange={(e) => setFormData({ ...formData, tindakan_perbaikan: e.target.value })}
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Masukkan tindakan perbaikan yang dilakukan"
            required
          />
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Sumber Informasi</label>
          <textarea
            value={formData.sumber_informasi}
            onChange={(e) => setFormData({ ...formData, sumber_informasi: e.target.value })}
            rows={2}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Masukkan sumber informasi"
            required
          />
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Deskripsi</label>
          <textarea
            value={formData.deskripsi}
            onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Masukkan deskripsi lengkap kejadian"
            required
          />
        </div>

        <div className="input-group">
          <label className="block text-sm font-medium text-gray-700 mb-2">Dokumentasi (png, pdf, jpeg, jpg)</label>
          <ul className="text-xs text-gray-600 mb-2 list-disc pl-6 space-y-1">
            <li>Rename file dengan format: YYYYMMDD. Contoh: 20220929</li>
            <li>Jika satu tanggal ada 2+ file: tambahkan -1, -2, dst. Contoh: 20220929-1, 20220929-2</li>
            <li>Format selain ini akan ditolak</li>
          </ul>
          <input
            type="file"
            accept=".png,.pdf,.jpeg,.jpg"
            onChange={handleFileChange}
            ref={fileInputRef}
            className="w-full mt-2 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent file:bg-gray-700 file:text-white file:hover:bg-gray-800 file:border-0 file:rounded-md file:px-4 file:py-2 file:mr-3 bg-gray-100"
          />
          <div className="mt-2">
            <button type="button" onClick={clearDokumentasi} className="px-4 py-2 rounded-md text-red-500 hover:bg-gray-100">
              Hapus Dokumentasi
            </button>
          </div>
        </div>

        <div className="flex justify-center pt-6">
          <button
            type="submit"
            disabled={isSubmitting || !!dateError}
            className={`px-8 py-3 font-medium rounded-lg transition-opacity ${isSubmitting
              ? "bg-gray-400 text-white cursor-not-allowed"
              : "bg-gradient-to-r from-[#72BB34] to-[#40A3DC] text-white hover:opacity-90"
              }`}
          >
            {isSubmitting ? "Menyimpan..." : "Submit"}
          </button>
        </div>
      </div>
    </form>
  );
}

export type { BirdStrikeFormData };

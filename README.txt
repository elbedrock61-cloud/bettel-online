BETTEL ONLINE - game + server publik dalam satu paket

1. Pasang Node.js (versi 18 atau lebih baru).
2. Di folder ini jalankan:
     npm install
     node server.js
3. Buka http://localhost:8080 di browser (atau http://IP-KOMPUTER:8080 dari HP di Wi-Fi yang sama).
   Game otomatis memakai server yang sama; kolom "SERVER PUBLIK" di menu Mode boleh dikosongkan.

LOGIN AKUN (v124): saat online wajib login dengan nama akun + kata sandi.
- Pertama kali: isi nama akun (3-14 karakter) dan sandi (min. 6), tekan DAFTAR.
- Akun baru juga memilih jenis gender (cowok/cewek); tampil di halaman profil dan tidak bisa diubah setelah dipilih.
- Sandi disimpan ter-hash (scrypt) di accounts.json, jadi akun tidak hilang walau data HP terhapus:
  cukup MASUK lagi dengan nama + sandi yang sama.
- Akun lama tanpa sandi akan diminta membuat nama + sandi (progres tetap).
- Tombol KELUAR AKUN ada di halaman profil (tekan foto profil di lobi).
- Mode offline (tanpa internet) tetap bisa Story Chapter 1 tanpa login.
Simpan file accounts.json (backup berkala) karena itu database akunnya.

MATCHMAKING (v125): di layar room ada 2 tombol.
- MAIN SENDIRI = match cepat (~1 detik), tanpa menunggu pemain lain, 1 tim melawan bot.
- MULAI = bermain berkelompok: lobi teman (satu tim) atau antrean acak dengan pemain lain (Tim A vs Tim B).
- Setelah lawan ditemukan, hitung mundur SIAP = 10 detik.

Story tidak lewat server (individu per akun).
Untuk publik: taruh folder ini di hosting yang mendukung Node + WebSocket (HTTPS), lalu bagikan alamatnya.

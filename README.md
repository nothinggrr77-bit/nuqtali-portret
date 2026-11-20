# Nuqtali Portret

Rasmni qora fonda yulduzlardek yig'ilib keladigan oq nuqtalarga aylantiruvchi sayt.

**Saytni ochish:** https://nothinggrr77-bit.github.io/nuqtali-portret/

## Ishga tushirish

`index.html` faylini Chrome yoki Edge'da oching (ikki marta bosish kifoya).

Ba'zi imkoniyatlar mahalliy server orqali ochilganda yaxshiroq ishlaydi (pastga qarang).
VS Code'da **Live Server** kengaytmasi bilan yoki terminalda:

```
npx serve .
```

## Imkoniyatlar

| Tugma | Nima qiladi |
|---|---|
| Rasm yuklash | Rasm tanlash. Sudrab tashlash yoki `Ctrl+V` ham ishlaydi |
| ↻ | Animatsiyani qaytadan o'ynatish (`R`) |
| ✳ | Nuqtalarni tarqatish yoki yig'ish (`Probel`) |
| Sovg'a | Matn + rasmlar + musiqa ketma-ketligi, video yoki HTML fayl qilib saqlash |
| Kamera | Jonli kamera tasviri nuqtalarda; suratga olish; qo'l bilan boshqarish |
| PNG | 4K sifatli rasm |
| Video | Animatsiyani video qilib yozish (format: Sozlamalar › Eksport) |
| ⛶ | To'liq ekran (`F`) |
| Ko'z | Tugmalarni yashirish (`H`, yoki ekranga ikki marta bosish bilan qaytariladi) |

Sozlamalar panelida: kontrast, chegara, nuqtalar soni, rang uslublari (oltin, neon, kosmik…),
fonni AI bilan olib tashlash, animatsiya turi va boshqalar. Sozlamalar brauzerda eslab qolinadi.

## Effektlar

| Sozlama | Variantlar |
|---|---|
| Boshlanish shakli | Yulduzli osmon, Galaktika, Markazdan portlash, Qor, Qum bo'roni, Girdob, Salyut, Globus |
| Yig'ilish tartibi | Tasodifiy, Markazdan, Yuqoridan, Yorqin joylar avval, Qalamda chizish (konturlar avval), Yulduz turkumlari (chiziqlar bilan) |
| Tarqalish turi | Chang bo'lib uchish, Qora tuynukka so'rilish, Oqib tushish, Portlash, Yulduzlarga qaytish |
| Nuqta shakli | Nuqta ●, Yulduzcha ✦, Yurakcha ❤ |
| Ko'rinish | Yulduz chaqnashi ✦, Yorug'lik nuri (bloom), Uchar yulduzlar |
| 3D | 3D portret (AI yuz chuqurligi), Aylanish (sichqoncha / telefon / avtomatik), Telefon giroskopi |
| Sichqoncha | Itarish yoki Magnit (tortish), bosilganda to'lqin |

## Sovg'a rejimi

- **+ 3·2·1** — teskari sanash.
- **🎂 Tug'ilgan kun shabloni** — 3·2·1 → "Tug'ilgan kuning bilan!" → (puflash) → salyutdan portret.
- Sahna yonidagi **🎂** tugmasi: shu sahnadan keyin sovg'a oluvchi mikrofonga **puflashi** kerak
  (mikrofon bo'lmasa — ekranga bosadi). Nuqtalar sham kabi puflab yuboriladi.
- Video yozishda puflash kutilmaydi — avtomatik davom etadi.

## Internet kerak bo'ladigan joylar

- **Fonni olib tashlash**, **3D portret** va **qo'l bilan boshqarish** — Google MediaPipe modellari
  birinchi marta internetdan yuklanadi (umumiy dvigatel ~10 MB, keyin mos ravishda ~0.3 MB, ~3.7 MB
  va ~8 MB), so'ng brauzer keshida qoladi.
- **Sovg'a fayli (HTML)** — sayt server orqali ochilgan bo'lsa, kutubxonalar fayl ichiga joylanadi
  va sovg'a internetsiz ochiladi. `index.html` to'g'ridan-to'g'ri ochilgan bo'lsa, sovg'a fayli
  kutubxonalarni internetdan yuklaydi.

## Internetga joylash (GitHub Pages, bepul)

1. github.com'da yangi repozitoriy oching (masalan, `nuqtali-portret`).
2. Shu papkadagi barcha fayllarni (`libs` papkasi bilan) repozitoriyga yuklang.
3. Repozitoriy › **Settings** › **Pages** › *Branch*: `main`, papka: `/ (root)` › **Save**.
4. Bir-ikki daqiqadan keyin sayt `https://<foydalanuvchi-nomi>.github.io/nuqtali-portret/` manzilida ochiladi.

## Fayllar

- `index.html` — sahifa tuzilishi
- `style.css` — dizayn (telefonga moslangan)
- `engine.js` — nuqtalar dvigateli: rasm tahlili, animatsiya, shaderlar (three.js + GSAP)
- `ai.js` — MediaPipe: fonni olib tashlash, 3D chuqurlik xaritasi, qo'l imo-ishoralari
- `app.js` — interfeys: sovg'a rejimi, musiqa, video, eksport, kamera
- `libs/` — three.js 0.149, GSAP 3.12.5, lil-gui 0.19.2

Brauzer konsolidan boshqarish ham mumkin, masalan: `portrait.engine.setProgress(0.5)`.

//! Детерминированный генератор и гладкий шум (те же формулы, что в JS-прототипе).

/// Mulberry32 с затравкой из FNV-1a по UTF-16 кодовым единицам строки.
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: &str) -> Rng {
        let mut s: u32 = 2166136261;
        for c in seed.encode_utf16() {
            s ^= c as u32;
            s = s.wrapping_mul(16777619);
        }
        Rng(s)
    }
    /// Детерминированный поток из базового seed и тега (`"{seed}|{tag}"`).
    pub fn sub(seed: &str, tag: &str) -> Rng {
        Rng::new(&format!("{seed}|{tag}"))
    }
    #[inline]
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let s = self.0;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    /// Равномерное число в `[lo, hi)`.
    #[inline]
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next()
    }
    /// Случайный индекс в `0..n` (возвращает 0 при `n == 0`).
    #[inline]
    pub fn usize(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            ((self.next() * (n as f64)).floor() as usize).min(n - 1)
        }
    }
}

/// Гладкий шум на R^3, диапазон ≈ [-1, 1].
pub struct Noise {
    perm: [u8; 512],
    val: [f64; 256],
}

impl Noise {
    pub fn new(r: &mut Rng) -> Noise {
        let mut idx: Vec<u8> = (0..=255u8).collect();
        for i in (1..256usize).rev() {
            let j = (r.next() * (i as f64 + 1.0)).floor() as usize;
            idx.swap(i, j);
        }
        let mut perm = [0u8; 512];
        for i in 0..512 {
            perm[i] = idx[i & 255];
        }
        let mut val = [0f64; 256];
        for v in val.iter_mut() {
            *v = r.next() * 2.0 - 1.0;
        }
        Noise { perm, val }
    }
    #[inline]
    fn at(&self, x: i32, y: i32, z: i32) -> f64 {
        let p = &self.perm;
        self.val[p[p[p[(x & 255) as usize] as usize + (y & 255) as usize] as usize + (z & 255) as usize] as usize]
    }
    pub fn get(&self, x: f64, y: f64, z: f64) -> f64 {
        let f = |t: f64| t * t * (3.0 - 2.0 * t);
        let l = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let (xi, yi, zi) = (x.floor(), y.floor(), z.floor());
        let (u, v, w) = (f(x - xi), f(y - yi), f(z - zi));
        let (xi, yi, zi) = (xi as i32, yi as i32, zi as i32);
        l(
            l(l(self.at(xi, yi, zi), self.at(xi + 1, yi, zi), u), l(self.at(xi, yi + 1, zi), self.at(xi + 1, yi + 1, zi), u), v),
            l(l(self.at(xi, yi, zi + 1), self.at(xi + 1, yi, zi + 1), u), l(self.at(xi, yi + 1, zi + 1), self.at(xi + 1, yi + 1, zi + 1), u), v),
            w,
        )
    }
    /// Фрактальный броуновский шум на R^3, нормированный к `[-1, 1]`.
    pub fn fbm(&self, x: f64, y: f64, z: f64, octaves: u32) -> f64 {
        if octaves == 0 {
            return 0.0;
        }
        let mut sum = 0.0;
        let mut amp = 1.0;
        let mut freq = 1.0;
        let mut norm = 0.0;
        for _ in 0..octaves {
            sum += amp * self.get(x * freq, y * freq, z * freq);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        (sum / norm).clamp(-1.0, 1.0)
    }
}

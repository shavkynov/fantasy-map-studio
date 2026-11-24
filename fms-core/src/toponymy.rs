//! Процедурная топонимика на основе фонетических профилей культур, этносов,
//! лингвистической изоляции и типов географических объектов.

use crate::biomes::{Biome, Biomes};
use crate::civilization::{Civilization, CultureEthos, Livelihood, SettlementRole};
use crate::geography::Geography;
use crate::grid::Grid;
use crate::hydrology::Hydrology;
use crate::rng::Rng;
use std::collections::HashSet;

/// Согласованные географические названия объектов планеты на русском языке.
#[derive(Clone, Debug)]
pub struct WorldNames {
    pub landmasses: Vec<String>,
    pub archipelagos: Vec<String>,
    pub bays: Vec<String>,
    pub isthmuses: Vec<String>,
    pub lakes: Vec<String>,
    pub mountain_ranges: Vec<String>,
    pub passes: Vec<String>,
    pub natural_regions: Vec<String>,
    pub rivers: Vec<String>,
}

struct Phonology {
    onsets: &'static [&'static str],
    nuclei: &'static [&'static str],
    codas: &'static [&'static str],
    endings: &'static [&'static str],
}

const PROFILES: [Phonology; 8] = [
    // 0: Приморский / архипелажный (мелодичные сонорные и свистящие)
    Phonology {
        onsets: &["с", "л", "м", "н", "в", "р", "т", "к", "п", "ф", ""] ,
        nuclei: &["а", "е", "и", "о", "у"],
        codas: &["", "", "", "н", "л", "р", "с"],
        endings: &["ария", "ена", "ора", "иль", "ар", "он", "ос", "а"],
    },
    // 1: Высокогорный (сонорные и взрывные)
    Phonology {
        onsets: &["к", "г", "д", "т", "р", "бр", "гр", "кр", "тр", "в", "з"],
        nuclei: &["а", "о", "у", "е", "и"],
        codas: &["", "", "р", "г", "к", "д", "н"],
        endings: &["ор", "гар", "дар", "ук", "ак", "он", "ан", "ур"],
    },
    // 2: Степной кочевой
    Phonology {
        onsets: &["б", "к", "т", "д", "ж", "ч", "с", "н", "р", "х", "м"],
        nuclei: &["а", "о", "у", "ы", "е"],
        codas: &["", "", "н", "р", "л", "й", "т"],
        endings: &["ан", "ун", "ай", "ар", "ол", "ур", "ак", "ин"],
    },
    // 3: Пустынно-оазисный
    Phonology {
        onsets: &["з", "х", "ш", "с", "к", "д", "р", "м", "ф", "т", ""],
        nuclei: &["а", "и", "у", "е"],
        codas: &["", "", "р", "х", "м", "д", "н"],
        endings: &["ар", "ах", "ир", "ад", "ун", "аль", "ия", "аз"],
    },
    // 4: Речной / земледельческий (плавные долинные корни)
    Phonology {
        onsets: &["в", "д", "л", "м", "н", "р", "с", "т", "з", "п", "г"],
        nuclei: &["а", "е", "о", "и", "у"],
        codas: &["", "", "", "н", "р", "л", "в"],
        endings: &["ава", "ола", "ень", "ор", "ана", "ея", "ин", "а"],
    },
    // 5: Лесной / бореальный
    Phonology {
        onsets: &["в", "к", "л", "н", "р", "с", "т", "х", "м", "п"],
        nuclei: &["а", "е", "и", "о", "у", "я"],
        codas: &["", "", "л", "н", "р", "к", "т"],
        endings: &["ла", "ви", "орн", "аль", "ур", "ен", "о", "и"],
    },
    // 6: Вулканический / рифтовый
    Phonology {
        onsets: &["в", "к", "т", "р", "м", "г", "з", "б", "п"],
        nuclei: &["а", "о", "у", "э"],
        codas: &["", "", "р", "к", "н", "м"],
        endings: &["аон", "оро", "ула", "ака", "ор", "а", "ун", "ар"],
    },
    // 7: Полярный / тундровый
    Phonology {
        onsets: &["к", "т", "н", "м", "с", "р", "х", "п", ""],
        nuclei: &["у", "и", "а", "о"],
        codas: &["", "", "к", "н", "т", "м"],
        endings: &["ук", "ик", "ак", "на", "ут", "ор", "ан", "ит"],
    },
];

#[inline]
fn is_vowel(ch: char) -> bool {
    matches!(ch, 'а' | 'е' | 'и' | 'о' | 'у' | 'ы' | 'э' | 'ю' | 'я')
}

fn capitalize_ru(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let mut out: String = first.to_uppercase().collect();
            out.extend(chars);
            out
        }
    }
}

fn pick_str<'a>(list: &'a [&'a str], rng: &mut Rng) -> &'a str {
    let idx = ((rng.next() * list.len() as f64).floor() as usize).min(list.len() - 1);
    list[idx]
}

fn append_smooth(buf: &mut String, chunk: &str) {
    for ch in chunk.chars() {
        let mut iter = buf.chars().rev();
        let last1 = iter.next();
        let last2 = iter.next();
        if last1 == Some(ch) && (last2 == Some(ch) || is_vowel(ch)) {
            continue;
        }
        if let Some(p) = last1 {
            if !is_vowel(p) && !is_vowel(ch) && p == ch {
                continue;
            }
        }
        buf.push(ch);
    }
}

fn build_stem(profile: u8, rng: &mut Rng, min_syl: usize, max_syl: usize) -> String {
    let ph = &PROFILES[(profile as usize) % PROFILES.len()];
    let lo = min_syl.max(1);
    let hi = max_syl.max(lo);
    let n_syl = lo + ((rng.next() * (hi - lo + 1) as f64).floor() as usize).min(hi - lo);

    let mut raw = String::new();
    for s in 0..n_syl {
        let mut onset = pick_str(ph.onsets, rng);
        if s > 0 && onset.is_empty() {
            onset = ph.onsets[0];
        }
        let vowel = pick_str(ph.nuclei, rng);
        if let Some(prev) = raw.chars().rev().next() {
            if !is_vowel(prev) && onset.chars().count() > 1 {
                onset = ph.onsets[(s + 1) % (ph.onsets.len() - 1).max(1)];
                if onset.chars().count() > 1 || onset.is_empty() {
                    raw.push('а');
                }
            }
        }
        append_smooth(&mut raw, onset);
        append_smooth(&mut raw, vowel);
        if s + 1 < n_syl && rng.next() < 0.35 {
            let coda = pick_str(ph.codas, rng);
            if !coda.is_empty() {
                append_smooth(&mut raw, coda);
            }
        }
    }
    let end = pick_str(ph.endings, rng);
    if let (Some(p), Some(e0)) = (raw.chars().rev().next(), end.chars().next()) {
        if is_vowel(p) && is_vowel(e0) {
            raw.pop();
        }
    }
    append_smooth(&mut raw, end);
    capitalize_ru(&raw)
}

/// Генерирует уникальное благозвучное собственное имя для фонетического профиля `profile`.
pub fn generate_proper_name(
    profile: u8,
    rng: &mut Rng,
    min_syl: usize,
    max_syl: usize,
    used: &mut HashSet<String>,
) -> String {
    for _ in 0..24 {
        let cand = build_stem(profile, rng, min_syl, max_syl);
        if !used.contains(&cand) {
            used.insert(cand.clone());
            return cand;
        }
    }
    let base = build_stem(profile, rng, min_syl, max_syl);
    let ph = &PROFILES[(profile as usize) % PROFILES.len()];
    for ext in ph.endings {
        let mut alt = format!("{base}{ext}");
        alt = capitalize_ru(&alt);
        if !used.contains(&alt) {
            used.insert(alt.clone());
            return alt;
        }
    }
    let mut k = 2usize;
    loop {
        let alt = format!("{base}-{k}");
        if !used.contains(&alt) {
            used.insert(alt.clone());
            return alt;
        }
        k += 1;
    }
}

/// Генерирует уникальное название поселения с учётом его роли.
pub fn settlement_name(
    profile: u8,
    role: SettlementRole,
    rng: &mut Rng,
    used: &mut HashSet<String>,
) -> String {
    for attempt in 0..24 {
        let min_s = if rng.next() < 0.12 { 1 } else { 2 };
        let stem = build_stem(profile, rng, min_s, 3);
        let roll = rng.next();
        let formatted = match role {
            SettlementRole::Port if attempt < 16 && roll < 0.28 => format!("Порт-{stem}"),
            SettlementRole::PassFortress if attempt < 16 && roll < 0.30 => {
                format!("Застава {stem}")
            }
            SettlementRole::RiverHub if attempt < 16 && roll < 0.22 => format!("Усть-{stem}"),
            SettlementRole::MiningTown if attempt < 16 && roll < 0.22 => {
                format!("Рудный {stem}")
            }
            _ => stem,
        };
        if !used.contains(&formatted) {
            used.insert(formatted.clone());
            return formatted;
        }
    }
    generate_proper_name(profile, rng, 2, 3, used)
}

/// Формирует название государства по его культурному укладу и экономике.
pub fn realm_title(
    root: &str,
    livelihood: Livelihood,
    ethos: CultureEthos,
    rng: &mut Rng,
) -> String {
    let titles: &[&str] = match (ethos, livelihood) {
        (CultureEthos::Maritime, _) | (_, Livelihood::Maritime) => &[
            "Талассократия",
            "Морской союз",
            "Вольная гавань",
            "Республика",
        ],
        (CultureEthos::SteppeNomad, _) | (_, Livelihood::Pastoral) => {
            &["Каганат", "Орда", "Степной союз", "Улус"]
        }
        (CultureEthos::DesertOasis, _) | (_, Livelihood::Oasis) => {
            &["Султанат", "Эмират", "Лига оазисов", "Оазисный союз"]
        }
        (CultureEthos::Highland, _) | (_, Livelihood::Mining) => {
            &["Горное королевство", "Княжество", "Твердыня", "Горный союз"]
        }
        (CultureEthos::Riverine, _) => &[
            "Речная держава",
            "Царство",
            "Королевство",
            "Княжество",
        ],
        (CultureEthos::Woodland, _) | (_, Livelihood::HunterForest) => {
            &["Лесное княжество", "Союз племён", "Воеводство", "Край"]
        }
        _ => &["Королевство", "Великое княжество", "Держава", "Царство"],
    };
    let t = pick_str(titles, rng);
    format!("{t} {root}")
}

/// Присваивает уникальные географически мотивированные русские названия всем природным объектам планеты.
pub fn name_world(
    grid: &Grid,
    hydrology: &Hydrology,
    biomes: &Biomes,
    geography: &Geography,
    civilization: &Civilization,
    seed: &str,
) -> WorldNames {
    let mut rng = Rng::sub(seed, "toponymy-world");
    let mut used = HashSet::with_capacity(
        geography.landmasses.len()
            + geography.lakes.len()
            + geography.mountain_ranges.len()
            + hydrology.rivers.len()
            + 64,
    );

    for c in &civilization.cultures {
        used.insert(c.name.clone());
    }
    for s in &civilization.settlements {
        used.insert(s.name.clone());
    }
    for r in &civilization.realms {
        used.insert(r.name.clone());
    }

    let pick_profile = |cell: usize| -> u8 {
        let cid = civilization.culture_id[cell];
        if cid >= 0 {
            return civilization.cultures[cid as usize].phonology_profile;
        }
        let (nbs8, cnt8) = grid.neighbors8(cell);
        for &nb in &nbs8[..cnt8] {
            let ncid = civilization.culture_id[nb];
            if ncid >= 0 {
                return civilization.cultures[ncid as usize].phonology_profile;
            }
        }
        if hydrology.is_ocean[cell] != 0 {
            return 0;
        }
        match biomes.biome[cell] {
            Biome::HotDesert | Biome::SaltFlat => 3,
            Biome::IceSheet | Biome::PolarDesert | Biome::Tundra => 7,
            Biome::Alpine => 1,
            Biome::TemperateGrassland | Biome::TropicalSavanna => 2,
            Biome::BorealForest => 5,
            Biome::Lake | Biome::Wetland | Biome::TemperateForest => 4,
            _ => 4,
        }
    };

    let unique_labeled =
        |prefix: &str, profile: u8, rng: &mut Rng, used: &mut HashSet<String>| -> String {
            for _ in 0..48 {
                let stem = build_stem(profile, rng, 2, 3);
                let label = format!("{prefix}{stem}");
                if !used.contains(&label) {
                    used.insert(label.clone());
                    return label;
                }
            }
            let stem = generate_proper_name(profile, rng, 2, 3, &mut HashSet::new());
            let mut label = format!("{prefix}{stem}");
            let mut k = 2usize;
            while used.contains(&label) {
                label = format!("{prefix}{stem}-{k}");
                k += 1;
            }
            used.insert(label.clone());
            label
        };

    let mut landmasses = Vec::with_capacity(geography.landmasses.len());
    for lm in &geography.landmasses {
        let prof = pick_profile(lm.peak_cell);
        let name = if matches!(lm.kind, crate::geography::LandmassKind::Island) {
            unique_labeled("о. ", prof, &mut rng, &mut used)
        } else {
            generate_proper_name(prof, &mut rng, 2, 3, &mut used)
        };
        landmasses.push(name);
    }

    let mut archipelagos = Vec::with_capacity(geography.archipelagos.len());
    for arch in &geography.archipelagos {
        let sample_cell = arch
            .island_ids
            .first()
            .and_then(|&id| geography.landmasses.get(id as usize))
            .map(|l| l.peak_cell)
            .unwrap_or(0);
        let prof = if arch.is_volcanic_arc {
            6
        } else {
            pick_profile(sample_cell)
        };
        archipelagos.push(unique_labeled("Архипелаг ", prof, &mut rng, &mut used));
    }

    let mut bays = Vec::with_capacity(geography.bays.len());
    for bay in &geography.bays {
        let prof = pick_profile(bay.center_cell);
        bays.push(unique_labeled("зал. ", prof, &mut rng, &mut used));
    }

    let mut isthmuses = Vec::with_capacity(geography.isthmuses.len());
    for isth in &geography.isthmuses {
        let prof = pick_profile(isth.cell);
        isthmuses.push(unique_labeled("Перешеек ", prof, &mut rng, &mut used));
    }

    let mut lakes = Vec::with_capacity(geography.lakes.len());
    for lake in &geography.lakes {
        let prof = pick_profile(lake.center_cell);
        lakes.push(unique_labeled("оз. ", prof, &mut rng, &mut used));
    }

    let mut mountain_ranges = Vec::with_capacity(geography.mountain_ranges.len());
    for range in &geography.mountain_ranges {
        let cid = civilization.culture_id[range.peak_cell];
        let prof = if cid >= 0 {
            civilization.cultures[cid as usize].phonology_profile
        } else {
            1
        };
        mountain_ranges.push(unique_labeled("хр. ", prof, &mut rng, &mut used));
    }

    let mut passes = Vec::with_capacity(geography.passes.len());
    for pass in &geography.passes {
        let prof = pick_profile(pass.cell);
        passes.push(unique_labeled("пер. ", prof, &mut rng, &mut used));
    }

    let mut natural_regions = Vec::with_capacity(geography.natural_regions.len());
    for reg in &geography.natural_regions {
        let prof = pick_profile(reg.center_cell);
        let kind_prefix = format!("{} ", reg.kind.name());
        natural_regions.push(unique_labeled(&kind_prefix, prof, &mut rng, &mut used));
    }

    let mut rivers = Vec::with_capacity(hydrology.rivers.len());
    for riv in &hydrology.rivers {
        let mouth_or_mid = riv
            .cells
            .get(riv.cells.len() / 2)
            .copied()
            .unwrap_or(0);
        let prof = pick_profile(mouth_or_mid);
        rivers.push(unique_labeled("р. ", prof, &mut rng, &mut used));
    }

    WorldNames {
        landmasses,
        archipelagos,
        bays,
        isthmuses,
        lakes,
        mountain_ranges,
        passes,
        natural_regions,
        rivers,
    }
}

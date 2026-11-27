use fms_studio::server::{StudioApp, StudioResponse};
use std::collections::HashMap;

fn extract_pair(s: &str, key: &str) -> Option<(f64, f64)> {
    let pat = format!("\"{key}\":");
    let start = s.find(&pat)? + pat.len();
    let rest = &s[start..];
    let val_end = rest.find(|c: char| c == ',' || c == '}').unwrap_or(rest.len());
    let first: f64 = rest[..val_end].parse().ok()?;
    Some((first, 0.0))
}

#[test]
fn api_world_inspect_and_region_smoke() {
    let app = StudioApp::new().expect("init studio app");
    let mut world_q = HashMap::new();
    world_q.insert("seed".into(), "e".into());
    world_q.insert("w".into(), "180".into());
    world_q.insert("style".into(), "sepia".into());

    // По умолчанию генерируется чистый физический мир без стран и городов
    let world_res = app.handle_get("/api/world", &world_q);
    assert_eq!(world_res.status, 200);
    let body = String::from_utf8(world_res.body).expect("utf8 json");
    assert!(body.contains("\"seed\":\"e\""), "body={body}");
    assert!(body.contains("\"realms_count\":0,"), "default world must have 0 realms: {body}");
    assert!(body.contains("\"settlements_count\":0,"), "default world must have 0 settlements: {body}");
    assert!(body.contains("\"waypoints\":[{"), "expected natural waypoints: {body}");
    assert!(body.contains("\"proj\":{"), "expected client projection params: {body}");

    // Включение цивилизации по команде пользователя
    let mut civ_q = world_q.clone();
    civ_q.insert("civ_realms".into(), "1".into());
    civ_q.insert("civ_cities".into(), "1".into());
    civ_q.insert("civ_routes".into(), "1".into());
    let civ_res = app.handle_get("/api/world", &civ_q);
    assert_eq!(civ_res.status, 200);
    let civ_body = String::from_utf8(civ_res.body).expect("utf8 civ");
    assert!(!civ_body.contains("\"realms_count\":0,"), "expected generated realms: {civ_body}");
    assert!(!civ_body.contains("\"settlements_count\":0,"), "expected generated settlements: {civ_body}");
    assert!(civ_body.contains("\"kind\":\"settlement\""), "expected settlement waypoints: {civ_body}");

    let svg_res = app.handle_get("/api/world/overlay.svg", &civ_q);
    assert_eq!(svg_res.status, 200);
    let svg = String::from_utf8(svg_res.body).expect("utf8 svg");
    assert!(svg.contains("<svg "));
    assert!(svg.contains("id=\"layer-labels\""));
    assert!(svg.contains("id=\"layer-currents\""));
    assert!(svg.contains("id=\"layer-deposits\""));
    assert!(svg.contains("id=\"layer-pois\""));

    let png_res = app.handle_get("/api/world/map.png", &civ_q);
    assert_eq!(png_res.status, 200);
    assert_eq!(&png_res.body[..8], b"\x89PNG\r\n\x1a\n");

    let mut ins_q = civ_q.clone();
    ins_q.insert("lat".into(), "0".into());
    ins_q.insert("lon".into(), "0".into());
    let ins_res = app.handle_get("/api/inspect", &ins_q);
    assert_eq!(ins_res.status, 200);
    let ins_json = String::from_utf8(ins_res.body).expect("utf8 inspect");
    assert!(ins_json.contains("\"in_bounds\":true"), "inspect={ins_json}");
    assert!(ins_json.contains("\"nearest_deposit\":"), "inspect={ins_json}");
    assert!(ins_json.contains("\"resources\":{"), "inspect={ins_json}");

    let mut reg_q = civ_q.clone();
    reg_q.insert("lat".into(), "-2.0".into());
    reg_q.insert("lon".into(), "-100.0".into());
    reg_q.insert("span".into(), "24".into());
    reg_q.insert("style".into(), "color".into());
    let reg_res: StudioResponse = app.handle_get("/api/region", &reg_q);
    assert_eq!(reg_res.status, 200);
    let reg_json = String::from_utf8(reg_res.body).expect("utf8 reg");
    assert!(reg_json.contains("\"rivers_count\":"), "reg={reg_json}");
    assert!(reg_json.contains("\"waypoints\":["), "reg={reg_json}");

    let reg_svg = app.handle_get("/api/region/overlay.svg", &reg_q);
    assert_eq!(reg_svg.status, 200);
    let reg_svg_txt = String::from_utf8(reg_svg.body).expect("utf8 reg svg");
    assert!(reg_svg_txt.contains("id=\"layer-routes\""));

    // Проверка маршрута между двумя точками (settlement -> waypoint)
    let first_wp = civ_body.find("\"kind\":\"settlement\"").unwrap();
    let wp_slice = &civ_body[first_wp..];
    let (lat_a, _) = extract_pair(wp_slice, "lat").unwrap();
    let (lon_a, _) = extract_pair(wp_slice, "lon").unwrap();
    let second_off = wp_slice[30..].find("\"lat\":").unwrap() + 30;
    let wp2 = &wp_slice[second_off..];
    let (lat_b, _) = extract_pair(wp2, "lat").unwrap();
    let (lon_b, _) = extract_pair(wp2, "lon").unwrap();

    let mut p2p_q = civ_q.clone();
    p2p_q.insert("from_lat".into(), format!("{lat_a}"));
    p2p_q.insert("from_lon".into(), format!("{lon_a}"));
    p2p_q.insert("to_lat".into(), format!("{lat_b}"));
    p2p_q.insert("to_lon".into(), format!("{lon_b}"));
    let p2p_res = app.handle_get("/api/route_road", &p2p_q);
    assert_eq!(p2p_res.status, 200);
    let p2p_json = String::from_utf8(p2p_res.body).expect("utf8 p2p");
    assert!(p2p_json.contains("\"ok\":true"), "p2p={p2p_json}");
    assert!(p2p_json.contains("\"geo_pts\":["), "p2p={p2p_json}");
}

#[test]
fn api_lod_projection_roundtrip_and_deep_region() {
    let app = StudioApp::new().expect("init studio app");
    let mut q = HashMap::new();
    q.insert("seed".into(), "e".into());
    q.insert("w".into(), "180".into());
    q.insert("style".into(), "sepia".into());

    let w = app.handle_get("/api/world", &q);
    assert_eq!(w.status, 200);
    assert!(String::from_utf8(w.body).unwrap().contains("\"px_per_deg_lon\":"));

    let mut pq = q.clone();
    pq.insert("lat".into(), "20.0".into());
    pq.insert("lon".into(), "35.0".into());
    let pr = app.handle_get("/api/world/project", &pq);
    assert_eq!(pr.status, 200);
    let pj = String::from_utf8(pr.body).unwrap();
    let num = |s: &str, k: &str| -> f64 {
        let i = s.find(&format!("\"{k}\":")).unwrap() + k.len() + 3;
        let rest = &s[i..];
        let e = rest.find(|c: char| c == ',' || c == '}').unwrap();
        rest[..e].parse().unwrap()
    };
    let (x, y) = (num(&pj, "x"), num(&pj, "y"));

    let mut uq = q.clone();
    uq.insert("px".into(), format!("{x}"));
    uq.insert("py".into(), format!("{y}"));
    let ur = app.handle_get("/api/world/unproject", &uq);
    assert_eq!(ur.status, 200);
    let uj = String::from_utf8(ur.body).unwrap();
    assert!((num(&uj, "lat") - 20.0).abs() < 0.2, "{uj}");
    assert!((num(&uj, "lon") - 35.0).abs() < 0.2, "{uj}");

    let mut rq = q.clone();
    rq.insert("lat".into(), "20.0".into());
    rq.insert("lon".into(), "35.0".into());
    rq.insert("span".into(), "6".into());
    rq.insert("scale".into(), "16".into());
    let rr = app.handle_get("/api/region", &rq);
    assert_eq!(rr.status, 200);
    let rj = String::from_utf8(rr.body).unwrap();
    assert!(rj.contains("\"frame\":["), "{rj}");
    assert!(rj.contains("\"span_lon_deg\":"), "{rj}");

    for st in ["sepia", "ink", "color", "expedition", "painted", "sketch"] {
        let mut sq = q.clone();
        sq.insert("style".into(), st.into());
        let sw = app.handle_get("/api/world", &sq);
        assert_eq!(sw.status, 200);
        let ssvg = app.handle_get("/api/world/overlay.svg", &sq);
        assert_eq!(ssvg.status, 200);
        let svg_txt = String::from_utf8(ssvg.body).unwrap();
        assert!(svg_txt.contains("id=\"layer-legend\""), "{st} SVG missing legend");
    }
}

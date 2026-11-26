use fms_studio::server::{StudioApp, StudioResponse};
use std::collections::HashMap;

#[test]
fn api_world_inspect_and_region_smoke() {
    let app = StudioApp::new().expect("init studio app");
    let mut world_q = HashMap::new();
    world_q.insert("seed".into(), "e".into());
    world_q.insert("w".into(), "180".into());
    world_q.insert("style".into(), "expedition".into());

    let world_res = app.handle_get("/api/world", &world_q);
    assert_eq!(world_res.status, 200);
    let body = String::from_utf8(world_res.body).expect("utf8 json");
    assert!(body.contains("\"seed\":\"e\""), "body={body}");
    assert!(body.contains("\"rivers_count\":"), "body={body}");
    assert!(body.contains("\"deposits_count\":"), "body={body}");

    let svg_res = app.handle_get("/api/world/overlay.svg", &world_q);
    assert_eq!(svg_res.status, 200);
    let svg = String::from_utf8(svg_res.body).expect("utf8 svg");
    assert!(svg.contains("<svg "));
    assert!(svg.contains("id=\"layer-labels\""));
    assert!(svg.contains("id=\"layer-currents\""));
    assert!(svg.contains("id=\"layer-deposits\""));

    let png_res = app.handle_get("/api/world/map.png", &world_q);
    assert_eq!(png_res.status, 200);
    assert_eq!(&png_res.body[..8], b"\x89PNG\r\n\x1a\n");

    let mut ins_q = world_q.clone();
    ins_q.insert("lat".into(), "0".into());
    ins_q.insert("lon".into(), "0".into());
    let ins_res = app.handle_get("/api/inspect", &ins_q);
    assert_eq!(ins_res.status, 200);
    let ins_json = String::from_utf8(ins_res.body).expect("utf8 inspect");
    assert!(ins_json.contains("\"in_bounds\":true"), "inspect={ins_json}");
    assert!(ins_json.contains("\"nearest_deposit\":"), "inspect={ins_json}");
    assert!(ins_json.contains("\"resources\":{"), "inspect={ins_json}");

    let mut reg_q = world_q.clone();
    reg_q.insert("lat".into(), "-2.0".into());
    reg_q.insert("lon".into(), "-100.0".into());
    reg_q.insert("span".into(), "24".into());
    reg_q.insert("style".into(), "painted".into());
    let reg_res: StudioResponse = app.handle_get("/api/region", &reg_q);
    assert_eq!(reg_res.status, 200);
    let reg_json = String::from_utf8(reg_res.body).expect("utf8 reg");
    assert!(reg_json.contains("\"rivers_count\":"), "reg={reg_json}");

    let reg_svg = app.handle_get("/api/region/overlay.svg", &reg_q);
    assert_eq!(reg_svg.status, 200);
    let reg_svg_txt = String::from_utf8(reg_svg.body).expect("utf8 reg svg");
    assert!(reg_svg_txt.contains("id=\"layer-routes\""));

    // Проверка ограничений земной группы и маршрутизации дорог по рельефу
    let mut extreme_q = world_q.clone();
    extreme_q.insert("tilt".into(), "85.0".into());
    extreme_q.insert("water_depth".into(), "10.0".into());
    extreme_q.insert("continents".into(), "6".into());
    let extreme_res = app.handle_get("/api/world", &extreme_q);
    assert_eq!(extreme_res.status, 200);

    let mut road_q = reg_q.clone();
    road_q.insert("mode".into(), "region".into());
    road_q.insert("from_px".into(), "840".into());
    road_q.insert("from_py".into(), "600".into());
    let road_res = app.handle_get("/api/route_road", &road_q);
    assert_eq!(road_res.status, 200);
    let road_json = String::from_utf8(road_res.body).expect("utf8 road");
    assert!(road_json.contains("\"ok\":"), "road={road_json}");
}

#[test]
fn api_lod_projection_roundtrip_and_deep_region() {
    let app = StudioApp::new().expect("init studio app");
    let mut q = HashMap::new();
    q.insert("seed".into(), "e".into());
    q.insert("w".into(), "180".into());
    q.insert("style".into(), "expedition".into());

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

    let mut sq = q.clone();
    sq.insert("style".into(), "sketch".into());
    let sw = app.handle_get("/api/world", &sq);
    assert_eq!(sw.status, 200);
    let ssvg = app.handle_get("/api/world/overlay.svg", &sq);
    assert_eq!(ssvg.status, 200);
    let svg_txt = String::from_utf8(ssvg.body).unwrap();
    assert!(svg_txt.contains("id=\"layer-legend\""), "sketch SVG missing legend");
}

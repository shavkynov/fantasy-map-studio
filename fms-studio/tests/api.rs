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

    let svg_res = app.handle_get("/api/world/overlay.svg", &world_q);
    assert_eq!(svg_res.status, 200);
    let svg = String::from_utf8(svg_res.body).expect("utf8 svg");
    assert!(svg.contains("<svg "));
    assert!(svg.contains("id=\"layer-labels\""));
    assert!(svg.contains("id=\"layer-currents\""));

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

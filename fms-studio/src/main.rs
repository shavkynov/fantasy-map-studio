use fms_studio::server::StudioConfig;

fn main() {
    let mut port: u16 = 7878;
    let mut host = String::from("127.0.0.1");
    let mut force_web = false;
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--web" | "--no-browser" => {
                force_web = true;
                i += 1;
            }
            "--port" | "-p" if i + 1 < args.len() => {
                force_web = true;
                if let Ok(p) = args[i + 1].parse::<u16>() {
                    port = p;
                }
                i += 2;
            }
            "--host" if i + 1 < args.len() => {
                force_web = true;
                host = args[i + 1].clone();
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if !force_web {
            if let Err(e) = fms_studio::desktop::run() {
                eprintln!("fms-studio desktop error: {e}");
                std::process::exit(1);
            }
            return;
        }
        let cfg = StudioConfig { host, port };
        if let Err(e) = fms_studio::server::serve(cfg) {
            eprintln!("fms-studio error: {e}");
            std::process::exit(1);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let cfg = StudioConfig { host, port };
        if let Err(e) = fms_studio::server::serve_with_browser(cfg, !force_web) {
            eprintln!("fms-studio error: {e}");
            std::process::exit(1);
        }
    }
}

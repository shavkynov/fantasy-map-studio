use fms_studio::server::{serve, StudioConfig};

fn main() {
    let mut port: u16 = 7878;
    let mut host = String::from("127.0.0.1");
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--port" | "-p" if i + 1 < args.len() => {
                if let Ok(p) = args[i + 1].parse::<u16>() {
                    port = p;
                }
                i += 2;
            }
            "--host" if i + 1 < args.len() => {
                host = args[i + 1].clone();
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let cfg = StudioConfig { host, port };
    if let Err(e) = serve(cfg) {
        eprintln!("fms-studio error: {e}");
        std::process::exit(1);
    }
}

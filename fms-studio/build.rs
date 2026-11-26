use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rerun-if-changed=src/macos.m");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");

    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let clang_arch = match arch.as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("Unsupported macOS target arch: {other}"),
    };
    let deploy_target = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "12.0".into());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let obj = out_dir.join("macos.o");
    let lib = out_dir.join("libfms_macos.a");

    let min_flag = format!("-mmacosx-version-min={deploy_target}");
    let status = Command::new("clang")
        .args([
            "-arch",
            clang_arch,
            &min_flag,
            "-fobjc-arc",
            "-O2",
            "-Wall",
            "-Wextra",
            "-c",
            "-o",
        ])
        .arg(&obj)
        .arg("src/macos.m")
        .status()
        .expect("invoke clang for src/macos.m");
    assert!(status.success(), "clang failed compiling src/macos.m");

    let status_ar = Command::new("ar")
        .args(["rcs"])
        .arg(&lib)
        .arg(&obj)
        .status()
        .expect("invoke ar for libfms_macos.a");
    assert!(status_ar.success(), "ar failed archiving libfms_macos.a");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=fms_macos");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=WebKit");
}

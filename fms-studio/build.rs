use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    println!("cargo:rerun-if-changed=src/macos.m");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let obj = out_dir.join("macos.o");
    let lib = out_dir.join("libfms_macos.a");

    let status = Command::new("clang")
        .args(["-fobjc-arc", "-O2", "-Wall", "-Wextra", "-c", "-o"])
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

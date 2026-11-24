//! Нативное macOS-окно (`WKWebView` + пользовательская схема `fms://`), не требующее порта и внешнего браузера.

use crate::server::StudioApp;
use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr;

#[repr(C)]
pub struct FmsBuf {
    pub status: u16,
    pub content_type: *mut c_char,
    pub data: *mut u8,
    pub len: usize,
}

extern "C" {
    fn fms_run_macos_app(ctx: *const c_void, title: *const c_char);
}

#[no_mangle]
pub unsafe extern "C" fn fms_handle_request(ctx: *const c_void, target: *const c_char) -> FmsBuf {
    let target_str = if target.is_null() {
        "/"
    } else {
        unsafe { CStr::from_ptr(target) }.to_str().unwrap_or("/")
    };

    let app = unsafe { &*(ctx as *const StudioApp) };
    let resp = app.handle_raw_target(target_str);

    let ctype = CString::new(resp.content_type)
        .unwrap_or_else(|_| CString::new("application/octet-stream").unwrap())
        .into_raw();
    let len = resp.body.len();
    let data = if len == 0 {
        ptr::null_mut()
    } else {
        let mut boxed = resp.body.into_boxed_slice();
        let p = boxed.as_mut_ptr();
        std::mem::forget(boxed);
        p
    };

    FmsBuf {
        status: resp.status,
        content_type: ctype,
        data,
        len,
    }
}

#[no_mangle]
pub unsafe extern "C" fn fms_free_buf(buf: FmsBuf) {
    if !buf.content_type.is_null() {
        drop(unsafe { CString::from_raw(buf.content_type) });
    }
    if !buf.data.is_null() && buf.len > 0 {
        let slice_ptr = ptr::slice_from_raw_parts_mut(buf.data, buf.len);
        drop(unsafe { Box::from_raw(slice_ptr) });
    }
}

pub fn run() -> Result<(), String> {
    let app = Box::into_raw(Box::new(StudioApp::new()?));
    let title = CString::new("Fantasy Map Studio").map_err(|e| e.to_string())?;
    unsafe {
        fms_run_macos_app(app as *const c_void, title.as_ptr());
        drop(Box::from_raw(app));
    }
    Ok(())
}

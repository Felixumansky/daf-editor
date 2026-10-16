//! Windows 11 Snap Layouts for Daf's own title bar.
//!
//! Windows shows the snap flyout only when a window answers `WM_NCHITTEST` with `HTMAXBUTTON`.
//! The page lives in a WebView2 child that Windows asks instead, and it cannot answer that. So a
//! small transparent native child window sits exactly over the HTML maximize button and answers
//! for it. It paints nothing (the HTML button shows through), toggles maximize on click and
//! reports hover/press so the HTML button can draw its states.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, HBRUSH, NULL_BRUSH};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetParent, HTMAXBUTTON, HWND_TOP, IDC_ARROW, IsZoomed,
    LoadCursorW, RegisterClassExW, SW_MAXIMIZE, SW_RESTORE, SWP_HIDEWINDOW, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, SetWindowPos, ShowWindow, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN,
    WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS,
};

/// Hover and press changes for the HTML maximize button: "enter" | "leave" | "down" | "up".
pub const SNAP_EVENT: &str = "daf://snap";

static APP: OnceLock<AppHandle> = OnceLock::new();
static OVERLAY: AtomicIsize = AtomicIsize::new(0);
static HOVER: AtomicBool = AtomicBool::new(false);
static PRESSED: AtomicBool = AtomicBool::new(false);

fn emit(state: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit(SNAP_EVENT, state);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST => HTMAXBUTTON as LRESULT,
        WM_NCMOUSEMOVE => {
            if !HOVER.swap(true, Ordering::SeqCst) {
                let mut track = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                unsafe { TrackMouseEvent(&mut track) };
                emit("enter");
            }
            0
        }
        WM_NCMOUSELEAVE => {
            HOVER.store(false, Ordering::SeqCst);
            PRESSED.store(false, Ordering::SeqCst);
            emit("leave");
            0
        }
        // Swallowed: the default handling would start the system's own caption-button tracking.
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
            PRESSED.store(true, Ordering::SeqCst);
            emit("down");
            0
        }
        WM_NCLBUTTONUP => {
            if PRESSED.swap(false, Ordering::SeqCst) {
                unsafe {
                    let parent = GetParent(hwnd);
                    ShowWindow(
                        parent,
                        if IsZoomed(parent) != 0 {
                            SW_RESTORE
                        } else {
                            SW_MAXIMIZE
                        },
                    );
                }
            }
            emit("up");
            0
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// Create the overlay on first use. Must run on the UI thread (it owns the message loop).
fn overlay(window: &WebviewWindow) -> Option<HWND> {
    let existing = OVERLAY.load(Ordering::SeqCst);
    if existing != 0 {
        return Some(existing as HWND);
    }
    let parent = window.hwnd().ok()?.0 as HWND;
    let _ = APP.set(window.app_handle().clone());
    let class: Vec<u16> = "DafSnapOverlay\0".encode_utf16().collect();
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: GetStockObject(NULL_BRUSH) as HBRUSH,
            lpszMenuName: std::ptr::null(),
            lpszClassName: class.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        RegisterClassExW(&wc);
        // No WS_EX_LAYERED / WS_EX_TRANSPARENT: either one breaks the hit test.
        let hwnd = CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD | WS_CLIPSIBLINGS,
            0,
            0,
            0,
            0,
            parent,
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            tracing::warn!("could not create the snap-layout overlay");
            return None;
        }
        OVERLAY.store(hwnd as isize, Ordering::SeqCst);
        Some(hwnd)
    }
}

/// Put the overlay over the maximize button. The rect is in CSS pixels of the page; an empty
/// rect hides the overlay (e.g. while a modal covers the title bar).
pub fn place(window: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let win = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Some(hwnd) = overlay(&win) else { return };
        let r = |v: f64| (v * scale).round() as i32;
        let visible = w > 0.0 && h > 0.0;
        let flags = SWP_NOACTIVATE
            | if visible {
                SWP_SHOWWINDOW
            } else {
                SWP_HIDEWINDOW
            };
        unsafe { SetWindowPos(hwnd, HWND_TOP, r(x), r(y), r(w), r(h), flags) };
        if !visible && HOVER.swap(false, Ordering::SeqCst) {
            emit("leave");
        }
    });
}

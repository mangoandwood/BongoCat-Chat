mod core;
mod utils;

use core::{
    device::start_device_listening,
    gamepad::{start_gamepad_listing, stop_gamepad_listing},
    prevent_default, setup,
};
use tauri::{AppHandle, Emitter, Manager, WindowEvent, generate_handler};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_custom_window::{
    MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL, show_preference_window,
};
use utils::fs_extra::copy_dir;

#[cfg(target_os = "windows")]
use std::{ffi::c_void, sync::atomic::{AtomicBool, AtomicIsize, Ordering}, thread};

#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, MOD_ALT, MOD_NOREPEAT, RegisterHotKey};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

#[cfg(target_os = "windows")]
static PREVIOUS_FOREGROUND_WINDOW: AtomicIsize = AtomicIsize::new(0);

#[cfg(target_os = "windows")]
static COMPOSER_HOTKEYS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static VOICE_HOTKEY_HELD: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetForegroundWindow() -> *mut c_void;
    fn SetForegroundWindow(window: *mut c_void) -> i32;
}

#[tauri::command]
fn remember_foreground_window() {
    #[cfg(target_os = "windows")]
    unsafe {
        PREVIOUS_FOREGROUND_WINDOW.store(GetForegroundWindow() as isize, Ordering::Relaxed);
    }
}

#[tauri::command]
fn restore_foreground_window() {
    #[cfg(target_os = "windows")]
    unsafe {
        let window = PREVIOUS_FOREGROUND_WINDOW.swap(0, Ordering::Relaxed);
        if window != 0 {
            let _ = SetForegroundWindow(window as *mut c_void);
        }
    }
}

#[cfg(target_os = "windows")]
fn toggle_composer_native(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("composer") else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        restore_foreground_window();
    } else {
        remember_foreground_window();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
        if let Ok(hwnd) = window.hwnd() {
            unsafe { let _ = SetForegroundWindow(hwnd.0); }
        }
        let _ = window.set_focus();
        let _ = window.emit("composer-focus", ());
    }
}

#[cfg(target_os = "windows")]
fn toggle_bubble_native(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("bubble") else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
    }
}

#[cfg(target_os = "windows")]
fn start_composer_hotkeys(app_handle: AppHandle) {
    if COMPOSER_HOTKEYS_STARTED.swap(true, Ordering::SeqCst) { return; }
    thread::spawn(move || unsafe {
        let modifiers = MOD_ALT | MOD_NOREPEAT;
        let _ = RegisterHotKey(None, 0xBC01, modifiers, 0x31); // Alt + top-row 1: away/back
        let _ = RegisterHotKey(None, 0xBC02, modifiers, 0x51); // Alt + Q backup
        let _ = RegisterHotKey(None, 0xBC03, modifiers, 0x33); // Alt + top-row 3: hold to record voice
        let _ = RegisterHotKey(None, 0xBC04, modifiers, 0x32); // Alt + top-row 2: show/hide bubbles
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            if message.message == WM_HOTKEY && message.wParam.0 == 0xBC01 {
                let _ = app_handle.emit("away-toggle", ());
            } else if message.message == WM_HOTKEY && message.wParam.0 == 0xBC02 {
                let composer_handle = app_handle.clone();
                thread::spawn(move || {
                    while GetAsyncKeyState(0x12) < 0 {
                        thread::sleep(std::time::Duration::from_millis(8));
                    }
                    toggle_composer_native(&composer_handle);
                });
            } else if message.message == WM_HOTKEY && message.wParam.0 == 0xBC03 {
                if !VOICE_HOTKEY_HELD.swap(true, Ordering::SeqCst) {
                    let _ = app_handle.emit("voice-start", ());
                    let release_handle = app_handle.clone();
                    thread::spawn(move || {
                        while GetAsyncKeyState(0x12) < 0 {
                            thread::sleep(std::time::Duration::from_millis(8));
                        }
                        let _ = release_handle.emit("voice-stop", ());
                        VOICE_HOTKEY_HELD.store(false, Ordering::SeqCst);
                    });
                }
            } else if message.message == WM_HOTKEY && message.wParam.0 == 0xBC04 {
                toggle_bubble_native(&app_handle);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();

            let main_window = app.get_webview_window(MAIN_WINDOW_LABEL).unwrap();

            let preference_window = app.get_webview_window(PREFERENCE_WINDOW_LABEL).unwrap();

            setup::default(&app_handle, main_window.clone(), preference_window.clone());

            #[cfg(target_os = "windows")]
            start_composer_hotkeys(app_handle.clone());

            Ok(())
        })
        .invoke_handler(generate_handler![
            copy_dir,
            start_device_listening,
            start_gamepad_listing,
            stop_gamepad_listing,
            remember_foreground_window,
            restore_foreground_window
        ])
        .plugin(tauri_plugin_custom_window::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pinia::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(prevent_default::init())
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, _argv, _cwd| {
                show_preference_window(app_handle);
            },
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .filter(|metadata| !metadata.target().contains("gilrs"))
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_locale::init())
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();

                api.prevent_close();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            show_preference_window(app_handle);
        }
        _ => {
            let _ = app_handle;
        }
    });
}

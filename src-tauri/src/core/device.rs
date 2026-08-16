#[cfg(not(target_os = "windows"))]
use rdev::{Event, EventType, listen};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Runtime, command};

#[derive(Debug, Clone, Serialize)]
pub enum DeviceEventKind {
    MousePress,
    MouseRelease,
    MouseMove,
    KeyboardPress,
    KeyboardRelease,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceEvent {
    kind: DeviceEventKind,
    value: Value,
}

static IS_LISTENING: AtomicBool = AtomicBool::new(false);

#[command]
pub async fn start_device_listening<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    if IS_LISTENING.load(Ordering::SeqCst) {
        return Ok(());
    }

    IS_LISTENING.store(true, Ordering::SeqCst);

    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || windows_game_input_loop(app_handle));
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    let callback = move |event: Event| {
        let device_event = match event.event_type {
            EventType::ButtonPress(button) => DeviceEvent {
                kind: DeviceEventKind::MousePress,
                value: json!(format!("{:?}", button)),
            },
            EventType::ButtonRelease(button) => DeviceEvent {
                kind: DeviceEventKind::MouseRelease,
                value: json!(format!("{:?}", button)),
            },
            EventType::MouseMove { x, y } => DeviceEvent {
                kind: DeviceEventKind::MouseMove,
                value: json!({ "x": x, "y": y }),
            },
            EventType::KeyPress(key) => DeviceEvent {
                kind: DeviceEventKind::KeyboardPress,
                value: json!(format!("{:?}", key)),
            },
            EventType::KeyRelease(key) => DeviceEvent {
                kind: DeviceEventKind::KeyboardRelease,
                value: json!(format!("{:?}", key)),
            },
            _ => return,
        };

        let _ = app_handle.emit("device-changed", device_event);
    };

    #[cfg(not(target_os = "windows"))]
    listen(callback).map_err(|err| format!("Failed to listen device: {:?}", err))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_game_input_loop<R: Runtime>(app_handle: AppHandle<R>) {
    use std::{collections::HashMap, thread, time::Duration};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let keys: Vec<(i32, String)> = (0x41..=0x5A).map(|vk| (vk, format!("Key{}", char::from_u32(vk as u32).unwrap())))
        .chain((0x30..=0x39).map(|vk| (vk, format!("Num{}", vk - 0x30))))
        .chain([
            (0x08, "Backspace".into()), (0x09, "Tab".into()), (0x0D, "Return".into()),
            (0x14, "CapsLock".into()), (0x1B, "Escape".into()), (0x20, "Space".into()),
            (0x25, "LeftArrow".into()), (0x26, "UpArrow".into()), (0x27, "RightArrow".into()), (0x28, "DownArrow".into()),
            (0x2E, "Delete".into()), (0xA0, "ShiftLeft".into()), (0xA1, "ShiftRight".into()),
            (0xA2, "ControlLeft".into()), (0xA3, "ControlRight".into()), (0xA4, "Alt".into()), (0xA5, "AltGr".into()),
            (0x21, "PageUp".into()), (0x22, "PageDown".into()), (0x23, "End".into()), (0x24, "Home".into()),
            (0x2D, "Insert".into()), (0x5B, "MetaLeft".into()), (0x5C, "MetaRight".into()),
            (0x60, "Kp0".into()), (0x61, "Kp1".into()), (0x62, "Kp2".into()), (0x63, "Kp3".into()),
            (0x64, "Kp4".into()), (0x65, "Kp5".into()), (0x66, "Kp6".into()), (0x67, "Kp7".into()),
            (0x68, "Kp8".into()), (0x69, "Kp9".into()), (0x6A, "KpMultiply".into()), (0x6B, "KpPlus".into()),
            (0x6D, "KpMinus".into()), (0x6E, "KpDecimal".into()), (0x6F, "KpDivide".into()),
            (0x70, "F1".into()), (0x71, "F2".into()), (0x72, "F3".into()), (0x73, "F4".into()),
            (0x74, "F5".into()), (0x75, "F6".into()), (0x76, "F7".into()), (0x77, "F8".into()),
            (0x78, "F9".into()), (0x79, "F10".into()), (0x7A, "F11".into()), (0x7B, "F12".into()),
            (0xBA, "SemiColon".into()), (0xBB, "Equal".into()), (0xBC, "Comma".into()), (0xBD, "Minus".into()),
            (0xBE, "Dot".into()), (0xBF, "Slash".into()), (0xC0, "BackQuote".into()),
            (0xDB, "LeftBracket".into()), (0xDC, "BackSlash".into()), (0xDD, "RightBracket".into()), (0xDE, "Quote".into()),
        ]).collect();
    let mouse = [(0x01, "Left"), (0x02, "Right"), (0x04, "Middle"), (0x05, "Button4"), (0x06, "Button5")];
    let mut states: HashMap<i32, bool> = HashMap::new();
    let mut last_cursor = (i32::MIN, i32::MIN);

    loop {
        for (vk, name) in &keys {
            let down = unsafe { GetAsyncKeyState(*vk) } < 0;
            let old = states.insert(*vk, down).unwrap_or(false);
            if down != old {
                let _ = app_handle.emit("device-changed", DeviceEvent {
                    kind: if down { DeviceEventKind::KeyboardPress } else { DeviceEventKind::KeyboardRelease },
                    value: json!(name),
                });
            }
        }
        for (vk, name) in mouse {
            let down = unsafe { GetAsyncKeyState(vk) } < 0;
            let old = states.insert(vk, down).unwrap_or(false);
            if down != old {
                let _ = app_handle.emit("device-changed", DeviceEvent {
                    kind: if down { DeviceEventKind::MousePress } else { DeviceEventKind::MouseRelease },
                    value: json!(name),
                });
            }
        }
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_ok() && (point.x, point.y) != last_cursor {
            last_cursor = (point.x, point.y);
            let _ = app_handle.emit("device-changed", DeviceEvent {
                kind: DeviceEventKind::MouseMove,
                value: json!({ "x": point.x, "y": point.y }),
            });
        }
        thread::sleep(Duration::from_millis(8));
    }
}

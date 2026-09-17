// 플라이쨩 데스크톱: 작은 창 + 트레이 상주.
// 닫기 버튼은 종료가 아니라 트레이로 숨기기. 완전히 끄려면 트레이 메뉴의 "종료".
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// 자동 시작으로 켜질 때 붙는 인자. 이때는 창 없이 트레이에만 뜬다
const HIDDEN_ARG: &str = "--hidden";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 두 번 실행하면 새로 띄우지 않고 기존 창을 보여 준다
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "보이기 / 숨기기", true, None::<&str>)?;
            let on_top = CheckMenuItem::with_id(app, "on_top", "항상 위", true, false, None::<&str>)?;
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart =
                CheckMenuItem::with_id(app, "autostart", "컴퓨터 켜면 같이 시작", true, autostart_on, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &on_top, &autostart, &sep, &quit])?;

            let on_top_item = on_top.clone();
            let autostart_item = autostart.clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("아이콘이 없습니다").clone())
                .tooltip("플라이쨩")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => toggle_main(app),
                    "on_top" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let on = !w.is_always_on_top().unwrap_or(false);
                            let _ = w.set_always_on_top(on);
                            let _ = on_top_item.set_checked(on);
                        }
                    }
                    "autostart" => {
                        let launcher = app.autolaunch();
                        let on = !launcher.is_enabled().unwrap_or(false);
                        let _ = if on { launcher.enable() } else { launcher.disable() };
                        let _ = autostart_item.set_checked(on);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(w) = app.get_webview_window("main") {
                // 화면 오른쪽 아래 작업 표시줄 위에 둔다
                if let (Ok(Some(monitor)), Ok(size)) = (w.current_monitor(), w.outer_size()) {
                    let area = monitor.work_area();
                    let margin = (16.0 * monitor.scale_factor()) as i32;
                    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
                    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
                    let _ = w.set_position(PhysicalPosition::new(x.max(0), y.max(0)));
                }
                if std::env::args().any(|a| a == HIDDEN_ARG) {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("플라이쨩을 실행하지 못했습니다");
}

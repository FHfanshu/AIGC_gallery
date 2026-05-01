// 应用程序入口模块
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 程序入口，调用 lib 模块的 run 启动 Tauri 应用
fn main() {
    aigc_gallery_lib::run()
}

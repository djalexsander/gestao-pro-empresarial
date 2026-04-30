// Evita abrir um terminal extra no Windows em build de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gestao_pro_lib::run()
}

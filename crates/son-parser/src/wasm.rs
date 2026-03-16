//! WASM bindings for the SON parser.
//!
//! Exposes `parse_son_file` and `export_to_midi` to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;

/// Parse a .SON file and return the SongData as a JS object.
#[wasm_bindgen]
pub fn parse_son_wasm(data: &[u8]) -> Result<JsValue, JsError> {
    let song = crate::parse_song_data(data).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&song).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a .SON file to Standard MIDI File bytes.
#[wasm_bindgen]
pub fn export_midi_wasm(data: &[u8], song_name: &str) -> Result<Vec<u8>, JsError> {
    let song = crate::parse_song_data(data).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(crate::export_to_midi(&song, song_name))
}

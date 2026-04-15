//! Vector normalization primitives.
//!
//! Provides L2 normalization for embedding vectors, used by the llmtxt
//! embedding pipeline to ensure unit-length vectors before cosine similarity
//! comparisons.
//!
//! This is the single source of truth for L2 normalization — the TypeScript
//! `l2Normalize` in `apps/backend/src/utils/embeddings.ts` delegates here
//! via the WASM binding.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// L2-normalize a vector of f32 values to unit length.
///
/// Divides each element by the L2 norm (Euclidean length) of the vector.
/// Returns the input unchanged when the norm is zero (zero-vector guard).
///
/// # Arguments
/// * `vec` - The input vector as a slice of 32-bit floats.
///
/// # Returns
/// A new `Vec<f32>` where the L2 norm equals `1.0`, or a zero vector if the
/// input is the zero vector.
pub fn l2_normalize(vec: &[f32]) -> Vec<f32> {
    let mag: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag == 0.0 {
        return vec.to_vec();
    }
    vec.iter().map(|x| x / mag).collect()
}

/// L2-normalize a vector supplied as a JSON array of numbers (WASM entry point).
///
/// Delegates to [`l2_normalize`].
///
/// # Arguments
/// * `vec_json` — JSON array of numbers, e.g. `"[0.1, 0.2, 0.3]"`.
///
/// # Returns
/// JSON array string of normalized f32 values, or `"[]"` on parse error.
///
/// # Examples (TypeScript)
/// ```ts
/// import { l2Normalize } from 'llmtxt';
/// const normed = l2Normalize('[3.0, 4.0]'); // "[0.6, 0.8]"
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn l2_normalize_wasm(vec_json: &str) -> String {
    let v: Vec<f32> = match serde_json::from_str(vec_json) {
        Ok(v) => v,
        Err(_) => return "[]".to_string(),
    };
    serde_json::to_string(&l2_normalize(&v)).unwrap_or_else(|_| "[]".to_string())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: approximately equal for floats.
    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }

    // ── l2_normalize ──────────────────────────────────────────────

    /// Byte-identity vector 1: [3.0, 4.0] → [0.6, 0.8]
    /// Verified with TypeScript:
    /// ```ts
    /// function l2Normalize(vec) {
    ///   const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    ///   return mag === 0 ? vec : vec.map(x => x / mag);
    /// }
    /// l2Normalize([3.0, 4.0]) // [0.6, 0.8]
    /// ```
    #[test]
    fn normalize_3_4_gives_0_6_0_8() {
        let result = l2_normalize(&[3.0, 4.0]);
        assert!(approx_eq(result[0], 0.6), "expected 0.6, got {}", result[0]);
        assert!(approx_eq(result[1], 0.8), "expected 0.8, got {}", result[1]);
    }

    /// Byte-identity vector 2: [1.0, 0.0, 0.0] → [1.0, 0.0, 0.0]
    #[test]
    fn normalize_unit_vector_unchanged() {
        let result = l2_normalize(&[1.0, 0.0, 0.0]);
        assert!(approx_eq(result[0], 1.0));
        assert!(approx_eq(result[1], 0.0));
        assert!(approx_eq(result[2], 0.0));
    }

    /// Byte-identity vector 3: [1.0, 1.0, 1.0] → [1/√3, 1/√3, 1/√3]
    #[test]
    fn normalize_equal_components() {
        let result = l2_normalize(&[1.0, 1.0, 1.0]);
        let expected = 1.0_f32 / 3.0_f32.sqrt();
        for &v in &result {
            assert!(approx_eq(v, expected), "expected {expected}, got {v}");
        }
    }

    #[test]
    fn normalize_zero_vector_returns_zero() {
        let result = l2_normalize(&[0.0, 0.0, 0.0]);
        assert_eq!(result, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn normalize_empty_vec_returns_empty() {
        assert_eq!(l2_normalize(&[]), Vec::<f32>::new());
    }

    #[test]
    fn normalized_vector_has_unit_magnitude() {
        let result = l2_normalize(&[1.0, 2.0, 3.0, 4.0]);
        let mag: f32 = result.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(approx_eq(mag, 1.0), "magnitude should be 1.0, got {mag}");
    }

    // ── l2_normalize_wasm ────────────────────────────────────────

    #[test]
    fn wasm_roundtrip_parses_and_returns_json() {
        let out = l2_normalize_wasm("[3.0, 4.0]");
        let parsed: Vec<f32> = serde_json::from_str(&out).expect("valid JSON");
        assert_eq!(parsed.len(), 2);
        assert!(approx_eq(parsed[0], 0.6));
        assert!(approx_eq(parsed[1], 0.8));
    }

    #[test]
    fn wasm_invalid_json_returns_empty_array() {
        assert_eq!(l2_normalize_wasm("not json"), "[]");
        assert_eq!(l2_normalize_wasm("{\"key\":1}"), "[]");
    }
}
